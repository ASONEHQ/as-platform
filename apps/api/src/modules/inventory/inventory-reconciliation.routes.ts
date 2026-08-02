import type { FastifyInstance, FastifyRequest } from 'fastify';

import { AppError } from '@asone/errors';

import { responseMeta, successResponse } from '../../http/response.js';
import type { AuthService } from '../auth/auth.service.js';
import {
  requireAuthenticatedUser,
  requireBranchAccess,
  requirePermission,
} from '../auth/auth.guards.js';
import type { AuthContext } from '../auth/auth.types.js';
import type { RepairCommandContext, RepairFinding } from './inventory-repair.types.js';
import { InventoryRepairError, repairStrategies } from './inventory-repair.types.js';
import type { InventoryRepairService } from './inventory-repair.service.js';

const findingTypes = [
  'balance_on_hand_drift',
  'balance_reserved_drift',
  'balance_in_transit_drift',
  'last_movement_mismatch',
  'missing_balance',
  'orphan_balance',
  'invalid_posted_movement',
  'invalid_reversal_relationship',
  'transfer_movement_mismatch',
  'reservation_movement_mismatch',
  'count_application_mismatch',
  'missing_outbox_event',
  'missing_audit_record',
  'unsupported_or_unknown',
] as const;
const paramsSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['finding_id'],
  properties: { finding_id: { type: 'string', format: 'uuid' } },
} as const;
const commandHeaders = {
  type: 'object',
  required: ['if-match', 'idempotency-key'],
  properties: {
    'if-match': { type: 'string', pattern: '^"[1-9][0-9]*"$' },
    'idempotency-key': { type: 'string', minLength: 1, maxLength: 255 },
  },
} as const;
const previewHeaders = {
  type: 'object',
  required: ['if-match'],
  properties: { 'if-match': { type: 'string', pattern: '^"[1-9][0-9]*"$' } },
} as const;
const reasonProperties = {
  reason_code: { type: 'string', minLength: 1, maxLength: 64, pattern: '^[a-z0-9][a-z0-9_]*$' },
  note: { anyOf: [{ type: 'string', minLength: 1, maxLength: 1000 }, { type: 'null' }] },
} as const;
const fingerprint = { type: 'string', pattern: '^[0-9a-f]{64}$' } as const;
const errors = {
  400: { type: 'object', additionalProperties: true },
  401: { type: 'object', additionalProperties: true },
  403: { type: 'object', additionalProperties: true },
  404: { type: 'object', additionalProperties: true },
  409: { type: 'object', additionalProperties: true },
} as const;

interface FindingParams {
  finding_id: string;
}
interface ListQuery {
  status?: string;
  severity?: string;
  finding_type?: string;
  branch_id?: string;
  inventory_location_id?: string;
  product_variant_id?: string;
  aggregate_type?: string;
  aggregate_id?: string;
  detected_from?: string;
  detected_to?: string;
  cursor?: string;
  limit?: number;
}
interface ReasonBody {
  reason_code: string;
  note?: string | null;
}
interface PreviewBody {
  strategy: (typeof repairStrategies)[number];
  expected_fingerprint: string;
}
interface RepairBody extends PreviewBody {
  preview_fingerprint: string;
  preview_expires_at: string;
  reason_code: string;
  note?: string | null;
}

