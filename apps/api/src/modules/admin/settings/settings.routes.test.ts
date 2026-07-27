import Fastify, { type FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { AppError } from '@asone/errors';

import type { AuthService } from '../../auth/auth.service.js';
import type { AuthContext } from '../../auth/auth.types.js';
import { registerSettingsRoutes } from './settings.routes.js';
import type { SettingsService } from './settings.service.js';
import { SettingsError } from './settings.types.js';

const companyId = '00000000-0000-4000-8000-000000000001';
const branchId = '00000000-0000-4000-8000-000000000002';
const userId = '00000000-0000-4000-8000-000000000003';
const settingId = '00000000-0000-4000-8000-000000000004';
const checkpoint = `settings:${'a'.repeat(64)}`;

interface ServiceDouble {
  effectiveCompanySettings: ReturnType<typeof vi.fn>;
  effectiveBranchSettings: ReturnType<typeof vi.fn>;
  mutateCompanySetting: ReturnType<typeof vi.fn>;
  mutateBranchSetting: ReturnType<typeof vi.fn>;
}

const apps: FastifyInstance[] = [];

function context(
  permissions: readonly string[],
  permittedBranchIds: readonly string[] = [branchId],
): AuthContext {
  return {
    sessionId: 'session-1',
    userId,
    membershipId: 'membership-1',
    companyId,
    branchId,
    expiresAt: new Date('2026-07-26T13:00:00.000Z'),
    permissions,
    permittedBranchIds,
  };
}

async function fixture(
  options: {
    readonly permissions?: readonly string[];
    readonly permittedBranchIds?: readonly string[];
  } = {},
): Promise<{ app: FastifyInstance; service: ServiceDouble }> {
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
  const authContext = context(
    options.permissions ?? [
      'company_settings.read',
      'company_settings.update',
      'branch_settings.read',
      'branch_settings.update',
    ],
    options.permittedBranchIds,
  );
  const authentication = {
    authenticate: vi.fn(() => Promise.resolve(authContext)),
    requirePermission: vi.fn((_context: AuthContext, permission: string) => {
      if (!authContext.permissions.includes(permission))
        throw new AppError({
          code: 'permission_denied',
          message: 'Permission denied.',
          statusCode: 403,
        });
    }),
  } as unknown as AuthService;
  const effective = {
    settings: [
      {
        key: 'business.locale',
        type: 'string',
        value: 'es-MX',
        source: 'default',
        version: 1n,
      },
    ],
    checkpoint,
  };
  const persisted = {
    id: settingId,
    key: 'business.locale',
    value: 'en-US',
    valueType: 'string',
    status: 'active',
    version: 2n,
    createdAt: new Date('2026-07-26T00:00:00.000Z'),
    updatedAt: new Date('2026-07-26T00:00:00.000Z'),
    deletedAt: null,
  };
  const service: ServiceDouble = {
    effectiveCompanySettings: vi.fn(() => Promise.resolve(effective)),
    effectiveBranchSettings: vi.fn(() => Promise.resolve(effective)),
    mutateCompanySetting: vi.fn((_scope, _input, status: 'active' | 'retired') =>
      Promise.resolve({
        persisted:
          status === 'active' ? persisted : { ...persisted, status: 'retired', version: 3n },
        effective: effective.settings[0],
      }),
    ),
    mutateBranchSetting: vi.fn((_scope, _input, status: 'active' | 'retired') =>
      Promise.resolve({
        persisted:
          status === 'active' ? persisted : { ...persisted, status: 'retired', version: 3n },
        effective: effective.settings[0],
      }),
    ),
  };
  registerSettingsRoutes(app, authentication, service as unknown as SettingsService);
  await app.ready();
  return { app, service };
}

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
});

