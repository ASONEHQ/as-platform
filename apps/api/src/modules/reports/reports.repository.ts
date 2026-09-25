import type { DatabaseClient } from '@asone/database';

import { zonedDayBounds } from '../promotions/pricing.service.js';
import {
  ReportsError,
  type CashMovementTotal,
  type ClosedSessionTotal,
  type CurrencyAmount,
  type HourlySales,
  type InventoryMovementVolume,
  type KardexExportRow,
  type PaymentMethodTotal,
  type SalesExportRow,
  type StatusCount,
  type TopProduct,
} from './reports.types.js';

/** Raw shape read off `cash_movements` for the financial CSV export —
 * deliberately WITHOUT a `direction` field: direction is never stored or
 * re-derived here, only in `reports.service.ts`, from the single shared
 * `cashMovementDirection` table (see that file). */
export interface FinancialExportRawRow {
  readonly id: string;
  readonly branchId: string;
  readonly cashSessionId: string;
  readonly movementType: string;
  readonly amount: string;
  readonly currencyCode: string;
  readonly category: string | null;
  readonly reasonCode: string;
  readonly occurredAt: Date;
}

/**
 * Every method here does its aggregation with real SQL (`sum`/`count`/
 * `group by`) at the database layer — never by fetching an unbounded row
 * set and reducing it in Node (this task's own explicit instruction). The
 * two CSV-export methods are the deliberate exception: they return real
 * individual rows, because a CSV export's whole purpose is the underlying
 * detail, not an aggregate.
 */

interface QueryResult<T> {
  rows: T[];
}
function result<T>(value: unknown): QueryResult<T> {
  return value as QueryResult<T>;
}

export interface ReportScopeInput {
  readonly branchId?: string | undefined;
  readonly dateFrom: string;
  readonly dateTo: string;
  // TASK 16.23B (F-06) — the real IANA timezone `dateFrom`/`dateTo` (plain
  // calendar dates, no offset) must be resolved AS OBSERVED IN — the
  // requested branch's own, or the company's own when the report spans
  // every branch — resolved once in `ReportsService`, never guessed here.
  readonly timezone: string;
}

/** Appends `company_id=$n` and `branch_id=any($n::uuid[])` (plus, when
 * `branchId` is given, an exact `branch_id=$n` narrowing) to `where`/
 * `values` — the one scoping shape every branch-scoped table in this
 * module shares. Always called first, so `company_id`/`branch_id` land at
 * a predictable position before each query's own date-range params. */
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

/** `customers`/`customer_memberships`/`loyalty_accounts` carry no branch
 * dimension in this schema — company scope only. */
function appendCompanyScope(where: string[], values: unknown[], companyId: string): void {
  values.push(companyId);
  where.push(`company_id = $${String(values.length)}`);
}

// TASK 16.23B (F-06) — was `${column} >= $n::date` / `< ($n::date +
// interval '1 day')`, which Postgres evaluates the `::date` cast of a
// `timestamptz` column in the DATABASE SESSION's own timezone (effectively
// UTC), never the branch/company's configured one — a sale at 11pm
// `America/Mexico_City` (already 05:00 UTC the NEXT day) could silently
// fall outside a report filtered for "that day" from the business's own
// perspective. Now resolves the real `[start, end)` UTC instant range for
// `dateFrom`/`dateTo` AS OBSERVED IN `timezone`, via the same
// `zonedDayBounds` primitive `CashService.closeSession`/`partialClose`
// already use for the identical "branch-local calendar day" concept — one
// shared, already-tested mechanism, not a second hand-rolled one — and
// binds real timestamptz params compared with plain `>=`/`<` (no cast).
function appendTimestampRange(
  where: string[],
  values: unknown[],
  column: string,
  dateFrom: string,
  dateTo: string,
  timezone: string,
): void {
  values.push(zonedDayBounds(dateFrom, timezone).start);
  where.push(`${column} >= $${String(values.length)}`);
  values.push(zonedDayBounds(dateTo, timezone).end);
  where.push(`${column} < $${String(values.length)}`);
}

function appendDateColumnRange(where: string[], values: unknown[], column: string, dateFrom: string, dateTo: string): void {
  values.push(dateFrom);
  where.push(`${column} >= $${String(values.length)}::date`);
  values.push(dateTo);
  where.push(`${column} <= $${String(values.length)}::date`);
}

export class ReportsRepository {
  public constructor(private readonly database: DatabaseClient) {}

  // TASK 16.23B (F-06) — the real, configured IANA timezone to resolve a
  // report's `date_from`/`date_to` AS OBSERVED IN: the requested branch's
  // own (`branches.timezone`) when one is pinned, or the company's own
  // (`companies.timezone`) when the report spans every branch the actor
  // can see — the same fallback convention `production-owner.service.ts`
  // and the branch-consolidation module already use for "no single branch
  // to ask." Read directly (not a settings resolver — this is each row's
  // own column), mirroring `CashRepository.branchTimezone`'s exact shape.
  public async branchTimezone(companyId: string, branchId: string): Promise<string> {
    const row = result<{ timezone: string }>(
      await this.database.pool.query('select timezone from branches where company_id=$1 and id=$2', [companyId, branchId]),
    ).rows[0];
    if (row === undefined) throw new ReportsError('resource_not_found', 'The branch was not found.');
    return row.timezone;
  }

