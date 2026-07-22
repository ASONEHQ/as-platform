import type { FastifyInstance } from 'fastify';
import { Counter, Gauge, Histogram, Registry } from 'prom-client';

export interface Observability {
  readonly registry: Registry;
  readonly requests: Counter<'method' | 'route' | 'status'>;
  readonly duration: Histogram<'method' | 'route' | 'status'>;
  readonly errors: Counter<'code'>;
  readonly readiness: Gauge<'service'>;
}

export function createObservability(): Observability {
  const registry = new Registry();
  const requests = new Counter({
    name: 'asone_http_requests_total',
    help: 'Total HTTP requests handled by the API.',
    labelNames: ['method', 'route', 'status'] as const,
    registers: [registry],
  });
  const duration = new Histogram({
    name: 'asone_http_request_duration_seconds',
    help: 'HTTP request duration in seconds.',
    labelNames: ['method', 'route', 'status'] as const,
    registers: [registry],
    buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5],
  });
  const errors = new Counter({
    name: 'asone_http_errors_total',
    help: 'HTTP errors returned by stable public code.',
    labelNames: ['code'] as const,
    registers: [registry],
  });
  const readiness = new Gauge({
    name: 'asone_readiness_dependency',
    help: 'Dependency readiness, where one is available and zero is unavailable.',
    labelNames: ['service'] as const,
    registers: [registry],
  });

  return Object.freeze({ registry, requests, duration, errors, readiness });
}

export function registerObservability(
  app: FastifyInstance,
  observability: Observability,
  metricsEnabled: boolean,
): void {
  app.addHook('onResponse', (request, reply, done) => {
    const labels = {
      method: request.method,
      route: request.routeOptions.url ?? 'unmatched',
      status: String(reply.statusCode),
    };
    observability.requests.inc(labels);
    observability.duration.observe(labels, reply.elapsedTime / 1_000);
    done();
  });

  if (metricsEnabled) {
    app.get(
      '/metrics',
      {
        config: { rateLimit: false },
        schema: {
          hide: true,
          response: { 200: { type: 'string' } },
        },
      },
      async (_request, reply) => {
        reply.type(observability.registry.contentType);
        return observability.registry.metrics();
      },
    );
  }
}
