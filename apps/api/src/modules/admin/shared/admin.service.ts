import { randomUUID } from 'node:crypto';

import { roleTemplates, type RoleTemplate } from '@asone/database';
import { AppError } from '@asone/errors';

import { requireBranchAccess, requirePermission } from '../../auth/auth.guards.js';
import type { AuthService } from '../../auth/auth.service.js';
import { hashPassword, validatePasswordStrength } from '../../auth/auth.passwords.js';
import { isValidIanaTimezone } from '../../promotions/pricing.service.js';
import type { AdminActor } from './admin.types.js';
import type { AdminRepository } from './admin.repository.js';

function missing(): AppError {
  return new AppError({
    code: 'not_found',
    message: 'The resource was not found.',
    statusCode: 404,
  });
}

/** TASK 16.8B — the ONE gate every company/branch write path funnels
 * through before a `timezone` value ever reaches the database. A bare
 * non-blank-text check (the schema's own `..._timezone_nonblank_ck`) let
 * a real production branch persist `"Mexico_City"` — not a real IANA
 * zone (the real one is `"America/Mexico_City"`) — which later crashed
 * `POST /api/v1/sales` with an unhandled `RangeError` the first time a
 * sale needed this branch's local weekday/time (see
 * `pricing.service.ts`'s `localWeekdayAndTime`). Reuses the same
 * runtime-native `Intl.DateTimeFormat` check that engine already relies
 * on, never a hand-maintained list of "known good" zone strings. */
function requireValidTimezone(value: string): void {
  if (!isValidIanaTimezone(value))
    throw new AppError({
      code: 'validation_error',
      message: `"${value}" is not a valid IANA timezone identifier (e.g. "America/Mexico_City").`,
      statusCode: 400,
    });
}

export class AdministrationService {
  public constructor(
    private readonly repository: AdminRepository,
    private readonly authentication: AuthService,
  ) {}

  public async currentCompany(actor: AdminActor): Promise<Record<string, unknown>> {
    requirePermission(this.authentication, actor.context, 'company.read');
    const [company] = await this.repository.query<Record<string, unknown>>(
      `select id,slug,display_name,status,timezone,currency_code,locale,created_at,updated_at from companies where id=$1`,
      [actor.context.companyId],
    );
    if (company === undefined) throw missing();
    return company;
  }

  public contextCompanies(actor: AdminActor): Promise<readonly Record<string, unknown>[]> {
    return this.repository.query<Record<string, unknown>>(
      `select c.id company_id,c.display_name,c.currency_code,(c.id=$2) current,true switch_permitted
       from company_memberships m
       join companies c on c.id=m.company_id
       where m.user_id=$1 and m.status='active' and c.status='active'
       order by c.display_name,c.id`,
      [actor.context.userId, actor.context.companyId],
    );
  }

  public contextBranches(actor: AdminActor): Promise<{
    readonly companyId: string;
    readonly companyWideAccess: boolean;
    readonly items: readonly Record<string, unknown>[];
  }> {
    return this.repository
      .query<Record<string, unknown>>(
        `select b.id branch_id,b.code,b.name,b.timezone,(b.id=$3) current,
                exists(select 1 from user_branch_access uba
                  where uba.membership_id=$4 and uba.branch_id=b.id
                    and uba.status='active' and uba.is_default) is_default
         from branches b
         where b.company_id=$1 and b.status='active'
           and ($5::boolean or b.id=any($2::uuid[]))
         order by b.code,b.id`,
        [
          actor.context.companyId,
          actor.context.permittedBranchIds,
          actor.context.branchId ?? null,
          actor.context.membershipId,
          actor.context.companyWideAccess ?? false,
        ],
      )
      .then((items) => ({
        companyId: actor.context.companyId,
        companyWideAccess: actor.context.companyWideAccess ?? false,
        items,
      }));
  }

  public async updateCompany(
    actor: AdminActor,
    values: {
      displayName?: string | undefined;
      timezone?: string | undefined;
      status?: string | undefined;
    },
  ): Promise<Record<string, unknown>> {
    requirePermission(this.authentication, actor.context, 'company.update');
    if (values.timezone !== undefined) requireValidTimezone(values.timezone);
    const [current] = await this.repository.query<{ id: string }>(
      'select id from companies where id=$1',
      [actor.context.companyId],
    );
    if (current === undefined) throw missing();
    await this.repository.mutate({
      companyId: actor.context.companyId,
      actorId: actor.context.userId,
      requestId: actor.requestId,
      correlationId: actor.correlationId,
      action: 'company.updated',
      entityType: 'company',
      entityId: current.id,
      eventType: 'company.updated',
      mutation: async (client) => {
        await client.query(
          `update companies set display_name=coalesce($2,display_name), timezone=coalesce($3,timezone), status=coalesce($4,status), updated_at=now() where id=$1`,
          [current.id, values.displayName ?? null, values.timezone ?? null, values.status ?? null],
        );
      },
    });
    return this.currentCompany(actor);
  }