  public async companyTimezone(companyId: string): Promise<string> {
    const row = result<{ timezone: string }>(
      await this.database.pool.query('select timezone from companies where id=$1', [companyId]),
    ).rows[0];
    if (row === undefined) throw new ReportsError('resource_not_found', 'The company was not found.');
    return row.timezone;
  }

  // --- Sales --------------------------------------------------------------

  public async salesTotals(
    companyId: string,
    branchIds: readonly string[],
    input: ReportScopeInput,
  ): Promise<{ currencyCode: string; grossSales: string; transactionCount: number }[]> {
    const where: string[] = [];
    const values: unknown[] = [];
    appendBranchScope(where, values, companyId, branchIds, input.branchId);
    where.push(`status = 'completed'`);
    appendTimestampRange(where, values, 'completed_at', input.dateFrom, input.dateTo, input.timezone);
    const rows = result<{ currency_code: string; gross: string; tx_count: string }>(
      await this.database.pool.query(
        `select currency_code, coalesce(sum(total),0)::text gross, count(*)::text tx_count
         from sales where ${where.join(' and ')} group by currency_code`,
        values,
      ),
    ).rows;
    return rows.map((row) => ({
      currencyCode: row.currency_code,
      grossSales: row.gross,
      transactionCount: Number(row.tx_count),
    }));
  }

  public async refundsTotals(
    companyId: string,
    branchIds: readonly string[],
    input: ReportScopeInput,
  ): Promise<{ currencyCode: string; refundsTotal: string; refundCount: number }[]> {
    const where: string[] = [];
    const values: unknown[] = [];
    appendBranchScope(where, values, companyId, branchIds, input.branchId);
    where.push(`status = 'completed'`);
    appendTimestampRange(where, values, 'completed_at', input.dateFrom, input.dateTo, input.timezone);
    const rows = result<{ currency_code: string; total: string; refund_count: string }>(
      await this.database.pool.query(
        `select currency_code, coalesce(sum(total),0)::text total, count(*)::text refund_count
         from refunds where ${where.join(' and ')} group by currency_code`,
        values,
      ),
    ).rows;
    return rows.map((row) => ({
      currencyCode: row.currency_code,
      refundsTotal: row.total,
      refundCount: Number(row.refund_count),
    }));
  }

  public async salesExportRows(
    companyId: string,
    branchIds: readonly string[],
    input: ReportScopeInput,
  ): Promise<SalesExportRow[]> {
    const where: string[] = [];
    const values: unknown[] = [];
    appendBranchScope(where, values, companyId, branchIds, input.branchId);
    where.push(`status = 'completed'`);
    appendTimestampRange(where, values, 'completed_at', input.dateFrom, input.dateTo, input.timezone);
    const rows = result<{
      id: string;
      sale_number: string;
      branch_id: string;
      status: string;
      occurred_at: Date | string;
      completed_at: Date | string | null;
      subtotal: string;
      discount_total: string;
      tax_total: string;
      total: string;
      currency_code: string;
      customer_display_name: string | null;
    }>(
      await this.database.pool.query(
        `select id, sale_number, branch_id, status, occurred_at, completed_at,
                subtotal::text, discount_total::text, tax_total::text, total::text,
                currency_code, customer_display_name
         from sales where ${where.join(' and ')}
         order by completed_at asc, id asc`,
        values,
      ),
    ).rows;
    return rows.map((row) => ({
      id: row.id,
      saleNumber: row.sale_number,
      branchId: row.branch_id,
      status: row.status,
      occurredAt: new Date(row.occurred_at),
      completedAt: row.completed_at === null ? null : new Date(row.completed_at),
      subtotal: row.subtotal,
      discountTotal: row.discount_total,
      taxTotal: row.tax_total,
      total: row.total,
      currencyCode: row.currency_code,
      customerDisplayName: row.customer_display_name,
    }));
  }

  // TASK 16.25 (Phase 6/Inteligencia) — real branch-local hour-of-day
  // buckets, computed entirely in SQL (`extract(hour from ... at time
  // zone $tz)`) — never fetched as raw rows and bucketed in Node, which
  // this module's own class doc comment explicitly rules out.
  public async salesByHour(
    companyId: string,
    branchIds: readonly string[],
    input: ReportScopeInput,
  ): Promise<HourlySales[]> {
    const where: string[] = [];
    const values: unknown[] = [];
    appendBranchScope(where, values, companyId, branchIds, input.branchId);
    where.push(`status = 'completed'`);
    appendTimestampRange(where, values, 'completed_at', input.dateFrom, input.dateTo, input.timezone);
    values.push(input.timezone);
    const tzParam = `$${String(values.length)}`;
    // A bare (no `AS`) alias named `hour` trips Postgres's parser right
    // after `extract(hour from ...)` — empirically confirmed against the
    // real test database; `as hour_of_day` (explicit `AS`, a
    // non-keyword-adjacent name) parses cleanly.
    const rows = result<{ hour_of_day: string; currency_code: string; gross: string; tx_count: string }>(
      await this.database.pool.query(
        `select extract(hour from completed_at at time zone ${tzParam})::int::text as hour_of_day,
                currency_code, coalesce(sum(total),0)::text gross, count(*)::text tx_count
         from sales where ${where.join(' and ')}
         group by hour_of_day, currency_code
         order by min(extract(hour from completed_at at time zone ${tzParam})) asc`,
        values,
      ),
    ).rows;
    return rows.map((row) => ({
      hour: Number(row.hour_of_day),
      currencyCode: row.currency_code,
      transactionCount: Number(row.tx_count),
      grossSales: row.gross,
    }));
  }

