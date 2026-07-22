import { EventEmitter } from 'node:events';

import type { Pool } from 'pg';
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
