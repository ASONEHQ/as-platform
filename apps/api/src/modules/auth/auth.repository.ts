import { randomUUID } from 'node:crypto';

import type { DatabaseClient } from '@asone/database';

import type {
  AuthContext,
  AuthMembership,
  AuthRepository,
  AuthUser,
  RefreshLookup,
  SessionCreation,
} from './auth.types.js';

function first<T>(rows: readonly T[]): T | undefined {
  return rows[0];
}

export class PostgresAuthRepository implements AuthRepository {
  public constructor(private readonly database: DatabaseClient) {}

  public async findUserByNormalizedEmail(email: string): Promise<AuthUser | null> {
    const result = await this.database.pool.query<{
      id: string;
      email: string;
      display_name: string;
      password_hash: string | null;
      status: string;
    }>(
      'select id, email, display_name, password_hash, status from users where normalized_email = $1',
      [email],
    );
    const row = first(result.rows);
    return row === undefined
      ? null
      : {
          id: row.id,
          email: row.email,
          displayName: row.display_name,
          passwordHash: row.password_hash,
          status: row.status,
        };
  }

  public async listActiveMemberships(userId: string): Promise<readonly AuthMembership[]> {
    const result = await this.database.pool.query<{
      id: string;
      company_id: string;
      company_name: string;
      status: string;
    }>(
      `select m.id, m.company_id, c.display_name as company_name, m.status
       from company_memberships m join companies c on c.id = m.company_id
       where m.user_id = $1 and m.status = 'active' and c.status = 'active'
       order by c.display_name, m.id`,
      [userId],
    );
    return result.rows.map((row) => ({
      id: row.id,
      companyId: row.company_id,
      companyName: row.company_name,
      status: row.status,
    }));
  }

  public async resolveContext(input: {
    userId: string;
    membershipId: string;
    companyId: string;
    branchId?: string | undefined;
    deviceId?: string | undefined;
  }): Promise<Omit<AuthContext, 'sessionId' | 'expiresAt'> | null> {
    const membership = await this.database.pool.query(
      `select 1 from company_memberships m join users u on u.id = m.user_id join companies c on c.id = m.company_id
       where m.id = $1 and m.company_id = $2 and m.user_id = $3 and m.status = 'active' and u.status = 'active' and c.status = 'active'`,
      [input.membershipId, input.companyId, input.userId],
    );
    if (membership.rowCount !== 1) return null;

    let branchId = input.branchId;
    if (input.deviceId !== undefined) {
      const device = await this.database.pool.query<{ branch_id: string | null }>(
        `select branch_id from devices where id = $1 and company_id = $2 and status = 'active' and revoked_at is null`,
        [input.deviceId, input.companyId],
      );
      const deviceRow = first(device.rows);
      if (
        deviceRow === undefined ||
        (branchId !== undefined && deviceRow.branch_id !== null && deviceRow.branch_id !== branchId)
      )
        return null;
      branchId ??= deviceRow.branch_id ?? undefined;
    }

    const companyWide = await this.database.pool.query(
      `select 1 from user_roles ur join roles r on r.id = ur.role_id and r.company_id = ur.company_id
       where ur.membership_id = $1 and ur.company_id = $2 and ur.branch_id is null and r.status = 'active' limit 1`,
      [input.membershipId, input.companyId],
    );
    const branches = await this.database.pool.query<{ id: string }>(
      companyWide.rowCount === 1
        ? `select id from branches where company_id = $1 and status = 'active' order by id`
        : `select distinct b.id from user_roles ur join roles r on r.id = ur.role_id and r.company_id = ur.company_id
           join branches b on b.id = ur.branch_id and b.company_id = ur.company_id
           where ur.membership_id = $1 and ur.company_id = $2 and r.status = 'active' and b.status = 'active' order by b.id`,
      companyWide.rowCount === 1 ? [input.companyId] : [input.membershipId, input.companyId],
    );
    const permittedBranchIds = branches.rows.map((row) => row.id);
    if (branchId !== undefined && !permittedBranchIds.includes(branchId)) return null;

    const permissions = await this.database.pool.query<{ code: string }>(
      `select distinct p.code from user_roles ur
       join roles r on r.id = ur.role_id and r.company_id = ur.company_id and r.status = 'active'
       join role_permissions rp on rp.role_id = r.id and rp.company_id = r.company_id
       join permissions p on p.id = rp.permission_id
       where ur.membership_id = $1 and ur.company_id = $2 and (ur.branch_id is null or ur.branch_id = $3)
       order by p.code`,
      [input.membershipId, input.companyId, branchId ?? null],
    );
    return {
      userId: input.userId,
      membershipId: input.membershipId,
      companyId: input.companyId,
      ...(branchId === undefined ? {} : { branchId }),
      ...(input.deviceId === undefined ? {} : { deviceId: input.deviceId }),
      permissions: permissions.rows.map((row) => row.code),
      permittedBranchIds,
    };
  }

