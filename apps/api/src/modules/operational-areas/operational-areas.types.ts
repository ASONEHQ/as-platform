/** TASK 16.15 — see `packages/database/src/schema/operational-areas.ts`'s
 * own doc comment for the full "why this exists, why it's not
 * `product_categories.operational_group`" rationale. */
export type OperationalAreaStatus = 'active' | 'inactive';
export const operationalAreaStatuses: readonly OperationalAreaStatus[] = ['active', 'inactive'];

export interface OperationalAreaRow {
  id: string;
  companyId: string;
  branchId: string;
  code: string;
  name: string;
  status: OperationalAreaStatus;
  createdBy: string;
  updatedBy: string;
  version: bigint;
  createdAt: Date;
  updatedAt: Date;
}

export interface OperationalAreaMutationContext {
  companyId: string;
  actorId: string;
  requestId: string;
  correlationId: string;
  timestamp: Date;
}

export type OperationalAreaErrorCode =
  | 'validation_error'
  | 'idempotency_conflict'
  | 'resource_not_found'
  | 'version_conflict';

export class OperationalAreaError extends Error {
  constructor(
    readonly code: OperationalAreaErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'OperationalAreaError';
  }
}