  public async listBranches(actor: AdminActor): Promise<readonly Record<string, unknown>[]> {
    requirePermission(this.authentication, actor.context, 'branch.read');
    // TASK 16.5 — first-branch bootstrap fix. A company-wide actor (e.g.
    // the first production Owner, always provisioned with `branch_id:
    // null` — a company-wide role — see `production-owner.service.ts`)
    // already sees every company branch here via `permittedBranchIds`
    // itself (`auth.repository.ts`'s `resolveContext` returns ALL active
    // branches once it detects a company-wide role grant), so this only
    // changes behavior for a BRANCH-SCOPED actor: one who is not
    // company-wide but does hold `branch_access.manage` or
    // `branch.create` — the two permissions that mean "this actor
    // administers the company's branch roster," as distinct from
    // "this actor operates business data (sales/cash/inventory/...) at a
    // specific branch." Without this, such an actor could create a new
    // branch (`createBranch`, gated on `branch.create`) and then have no
    // way to ever list/see it again here or grant anyone (including
    // themselves) access to it — `changeBranchAccess` below already lets
    // `branch_access.manage` grant access to ANY branch in the actor's
    // own company regardless of the actor's own branch scope, so this
    // listing was the one place lagging behind what the mutation already
    // allowed. Scoped strictly to the actor's own company
    // (`actor.context.companyId`) either way — never cross-tenant, and
    // this never widens OPERATIONAL access to branch-scoped business
    // data, which stays governed by `permittedBranchIds`/
    // `requireBranchAccess` everywhere else, unchanged.
    const canAdministerBranches =
      actor.context.permissions.includes('branch_access.manage') ||
      actor.context.permissions.includes('branch.create');
    return canAdministerBranches
      ? this.repository.query<Record<string, unknown>>(
          `select id,company_id,code,name,status,timezone,address,created_at,updated_at from branches where company_id=$1 order by code,id`,
          [actor.context.companyId],
        )
      : this.repository.query<Record<string, unknown>>(
          `select id,company_id,code,name,status,timezone,address,created_at,updated_at from branches where company_id=$1 and id=any($2::uuid[]) order by code,id`,
          [actor.context.companyId, actor.context.permittedBranchIds],
        );
  }

  public async createBranch(
    actor: AdminActor,
    values: {
      code: string;
      name: string;
      timezone: string;
      address?: Record<string, unknown> | undefined;
    },
  ): Promise<Record<string, unknown>> {
    requirePermission(this.authentication, actor.context, 'branch.create');
    requireValidTimezone(values.timezone);
    const id = randomUUID();
    await this.repository.mutate({
      companyId: actor.context.companyId,
      actorId: actor.context.userId,
      requestId: actor.requestId,
      correlationId: actor.correlationId,
      action: 'branch.created',
      entityType: 'branch',
      entityId: id,
      eventType: 'branch.created',
      mutation: async (client) => {
        // TASK 14.2 (launch-blocker fix): `values.address ?? null` first
        // coerces a genuinely-omitted address to the JS value `null`,
        // which `JSON.stringify` then turns into the STRING `"null"` —
        // cast via `::jsonb` that becomes a real JSON `null` stored in
        // the column, not a SQL NULL. `branches_address_object_ck`
        // (`address is null or jsonb_typeof(address) = 'object'`)
        // correctly rejects that (a JSON `null` is not SQL NULL, and
        // `jsonb_typeof` of it is `'null'`, not `'object'`) — so calling
        // this with no address at all (a normal, expected case; address
        // is optional) always failed. Fixed to mirror `updateBranch`'s
        // own already-correct sibling pattern two branches below: only
        // stringify when an address was actually supplied, otherwise
        // bind a real JS `null` (a true SQL NULL once cast).
        await client.query(
          `insert into branches (id,company_id,code,name,status,timezone,address) values ($1,$2,$3,$4,'active',$5,$6::jsonb)`,
          [
            id,
            actor.context.companyId,
            values.code,
            values.name,
            values.timezone,
            values.address === undefined ? null : JSON.stringify(values.address),
          ],
        );
      },
    });
    const [branch] = await this.repository.query<Record<string, unknown>>(
      'select id,company_id,code,name,status,timezone,address,created_at,updated_at from branches where id=$1 and company_id=$2',
      [id, actor.context.companyId],
    );
    if (branch === undefined) throw missing();
    return branch;
  }

  public async branch(actor: AdminActor, branchId: string): Promise<Record<string, unknown>> {
    requirePermission(this.authentication, actor.context, 'branch.read');
    requireBranchAccess(this.authentication, actor.context, branchId);
    const [branch] = await this.repository.query<Record<string, unknown>>(
      'select id,company_id,code,name,status,timezone,address,created_at,updated_at from branches where id=$1 and company_id=$2',
      [branchId, actor.context.companyId],
    );
    if (branch === undefined) throw missing();
    return branch;
  }

  public async updateBranch(
    actor: AdminActor,
    branchId: string,
    values: {
      code?: string | undefined;
      name?: string | undefined;
      timezone?: string | undefined;
      status?: string | undefined;
      address?: Record<string, unknown> | undefined;
    },
  ): Promise<Record<string, unknown>> {
    requirePermission(this.authentication, actor.context, 'branch.update');
    requireBranchAccess(this.authentication, actor.context, branchId);
    if (values.timezone !== undefined) requireValidTimezone(values.timezone);
    await this.repository.mutate({
      companyId: actor.context.companyId,
      branchId,
      actorId: actor.context.userId,
      requestId: actor.requestId,
      correlationId: actor.correlationId,
      action: values.status === undefined ? 'branch.updated' : 'branch.status_changed',
      entityType: 'branch',
      entityId: branchId,
      eventType: 'branch.updated',
      mutation: async (client) => {
        const result = await client.query(
          `update branches set code=coalesce($3,code), name=coalesce($4,name), timezone=coalesce($5,timezone), status=coalesce($6,status), address=coalesce($7::jsonb,address), updated_at=now() where id=$1 and company_id=$2`,
          [
            branchId,
            actor.context.companyId,
            values.code ?? null,
            values.name ?? null,
            values.timezone ?? null,
            values.status ?? null,
            values.address === undefined ? null : JSON.stringify(values.address),
          ],
        );
        if ((result as { rowCount?: number }).rowCount !== 1) throw missing();
      },
    });
    return this.branch(actor, branchId);
  }

