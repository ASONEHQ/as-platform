import type { CashCardReconciliation, CashPaymentMethodTotal } from '../cash/cash.types.js';

/** TASK 16.15 — one register's contribution to the consolidated view, for
 * the resolved business-date window. `status` distinguishes the four
 * states §17 requires — `no_session` is never conflated with `closed`
 * ("no sale" is not "closed"). Every money field here is read from
 * EXACTLY ONE authoritative source per register (either `CashService.
 * summary()`'s own live fold for an `open`/`closing` session, or the
 * session's own frozen TASK 16.14/16.14A close columns for `closed`) —
 * see `BranchConsolidationService`'s own doc comment for the full
 * no-double-counting proof. */
export type BranchConsolidationRegisterStatus = 'open' | 'closing' | 'closed' | 'no_session';

export interface BranchConsolidationRegister {
  readonly registerId: string;
  readonly registerCode: string;
  readonly registerName: string;
  readonly operationalAreaId: string | null;
  readonly status: BranchConsolidationRegisterStatus;
  readonly cashSessionId: string | null;
  readonly openedAt: string | null;
  readonly closedAt: string | null;
  readonly openingAmount: string | null;
  readonly cashSalesTotal: string | null;
  readonly cashInTotal: string | null;
  readonly cashOutTotal: string | null;
  readonly expectedCash: string | null;
  // `null` unless `status === 'closed'` — an open session has no counted/
  // declared amount yet, never fabricated as `0`.
  readonly countedCash: string | null;
  readonly discrepancyAmount: string | null;
  readonly paymentMethodTotals: readonly CashPaymentMethodTotal[];
  // `null` unless `status === 'closed'` — see `CashCardReconciliation`'s
  // own doc comment; a still-open register has no frozen reconciliation
  // to show yet (never fabricated as `not_applicable`/`pending`).
  readonly cardReconciliation: CashCardReconciliation | null;
}

export interface BranchConsolidationAreaGroup {
  readonly operationalAreaId: string | null;
  readonly operationalAreaName: string | null;
  readonly cashSalesTotal: string;
  readonly registerCount: number;
}

export interface BranchConsolidationTotals {
  readonly cashOpeningTotal: string;
  readonly cashSalesTotal: string;
  readonly cashInTotal: string;
  readonly cashOutTotal: string;
  readonly expectedCashTotal: string;
  readonly countedCashTotal: string;
  readonly cashDifferenceTotal: string;
  readonly paymentMethodTotals: readonly CashPaymentMethodTotal[];
  readonly cardSystemNetTotal: string;
  readonly cardTerminalTotal: string;
  readonly cardDifferenceTotal: string;
  readonly openRegisterCount: number;
  readonly closingRegisterCount: number;
  readonly closedRegisterCount: number;
  readonly noSessionRegisterCount: number;
  // A closed register whose OWN `discrepancyAmount !== 0` — the branch
  // NET difference can be `$0` while this count is still `> 0` (§18 — a
  // shortage in one register and a surplus in another must never cancel
  // out into invisibility).
  readonly discrepantRegisterCount: number;
  // A closed register whose OWN card reconciliation status is `pending`
  // or `discrepancy` — same "never hide behind a net figure" rule (§19).
  readonly cardPendingOrDiscrepantRegisterCount: number;
}

export interface BranchConsolidationResult {
  readonly branchId: string;
  readonly businessDate: string;
  readonly windowStart: string;
  readonly windowEnd: string;
  readonly registers: readonly BranchConsolidationRegister[];
  readonly areas: readonly BranchConsolidationAreaGroup[];
  readonly totals: BranchConsolidationTotals;
}

export type BranchConsolidationErrorCode = 'validation_error' | 'resource_not_found';

export class BranchConsolidationError extends Error {
  constructor(
    readonly code: BranchConsolidationErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'BranchConsolidationError';
  }
}
