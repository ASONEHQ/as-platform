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
  // RC 15.0 Phase 8 (Security Certification): reproduces the exact shape of
  // a real `pg` `DatabaseError` for an invalid UUID cast (Postgres code
  // `22P02`) without requiring a live database, so `error-handler.ts`'s
  // mapping of that code to a clean 400 is covered by a fast unit test.
  app.get('/__test/postgres-invalid-uuid', () => {
    const error = new Error('invalid input syntax for type uuid: "not-a-uuid"') as Error & {
      code: string;
    };
    error.code = '22P02';
    throw error;
  });
}