  public async listUsers(actor: AdminActor): Promise<readonly Record<string, unknown>[]> {
    requirePermission(this.authentication, actor.context, 'user.read');
    return this.repository.query(
      `select u.id,u.email,u.display_name,u.status as identity_status,m.id as membership_id,m.status as membership_status
       from company_memberships m join users u on u.id=m.user_id where m.company_id=$1 order by u.display_name,u.id`,
      [actor.context.companyId],
    );
  }

  public async userDetail(
    actor: AdminActor,
    userId: string,
    includes: readonly ('roles' | 'branches')[],
  ): Promise<Record<string, unknown>> {
    requirePermission(this.authentication, actor.context, 'user.read');
    const [member] = await this.repository.query<Record<string, unknown>>(
      `select u.id,u.email,u.display_name,u.status as identity_status,m.id as membership_id,m.status as membership_status,m.created_at as membership_created_at
       from company_memberships m join users u on u.id=m.user_id where m.company_id=$1 and m.user_id=$2`,
      [actor.context.companyId, userId],
    );
    if (member === undefined) throw missing();
    const detail: Record<string, unknown> = { ...member };
    if (includes.includes('roles')) detail.roles = await this.listRoleAssignments(actor, userId);
    if (includes.includes('branches')) {
      detail.branch_access = await this.repository.query(
        `select id,branch_id,status,is_default,created_at,updated_at,revoked_at from user_branch_access where company_id=$1 and membership_id=$2 order by branch_id`,
        [actor.context.companyId, member.membership_id],
      );
    }
    return detail;
  }

  public async createUser(
    actor: AdminActor,
    values: { email: string; displayName: string },
  ): Promise<Record<string, unknown>> {
    requirePermission(this.authentication, actor.context, 'user.create');
    const userId = randomUUID();
    const membershipId = randomUUID();
    const email = values.email.trim();
    await this.repository.mutate({
      companyId: actor.context.companyId,
      actorId: actor.context.userId,
      requestId: actor.requestId,
      correlationId: actor.correlationId,
      action: 'membership.invited',
      entityType: 'company_membership',
      entityId: membershipId,
      eventType: 'membership.invited',
      mutation: async (client) => {
        await client.query(
          `insert into users (id,email,normalized_email,display_name,status) values ($1,$2,lower($2),$3,'pending')`,
          [userId, email, values.displayName.trim()],
        );
        await client.query(
          `insert into company_memberships (id,company_id,user_id,status) values ($1,$2,$3,'invited')`,
          [membershipId, actor.context.companyId, userId],
        );
      },
    });
    return {
      id: userId,
      membership_id: membershipId,
      email,
      display_name: values.displayName.trim(),
      membership_status: 'invited',
    };
  }

  // TASK 14.0 (launch-blocker fix): `createUser` below has always inserted
  // the new `users` row with `status='pending'` and no `password_hash` —
  // and nothing anywhere in the codebase ever transitioned either field.
  // `AuthService.login`/`beginLogin` both require `users.status==='active'`
  // AND a non-null `password_hash` (auth.service.ts) — so an admin-invited
  // user could be created, granted roles/branch access, and marked
  // `company_memberships.status='active'`, and still could NEVER actually
  // log in: there was no code path anywhere that could set either field.
  // Only the dev-only, environment-gated `bootstrap-owner.service.ts`
  // could ever produce a working login, by inserting a password hash
  // directly — a real second staff account (a cashier, a manager) could
  // not be onboarded through the actual product at all. This is fixed
  // here, at the one existing activation call site, rather than by adding
  // a separate invitation-email/token flow (real infrastructure this pass
  // doesn't need to build): on FIRST activation of a still-`pending`
  // identity, the acting admin must supply a real password for the new
  // hire directly (the normal small-business-launch pattern — the owner
  // sets it and tells the cashier in person), which is validated and
  // hashed here and written to `users.status='active'`+`password_hash` in
  // the SAME transaction as the membership activation. `users.status` is
  // the per-IDENTITY gate (a person could belong to more than one
  // company); it is only ever set here, once, on first activation — every
  // other transition (suspend/disable/reactivate) continues to touch only
  // `company_memberships.status`, exactly as before, since a person
  // suspended at ONE company must remain `active` at the identity level
  // for any other company they also belong to.
  public async updateMembership(
    actor: AdminActor,
    userId: string,
    status: 'active' | 'suspended' | 'disabled',
    password?: string,
  ): Promise<void> {
    requirePermission(this.authentication, actor.context, 'user.update');
    const [identity] = await this.repository.query<{
      status: string;
      password_hash: string | null;
    }>(
      `select u.status, u.password_hash from users u
       join company_memberships m on m.user_id = u.id
       where m.company_id = $1 and m.user_id = $2`,
      [actor.context.companyId, userId],
    );
    if (identity === undefined) throw missing();
    const isFirstActivation = status === 'active' && identity.status === 'pending';
    let passwordHash: string | null = null;
    if (isFirstActivation) {
      if (password === undefined || password.length === 0)
        throw new AppError({
          code: 'validation_error',
          message: 'A password is required to activate a new account for the first time.',
          statusCode: 400,
        });
      const strengthError = validatePasswordStrength(password);
      if (strengthError !== null)
        throw new AppError({ code: 'validation_error', message: strengthError, statusCode: 400 });
      passwordHash = await hashPassword(password);
    }
    await this.repository.mutate({
      companyId: actor.context.companyId,
      actorId: actor.context.userId,
      requestId: actor.requestId,
      correlationId: actor.correlationId,
      action: `membership.${status}`,
      entityType: 'company_membership',
      entityId: userId,
      eventType: 'membership.updated',
      mutation: async (client) => {
        const result = (await client.query(
          `update company_memberships set status=$3,updated_at=now() where company_id=$1 and user_id=$2`,
          [actor.context.companyId, userId, status],
        )) as { rowCount?: number };
        if (result.rowCount !== 1) throw missing();
        if (isFirstActivation) {
          await client.query(
            `update users set status='active',password_hash=$2,updated_at=now() where id=$1`,
            [userId, passwordHash],
          );
        }
        if (status !== 'active') {
          await client.query(
            `update sessions set status='revoked',revoked_at=now(),revocation_reason='membership_${status}',updated_at=now() where company_id=$1 and user_id=$2 and status='active'`,
            [actor.context.companyId, userId],
          );
          await client.query(
            `update session_refresh_tokens set status='revoked' where session_id in (select id from sessions where company_id=$1 and user_id=$2) and status='active'`,
            [actor.context.companyId, userId],
          );
        }
      },
    });
  }