  // TASK 16.25 (Phase 6/Inteligencia) — real `sale_items` rows joined to
  // their own sale's company/branch/status/completed_at scope (the same
  // `appendBranchScope`/`appendTimestampRange` shape every other query in
  // this class uses, applied through the join rather than directly —
  // mirrors `inventoryMovementVolume`'s own `m.`-prefixed pattern for a
  // joined query). `name_snapshot` (frozen at sale time, never the
  // product's current, possibly-renamed name) is the display name —
  // matches `sale_items`' own established "never re-read a mutable
  // record later" convention.
  public async topProducts(
    companyId: string,
    branchIds: readonly string[],
    input: ReportScopeInput,
  ): Promise<TopProduct[]> {
    const where: string[] = ['s.company_id = $1', 's.branch_id = any($2::uuid[])', `s.status = 'completed'`];
    const values: unknown[] = [companyId, branchIds];
    if (input.branchId !== undefined) {
      values.push(input.branchId);
      where.push(`s.branch_id = $${String(values.length)}`);
    }
    appendTimestampRange(where, values, 's.completed_at', input.dateFrom, input.dateTo, input.timezone);
    const rows = result<{
      product_id: string | null;
      name: string;
      currency_code: string;
      qty: string;
      revenue: string;
    }>(
      await this.database.pool.query(
        `select i.product_id, i.name_snapshot name, s.currency_code,
                coalesce(sum(i.quantity),0)::text qty, coalesce(sum(i.line_total),0)::text revenue
         from sale_items i
         join sales s on s.company_id = i.company_id and s.id = i.sale_id
         where ${where.join(' and ')}
         group by i.product_id, i.name_snapshot, s.currency_code
         order by revenue desc, name asc
         limit 10`,
        values,
      ),
    ).rows;
    return rows.map((row) => ({
      productId: row.product_id,
      name: row.name,
      quantitySold: row.qty,
      currencyCode: row.currency_code,
      revenue: row.revenue,
    }));
  }

  // --- Financial ------------------------------------------------------------

  public async cashMovementTotals(
    companyId: string,
    branchIds: readonly string[],
    input: ReportScopeInput,
  ): Promise<CashMovementTotal[]> {
    const where: string[] = [];
    const values: unknown[] = [];
    appendBranchScope(where, values, companyId, branchIds, input.branchId);
    appendTimestampRange(where, values, 'occurred_at', input.dateFrom, input.dateTo, input.timezone);
    const rows = result<{ movement_type: string; currency_code: string; amount: string; cnt: string }>(
      await this.database.pool.query(
        `select movement_type, currency_code, coalesce(sum(amount),0)::text amount, count(*)::text cnt
         from cash_movements where ${where.join(' and ')}
         group by movement_type, currency_code`,
        values,
      ),
    ).rows;
    return rows.map((row) => ({
      movementType: row.movement_type,
      currencyCode: row.currency_code,
      amount: row.amount,
      count: Number(row.cnt),
    }));
  }

  // TASK 16.25 (Phase 7/Financiero) — real `payments.payment_method`
  // totals, `status='captured'` only — see `reports.types.ts`'s own doc
  // comment on `PaymentMethodTotal` for why this is deliberately NOT the
  // same query as `cashMovementTotals` above.
  public async paymentMethodTotals(
    companyId: string,
    branchIds: readonly string[],
    input: ReportScopeInput,
  ): Promise<PaymentMethodTotal[]> {
    const where: string[] = [];
    const values: unknown[] = [];
    appendBranchScope(where, values, companyId, branchIds, input.branchId);
    where.push(`status = 'captured'`);
    appendTimestampRange(where, values, 'captured_at', input.dateFrom, input.dateTo, input.timezone);
    const rows = result<{ payment_method: string; currency_code: string; amount: string; cnt: string }>(
      await this.database.pool.query(
        `select payment_method, currency_code, coalesce(sum(amount),0)::text amount, count(*)::text cnt
         from payments where ${where.join(' and ')}
         group by payment_method, currency_code`,
        values,
      ),
    ).rows;
    return rows.map((row) => ({
      paymentMethod: row.payment_method,
      currencyCode: row.currency_code,
      amount: row.amount,
      count: Number(row.cnt),
    }));
  }

  public async closedSessionTotals(
    companyId: string,
    branchIds: readonly string[],
    input: ReportScopeInput,
  ): Promise<ClosedSessionTotal[]> {
    const where: string[] = [];
    const values: unknown[] = [];
    appendBranchScope(where, values, companyId, branchIds, input.branchId);
    where.push(`status = 'closed'`);
    appendTimestampRange(where, values, 'closed_at', input.dateFrom, input.dateTo, input.timezone);
    const rows = result<{
      currency_code: string;
      session_count: string;
      declared: string;
      expected: string;
      discrepancy: string;
    }>(
      await this.database.pool.query(
        `select currency_code, count(*)::text session_count,
                coalesce(sum(declared_closing_amount),0)::text declared,
                coalesce(sum(expected_closing_amount),0)::text expected,
                coalesce(sum(discrepancy_amount),0)::text discrepancy
         from cash_sessions where ${where.join(' and ')}
         group by currency_code`,
        values,
      ),
    ).rows;
    return rows.map((row) => ({
      currencyCode: row.currency_code,
      sessionCount: Number(row.session_count),
      declaredClosingTotal: row.declared,
      expectedClosingTotal: row.expected,
      discrepancyTotal: row.discrepancy,
    }));
  }

