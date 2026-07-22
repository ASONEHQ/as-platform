import { describe, expect, it, vi } from 'vitest';

import type { DatabaseClient, DatabaseTransaction, TransactionCallback } from '../client.js';
import { withTransaction } from '../transaction.js';

describe('transaction boundary', () => {
  it('runs future state, audit, and outbox writes through one callback', async () => {
    const transaction = vi.fn((callback: TransactionCallback<string>) =>
      callback({} as DatabaseTransaction),
    );
    const callback = vi.fn().mockResolvedValue('committed');

    const result = await withTransaction(
      { transaction } as unknown as Pick<DatabaseClient, 'transaction'>,
      callback,
    );

    expect(result).toBe('committed');
    expect(transaction).toHaveBeenCalledOnce();
    expect(callback).toHaveBeenCalledOnce();
  });
});
