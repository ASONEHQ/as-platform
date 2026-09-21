/// TASK 15.1 (Phase 2) launch-blocker fix regression test — see
/// `identity.routes.ts`'s own doc comment on the new
/// `GET /api/v1/roles/:role_id/permissions` route it adds. Lightweight
/// `Fastify()` + `app.inject` unit test against a mocked
/// `AdministrationService`/`AuthService`, mirroring
/// `settings.routes.test.ts`'s exact fixture convention — no real database
/// required (unlike `admin.integration.test.ts`, which already covers the
/// underlying `AdministrationService.rolePermissions` method itself against
/// a real Postgres instance).
import Fastify, { type FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { AppError } from '@asone/errors';

import type { AuthService } from '../../auth/auth.service.js';
import type { AuthContext } from '../../auth/auth.types.js';
import { registerIdentityAdministrationRoutes } from './identity.routes.js';
import type { AdministrationService } from '../shared/admin.service.js';

const companyId = '00000000-0000-4000-8000-000000000001';
const branchId = '00000000-0000-4000-8000-000000000002';
const userId = '00000000-0000-4000-8000-000000000003';
const roleId = '00000000-0000-4000-8000-000000000005';

function authContext(permissions: readonly string[]): AuthContext {
  return {
    sessionId: 'session-1',
    userId,
    membershipId: 'membership-1',
    companyId,
    branchId,
    expiresAt: new Date('2026-07-26T13:00:00.000Z'),
    permissions,
    permittedBranchIds: [branchId],
  };
}

interface ServiceDouble {
  rolePermissions: ReturnType<typeof vi.fn>;
  listRoleTemplates: ReturnType<typeof vi.fn>;
}

const apps: FastifyInstance[] = [];

function fixture(permissions: readonly string[]): { app: FastifyInstance; service: ServiceDouble } {
  const app = Fastify();
  apps.push(app);
  app.addHook('onRequest', (request, _reply, done) => {
    request.requestContext = {
      requestId: 'request-1',
      correlationId: 'correlation-1',
      companyId: undefined,
      branchId: undefined,
      userId: undefined,
      sessionId: undefined,
      deviceId: undefined,
    };
    done();
  });
  app.setErrorHandler((error, request, reply) => {
    if (error instanceof AppError)
      return reply.code(error.statusCode).send({
        error: { code: error.code, message: error.message },
        meta: {
          request_id: request.requestContext.requestId,
          correlation_id: request.requestContext.correlationId,
        },
      });
    return reply.code(500).send({ error: { code: 'internal_error' } });
  });
  const context = authContext(permissions);
  const authentication = {
    authenticate: vi.fn(() => Promise.resolve(context)),
    requirePermission: vi.fn((_context: AuthContext, permission: string) => {
      if (!context.permissions.includes(permission))
        throw new AppError({ code: 'permission_denied', message: 'Permission denied.', statusCode: 403 });
    }),
  } as unknown as AuthService;
  const service: ServiceDouble = {
    // Mirrors `AdministrationService.rolePermissions`'s own real shape
    // (`admin.service.ts:483-493`): the permission gate lives INSIDE the
    // service method, not the route, so this double must replicate that
    // check to prove the route wiring stays honestly gated end to end —
    // a double that always resolves would pass even if the route dropped
    // its `context` (and thus the permission check) entirely.
    rolePermissions: vi.fn((actor: { context: AuthContext }) => {
      if (!actor.context.permissions.includes('role.read'))
        throw new AppError({ code: 'permission_denied', message: 'Permission denied.', statusCode: 403 });
      return Promise.resolve([
        { id: 'perm-1', code: 'sale.read', description: 'Read sales', domain: 'sale', effect: 'allow' },
        { id: 'perm-2', code: 'sale.create', description: 'Create sales', domain: 'sale', effect: 'allow' },
      ]);
    }),
    // TASK 16.16 — mirrors `rolePermissions` above exactly: the gate lives
    // inside the (real) service method (`role.read`), so this double
    // replicates it to prove the route never drops `context` on its way
    // through.
    listRoleTemplates: vi.fn((actor: { context: AuthContext }) => {
      if (!actor.context.permissions.includes('role.read'))
        throw new AppError({ code: 'permission_denied', message: 'Permission denied.', statusCode: 403 });
      return [
        { key: 'cashier', label: 'Cajero', description: 'Solo caja.', permissionCodes: ['sale.create'] },
      ];
    }),
  };
  registerIdentityAdministrationRoutes(app, authentication, service as unknown as AdministrationService);
  return { app, service };
}

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
});

describe('GET /api/v1/roles/:role_id/permissions', () => {
  it('reads a role permissions without mutating them, requiring only role.read', async () => {
    const { app, service } = fixture(['role.read']);
    const response = await app.inject({
      method: 'GET',
      url: `/api/v1/roles/${roleId}/permissions`,
      headers: { authorization: 'Bearer token' },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      data: {
        items: [
          { code: 'sale.read', effect: 'allow' },
          { code: 'sale.create', effect: 'allow' },
        ],
      },
    });
    expect(service.rolePermissions).toHaveBeenCalledOnce();
    expect(service.rolePermissions).toHaveBeenCalledWith(expect.anything(), roleId);
  });

  it('403s permission_denied without role.read — never leaks the permission list', async () => {
    const { app, service } = fixture([]);
    const response = await app.inject({
      method: 'GET',
      url: `/api/v1/roles/${roleId}/permissions`,
      headers: { authorization: 'Bearer token' },
    });

    expect(response.statusCode).toBe(403);
    expect(response.json<{ error: { code: string } }>().error.code).toBe('permission_denied');
    // The service's own `requirePermission(..., 'role.read')` check is what
    // rejects this (mirroring `admin.service.ts:483-493` — the same real
    // gate `rolePermissions` has always had), so the double IS invoked and
    // throws; no data leaks in the response either way.
    expect(service.rolePermissions).toHaveBeenCalledOnce();
    expect(response.json()).not.toHaveProperty('data.items');
  });
});

describe('GET /api/v1/role-templates (TASK 16.16)', () => {
  it('lists the starter permission-bundle catalogue, snake-casing permission_codes, requiring only role.read', async () => {
    const { app, service } = fixture(['role.read']);
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/role-templates',
      headers: { authorization: 'Bearer token' },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      data: {
        items: [{ key: 'cashier', label: 'Cajero', description: 'Solo caja.', permission_codes: ['sale.create'] }],
      },
    });
    expect(service.listRoleTemplates).toHaveBeenCalledOnce();
  });

  it('403s permission_denied without role.read', async () => {
    const { app, service } = fixture([]);
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/role-templates',
      headers: { authorization: 'Bearer token' },
    });

    expect(response.statusCode).toBe(403);
    expect(response.json<{ error: { code: string } }>().error.code).toBe('permission_denied');
    expect(response.json()).not.toHaveProperty('data.items');
  });
});
