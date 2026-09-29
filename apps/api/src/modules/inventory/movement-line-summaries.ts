/// TASK 17.2.4 — shared, batched "what does this movement's single line
/// actually represent" resolver, for the two read surfaces that show a
/// movement as one activity card (the movement list and the Inventory
/// Overview's "Actividad reciente"): `apps/api/src/modules/inventory/
/// inventory.repository.ts`'s `InventoryMovementReadService.list()` and
/// `inventory-overview.ts`'s `recentActivity()`.
///
/// A movement can have any number of lines (a multi-item sale posts one
/// `sale_consumption` movement with one line per sold/consumed variant).
/// Only when a movement has EXACTLY ONE line is a single product/quantity
/// safe to surface as that movement's own headline fact — a multi-line
/// movement's `lineCount` is still reported (so the caller can render an
/// honest "3 productos" instead), but its `singleLine` is `undefined`,
/// never an arbitrarily-picked line passed off as "the" product.
///
/// Two bounded queries regardless of page size — never one query per
/// movement: (1) a `GROUP BY` count for every movement id in the page,
/// (2) the actual line row, but ONLY for the movement ids whose count is
/// exactly 1. Both use `inventory_movement_lines_movement_idx`
/// (company_id, inventory_movement_id), already indexed for this
/// predicate — no new index required.
export interface MovementLineSummary {
  readonly lineCount: number;
  readonly singleLine?: {
    readonly productVariantId: string;
    readonly quantity: string;
    readonly unitOfMeasureCode: string;
    /// Derived structurally from which location column is set — never
    /// from the movement type's name and never from quantity's sign
    /// (every `inventory_movement_lines.quantity` is stored positive; see
    /// this table's own `inventory_movement_lines_quantity_ck`). `'move'`
    /// is the honest, rare case where a single line legitimately has BOTH
    /// a source and a destination location (the schema's own
    /// `inventory_movement_lines_direction_ck` permits it) — never
    /// silently reported as `'in'` or `'out'`.
    readonly direction: 'in' | 'out' | 'move';
    /// Raw passthrough of `inventory_movement_lines.metadata` — for
    /// `sale_consumption`, `{source: 'recipe', sold_product_variant_id,
    /// sold_product_name_snapshot, recipe_component_quantity, ...}` when
    /// this line is recipe-driven ingredient consumption, `null` for a
    /// direct (non-recipe) line. This is the ONLY authoritative signal
    /// this codebase has for "was this a direct sale or a recipe
    /// ingredient" — never inferred from `is_sellable` or product naming
    /// (see `sale-consumption.ts`'s own doc comment on this field).
    readonly metadata: Readonly<Record<string, unknown>> | null;
  };
}

interface Executor {
  query(sql: string, values?: readonly unknown[]): Promise<unknown>;
}
interface QueryResult<T> {
  rows: readonly T[];
}
function result<T>(value: unknown): QueryResult<T> {
  return value as QueryResult<T>;
}

export async function resolveMovementLineSummaries(
  executor: Executor,
  companyId: string,
  movementIds: readonly string[],
): Promise<Map<string, MovementLineSummary>> {
  if (movementIds.length === 0) return new Map();
  const ids = [...new Set(movementIds)];
  const countRows = result<{ inventory_movement_id: string; line_count: string }>(
    await executor.query(
      `select inventory_movement_id, count(*)::text as line_count
       from inventory_movement_lines
       where company_id=$1 and inventory_movement_id=any($2::uuid[])
       group by inventory_movement_id`,
      [companyId, ids],
    ),
  ).rows;
  const summaries = new Map<string, MovementLineSummary>();
  const singleLineMovementIds: string[] = [];
  for (const row of countRows) {
    const lineCount = Number(row.line_count);
    summaries.set(row.inventory_movement_id, { lineCount });
    if (lineCount === 1) singleLineMovementIds.push(row.inventory_movement_id);
  }
  if (singleLineMovementIds.length === 0) return summaries;

  const lineRows = result<{
    inventory_movement_id: string;
    product_variant_id: string;
    quantity: string;
    unit_of_measure_code: string;
    source_location_id: string | null;
    destination_location_id: string | null;
    metadata: Readonly<Record<string, unknown>> | null;
  }>(
    await executor.query(
      `select inventory_movement_id, product_variant_id, quantity::text, unit_of_measure_code,
              source_location_id, destination_location_id, metadata
       from inventory_movement_lines
       where company_id=$1 and inventory_movement_id=any($2::uuid[])`,
      [companyId, singleLineMovementIds],
    ),
  ).rows;
  for (const row of lineRows) {
    const direction: 'in' | 'out' | 'move' =
      row.source_location_id !== null && row.destination_location_id !== null
        ? 'move'
        : row.source_location_id !== null
          ? 'out'
          : 'in';
    summaries.set(row.inventory_movement_id, {
      lineCount: 1,
      singleLine: {
        productVariantId: row.product_variant_id,
        quantity: row.quantity,
        unitOfMeasureCode: row.unit_of_measure_code,
        direction,
        metadata: row.metadata,
      },
    });
  }
  return summaries;
}
