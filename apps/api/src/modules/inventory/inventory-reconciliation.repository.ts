import { randomUUID } from 'node:crypto';

import type { DatabaseClient } from '@asone/database';

import type {
  FindingPersistenceResult,
  ReconciliationCandidate,
  ReconciliationFindingEvidence,
  ReconciliationScope,
} from './inventory-reconciliation.types.js';

interface QueryResult<T> {
  readonly rows: readonly T[];
  readonly rowCount: number | null;
}

interface CandidateRow {
  readonly sort_key: string;
  readonly finding_type: ReconciliationCandidate['findingType'];
  readonly severity: ReconciliationCandidate['severity'];
  readonly branch_id: string | null;
  readonly inventory_location_id: string | null;
  readonly product_variant_id: string | null;
  readonly aggregate_type: string;
  readonly aggregate_id: string;
  readonly expected_summary: Readonly<Record<string, unknown>>;
  readonly actual_summary: Readonly<Record<string, unknown>>;
  readonly evidence: Readonly<Record<string, unknown>>;
}

interface ChunkInput {
  readonly companyId: string;
  readonly scope: ReconciliationScope;
  readonly snapshotAt: Date;
  readonly cursor: string | null;
  readonly limit: number;
}

interface PersistInput {
  readonly companyId: string;
  readonly finding: ReconciliationFindingEvidence;
  readonly detectorVersion: string;
  readonly correlationId: string;
  readonly snapshotAt: Date;
}

