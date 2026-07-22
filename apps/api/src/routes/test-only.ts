import type { FastifyInstance } from 'fastify';

import { AppError } from '@asone/errors';

export function registerTestOnlyRoutes(app: FastifyInstance): void {
  app.post(
    '/__test/echo',
    {
      schema: {
        body: {
          type: 'object',
          additionalProperties: false,
          required: ['value'],
          properties: { value: { type: 'string', minLength: 1, maxLength: 32 } },
        },
      },
    },
    (request) => ({ data: request.body }),
  );
  app.get('/__test/internal-error', () => {
    throw new Error('internal path C:\\private DATABASE_URL=secret');
  });
  app.get('/__test/app-error', () => {
    throw new AppError({
      code: 'service_unavailable',
      statusCode: 503,
      message: 'The technical dependency is unavailable.',
    });
  });
}
