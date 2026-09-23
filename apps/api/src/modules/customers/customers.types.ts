/** TASK 13.0 — see `packages/database/src/schema/customers.ts` and
 * ADR-0017 for the full domain reconciliation. Genuinely new module — no
 * pre-existing customer contract exists anywhere in this repository. */

export type CustomerStatus = 'active' | 'inactive' | 'archived';
export const customerStatuses: readonly CustomerStatus[] = ['active', 'inactive', 'archived'];

export interface CustomerRow {
  id: string;
  companyId: string;
  firstName: string;
  lastName: string | null;
  displayName: string;
  email: string | null;
  normalizedEmail: string | null;
  phone: string | null;
  normalizedPhone: string | null;
  phoneCountryCode: string | null;
  birthDate: string | null;
  status: CustomerStatus;
  notes: string | null;
  createdBy: string;
  updatedBy: string;
  version: bigint;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateCustomerInput {
  firstName: string;
  lastName?: string;
  /** Explicit override — when omitted, derived as `firstName + ' ' +
   * lastName` (trimmed). */
  displayName?: string;
  email?: string;
  phone?: string;
  birthDate?: string;
  notes?: string;
}

export interface UpdateCustomerInput {
  firstName?: string;
  lastName?: string;
  displayName?: string;
  email?: string;
  phone?: string;
  birthDate?: string;
  status?: CustomerStatus;
  notes?: string;
  expectedVersion: bigint;
}

export interface CustomerSearchQuery {
  companyId: string;
  /** Matches `display_name` (case-insensitive substring), `normalized_
   * email` (exact), or `normalized_phone` (exact) — Part E. */
  search?: string;
  status?: CustomerStatus;
  cursor?: string;
  limit: number;
}

export interface CustomerListPage {
  items: readonly CustomerRow[];
  nextCursor: string | null;
  hasMore: boolean;
}

export type QrTokenStatus = 'active' | 'revoked';

export interface CustomerQrTokenRow {
  id: string;
  companyId: string;
  customerId: string;
  token: string;
  status: QrTokenStatus;
  createdAt: Date;
  revokedAt: Date | null;
}

export type CustomerErrorCode =
  | 'validation_error'
  | 'permission_denied'
  | 'resource_not_found'
  | 'resource_conflict'
  | 'version_conflict'
  | 'customer_identity_conflict'
  | 'qr_token_invalid';

export class CustomerError extends Error {
  constructor(
    readonly code: CustomerErrorCode,
    message: string,
    /** Part D/I — a duplicate/conflict error carries the existing
     * customer id(s) so the POS "quick registration" flow can OFFER the
     * existing customer instead of failing blindly, never silently
     * merging. */
    readonly details?: Readonly<Record<string, unknown>>,
  ) {
    super(message);
    this.name = 'CustomerError';
  }
}

export interface CustomerMutationContext {
  companyId: string;
  actorId: string;
  actorPermissions: readonly string[];
  requestId: string;
  correlationId: string;
  timestamp: Date;
}
