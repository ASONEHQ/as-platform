import { responseMetaSchema } from './common.js';

export const errorResponseSchema = {
  $id: 'errorResponse',
  type: 'object',
  additionalProperties: false,
  required: ['error', 'meta'],
  properties: {
    error: {
      type: 'object',
      additionalProperties: false,
      required: ['code', 'message', 'details'],
      properties: {
        code: { type: 'string', minLength: 1, maxLength: 64 },
        message: { type: 'string', minLength: 1, maxLength: 256 },
        details: { type: 'array', maxItems: 50, items: {} },
      },
    },
    meta: responseMetaSchema,
  },
} as const;
