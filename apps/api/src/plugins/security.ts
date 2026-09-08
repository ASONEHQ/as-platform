import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import type { FastifyInstance } from 'fastify';

import type { ApiConfig } from '@asone/config';
import { AppError } from '@asone/errors';

// TASK 14.5A: the one real multipart route this codebase has ever
// registered (`branding.routes.ts`'s logo upload) needs a real
// `multipart/form-data` body, which the blanket JSON-only rule below
// would otherwise reject with a 415 before the route itself ever runs —
// a real bug caught by a live end-to-end rehearsal against the fully
// wired app (the route's own integration test builds a minimal Fastify
// instance that never registers this hook, so it never caught this).
// Matched against `request.routeOptions.url` (the route's *registered*
// pattern, e.g. `/api/v1/companies/:company_id/branding/logo`, not the
// resolved URL with a real id in it) so this stays a narrow, explicit
// allowlist — every other POST/PUT/PATCH route in the app is completely
// unaffected and still requires `application/json`.
const MULTIPART_ROUTE_ALLOWLIST = new Set(['/api/v1/companies/:company_id/branding/logo']);

export async function registerSecurity(app: FastifyInstance, config: ApiConfig): Promise<void> {
  app.addHook('onRequest', (request, _reply, done) => {
    if (!['POST', 'PUT', 'PATCH'].includes(request.method)) {
      done();
      return;
    }

    const contentType = request.headers['content-type'];
    const routePattern = request.routeOptions.url;
    const isAllowedMultipartRoute =
      routePattern !== undefined &&
      MULTIPART_ROUTE_ALLOWLIST.has(routePattern) &&
      typeof contentType === 'string' &&
      contentType.toLowerCase().startsWith('multipart/form-data');

    if (
      !isAllowedMultipartRoute &&
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
    credentials: true,
    methods: ['GET', 'HEAD', 'OPTIONS', 'POST', 'PUT', 'PATCH', 'DELETE'],
    allowedHeaders: [
      'Authorization',
      'Content-Type',
      'X-ASONE-Client',
      'X-CSRF-Token',
      'X-Request-ID',
      'X-Correlation-ID',
      'Idempotency-Key',
      'If-Match',
    ],
    exposedHeaders: [
      'ETag',
      'X-Request-ID',
      'X-Correlation-ID',
      'X-RateLimit-Limit',
      'X-RateLimit-Remaining',
      'X-RateLimit-Reset',
      'Retry-After',
    ],
    maxAge: 600,
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
