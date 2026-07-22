import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import type { FastifyInstance } from 'fastify';

import type { ApiConfig } from '@asone/config';
import { AppError } from '@asone/errors';

export async function registerSecurity(app: FastifyInstance, config: ApiConfig): Promise<void> {
  app.addHook('onRequest', (request, _reply, done) => {
    if (!['POST', 'PUT', 'PATCH'].includes(request.method)) {
      done();
      return;
    }

    const contentType = request.headers['content-type'];

    if (
      typeof contentType === 'string' &&
      !contentType.toLowerCase().startsWith('application/json')
    ) {
      done(
        new AppError({
          code: 'unsupported_media_type',
          message: 'Request bodies must use application/json.',
          statusCode: 415,
        }),
      );
      return;
    }

    done();
  });

  await app.register(helmet, {
    global: true,
    ...(config.openapiUiEnabled ? {} : { contentSecurityPolicy: false }),
  });
  await app.register(cors, {
    credentials: false,
    methods: ['GET', 'HEAD', 'OPTIONS', 'POST', 'PUT', 'PATCH', 'DELETE'],
    origin(origin, callback) {
      if (origin === undefined || config.corsAllowedOrigins.includes(origin)) {
        callback(null, true);
        return;
      }
      callback(null, false);
    },
  });
  await app.register(rateLimit, {
    global: true,
    max: config.rateLimitMax,
    timeWindow: config.rateLimitWindowMs,
  });
}