  public async sessionsOpenedCount(
    companyId: string,
    branchIds: readonly string[],
    input: ReportScopeInput,
  ): Promise<number> {
    const where: string[] = [];
    const values: unknown[] = [];
    appendBranchScope(where, values, companyId, branchIds, input.branchId);
    appendTimestampRange(where, values, 'opened_at', input.dateFrom, input.dateTo, input.timezone);
    const row = result<{ cnt: string }>(
      await this.database.pool.query(
        `select count(*)::text cnt from cash_sessions where ${where.join(' and ')}`,
        values,
      ),
    ).rows[0];
    return row === undefined ? 0 : Number(row.cnt);
  }

  /** For the integration test's own direct proof: the exact fold
   * (`cashMovementDirection`) restricted to ONE session's movements, so it
   * can be compared bit-for-bit against that session's own persisted
   * `expected_closing_amount`. */
  public async cashMovementsForSession(
    companyId: string,
    cashSessionId: string,
  ): Promise<{ movementType: string; amount: string }[]> {
    const rows = result<{ movement_type: string; amount: string }>(
      await this.database.pool.query(
        `select movement_type, amount::text from cash_movements where company_id=$1 and cash_session_id=$2`,
        [companyId, cashSessionId],
      ),
    ).rows;
    return rows.map((row) => ({ movementType: row.movement_type, amount: row.amount }));
  }

  public async financialExportRows(
    companyId: string,
    branchIds: readonly string[],
    input: ReportScopeInput,
  ): Promise<FinancialExportRawRow[]> {
    const where: string[] = [];
    const values: unknown[] = [];
    appendBranchScope(where, values, companyId, branchIds, input.branchId);
    appendTimestampRange(where, values, 'occurred_at', input.dateFrom, input.dateTo, input.timezone);
    const rows = result<{
      id: string;
      branch_id: string;
      cash_session_id: string;
      movement_type: string;
      amount: string;
      currency_code: string;
      category: string | null;
      reason_code: string;
      occurred_at: Date | string;
    }>(
      await this.database.pool.query(
        `select id, branch_id, cash_session_id, movement_type, amount::text, currency_code, category, reason_code, occurred_at
         from cash_movements where ${where.join(' and ')}
         order by occurred_at asc, id asc`,
        values,
      ),
    ).rows;
    return rows.map((row) => ({
      id: row.id,
      branchId: row.branch_id,
      cashSessionId: row.cash_session_id,
      movementType: row.movement_type,
      amount: row.amount,
      currencyCode: row.currency_code,
      category: row.category,
      reasonCode: row.reason_code,
      occurredAt: new Date(row.occurred_at),
    }));
  }

  // --- Inventory ------------------------------------------------------------

  public async inventoryBalanceTotals(
    companyId: string,
    branchIds: readonly string[],
    branchId: string | undefined,
  ): Promise<{
    trackedVariantCount: number;
    quantityOnHandTotal: string;
    quantityReservedTotal: string;
    quantityInTransitTotal: string;
    outOfStockVariantCount: number;
  }> {
    const where: string[] = [];
    const values: unknown[] = [];
    appendBranchScope(where, values, companyId, branchIds, branchId);
    const row = result<{
      cnt: string;
      qoh: string;
      qres: string;
      qit: string;
      oos: string;
    }>(
      await this.database.pool.query(
        `select count(*)::text cnt,
                coalesce(sum(quantity_on_hand),0)::text qoh,
                coalesce(sum(quantity_reserved),0)::text qres,
                coalesce(sum(quantity_in_transit),0)::text qit,
                count(*) filter (where quantity_on_hand - quantity_reserved <= 0)::text oos
         from inventory_balances where ${where.join(' and ')}`,
        values,
      ),
    ).rows[0];
    return row === undefined
      ? {
          trackedVariantCount: 0,
          quantityOnHandTotal: '0.000000',
          quantityReservedTotal: '0.000000',
          quantityInTransitTotal: '0.000000',
          outOfStockVariantCount: 0,
        }
      : {
          trackedVariantCount: Number(row.cnt),
          quantityOnHandTotal: row.qoh,
          quantityReservedTotal: row.qres,
          quantityInTransitTotal: row.qit,
          outOfStockVariantCount: Number(row.oos),
        };
  }

  public async inventoryValueByCurrency(
    companyId: string,
    branchIds: readonly string[],
    branchId: string | undefined,
  ): Promise<CurrencyAmount[]> {
    const where: string[] = [];
    const values: unknown[] = [];
    appendBranchScope(where, values, companyId, branchIds, branchId);
    where.push('currency_code is not null');
    const rows = result<{ currency_code: string; value: string }>(
      await this.database.pool.query(
        `select currency_code, coalesce(sum(quantity_on_hand * average_unit_cost),0)::text value
         from inventory_balances where ${where.join(' and ')}
         group by currency_code`,
        values,
      ),
    ).rows;
    return rows.map((row) => ({ currencyCode: row.currency_code, amount: row.value }));
  }

