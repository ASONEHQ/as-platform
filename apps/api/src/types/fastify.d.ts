import type { RequestContext } from '../plugins/request-context.js';

declare module 'fastify' {
  interface FastifyRequest {
    requestContext: RequestContext;
  }
}
