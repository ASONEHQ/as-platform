/// TASK 14.5A: `POST`/`DELETE .../branding/logo` -- real multipart upload
/// and deletion of the operator-chosen business logo (legacy parity for
/// `AS POS V1.html`'s `cfgNegocioLogoSeleccionado()`). Mirrors
/// `settings.routes.ts`'s own shape as closely as this route's different
/// transport (multipart, not JSON) allows: same auth guard order, same
/// `company_settings.update` permission (the exact permission that
/// already governs every other company-setting write, including
/// `receipts.header_text`), same `If-Match`/CAS semantics via
/// `SettingsService.mutateCompanySetting` (reached through
/// `BrandingService`), same response envelope
/// (`successResponse`)/`etag` header convention, and the SAME
/// `withSettingsErrors` mapper `settings.routes.ts` uses -- `BrandingService`
/// bubbles the identical `SettingsError` the settings module already
/// throws for a stale `If-Match` (`version_conflict` -> 409) or a missing
/// company (`company_not_found` -> 404), so no bespoke error-mapping
/// module is invented here.
import type { FastifyInstance, FastifyRequest } from 'fastify';

import { AppError } from '@asone/errors';

import { successResponse } from '../../../http/response.js';
import { requireAuthenticatedUser, requirePermission } from '../../auth/auth.guards.js';
import type { AuthService } from '../../auth/auth.service.js';
import { withSettingsErrors } from '../settings/settings.http-errors.js';
import { parseIfMatch } from '../settings/settings.schemas.js';
import type { SettingMutationResult } from '../settings/settings.service.js';
import type { EffectiveSetting } from '../settings/settings.types.js';
import type { BrandingService } from './branding.service.js';
import {
  ALLOWED_LOGO_CONTENT_TYPES,
  MAX_LOGO_BYTES,
  isAllowedLogoContentType,
  logoFileExtension,
  matchesLogoFileSignature,
  type AllowedLogoContentType,
} from './branding.validation.js';

const privateCache = 'private, no-cache';
const anySchema = { type: 'object', additionalProperties: true } as const;
const commonErrors = {
  400: anySchema,
  401: anySchema,
  403: anySchema,
  404: anySchema,
  409: anySchema,
  413: anySchema,
  415: anySchema,
} as const;

// Multipart framing (boundary + per-part headers) adds a small, bounded
// amount of overhead on top of the raw file bytes; this route's own
// `bodyLimit` override must exceed `MAX_LOGO_BYTES` by more than that
// overhead, or a legitimately-sized file could be rejected by Fastify's
// transport-level limit before this module's own, more precise
// `MAX_LOGO_BYTES` check ever runs. It intentionally does NOT touch the
// app-wide `REQUEST_BODY_LIMIT_BYTES` default every other route still
// uses.
const ROUTE_BODY_LIMIT_BYTES = MAX_LOGO_BYTES + 64 * 1024;

function httpVersion(version: bigint): number {
  const value = Number(version);
  if (!Number.isSafeInteger(value))
    throw new AppError({
      code: 'internal_error',
      message: 'The setting version cannot be represented safely.',
      statusCode: 500,
    });
  return value;
}

function httpSetting(setting: EffectiveSetting): Readonly<Record<string, unknown>> {
  return {
    key: setting.key,
    type: setting.type,
    value: setting.value,
    source: setting.source,
    version: httpVersion(setting.version),
  };
}

function mutationRepresentation(
  result: SettingMutationResult,
  companyId: string,
): Readonly<Record<string, unknown>> {
  const { persisted, effective } = result;
  return {
    id: persisted.id,
    company_id: companyId,
    ...httpSetting(effective),
    status: persisted.status,
    created_at: persisted.createdAt.toISOString(),
    updated_at: persisted.updatedAt.toISOString(),
  };
}

function isFileTooLargeError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: unknown }).code === 'FST_REQ_FILE_TOO_LARGE'
  );
}

function isNotMultipartError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: unknown }).code === 'FST_INVALID_MULTIPART_CONTENT_TYPE'
  );
}

function oversizedError(): AppError {
  return new AppError({
    code: 'payload_too_large',
    message: `The logo file exceeds the maximum size of ${String(MAX_LOGO_BYTES)} bytes.`,
    statusCode: 413,
  });
}

function unsupportedContentTypeError(message: string): AppError {
  return new AppError({ code: 'unsupported_media_type', message, statusCode: 415 });
}

interface ReadLogoFileResult {
  readonly buffer: Buffer;
  readonly contentType: AllowedLogoContentType;
  readonly extension: string;
}

