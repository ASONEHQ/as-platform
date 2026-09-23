import type { FastifyInstance } from 'fastify';

import { AppError } from '@asone/errors';

import { successResponse } from '../../../http/response.js';
import { requireAuthenticatedUser } from '../../auth/auth.guards.js';
import type { AuthService } from '../../auth/auth.service.js';
import { isValidIanaTimezone, localDateString } from '../../promotions/pricing.service.js';
import type { AdministrationService } from '../shared/admin.service.js';

const responseMeta = {
  type: 'object',
  additionalProperties: false,
  required: ['request_id', 'correlation_id'],
  properties: { request_id: { type: 'string' }, correlation_id: { type: 'string' } },
} as const;

const contextCompaniesSchema = {
  querystring: { type: 'object', additionalProperties: false, maxProperties: 0 },
  response: {
    200: {
      type: 'object',
      additionalProperties: false,
      required: ['data', 'meta'],
      properties: {
        data: {
          type: 'object',
          additionalProperties: false,
          required: ['items'],
          properties: {
            items: {
              type: 'array',
              items: {
                type: 'object',
                additionalProperties: false,
                required: ['company_id', 'display_name', 'current', 'switch_permitted'],
                properties: {
                  company_id: { type: 'string', format: 'uuid' },
                  display_name: { type: 'string' },
                  // TASK 16.17 — the tenant's own currency, so no client has to
                  // hardcode one (optional in the schema: older clients ignore it).
                  currency_code: { type: 'string', pattern: '^[A-Z]{3}$' },
                  // TASK 16.23B (F-05) — the company's own real IANA timezone,
                  // the "resolve business today" fallback for a company-wide
                  // (no single current branch) session — same optional-field
                  // convention `currency_code` above already established.
                  timezone: { type: 'string' },
                  current: { type: 'boolean' },
                  switch_permitted: { type: 'boolean' },
                },
              },
            },
          },
        },
        meta: responseMeta,
      },
    },
  },
} as const;

const contextBranchesSchema = {
  querystring: { type: 'object', additionalProperties: false, maxProperties: 0 },
  response: {
    200: {
      type: 'object',
      additionalProperties: false,
      required: ['data', 'meta'],
      properties: {
        data: {
          type: 'object',
          additionalProperties: false,
          required: ['company_id', 'company_wide_access', 'items'],
          properties: {
            company_id: { type: 'string', format: 'uuid' },
            company_wide_access: { type: 'boolean' },
            items: {
              type: 'array',
              items: {
                type: 'object',
                additionalProperties: false,
                required: ['branch_id', 'code', 'name', 'timezone', 'current', 'is_default'],
                properties: {
                  branch_id: { type: 'string', format: 'uuid' },
                  code: { type: 'string' },
                  name: { type: 'string' },
                  timezone: { type: 'string' },
                  current: { type: 'boolean' },
                  is_default: { type: 'boolean' },
                },
              },
            },
          },
        },
        meta: responseMeta,
      },
    },
  },
} as const;

// TASK 16.23B (F-05) — the ONE centralized, testable abstraction every
// screen that needs "business today" (never the device's own OS clock/
// timezone) now calls, instead of each computing `DateTime.now()` itself.
// Deliberately STATELESS/no DB lookup: the caller already has the real,
// server-issued IANA timezone string for its own currently-selected
// branch (`GET /context/branches`' own `timezone` field, `BranchSummary
// .timezone` on the Flutter side) — this endpoint's only job is the ONE
// thing Dart's core `DateTime` genuinely cannot do (arbitrary-zone
// conversion) via the SAME already-proven `Intl`-based primitive
// (`localDateString`) `CashService.closeSession`/`partialClose` and now
// `ReportsService` (TASK 16.23B, F-06) already use — never a second,
// hand-rolled UTC-offset table, never a new client-side timezone
// database/dependency. A caller passing an invalid/foreign timezone only
// ever gets a clean 400 or a harmlessly-wrong date back — never a
// write, so trusting the client-supplied string here (rather than
// re-deriving it from a branch_id lookup) carries no real risk.
const contextBusinessDateSchema = {
  querystring: {
    type: 'object',
    additionalProperties: false,
    required: ['timezone'],
    properties: { timezone: { type: 'string', minLength: 1, maxLength: 100 } },
  },
  response: {
    200: {
      type: 'object',
      additionalProperties: false,
      required: ['data', 'meta'],
      properties: {
        data: {
          type: 'object',
          additionalProperties: false,
          required: ['date', 'timezone'],
          properties: {
            date: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' },
            timezone: { type: 'string' },
          },
        },
        meta: responseMeta,
      },
    },
  },
} as const;

/** Context endpoints deliberately derive company and branch visibility from the session. */
export function registerContextRoutes(
  app: FastifyInstance,
  authentication: AuthService,
  administration: AdministrationService,
): void {
  app.get('/api/v1/context/companies', { schema: contextCompaniesSchema }, async (request) => {
    const context = await requireAuthenticatedUser(request, authentication);
    return successResponse(
      {
        items: await administration.contextCompanies({
          context,
          requestId: request.requestContext.requestId,
          correlationId: request.requestContext.correlationId,
        }),
      },
      request.requestContext,
    );
  });
  app.get<{ Querystring: { timezone: string } }>(
    '/api/v1/context/business-date',
    { schema: contextBusinessDateSchema },
    async (request) => {
      await requireAuthenticatedUser(request, authentication);
      const timezone = request.query.timezone;
      if (!isValidIanaTimezone(timezone))
        throw new AppError({ code: 'validation_error', message: `"${timezone}" is not a valid IANA timezone identifier.`, statusCode: 400 });
      return successResponse({ date: localDateString(new Date(), timezone), timezone }, request.requestContext);
    },
  );
  app.get('/api/v1/context/branches', { schema: contextBranchesSchema }, async (request) => {
    const context = await requireAuthenticatedUser(request, authentication);
    return successResponse(
      await administration
        .contextBranches({
          context,
          requestId: request.requestContext.requestId,
          correlationId: request.requestContext.correlationId,
        })
        .then((result) => ({
          company_id: result.companyId,
          company_wide_access: result.companyWideAccess,
          items: result.items,
        })),
      request.requestContext,
    );
  });
}
