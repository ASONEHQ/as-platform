import { sql } from 'drizzle-orm';

import type { Database } from '../client.js';

/**
 * TASK 16.10B — production incident: an existing tenant's Owner account
 * (`is_system=true` role) never received `purchase.receive` after TASK
 * 16.10 introduced it, because `role_permissions` is only ever populated
 * ONCE, at first-provisioning time (see `ProductionOwnerProvisioner.run`'s
 * own D3 doc comment) — nothing re-synchronizes an ALREADY-EXISTING
 * system role when a NEW row is later added to `permissions`. This is not
 * specific to `purchase.receive`: EVERY permission code added after a
 * tenant's Owner role was created has the identical gap, silently, for
 * every tenant provisioned before that code existed.
 *
 * This function is the generic, permanent fix: for every role marked
 * `is_system=true` (today, exactly the one "Owner" role each company's
 * `ProductionOwnerProvisioner`/`DevelopmentOwnerBootstrap` creates — see
 * `roles.isSystem`'s own schema doc comment; nothing else in this
 * codebase sets that flag), grant every permission code that currently
 * exists in the approved `permissions` catalogue and is not already
 * granted. A CUSTOM role (`is_system=false` — anything a tenant created
 * themselves via `PUT /roles/{id}/permissions`) is never touched: its
 * permission set is the tenant's own deliberate configuration, and an
 * upgrade must never silently widen it.
 *
 * Idempotent (`ON CONFLICT (company_id, role_id, permission_id) DO
 * NOTHING`, the table's own real primary key) — safe to run on every
 * deploy, for every tenant, forever, exactly like `seedTechnicalPermissions`
 * itself. This is deliberately called from the SAME `db:seed` step that
 * already runs on every production deploy (see
 * `docs/PRODUCTION_DEPLOYMENT_RUNBOOK.md`'s "Technical seed" section) —
 * no new deploy step, no new migration, ever required again solely
 * because a permission was added: the existing, already-routine `db:seed`
 * command now keeps every tenant's system role current automatically.
 *
 * Returns the number of `role_permissions` rows newly inserted (0 on a
 * no-op re-run).
 */
export async function syncSystemRolePermissions(db: Database): Promise<number> {
  const result = await db.execute(sql`
    insert into role_permissions (company_id, role_id, permission_id, effect)
    select r.company_id, r.id, p.id, 'allow'
    from roles r
    cross join permissions p
    where r.is_system = true
    on conflict (company_id, role_id, permission_id) do nothing
    returning role_id
  `);
  return result.rowCount ?? result.rows.length;
}
