import { randomUUID } from 'node:crypto';

import type { DatabaseClient } from '@asone/database';

import {
  InventoryReconciliationRepository,
  type ReconciliationSqlClient,
} from './inventory-reconciliation.repository.js';
import type { ReconciliationCandidate } from './inventory-reconciliation.types.js';
import type {
  FindingListInput,
  FindingPage,
  RepairCommandContext,
  RepairFinding,
} from './inventory-repair.types.js';

interface QueryResult<T> {
  readonly rows: readonly T[];
  readonly rowCount: number | null;
}
interface FindingRow {
  readonly id: string;
  readonly company_id: string;
  readonly branch_id: string | null;
  readonly inventory_location_id: string | null;
  readonly product_variant_id: string | null;
  readonly aggregate_type: string;
  readonly aggregate_id: string;
  readonly finding_type: string;
  readonly severity: string;
  readonly status: RepairFinding['status'];
  readonly fingerprint_sha256: string;
  readonly detector_version: string;
  readonly snapshot_at: Date | string;
  readonly first_detected_at: Date | string;
  readonly last_detected_at: Date | string;
  readonly occurrence_count: string;
  readonly expected_summary: Readonly<Record<string, unknown>>;
  readonly actual_summary: Readonly<Record<string, unknown>>;
  readonly evidence: Readonly<Record<string, unknown>>;
  readonly acknowledged_at: Date | string | null;
  readonly acknowledged_by: string | null;
  readonly resolved_at: Date | string | null;
  readonly resolved_by: string | null;
  readonly dismissed_at: Date | string | null;
  readonly dismissed_by: string | null;
  readonly resolution_reason_code: string | null;
  readonly resolution_note: string | null;
  readonly version: string;
}
interface IdempotencyRow {
  readonly request_hash: string;
  readonly response_body: Readonly<Record<string, unknown>> | null;
}
interface LockedBalance {
  readonly id: string;
  readonly quantity_on_hand: string;
  readonly quantity_reserved: string;
  readonly quantity_in_transit: string;
  readonly average_unit_cost: string;
  readonly currency_code: string | null;
  readonly last_movement_id: string | null;
  readonly version: string;
}

const FINDING_COLUMNS = `id,company_id,branch_id,inventory_location_id,product_variant_id,
 aggregate_type,aggregate_id,finding_type,severity,status,fingerprint_sha256,detector_version,
 snapshot_at,first_detected_at,last_detected_at,occurrence_count::text,expected_summary,
 actual_summary,evidence,acknowledged_at,acknowledged_by,resolved_at,resolved_by,
 dismissed_at,dismissed_by,resolution_reason_code,resolution_note,version::text`;

function result<T>(value: unknown): QueryResult<T> {
  return value as QueryResult<T>;
}
function date(value: Date | string | null): Date | null {
  return value === null ? null : new Date(value);
}
function finding(row: FindingRow): RepairFinding {
  return {
    id: row.id,
    companyId: row.company_id,
    branchId: row.branch_id,
    inventoryLocationId: row.inventory_location_id,
    productVariantId: row.product_variant_id,
    aggregateType: row.aggregate_type,
    aggregateId: row.aggregate_id,
    findingType: row.finding_type,
    severity: row.severity,
    status: row.status,
    fingerprint: row.fingerprint_sha256,
    detectorVersion: row.detector_version,
    snapshotAt: new Date(row.snapshot_at),
    firstDetectedAt: new Date(row.first_detected_at),
    lastDetectedAt: new Date(row.last_detected_at),
    occurrenceCount: BigInt(row.occurrence_count),
    expectedSummary: row.expected_summary,
    actualSummary: row.actual_summary,
    evidence: row.evidence,
    acknowledgedAt: date(row.acknowledged_at),
    acknowledgedBy: row.acknowledged_by,
    resolvedAt: date(row.resolved_at),
    resolvedBy: row.resolved_by,
    dismissedAt: date(row.dismissed_at),
    dismissedBy: row.dismissed_by,
    resolutionReasonCode: row.resolution_reason_code,
    resolutionNote: row.resolution_note,
    version: BigInt(row.version),
  };
}

export class InventoryRepairRepository {
  private readonly detector: InventoryReconciliationRepository;

  public constructor(private readonly database: DatabaseClient) {
    this.detector = new InventoryReconciliationRepository(database);
  }

