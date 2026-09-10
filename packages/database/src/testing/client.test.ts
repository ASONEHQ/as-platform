import { EventEmitter } from 'node:events';

import { Client, type Pool } from 'pg';
import { describe, expect, it, vi } from 'vitest';

import { createDatabaseClient } from '../client.js';

describe('database client lifecycle', () => {
  it('closes a pool owned by the database client without opening a connection', async () => {
    const client = createDatabaseClient({
      connectionString: 'postgresql://unused:unused@127.0.0.1:1/unused',
    });
    await expect(client.close()).resolves.toBeUndefined();
  });

  it('uses an injected pool without taking ownership of its shutdown', async () => {
    const query = vi.fn().mockResolvedValue({ rows: [] });
    const end = vi.fn().mockResolvedValue(undefined);
    const pool = Object.assign(new EventEmitter(), { query, end }) as unknown as Pool;
    const client = createDatabaseClient({ pool });

    await client.check();
    await client.close();

    expect(query).toHaveBeenCalledWith('SELECT 1');
    expect(end).not.toHaveBeenCalled();
  });
});

// TASK 16.3A regression suite — `SELF_SIGNED_CERT_IN_CHAIN` against a real
// DigitalOcean Managed PostgreSQL cluster, root-caused to `pg`'s own
// `ConnectionParameters` constructor re-parsing `connectionString` and
// letting the re-parsed (connection-string-derived) `ssl` value overwrite
// our own explicit one — see `client.ts`'s own doc comment on
// `connectionStringWithoutSslParams` for the full mechanism.
//
// These tests exercise the EXACT code path a real pooled connection takes:
// `pg.Pool` constructs a fresh `pg.Client` per connection using `pool
// .options` as that client's config, running it through `pg`'s real
// `ConnectionParameters` constructor — so `new Client(client.pool.options)
// .connectionParameters.ssl` is not a simulation of the bug, it is the
// actual resolution `pg` performs, using the real, installed `pg` +
// `pg-connection-string` versions this app ships (never mocked) — a fast,
// deterministic way to prove the exact TLS behavior without a live TLS-
// enabled Postgres server.
// `pg`'s own type declarations don't expose `Client#connectionParameters`
// (it's a real, stable, public-in-practice property `pg` itself relies on
// throughout its own source — see `client.ts`'s doc comment — just not one
// `@types/pg`/`pg`'s own `.d.ts` declares) — this is the one place that
// names its actual shape, so every access below is fully typed instead of
// `any`-propagating through the test file.
interface ResolvedConnectionParameters {
  readonly ssl: unknown;
  readonly user: string | undefined;
  readonly password: string | undefined;
  readonly host: string | undefined;
  readonly port: number;
  readonly database: string | undefined;
}

function connectionParametersOf(client: Client): ResolvedConnectionParameters {
  return (client as unknown as { readonly connectionParameters: ResolvedConnectionParameters })
    .connectionParameters;
}

describe('TLS resolution (TASK 16.3A)', () => {
  function resolvedSsl(
    connectionString: string,
    extra: {
      readonly sslMode?: 'disable' | 'require' | 'verify-ca' | 'verify-full';
      readonly sslRootCert?: string;
    } = {},
  ): unknown {
    const client = createDatabaseClient({ connectionString, ...extra });
    return connectionParametersOf(new Client(client.pool.options)).ssl;
  }

  it("sslmode=require resolves to encrypted-without-verification, matching this driver layer's documented intent — the exact regression this task fixes", () => {
    // Before the fix, this resolved to `{}` (pg's own re-parse of
    // `connectionString` silently overwrote the `{ rejectUnauthorized:
    // false }` `createDatabaseClient` computed), which Node's `tls` module
    // treats as "verify against the default trust store" — full
    // verification — producing `SELF_SIGNED_CERT_IN_CHAIN` against a real
    // DigitalOcean Managed PostgreSQL certificate.
    expect(resolvedSsl('postgresql://u:p@h:5432/d?sslmode=require')).toEqual({
      rejectUnauthorized: false,
    });
  });

  it('sslmode=verify-ca and verify-full resolve to certificate-verifying (rejectUnauthorized: true) — never silently downgraded', () => {
    expect(resolvedSsl('postgresql://u:p@h:5432/d?sslmode=verify-ca')).toEqual({
      rejectUnauthorized: true,
    });
    expect(resolvedSsl('postgresql://u:p@h:5432/d?sslmode=verify-full')).toEqual({
      rejectUnauthorized: true,
    });
  });

  it('verify-ca/verify-full thread a supplied CA certificate through while remaining verifying (never rejectUnauthorized: false)', () => {
    const ca = '-----BEGIN CERTIFICATE-----\nFAKE-TEST-CA-ONLY\n-----END CERTIFICATE-----';
    expect(
      resolvedSsl('postgresql://u:p@h:5432/d?sslmode=verify-full', { sslRootCert: ca }),
    ).toEqual({
      rejectUnauthorized: true,
      ca,
    });
  });

  it('sslmode=disable resolves to no TLS at all', () => {
    expect(resolvedSsl('postgresql://u:p@h:5432/d?sslmode=disable')).toBe(false);
  });

  it('an explicit sslMode override behaves identically to the query-parameter form', () => {
    expect(resolvedSsl('postgresql://u:p@h:5432/d', { sslMode: 'require' })).toEqual({
      rejectUnauthorized: false,
    });
  });

  it('TLS cannot silently downgrade: sslcert/sslkey/sslrootcert query params are stripped too, not just sslmode', () => {
    // These three ALSO make `pg-connection-string` inject `config.ssl = {}`
    // (see `client.ts`'s doc comment) — confirming only `sslmode` is
    // stripped would leave this exact same bug reachable via any of them.
    for (const param of ['sslcert=/tmp/x.crt', 'sslkey=/tmp/x.key', 'sslrootcert=/tmp/ca.crt']) {
      expect(resolvedSsl(`postgresql://u:p@h:5432/d?sslmode=require&${param}`)).toEqual({
        rejectUnauthorized: false,
      });
    }
  });

  it('a percent-encoded password in the connection string survives being stripped of ssl params unmodified', () => {
    const client = createDatabaseClient({
      connectionString: 'postgresql://user:p%40ss%3Aw0rd@host:5432/db?sslmode=require',
    });
    const params = connectionParametersOf(new Client(client.pool.options));
    expect(params.password).toBe('p@ss:w0rd');
    expect(params.user).toBe('user');
    expect(params.host).toBe('host');
    expect(params.port).toBe(5432);
    expect(params.database).toBe('db');
  });

  it('a malformed connection string never throws while resolving ssl params, and never echoes its content in an error', () => {
    expect(() =>
      createDatabaseClient({ connectionString: 'not a valid url at all sslmode=require' }),
    ).not.toThrow();
  });
});
