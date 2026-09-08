import type { DatabaseClient } from '@asone/database';

/**
 * Real SQL queries only — every method here does its aggregation/
 * existence-check at the database layer (`sum`/`count`/`exists`), never
 * by fetching an unbounded row set and reducing it in Node. Reuses the
 * SAME already-authoritative tables `reports.repository.ts` itself
 * queries (`sales`, `cash_sessions`, `inventory_balances`,
 * `party_reservations`) — this module never invents a parallel data
 * source.
 */

interface QueryResult<T> {
  rows: T[];
}
function result<T>(value: unknown): QueryResult<T> {
  return value as QueryResult<T>;
}

/** Mirrors `reports.repository.ts`'s own `appendBranchScope` helper
 * verbatim (same `company_id`/`branch_id = any(...)` shape, with an
 * optional exact `branch_id` narrowing) — duplicated locally rather than
 * imported across modules, the same "copy, don't cross-import" rule this
 * task's own instructions call for and `product-catalog.service.ts`
 * already follows for `reports.service.ts`'s `csvEscape`/`csvRow` pair. */
function appendBranchScope(
  where: string[],
  values: unknown[],
  companyId: string,
  branchIds: readonly string[],
  branchId: string | undefined,
): void {
  values.push(companyId);
  where.push(`company_id = $${String(values.length)}`);
  values.push(branchIds);
  where.push(`branch_id = any($${String(values.length)}::uuid[])`);
  if (branchId !== undefined) {
    values.push(branchId);
    where.push(`branch_id = $${String(values.length)}`);
  }
}

/** Mirrors `reports.repository.ts`'s own `appendTimestampRange` helper
 * verbatim. Called here with `dateFrom === dateTo === todayIso` — the
 * exact same "start of day (inclusive) to start of next day (exclusive)"
 * shape that method already gives every other module, restricted to a
 * single day. */
function appendTimestampRange(where: string[], values: unknown[], column: string, dateFrom: string, dateTo: string): void {
  values.push(dateFrom);
  where.push(`${column} >= $${String(values.length)}::date`);
  values.push(dateTo);
  where.push(`${column} < ($${String(values.length)}::date + interval '1 day')`);
}

export class AssistantRepository {
  public constructor(private readonly database: DatabaseClient) {}

  /** Today's completed sales — count + gross total, per currency,
   * scoped to company+branch, `status='completed'`, `completed_at`
   * within [start of today, start of tomorrow) UTC. Reuses the SAME real
   * `sales` table `reports.repository.ts`'s own `salesTotals` already
   * queries — never a parallel data source. `todayIso` is the caller's
   * own real, current UTC calendar date (`YYYY-MM-DD`). */
  public async salesTodayTotals(
    companyId: string,
    branchIds: readonly string[],
    branchId: string | undefined,
    todayIso: string,
  ): Promise<{ currencyCode: string; grossTotal: string; transactionCount: number }[]> {
    const where: string[] = [];
    const values: unknown[] = [];
    appendBranchScope(where, values, companyId, branchIds, branchId);
    where.push(`status = 'completed'`);
    appendTimestampRange(where, values, 'completed_at', todayIso, todayIso);
    const rows = result<{ currency_code: string; gross: string; tx_count: string }>(
      await this.database.pool.query(
        `select currency_code, coalesce(sum(total),0)::text gross, count(*)::text tx_count
         from sales where ${where.join(' and ')} group by currency_code`,
        values,
      ),
    ).rows;
    return rows.map((row) => ({
      currencyCode: row.currency_code,
      grossTotal: row.gross,
      transactionCount: Number(row.tx_count),
    }));
  }

  /** A real, live existence check: is there at least one `cash_sessions`
   * row with `status='open'` for this company+branch scope right now. */
  public async hasOpenCashSession(
    companyId: string,
    branchIds: readonly string[],
    branchId: string | undefined,
  ): Promise<boolean> {
    const where: string[] = [];
    const values: unknown[] = [];
    appendBranchScope(where, values, companyId, branchIds, branchId);
    where.push(`status = 'open'`);
    const row = result<{ exists: boolean }>(
      await this.database.pool.query(
        `select exists(select 1 from cash_sessions where ${where.join(' and ')}) as exists`,
        values,
      ),
    ).rows[0];
    return row?.exists === true;
  }

  /** Count of `inventory_balances` rows where
   * `quantity_on_hand - quantity_reserved <= 0`, scoped to company+
   * branch. Mirrors `reports.repository.ts`'s own `inventoryBalanceTotals`
   * `out_of_stock_variant_count` expression exactly — the same column
   * names, the same `<= 0` predicate, never a re-guessed variant of it. */
  public async lowStockVariantCount(
    companyId: string,
    branchIds: readonly string[],
    branchId: string | undefined,
  ): Promise<number> {
    const where: string[] = [];
    const values: unknown[] = [];
    appendBranchScope(where, values, companyId, branchIds, branchId);
    const row = result<{ cnt: string }>(
      await this.database.pool.query(
        `select count(*) filter (where quantity_on_hand - quantity_reserved <= 0)::text cnt
         from inventory_balances where ${where.join(' and ')}`,
        values,
      ),
    ).rows[0];
    return row === undefined ? 0 : Number(row.cnt);
  }

  /** Count of `party_reservations` rows whose `event_date` is today and
   * `status <> 'cancelled'`, scoped to company+branch. Mirrors
   * `reports.repository.ts`'s own `partyReservationsByStatus` shape
   * (same `appendBranchScope` + `event_date` filter), narrowed to a
   * single day and to non-cancelled rows. `todayIso` is the caller's own
   * real, current UTC calendar date. */
  public async openPartiesTodayCount(
    companyId: string,
    branchIds: readonly string[],
    branchId: string | undefined,
    todayIso: string,
  ): Promise<number> {
    const where: string[] = [];
    const values: unknown[] = [];
    appendBranchScope(where, values, companyId, branchIds, branchId);
    values.push(todayIso);
    where.push(`event_date = $${String(values.length)}::date`);
    where.push(`status <> 'cancelled'`);
    const row = result<{ cnt: string }>(
      await this.database.pool.query(
        `select count(*)::text cnt from party_reservations where ${where.join(' and ')}`,
        values,
      ),
    ).rows[0];
    return row === undefined ? 0 : Number(row.cnt);
  }
}