  public async transaction<T>(
    callback: (client: ReconciliationSqlClient) => Promise<T>,
  ): Promise<T> {
    const client = await this.database.pool.connect();
    try {
      await client.query('begin');
      const value = await callback(client);
      await client.query('commit');
      return value;
    } catch (error) {
      await client.query('rollback');
      throw error;
    } finally {
      client.release();
    }
  }

  public async list(
    companyId: string,
    branchIds: readonly string[],
    input: FindingListInput,
    cursor: { lastDetectedAt: Date; id: string } | null,
  ): Promise<FindingPage> {
    const values: unknown[] = [companyId, branchIds];
    const where = ['company_id=$1', '(branch_id is null or branch_id=any($2::uuid[]))'];
    const filters: readonly [string, unknown][] = [
      ['status', input.status],
      ['severity', input.severity],
      ['finding_type', input.findingType],
      ['branch_id', input.branchId],
      ['inventory_location_id', input.inventoryLocationId],
      ['product_variant_id', input.productVariantId],
      ['aggregate_type', input.aggregateType],
      ['aggregate_id', input.aggregateId],
    ];
    for (const [column, value] of filters)
      if (value !== undefined) {
        values.push(value);
        where.push(`${column}=$${String(values.length)}`);
      }
    if (input.detectedFrom !== undefined) {
      values.push(input.detectedFrom);
      where.push(`last_detected_at>=$${String(values.length)}`);
    }
    if (input.detectedTo !== undefined) {
      values.push(input.detectedTo);
      where.push(`last_detected_at<=$${String(values.length)}`);
    }
    if (cursor !== null) {
      values.push(cursor.lastDetectedAt, cursor.id);
      where.push(`(last_detected_at,id)<($${String(values.length - 1)},$${String(values.length)})`);
    }
    values.push(input.limit + 1);
    const rows = result<FindingRow>(
      await this.database.pool.query(
        `select ${FINDING_COLUMNS} from inventory_reconciliation_findings
         where ${where.join(' and ')} order by last_detected_at desc,id desc
         limit $${String(values.length)}`,
        values,
      ),
    ).rows;
    const page = rows.slice(0, input.limit).map(finding);
    return {
      items: page,
      nextCursor: rows.length > input.limit ? (page.at(-1)?.id ?? null) : null,
    };
  }

  public async find(
    companyId: string,
    branchIds: readonly string[],
    id: string,
  ): Promise<RepairFinding | null> {
    const row = result<FindingRow>(
      await this.database.pool.query(
        `select ${FINDING_COLUMNS} from inventory_reconciliation_findings
         where company_id=$1 and id=$2 and (branch_id is null or branch_id=any($3::uuid[]))`,
        [companyId, id, branchIds],
      ),
    ).rows[0];
    return row === undefined ? null : finding(row);
  }

  public async lock(
    client: ReconciliationSqlClient,
    companyId: string,
    branchIds: readonly string[],
    id: string,
  ): Promise<RepairFinding | null> {
    const row = result<FindingRow>(
      await client.query(
        `select ${FINDING_COLUMNS} from inventory_reconciliation_findings
         where company_id=$1 and id=$2 and (branch_id is null or branch_id=any($3::uuid[])) for update`,
        [companyId, id, branchIds],
      ),
    ).rows[0];
    return row === undefined ? null : finding(row);
  }

  public async candidates(
    client: ReconciliationSqlClient,
    value: RepairFinding,
    timestamp: Date,
  ): Promise<readonly ReconciliationCandidate[]> {
    const primary = await this.detector.readCandidateChunkInTransaction(client, {
      companyId: value.companyId,
      scope: {
        ...(value.branchId === null ? {} : { branchId: value.branchId }),
        ...(value.inventoryLocationId === null
          ? {}
          : { inventoryLocationId: value.inventoryLocationId }),
        ...(value.productVariantId === null ? {} : { productVariantId: value.productVariantId }),
        aggregateType: value.aggregateType,
        aggregateId: value.aggregateId,
      },
      snapshotAt: timestamp,
      cursor: null,
      limit: 100,
    });
    const workflows = await this.detector.readCandidateChunkInTransaction(client, {
      companyId: value.companyId,
      scope: { ...(value.branchId === null ? {} : { branchId: value.branchId }) },
      snapshotAt: timestamp,
      cursor: null,
      limit: 1000,
    });
    return [
      ...primary.items,
      ...workflows.items.filter(
        (item) =>
          !primary.items.some((candidate) => candidate.sortKey === item.sortKey) &&
          [
            'invalid_posted_movement',
            'invalid_reversal_relationship',
            'transfer_movement_mismatch',
            'reservation_movement_mismatch',
            'count_application_mismatch',
          ].includes(item.findingType),
      ),
    ];
  }