  public async listRoles(actor: AdminActor): Promise<readonly Record<string, unknown>[]> {
    requirePermission(this.authentication, actor.context, 'role.read');
    return this.repository.query(
      `select id,name,code,description,status,is_system,created_at,updated_at from roles where company_id=$1 order by code,id`,
      [actor.context.companyId],
    );
  }

  public async listPermissions(actor: AdminActor): Promise<readonly Record<string, unknown>[]> {
    requirePermission(this.authentication, actor.context, 'permission.read');
    return this.repository.query(
      `select id,code,description,domain from permissions order by domain,code`,
      [],
    );
  }

  // TASK 16.16 — a static, non-persisted catalogue of starter permission
  // bundles for the role-creation UI; see `@asone/database`'s
  // `role-templates.ts` for the full "never an authorization concept"
  // rationale. Gated by `role.read` (the same read-tier permission the
  // role-creation flow already requires to even see the role list) — this
  // never reads or writes a `roles`/`role_permissions` row itself.
  public listRoleTemplates(actor: AdminActor): readonly RoleTemplate[] {
    requirePermission(this.authentication, actor.context, 'role.read');
    return roleTemplates;
  }

  public async createRole(
    actor: AdminActor,
    values: { name: string; code: string; description?: string },
  ): Promise<Record<string, unknown>> {
    requirePermission(this.authentication, actor.context, 'role.create');
    const id = randomUUID();
    await this.repository.mutate({
      companyId: actor.context.companyId,
      actorId: actor.context.userId,
      requestId: actor.requestId,
      correlationId: actor.correlationId,
      action: 'role.created',
      entityType: 'role',
      entityId: id,
      eventType: 'role.created',
      mutation: async (client) => {
        await client.query(
          `insert into roles (id,company_id,name,code,description,status,is_system) values ($1,$2,$3,$4,$5,'active',false)`,
          [id, actor.context.companyId, values.name, values.code, values.description ?? null],
        );
      },
    });
    return {
      id,
      name: values.name,
      code: values.code,
      description: values.description ?? null,
      status: 'active',
      is_system: false,
    };
  }

  public async role(actor: AdminActor, roleId: string): Promise<Record<string, unknown>> {
    requirePermission(this.authentication, actor.context, 'role.read');
    const [role] = await this.repository.query<Record<string, unknown>>(
      `select id,name,code,description,status,is_system,created_at,updated_at from roles where id=$1 and company_id=$2`,
      [roleId, actor.context.companyId],
    );
    if (role === undefined) throw missing();
    return role;
  }

  public async updateRole(
    actor: AdminActor,
    roleId: string,
    values: { name?: string; description?: string; status?: string },
  ): Promise<Record<string, unknown>> {
    requirePermission(this.authentication, actor.context, 'role.update');
    await this.repository.mutate({
      companyId: actor.context.companyId,
      actorId: actor.context.userId,
      requestId: actor.requestId,
      correlationId: actor.correlationId,
      action: 'role.updated',
      entityType: 'role',
      entityId: roleId,
      eventType: 'role.updated',
      mutation: async (client) => {
        const current = (await client.query(
          `select is_system from roles where id=$1 and company_id=$2 for update`,
          [roleId, actor.context.companyId],
        )) as { rows?: readonly { is_system: boolean }[] };
        if (current.rows?.[0] === undefined) throw missing();
        if (current.rows[0].is_system)
          throw new AppError({
            code: 'permission_denied',
            message: 'System roles cannot be modified.',
            statusCode: 403,
          });
        await client.query(
          `update roles set name=coalesce($3,name),description=coalesce($4,description),status=coalesce($5,status),updated_at=now() where id=$1 and company_id=$2`,
          [
            roleId,
            actor.context.companyId,
            values.name ?? null,
            values.description ?? null,
            values.status ?? null,
          ],
        );
      },
    });
    return this.role(actor, roleId);
  }

  public async rolePermissions(
    actor: AdminActor,
    roleId: string,
  ): Promise<readonly Record<string, unknown>[]> {
    requirePermission(this.authentication, actor.context, 'role.read');
    await this.role(actor, roleId);
    return this.repository.query(
      `select p.id,p.code,p.description,p.domain,rp.effect from role_permissions rp join permissions p on p.id=rp.permission_id where rp.company_id=$1 and rp.role_id=$2 order by p.code`,
      [actor.context.companyId, roleId],
    );
  }

