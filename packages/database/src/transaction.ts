import type { DatabaseClient, TransactionCallback } from './client.js';

export function withTransaction<T>(
  client: Pick<DatabaseClient, 'transaction'>,
  callback: TransactionCallback<T>,
): Promise<T> {
  return client.transaction(callback);
}
