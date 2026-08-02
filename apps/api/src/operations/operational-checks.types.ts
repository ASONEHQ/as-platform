export type OperationalStatus = 'healthy' | 'degraded' | 'unhealthy' | 'unknown';

export interface OperationalCheck {
  readonly name: string;
  readonly status: OperationalStatus;
  readonly checked_at: string;
  readonly duration_ms: number;
  readonly message: string;
  readonly metadata: Readonly<Record<string, string | number | boolean | null>>;
  readonly remediation_hint?: string;
  readonly critical: boolean;
}

export interface OperationalReport {
  readonly status: OperationalStatus;
  readonly ready: boolean;
  readonly checked_at: string;
  readonly checks: readonly OperationalCheck[];
}

export interface OperationalThresholds {
  readonly checkTimeoutMs: number;
  readonly outboxWarningAgeSeconds: number;
  readonly outboxCriticalAgeSeconds: number;
  readonly poolWarningPercent: number;
  readonly poolCriticalPercent: number;
  readonly shadowRebuildChunkSize: number;
  readonly restoreAllowedDatabases: readonly string[];
}

export const DEFAULT_OPERATIONAL_THRESHOLDS: OperationalThresholds = Object.freeze({
  checkTimeoutMs: 2_000,
  outboxWarningAgeSeconds: 60,
  outboxCriticalAgeSeconds: 300,
  poolWarningPercent: 80,
  poolCriticalPercent: 100,
  shadowRebuildChunkSize: 250,
  restoreAllowedDatabases: Object.freeze(['asone_restore_test']),
});

export function aggregateStatus(checks: readonly OperationalCheck[]): OperationalStatus {
  if (checks.some((check) => check.status === 'unhealthy')) return 'unhealthy';
  if (checks.some((check) => check.status === 'degraded')) return 'degraded';
  if (checks.some((check) => check.status === 'unknown')) return 'unknown';
  return 'healthy';
}
