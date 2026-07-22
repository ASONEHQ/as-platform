import type { RequestContext } from '../plugins/request-context.js';
import type { AuthContext } from '../modules/auth/auth.types.js';

declare module 'fastify' {
  interface FastifyRequest {
    requestContext: RequestContext;
    authContext?: AuthContext;
  }
}
