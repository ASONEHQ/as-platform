import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';

import type { FastifyInstance, FastifyRequest } from 'fastify';

const identifierPattern = /^[A-Za-z0-9._-]{1,128}$/u;

export interface RequestContext {
  readonly requestId: string;
  readonly correlationId: string;
  readonly companyId: string | undefined;
  readonly branchId: string | undefined;
  readonly userId: string | undefined;
  readonly sessionId: string | undefined;
  readonly deviceId: string | undefined;
}

export const requestContextStorage = new AsyncLocalStorage<RequestContext>();

function validHeader(value: string | string[] | undefined): string | undefined {
  return typeof value === 'string' && identifierPattern.test(value) ? value : undefined;
}

function createContext(request: FastifyRequest): RequestContext {
  const requestId = validHeader(request.headers['x-request-id']) ?? randomUUID();
  return Object.freeze({
    requestId,
    correlationId: validHeader(request.headers['x-correlation-id']) ?? randomUUID(),
    companyId: undefined,
    branchId: undefined,
    userId: undefined,
    sessionId: undefined,
    deviceId: undefined,
  });
}

export function registerRequestContext(app: FastifyInstance): void {
  app.decorateRequest('requestContext');
  app.addHook('onRequest', (request, reply, done) => {
    const context = createContext(request);
    request.requestContext = context;
    reply.header('x-request-id', context.requestId);
    // RC 15.0 Phase 14 (Observability) fix: `security.ts` already declares
    // `X-Correlation-ID` in CORS `exposedHeaders` (a client-facing promise
    // that the header is readable), but until now only `x-request-id` was
    // ever actually set on the response -- a client had no way to read back
    // the correlation id it sent (or the one the server generated for it)
    // outside of an error envelope's `meta.correlation_id`, which only
    // exists on error responses. Every response now carries both ids,
    // exactly like `x-request-id` already did, so a caller can always
    // correlate a request end-to-end (success or failure) without needing
    // to trigger an error first. See docs/RC_OBSERVABILITY.md item 4.
    reply.header('x-correlation-id', context.correlationId);
    requestContextStorage.run(context, done);
  });

  app.addHook('onResponse', (request, reply, done) => {
    const route = request.routeOptions.url ?? 'unmatched';
    request.log.info(
      {
        correlation_id: request.requestContext.correlationId,
        duration_ms: reply.elapsedTime,
        method: request.method,
        request_id: request.requestContext.requestId,
        route,
        status: reply.statusCode,
      },
      'request completed',
    );
    done();
  });
}
