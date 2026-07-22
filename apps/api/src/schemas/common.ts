export const requestIdSchema = {
  type: 'string',
  minLength: 1,
  maxLength: 128,
  pattern: '^[A-Za-z0-9._-]+$',
} as const;

export const responseMetaSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['request_id', 'correlation_id'],
  properties: {
    request_id: requestIdSchema,
    correlation_id: requestIdSchema,
  },
} as const;

export const successEnvelopeSchema = {
  $id: 'successEnvelope',
  type: 'object',
  additionalProperties: false,
  required: ['data', 'meta'],
  properties: {
    data: { type: 'object', additionalProperties: true },
    meta: responseMetaSchema,
  },
} as const;