  public async createSession(input: SessionCreation): Promise<string> {
    const id = randomUUID();
    const client = await this.database.pool.connect();
    try {
      await client.query('begin');
      await client.query(
        `insert into sessions (id, company_id, user_id, membership_id, branch_id, device_id, token_hash, status, expires_at, token_family_id, token_generation) values ($1,$2,$3,$4,$5,$6,$7,'active',$8,$9,0)`,
        [
          id,
          input.companyId,
          input.userId,
          input.membershipId,
          input.branchId ?? null,
          input.deviceId ?? null,
          input.tokenHash,
          input.expiresAt,
          input.tokenFamilyId,
        ],
      );
      await client.query(
        `insert into session_refresh_tokens (id, session_id, token_hash, generation, status, expires_at) values ($1,$2,$3,0,'active',$4)`,
        [randomUUID(), id, input.tokenHash, input.expiresAt],
      );
      await client.query('commit');
    } catch (error) {
      await client.query('rollback');
      throw error;
    } finally {
      client.release();
    }
    return id;
  }

  public async findRefreshToken(tokenHash: string): Promise<RefreshLookup | null> {
    const token = await this.database.pool.query<{
      session_id: string;
      generation: number;
      expires_at: Date;
      token_status: string;
      session_status: string;
    }>(
      `select t.session_id, t.generation, t.expires_at, t.status token_status, s.status session_status
       from session_refresh_tokens t join sessions s on s.id = t.session_id where t.token_hash = $1`,
      [tokenHash],
    );
    const row = first(token.rows);
    if (row === undefined) return null;
    const context = await this.contextForSession(row.session_id, false);
    return context === null
      ? null
      : {
          context,
          generation: row.generation,
          refreshExpiresAt: row.expires_at,
          status: row.session_status,
          tokenStatus: row.token_status,
        };
  }

  public async rotateRefreshToken(input: {
    sessionId: string;
    previousHash: string;
    nextHash: string;
    nextGeneration: number;
    expiresAt: Date;
  }): Promise<'rotated' | 'reused' | 'invalid'> {
    const client = await this.database.pool.connect();
    try {
      await client.query('begin');
      const token = await client.query<{ status: string }>(
        'select status from session_refresh_tokens where session_id = $1 and token_hash = $2 for update',
        [input.sessionId, input.previousHash],
      );
      const row = first(token.rows);
      if (row === undefined) {
        await client.query('rollback');
        return 'invalid';
      }
      if (row.status !== 'active') {
        await client.query(
          `update sessions set status='revoked', revoked_at=now(), reuse_detected_at=now(), revocation_reason='refresh_token_reuse', updated_at=now() where id=$1`,
          [input.sessionId],
        );
        await client.query(
          `update session_refresh_tokens set status=case when token_hash=$2 then 'reused' else 'revoked' end, reused_at=case when token_hash=$2 then now() else reused_at end where session_id=$1 and status <> 'reused'`,
          [input.sessionId, input.previousHash],
        );
        await client.query('commit');
        return 'reused';
      }
      await client.query(
        `update session_refresh_tokens set status='rotated', rotated_at=now() where session_id=$1 and token_hash=$2`,
        [input.sessionId, input.previousHash],
      );
      await client.query(
        `insert into session_refresh_tokens (id,session_id,token_hash,generation,status,expires_at) values ($1,$2,$3,$4,'active',$5)`,
        [randomUUID(), input.sessionId, input.nextHash, input.nextGeneration, input.expiresAt],
      );
      await client.query(
        `update sessions set token_hash=$2, token_generation=$3, last_used_at=now(), updated_at=now() where id=$1 and status='active'`,
        [input.sessionId, input.nextHash, input.nextGeneration],
      );
      await client.query('commit');
      return 'rotated';
    } catch (error) {
      await client.query('rollback');
      throw error;
    } finally {
      client.release();
    }
  }

