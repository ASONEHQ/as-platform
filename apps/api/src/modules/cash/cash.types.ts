/** §21.1's exact 3 states — never a project-invented name. */
export type CashSessionStatus = 'open' | 'closing' | 'closed';
export const cashSessionStatuses: readonly CashSessionStatus[] = ['open', 'closing', 'closed'];

export type CashRegisterStatus = 'active' | 'inactive' | 'retired';

// TASK 12.8 adds `cash_refund` — system-posted, mirroring `cash_sale`'s
// own precedent exactly (never client-postable through
// `POST /cash-sessions/{id}/movements`). See ADR-0015.
export type CashMovementType = 'opening_float' | 'cash_sale' | 'cash_in' | 'cash_out' | 'cash_refund';
export const cashMovementTypes: readonly CashMovementType[] = [
  'opening_float',
  'cash_sale',
  'cash_in',
  'cash_out',
  'cash_refund',
];
/** Direction encodes the ledger's sign; `cash_movements.amount` itself is
 * always stored positive (`amount > 0`, per CORE_DATA_MODEL §6.3). */
export const cashMovementDirection: Readonly<Record<CashMovementType, 1 | -1>> = {
  opening_float: 1,
  cash_sale: 1,
  cash_in: 1,
  cash_out: -1,
  cash_refund: -1,
};

export interface CashRegisterRow {
  id: string;
  companyId: string;
  branchId: string;
  code: string;
  name: string;
  status: CashRegisterStatus;
  deviceId: string | null;
  createdBy: string;
  updatedBy: string;
  version: bigint;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
}

/** One denomination line from the Part J cash count (bills/coins). `value`
 * is a canonical money string (e.g. `"500.0000"`), never a float. */
export interface DenominationCount {
  value: string;
  quantity: number;
}

/** The exact bill/coin set AS POS V1's own `modal-cierre-caja` ("Cierre de
 * caja — Arqueo") canonically counts (its `DENOMINACIONES` array) —
 * confirmed present, so reused verbatim rather than inventing a new set
 * (Part J). Ordered highest to lowest, matching V1's own display order. */
export const canonicalCashDenominationsMXN: readonly string[] = [
  '1000.0000',
  '500.0000',
  '200.0000',
  '100.0000',
  '50.0000',
  '20.0000',
  '10.0000',
  '5.0000',
  '2.0000',
  '1.0000',
  '0.5000',
];

export interface CashSessionRow {
  id: string;
  companyId: string;
  branchId: string;
  cashRegisterId: string;
  openedBy: string;
  openedAt: Date;
  openingAmount: string;
  currencyCode: string;
  status: CashSessionStatus;
  closedBy: string | null;
  closedAt: Date | null;
  declaredClosingAmount: string | null;
  expectedClosingAmount: string | null;
  discrepancyAmount: string | null;
  denominationCounts: readonly DenominationCount[] | null;
  version: bigint;
  createdAt: Date;
  updatedAt: Date;
}

export interface CashMovementRow {
  id: string;
  companyId: string;
  branchId: string;
  cashSessionId: string;
  movementType: CashMovementType;
  amount: string;
  currencyCode: string;
  reasonCode: string;
  note: string | null;
  referenceType: string | null;
  referenceId: string | null;
  occurredAt: Date;
  createdBy: string;
  deviceId: string | null;
  reversalOfId: string | null;
  createdAt: Date;
}

export interface CashMutationContext {
  companyId: string;
  actorId: string;
  requestId: string;
  correlationId: string;
  timestamp: Date;
  deviceId?: string | undefined;
}

export type CashErrorCode =
  | 'validation_error'
  | 'idempotency_conflict'
  | 'resource_not_found'
  | 'version_conflict'
  | 'cash_session_required'
  | 'cash_session_already_open'
  | 'cash_session_not_open'
  | 'cash_session_closed';

export class CashError extends Error {
  constructor(
    readonly code: CashErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'CashError';
  }
}
