import type { DatabaseClient } from '@asone/database';

/** Raw per-currency totals — `dashboard.service.ts` does the actual
 * fixed-point subtraction (quoted - paid), mirroring
 * `reports.service.ts`'s own `salesTotals`/`refundsTotals` →
 * `subtractByCurrency` split: this repository never does money
 * arithmetic itself, only real SQL `sum`. */
export interface PartyOutstandingTotals {
  readonly currencyCode: string;
  readonly quotedTotal: string;
  readonly paidTotal: string;
}

/**
 * The two aggregate queries this module owns because no existing endpoint
 * already exposes them. Both use real SQL `sum`/`group by`/`distinct on`
 * — never an unbounded fetch-and-reduce in Node — mirroring
 * `reports.repository.ts`'s own established convention exactly.
 */

interface QueryResult<T> {
  rows: T[];
}
function result<T>(value: unknown): QueryResult<T> {
  return value as QueryResult<T>;
}

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

/** A real customer whose `birth_date` month/day matches the requested
 * date — see `dashboard.service.ts`'s own doc comment. */
export interface DashboardBirthdayCustomerRow {
  readonly id: string;
  readonly displayName: string;
}

export class DashboardRepository {
  public constructor(private readonly database: DatabaseClient) {}

  /** Sum of (quoted_total - payments) per currency, for reservations that
   * are not yet cancelled/completed (`held`/`pending_deposit`/
   * `confirmed`), company-wide across every branch `branchIds` permits —
   * NOT restricted to `branchId` even when one is given, because an
   * outstanding balance is a standing financial exposure figure a manager
   * needs to see in full regardless of which single branch they're
   * currently viewing (documented in `dashboard.service.ts`). Real SQL
   * `sum`/`group by`, a `left join` against a pre-aggregated payments
   * subquery — never fetched row-by-row and reduced in Node. */
  public async outstandingPartyBalances(companyId: string, branchIds: readonly string[]): Promise<PartyOutstandingTotals[]> {
    const rows = result<{ currency_code: string; quoted_total: string; paid_total: string }>(
      await this.database.pool.query(
        `select r.currency_code,
                coalesce(sum(r.quoted_total),0)::text quoted_total,
                coalesce(sum(p.paid),0)::text paid_total
         from party_reservations r
         left join (
           select reservation_id, sum(amount_snapshot) paid
           from party_reservation_payments
           group by reservation_id
         ) p on p.reservation_id = r.id
         where r.company_id = $1 and r.branch_id = any($2::uuid[]) and r.status in ('held','pending_deposit','confirmed')
         group by r.currency_code`,
        [companyId, branchIds],
      ),
    ).rows;
    return rows.map((row) => ({
      currencyCode: row.currency_code,
      quotedTotal: row.quoted_total,
      paidTotal: row.paid_total,
    }));
  }

