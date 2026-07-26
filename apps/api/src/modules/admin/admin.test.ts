import { describe, expect, it } from 'vitest';

import type { DatabaseClient } from '@asone/database';

import { AdminRepository } from './shared/admin.repository.js';

interface RecordedQuery {
  readonly sql: string;
  readonly values: readonly unknown[];
}

function repositoryFixture(): { repository: AdminRepository; queries: RecordedQuery[] } {
  const queries: RecordedQuery[] = [];
  const client = {
    query: (sql: string, values: readonly unknown[] = []): Promise<{ rows: never[] }> => {
      queries.push({ sql, values });
      return Promise.resolve({ rows: [] });
    },
    release: (): undefined => undefined,
  };
  const database = {
    pool: {
      connect: () => Promise.resolve(client),
      query: client.query,
    },
  } as unknown as DatabaseClient;
  return { repository: new AdminRepository(database), queries };
}

describe('administration transaction boundary', () => {
  it('commits mutation, audit, and outbox in one transaction with request context', async () => {
    const { repository, queries } = repositoryFixture();
    await repository.mutate({
      companyId: '00000000-0000-4000-8000-000000000001',
      branchId: '00000000-0000-4000-8000-000000000002',
      actorId: '00000000-0000-4000-8000-000000000003',
      requestId: 'request-1',
      correlationId: 'correlation-1',
      action: 'device.revoked',
      entityType: 'device',
      entityId: '00000000-0000-4000-8000-000000000004',
      eventType: 'device.revoked',
      metadata: { reason_code: 'security' },
      mutation: async (client) => {
        await client.query('update devices set status=$1', ['revoked']);
      },
    });

    expect(queries.map(({ sql }) => sql.trim().split(/\s+/u)[0])).toEqual([
      'begin',
      'update',
      'insert',
      'insert',
      'commit',
    ]);
    const audit = queries[2];
    expect(audit?.sql).toContain('audit_log');
    expect(audit?.values).toContain('request-1');
    expect(audit?.values).toContain('correlation-1');
    expect(audit?.values).toContain('device.revoked');
    expect(queries[3]?.sql).toContain('outbox_events');
  });

  it('rolls back and does not write audit or outbox when the mutation fails', async () => {
    const { repository, queries } = repositoryFixture();
    await expect(
      repository.mutate({
        companyId: '00000000-0000-4000-8000-000000000001',
        actorId: '00000000-0000-4000-8000-000000000003',
        requestId: 'request-2',
        correlationId: 'correlation-2',
        action: 'role.permissions_changed',
        entityType: 'role',
        entityId: '00000000-0000-4000-8000-000000000004',
        eventType: 'role.permissions_changed',
        mutation: () => Promise.reject(new Error('constraint failure')),
      }),
    ).rejects.toThrow('constraint failure');
    expect(queries.map(({ sql }) => sql)).toEqual(['begin', 'rollback']);
  });
});