  public async idempotent<T extends object>(
    client: ReconciliationSqlClient,
    context: RepairCommandContext,
    operation: string,
    findingId: string,
    key: string,
    requestHash: string,
    execute: () => Promise<T>,
  ): Promise<{ value: T; replayed: boolean }> {
    const scopedOperation = `${operation}:${findingId}`;
    await client.query('select pg_advisory_xact_lock(hashtextextended($1,0))', [
      `${context.companyId}:${scopedOperation}:${key}`,
    ]);
    const prior = result<IdempotencyRow>(
      await client.query(
        `select request_hash,response_body from idempotency_keys
         where company_id=$1 and operation=$2 and key=$3`,
        [context.companyId, scopedOperation, key],
      ),
    ).rows[0];
    if (prior !== undefined) {
      if (prior.request_hash !== requestHash || prior.response_body === null)
        throw new Error('IDEMPOTENCY_CONFLICT');
      return { value: prior.response_body as T, replayed: true };
    }
    const id = randomUUID();
    await client.query(
      `insert into idempotency_keys(id,company_id,key,operation,request_hash,expires_at,created_at)
       values($1,$2,$3,$4,$5,$6,$7)`,
      [
        id,
        context.companyId,
        key,
        scopedOperation,
        requestHash,
        new Date(context.timestamp.getTime() + 86_400_000),
        context.timestamp,
      ],
    );
    const value = await execute();
    await client.query(
      `update idempotency_keys set response_status=200,response_body=$2::jsonb,
       resource_type='inventory_reconciliation_finding',resource_id=$3,completed_at=$4 where id=$1`,
      [id, JSON.stringify(value), findingId, context.timestamp],
    );
    return { value, replayed: false };
  }

  public async transition(
    client: ReconciliationSqlClient,
    context: RepairCommandContext,
    value: RepairFinding,
    status: 'acknowledged' | 'dismissed' | 'resolved',
    reasonCode: string,
    note: string | null,
  ): Promise<RepairFinding> {
    const columns =
      status === 'acknowledged'
        ? `status='acknowledged',acknowledged_at=$3,acknowledged_by=$2`
        : status === 'dismissed'
          ? `status='dismissed',dismissed_at=$3,dismissed_by=$2,resolution_reason_code=$4,resolution_note=$5`
          : `status='resolved',resolved_at=$3,resolved_by=$2,resolution_reason_code=$4,resolution_note=$5`;
    const values =
      status === 'acknowledged'
        ? [context.companyId, context.actorId, context.timestamp, value.id]
        : [context.companyId, context.actorId, context.timestamp, reasonCode, note, value.id];
    const findingParameter = status === 'acknowledged' ? '$4' : '$6';
    const row = result<FindingRow>(
      await client.query(
        `update inventory_reconciliation_findings set ${columns},updated_at=$3,version=version+1
         where company_id=$1 and id=${findingParameter} returning ${FINDING_COLUMNS}`,
        values,
      ),
    ).rows[0];
    if (row === undefined) throw new Error('Finding transition returned no row.');
    return finding(row);
  }

  public async lockBalance(
    client: ReconciliationSqlClient,
    value: RepairFinding,
  ): Promise<LockedBalance | null> {
    if (
      value.branchId === null ||
      value.inventoryLocationId === null ||
      value.productVariantId === null
    )
      return null;
    return (
      result<LockedBalance>(
        await client.query(
          `select id,quantity_on_hand::text,quantity_reserved::text,quantity_in_transit::text,
         average_unit_cost::text,currency_code,last_movement_id,version::text
         from inventory_balances where company_id=$1 and branch_id=$2
          and inventory_location_id=$3 and product_variant_id=$4 for update`,
          [value.companyId, value.branchId, value.inventoryLocationId, value.productVariantId],
        ),
      ).rows[0] ?? null
    );
  }

