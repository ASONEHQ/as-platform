import { Gauge, Histogram, type Registry } from 'prom-client';

export interface OperationalMetrics {
  readonly checkDuration: Histogram<'check'>;
  readonly checkStatus: Gauge<'check' | 'status'>;
  readonly outboxPending: Gauge;
  readonly outboxOldest: Gauge;
  readonly inventoryFindings: Gauge<'severity' | 'status'>;
  readonly expiredLocks: Gauge;
  readonly poolInUse: Gauge;
  readonly poolWaiting: Gauge;
  readonly shadowDuration: Histogram;
  readonly shadowMismatches: Gauge;
}

export function createOperationalMetrics(registry: Registry): OperationalMetrics {
  const common = { registers: [registry] };
  return Object.freeze({
    checkDuration: new Histogram({
      ...common,
      name: 'asone_operational_check_duration_seconds',
      help: 'Operational check duration.',
      labelNames: ['check'] as const,
    }),
    checkStatus: new Gauge({
      ...common,
      name: 'asone_operational_check_status',
      help: 'Operational check status as one-hot value.',
      labelNames: ['check', 'status'] as const,
    }),
    outboxPending: new Gauge({
      ...common,
      name: 'asone_outbox_pending_total',
      help: 'Pending outbox events.',
    }),
    outboxOldest: new Gauge({
      ...common,
      name: 'asone_outbox_oldest_pending_seconds',
      help: 'Age of oldest pending outbox event.',
    }),
    inventoryFindings: new Gauge({
      ...common,
      name: 'asone_inventory_reconciliation_findings_total',
      help: 'Inventory findings by bounded status and severity.',
      labelNames: ['severity', 'status'] as const,
    }),
    expiredLocks: new Gauge({
      ...common,
      name: 'asone_inventory_count_expired_locks_total',
      help: 'Expired durable inventory count locks.',
    }),
    poolInUse: new Gauge({
      ...common,
      name: 'asone_postgres_pool_in_use',
      help: 'PostgreSQL connections in use.',
    }),
    poolWaiting: new Gauge({
      ...common,
      name: 'asone_postgres_pool_waiting',
      help: 'PostgreSQL clients waiting.',
    }),
    shadowDuration: new Histogram({
      ...common,
      name: 'asone_shadow_rebuild_duration_seconds',
      help: 'Shadow rebuild comparison duration.',
    }),
    shadowMismatches: new Gauge({
      ...common,
      name: 'asone_shadow_rebuild_mismatches_total',
      help: 'Shadow rebuild mismatches.',
    }),
  });
}