  public async inventoryMovementVolume(
    companyId: string,
    branchIds: readonly string[],
    input: ReportScopeInput,
  ): Promise<InventoryMovementVolume[]> {
    const where: string[] = [];
    const values: unknown[] = [];
    values.push(companyId);
    where.push(`m.company_id = $${String(values.length)}`);
    values.push(branchIds);
    where.push(`m.branch_id = any($${String(values.length)}::uuid[])`);
    if (input.branchId !== undefined) {
      values.push(input.branchId);
      where.push(`m.branch_id = $${String(values.length)}`);
    }
    where.push(`m.status = 'posted'`);
    appendTimestampRange(where, values, 'm.posted_at', input.dateFrom, input.dateTo, input.timezone);
    const rows = result<{ movement_type: string; movement_count: string; total_base_qty: string }>(
      await this.database.pool.query(
        `select m.movement_type, count(distinct m.id)::text movement_count,
                coalesce(sum(l.base_quantity),0)::text total_base_qty
         from inventory_movements m
         join inventory_movement_lines l on l.company_id = m.company_id and l.inventory_movement_id = m.id
         where ${where.join(' and ')}
         group by m.movement_type`,
        values,
      ),
    ).rows;
    return rows.map((row) => ({
      movementType: row.movement_type,
      movementCount: Number(row.movement_count),
      totalBaseQuantity: row.total_base_qty,
    }));
  }

  // --- Customers ------------------------------------------------------------

  public async customersByStatus(companyId: string): Promise<StatusCount[]> {
    const where: string[] = [];
    const values: unknown[] = [];
    appendCompanyScope(where, values, companyId);
    const rows = result<{ status: string; cnt: string }>(
      await this.database.pool.query(
        `select status, count(*)::text cnt from customers where ${where.join(' and ')} group by status`,
        values,
      ),
    ).rows;
    return rows.map((row) => ({ status: row.status, count: Number(row.cnt) }));
  }

  public async newCustomersInRange(companyId: string, input: ReportDateRangeInput): Promise<number> {
    const where: string[] = [];
    const values: unknown[] = [];
    appendCompanyScope(where, values, companyId);
    appendTimestampRange(where, values, 'created_at', input.dateFrom, input.dateTo, input.timezone);
    const row = result<{ cnt: string }>(
      await this.database.pool.query(
        `select count(*)::text cnt from customers where ${where.join(' and ')}`,
        values,
      ),
    ).rows[0];
    return row === undefined ? 0 : Number(row.cnt);
  }

  public async membershipsByStatus(companyId: string): Promise<StatusCount[]> {
    const where: string[] = [];
    const values: unknown[] = [];
    appendCompanyScope(where, values, companyId);
    const rows = result<{ status: string; cnt: string }>(
      await this.database.pool.query(
        `select status, count(*)::text cnt from customer_memberships where ${where.join(' and ')} group by status`,
        values,
      ),
    ).rows;
    return rows.map((row) => ({ status: row.status, count: Number(row.cnt) }));
  }

  public async newMembershipsInRange(companyId: string, input: ReportDateRangeInput): Promise<number> {
    const where: string[] = [];
    const values: unknown[] = [];
    appendCompanyScope(where, values, companyId);
    appendTimestampRange(where, values, 'issued_at', input.dateFrom, input.dateTo, input.timezone);
    const row = result<{ cnt: string }>(
      await this.database.pool.query(
        `select count(*)::text cnt from customer_memberships where ${where.join(' and ')}`,
        values,
      ),
    ).rows[0];
    return row === undefined ? 0 : Number(row.cnt);
  }

  public async activeLoyaltyAccountCount(companyId: string): Promise<number> {
    const row = result<{ cnt: string }>(
      await this.database.pool.query(
        `select count(*)::text cnt from loyalty_accounts where company_id=$1 and status='active'`,
        [companyId],
      ),
    ).rows[0];
    return row === undefined ? 0 : Number(row.cnt);
  }

  // --- Employees ------------------------------------------------------------

  public async employeesByStatus(
    companyId: string,
    branchIds: readonly string[],
    branchId: string | undefined,
  ): Promise<StatusCount[]> {
    const where: string[] = [];
    const values: unknown[] = [];
    appendBranchScope(where, values, companyId, branchIds, branchId);
    const rows = result<{ status: string; cnt: string }>(
      await this.database.pool.query(
        `select status, count(*)::text cnt from employees where ${where.join(' and ')} group by status`,
        values,
      ),
    ).rows;
    return rows.map((row) => ({ status: row.status, count: Number(row.cnt) }));
  }

  public async punchTotals(
    companyId: string,
    branchIds: readonly string[],
    input: ReportScopeInput,
  ): Promise<{ punchType: string; count: number }[]> {
    const where: string[] = [];
    const values: unknown[] = [];
    appendBranchScope(where, values, companyId, branchIds, input.branchId);
    appendTimestampRange(where, values, 'occurred_at', input.dateFrom, input.dateTo, input.timezone);
    const rows = result<{ punch_type: string; cnt: string }>(
      await this.database.pool.query(
        `select punch_type, count(*)::text cnt from time_clock_punches where ${where.join(' and ')} group by punch_type`,
        values,
      ),
    ).rows;
    return rows.map((row) => ({ punchType: row.punch_type, count: Number(row.cnt) }));
  }

  public async distinctEmployeesPunched(
    companyId: string,
    branchIds: readonly string[],
    input: ReportScopeInput,
  ): Promise<number> {
    const where: string[] = [];
    const values: unknown[] = [];
    appendBranchScope(where, values, companyId, branchIds, input.branchId);
    appendTimestampRange(where, values, 'occurred_at', input.dateFrom, input.dateTo, input.timezone);
    const row = result<{ cnt: string }>(
      await this.database.pool.query(
        `select count(distinct employee_id)::text cnt from time_clock_punches where ${where.join(' and ')}`,
        values,
      ),
    ).rows[0];
    return row === undefined ? 0 : Number(row.cnt);
  }

