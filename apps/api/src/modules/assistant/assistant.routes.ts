import type { FastifyInstance } from 'fastify';

import { successResponse } from '../../http/response.js';
import { requireAuthenticatedUser, requireBranchAccess } from '../auth/auth.guards.js';
import type { AuthService } from '../auth/auth.service.js';
import { withAssistantErrors } from './assistant.http-errors.js';
import type { AssistantService } from './assistant.service.js';
import type { AssistantAnswer } from './assistant.types.js';

/**
 * TASK 12.2 — "Asistente" HTTP surface: a single, real, read-only,
 * informational endpoint (`POST /api/v1/assistant/query`).
 *
 * Deliberately gated by AUTHENTICATION ALONE
 * (`requireAuthenticatedUser(request, authentication)`), never a
 * `requirePermission(...)` call, and NO new permission code is seeded for
 * it (`packages/database/src/seeds/technical-permissions.ts` is
 * off-limits this wave — see this task's own final report). The
 * reasoning: this endpoint invents no new capability of its own — every
 * figure it can ever return (today's sales, whether a register is open,
 * low-stock count, today's party count) is already something the SAME
 * actor's own session (`companyId`/`permittedBranchIds`) can already see
 * through the Dashboard/Reports/Cash/Inventory/Parties endpoints, each of
 * which already gates on its own permission code
 * (`report.read`/`cash.*`/`inventory.*`/`party.read`). Picking any ONE of
 * those existing codes to gate this endpoint would be an arbitrary,
 * meaningless restriction (why `report.read` and not `cash.read`?) —
 * this is a thin, read-only convenience layer over data the caller's
 * session already has standing access to, so it is gated the same way
 * `AuthenticatedContext`-only screens are: real authentication is
 * required, and nothing more. `branch_id`, when supplied, still goes
 * through the real `requireBranchAccess` check exactly like every other
 * branch-scoped module — a caller can never widen its own scope by
 * passing an unauthorized branch here.
 */

const errorSchema = { type: 'object', additionalProperties: true } as const;
const commonErrors = { 400: errorSchema, 401: errorSchema, 403: errorSchema } as const;
const responseSchema = { type: 'object', additionalProperties: true } as const;

interface AssistantQueryBody {
  question: string;
  branch_id?: string;
}

const assistantQueryBodySchema = {
  type: 'object',
  additionalProperties: false,
  required: ['question'],
  properties: {
    question: { type: 'string', minLength: 1, maxLength: 500 },
    branch_id: { type: 'string', format: 'uuid' },
  },
} as const;

function assistantAnswerHttp(answer: AssistantAnswer): Readonly<Record<string, unknown>> {
  return {
    intent: answer.intent,
    question: answer.question,
    answer_text: answer.answerText,
    data: answer.data,
  };
}

export function registerAssistantRoutes(app: FastifyInstance, authentication: AuthService, service: AssistantService): void {
  // POST /api/v1/assistant/query.
  app.post<{ Body: AssistantQueryBody }>(
    '/api/v1/assistant/query',
    { schema: { tags: ['assistant'], body: assistantQueryBodySchema, response: { 200: responseSchema, ...commonErrors } } },
    async (request, reply) =>
      withAssistantErrors(async () => {
        const auth = await requireAuthenticatedUser(request, authentication);
        if (request.body.branch_id !== undefined) requireBranchAccess(authentication, auth, request.body.branch_id);
        const answer = await service.answer(
          auth.companyId,
          auth.permittedBranchIds,
          request.body.branch_id,
          request.body.question,
        );
        return reply.send(successResponse(assistantAnswerHttp(answer), request.requestContext));
      }),
  );
}
