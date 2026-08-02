import {
  DEFAULT_OPERATIONAL_THRESHOLDS,
  type OperationalThresholds,
} from './operational-checks.types.js';

type Environment = Readonly<Record<string, string | undefined>>;

function integer(
  value: string | undefined,
  fallback: number,
  minimum: number,
  maximum: number,
): number {
  if (value === undefined) return fallback;
  if (!/^\d+$/.test(value)) throw new Error('Operational threshold must be an integer.');
  const parsed = Number(value);
  if (parsed < minimum || parsed > maximum)
    throw new Error('Operational threshold is out of range.');
  return parsed;
}

export function loadOperationalThresholds(
  environment: Environment = process.env,
): OperationalThresholds {
  const warningAge = integer(environment.OPS_OUTBOX_WARNING_AGE_SECONDS, 60, 1, 86_400);
  const criticalAge = integer(environment.OPS_OUTBOX_CRITICAL_AGE_SECONDS, 300, 2, 604_800);
  const poolWarning = integer(environment.OPS_DB_POOL_WARNING_PERCENT, 80, 1, 99);
  const poolCritical = integer(environment.OPS_DB_POOL_CRITICAL_PERCENT, 100, 2, 100);
  if (criticalAge <= warningAge || poolCritical <= poolWarning) {
    throw new Error('Operational critical thresholds must exceed warning thresholds.');
  }
  const allowlist = (environment.OPS_RESTORE_ALLOWED_DATABASES ?? 'asone_restore_test')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
  if (allowlist.length === 0 || allowlist.some((name) => !/^asone_[a-z0-9_]+_test$/.test(name))) {
    throw new Error('Restore database allowlist contains an unsafe name.');
  }
  return Object.freeze({
    ...DEFAULT_OPERATIONAL_THRESHOLDS,
    checkTimeoutMs: integer(environment.OPS_CHECK_TIMEOUT_MS, 2_000, 100, 30_000),
    outboxWarningAgeSeconds: warningAge,
    outboxCriticalAgeSeconds: criticalAge,
    poolWarningPercent: poolWarning,
    poolCriticalPercent: poolCritical,
    shadowRebuildChunkSize: integer(environment.OPS_SHADOW_REBUILD_CHUNK_SIZE, 250, 1, 1_000),
    restoreAllowedDatabases: Object.freeze(allowlist),
  });
}
