import type { FastifyInstance } from 'fastify';

import { successResponse } from '../../../http/response.js';
import { requireAuthenticatedUser } from '../../auth/auth.guards.js';
import type { AuthService } from '../../auth/auth.service.js';
import type { AdministrationService } from '../shared/admin.service.js';

export function registerIdentityAdministrationRoutes(
  app: FastifyInstance,
  authentication: AuthService,
  administration: AdministrationService,
): void {
  app.get('/api/v1/users', async (request) => {
    const context = await requireAuthenticatedUser(request, authentication);
    return successResponse(
      {
        items: await administration.listUsers({
          context,
          requestId: request.requestContext.requestId,
          correlationId: request.requestContext.correlationId,
        }),
      },
      request.requestContext,
    );
  });
  app.post<{ Body: { email: string; display_name: string } }>(
    '/api/v1/users',
    {
      schema: {
        body: {
          type: 'object',
          additionalProperties: false,
          required: ['email', 'display_name'],
          properties: {
            email: { type: 'string', format: 'email', maxLength: 320 },
            display_name: { type: 'string', minLength: 1, maxLength: 200 },
          },
        },
      },
    },
    async (request, reply) => {
      const context = await requireAuthenticatedUser(request, authentication);
      return reply.code(201).send(
        successResponse(
          await administration.createUser(
            {
              context,
              requestId: request.requestContext.requestId,
              correlationId: request.requestContext.correlationId,
            },
            { email: request.body.email, displayName: request.body.display_name },
          ),
          request.requestContext,
        ),
      );
    },
  );
  app.get<{
    Params: { user_id: string };
    Querystring: { include?: string };
  }>('/api/v1/users/:user_id', async (request) => {
    const context = await requireAuthenticatedUser(request, authentication);
    const includes = (request.query.include ?? '')
      .split(',')
      .filter((value): value is 'roles' | 'branches' => value === 'roles' || value === 'branches');
    return successResponse(
      await administration.userDetail(
        {
          context,
          requestId: request.requestContext.requestId,
          correlationId: request.requestContext.correlationId,
        },
        request.params.user_id,
        includes,
      ),
      request.requestContext,
    );
  });
  app.patch<{
    Params: { user_id: string };
    Body: { membership_status: 'active' | 'suspended' | 'disabled' };
  }>(
    '/api/v1/users/:user_id',
    {
      schema: {
        body: {
          type: 'object',
          additionalProperties: false,
          required: ['membership_status'],
          properties: { membership_status: { enum: ['active', 'suspended', 'disabled'] } },
        },
      },
    },
    async (request) => {
      const context = await requireAuthenticatedUser(request, authentication);
      await administration.updateMembership(
        {
          context,
          requestId: request.requestContext.requestId,
          correlationId: request.requestContext.correlationId,
        },
        request.params.user_id,
        request.body.membership_status,
      );
      return successResponse(
        { id: request.params.user_id, membership_status: request.body.membership_status },
        request.requestContext,
      );
    },
  );
  app.get('/api/v1/roles', async (request) => {
    const context = await requireAuthenticatedUser(request, authentication);
    return successResponse(
      {
        items: await administration.listRoles({
          context,
          requestId: request.requestContext.requestId,
          correlationId: request.requestContext.correlationId,
        }),
      },
      request.requestContext,
    );
  });
  app.post<{ Body: { name: string; code: string; description?: string } }>(
    '/api/v1/roles',
    async (request, reply) => {
      const context = await requireAuthenticatedUser(request, authentication);
      return reply.code(201).send(
        successResponse(
          await administration.createRole(
            {
              context,
              requestId: request.requestContext.requestId,
              correlationId: request.requestContext.correlationId,
            },
            request.body,
          ),
          request.requestContext,
        ),
      );
    },
  );
  app.get<{ Params: { role_id: string } }>('/api/v1/roles/:role_id', async (request) => {
    const context = await requireAuthenticatedUser(request, authentication);
    return successResponse(
      await administration.role(
        {
          context,
          requestId: request.requestContext.requestId,
          correlationId: request.requestContext.correlationId,
        },
        request.params.role_id,
      ),
      request.requestContext,
    );
  });
  app.patch<{
    Params: { role_id: string };
    Body: { name?: string; description?: string; status?: string };
  }>('/api/v1/roles/:role_id', async (request) => {
    const context = await requireAuthenticatedUser(request, authentication);
    return successResponse(
      await administration.updateRole(
        {
          context,
          requestId: request.requestContext.requestId,
          correlationId: request.requestContext.correlationId,
        },
        request.params.role_id,
        request.body,
      ),
      request.requestContext,
    );
  });
  app.put<{
    Params: { role_id: string };
    Body: { permissions: { permission_id: string; effect: 'allow' | 'deny' }[] };
  }>('/api/v1/roles/:role_id/permissions', async (request) => {
    const context = await requireAuthenticatedUser(request, authentication);
    await administration.replaceRolePermissions(
      {
        context,
        requestId: request.requestContext.requestId,
        correlationId: request.requestContext.correlationId,
      },
      request.params.role_id,
      request.body.permissions.map((item) => ({
        permissionId: item.permission_id,
        effect: item.effect,
      })),
    );
    return successResponse(
      {
        items: await administration.rolePermissions(
          {
            context,
            requestId: request.requestContext.requestId,
            correlationId: request.requestContext.correlationId,
          },
          request.params.role_id,
        ),
      },
      request.requestContext,
    );
  });
  app.get('/api/v1/permissions', async (request) => {
    const context = await requireAuthenticatedUser(request, authentication);
    return successResponse(
      {
        items: await administration.listPermissions({
          context,
          requestId: request.requestContext.requestId,
          correlationId: request.requestContext.correlationId,
        }),
      },
      request.requestContext,
    );
  });
  app.delete<{ Params: { user_id: string; assignment_id: string } }>(
    '/api/v1/users/:user_id/roles/:assignment_id',
    async (request, reply) => {
      const context = await requireAuthenticatedUser(request, authentication);
      await administration.revokeRoleAssignment(
        {
          context,
          requestId: request.requestContext.requestId,
          correlationId: request.requestContext.correlationId,
        },
        request.params.user_id,
        request.params.assignment_id,
      );
      return reply.code(204).send();
    },
  );
  app.post<{ Params: { user_id: string }; Body: { role_id: string; branch_id?: string } }>(
    '/api/v1/users/:user_id/roles',
    {
      schema: {
        body: {
          type: 'object',
          additionalProperties: false,
          required: ['role_id'],
          properties: {
            role_id: { type: 'string', format: 'uuid' },
            branch_id: { type: 'string', format: 'uuid' },
          },
        },
      },
    },
    async (request, reply) => {
      const context = await requireAuthenticatedUser(request, authentication);
      return reply.code(201).send(
        successResponse(
          await administration.assignRole(
            {
              context,
              requestId: request.requestContext.requestId,
              correlationId: request.requestContext.correlationId,
            },
            request.params.user_id,
            { roleId: request.body.role_id, branchId: request.body.branch_id },
          ),
          request.requestContext,
        ),
      );
    },
  );
  app.put<{
    Params: { user_id: string; branch_id: string };
    Body: { status: 'active' | 'revoked'; is_default: boolean };
  }>(
    '/api/v1/users/:user_id/branch-access/:branch_id',
    {
      schema: {
        body: {
          type: 'object',
          additionalProperties: false,
          required: ['status', 'is_default'],
          properties: { status: { enum: ['active', 'revoked'] }, is_default: { type: 'boolean' } },
        },
      },
    },
    async (request, reply) => {
      const context = await requireAuthenticatedUser(request, authentication);
      const changed = await administration.changeBranchAccess(
        {
          context,
          requestId: request.requestContext.requestId,
          correlationId: request.requestContext.correlationId,
        },
        request.params.user_id,
        request.params.branch_id,
        { status: request.body.status, isDefault: request.body.is_default },
      );
      return reply
        .code(changed.created ? 201 : 200)
        .send(successResponse(changed.access, request.requestContext));
    },
  );
  app.delete<{ Params: { user_id: string; branch_id: string } }>(
    '/api/v1/users/:user_id/branch-access/:branch_id',
    async (request, reply) => {
      const context = await requireAuthenticatedUser(request, authentication);
      await administration.revokeBranchAccess(
        {
          context,
          requestId: request.requestContext.requestId,
          correlationId: request.requestContext.correlationId,
        },
        request.params.user_id,
        request.params.branch_id,
      );
      return reply.code(204).send();
    },
  );
}