const CANDIDATE_SQL = `with movement_effects as (
  select m.company_id,m.branch_id,v.location_id,l.product_variant_id,
         case when v.direction='source' then -l.base_quantity else l.base_quantity end delta,
         m.id movement_id,m.posted_at
  from inventory_movements m join inventory_movement_lines l
    on l.company_id=m.company_id and l.inventory_movement_id=m.id
  cross join lateral (values ('source',l.source_location_id),('destination',l.destination_location_id)) v(direction,location_id)
  where m.company_id=$1 and m.status in ('posted','reversed') and m.posted_at <= $6
    and v.location_id is not null
), on_hand as (
  select company_id,branch_id,location_id,product_variant_id,sum(delta)::text quantity
  from movement_effects group by company_id,branch_id,location_id,product_variant_id
), latest as (
  select distinct on (company_id,branch_id,location_id,product_variant_id)
         company_id,branch_id,location_id,product_variant_id,movement_id
  from movement_effects
  order by company_id,branch_id,location_id,product_variant_id,posted_at desc,movement_id desc
), reserved as (
  select r.company_id,l.branch_id,l.inventory_location_id location_id,l.product_variant_id,
         sum(l.reserved_quantity-l.consumed_quantity-l.released_quantity)::text quantity
  from inventory_reservations r join inventory_reservation_lines l
    on l.company_id=r.company_id and l.inventory_reservation_id=r.id
  where r.company_id=$1 and r.status='active' and r.updated_at <= $6
  group by r.company_id,l.branch_id,l.inventory_location_id,l.product_variant_id
), transit as (
  select t.company_id,t.destination_branch_id branch_id,t.transit_location_id location_id,
         l.product_variant_id,sum(l.shipped_quantity)::text quantity
  from inventory_transfers t join inventory_transfer_lines l
    on l.company_id=t.company_id and l.inventory_transfer_id=t.id
  where t.company_id=$1 and t.status='shipped' and t.updated_at <= $6
  group by t.company_id,t.destination_branch_id,t.transit_location_id,l.product_variant_id
), balance_keys as (
  select company_id,branch_id,inventory_location_id location_id,product_variant_id from inventory_balances where company_id=$1
  union select company_id,branch_id,location_id,product_variant_id from on_hand
  union select company_id,branch_id,location_id,product_variant_id from reserved
  union select company_id,branch_id,location_id,product_variant_id from transit
), projection as (
  select k.*,b.id balance_id,coalesce(b.quantity_on_hand,0)::text actual_on_hand,
         coalesce(b.quantity_reserved,0)::text actual_reserved,coalesce(b.quantity_in_transit,0)::text actual_transit,
         coalesce(o.quantity,'0.000000') expected_on_hand,coalesce(r.quantity,'0.000000') expected_reserved,
         coalesce(t.quantity,'0.000000') expected_transit,b.last_movement_id,l.movement_id expected_last
  from balance_keys k left join inventory_balances b
    on b.company_id=k.company_id and b.branch_id=k.branch_id and b.inventory_location_id=k.location_id and b.product_variant_id=k.product_variant_id
  left join on_hand o on o.company_id=k.company_id and o.branch_id=k.branch_id and o.location_id=k.location_id and o.product_variant_id=k.product_variant_id
  left join reserved r on r.company_id=k.company_id and r.branch_id=k.branch_id and r.location_id=k.location_id and r.product_variant_id=k.product_variant_id
  left join transit t on t.company_id=k.company_id and t.branch_id=k.branch_id and t.location_id=k.location_id and t.product_variant_id=k.product_variant_id
  left join latest l on l.company_id=k.company_id and l.branch_id=k.branch_id and l.location_id=k.location_id and l.product_variant_id=k.product_variant_id
), candidates as (
  select finding_type,severity,branch_id,location_id inventory_location_id,product_variant_id,
         'inventory_balance'::text aggregate_type,coalesce(balance_id::text,location_id::text||':'||product_variant_id::text) aggregate_id,
         expected_summary,actual_summary,evidence
  from projection p cross join lateral (
    values
      ('missing_balance','critical',jsonb_build_object('exists',true),jsonb_build_object('exists',false),jsonb_build_object('balanceKey',p.location_id::text||':'||p.product_variant_id::text),p.balance_id is null and (p.expected_on_hand::numeric<>0 or p.expected_reserved::numeric<>0 or p.expected_transit::numeric<>0)),
      ('orphan_balance','info',jsonb_build_object('activity',false),jsonb_build_object('exists',true),jsonb_build_object('balanceId',p.balance_id),p.balance_id is not null and p.actual_on_hand::numeric=0 and p.actual_reserved::numeric=0 and p.actual_transit::numeric=0 and p.expected_on_hand::numeric=0 and p.expected_reserved::numeric=0 and p.expected_transit::numeric=0 and p.expected_last is null),
      ('balance_on_hand_drift','critical',jsonb_build_object('quantity',p.expected_on_hand),jsonb_build_object('quantity',p.actual_on_hand),jsonb_build_object('balanceId',p.balance_id),p.balance_id is not null and p.expected_on_hand::numeric<>p.actual_on_hand::numeric),
      ('balance_reserved_drift','critical',jsonb_build_object('quantity',p.expected_reserved),jsonb_build_object('quantity',p.actual_reserved),jsonb_build_object('balanceId',p.balance_id),p.balance_id is not null and p.expected_reserved::numeric<>p.actual_reserved::numeric),
      ('balance_in_transit_drift','critical',jsonb_build_object('quantity',p.expected_transit),jsonb_build_object('quantity',p.actual_transit),jsonb_build_object('balanceId',p.balance_id),p.balance_id is not null and p.expected_transit::numeric<>p.actual_transit::numeric),
      ('last_movement_mismatch','warning',jsonb_build_object('movementId',p.expected_last),jsonb_build_object('movementId',p.last_movement_id),jsonb_build_object('balanceId',p.balance_id),p.balance_id is not null and p.expected_last is distinct from p.last_movement_id)
  ) f(finding_type,severity,expected_summary,actual_summary,evidence,applies) where f.applies
  union all
  select 'invalid_posted_movement','critical',m.branch_id,null,null,'inventory_movement',m.id::text,
         jsonb_build_object('minimumLines',1),jsonb_build_object('lineCount',count(l.id)),jsonb_build_object('movementId',m.id)
  from inventory_movements m left join inventory_movement_lines l on l.company_id=m.company_id and l.inventory_movement_id=m.id
  where m.company_id=$1 and m.status in ('posted','reversed') and m.posted_at <= $6
  group by m.company_id,m.branch_id,m.id having count(l.id)=0
  union all
  select 'invalid_reversal_relationship','critical',m.branch_id,null,null,'inventory_movement',m.id::text,
         jsonb_build_object('relationship','reciprocal'),jsonb_build_object('reversalOf',m.reversal_of_movement_id,'reversedBy',m.reversed_by_movement_id),jsonb_build_object('movementId',m.id)
  from inventory_movements m left join inventory_movements peer
    on peer.company_id=m.company_id and peer.id=coalesce(m.reversal_of_movement_id,m.reversed_by_movement_id)
  where m.company_id=$1 and (m.reversal_of_movement_id is not null or m.reversed_by_movement_id is not null)
    and (peer.id is null or (m.reversal_of_movement_id is not null and peer.reversed_by_movement_id is distinct from m.id)
      or (m.reversed_by_movement_id is not null and peer.reversal_of_movement_id is distinct from m.id))
  union all
  select 'transfer_movement_mismatch','critical',t.destination_branch_id,t.transit_location_id,null,'inventory_transfer',t.id::text,
         jsonb_build_object('status',t.status),jsonb_build_object('shipmentMovementId',t.shipment_movement_id,'receiptMovementId',t.receipt_movement_id),jsonb_build_object('transferId',t.id)
  from inventory_transfers t left join inventory_movements sm on sm.company_id=t.company_id and sm.id=t.shipment_movement_id
  left join inventory_movements rm on rm.company_id=t.company_id and rm.id=t.receipt_movement_id
  where t.company_id=$1 and ((t.status='shipped' and (sm.id is null or sm.movement_type<>'transfer_shipment' or sm.status<>'posted'
      or sm.reference_type<>'inventory_transfer' or sm.reference_id<>t.id))
    or (t.status='received' and (sm.id is null or rm.id is null or sm.movement_type<>'transfer_shipment' or rm.movement_type<>'transfer_receipt'
      or sm.status<>'posted' or rm.status<>'posted' or sm.reference_type<>'inventory_transfer' or rm.reference_type<>'inventory_transfer'
      or sm.reference_id<>t.id or rm.reference_id<>t.id))
    or (t.status in ('shipped','received') and exists (
      select 1 from inventory_transfer_lines tl where tl.company_id=t.company_id and tl.inventory_transfer_id=t.id
      and (tl.shipped_quantity is distinct from coalesce((select sum(ml.base_quantity) from inventory_movement_lines ml
        where ml.company_id=t.company_id and ml.inventory_movement_id=t.shipment_movement_id and ml.product_variant_id=tl.product_variant_id),0)
      or (t.status='received' and tl.received_quantity is distinct from coalesce((select sum(ml.base_quantity) from inventory_movement_lines ml
        where ml.company_id=t.company_id and ml.inventory_movement_id=t.receipt_movement_id and ml.product_variant_id=tl.product_variant_id),0)))
    )))
  union all
  select 'reservation_movement_mismatch','critical',r.branch_id,null,null,'inventory_reservation',r.id::text,
         jsonb_build_object('status',r.status),jsonb_build_object('issueMovementCount',count(m.id)),jsonb_build_object('reservationId',r.id)
  from inventory_reservations r left join inventory_movements m
    on m.company_id=r.company_id and m.reference_type='inventory_reservation' and m.reference_id=r.id and m.movement_type='issue' and m.status='posted'
  where r.company_id=$1 group by r.company_id,r.branch_id,r.id,r.status
  having (r.status='confirmed' and count(m.id)<>1) or (r.status='active' and count(m.id)<>0)
    or (r.status in ('confirmed','released','expired','cancelled') and exists (
      select 1 from inventory_reservation_lines rl where rl.company_id=r.company_id and rl.inventory_reservation_id=r.id
      and rl.reserved_quantity-rl.consumed_quantity-rl.released_quantity<>0
    ))
  union all
  select 'count_application_mismatch','critical',c.branch_id,c.inventory_location_id,null,'inventory_count',c.id::text,
         jsonb_build_object('status',c.status),jsonb_build_object('applicationMovementId',c.application_movement_id),jsonb_build_object('countId',c.id)
  from inventory_counts c left join inventory_movements m on m.company_id=c.company_id and m.id=c.application_movement_id
  where c.company_id=$1 and c.status='applied' and (
    (exists (select 1 from inventory_count_lines l where l.company_id=c.company_id and l.inventory_count_id=c.id
      and l.counted_quantity is distinct from l.expected_quantity) and m.id is null)
    or (m.id is not null and (m.movement_type<>'adjustment' or m.status<>'posted' or m.reference_type<>'inventory_count' or m.reference_id<>c.id))
    or (select count(*) from inventory_movements cm where cm.company_id=c.company_id and cm.reference_type='inventory_count'
      and cm.reference_id=c.id and cm.status in ('posted','reversed'))>1
  )
), filtered as (
  select *,finding_type||'|'||aggregate_type||'|'||aggregate_id||'|'||coalesce(inventory_location_id::text,'')||'|'||coalesce(product_variant_id::text,'') sort_key
  from candidates where ($2::uuid is null or branch_id=$2) and ($3::uuid is null or inventory_location_id=$3)
    and ($4::uuid is null or product_variant_id=$4) and ($7::text is null or aggregate_type=$7)
    and ($8::text is null or aggregate_id=$8)
)
select * from filtered where ($5::text is null or sort_key>$5) order by sort_key limit $9`;

