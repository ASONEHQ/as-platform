import { AppError } from '@asone/errors';

const uuid = { type: 'string', format: 'uuid' } as const;
const status = { type: 'string', enum: ['active', 'inactive', 'retired'] } as const;
const nullableText = { anyOf: [{ type: 'string', maxLength: 2000 }, { type: 'null' }] } as const;
const categoryProperties = {
  id: uuid,
  parent_id: { anyOf: [uuid, { type: 'null' }] },
  code: { type: 'string' },
  name: { type: 'string' },
  description: nullableText,
  sort_order: { type: 'integer', minimum: 0 },
  status,
  version: { type: 'integer', minimum: 1 },
  created_at: { type: 'string' },
  updated_at: { type: 'string' },
  deleted_at: { anyOf: [{ type: 'string' }, { type: 'null' }] },
} as const;
const brandProperties = {
  id: uuid,
  code: { type: 'string' },
  name: { type: 'string' },
  description: nullableText,
  status,
  version: { type: 'integer', minimum: 1 },
  created_at: { type: 'string' },
  updated_at: { type: 'string' },
  deleted_at: { anyOf: [{ type: 'string' }, { type: 'null' }] },
} as const;
const meta = {
  type: 'object',
  additionalProperties: true,
  required: ['request_id', 'correlation_id'],
  properties: { request_id: { type: 'string' }, correlation_id: { type: 'string' } },
} as const;
export const categoryResponseSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['data', 'meta'],
  properties: {
    data: {
      type: 'object',
      additionalProperties: false,
      required: Object.keys(categoryProperties),
      properties: categoryProperties,
    },
    meta,
  },
} as const;
export const brandResponseSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['data', 'meta'],
  properties: {
    data: {
      type: 'object',
      additionalProperties: false,
      required: Object.keys(brandProperties),
      properties: brandProperties,
    },
    meta,
  },
} as const;
export const categoryListResponseSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['data', 'meta'],
  properties: {
    data: { type: 'array', items: categoryResponseSchema.properties.data },
    meta: {
      ...meta,
      properties: {
        ...meta.properties,
        page: {
          type: 'object',
          required: ['next_cursor', 'has_more'],
          additionalProperties: false,
          properties: {
            next_cursor: { anyOf: [{ type: 'string' }, { type: 'null' }] },
            has_more: { type: 'boolean' },
          },
        },
      },
    },
  },
} as const;
export const brandListResponseSchema = {
  ...categoryListResponseSchema,
  properties: {
    ...categoryListResponseSchema.properties,
    data: { type: 'array', items: brandResponseSchema.properties.data },
  },
} as const;
export const listQuerySchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    cursor: uuid,
    limit: { type: 'integer', minimum: 1, maximum: 100, default: 50 },
    status,
    search: { type: 'string', minLength: 1, maxLength: 100 },
  },
} as const;
export const categoryListQuerySchema = {
  ...listQuerySchema,
  properties: { ...listQuerySchema.properties, parent_id: uuid },
} as const;
export const idParamSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['id'],
  properties: { id: uuid },
} as const;
export const categoryCreateSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['code', 'name'],
  properties: {
    id: uuid,
    parent_id: { anyOf: [uuid, { type: 'null' }] },
    code: { type: 'string', minLength: 1, maxLength: 100 },
    name: { type: 'string', minLength: 1, maxLength: 200 },
    description: nullableText,
    sort_order: { type: 'integer', minimum: 0 },
    status,
  },
} as const;
export const categoryPatchSchema = {
  type: 'object',
  additionalProperties: false,
  minProperties: 1,
  properties: {
    parent_id: { anyOf: [uuid, { type: 'null' }] },
    name: { type: 'string', minLength: 1, maxLength: 200 },
    description: nullableText,
    sort_order: { type: 'integer', minimum: 0 },
    status,
  },
} as const;
export const brandCreateSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['code', 'name'],
  properties: {
    id: uuid,
    code: { type: 'string', minLength: 1, maxLength: 100 },
    name: { type: 'string', minLength: 1, maxLength: 200 },
    description: nullableText,
    status,
  },
} as const;
export const brandPatchSchema = {
  type: 'object',
  additionalProperties: false,
  minProperties: 1,
  properties: {
    name: { type: 'string', minLength: 1, maxLength: 200 },
    description: nullableText,
    status,
  },
} as const;
export function parseIfMatch(value: string | string[] | undefined): bigint {
  const raw = Array.isArray(value) ? value[0] : value;
  const match = raw?.match(/^(?:W\/)?"([1-9]\d*)"$/u);
  if (match?.[1] === undefined)
    throw new AppError({
      code: 'validation_error',
      message: 'If-Match must contain a valid version ETag.',
      statusCode: 400,
    });
  return BigInt(match[1]);
}
export function idempotencyKey(value: string | string[] | undefined): string {
  const raw = (Array.isArray(value) ? value[0] : value)?.trim();
  if (raw === undefined || raw.length < 1 || raw.length > 200)
    throw new AppError({
      code: 'validation_error',
      message: 'A valid Idempotency-Key is required.',
      statusCode: 400,
    });
  return raw;
}