  public async replaceRolePermissions(
    actor: AdminActor,
    roleId: string,
    assignments: readonly { permissionId: string; effect: 'allow' | 'deny' }[],
  ): Promise<void> {
    requirePermission(this.authentication, actor.context, 'role.permission.manage');
    if (new Set(assignments.map((item) => item.permissionId)).size !== assignments.length)
      throw new AppError({
        code: 'validation_error',
        message: 'A permission may be assigned once per role.',
        statusCode: 400,
      });
    // TASK 16.5 — self-escalation / privilege-escalation guard: an actor
    // must never be able to use `role.permission.manage` to grant ANY
    // role (including one they themselves hold) an `allow` permission the
    // actor does not currently hold — otherwise this endpoint alone is a
    // universal privilege-escalation primitive, regardless of whose role
    // is being edited. `deny` assignments are exempt (denying is never an
    // escalation). Checked against the actor's own CURRENT effective
    // permission set (`actor.context.permissions`, the same deny-aware
    // list `auth.repository.ts`'s `resolveContext` computes fresh on
    // every request) before touching the database.
    const allowedPermissionIds = assignments
      .filter((item) => item.effect === 'allow')
      .map((item) => item.permissionId);
    if (allowedPermissionIds.length > 0) {
      const grantedCodes = await this.repository.query<{ code: string }>(
        `select code from permissions where id = any($1::uuid[])`,
        [allowedPermissionIds],
      );
      if (grantedCodes.some((row) => !actor.context.permissions.includes(row.code)))
        throw new AppError({
          code: 'permission_denied',
          message: 'Cannot grant a permission you do not hold.',
          statusCode: 403,
        });
    }
    await this.repository.mutate({
      companyId: actor.context.companyId,
      actorId: actor.context.userId,
      requestId: actor.requestId,
      correlationId: actor.correlationId,
      action: 'role.permissions_replaced',
      entityType: 'role',
      entityId: roleId,
      eventType: 'role.permissions_updated',
      mutation: async (client) => {
        const current = (await client.query(
          `select is_system from roles where id=$1 and company_id=$2 for update`,
          [roleId, actor.context.companyId],
        )) as { rows?: readonly { is_system: boolean }[] };
        if (current.rows?.[0] === undefined) throw missing();
        if (current.rows[0].is_system)
          throw new AppError({
            code: 'permission_denied',
            message: 'System role permissions cannot be modified.',
            statusCode: 403,
          });
        if (assignments.length > 0) {
          const found = (await client.query(`select id from permissions where id=any($1::uuid[])`, [
            assignments.map((item) => item.permissionId),
          ])) as { rowCount?: number };
          if (found.rowCount !== assignments.length)
            throw new AppError({
              code: 'validation_error',
              message: 'One or more permissions do not exist.',
              statusCode: 400,
            });
        }
        await client.query(`delete from role_permissions where company_id=$1 and role_id=$2`, [
          actor.context.companyId,
          roleId,
        ]);
        for (const assignment of assignments)
          await client.query(
            `insert into role_permissions (company_id,role_id,permission_id,effect) values ($1,$2,$3,$4)`,
            [actor.context.companyId, roleId, assignment.permissionId, assignment.effect],
          );
      },
    });
  }

  public async revokeRoleAssignment(
    actor: AdminActor,
    userId: string,
    assignmentId: string,
  ): Promise<void> {
    requirePermission(this.authentication, actor.context, 'role.assign');
    await this.repository.mutate({
      companyId: actor.context.companyId,
      actorId: actor.context.userId,
      requestId: actor.requestId,
      correlationId: actor.correlationId,
      action: 'role_assignment.revoked',
      entityType: 'user_role',
      entityId: assignmentId,
      eventType: 'role_assignment.revoked',
      mutation: async (client) => {
        const result = (await client.query(
          `update user_roles ur set status='revoked',revoked_at=now() from company_memberships m where ur.id=$1 and ur.company_id=$2 and ur.membership_id=m.id and m.user_id=$3 and ur.status='active'`,
          [assignmentId, actor.context.companyId, userId],
        )) as { rowCount?: number };
        if (result.rowCount !== 1) throw missing();
      },
    });
  }

  public async listRoleAssignments(
    actor: AdminActor,
    userId: string,
  ): Promise<readonly Record<string, unknown>[]> {
    requirePermission(this.authentication, actor.context, 'role.read');
    return this.repository.query(
      `select ur.id,ur.role_id,ur.branch_id,ur.status,ur.created_at,ur.revoked_at,
              r.code as role_code,r.name as role_name
       from user_roles ur
       join company_memberships m on m.id=ur.membership_id and m.company_id=ur.company_id
       join roles r on r.id=ur.role_id and r.company_id=ur.company_id
       where ur.company_id=$1 and m.user_id=$2 order by r.code,ur.id`,
      [actor.context.companyId, userId],
    );
  }

