/// TASK 17.2 §4 — the Inventory landing page's backend: real KPI counts,
/// real alerts, real recent activity, real stock-by-location — every
/// figure sourced from the SAME `inventory_balances`/`inventory_movements`
/// tables the rest of this module already reads, never a second/divergent
/// aggregate. Genuinely new (no prior overview endpoint existed — see the
/// TASK 17.2 architecture audit), but additive-only: no schema change, no
/// new table.
///
/// Deliberately requires an explicit `branch_id`, never a blind
/// "all permitted branches" aggregate — "Movimientos hoy" needs a real,
/// branch-timezone-aware calendar day (`zonedDayBounds`, the same primitive
/// `CashService`/`ReportsService` already use), and a single day boundary
/// cannot be computed correctly across multiple branches that may sit in
/// different timezones without either picking an arbitrary one or running
/// N separate windows — every other branch-scoped inventory screen in
/// this app already requires the caller to pick one branch first, so this
/// matches the established convention rather than inventing a new one.
///
/// Valuation is deliberately NEVER computed here. TASK 17.2's own
/// architecture audit proved `inventory_balances.average_unit_cost` is
/// hardcoded to `0` on every write path in the entire codebase and
/// `product_variants.standard_cost` is never read by any inventory code —
/// there is no authoritative unit cost anywhere in this system today. This
/// endpoint reports that honestly (`valuation.available=false`) rather
/// than fabricating a figure that would always read "$0.00" and mislead an
/// operator into thinking their inventory is worthless. See
/// docs/INVENTORY_V2.md.
import type { FastifyInstance } from 'fastify';

import type { DatabaseClient } from '@asone/database';
import { AppError } from '@asone/errors';

import { responseMeta } from '../../http/response.js';
import {
  requireAuthenticatedUser,
  requireBranchAccess,
  requirePermission,
} from '../auth/auth.guards.js';
import type { AuthService } from '../auth/auth.service.js';
import { isValidIanaTimezone, localDateString, zonedDayBounds } from '../promotions/pricing.service.js';

interface QueryResult<T> {
  readonly rows: readonly T[];
}
function result<T>(value: unknown): QueryResult<T> {
  return value as QueryResult<T>;
}

export interface InventoryOverviewAlert {
  readonly productVariantId: string;
  readonly productName: string;
  readonly sku: string;
  readonly locationName: string;
  readonly quantityOnHand: string;
  readonly minStock: string | null;
  readonly stockStatus: 'low_stock' | 'out_of_stock';
}
export interface InventoryOverviewActivity {
  readonly movementId: string;
  readonly movementNumber: string;
  readonly movementType: string;
  readonly status: string;
  readonly occurredAt: Date;
  readonly referenceType: string | null;
  readonly sourceDocumentNumber: string | null;
}
export interface InventoryOverviewLocationSummary {
  readonly locationId: string;
  readonly locationName: string;
  readonly itemCount: number;
  readonly lowStockCount: number;
  readonly outOfStockCount: number;
}
export interface InventoryOverview {
  readonly itemCount: number;
  readonly lowStockCount: number;
  readonly outOfStockCount: number;
  readonly movementsTodayCount: number;
  readonly businessDate: string;
  readonly valuation: { readonly available: false; readonly reason: string };
  readonly alerts: readonly InventoryOverviewAlert[];
  readonly recentActivity: readonly InventoryOverviewActivity[];
  readonly byLocation: readonly InventoryOverviewLocationSummary[];
}

const VALUATION_UNAVAILABLE_REASON =
  'No existe un costo unitario confiable todavía: el costo promedio de inventario nunca se ha calculado y el costo estándar del catálogo no está conectado al inventario.';

export class InventoryOverviewRepository {
  public constructor(private readonly database: DatabaseClient) {}

  public async branchTimezone(companyId: string, branchId: string): Promise<string | null> {
    const row = result<{ timezone: string }>(
      await this.database.pool.query(
        `select timezone from branches where company_id=$1 and id=$2 and status='active'`,
        [companyId, branchId],
      ),
    ).rows[0];
    return row?.timezone ?? null;
  }

