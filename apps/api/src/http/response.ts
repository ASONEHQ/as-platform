import type { RequestContext } from '../plugins/request-context.js';

export interface ResponseMeta {
  readonly request_id: string;
  readonly correlation_id: string;
}

export interface SuccessEnvelope<T> {
  readonly data: T;
  readonly meta: ResponseMeta;
}

export function responseMeta(context: RequestContext): ResponseMeta {
  return Object.freeze({
    correlation_id: context.correlationId,
    request_id: context.requestId,
  });
}

export function successResponse<T>(data: T, context: RequestContext): SuccessEnvelope<T> {
  return Object.freeze({ data, meta: responseMeta(context) });
}