  public async assignRole(
    actor: AdminActor,
    userId: string,
    values: { roleId: string; branchId?: string | undefined },
  ): Promise<Record<string, unknown>> {
    requirePermission(this.authentication, actor.context, 'role.assign');
    // TASK 16.5 — self-escalation / privilege-escalation guard: an actor
    // must never be able to use `role.assign` to grant ANY user
    // (including themselves) a role that carries a permission the actor
    // does not currently hold — otherwise `role.assign` alone is a
    // universal privilege-escalation primitive (assign yourself, or a
    // puppet account, a role with more power than you have). Checked
    // against the role's current granted (`allow`) permission set,
    // company-scoped like every other query in this file. An unknown/
    // wrong-company roleId simply yields zero rows here (never an
    // escalation) — the existing "role not found" check inside the
    // transaction below still fires for it, unchanged.
    const grantedCodes = await this.repository.query<{ code: string }>(
      `select p.code from role_permissions rp
       join permissions p on p.id = rp.permission_id
       where rp.company_id = $1 and rp.role_id = $2 and rp.effect = 'allow'`,
      [actor.context.companyId, values.roleId],
    );
    if (grantedCodes.some((row) => !actor.context.permissions.includes(row.code)))
      throw new AppError({
        code: 'permission_denied',
        message: 'Cannot assign a role that grants permissions you do not hold.',
        statusCode: 403,
      });
    const assignmentId = randomUUID();
    let result: Record<string, unknown> | undefined;
    await this.repository.mutate({
      companyId: actor.context.companyId,
      branchId: values.branchId,
      actorId: actor.context.userId,
      requestId: actor.requestId,
      correlationId: actor.correlationId,
      action: 'user.role_assigned',
      entityType: 'user_role',
      entityId: assignmentId,
      eventType: 'user.role_assigned',
      metadata: { user_id: userId, role_id: values.roleId },
      mutation: async (client) => {
        const membership = (await client.query(
          `select id,status from company_memberships where company_id=$1 and user_id=$2 for update`,
          [actor.context.companyId, userId],
        )) as { rows?: readonly { id: string; status: string }[] };
        const membershipRow = membership.rows?.[0];
        if (membershipRow === undefined) throw missing();
        if (membershipRow.status !== 'active')
          throw new AppError({
            code: 'company_scope_mismatch',
            message: 'The membership is not active.',
            statusCode: 403,
          });
        const role = (await client.query(
          `select id from roles where id=$1 and company_id=$2 and status='active' for update`,
          [values.roleId, actor.context.companyId],
        )) as { rows?: readonly { id: string }[] };
        if (role.rows?.[0] === undefined) throw missing();
        if (values.branchId !== undefined) {
          const branch = (await client.query(
            `select id from branches where id=$1 and company_id=$2 and status='active'`,
            [values.branchId, actor.context.companyId],
          )) as { rows?: readonly { id: string }[] };
          if (branch.rows?.[0] === undefined) throw missing();
        }
        const existing = (await client.query(
          `select id,status from user_roles where company_id=$1 and membership_id=$2 and role_id=$3 and branch_id is not distinct from $4::uuid for update`,
          [actor.context.companyId, membershipRow.id, values.roleId, values.branchId ?? null],
        )) as { rows?: readonly { id: string; status: string }[] };
        const current = existing.rows?.[0];
        if (current?.status === 'active')
          throw new AppError({
            code: 'validation_error',
            message: 'The role is already assigned.',
            statusCode: 409,
          });
        if (current !== undefined) {
          await client.query(
            `update user_roles set status='active',revoked_at=null where id=$1 and company_id=$2`,
            [current.id, actor.context.companyId],
          );
          result = {
            id: current.id,
            membership_id: membershipRow.id,
            role_id: values.roleId,
            branch_id: values.branchId ?? null,
            status: 'active',
            reactivated: true,
          };
          return;
        }
        await client.query(
          `insert into user_roles (id,company_id,membership_id,role_id,branch_id,status) values ($1,$2,$3,$4,$5,'active')`,
          [
            assignmentId,
            actor.context.companyId,
            membershipRow.id,
            values.roleId,
            values.branchId ?? null,
          ],
        );
        result = {
          id: assignmentId,
          membership_id: membershipRow.id,
          role_id: values.roleId,
          branch_id: values.branchId ?? null,
          status: 'active',
          reactivated: false,
        };
      },
    });
    if (result === undefined)
      throw new AppError({
        code: 'internal_error',
        message: 'Role assignment was not created.',
        statusCode: 500,
      });
    return result;
  }

  public async changeBranchAccess(
    actor: AdminActor,
    userId: string,
    branchId: string,
    values: { status: 'active' | 'revoked'; isDefault: boolean },
  ): Promise<{ created: boolean; access: Record<string, unknown> }> {
    requirePermission(this.authentication, actor.context, 'branch_access.manage');
    let created = false;
    let access: Record<string, unknown> | undefined;
    await this.repository.mutate({
      companyId: actor.context.companyId,
      branchId,
      actorId: actor.context.userId,
      requestId: actor.requestId,
      correlationId: actor.correlationId,
      action: 'user.branch_access_changed',
      entityType: 'user_branch_access',
      entityId: branchId,
      eventType: 'user.branch_access_changed',
      metadata: { user_id: userId, branch_id: branchId },
      mutation: async (client) => {
        const membership = (await client.query(
          `select id,status from company_memberships where company_id=$1 and user_id=$2 for update`,
          [actor.context.companyId, userId],
        )) as { rows?: readonly { id: string; status: string }[] };
        const membershipRow = membership.rows?.[0];
        if (membershipRow === undefined) throw missing();
        if (membershipRow.status !== 'active')
          throw new AppError({
            code: 'company_scope_mismatch',
            message: 'The membership is not active.',
            statusCode: 403,
          });
        const branch = (await client.query(
          `select id from branches where id=$1 and company_id=$2 and status='active'`,
          [branchId, actor.context.companyId],
        )) as { rows?: readonly { id: string }[] };
        if (branch.rows?.[0] === undefined) throw missing();
        if (values.isDefault && values.status === 'active')
          await client.query(
            `update user_branch_access set is_default=false,updated_at=now() where company_id=$1 and membership_id=$2 and status='active'`,
            [actor.context.companyId, membershipRow.id],
          );
        const current = (await client.query(
          `select id from user_branch_access where company_id=$1 and membership_id=$2 and branch_id=$3 for update`,
          [actor.context.companyId, membershipRow.id, branchId],
        )) as { rows?: readonly { id: string }[] };
        const id = current.rows?.[0]?.id ?? randomUUID();
        created = current.rows?.[0] === undefined;
        if (created) {
          await client.query(
            `insert into user_branch_access (id,company_id,membership_id,user_id,branch_id,status,is_default,revoked_at) values ($1,$2,$3,$4,$5,$6,$7,case when $6='revoked' then now() else null end)`,
            [
              id,
              actor.context.companyId,
              membershipRow.id,
              userId,
              branchId,
              values.status,
              values.isDefault,
            ],
          );
        } else {
          await client.query(
            `update user_branch_access set status=$4,is_default=$5,revoked_at=case when $4='revoked' then now() else null end,updated_at=now() where id=$1 and company_id=$2 and membership_id=$3`,
            [id, actor.context.companyId, membershipRow.id, values.status, values.isDefault],
          );
        }
        access = {
          id,
          membership_id: membershipRow.id,
          user_id: userId,
          branch_id: branchId,
          status: values.status,
          is_default: values.isDefault,
        };
      },
    });
    if (access === undefined)
      throw new AppError({
        code: 'internal_error',
        message: 'Branch access was not changed.',
        statusCode: 500,
      });
    return { created, access };
  }

