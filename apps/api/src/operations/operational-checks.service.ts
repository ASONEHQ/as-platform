import type { Logger } from 'pino';

import type { InfrastructureDependencies } from '../infrastructure/dependencies.js';
import { OperationalChecksRepository } from './operational-checks.repository.js';
import type { OperationalMetrics } from './operational-metrics.js';
import {
  aggregateStatus,
  type OperationalCheck,
  type OperationalReport,
  type OperationalStatus,
  type OperationalThresholds,
} from './operational-checks.types.js';

function sanitize(error: unknown): string {
  return error instanceof Error ? error.name : 'DependencyError';
}

export async function withTimeout<T>(operation: Promise<T>, milliseconds: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      operation,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => {
          reject(new Error('Operational check timed out.'));
        }, milliseconds);
        timer.unref();
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

export class OperationalChecksService {
  public constructor(
    private readonly repository: OperationalChecksRepository,
    private readonly infrastructure: InfrastructureDependencies,
    private readonly thresholds: OperationalThresholds,
    private readonly logger?: Logger,
    private readonly metrics?: OperationalMetrics,
  ) {}

  private async check(
    name: string,
    critical: boolean,
    operation: () =>
      | Promise<{
          status?: OperationalStatus;
          message: string;
          metadata?: OperationalCheck['metadata'];
          remediationHint?: string;
        }>
      | {
          status?: OperationalStatus;
          message: string;
          metadata?: OperationalCheck['metadata'];
          remediationHint?: string;
        },
  ): Promise<OperationalCheck> {
    const started = performance.now();
    const checkedAt = new Date().toISOString();
    try {
      const result = await withTimeout(
        Promise.resolve(operation()),
        this.thresholds.checkTimeoutMs,
      );
      const check: OperationalCheck = Object.freeze({
        name,
        status: result.status ?? 'healthy',
        checked_at: checkedAt,
        duration_ms: Math.round(performance.now() - started),
        message: result.message,
        metadata: result.metadata ?? {},
        ...(result.remediationHint === undefined
          ? {}
          : { remediation_hint: result.remediationHint }),
        critical,
      });
      this.logger?.info(
        {
          operation: 'operational_check',
          check_name: name,
          duration: check.duration_ms,
          status: check.status,
          counts: check.metadata,
        },
        'operational check completed',
      );
      this.metrics?.checkDuration.observe({ check: name }, check.duration_ms / 1_000);
      for (const status of ['healthy', 'degraded', 'unhealthy', 'unknown'] as const) {
        this.metrics?.checkStatus.set({ check: name, status }, check.status === status ? 1 : 0);
      }
      return check;
    } catch (error) {
      const check: OperationalCheck = Object.freeze({
        name,
        status: critical ? 'unhealthy' : 'unknown',
        checked_at: checkedAt,
        duration_ms: Math.round(performance.now() - started),
        message: `Check unavailable (${sanitize(error)}).`,
        metadata: {},
        remediation_hint: 'Inspect the dependency through the approved runbook.',
        critical,
      });
      this.logger?.warn(
        {
          operation: 'operational_check',
          check_name: name,
          duration: check.duration_ms,
          status: check.status,
        },
        'operational check unavailable',
      );
      return check;
    }
  }

  public async run(): Promise<OperationalReport> {
    const checks = await Promise.all([
      this.check('postgres.connectivity', true, async () => {
        const clock = await this.repository.databaseClock();
        const drift = Math.abs(Date.now() - clock.getTime()) / 1_000;
        return {
          status: drift > 5 ? 'degraded' : 'healthy',
          message: 'PostgreSQL responded.',
          metadata: { clock_drift_seconds: Math.round(drift) },
        };
      }),
      this.check('postgres.migrations', true, async () => {
        const state = await this.repository.migrationState();
        return {
          status: state.applied >= 9 ? 'healthy' : 'unhealthy',
          message: 'Migration journal inspected.',
          metadata: { applied: state.applied, latest_present: state.latest !== null },
        };
      }),
      this.check('postgres.pool', true, () => {
        const pool = this.repository.poolState();
        const denominator = Math.max(1, pool.total + pool.waiting);
        const saturation = Math.round(
          ((pool.total - pool.idle + pool.waiting) / denominator) * 100,
        );
        const status =
          saturation >= this.thresholds.poolCriticalPercent
            ? 'unhealthy'
            : saturation >= this.thresholds.poolWarningPercent
              ? 'degraded'
              : 'healthy';
        return {
          status,
          message: 'PostgreSQL pool inspected.',
          metadata: {
            total: pool.total,
            idle: pool.idle,
            waiting: pool.waiting,
            saturation_percent: saturation,
          },
        };
      }),
      this.check('redis.connectivity', true, async () => {
        const state = await this.infrastructure.checkReadiness();
        return {
          status: state.redis === 'available' ? 'healthy' : 'unhealthy',
          message: state.redis === 'available' ? 'Redis responded.' : 'Redis unavailable.',
        };
      }),
      this.check('outbox.backlog', false, async () => {
        const value = await this.repository.outbox();
        const status =
          value.oldestPendingSeconds >= this.thresholds.outboxCriticalAgeSeconds || value.failed > 0
            ? 'unhealthy'
            : value.oldestPendingSeconds >= this.thresholds.outboxWarningAgeSeconds
              ? 'degraded'
              : 'healthy';
        return {
          status,
          message: 'Outbox inspected without consuming events.',
          metadata: {
            pending: value.pending,
            failed: value.failed,
            oldest_pending_seconds: Math.round(value.oldestPendingSeconds),
          },
        };
      }),
      this.check('idempotency.store', false, async () => {
        const value = await this.repository.idempotency();
        return {
          status: value.incomplete > 0 ? 'degraded' : 'healthy',
          message: 'Idempotency store inspected.',
          metadata: value,
        };
      }),
      this.check('inventory.operations', false, async () => {
        const value = await this.repository.inventory();
        const status =
          value.openCriticalFindings > 0
            ? 'unhealthy'
            : value.expiredCountLocks > 0 || value.expiredActiveReservations > 0
              ? 'degraded'
              : 'healthy';
        return {
          status,
          message: 'Inventory operational state inspected read-only.',
          metadata: { ...value },
        };
      }),
      Promise.resolve<OperationalCheck>({
        name: 'rabbitmq.connectivity',
        status: 'unknown',
        checked_at: new Date().toISOString(),
        duration_ms: 0,
        message: 'RabbitMQ is not configured.',
        metadata: { configured: false },
        critical: false,
      }),
      Promise.resolve<OperationalCheck>({
        name: 'object_storage.connectivity',
        status: 'unknown',
        checked_at: new Date().toISOString(),
        duration_ms: 0,
        message: 'Object storage client is not configured.',
        metadata: { configured: false },
        critical: false,
      }),
    ]);
    const status = aggregateStatus(checks);
    return Object.freeze({
      status,
      ready: !checks.some((check) => check.critical && check.status === 'unhealthy'),
      checked_at: new Date().toISOString(),
      checks: Object.freeze(checks),
    });
  }
}

export function createOperationalChecksService(input: {
  infrastructure: InfrastructureDependencies;
  thresholds: OperationalThresholds;
  logger?: Logger;
  metrics?: OperationalMetrics;
}): OperationalChecksService {
  if (input.infrastructure.database === undefined)
    throw new Error('Operational checks require PostgreSQL.');
  return new OperationalChecksService(
    new OperationalChecksRepository(input.infrastructure.database),
    input.infrastructure,
    input.thresholds,
    input.logger,
    input.metrics,
  );
}