  public async counts(
    companyId: string,
    branchId: string,
  ): Promise<{ itemCount: number; lowStockCount: number; outOfStockCount: number }> {
    const row = result<{ item_count: string; low_stock_count: string; out_of_stock_count: string }>(
      await this.database.pool.query(
        `select
           count(*)::text item_count,
           count(*) filter (where ${STOCK_STATUS_EXPR}='low_stock')::text low_stock_count,
           count(*) filter (where ${STOCK_STATUS_EXPR}='out_of_stock')::text out_of_stock_count
         from inventory_balances b
         join product_variants v on v.company_id=b.company_id and v.id=b.product_variant_id
         where b.company_id=$1 and b.branch_id=$2`,
        [companyId, branchId],
      ),
    ).rows[0];
    return {
      itemCount: Number(row?.item_count ?? '0'),
      lowStockCount: Number(row?.low_stock_count ?? '0'),
      outOfStockCount: Number(row?.out_of_stock_count ?? '0'),
    };
  }

  public async movementsToday(
    companyId: string,
    branchId: string,
    dayStart: Date,
    dayEnd: Date,
  ): Promise<number> {
    const row = result<{ count: string }>(
      await this.database.pool.query(
        `select count(*)::text count from inventory_movements
         where company_id=$1 and branch_id=$2 and occurred_at>=$3 and occurred_at<$4`,
        [companyId, branchId, dayStart, dayEnd],
      ),
    ).rows[0];
    return Number(row?.count ?? '0');
  }

  public async alerts(
    companyId: string,
    branchId: string,
    limit: number,
  ): Promise<InventoryOverviewAlert[]> {
    const rows = result<{
      product_variant_id: string;
      product_name: string;
      sku: string;
      location_name: string;
      quantity_on_hand: string;
      min_stock: string | null;
      stock_status: 'low_stock' | 'out_of_stock';
    }>(
      await this.database.pool.query(
        `select b.product_variant_id, coalesce(nullif(btrim(v.name), ''), p.name) product_name,
                v.sku, l.name location_name, b.quantity_on_hand::text, v.min_stock::text min_stock,
                ${STOCK_STATUS_EXPR} stock_status
         from inventory_balances b
         join product_variants v on v.company_id=b.company_id and v.id=b.product_variant_id
         join products p on p.company_id=v.company_id and p.id=v.product_id
         join inventory_locations l on l.company_id=b.company_id and l.id=b.inventory_location_id
         where b.company_id=$1 and b.branch_id=$2
           and ${STOCK_STATUS_EXPR} in ('low_stock','out_of_stock')
         order by (${STOCK_STATUS_EXPR}='out_of_stock') desc, product_name
         limit $3`,
        [companyId, branchId, limit],
      ),
    ).rows;
    return rows.map((row) => ({
      productVariantId: row.product_variant_id,
      productName: row.product_name,
      sku: row.sku,
      locationName: row.location_name,
      quantityOnHand: row.quantity_on_hand,
      minStock: row.min_stock,
      stockStatus: row.stock_status,
    }));
  }

  public async recentActivity(
    companyId: string,
    branchId: string,
    limit: number,
  ): Promise<InventoryOverviewActivity[]> {
    const rows = result<{
      id: string;
      movement_number: string;
      movement_type: string;
      status: string;
      occurred_at: Date | string;
      reference_type: string | null;
      source_document_number: string | null;
    }>(
      await this.database.pool.query(
        `select id, movement_number, movement_type, status, occurred_at,
                reference_type, source_document_number
         from inventory_movements
         where company_id=$1 and branch_id=$2
         order by occurred_at desc, id desc
         limit $3`,
        [companyId, branchId, limit],
      ),
    ).rows;
    return rows.map((row) => ({
      movementId: row.id,
      movementNumber: row.movement_number,
      movementType: row.movement_type,
      status: row.status,
      occurredAt: new Date(row.occurred_at),
      referenceType: row.reference_type,
      sourceDocumentNumber: row.source_document_number,
    }));
  }

  public async byLocation(
    companyId: string,
    branchId: string,
  ): Promise<InventoryOverviewLocationSummary[]> {
    const rows = result<{
      location_id: string;
      location_name: string;
      item_count: string;
      low_stock_count: string;
      out_of_stock_count: string;
    }>(
      await this.database.pool.query(
        `select l.id location_id, l.name location_name,
                count(b.id)::text item_count,
                count(*) filter (where ${STOCK_STATUS_EXPR}='low_stock')::text low_stock_count,
                count(*) filter (where ${STOCK_STATUS_EXPR}='out_of_stock')::text out_of_stock_count
         from inventory_locations l
         left join inventory_balances b
           on b.company_id=l.company_id and b.inventory_location_id=l.id
         left join product_variants v
           on v.company_id=b.company_id and v.id=b.product_variant_id
         where l.company_id=$1 and l.branch_id=$2 and l.status='active'
         group by l.id, l.name
         order by l.name`,
        [companyId, branchId],
      ),
    ).rows;
    return rows.map((row) => ({
      locationId: row.location_id,
      locationName: row.location_name,
      itemCount: Number(row.item_count),
      lowStockCount: Number(row.low_stock_count),
      outOfStockCount: Number(row.out_of_stock_count),
    }));
  }
}