  public async revokeBranchAccess(
    actor: AdminActor,
    userId: string,
    branchId: string,
  ): Promise<void> {
    requirePermission(this.authentication, actor.context, 'branch_access.manage');
    await this.repository.mutate({
      companyId: actor.context.companyId,
      branchId,
      actorId: actor.context.userId,
      requestId: actor.requestId,
      correlationId: actor.correlationId,
      action: 'user.branch_access_revoked',
      entityType: 'user_branch_access',
      entityId: branchId,
      eventType: 'user.branch_access_revoked',
      metadata: { user_id: userId, branch_id: branchId },
      mutation: async (client) => {
        const membership = (await client.query(
          `select id from company_memberships where company_id=$1 and user_id=$2`,
          [actor.context.companyId, userId],
        )) as { rows?: readonly { id: string }[] };
        if (membership.rows?.[0] === undefined) throw missing();
        const branch = (await client.query(
          `select id from branches where id=$1 and company_id=$2`,
          [branchId, actor.context.companyId],
        )) as { rows?: readonly { id: string }[] };
        if (branch.rows?.[0] === undefined) throw missing();
        const result = (await client.query(
          `update user_branch_access uba set status='revoked',is_default=false,revoked_at=coalesce(revoked_at,now()),updated_at=now()
           from company_memberships m where uba.company_id=$1 and uba.branch_id=$2 and uba.membership_id=m.id and m.user_id=$3 and uba.status='active'`,
          [actor.context.companyId, branchId, userId],
        )) as { rowCount?: number };
        if (result.rowCount === 0) return;
        await client.query(
          `update sessions set status='revoked',revoked_at=now(),revocation_reason='branch_access_revoked',updated_at=now() where company_id=$1 and user_id=$2 and branch_id=$3 and status='active'`,
          [actor.context.companyId, userId, branchId],
        );
        await client.query(
          `update session_refresh_tokens set status='revoked' where session_id in (select id from sessions where company_id=$1 and user_id=$2 and branch_id=$3) and status='active'`,
          [actor.context.companyId, userId, branchId],
        );
      },
    });
  }

  // TASK 16.15 — narrows a user's already-granted branch access (via
  // `changeBranchAccess`/role assignment above) down to specific
  // register(s)/area(s) within that branch. Reuses `branch_access.manage`
  // — the same admin capability as branch-scope grants above, never a
  // new permission for what is semantically the identical action one
  // level deeper (§25's own "reuse where semantics already fit"). See
  // `user_register_access`'s own doc comment (`cash.ts`) for the exact
  // "presence narrows, absence means unrestricted" scoping this grants.
  public async grantRegisterAccess(
    actor: AdminActor,
    userId: string,
    branchId: string,
    target: { operationalAreaId: string; cashRegisterId?: undefined } | { operationalAreaId?: undefined; cashRegisterId: string },
  ): Promise<Record<string, unknown>> {
    requirePermission(this.authentication, actor.context, 'branch_access.manage');
    requireBranchAccess(this.authentication, actor.context, branchId);
    let access: Record<string, unknown> | undefined;
    await this.repository.mutate({
      companyId: actor.context.companyId,
      branchId,
      actorId: actor.context.userId,
      requestId: actor.requestId,
      correlationId: actor.correlationId,
      action: 'user.register_access_granted',
      entityType: 'user_register_access',
      entityId: userId,
      eventType: 'user.register_access_granted',
      metadata: { user_id: userId, branch_id: branchId, ...target },
      mutation: async (client) => {
        const membership = (await client.query(
          `select id,status from company_memberships where company_id=$1 and user_id=$2 for update`,
          [actor.context.companyId, userId],
        )) as { rows?: readonly { id: string; status: string }[] };
        const membershipRow = membership.rows?.[0];
        if (membershipRow === undefined) throw missing();
        if (membershipRow.status !== 'active')
          throw new AppError({
            code: 'company_scope_mismatch',
            message: 'The membership is not active.',
            statusCode: 403,
          });
        if (target.operationalAreaId !== undefined) {
          const area = (await client.query(
            `select id from operational_areas where id=$1 and company_id=$2 and branch_id=$3 and status='active'`,
            [target.operationalAreaId, actor.context.companyId, branchId],
          )) as { rows?: readonly { id: string }[] };
          if (area.rows?.[0] === undefined) throw missing();
        } else {
          const register = (await client.query(
            `select id from cash_registers where id=$1 and company_id=$2 and branch_id=$3 and status<>'retired' and deleted_at is null`,
            [target.cashRegisterId, actor.context.companyId, branchId],
          )) as { rows?: readonly { id: string }[] };
          if (register.rows?.[0] === undefined) throw missing();
        }
        const id = randomUUID();
        await client.query(
          `insert into user_register_access (id,company_id,membership_id,user_id,branch_id,operational_area_id,cash_register_id,status)
           values ($1,$2,$3,$4,$5,$6,$7,'active')
           on conflict (company_id,membership_id,operational_area_id,cash_register_id) where status='active' do nothing`,
          [
            id,
            actor.context.companyId,
            membershipRow.id,
            userId,
            branchId,
            target.operationalAreaId ?? null,
            target.cashRegisterId ?? null,
          ],
        );
        access = {
          id,
          membership_id: membershipRow.id,
          user_id: userId,
          branch_id: branchId,
          operational_area_id: target.operationalAreaId ?? null,
          cash_register_id: target.cashRegisterId ?? null,
        };
      },
    });
    if (access === undefined)
      throw new AppError({ code: 'internal_error', message: 'Register access was not granted.', statusCode: 500 });
    return access;
  }