  /** TASK 16.19 (Phase 30 "Event KPIs") — the additional party/event
   * figures Phase 30 explicitly asks for that `partyReservationCount`/
   * `outstandingPartyBalances` didn't yet cover: how many reservations
   * are upcoming (beyond today), today's status breakdown, today's event
   * revenue and deposits actually collected today, and today's
   * completed/cancelled counts. Scoped exactly like `partyReservationCount`
   * itself (`appendBranchScope` — company + permitted branches + optional
   * single branch), never company-wide-only like `outstandingPartyBalances`
   * (which is deliberately a standing-exposure figure, not a per-day one —
   * see that method's own doc comment). Four small, real SQL aggregates —
   * never an unbounded fetch-and-reduce in Node. */
  public async partyKpis(
    companyId: string,
    branchIds: readonly string[],
    branchId: string | undefined,
    date: string,
  ): Promise<{
    upcomingReservationCount: number;
    statusBreakdown: Readonly<Record<string, number>>;
    eventRevenueToday: { currencyCode: string; amount: string }[];
    depositsCollectedToday: { currencyCode: string; amount: string }[];
    completedTodayCount: number;
    cancelledTodayCount: number;
  }> {
    const upcomingWhere: string[] = [];
    const upcomingValues: unknown[] = [];
    appendBranchScope(upcomingWhere, upcomingValues, companyId, branchIds, branchId);
    upcomingValues.push(date);
    upcomingWhere.push(`event_date > $${String(upcomingValues.length)}`, `status <> 'cancelled'`);
    const upcomingRow = result<{ count: string }>(
      await this.database.pool.query(
        `select count(*)::text as count from party_reservations where ${upcomingWhere.join(' and ')}`,
        upcomingValues,
      ),
    ).rows[0];

    const todayWhere: string[] = [];
    const todayValues: unknown[] = [];
    appendBranchScope(todayWhere, todayValues, companyId, branchIds, branchId);
    todayValues.push(date);
    todayWhere.push(`event_date = $${String(todayValues.length)}`);

    const statusRows = result<{ status: string; count: string }>(
      await this.database.pool.query(
        `select status, count(*)::text as count from party_reservations where ${todayWhere.join(' and ')} group by status`,
        todayValues,
      ),
    ).rows;
    const statusBreakdown: Record<string, number> = {};
    for (const row of statusRows) statusBreakdown[row.status] = Number(row.count);

    const revenueRows = result<{ currency_code: string; amount: string }>(
      await this.database.pool.query(
        `select currency_code, coalesce(sum(quoted_total),0)::text as amount
         from party_reservations where ${todayWhere.join(' and ')} and status <> 'cancelled'
         group by currency_code`,
        todayValues,
      ),
    ).rows;

    // Deposits are attributed to the day they were actually COLLECTED
    // (`party_reservation_payments.created_at`), not the reservation's
    // own `event_date` — a deposit taken today for an event next month
    // is real cash received today. `party_reservation_payments` already
    // carries its own `branch_id` (no join needed for branch scoping).
    const depositWhere: string[] = [];
    const depositValues: unknown[] = [];
    depositValues.push(companyId);
    depositWhere.push(`p.company_id = $${String(depositValues.length)}`);
    depositValues.push(branchIds);
    depositWhere.push(`p.branch_id = any($${String(depositValues.length)}::uuid[])`);
    if (branchId !== undefined) {
      depositValues.push(branchId);
      depositWhere.push(`p.branch_id = $${String(depositValues.length)}`);
    }
    depositValues.push(date);
    depositWhere.push(`p.purpose = 'deposit'`, `(p.created_at at time zone 'UTC')::date = $${String(depositValues.length)}`);
    const depositRows = result<{ currency_code: string; amount: string }>(
      await this.database.pool.query(
        `select r.currency_code, coalesce(sum(p.amount_snapshot),0)::text as amount
         from party_reservation_payments p
         join party_reservations r on r.company_id = p.company_id and r.id = p.reservation_id
         where ${depositWhere.join(' and ')}
         group by r.currency_code`,
        depositValues,
      ),
    ).rows;

    return {
      upcomingReservationCount: Number(upcomingRow?.count ?? '0'),
      statusBreakdown,
      eventRevenueToday: revenueRows.map((row) => ({ currencyCode: row.currency_code, amount: row.amount })),
      depositsCollectedToday: depositRows.map((row) => ({ currencyCode: row.currency_code, amount: row.amount })),
      completedTodayCount: statusBreakdown['completed'] ?? 0,
      cancelledTodayCount: statusBreakdown['cancelled'] ?? 0,
    };
  }

  /** Employees whose most recent punch ON `date` is `clock_in` — i.e. no
   * later `clock_out` the same day. A real, computed "currently on shift"
   * figure (never a fabricated headcount): `distinct on (employee_id)`
   * picks each employee's single latest punch for the day, ordered by
   * `occurred_at desc`, then counts how many of those latest punches are
   * themselves a `clock_in`. Scoped like every other branch-scoped table
   * in this codebase (`appendBranchScope`). */
  public async clockedInEmployeeCount(
    companyId: string,
    branchIds: readonly string[],
    branchId: string | undefined,
    date: string,
  ): Promise<number> {
    const where: string[] = [];
    const values: unknown[] = [];
    appendBranchScope(where, values, companyId, branchIds, branchId);
    values.push(date);
    where.push(`occurred_at >= $${String(values.length)}::date`);
    values.push(date);
    where.push(`occurred_at < ($${String(values.length)}::date + interval '1 day')`);
    const rows = result<{ cnt: string }>(
      await this.database.pool.query(
        `select count(*)::text cnt from (
           select distinct on (employee_id) employee_id, punch_type
           from time_clock_punches
           where ${where.join(' and ')}
           order by employee_id, occurred_at desc
         ) latest
         where punch_type = 'clock_in'`,
        values,
      ),
    ).rows;
    return Number(rows[0]?.cnt ?? '0');
  }

  /** Real customers whose `birth_date` month/day matches `date`'s
   * month/day — TASK 14.5A, `generarAlertas()`'s exact
   * `parseInt(p[1],10)===hoyMM&&parseInt(p[2],10)===hoyDD` rule (legacy
   * `AS POS V1.html` lines 10965-10969), ported to a real SQL
   * `extract(month/day from birth_date)` comparison — never
   * fetched-and-filtered in Node. Company-scoped ONLY, never branch-scoped
   * — `customers.ts`'s own header comment: "Every entity here is
   * COMPANY-scoped, never branch-scoped as its identity boundary" — the
   * exact same structural reason `outstandingPartyBalances` above is
   * company-wide too. `birth_date is not null` excludes every customer
   * with no birth date on file (never a false match on a null column). */
  public async birthdaysOn(companyId: string, date: string): Promise<DashboardBirthdayCustomerRow[]> {
    const rows = result<{ id: string; display_name: string }>(
      await this.database.pool.query(
        `select id, display_name from customers
         where company_id = $1
           and birth_date is not null
           and extract(month from birth_date) = extract(month from $2::date)
           and extract(day from birth_date) = extract(day from $2::date)
         order by display_name`,
        [companyId, date],
      ),
    ).rows;
    return rows.map((row) => ({ id: row.id, displayName: row.display_name }));
  }
}