  public findSession(sessionId: string): Promise<AuthContext | null> {
    return this.contextForSession(sessionId, true);
  }

  public async revokeSession(sessionId: string, reason: string): Promise<boolean> {
    const result = await this.database.pool.query(
      `update sessions set status='revoked', revoked_at=coalesce(revoked_at,now()), revocation_reason=coalesce(revocation_reason,$2), updated_at=now() where id=$1 and status='active'`,
      [sessionId, reason],
    );
    await this.database.pool.query(
      `update session_refresh_tokens set status='revoked' where session_id=$1 and status='active'`,
      [sessionId],
    );
    return result.rowCount === 1;
  }

  public async revokeUserSessions(
    userId: string,
    companyId: string,
    exceptSessionId?: string,
  ): Promise<number> {
    const result = await this.database.pool.query<{ id: string }>(
      `update sessions set status='revoked', revoked_at=now(), revocation_reason='logout_all', updated_at=now() where user_id=$1 and company_id=$2 and status='active' and ($3::uuid is null or id<>$3) returning id`,
      [userId, companyId, exceptSessionId ?? null],
    );
    if (result.rows.length > 0)
      await this.database.pool.query(
        `update session_refresh_tokens set status='revoked' where session_id = any($1::uuid[]) and status='active'`,
        [result.rows.map((row) => row.id)],
      );
    return result.rows.length;
  }

  public async getSafeIdentity(userId: string): Promise<Readonly<Record<string, unknown>> | null> {
    const user = await this.database.pool.query<{
      id: string;
      email: string;
      display_name: string;
      status: string;
    }>('select id,email,display_name,status from users where id=$1', [userId]);
    const row = first(user.rows);
    if (row === undefined) return null;
    const memberships = await this.listActiveMemberships(userId);
    return {
      id: row.id,
      email: row.email,
      display_name: row.display_name,
      status: row.status,
      memberships,
    };
  }

  public async audit(input: {
    companyId: string;
    branchId?: string | undefined;
    actorId: string;
    action: string;
    entityId?: string | undefined;
    metadata?: Readonly<Record<string, unknown>> | undefined;
  }): Promise<void> {
    await this.database.pool.query(
      `insert into audit_log (id,company_id,branch_id,actor_type,actor_id,action,entity_type,entity_id,metadata) values ($1,$2,$3,'user',$4,$5,'session',$6,$7::jsonb)`,
      [
        randomUUID(),
        input.companyId,
        input.branchId ?? null,
        input.actorId,
        input.action,
        input.entityId ?? null,
        JSON.stringify(input.metadata ?? {}),
      ],
    );
  }

  private async contextForSession(
    sessionId: string,
    activeOnly: boolean,
  ): Promise<AuthContext | null> {
    const result = await this.database.pool.query<{
      id: string;
      user_id: string;
      membership_id: string;
      company_id: string;
      branch_id: string | null;
      device_id: string | null;
      expires_at: Date;
    }>(
      `select id,user_id,membership_id,company_id,branch_id,device_id,expires_at from sessions where id=$1 ${activeOnly ? "and status='active' and expires_at>now()" : ''}`,
      [sessionId],
    );
    const row = first(result.rows);
    if (row === undefined) return null;
    const resolved = await this.resolveContext({
      userId: row.user_id,
      membershipId: row.membership_id,
      companyId: row.company_id,
      branchId: row.branch_id ?? undefined,
      deviceId: row.device_id ?? undefined,
    });
    return resolved === null ? null : { ...resolved, sessionId: row.id, expiresAt: row.expires_at };
  }
}