  public async revokeRegisterAccess(actor: AdminActor, id: string): Promise<void> {
    requirePermission(this.authentication, actor.context, 'branch_access.manage');
    await this.repository.mutate({
      companyId: actor.context.companyId,
      actorId: actor.context.userId,
      requestId: actor.requestId,
      correlationId: actor.correlationId,
      action: 'user.register_access_revoked',
      entityType: 'user_register_access',
      entityId: id,
      eventType: 'user.register_access_revoked',
      metadata: { id },
      mutation: async (client) => {
        const result = (await client.query(
          `update user_register_access set status='revoked',revoked_at=coalesce(revoked_at,now()),updated_at=now()
           where id=$1 and company_id=$2 and status='active'`,
          [id, actor.context.companyId],
        )) as { rowCount?: number };
        if ((result.rowCount ?? 0) === 0) throw missing();
      },
    });
  }

  public async listRegisterAccess(actor: AdminActor, userId: string): Promise<readonly Record<string, unknown>[]> {
    requirePermission(this.authentication, actor.context, 'branch_access.manage');
    const membershipRows = await this.repository.query<{ id: string }>(
      `select id from company_memberships where company_id=$1 and user_id=$2`,
      [actor.context.companyId, userId],
    );
    const membershipRow = membershipRows[0];
    if (membershipRow === undefined) throw missing();
    return this.repository.query(
      `select id,branch_id,operational_area_id,cash_register_id,status,created_at,revoked_at
       from user_register_access where company_id=$1 and membership_id=$2 order by branch_id, created_at`,
      [actor.context.companyId, membershipRow.id],
    );
  }

  public async listDevices(actor: AdminActor): Promise<readonly Record<string, unknown>[]> {
    requirePermission(this.authentication, actor.context, 'device.read');
    return this.repository.query(
      `select id,branch_id,device_code,name,device_type,status,last_seen_at,revoked_at,created_at,updated_at from devices where company_id=$1 and (branch_id is null or branch_id=any($2::uuid[])) order by device_code,id`,
      [actor.context.companyId, actor.context.permittedBranchIds],
    );
  }

  public async device(actor: AdminActor, deviceId: string): Promise<Record<string, unknown>> {
    requirePermission(this.authentication, actor.context, 'device.read');
    const [device] = await this.repository.query<Record<string, unknown>>(
      `select id,branch_id,device_code,name,device_type,status,last_seen_at,revoked_at,created_at,updated_at from devices where id=$1 and company_id=$2`,
      [deviceId, actor.context.companyId],
    );
    if (device === undefined) throw missing();
    if (typeof device.branch_id === 'string')
      requireBranchAccess(this.authentication, actor.context, device.branch_id);
    return device;
  }

  public async registerDevice(
    actor: AdminActor,
    values: {
      branchId: string;
      deviceCode: string;
      name: string;
      deviceType: string;
      publicKey?: string;
    },
  ): Promise<Record<string, unknown>> {
    requirePermission(this.authentication, actor.context, 'device.register');
    requireBranchAccess(this.authentication, actor.context, values.branchId);
    const id = randomUUID();
    await this.repository.mutate({
      companyId: actor.context.companyId,
      branchId: values.branchId,
      actorId: actor.context.userId,
      requestId: actor.requestId,
      correlationId: actor.correlationId,
      action: 'device.registered',
      entityType: 'device',
      entityId: id,
      eventType: 'device.registered',
      mutation: async (client) => {
        const branch = (await client.query(
          `select id from branches where id=$1 and company_id=$2 and status='active'`,
          [values.branchId, actor.context.companyId],
        )) as { rows?: readonly { id: string }[] };
        if (branch.rows?.[0] === undefined) throw missing();
        await client.query(
          `insert into devices (id,company_id,branch_id,device_code,name,device_type,status,public_key) values ($1,$2,$3,$4,$5,$6,'pending',$7)`,
          [
            id,
            actor.context.companyId,
            values.branchId,
            values.deviceCode,
            values.name,
            values.deviceType,
            values.publicKey ?? null,
          ],
        );
      },
    });
    return this.device(actor, id);
  }

  public async revokeDevice(
    actor: AdminActor,
    deviceId: string,
    reasonCode: string,
    note?: string,
  ): Promise<Record<string, unknown>> {
    requirePermission(this.authentication, actor.context, 'device.revoke');
    const target = await this.device(actor, deviceId);
    await this.repository.mutate({
      companyId: actor.context.companyId,
      branchId: typeof target.branch_id === 'string' ? target.branch_id : undefined,
      actorId: actor.context.userId,
      requestId: actor.requestId,
      correlationId: actor.correlationId,
      action: 'device.revoked',
      entityType: 'device',
      entityId: deviceId,
      eventType: 'device.revoked',
      metadata: { reason_code: reasonCode, note: note ?? null },
      mutation: async (client) => {
        await client.query(
          `update devices set status='revoked',revoked_at=coalesce(revoked_at,now()),updated_at=now() where id=$1 and company_id=$2`,
          [deviceId, actor.context.companyId],
        );
        await client.query(
          `update sessions set status='revoked',revoked_at=now(),revocation_reason=$3,updated_at=now() where device_id=$1 and company_id=$2 and status='active'`,
          [deviceId, actor.context.companyId, `device_${reasonCode}`],
        );
        await client.query(
          `update session_refresh_tokens set status='revoked' where session_id in (select id from sessions where device_id=$1 and company_id=$2) and status='active'`,
          [deviceId, actor.context.companyId],
        );
      },
    });
    return this.device(actor, deviceId);
  }
}