function expectedVersion(value: string | undefined): bigint {
  const matched = /^"([1-9]\d*)"$/u.exec(value ?? '');
  if (matched?.[1] === undefined)
    throw new AppError({
      code: 'validation_error',
      statusCode: 400,
      message: 'If-Match is invalid.',
    });
  return BigInt(matched[1]);
}
function idempotencyKey(value: string | string[] | undefined): string {
  if (typeof value !== 'string' || value.trim().length === 0)
    throw new AppError({
      code: 'validation_error',
      statusCode: 400,
      message: 'Idempotency-Key is required.',
    });
  return value;
}
function context(request: FastifyRequest, auth: AuthContext): RepairCommandContext {
  return {
    companyId: auth.companyId,
    actorId: auth.userId,
    requestId: request.requestContext.requestId,
    correlationId: request.requestContext.correlationId,
    timestamp: new Date(),
  };
}
function summary(value: RepairFinding): Readonly<Record<string, unknown>> {
  return {
    finding_id: value.id,
    finding_type: value.findingType,
    severity: value.severity,
    status: value.status,
    scope: {
      branch_id: value.branchId,
      inventory_location_id: value.inventoryLocationId,
      product_variant_id: value.productVariantId,
    },
    aggregate: { type: value.aggregateType, id: value.aggregateId },
    first_detected_at: value.firstDetectedAt.toISOString(),
    last_detected_at: value.lastDetectedAt.toISOString(),
    occurrence_count: Number(value.occurrenceCount),
    detector_version: value.detectorVersion,
    version: Number(value.version),
  };
}
function detail(value: RepairFinding): Readonly<Record<string, unknown>> {
  return {
    ...summary(value),
    expected_summary: value.expectedSummary,
    actual_summary: value.actualSummary,
    evidence: sanitize(value.evidence),
    fingerprint: value.fingerprint,
    snapshot_at: value.snapshotAt.toISOString(),
    lifecycle: {
      acknowledged_at: value.acknowledgedAt?.toISOString() ?? null,
      acknowledged_by: value.acknowledgedBy,
      resolved_at: value.resolvedAt?.toISOString() ?? null,
      resolved_by: value.resolvedBy,
      dismissed_at: value.dismissedAt?.toISOString() ?? null,
      dismissed_by: value.dismissedBy,
      resolution_reason_code: value.resolutionReasonCode,
      resolution_note: value.resolutionNote,
    },
  };
}
function sanitize(value: Readonly<Record<string, unknown>>): Readonly<Record<string, unknown>> {
  return Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => !/(sql|query|stack|password|token|secret)/iu.test(key))
      .map(([key, item]) => [key, sanitizeValue(item)]),
  );
}
function sanitizeValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sanitizeValue);
  if (typeof value === 'object' && value !== null)
    return sanitize(value as Readonly<Record<string, unknown>>);
  return value;
}
async function mapped<T>(callback: () => Promise<T>): Promise<T> {
  try {
    return await callback();
  } catch (error) {
    if (!(error instanceof InventoryRepairError)) throw error;
    const statusCode =
      error.code === 'validation_error' ? 400 : error.code === 'resource_not_found' ? 404 : 409;
    throw new AppError({ code: error.code, statusCode, message: error.message });
  }
}

