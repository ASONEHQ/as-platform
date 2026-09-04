import type { FastifyInstance } from 'fastify';

import { PaymentError, terminalAttemptStatuses, type PaymentMutationContext } from '../payments.types.js';
import type { PaymentService } from '../payments.service.js';
import type { PaymentProvider } from './payment-provider.js';
import { mapMercadoPagoOrderToAttemptStatus } from './mercado-pago.status-mapping.js';
import { verifyMercadoPagoSignature } from './mercado-pago.webhook-signature.js';

export interface MercadoPagoWebhookDependencies {
  readonly paymentService: PaymentService;
  readonly mercadoPagoProvider: PaymentProvider;
  readonly webhookSecret: string | undefined;
}

interface MercadoPagoWebhookBody {
  readonly data?: { readonly id?: string };
}

/** No AS user ever performs a webhook-driven transition — this fixed,
 * documented sentinel is passed as `actorId` purely so `audit_log`'s
 * (nullable) `actor_id` column has something recognizable in it. It is
 * never a real `company_memberships.user_id` and is never used to
 * authorize anything (the webhook route enforces authenticity via the
 * signature check alone, not this id). */
const MERCADO_PAGO_WEBHOOK_ACTOR_ID = '00000000-0000-0000-0000-000000000000';

function singleHeader(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function systemContext(companyId: string, requestId: string, correlationId: string): PaymentMutationContext {
  return {
    companyId,
    actorId: MERCADO_PAGO_WEBHOOK_ACTOR_ID,
    requestId,
    correlationId,
    timestamp: new Date(),
    actorType: 'system',
  };
}

/**
 * `POST /api/v1/webhooks/mercado-pago` — the one endpoint Mercado Pago
 * itself calls. Registered in its own encapsulated Fastify context so its
 * content-type parser (raw string, needed to compute the HMAC signature
 * over the *exact* bytes Mercado Pago sent — a body Fastify had already
 * re-serialized after JSON-parsing it would not reproduce the same
 * bytes) never affects any other route's normal JSON body parsing.
 *
 * Never trusts the notification body for anything beyond "which order
 * should I go re-check" — see ADR-0010 "Webhook endpoint" and
 * `PaymentRepository.findAttemptCompanyByProviderReference`'s own doc
 * comment for the full "never trust provider_reference alone without
 * scoping" reasoning.
 */
export function registerMercadoPagoWebhookRoutes(
  app: FastifyInstance,
  deps: MercadoPagoWebhookDependencies,
): void {
  void app.register((instance) => {
    instance.addContentTypeParser(
      'application/json',
      { parseAs: 'string' },
      (_request, body: string, done) => {
        done(null, body);
      },
    );

    instance.post<{ Body: string }>(
      '/api/v1/webhooks/mercado-pago',
      {
        schema: {
          tags: ['payments', 'webhooks'],
          response: { 200: { type: 'null' }, 401: { type: 'null' } },
        },
      },
      async (request, reply) => {
        const rawBody = request.body;
        let parsed: MercadoPagoWebhookBody;
        try {
          parsed = rawBody.length === 0 ? {} : (JSON.parse(rawBody) as MercadoPagoWebhookBody);
        } catch {
          // Malformed body: nothing to verify or act on. Acknowledge so
          // Mercado Pago does not retry a request that will never parse.
          return reply.code(200).send();
        }
        const dataId = parsed.data?.id;
        const verification = verifyMercadoPagoSignature({
          xSignature: singleHeader(request.headers['x-signature']),
          xRequestId: singleHeader(request.headers['x-request-id']),
          dataId,
          webhookSecret: deps.webhookSecret,
        });
        if (!verification.valid) {
          request.log.warn({ reason: verification.reason }, 'mercado_pago.webhook_rejected');
          return reply.code(401).send();
        }
        if (dataId === undefined) return reply.code(200).send();

        const owner = await deps.paymentService.attemptOwnerByProviderReference(dataId);
        if (owner === null) {
          // A genuinely unknown order (wrong environment, stale test
          // data, a notification for an order this company's AS
          // instance never created). Acknowledged, not retried.
          request.log.warn({ orderId: dataId }, 'mercado_pago.webhook_unknown_order');
          return reply.code(200).send();
        }

        // Official guidance: re-fetch the authoritative order rather
        // than trust incomplete notification fields (§ "Post-
        // Notification Verification" in ADR-0010's own research notes).
        const order = await deps.mercadoPagoProvider.getOrder(dataId);
        const mapped = mapMercadoPagoOrderToAttemptStatus(order, owner.amount);

        const { attempts } = await deps.paymentService.payment(owner.companyId, [owner.branchId], owner.paymentId);
        const currentAttempt = attempts.find((item) => item.id === owner.attemptId);
        if (currentAttempt === undefined) return reply.code(200).send();
        // `created` is never a legal `transitionAttempt` target (it is
        // the *initial* state, not a transition destination) and, per
        // the mapping function's own doc comment, only ever means
        // "nothing new to report yet" — always a no-op regardless of
        // the attempt's current status.
        if (mapped.attemptStatus === 'created') return reply.code(200).send();
        if (currentAttempt.status === mapped.attemptStatus) return reply.code(200).send();
        if (terminalAttemptStatuses.has(currentAttempt.status)) {
          // A duplicate or late notification for an attempt that
          // already reached a terminal state (possibly via this very
          // webhook, delivered twice — Mercado Pago documents retries).
          // Idempotent no-op, not an error.
          request.log.info(
            { attemptId: owner.attemptId, currentStatus: currentAttempt.status },
            'mercado_pago.webhook_already_terminal',
          );
          return reply.code(200).send();
        }

        try {
          await deps.paymentService.transitionAttempt(
            systemContext(owner.companyId, request.requestContext.requestId, request.requestContext.correlationId),
            [owner.branchId],
            owner.attemptId,
            `mp-webhook:${dataId}:${mapped.attemptStatus}`,
            {
              status: mapped.attemptStatus,
              providerReference: dataId,
              ...(mapped.declineReason === null ? {} : { declineReason: mapped.declineReason }),
              metadata: {
                mercado_pago_order_status: order.orderStatus,
                mercado_pago_order_status_detail: order.orderStatusDetail,
                mercado_pago_transaction_status: order.transactionStatus,
                mercado_pago_transaction_status_detail: order.transactionStatusDetail,
                mercado_pago_paid_amount: order.paidAmount,
              },
            },
          );
        } catch (error) {
          if (error instanceof PaymentError && error.code === 'invalid_attempt_state') {
            // Benign race: the attempt moved on between the read above
            // and this write (e.g. two webhook deliveries processed
            // concurrently). Acknowledge — the other delivery already
            // recorded the real outcome.
            request.log.info(
              { attemptId: owner.attemptId },
              'mercado_pago.webhook_race_already_transitioned',
            );
            return reply.code(200).send();
          }
          throw error;
        }
        return reply.code(200).send();
      },
    );
  });
}