function result<T>(value: unknown): QueryResult<T> {
  return value as QueryResult<T>;
}

export class InventoryReconciliationRepository {
  public constructor(private readonly database: DatabaseClient) {}

  public async readCandidateChunk(input: ChunkInput): Promise<{
    readonly items: readonly ReconciliationCandidate[];
    readonly nextCursor: string | null;
    readonly checkedCount: number;
  }> {
    const connection = await this.database.pool.connect();
    try {
      await connection.query('begin isolation level repeatable read read only');
      const rows = result<CandidateRow>(
        await connection.query(CANDIDATE_SQL, [
          input.companyId,
          input.scope.branchId ?? null,
          input.scope.inventoryLocationId ?? null,
          input.scope.productVariantId ?? null,
          input.cursor,
          input.snapshotAt,
          input.scope.aggregateType ?? null,
          input.scope.aggregateId ?? null,
          input.limit + 1,
        ]),
      ).rows;
      await connection.query('commit');
      const page = rows.slice(0, input.limit);
      return {
        items: page.map((row) => ({
          sortKey: row.sort_key,
          findingType: row.finding_type,
          severity: row.severity,
          branchId: row.branch_id,
          inventoryLocationId: row.inventory_location_id,
          productVariantId: row.product_variant_id,
          aggregateType: row.aggregate_type,
          aggregateId: row.aggregate_id,
          expectedSummary: row.expected_summary,
          actualSummary: row.actual_summary,
          evidence: row.evidence,
        })),
        nextCursor: rows.length > input.limit ? (page.at(-1)?.sort_key ?? null) : null,
        checkedCount: page.length,
      };
    } catch (error) {
      await connection.query('rollback');
      throw error;
    } finally {
      connection.release();
    }
  }

