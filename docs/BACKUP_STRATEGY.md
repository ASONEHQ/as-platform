# AS ONE — Backup and Restore Strategy

## Protection model

Backups protect against infrastructure loss, operator error and logical
corruption. They do not replace replication, audit logs, migration discipline or
application-level invariants. PostgreSQL backups and WAL/PITR are the primary
transactional recovery mechanism.

## Backup catalog

| Asset | Method | Initial schedule | Initial retention | Restore requirement |
| --- | --- | --- | --- | --- |
| PostgreSQL | encrypted base backup plus continuous WAL/PITR | continuous WAL; daily base backup | 35 daily recovery days; 12 monthly recovery points | isolated restore and PITR |
| Object storage | versioning plus approved cross-location copy/replication | provider-continuous where available; daily inventory | 35 days; longer where legal/business policy requires | reconcile bytes, versions and PostgreSQL metadata |
| Deployment artifacts | immutable registry/release storage | every approved release | supported releases plus incident/legal hold | checksum and provenance verification |
| Configuration definitions | reviewed source and secret-manager metadata | every change | repository/manager history | reconstruct environment without secret disclosure |
| Redis | no authoritative backup requirement | none by default | none | recreate and warm from authority |
| Audit exports/legal holds | policy-controlled encrypted archive | policy-specific | policy-specific | restricted restore with chain of custody |

Retention values are initial engineering policy and may be extended by privacy,
tax, contractual or legal requirements. A shorter retention requires documented
risk acceptance and must still satisfy the DR objectives.

## Security and isolation

- Encrypt in transit and at rest with environment-scoped keys.
- Backup operators receive no unnecessary application administration access.
- Production backups are inaccessible from development and test credentials.
- Maintain at least one logically isolated recovery copy protected from routine
  deletion and compromised production credentials.
- Record backup identity, source, start/end, size, encryption key reference,
  checksum/provider integrity evidence and expiration.
- Never place credentials, plaintext secrets or production backup contents in
  source control, tickets or normal logs.
- Test data derived from production requires approved sanitization.

## Restore selection

Choose the newest recovery point that is demonstrably before the failure while
minimizing confirmed committed-data loss. For logical corruption, “latest” is
not automatically safe. The selected point includes UTC timestamp, WAL boundary,
backup identity, schema/migration state, known data-loss interval and approval.

## PostgreSQL restore runbook

1. Declare the incident or scheduled exercise and dedicated isolated target.
2. Verify backup inventory, encryption access and integrity evidence.
3. Restore the base backup and apply WAL to the approved boundary.
4. Keep application writes and external delivery disabled.
5. Verify PostgreSQL version, extensions, roles, migrations and constraints.
6. Validate tenant/company counts, branch ownership, recent critical records,
   exact financial/inventory quantities, audit and outbox continuity.
7. Run application compatibility, isolation and readiness checks.
8. Record measured RPO/RTO and discrepancies.
9. Destroy exercise data securely, or obtain independent approval before a
   production promotion.

## Object restore runbook

1. Establish affected object IDs, companies and version/time boundary from
   PostgreSQL metadata.
2. Restore into an isolated prefix/bucket when possible.
3. Verify checksum, content type, size, ownership scope and malware/quarantine
   policy before exposure.
4. Reconcile missing and orphaned objects without changing transactional
   ownership silently.
5. Promote only scoped verified versions; retain incident evidence.

## Validation controls

A backup job is successful only when it is complete, encrypted, catalogued and
inside freshness targets. A backup strategy is successful only when restores
are proven. Automated status alone is insufficient.

Restore validation includes:

- readable backup and WAL chain;
- checksum/provider integrity;
- migration history and schema consistency;
- tenant-safe foreign keys and uniqueness constraints;
- sample transaction/audit/outbox linkage;
- exact decimal preservation;
- no secrets in evidence;
- measured recovery point and elapsed recovery time.

## Failure and deletion policy

- Backup failure pages operations before the T0 RPO can be exceeded.
- A broken WAL chain is SEV-2 and becomes SEV-1 when no other T0 recovery point
  meets policy.
- Expired backups are deleted through provider lifecycle controls with auditable
  policy; active incidents and legal holds suspend deletion.
- Restore targets and temporary exports are destroyed after validation using
  approved provider controls.
- No operator manually deletes the last known good recovery point.
