const uuid = { type: 'string', format: 'uuid' } as const;

export const loginSchema = {
  body: {
    type: 'object',
    additionalProperties: false,
    required: ['identifier', 'password'],
    properties: {
      identifier: { type: 'string', minLength: 3, maxLength: 320 },
      password: { type: 'string', minLength: 8, maxLength: 1024 },
      company_id: uuid,
      branch_id: uuid,
      device_id: uuid,
    },
  },
} as const;

export const refreshSchema = {
  body: {
    type: 'object',
    additionalProperties: false,
    required: ['refresh_token'],
    properties: { refresh_token: { type: 'string', minLength: 32, maxLength: 512 } },
  },
} as const;

export const logoutAllSchema = {
  body: {
    type: 'object',
    additionalProperties: false,
    properties: { except_current: { type: 'boolean', default: false } },
  },
} as const;

export const permissionsSchema = {
  querystring: { type: 'object', additionalProperties: false, properties: { branch_id: uuid } },
} as const;
