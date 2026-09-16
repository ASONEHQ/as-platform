import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import type { FastifyInstance } from 'fastify';

import type { ApiConfig } from '@asone/config';
import { AppError } from '@asone/errors';

// TASK 14.5A: the one real multipart route this codebase had at the
// time this allowlist was written (`branding.routes.ts`'s logo upload)
// needs a real `multipart/form-data` body, which the blanket JSON-only
// rule below would otherwise reject with a 415 before the route itself
// ever runs — a real bug caught by a live end-to-end rehearsal against
// the fully wired app (the route's own integration test builds a
// minimal Fastify instance that never registers this hook, so it never
// caught this).
//
// TASK 16.6D — the EXACT SAME class of bug recurred: TASK 16.6's own
// product-image upload route (`POST /api/v1/products/:id/image`,
// `product-catalog.routes.ts`) was added with a correct
// `consumes: ['multipart/form-data']` schema but was never added HERE,
// so every real upload was rejected by THIS hook with a 415 before ever
// reaching that route's own careful MIME/magic-byte validation — a
// production-only bug, invisible to `product-catalog.routes.test.ts`'s
// own minimal Fastify instance (same root cause as the branding
// precedent above: that test file never registers this hook either) and
// to `product-catalog.routes.integration.test.ts`'s real-Postgres+MinIO
// coverage (which also builds its own bare `Fastify()` instance, not the
// fully wired app — see `security.test.ts` for the new regression
// coverage that would have caught both of these).
//
// Matched against `request.routeOptions.url` (the route's *registered*
// pattern, e.g. `/api/v1/products/:id/image`, not the resolved URL with
// a real id in it) so this stays a narrow, explicit allowlist — every
// other POST/PUT/PATCH route in the app is completely unaffected and
// still requires `application/json`.
const MULTIPART_ROUTE_ALLOWLIST = new Set([
  '/api/v1/companies/:company_id/branding/logo',
  '/api/v1/products/:id/image',
]);

export async function registerSecurity(app: FastifyInstance, config: ApiConfig): Promise<void> {
  await app.register(helmet, {
    global: true,
    ...(config.openapiUiEnabled ? {} : { contentSecurityPolicy: false }),
  });
  // TASK 16.6D — `cors` registers its own `onRequest` hook, so it MUST be
  // registered before the manual "body must be JSON" hook below: Fastify
  // runs same-context `onRequest` hooks in registration order, and this
  // custom hook can short-circuit a request with a thrown 415 — when it
  // used to run FIRST, that error response skipped `cors`'s own header
  // logic entirely, so the browser received a response with NO
  // `Access-Control-Allow-Origin` header at all. A browser can't read the
  // real status code of a CORS-blocked response, so `fetch`/Flutter's
  // `http` client saw an opaque network failure instead of a genuine
  // `415` — this is exactly how TASK 16.6D's real production bug (every
  // product-image upload rejected by the missing allowlist entry above)
  // surfaced in Flutter as the misleading generic "El servicio no está
  // disponible" instead of an honest, mappable status code. Registering
  // `cors` first means its headers are already attached before this hook
  // ever gets a chance to reject anything, for every current and future
  // route this hook governs — not just the one bug that happened to be
  // found this task.
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
  await app.register(rateLimit, {
    global: true,
    max: config.rateLimitMax,
    timeWindow: config.rateLimitWindowMs,
  });
}