  public async persistFinding(input: PersistInput): Promise<FindingPersistenceResult> {
    const row = result<{ created: boolean }>(
      await this.database.pool.query(
        `insert into inventory_reconciliation_findings
         (id,company_id,branch_id,inventory_location_id,product_variant_id,aggregate_type,aggregate_id,
          finding_type,severity,status,identity_key,fingerprint_sha256,detector_version,correlation_id,
          snapshot_at,first_detected_at,last_detected_at,occurrence_count,expected_summary,actual_summary,evidence,version)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,'open',$10,$11,$12,$13,$14,$14,$14,1,$15,$16,$17,1)
         on conflict (company_id,identity_key) where status in ('open','acknowledged') do update set
          severity=excluded.severity,fingerprint_sha256=excluded.fingerprint_sha256,
          correlation_id=excluded.correlation_id,snapshot_at=excluded.snapshot_at,
          last_detected_at=excluded.last_detected_at,occurrence_count=inventory_reconciliation_findings.occurrence_count+1,
          expected_summary=excluded.expected_summary,actual_summary=excluded.actual_summary,
          evidence=excluded.evidence,updated_at=now(),version=inventory_reconciliation_findings.version+1
         returning (xmax=0) created`,
        [
          randomUUID(),
          input.companyId,
          input.finding.branchId,
          input.finding.inventoryLocationId,
          input.finding.productVariantId,
          input.finding.aggregateType,
          input.finding.aggregateId,
          input.finding.findingType,
          input.finding.severity,
          input.finding.identityKey,
          input.finding.fingerprintSha256,
          input.detectorVersion,
          input.correlationId,
          input.snapshotAt,
          input.finding.expectedSummary,
          input.finding.actualSummary,
          input.finding.evidence,
        ],
      ),
    ).rows[0];
    return { created: row?.created ?? false, changed: !(row?.created ?? false) };
  }

  public async resolveMissing(input: {
    readonly companyId: string;
    readonly scope: ReconciliationScope;
    readonly detectorVersion: string;
    readonly observedIdentityKeys: readonly string[];
    readonly actorId: string;
    readonly snapshotAt: Date;
  }): Promise<number> {
    const resolved = result<{ id: string }>(
      await this.database.pool.query(
        `update inventory_reconciliation_findings set status='resolved',resolved_at=$7,resolved_by=$6,
          resolution_reason_code='not_observed_in_complete_scan',updated_at=now(),version=version+1
         where company_id=$1 and detector_version=$2 and status in ('open','acknowledged')
          and not(identity_key=any($3::text[])) and ($4::uuid is null or branch_id=$4)
          and ($5::uuid is null or inventory_location_id=$5)
          and ($8::uuid is null or product_variant_id=$8)
          and ($9::text is null or aggregate_type=$9)
          and ($10::text is null or aggregate_id=$10)
         returning id`,
        [
          input.companyId,
          input.detectorVersion,
          input.observedIdentityKeys,
          input.scope.branchId ?? null,
          input.scope.inventoryLocationId ?? null,
          input.actorId,
          input.snapshotAt,
          input.scope.productVariantId ?? null,
          input.scope.aggregateType ?? null,
          input.scope.aggregateId ?? null,
        ],
      ),
    );
    return resolved.rowCount ?? 0;
  }
}