// Mirrors `inventory.repository.ts`'s own `STOCK_STATUS_EXPR` exactly —
// never a second, divergent low-stock/out-of-stock definition. Duplicated
// here (not imported) only because that constant isn't exported; the SQL
// text itself must stay byte-identical.
const STOCK_STATUS_EXPR = `case
    when (b.quantity_on_hand-b.quantity_reserved)<=0 then 'out_of_stock'
    when v.min_stock is not null and (b.quantity_on_hand-b.quantity_reserved)<=v.min_stock then 'low_stock'
    else 'available'
  end`;

export class InventoryOverviewService {
  public constructor(private readonly repository: InventoryOverviewRepository) {}

  public async get(companyId: string, branchId: string): Promise<InventoryOverview> {
    const timezone = await this.repository.branchTimezone(companyId, branchId);
    if (timezone === null || !isValidIanaTimezone(timezone))
      throw new AppError({
        code: 'branch_timezone_invalid',
        message: "The branch's configured timezone is missing or invalid.",
        statusCode: 500,
      });
    const businessDate = localDateString(new Date(), timezone);
    const { start, end } = zonedDayBounds(businessDate, timezone);
    const [{ itemCount, lowStockCount, outOfStockCount }, movementsTodayCount, alerts, recentActivity, byLocation] =
      await Promise.all([
        this.repository.counts(companyId, branchId),
        this.repository.movementsToday(companyId, branchId, start, end),
        this.repository.alerts(companyId, branchId, 10),
        this.repository.recentActivity(companyId, branchId, 10),
        this.repository.byLocation(companyId, branchId),
      ]);
    return {
      itemCount,
      lowStockCount,
      outOfStockCount,
      movementsTodayCount,
      businessDate,
      valuation: { available: false, reason: VALUATION_UNAVAILABLE_REASON },
      alerts,
      recentActivity,
      byLocation,
    };
  }
}

interface OverviewQuery {
  branch_id: string;
}
const errorSchema = { type: 'object', additionalProperties: true } as const;

export function registerInventoryOverviewRoutes(
  app: FastifyInstance,
  authentication: AuthService,
  service: InventoryOverviewService,
): void {
  app.get<{ Querystring: OverviewQuery }>(
    '/api/v1/inventory/overview',
    {
      schema: {
        tags: ['inventory'],
        querystring: {
          type: 'object',
          additionalProperties: false,
          required: ['branch_id'],
          properties: { branch_id: { type: 'string', format: 'uuid' } },
        },
        response: {
          200: { type: 'object', additionalProperties: true },
          400: errorSchema,
          401: errorSchema,
          403: errorSchema,
          500: errorSchema,
        },
      },
    },
    async (request, reply) => {
      const auth = await requireAuthenticatedUser(request, authentication);
      requirePermission(authentication, auth, 'inventory.read');
      requireBranchAccess(authentication, auth, request.query.branch_id);
      const overview = await service.get(auth.companyId, request.query.branch_id);
      return reply.send({
        data: {
          item_count: overview.itemCount,
          low_stock_count: overview.lowStockCount,
          out_of_stock_count: overview.outOfStockCount,
          movements_today_count: overview.movementsTodayCount,
          business_date: overview.businessDate,
          valuation: overview.valuation,
          alerts: overview.alerts.map((alert) => ({
            product_variant_id: alert.productVariantId,
            product_name: alert.productName,
            sku: alert.sku,
            location_name: alert.locationName,
            quantity_on_hand: alert.quantityOnHand,
            min_stock: alert.minStock,
            stock_status: alert.stockStatus,
          })),
          recent_activity: overview.recentActivity.map((activity) => ({
            movement_id: activity.movementId,
            movement_number: activity.movementNumber,
            movement_type: activity.movementType,
            status: activity.status,
            occurred_at: activity.occurredAt.toISOString(),
            reference_type: activity.referenceType,
            source_document_number: activity.sourceDocumentNumber,
          })),
          by_location: overview.byLocation.map((location) => ({
            location_id: location.locationId,
            location_name: location.locationName,
            item_count: location.itemCount,
            low_stock_count: location.lowStockCount,
            out_of_stock_count: location.outOfStockCount,
          })),
        },
        meta: responseMeta(request.requestContext),
      });
    },
  );
}
