import { randomUUID } from 'node:crypto';

import { AppError } from '@asone/errors';

import { requireBranchAccess, requirePermission } from '../../auth/auth.guards.js';
import type { AuthService } from '../../auth/auth.service.js';
import type { AdminActor } from './admin.types.js';
import type { AdminRepository } from './admin.repository.js';

function missing(): AppError {
  return new AppError({
    code: 'not_found',
    message: 'The resource was not found.',
    statusCode: 404,
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
      `select c.id company_id,c.display_name,(c.id=$2) current,true switch_permitted
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
    return this.repository.query<Record<string, unknown>>(
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
        await client.query(
          `insert into branches (id,company_id,code,name,status,timezone,address) values ($1,$2,$3,$4,'active',$5,$6::jsonb)`,
          [
            id,
            actor.context.companyId,
            values.code,
            values.name,
            values.timezone,
            JSON.stringify(values.address ?? null),
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

  public async updateMembership(
    actor: AdminActor,
    userId: string,
    status: 'active' | 'suspended' | 'disabled',
  ): Promise<void> {
    requirePermission(this.authentication, actor.context, 'user.update');
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