export function registerInventoryReconciliationRoutes(
  app: FastifyInstance,
  authentication: AuthService,
  service: InventoryRepairService,
): void {
  app.get<{ Querystring: ListQuery }>(
    '/api/v1/inventory/reconciliation/findings',
    {
      schema: {
        tags: ['inventory'],
        querystring: {
          type: 'object',
          additionalProperties: false,
          properties: {
            status: { type: 'string', enum: ['open', 'acknowledged', 'resolved', 'dismissed'] },
            severity: { type: 'string', enum: ['info', 'warning', 'critical'] },
            finding_type: { type: 'string', enum: findingTypes },
            branch_id: { type: 'string', format: 'uuid' },
            inventory_location_id: { type: 'string', format: 'uuid' },
            product_variant_id: { type: 'string', format: 'uuid' },
            aggregate_type: {
              type: 'string',
              minLength: 1,
              maxLength: 64,
              pattern: '^[a-z][a-z0-9_]*$',
            },
            aggregate_id: { type: 'string', minLength: 1, maxLength: 128 },
            detected_from: { type: 'string', format: 'date-time' },
            detected_to: { type: 'string', format: 'date-time' },
            cursor: { type: 'string', minLength: 1, maxLength: 512 },
            limit: { type: 'integer', minimum: 1, maximum: 100 },
          },
        },
        response: { 200: { type: 'object', additionalProperties: true }, ...errors },
      },
    },
    async (request, reply) =>
      mapped(async () => {
        const auth = await requireAuthenticatedUser(request, authentication);
        requirePermission(authentication, auth, 'inventory.reconcile');
        if (request.query.branch_id !== undefined)
          requireBranchAccess(authentication, auth, request.query.branch_id);
        if (
          request.query.detected_from !== undefined &&
          request.query.detected_to !== undefined &&
          new Date(request.query.detected_from) > new Date(request.query.detected_to)
        )
          throw new AppError({
            code: 'validation_error',
            statusCode: 400,
            message: 'Detection range is invalid.',
          });
        const page = await service.list(auth.companyId, auth.permittedBranchIds, {
          limit: request.query.limit ?? 50,
          ...(request.query.cursor === undefined ? {} : { cursor: request.query.cursor }),
          ...(request.query.status === undefined ? {} : { status: request.query.status }),
          ...(request.query.severity === undefined ? {} : { severity: request.query.severity }),
          ...(request.query.finding_type === undefined
            ? {}
            : { findingType: request.query.finding_type }),
          ...(request.query.branch_id === undefined ? {} : { branchId: request.query.branch_id }),
          ...(request.query.inventory_location_id === undefined
            ? {}
            : { inventoryLocationId: request.query.inventory_location_id }),
          ...(request.query.product_variant_id === undefined
            ? {}
            : { productVariantId: request.query.product_variant_id }),
          ...(request.query.aggregate_type === undefined
            ? {}
            : { aggregateType: request.query.aggregate_type }),
          ...(request.query.aggregate_id === undefined
            ? {}
            : { aggregateId: request.query.aggregate_id }),
          ...(request.query.detected_from === undefined
            ? {}
            : { detectedFrom: new Date(request.query.detected_from) }),
          ...(request.query.detected_to === undefined
            ? {}
            : { detectedTo: new Date(request.query.detected_to) }),
        });
        return reply.send({
          data: page.items.map(summary),
          meta: {
            ...responseMeta(request.requestContext),
            page: {
              next_cursor: page.nextCursor,
              has_more: page.nextCursor !== null,
              limit: request.query.limit ?? 50,
            },
          },
        });
      }),
  );

  app.get<{ Params: FindingParams }>(
    '/api/v1/inventory/reconciliation/findings/:finding_id',
    {
      schema: {
        tags: ['inventory'],
        params: paramsSchema,
        response: { 200: { type: 'object', additionalProperties: true }, ...errors },
      },
    },
    async (request, reply) =>
      mapped(async () => {
        const auth = await requireAuthenticatedUser(request, authentication);
        requirePermission(authentication, auth, 'inventory.reconcile');
        const value = await service.detail(
          auth.companyId,
          auth.permittedBranchIds,
          request.params.finding_id,
        );
        return reply
          .header('etag', `"${String(value.version)}"`)
          .send(successResponse(detail(value), request.requestContext));
      }),
  );

  const lifecycle = (kind: 'acknowledgements' | 'dismissals'): void => {
    app.post<{ Params: FindingParams; Body: ReasonBody }>(
      `/api/v1/inventory/reconciliation/findings/:finding_id/${kind}`,
      {
        schema: {
          tags: ['inventory'],
          params: paramsSchema,
          headers: commandHeaders,
          body: {
            type: 'object',
            additionalProperties: false,
            required: ['reason_code'],
            properties: reasonProperties,
          },
          response: { 200: { type: 'object', additionalProperties: true }, ...errors },
        },
      },
      async (request, reply) =>
        mapped(async () => {
          const auth = await requireAuthenticatedUser(request, authentication);
          requirePermission(authentication, auth, 'inventory.reconcile');
          const args = [
            context(request, auth),
            auth.permittedBranchIds,
            request.params.finding_id,
            expectedVersion(request.headers['if-match']),
            idempotencyKey(request.headers['idempotency-key']),
            { reasonCode: request.body.reason_code, note: request.body.note ?? null },
          ] as const;
          const result =
            kind === 'acknowledgements'
              ? await service.acknowledge(...args)
              : await service.dismiss(...args);
          if (result.replayed) reply.header('idempotency-replayed', 'true');
          return reply
            .header('etag', `"${String(result.value.version)}"`)
            .send(successResponse(result.value, request.requestContext));
        }),
    );
  };
  lifecycle('acknowledgements');
  lifecycle('dismissals');

  app.post<{ Params: FindingParams; Body: PreviewBody }>(
    '/api/v1/inventory/reconciliation/findings/:finding_id/repair-previews',
    {
      schema: {
        tags: ['inventory'],
        params: paramsSchema,
        headers: previewHeaders,
        body: {
          type: 'object',
          additionalProperties: false,
          required: ['strategy', 'expected_fingerprint'],
          properties: {
            strategy: { type: 'string', enum: repairStrategies },
            expected_fingerprint: fingerprint,
          },
        },
        response: { 200: { type: 'object', additionalProperties: true }, ...errors },
      },
    },
    async (request, reply) =>
      mapped(async () => {
        const auth = await requireAuthenticatedUser(request, authentication);
        requirePermission(authentication, auth, 'inventory.reconcile');
        const value = await service.preview(
          auth.companyId,
          auth.permittedBranchIds,
          request.params.finding_id,
          expectedVersion(request.headers['if-match']),
          request.body.expected_fingerprint,
          request.body.strategy,
        );
        return reply.send(
          successResponse(
            {
              finding_id: value.findingId,
              repairable: value.repairable,
              strategy: value.strategy,
              expected: value.expected,
              actual: value.actual,
              proposed_mutations: value.proposedMutations,
              affected_balance_ids: value.affectedBalanceIds,
              movement: null,
              expected_events: value.expectedEvents,
              warnings: value.warnings,
              snapshot_at: value.snapshotAt.toISOString(),
              preview_expires_at: value.expiresAt.toISOString(),
              preview_fingerprint: value.fingerprint,
            },
            request.requestContext,
          ),
        );
      }),
  );

  app.post<{ Params: FindingParams; Body: RepairBody }>(
    '/api/v1/inventory/reconciliation/findings/:finding_id/repairs',
    {
      schema: {
        tags: ['inventory'],
        params: paramsSchema,
        headers: commandHeaders,
        body: {
          type: 'object',
          additionalProperties: false,
          required: [
            'strategy',
            'expected_fingerprint',
            'preview_fingerprint',
            'preview_expires_at',
            'reason_code',
          ],
          properties: {
            strategy: { type: 'string', enum: repairStrategies },
            expected_fingerprint: fingerprint,
            preview_fingerprint: fingerprint,
            preview_expires_at: { type: 'string', format: 'date-time' },
            ...reasonProperties,
          },
        },
        response: { 200: { type: 'object', additionalProperties: true }, ...errors },
      },
    },
    async (request, reply) =>
      mapped(async () => {
        const auth = await requireAuthenticatedUser(request, authentication);
        requirePermission(authentication, auth, 'inventory.reconcile');
        requirePermission(authentication, auth, 'inventory.approve');
        const result = await service.repair(
          context(request, auth),
          auth.permittedBranchIds,
          request.params.finding_id,
          expectedVersion(request.headers['if-match']),
          idempotencyKey(request.headers['idempotency-key']),
          {
            strategy: request.body.strategy,
            expectedFingerprint: request.body.expected_fingerprint,
            previewFingerprint: request.body.preview_fingerprint,
            previewExpiresAt: new Date(request.body.preview_expires_at),
            reasonCode: request.body.reason_code,
            note: request.body.note ?? null,
          },
        );
        if (result.replayed) reply.header('idempotency-replayed', 'true');
        return reply
          .header('etag', `"${String(result.value.version)}"`)
          .send(successResponse(result.value, request.requestContext));
      }),
  );
}