  public async closedPayrollTotals(
    companyId: string,
    branchIds: readonly string[],
    input: ReportScopeInput,
  ): Promise<{ currencyCode: string; total: string; periodCount: number }[]> {
    const where: string[] = ['ppl.company_id = $1', 'pp.branch_id = any($2::uuid[])'];
    const values: unknown[] = [companyId, branchIds];
    if (input.branchId !== undefined) {
      values.push(input.branchId);
      where.push(`pp.branch_id = $${String(values.length)}`);
    }
    where.push(`pp.status = 'closed'`);
    values.push(input.dateFrom);
    where.push(`pp.period_end >= $${String(values.length)}::date`);
    values.push(input.dateTo);
    where.push(`pp.period_start <= $${String(values.length)}::date`);
    const rows = result<{ currency_code: string; total: string; period_count: string }>(
      await this.database.pool.query(
        `select ppl.currency_code, coalesce(sum(ppl.total_amount),0)::text total,
                count(distinct pp.id)::text period_count
         from payroll_period_lines ppl
         join payroll_periods pp on pp.company_id = ppl.company_id and pp.id = ppl.payroll_period_id
         where ${where.join(' and ')}
         group by ppl.currency_code`,
        values,
      ),
    ).rows;
    return rows.map((row) => ({
      currencyCode: row.currency_code,
      total: row.total,
      periodCount: Number(row.period_count),
    }));
  }

  // --- Parties ------------------------------------------------------------

  public async partyReservationsByStatus(
    companyId: string,
    branchIds: readonly string[],
    input: ReportScopeInput,
  ): Promise<StatusCount[]> {
    const where: string[] = [];
    const values: unknown[] = [];
    appendBranchScope(where, values, companyId, branchIds, input.branchId);
    appendDateColumnRange(where, values, 'event_date', input.dateFrom, input.dateTo);
    const rows = result<{ status: string; cnt: string }>(
      await this.database.pool.query(
        `select status, count(*)::text cnt from party_reservations where ${where.join(' and ')} group by status`,
        values,
      ),
    ).rows;
    return rows.map((row) => ({ status: row.status, count: Number(row.cnt) }));
  }

  public async partyBookedRevenue(
    companyId: string,
    branchIds: readonly string[],
    input: ReportScopeInput,
  ): Promise<CurrencyAmount[]> {
    const where: string[] = [];
    const values: unknown[] = [];
    appendBranchScope(where, values, companyId, branchIds, input.branchId);
    appendDateColumnRange(where, values, 'event_date', input.dateFrom, input.dateTo);
    where.push(`status <> 'cancelled'`);
    const rows = result<{ currency_code: string; total: string }>(
      await this.database.pool.query(
        `select currency_code, coalesce(sum(quoted_total),0)::text total
         from party_reservations where ${where.join(' and ')}
         group by currency_code`,
        values,
      ),
    ).rows;
    return rows.map((row) => ({ currencyCode: row.currency_code, amount: row.total }));
  }

  public async partyCollectedRevenue(
    companyId: string,
    branchIds: readonly string[],
    input: ReportScopeInput,
  ): Promise<CurrencyAmount[]> {
    const where: string[] = ['p.company_id = $1', 'p.branch_id = any($2::uuid[])'];
    const values: unknown[] = [companyId, branchIds];
    if (input.branchId !== undefined) {
      values.push(input.branchId);
      where.push(`p.branch_id = $${String(values.length)}`);
    }
    appendTimestampRange(where, values, 'p.created_at', input.dateFrom, input.dateTo, input.timezone);
    const rows = result<{ currency_code: string; total: string }>(
      await this.database.pool.query(
        `select r.currency_code, coalesce(sum(p.amount_snapshot),0)::text total
         from party_reservation_payments p
         join party_reservations r on r.company_id = p.company_id and r.id = p.reservation_id
         where ${where.join(' and ')}
         group by r.currency_code`,
        values,
      ),
    ).rows;
    return rows.map((row) => ({ currencyCode: row.currency_code, amount: row.total }));
  }

  public async activeRoomCount(companyId: string, branchIds: readonly string[], branchId: string | undefined): Promise<number> {
    const where: string[] = [];
    const values: unknown[] = [];
    appendBranchScope(where, values, companyId, branchIds, branchId);
    where.push(`status = 'active'`);
    const row = result<{ cnt: string }>(
      await this.database.pool.query(
        `select count(*)::text cnt from party_rooms where ${where.join(' and ')}`,
        values,
      ),
    ).rows[0];
    return row === undefined ? 0 : Number(row.cnt);
  }

  public async roomsBookedCount(companyId: string, branchIds: readonly string[], input: ReportScopeInput): Promise<number> {
    const where: string[] = [];
    const values: unknown[] = [];
    appendBranchScope(where, values, companyId, branchIds, input.branchId);
    appendDateColumnRange(where, values, 'event_date', input.dateFrom, input.dateTo);
    where.push(`status <> 'cancelled'`);
    const row = result<{ cnt: string }>(
      await this.database.pool.query(
        `select count(distinct room_id)::text cnt from party_reservations where ${where.join(' and ')}`,
        values,
      ),
    ).rows[0];
    return row === undefined ? 0 : Number(row.cnt);
  }

  // --- Promotions ------------------------------------------------------------