  public async updateBalance(
    client: ReconciliationSqlClient,
    id: string,
    input: {
      onHand?: string;
      reserved?: string;
      inTransit?: string;
      lastMovementId?: string | null;
      timestamp: Date;
    },
  ): Promise<{ id: string; version: bigint }> {
    const row = result<{ id: string; version: string }>(
      await client.query(
        `update inventory_balances set quantity_on_hand=coalesce($2,quantity_on_hand),
         quantity_reserved=coalesce($3,quantity_reserved),quantity_in_transit=coalesce($4,quantity_in_transit),
         last_movement_id=case when $5::boolean then $6::uuid else last_movement_id end,
         version=version+1,updated_at=$7 where id=$1 returning id,version::text`,
        [
          id,
          input.onHand ?? null,
          input.reserved ?? null,
          input.inTransit ?? null,
          input.lastMovementId !== undefined,
          input.lastMovementId ?? null,
          input.timestamp,
        ],
      ),
    ).rows[0];
    if (row === undefined) throw new Error('Balance update returned no row.');
    return { id: row.id, version: BigInt(row.version) };
  }

  public async createBalance(
    client: ReconciliationSqlClient,
    value: RepairFinding,
    quantities: {
      onHand: string;
      reserved: string;
      inTransit: string;
      lastMovementId: string | null;
    },
    timestamp: Date,
  ): Promise<{ id: string; version: bigint }> {
    if (
      value.branchId === null ||
      value.inventoryLocationId === null ||
      value.productVariantId === null
    )
      throw new Error('Finding has no balance scope.');
    const row = result<{ id: string; version: string }>(
      await client.query(
        `insert into inventory_balances
         (id,company_id,branch_id,inventory_location_id,product_variant_id,quantity_on_hand,
          quantity_reserved,quantity_in_transit,average_unit_cost,currency_code,last_movement_id,
          version,created_at,updated_at)
         values($1,$2,$3,$4,$5,$6,$7,$8,0,null,$9,1,$10,$10)
         on conflict(company_id,inventory_location_id,product_variant_id) do nothing
         returning id,version::text`,
        [
          randomUUID(),
          value.companyId,
          value.branchId,
          value.inventoryLocationId,
          value.productVariantId,
          quantities.onHand,
          quantities.reserved,
          quantities.inTransit,
          quantities.lastMovementId,
          timestamp,
        ],
      ),
    ).rows[0];
    if (row === undefined) throw new Error('BALANCE_CONFLICT');
    return { id: row.id, version: BigInt(row.version) };
  }

  public audit(
    client: ReconciliationSqlClient,
    context: RepairCommandContext,
    findingValue: RepairFinding,
    action: string,
    metadata: Readonly<Record<string, unknown>>,
  ): Promise<unknown> {
    return client.query(
      `insert into audit_log(id,company_id,branch_id,actor_type,actor_id,action,entity_type,
       entity_id,request_id,correlation_id,metadata,occurred_at)
       values($1,$2,$3,'user',$4,$5,'inventory_reconciliation_finding',$6,$7,$8,$9::jsonb,$10)`,
      [
        randomUUID(),
        context.companyId,
        findingValue.branchId,
        context.actorId,
        action,
        findingValue.id,
        context.requestId,
        context.correlationId,
        JSON.stringify(metadata),
        context.timestamp,
      ],
    );
  }

  public outbox(
    client: ReconciliationSqlClient,
    context: RepairCommandContext,
    findingValue: RepairFinding,
    balance: { id: string; version: bigint },
    payload: Readonly<Record<string, unknown>>,
  ): Promise<unknown> {
    return client.query(
      `insert into outbox_events(event_id,company_id,branch_id,event_type,schema_version,
       aggregate_type,aggregate_id,aggregate_version,correlation_id,payload,occurred_at,available_at,created_at)
       values($1,$2,$3,'inventory.stock.changed',1,'inventory_balance',$4,$5,$6,$7::jsonb,$8,$8,$8)`,
      [
        randomUUID(),
        context.companyId,
        findingValue.branchId,
        balance.id,
        balance.version.toString(),
        context.correlationId,
        JSON.stringify(payload),
        context.timestamp,
      ],
    );
  }
}
