import { PaymentProviderError } from './payment-provider.js';

/** Minimal structural subset of Pino's `Logger` this client needs —
 * avoids a hard dependency on `@asone/logger`'s concrete type just to log
 * three sanitized fields. */
export interface MercadoPagoClientLogger {
  warn(payload: Readonly<Record<string, unknown>>, message: string): void;
  error(payload: Readonly<Record<string, unknown>>, message: string): void;
}

const noopLogger: MercadoPagoClientLogger = {
  warn: () => undefined,
  error: () => undefined,
};

export interface MercadoPagoClientOptions {
  readonly accessToken: string | undefined;
  readonly apiBaseUrl: string;
  readonly timeoutMs?: number;
  readonly logger?: MercadoPagoClientLogger;
  /** Injectable for tests — defaults to the global `fetch`. */
  readonly fetchImpl?: typeof fetch;
}

interface RequestOptions {
  readonly method: 'GET' | 'POST';
  readonly path: string;
  readonly query?: Readonly<Record<string, string | undefined>>;
  readonly body?: unknown;
  /** Mercado Pago's own `X-Idempotency-Key` — required on every POST that
   * creates or mutates money movement (create order, cancel, refund).
   * Never reused across two genuinely different requests. */
  readonly idempotencyKey?: string;
}

/**
 * The one place this backend ever sends a Bearer Access Token to Mercado
 * Pago, or reads one from configuration. `MercadoPagoPointProvider` (the
 * `PaymentProvider` implementation) is the only caller — Flutter never
 * holds a reference to this class, directly or indirectly, matching the
 * task's explicit "provider code belongs in the backend only" boundary.
 *
 * Deliberately built on the Node 24 global `fetch` (`AbortController` for
 * timeouts) rather than a new dependency — no HTTP client library exists
 * anywhere else in this backend to match (confirmed by inspection before
 * writing this).
 */
export class MercadoPagoClient {
  private readonly accessToken: string | undefined;
  private readonly apiBaseUrl: string;
  private readonly timeoutMs: number;
  private readonly logger: MercadoPagoClientLogger;
  private readonly fetchImpl: typeof fetch;

  public constructor(options: MercadoPagoClientOptions) {
    this.accessToken = options.accessToken;
    this.apiBaseUrl = options.apiBaseUrl.replace(/\/+$/u, '');
    this.timeoutMs = options.timeoutMs ?? 10_000;
    this.logger = options.logger ?? noopLogger;
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  public async request<T>(options: RequestOptions): Promise<T> {
    if (this.accessToken === undefined || this.accessToken.length === 0) {
      throw new PaymentProviderError(
        'not_configured',
        'Mercado Pago is not configured (MERCADO_PAGO_ACCESS_TOKEN is missing).',
      );
    }
    const url = new URL(`${this.apiBaseUrl}${options.path}`);
    for (const [key, value] of Object.entries(options.query ?? {})) {
      if (value !== undefined) url.searchParams.set(key, value);
    }
    const headers: Record<string, string> = {
      // Never logged, never included in any thrown error's message/details.
      authorization: `Bearer ${this.accessToken}`,
      accept: 'application/json',
    };
    if (options.body !== undefined) headers['content-type'] = 'application/json';
    if (options.idempotencyKey !== undefined) headers['x-idempotency-key'] = options.idempotencyKey;

    const controller = new AbortController();
    const timer = setTimeout(() => {
      controller.abort();
    }, this.timeoutMs);
    let response: Response;
    const startedAt = Date.now();
    try {
      response = await this.fetchImpl(url, {
        method: options.method,
        headers,
        signal: controller.signal,
        ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
      });
    } catch (error) {
      const elapsedMs = Date.now() - startedAt;
      if (error instanceof Error && error.name === 'AbortError') {
        this.logger.warn({ path: options.path, elapsedMs }, 'mercado_pago.request_timeout');
        throw new PaymentProviderError('timeout', 'Mercado Pago request timed out.');
      }
      this.logger.error(
        { path: options.path, elapsedMs, errorName: error instanceof Error ? error.name : 'unknown' },
        'mercado_pago.request_failed',
      );
      throw new PaymentProviderError('network_error', 'Could not reach Mercado Pago.');
    } finally {
      clearTimeout(timer);
    }

    const requestId = response.headers.get('x-request-id') ?? undefined;
    let parsed: unknown;
    const raw = await response.text();
    try {
      parsed = raw.length === 0 ? {} : JSON.parse(raw);
    } catch {
      this.logger.error(
        { path: options.path, status: response.status, requestId },
        'mercado_pago.malformed_response',
      );
      throw new PaymentProviderError(
        'invalid_response',
        'Mercado Pago returned a malformed response body.',
        response.status,
      );
    }

    if (response.status === 429) {
      throw new PaymentProviderError('rate_limited', 'Mercado Pago rate-limited this request.', 429, {
        requestId,
      });
    }
    if (response.status >= 400) {
      const body = typeof parsed === 'object' && parsed !== null ? (parsed as Record<string, unknown>) : {};
      this.logger.warn(
        { path: options.path, status: response.status, requestId },
        'mercado_pago.request_rejected',
      );
      throw new PaymentProviderError(
        'provider_rejected',
        `Mercado Pago rejected the request (HTTP ${String(response.status)}).`,
        response.status,
        // `message`/`error`/`cause` are Mercado Pago's own documented
        // error-body fields — never a card field, since this endpoint
        // family never accepts or returns one.
        {
          requestId,
          message: body.message,
          error: body.error,
          cause: body.cause,
        },
      );
    }
    return parsed as T;
  }
}
