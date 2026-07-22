export const paginationQuerySchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    limit: { type: 'integer', minimum: 1, maximum: 100, default: 50 },
    cursor: { type: 'string', minLength: 1, maxLength: 512 },
    sort: { type: 'string', minLength: 1, maxLength: 64, pattern: '^[A-Za-z0-9_]+$' },
    direction: { type: 'string', enum: ['asc', 'desc'], default: 'asc' },
  },
} as const;

export const paginationMetaSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['next_cursor', 'has_more'],
  properties: {
    next_cursor: { anyOf: [{ type: 'string', maxLength: 512 }, { type: 'null' }] },
    has_more: { type: 'boolean' },
  },
} as const;
