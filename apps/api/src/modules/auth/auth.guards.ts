import type { FastifyRequest } from 'fastify';

import { AppError } from '@asone/errors';

import type { AuthService } from './auth.service.js';
import type { AuthContext } from './auth.types.js';

export async function requireAuthenticatedUser(
  request: FastifyRequest,
  service: AuthService,
): Promise<AuthContext> {
  const authorization = request.headers.authorization;
  if (!authorization?.startsWith('Bearer ')) {
    throw new AppError({
      code: 'authentication_required',
      message: 'Authentication is required.',
      statusCode: 401,
    });
  }
  const context = await service.authenticate(authorization.slice(7));
  request.authContext = context;
  return context;
}

export function requireActiveMembership(context: AuthContext): void {
  if (context.membershipId.length === 0 || context.companyId.length === 0) {
    throw new AppError({
      code: 'company_scope_mismatch',
      message: 'An active company membership is required.',
      statusCode: 403,
    });
  }
}

export function requirePermission(
  service: AuthService,
  context: AuthContext,
  permission: string,
): void {
  requireActiveMembership(context);
  service.requirePermission(context, permission);
}

export function requireBranchAccess(
  service: AuthService,
  context: AuthContext,
  branchId: string,
): void {
  requireActiveMembership(context);
  service.requireBranchAccess(context, branchId);
}