async function readLogoFile(request: FastifyRequest): Promise<ReadLogoFileResult> {
  const file = await request
    .file({ limits: { fileSize: MAX_LOGO_BYTES } })
    .catch((error: unknown) => {
      if (isFileTooLargeError(error)) throw oversizedError();
      if (isNotMultipartError(error))
        throw new AppError({
          code: 'validation_error',
          message: 'The request must be a multipart/form-data upload.',
          statusCode: 400,
        });
      throw error;
    });
  if (file === undefined)
    throw new AppError({
      code: 'validation_error',
      message: 'A logo image file is required.',
      statusCode: 400,
    });
  const declared = file.mimetype.toLowerCase();
  if (!isAllowedLogoContentType(declared))
    throw unsupportedContentTypeError(
      `The logo content type must be one of: ${ALLOWED_LOGO_CONTENT_TYPES.join(', ')}.`,
    );
  let buffer: Buffer;
  try {
    buffer = await file.toBuffer();
  } catch (error) {
    if (isFileTooLargeError(error)) throw oversizedError();
    throw error;
  }
  if (buffer.length > MAX_LOGO_BYTES) throw oversizedError();
  if (!matchesLogoFileSignature(declared, buffer))
    throw unsupportedContentTypeError(
      'The uploaded file does not match its declared image content type.',
    );
  return { buffer, contentType: declared, extension: logoFileExtension(declared) };
}

export function registerBrandingRoutes(
  app: FastifyInstance,
  authentication: AuthService,
  service: BrandingService,
): void {
  app.post<{ Params: { company_id: string } }>(
    '/api/v1/companies/:company_id/branding/logo',
    {
      bodyLimit: ROUTE_BODY_LIMIT_BYTES,
      schema: {
        tags: ['branding'],
        summary: 'Upload the company business logo',
        consumes: ['multipart/form-data'],
        headers: {
          type: 'object',
          required: ['if-match'],
          properties: { 'if-match': { type: 'string' } },
        },
        response: { 200: anySchema, ...commonErrors },
      },
    },
    async (request, reply) =>
      withSettingsErrors(async () => {
        const context = await requireAuthenticatedUser(request, authentication);
        requirePermission(authentication, context, 'company_settings.update');
        if (request.params.company_id !== context.companyId)
          throw new AppError({
            code: 'company_scope_mismatch',
            message: 'Company scope is not authorized.',
            statusCode: 403,
          });
        const expectedVersion = parseIfMatch(request.headers['if-match']);
        const { buffer, contentType, extension } = await readLogoFile(request);
        const result = await service.uploadLogo(
          { companyId: context.companyId },
          {
            buffer,
            contentType,
            extension,
            expectedVersion,
            actorId: context.userId,
            requestId: request.requestContext.requestId,
            correlationId: request.requestContext.correlationId,
            timestamp: new Date(),
          },
        );
        const data = mutationRepresentation(result, context.companyId);
        return reply
          .header('etag', `"${result.persisted.version.toString()}"`)
          .header('cache-control', privateCache)
          .send(successResponse(data, request.requestContext));
      }),
  );

  app.delete<{ Params: { company_id: string } }>(
    '/api/v1/companies/:company_id/branding/logo',
    {
      schema: {
        tags: ['branding'],
        summary: 'Clear the company business logo',
        headers: {
          type: 'object',
          required: ['if-match'],
          properties: { 'if-match': { type: 'string' } },
        },
        response: { 200: anySchema, ...commonErrors },
      },
    },
    async (request, reply) =>
      withSettingsErrors(async () => {
        const context = await requireAuthenticatedUser(request, authentication);
        requirePermission(authentication, context, 'company_settings.update');
        if (request.params.company_id !== context.companyId)
          throw new AppError({
            code: 'company_scope_mismatch',
            message: 'Company scope is not authorized.',
            statusCode: 403,
          });
        const expectedVersion = parseIfMatch(request.headers['if-match']);
        const result = await service.deleteLogo(
          { companyId: context.companyId },
          {
            expectedVersion,
            actorId: context.userId,
            requestId: request.requestContext.requestId,
            correlationId: request.requestContext.correlationId,
            timestamp: new Date(),
          },
        );
        const data = mutationRepresentation(result, context.companyId);
        return reply
          .header('etag', `"${result.persisted.version.toString()}"`)
          .header('cache-control', privateCache)
          .send(successResponse(data, request.requestContext));
      }),
  );
}
