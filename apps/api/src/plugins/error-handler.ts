import type { FastifyError, FastifyInstance, FastifyRequest } from 'fastify';

import { AppError, type InfrastructureErrorCode } from '@asone/errors';

import type { Observability } from './observability.js';

interface SafeDetail {
  readonly field?: string;
  readonly rule?: string;
}

const allowedMethods = ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'] as const;

function validationDetails(error: FastifyError): readonly SafeDetail[] {
  return (error.validation ?? []).slice(0, 20).map((issue) => ({
    ...(issue.instancePath === '' ? {} : { field: issue.instancePath }),
    rule: issue.keyword,
  }));
}

function errorEnvelope(
  request: FastifyRequest,
  code: InfrastructureErrorCode,
  message: string,
  details: readonly unknown[] = [],
): Readonly<Record<string, unknown>> {
  return {
    error: { code, message, details },
    meta: {
      correlation_id: request.requestContext.correlationId,
      request_id: request.requestContext.requestId,
    },
  };
}

export function registerErrorHandler(app: FastifyInstance, observability: Observability): void {
  app.setNotFoundHandler((request, reply) => {
    const url = request.url.split('?', 1)[0] ?? request.url;
    const methods = allowedMethods.filter(
      (method) => method !== request.method && app.hasRoute({ method, url }),
    );
    if (methods.length > 0) {
      observability.errors.inc({ code: 'method_not_allowed' });
      return reply
        .header('allow', methods.join(', '))
        .code(405)
        .send(errorEnvelope(request, 'method_not_allowed', 'The method is not allowed.'));
    }
    observability.errors.inc({ code: 'not_found' });
    return reply.code(404).send(errorEnvelope(request, 'not_found', 'The route was not found.'));
  });

  app.setErrorHandler((error: FastifyError, request, reply) => {
    if (error instanceof AppError) {
      observability.errors.inc({ code: error.code });
      return reply
        .code(error.statusCode)
        .send(
          errorEnvelope(
            request,
            error.code,
            error.message,
            Array.isArray(error.details)
              ? error.details
              : error.details === undefined
                ? []
                : [error.details],
          ),
        );
    }

    if (error.validation !== undefined || error.code === 'FST_ERR_CTP_INVALID_JSON_BODY') {
      observability.errors.inc({ code: 'validation_error' });
      return reply
        .code(400)
        .send(
          errorEnvelope(
            request,
            'validation_error',
            'The request is invalid.',
            validationDetails(error),
          ),
        );
    }

    const transportErrors: Readonly<
      Record<string, readonly [InfrastructureErrorCode, number, string]>
    > = {
      FST_ERR_CTP_BODY_TOO_LARGE: ['payload_too_large', 413, 'The request payload is too large.'],
      FST_ERR_CTP_INVALID_MEDIA_TYPE: [
        'unsupported_media_type',
        415,
        'The request media type is not supported.',
      ],
    };
    const errorCode = typeof error.code === 'string' ? error.code : '';
    const mapped = transportErrors[errorCode];
    if (mapped !== undefined) {
      const [code, status, message] = mapped;
      observability.errors.inc({ code });
      return reply.code(status).send(errorEnvelope(request, code, message));
    }

    if (error.statusCode === 429) {
      observability.errors.inc({ code: 'rate_limit_exceeded' });
      return reply
        .code(429)
        .send(errorEnvelope(request, 'rate_limit_exceeded', 'Too many requests. Retry later.'));
    }

    observability.errors.inc({ code: 'internal_error' });
    request.log.error(
      {
        correlation_id: request.requestContext.correlationId,
        err: error,
        request_id: request.requestContext.requestId,
      },
      'request failed',
    );
    return reply
      .code(500)
      .send(errorEnvelope(request, 'internal_error', 'An unexpected error occurred.'));
  });
}
