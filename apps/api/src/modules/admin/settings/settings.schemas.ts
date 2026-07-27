import { AppError } from '@asone/errors';

export const settingValueTypes = ['string', 'boolean', 'integer'] as const;
export const settingStatuses = ['active', 'retired'] as const;

export type SettingHttpValueType = (typeof settingValueTypes)[number];
export type SettingHttpStatus = (typeof settingStatuses)[number];

export interface SettingBody {
  readonly value: unknown;
  readonly value_type: SettingHttpValueType;
  readonly status: SettingHttpStatus;
}

const settingSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['key', 'type', 'value', 'source', 'version'],
  properties: {
    key: { type: 'string' },
    type: { enum: settingValueTypes },
    value: { anyOf: [{ type: 'string' }, { type: 'boolean' }, { type: 'integer' }] },
    source: { enum: ['default', 'company', 'branch'] },
    version: { type: 'integer', minimum: 1 },
  },
} as const;

const metaSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['request_id', 'correlation_id'],
  properties: {
    request_id: { type: 'string' },
    correlation_id: { type: 'string' },
  },
} as const;

const effectiveDataProperties = {
  settings: { type: 'array', items: settingSchema },
  checkpoint: { type: 'string', pattern: '^settings:[a-f0-9]{64}$' },
} as const;

export const effectiveCompanyResponseSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['data', 'meta'],
  properties: {
    data: {
      type: 'object',
      additionalProperties: false,
      required: ['company_id', 'settings', 'checkpoint'],
      properties: {
        company_id: { type: 'string', format: 'uuid' },
        ...effectiveDataProperties,
      },
    },
    meta: metaSchema,
  },
} as const;

export const effectiveBranchResponseSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['data', 'meta'],
  properties: {
    data: {
      type: 'object',
      additionalProperties: false,
      required: ['company_id', 'branch_id', 'settings', 'checkpoint'],
      properties: {
        company_id: { type: 'string', format: 'uuid' },
        branch_id: { type: 'string', format: 'uuid' },
        ...effectiveDataProperties,
      },
    },
    meta: metaSchema,
  },
} as const;

export const settingMutationResponseSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['data', 'meta'],
  properties: {
    data: {
      type: 'object',
      additionalProperties: false,
      required: [
        'id',
        'company_id',
        'key',
        'type',
        'value',
        'source',
        'status',
        'version',
        'created_at',
        'updated_at',
      ],
      properties: {
        id: { type: 'string', format: 'uuid' },
        company_id: { type: 'string', format: 'uuid' },
        branch_id: { type: 'string', format: 'uuid' },
        key: { type: 'string' },
        type: { enum: settingValueTypes },
        value: settingSchema.properties.value,
        source: settingSchema.properties.source,
        status: { enum: settingStatuses },
        version: { type: 'integer', minimum: 2 },
        created_at: { type: 'string', format: 'date-time' },
        updated_at: { type: 'string', format: 'date-time' },
      },
    },
    meta: metaSchema,
  },
} as const;

export const settingsQuerySchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    keys: { type: 'string', minLength: 1, maxLength: 1024 },
  },
} as const;

export const settingBodySchema = {
  type: 'object',
  additionalProperties: false,
  required: ['value', 'value_type', 'status'],
  properties: {
    value: { anyOf: [{ type: 'string' }, { type: 'boolean' }, { type: 'integer' }] },
    value_type: { enum: settingValueTypes },
    status: { enum: settingStatuses },
  },
} as const;

export function parseSettingKeys(value: unknown): readonly string[] | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'string' || value.length > 1024)
    throw validationError('The keys filter is invalid.');
  const keys = value.split(',').map((key) => key.trim());
  if (keys.some((key) => key.length === 0))
    throw validationError('The keys filter contains an empty key.');
  return [...new Set(keys)];
}

export function rejectUnknownSettingBody(value: unknown): void {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return;
  const approved = new Set(['value', 'value_type', 'status']);
  if (Object.keys(value).some((key) => !approved.has(key)))
    throw validationError('The request body contains an unknown field.');
}

export function parseIfMatch(value: string | readonly string[] | undefined): bigint {
  if (typeof value !== 'string' || !/^"[1-9]\d*"$/u.test(value))
    throw validationError('A single strong numeric If-Match value is required.');
  return BigInt(value.slice(1, -1));
}

export function ifNoneMatchMatches(
  value: string | readonly string[] | undefined,
  currentEtag: string,
): boolean {
  if (value === undefined) return false;
  const combined = typeof value === 'string' ? value : value.join(',');
  return combined.split(',').some((candidate) => {
    const normalized = candidate.trim();
    if (normalized === '*') return true;
    return (normalized.startsWith('W/') ? normalized.slice(2) : normalized) === currentEtag;
  });
}

function validationError(message: string): AppError {
  return new AppError({ code: 'validation_error', message, statusCode: 400 });
}