describe('settings HTTP routes', () => {
  it('serves E016 with all keys or a normalized subset and private ETag', async () => {
    const { app, service } = await fixture();
    const all = await app.inject({
      method: 'GET',
      url: `/api/v1/companies/${companyId}/settings/effective`,
      headers: { authorization: 'Bearer token' },
    });
    expect(all.statusCode).toBe(200);
    expect(all.headers.etag).toBe(`"${checkpoint}"`);
    expect(all.headers['cache-control']).toBe('private, no-cache');
    expect(all.json()).toMatchObject({
      data: { company_id: companyId, checkpoint },
      meta: { request_id: 'request-1', correlation_id: 'correlation-1' },
    });
    expect(service.effectiveCompanySettings).toHaveBeenCalledWith({ companyId }, undefined);

    await app.inject({
      method: 'GET',
      url: `/api/v1/companies/${companyId}/settings/effective?keys=ui.time_format,business.locale`,
      headers: { authorization: 'Bearer token' },
    });
    expect(service.effectiveCompanySettings).toHaveBeenLastCalledWith({ companyId }, [
      'ui.time_format',
      'business.locale',
    ]);
  });

  it('returns E016 304 without a body and retains ETag', async () => {
    const { app } = await fixture();
    const response = await app.inject({
      method: 'GET',
      url: `/api/v1/companies/${companyId}/settings/effective`,
      headers: { authorization: 'Bearer token', 'if-none-match': `W/"${checkpoint}"` },
    });
    expect(response.statusCode).toBe(304);
    expect(response.body).toBe('');
    expect(response.headers.etag).toBe(`"${checkpoint}"`);
  });

  it('rejects E016 tenant mismatch and missing permission', async () => {
    const { app } = await fixture();
    const mismatch = await app.inject({
      method: 'GET',
      url: '/api/v1/companies/00000000-0000-4000-8000-000000000099/settings/effective',
      headers: { authorization: 'Bearer token' },
    });
    expect(mismatch.statusCode).toBe(403);
    expect(mismatch.json<{ error: { code: string } }>().error.code).toBe('company_scope_mismatch');

    const denied = await fixture({ permissions: [] });
    const response = await denied.app.inject({
      method: 'GET',
      url: `/api/v1/companies/${companyId}/settings/effective`,
      headers: { authorization: 'Bearer token' },
    });
    expect(response.statusCode).toBe(403);
    expect(response.json<{ error: { code: string } }>().error.code).toBe('permission_denied');
  });

  it('implements E017 active and retired mutations with response ETags', async () => {
    const { app, service } = await fixture();
    const active = await app.inject({
      method: 'PUT',
      url: `/api/v1/companies/${companyId}/settings/business.locale`,
      headers: {
        authorization: 'Bearer token',
        'content-type': 'application/json',
        'if-match': '"1"',
      },
      payload: { value: 'en-US', value_type: 'string', status: 'active' },
    });
    expect(active.statusCode).toBe(200);
    expect(active.headers.etag).toBe('"2"');
    expect(service.mutateCompanySetting).toHaveBeenCalledOnce();

    const retired = await app.inject({
      method: 'PUT',
      url: `/api/v1/companies/${companyId}/settings/business.locale`,
      headers: {
        authorization: 'Bearer token',
        'content-type': 'application/json',
        'if-match': '"2"',
      },
      payload: { value: 'en-US', value_type: 'string', status: 'retired' },
    });
    expect(retired.statusCode).toBe(200);
    expect(retired.headers.etag).toBe('"3"');
    expect(service.mutateCompanySetting).toHaveBeenCalledTimes(2);
  });

  it('rejects invalid E017 bodies and maps stale versions centrally', async () => {
    const { app, service } = await fixture();
    const extra = await app.inject({
      method: 'PUT',
      url: `/api/v1/companies/${companyId}/settings/business.locale`,
      headers: {
        authorization: 'Bearer token',
        'content-type': 'application/json',
        'if-match': '"1"',
      },
      payload: {
        value: 'en-US',
        value_type: 'string',
        status: 'active',
        company_id: companyId,
      },
    });
    expect(extra.statusCode).toBe(400);

    service.mutateCompanySetting.mockRejectedValueOnce(
      new SettingsError('version_conflict', 'stale'),
    );
    const stale = await app.inject({
      method: 'PUT',
      url: `/api/v1/companies/${companyId}/settings/business.locale`,
      headers: {
        authorization: 'Bearer token',
        'content-type': 'application/json',
        'if-match': '"1"',
      },
      payload: { value: 'en-US', value_type: 'string', status: 'active' },
    });
    expect(stale.statusCode).toBe(409);
    expect(stale.json<{ error: { code: string } }>().error.code).toBe('version_conflict');
  });

  it('implements E018 with explicit branch access and 304', async () => {
    const { app } = await fixture();
    const response = await app.inject({
      method: 'GET',
      url: `/api/v1/branches/${branchId}/settings/effective`,
      headers: { authorization: 'Bearer token' },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json<{ data: { company_id: string; branch_id: string } }>().data).toMatchObject(
      { company_id: companyId, branch_id: branchId },
    );

    const cached = await app.inject({
      method: 'GET',
      url: `/api/v1/branches/${branchId}/settings/effective`,
      headers: { authorization: 'Bearer token', 'if-none-match': `"${checkpoint}"` },
    });
    expect(cached.statusCode).toBe(304);
    expect(cached.body).toBe('');
  });

  it('maps E018/E019 branch access, prohibited override, and retirement', async () => {
    const noAccess = await fixture({ permittedBranchIds: [] });
    noAccess.service.effectiveBranchSettings.mockRejectedValueOnce(
      new SettingsError('branch_access_denied', 'denied'),
    );
    const denied = await noAccess.app.inject({
      method: 'GET',
      url: `/api/v1/branches/${branchId}/settings/effective`,
      headers: { authorization: 'Bearer token' },
    });
    expect(denied.statusCode).toBe(403);
    expect(denied.json<{ error: { code: string } }>().error.code).toBe('branch_scope_mismatch');

    const valid = await fixture();
    valid.service.mutateBranchSetting.mockRejectedValueOnce(
      new SettingsError('branch_override_not_allowed', 'not allowed'),
    );
    const prohibited = await valid.app.inject({
      method: 'PUT',
      url: `/api/v1/branches/${branchId}/settings/business.currency`,
      headers: {
        authorization: 'Bearer token',
        'content-type': 'application/json',
        'if-match': '"1"',
      },
      payload: { value: 'USD', value_type: 'string', status: 'active' },
    });
    expect(prohibited.statusCode).toBe(400);
    expect(prohibited.json<{ error: { code: string } }>().error.code).toBe('validation_error');

    const retired = await valid.app.inject({
      method: 'PUT',
      url: `/api/v1/branches/${branchId}/settings/business.locale`,
      headers: {
        authorization: 'Bearer token',
        'content-type': 'application/json',
        'if-match': '"2"',
      },
      payload: { value: 'en-US', value_type: 'string', status: 'retired' },
    });
    expect(retired.statusCode).toBe(200);
    expect(valid.service.mutateBranchSetting).toHaveBeenCalledTimes(2);
  });

  it('maps hidden cross-tenant branches and stale E019 versions', async () => {
    const hidden = await fixture();
    hidden.service.effectiveBranchSettings.mockRejectedValueOnce(
      new SettingsError('branch_not_found', 'hidden'),
    );
    const external = await hidden.app.inject({
      method: 'GET',
      url: `/api/v1/branches/${branchId}/settings/effective`,
      headers: { authorization: 'Bearer token' },
    });
    expect(external.statusCode).toBe(404);
    expect(external.json<{ error: { code: string } }>().error.code).toBe('not_found');

    const staleFixture = await fixture();
    staleFixture.service.mutateBranchSetting.mockRejectedValueOnce(
      new SettingsError('version_conflict', 'stale'),
    );
    const stale = await staleFixture.app.inject({
      method: 'PUT',
      url: `/api/v1/branches/${branchId}/settings/business.locale`,
      headers: {
        authorization: 'Bearer token',
        'content-type': 'application/json',
        'if-match': '"2"',
      },
      payload: { value: 'en-US', value_type: 'string', status: 'active' },
    });
    expect(stale.statusCode).toBe(409);
    expect(stale.json<{ error: { code: string } }>().error.code).toBe('version_conflict');
  });
});