  /** `coupon_redemptions` carries its own `branch_id` — no join needed for
   * scoping — but NOT `currency_code`, so the amount total is grouped by
   * the redeeming sale's own currency (joined only for that column). */
  public async couponRedemptionTotals(
    companyId: string,
    branchIds: readonly string[],
    input: ReportScopeInput,
  ): Promise<{ currencyCode: string; total: string; count: number }[]> {
    const where: string[] = ['cr.company_id = $1', 'cr.branch_id = any($2::uuid[])'];
    const values: unknown[] = [companyId, branchIds];
    if (input.branchId !== undefined) {
      values.push(input.branchId);
      where.push(`cr.branch_id = $${String(values.length)}`);
    }
    appendTimestampRange(where, values, 'cr.redeemed_at', input.dateFrom, input.dateTo, input.timezone);
    const rows = result<{ currency_code: string; total: string; cnt: string }>(
      await this.database.pool.query(
        `select s.currency_code, coalesce(sum(cr.amount),0)::text total, count(*)::text cnt
         from coupon_redemptions cr
         join sales s on s.company_id = cr.company_id and s.id = cr.sale_id
         where ${where.join(' and ')}
         group by s.currency_code`,
        values,
      ),
    ).rows;
    return rows.map((row) => ({ currencyCode: row.currency_code, total: row.total, count: Number(row.cnt) }));
  }

  public async discountTotalsBySourceType(
    companyId: string,
    branchIds: readonly string[],
    input: ReportScopeInput,
  ): Promise<{ sourceType: string; currencyCode: string; total: string; count: number }[]> {
    const where: string[] = [
      'sd.company_id = $1',
      'sd.branch_id = any($2::uuid[])',
      `sd.source_type in ('promotion','coupon')`,
    ];
    const values: unknown[] = [companyId, branchIds];
    if (input.branchId !== undefined) {
      values.push(input.branchId);
      where.push(`sd.branch_id = $${String(values.length)}`);
    }
    appendTimestampRange(where, values, 'sd.created_at', input.dateFrom, input.dateTo, input.timezone);
    const rows = result<{ source_type: string; currency_code: string; total: string; cnt: string }>(
      await this.database.pool.query(
        `select sd.source_type, s.currency_code, coalesce(sum(sd.amount),0)::text total, count(*)::text cnt
         from sale_discounts sd
         join sales s on s.company_id = sd.company_id and s.id = sd.sale_id
         where ${where.join(' and ')}
         group by sd.source_type, s.currency_code`,
        values,
      ),
    ).rows;
    return rows.map((row) => ({
      sourceType: row.source_type,
      currencyCode: row.currency_code,
      total: row.total,
      count: Number(row.cnt),
    }));
  }

  public async topCoupons(
    companyId: string,
    branchIds: readonly string[],
    input: ReportScopeInput,
  ): Promise<{ couponId: string; code: string; redemptionCount: number }[]> {
    const where: string[] = ['cr.company_id = $1', 'cr.branch_id = any($2::uuid[])'];
    const values: unknown[] = [companyId, branchIds];
    if (input.branchId !== undefined) {
      values.push(input.branchId);
      where.push(`cr.branch_id = $${String(values.length)}`);
    }
    appendTimestampRange(where, values, 'cr.redeemed_at', input.dateFrom, input.dateTo, input.timezone);
    const rows = result<{ coupon_id: string; code: string; cnt: string }>(
      await this.database.pool.query(
        `select cr.coupon_id, c.code, count(*)::text cnt
         from coupon_redemptions cr
         join coupons c on c.company_id = cr.company_id and c.id = cr.coupon_id
         where ${where.join(' and ')}
         group by cr.coupon_id, c.code
         order by cnt desc, c.code asc
         limit 10`,
        values,
      ),
    ).rows;
    return rows.map((row) => ({ couponId: row.coupon_id, code: row.code, redemptionCount: Number(row.cnt) }));
  }

  // --- Inventory Kardex export ------------------------------------------------

