import type { DatabaseClient } from '@asone/database';

export interface OutboxDiagnostics {
  readonly pending: number;
  readonly failed: number;
  readonly oldestPendingSeconds: number;
  readonly publishedLastHour: number;
  readonly byEventType: Readonly<Record<string, number>>;
  readonly byCompany: Readonly<Record<string, number>>;
}

export interface InventoryDiagnostics {
  readonly openCriticalFindings: number;
  readonly openWarningFindings: number;
  readonly acknowledgedFindings: number;
  readonly expiredCountLocks: number;
  readonly activeCounts: number;
  readonly shippedTransfers: number;
  readonly expiredActiveReservations: number;
}

function count(value: string | number | null | undefined): number {
  return Number(value ?? 0);
}

export class OperationalChecksRepository {
  public constructor(private readonly database: DatabaseClient) {}

  public async databaseClock(): Promise<Date> {
    const result = await this.database.pool.query<{ clock: Date }>(
      'select clock_timestamp() clock',
    );
    return result.rows[0]?.clock ?? new Date(0);
  }

  public async migrationState(): Promise<{
    readonly applied: number;
    readonly latest: string | null;
  }> {
    const result = await this.database.pool.query<{ applied: string; latest: string | null }>(
      `select count(*)::text applied,max(hash) latest from drizzle.__drizzle_migrations`,
    );
    return { applied: count(result.rows[0]?.applied), latest: result.rows[0]?.latest ?? null };
  }

  public poolState(): { readonly total: number; readonly idle: number; readonly waiting: number } {
    return {
      total: this.database.pool.totalCount,
      idle: this.database.pool.idleCount,
      waiting: this.database.pool.waitingCount,
    };
  }

  public async outbox(): Promise<OutboxDiagnostics> {
    const [summary, types, companies] = await Promise.all([
      this.database.pool.query<{
        pending: string;
        failed: string;
        oldest: string;
        published_last_hour: string;
      }>(
        `select count(*) filter(where published_at is null)::text pending,
          count(*) filter(where published_at is null and last_error is not null)::text failed,
          count(*) filter(where published_at>=clock_timestamp()-interval '1 hour')::text published_last_hour,
          coalesce(extract(epoch from clock_timestamp()-min(available_at) filter(where published_at is null)),0)::text oldest
         from outbox_events`,
      ),
      this.database.pool.query<{ key: string; value: string }>(
        `select event_type key,count(*)::text value from outbox_events where published_at is null group by event_type order by event_type`,
      ),
      this.database.pool.query<{ key: string; value: string }>(
        `select company_id::text key,count(*)::text value from outbox_events where published_at is null group by company_id order by company_id`,
      ),
    ]);
    return {
      pending: count(summary.rows[0]?.pending),
      failed: count(summary.rows[0]?.failed),
      oldestPendingSeconds: Math.max(0, count(summary.rows[0]?.oldest)),
      publishedLastHour: count(summary.rows[0]?.published_last_hour),
      byEventType: Object.fromEntries(types.rows.map((row) => [row.key, count(row.value)])),
      byCompany: Object.fromEntries(companies.rows.map((row) => [row.key, count(row.value)])),
    };
  }

  public async idempotency(): Promise<{ readonly incomplete: number; readonly expired: number }> {
    const result = await this.database.pool.query<{ incomplete: string; expired: string }>(
      `select count(*) filter(where completed_at is null)::text incomplete,
       count(*) filter(where expires_at<=clock_timestamp())::text expired from idempotency_keys`,
    );
    return {
      incomplete: count(result.rows[0]?.incomplete),
      expired: count(result.rows[0]?.expired),
    };
  }

  public async inventory(companyId?: string): Promise<InventoryDiagnostics> {
    const result = await this.database.pool.query<Record<string, string>>(
      `select
       (select count(*) from inventory_reconciliation_findings where status='open' and severity='critical' and ($1::uuid is null or company_id=$1))::text critical,
       (select count(*) from inventory_reconciliation_findings where status='open' and severity='warning' and ($1::uuid is null or company_id=$1))::text warning,
       (select count(*) from inventory_reconciliation_findings where status='acknowledged' and ($1::uuid is null or company_id=$1))::text acknowledged,
       (select count(*) from inventory_counts where status in ('counting','submitted') and lock_expires_at<clock_timestamp() and ($1::uuid is null or company_id=$1))::text expired_locks,
       (select count(*) from inventory_counts where status in ('draft','counting','submitted','approved') and ($1::uuid is null or company_id=$1))::text active_counts,
       (select count(*) from inventory_transfers where status in ('shipped','partially_received') and ($1::uuid is null or company_id=$1))::text shipped,
       (select count(*) from inventory_reservations where status='active' and expires_at<clock_timestamp() and ($1::uuid is null or company_id=$1))::text expired_reservations`,
      [companyId ?? null],
    );
    const row = result.rows[0] ?? {};
    return {
      openCriticalFindings: count(row.critical),
      openWarningFindings: count(row.warning),
      acknowledgedFindings: count(row.acknowledged),
      expiredCountLocks: count(row.expired_locks),
      activeCounts: count(row.active_counts),
      shippedTransfers: count(row.shipped),
      expiredActiveReservations: count(row.expired_reservations),
    };
  }
}