  /** TASK 14.5 (Wave 3, Phase 7, Item 2) — real individual
   * `inventory_movement_lines` rows (the CSV-export exception to this
   * class's own "always aggregate in SQL" rule, exactly like
   * `salesExportRows`/`financialExportRows` above: an export's whole
   * purpose is the underlying detail). `product_variant_id` optionally
   * narrows to one variant's own Kardex — the classic "movement history
   * for this one product" legacy view. */
  public async kardexExportRows(
    companyId: string,
    branchIds: readonly string[],
    input: ReportScopeInput & { productVariantId?: string | undefined },
  ): Promise<KardexExportRow[]> {
    const where: string[] = ['m.company_id = $1', 'm.branch_id = any($2::uuid[])', `m.status = 'posted'`];
    const values: unknown[] = [companyId, branchIds];
    if (input.branchId !== undefined) {
      values.push(input.branchId);
      where.push(`m.branch_id = $${String(values.length)}`);
    }
    appendTimestampRange(where, values, 'm.posted_at', input.dateFrom, input.dateTo, input.timezone);
    if (input.productVariantId !== undefined) {
      values.push(input.productVariantId);
      where.push(`l.product_variant_id = $${String(values.length)}`);
    }
    const rows = result<{
      movement_id: string;
      movement_number: string;
      movement_type: string;
      branch_id: string;
      occurred_at: Date | string;
      posted_at: Date | string | null;
      reference_type: string | null;
      reference_id: string | null;
      movement_reason_code: string | null;
      line_number: number;
      product_variant_id: string;
      sku: string;
      product_name: string;
      quantity: string;
      unit_of_measure_code: string;
      base_quantity: string;
      unit_cost: string | null;
      extended_cost: string | null;
      currency_code: string | null;
      source_location_id: string | null;
      destination_location_id: string | null;
      line_reason_code: string | null;
    }>(
      await this.database.pool.query(
        `select m.id movement_id, m.movement_number, m.movement_type, m.branch_id,
                m.occurred_at, m.posted_at, m.reference_type, m.reference_id,
                m.reason_code movement_reason_code,
                l.line_number, l.product_variant_id, v.sku, p.name product_name,
                l.quantity::text quantity, l.unit_of_measure_code, l.base_quantity::text base_quantity,
                l.unit_cost::text unit_cost, l.extended_cost::text extended_cost, l.currency_code,
                l.source_location_id, l.destination_location_id, l.reason_code line_reason_code
         from inventory_movement_lines l
         join inventory_movements m on m.company_id = l.company_id and m.id = l.inventory_movement_id
         join product_variants v on v.company_id = l.company_id and v.id = l.product_variant_id
         join products p on p.company_id = v.company_id and p.id = v.product_id
         where ${where.join(' and ')}
         order by m.posted_at asc, m.id asc, l.line_number asc`,
        values,
      ),
    ).rows;
    return rows.map((row) => ({
      movementId: row.movement_id,
      movementNumber: row.movement_number,
      movementType: row.movement_type,
      branchId: row.branch_id,
      occurredAt: new Date(row.occurred_at),
      postedAt: row.posted_at === null ? null : new Date(row.posted_at),
      referenceType: row.reference_type,
      referenceId: row.reference_id,
      movementReasonCode: row.movement_reason_code,
      lineNumber: row.line_number,
      productVariantId: row.product_variant_id,
      sku: row.sku,
      productName: row.product_name,
      quantity: row.quantity,
      unitOfMeasureCode: row.unit_of_measure_code,
      baseQuantity: row.base_quantity,
      unitCost: row.unit_cost,
      extendedCost: row.extended_cost,
      currencyCode: row.currency_code,
      sourceLocationId: row.source_location_id,
      destinationLocationId: row.destination_location_id,
      lineReasonCode: row.line_reason_code,
    }));
  }

  // --- Access ------------------------------------------------------------

  public async accessEventTotals(
    companyId: string,
    branchIds: readonly string[],
    input: ReportScopeInput,
  ): Promise<{ eventType: string; count: number }[]> {
    const where: string[] = [];
    const values: unknown[] = [];
    appendBranchScope(where, values, companyId, branchIds, input.branchId);
    appendTimestampRange(where, values, 'occurred_at', input.dateFrom, input.dateTo, input.timezone);
    const rows = result<{ event_type: string; cnt: string }>(
      await this.database.pool.query(
        `select event_type, count(*)::text cnt from access_events where ${where.join(' and ')} group by event_type`,
        values,
      ),
    ).rows;
    return rows.map((row) => ({ eventType: row.event_type, count: Number(row.cnt) }));
  }

  public async currentOccupancy(companyId: string, branchIds: readonly string[], branchId: string | undefined): Promise<number> {
    const where: string[] = [];
    const values: unknown[] = [];
    appendBranchScope(where, values, companyId, branchIds, branchId);
    where.push(`currently_inside = 'true'`);
    const row = result<{ cnt: string }>(
      await this.database.pool.query(
        `select count(*)::text cnt from access_credentials where ${where.join(' and ')}`,
        values,
      ),
    ).rows[0];
    return row === undefined ? 0 : Number(row.cnt);
  }

  // TASK 16.25 (Phase 12/Accesos) — real average minutes between an
  // entry and its own credential's NEXT exit, restricted to entries that
  // occurred in range AND genuinely have a later exit recorded (a
  // `LATERAL` join finds, per entry row, the single nearest following
  // exit for that same credential — the standard, correct SQL shape for
  // "pair each entry with its own next exit," never a naive self-join
  // that could cross-pair unrelated entries/exits). `null` when zero
  // pairs completed — see `reports.types.ts`'s own doc comment on
  // `AccessReport.averageStayMinutes`.
  public async averageStayMinutes(
    companyId: string,
    branchIds: readonly string[],
    input: ReportScopeInput,
  ): Promise<number | null> {
    const where: string[] = ['e.company_id = $1', 'e.branch_id = any($2::uuid[])', `e.event_type = 'entry'`];
    const values: unknown[] = [companyId, branchIds];
    if (input.branchId !== undefined) {
      values.push(input.branchId);
      where.push(`e.branch_id = $${String(values.length)}`);
    }
    appendTimestampRange(where, values, 'e.occurred_at', input.dateFrom, input.dateTo, input.timezone);
    const row = result<{ avg_minutes: string | null }>(
      await this.database.pool.query(
        `select avg(extract(epoch from (x.exit_at - e.occurred_at)) / 60)::text avg_minutes
         from access_events e
         cross join lateral (
           select min(occurred_at) exit_at from access_events x
           where x.company_id = e.company_id and x.credential_id = e.credential_id
             and x.event_type = 'exit' and x.occurred_at > e.occurred_at
         ) x
         where ${where.join(' and ')} and x.exit_at is not null`,
        values,
      ),
    ).rows[0];
    const avgMinutes = row?.avg_minutes ?? null;
    return avgMinutes === null ? null : Number(avgMinutes);
  }
}

export interface ReportDateRangeInput {
  readonly dateFrom: string;
  readonly dateTo: string;
  readonly timezone: string;
}
