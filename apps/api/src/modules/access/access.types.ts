/**
 * TASK 14.4 (Wave 2, Part E) — Access/Occupancy: a REAL replacement for
 * the legacy's own FAKE "Control de Acceso" ticket scanner (confirmed by
 * forensic audit — `docs/LEGACY_FUNCTIONAL_PARITY.md`'s Accesos section:
 * `accScan()` accepted ANY input and fabricated a random customer name,
 * always reporting success). This is explicitly classified H (safely
 * replaced), never counted as "the legacy mechanism was real and this
 * ports it" — the legacy validated nothing; this validates for real,
 * server-side, honestly rejecting unknown/void/wrong-branch/already-used
 * credentials rather than always succeeding.
 *
 * See `packages/database/src/schema/access.ts`'s own doc comment for the
 * schema-level reasoning (re-entry policy, `currentlyInside` as the one
 * authoritative presence flag). This file only adds the TS-side row
 * shapes/error vocabulary this module needs — the schema itself is never
 * modified here.
 */
export const accessCredentialStatuses = ['issued', 'void'] as const;
export type AccessCredentialStatus = (typeof accessCredentialStatuses)[number];

export const accessEventTypes = ['entry', 'exit'] as const;
export type AccessEventType = (typeof accessEventTypes)[number];

/**
 * TASK 14.5 (Wave 3, Phase 3) — NFC wristband lifecycle recovery. A
 * wristband is just another physical form-factor for the exact same real
 * credential concept (see `packages/database/src/schema/access.ts`'s own
 * doc comment for the full forensic citation against the legacy source):
 * `'ticket'` — the pre-existing, server-generated printed/QR code path,
 * unchanged. `'wristband'` — the code IS the physical NFC UID, entered
 * manually via keyboard/scanner (no vendor NFC-reader integration exists
 * in the legacy or is required this wave).
 */
export const accessCredentialKinds = ['ticket', 'wristband'] as const;
export type AccessCredentialKind = (typeof accessCredentialKinds)[number];

/** A plain, honest 1:1 mapping of `access_credentials`, with one
 * deliberate ergonomic translation: `allowsReentry`/`currentlyInside` are
 * real TypeScript `boolean`s here even though the column itself is a
 * `text` check-constrained to `'true'|'false'` (mirrors the schema file's
 * own doc comment on why a text-flag was chosen at the DB layer — this
 * repository's own row-mapping function is the ONE place that boundary is
 * crossed, exactly like `HeldSaleCartRow.status`'s text-to-TS-union
 * mapping in `held-sales.repository.ts`). Never a sentinel — every field
 * is a real column value. */
export interface AccessCredentialRow {
  id: string;
  companyId: string;
  branchId: string;
  code: string;
  credentialKind: AccessCredentialKind;
  saleId: string | null;
  customerId: string | null;
  allowsReentry: boolean;
  status: AccessCredentialStatus;
  currentlyInside: boolean;
  issuedAt: Date;
  issuedBy: string;
  voidedAt: Date | null;
  voidedBy: string | null;
}

/** Immutable, append-only — a plain 1:1 mapping of `access_events`. Never
 * updated or deleted anywhere in this module (see the schema file's own
 * doc comment). */
export interface AccessEventRow {
  id: string;
  companyId: string;
  branchId: string;
  credentialId: string;
  eventType: AccessEventType;
  occurredAt: Date;
  createdBy: string;
  createdAt: Date;
}

export interface AccessMutationContext {
  companyId: string;
  actorId: string;
  requestId: string;
  correlationId: string;
  timestamp: Date;
}

/**
 * Every code below is the exact vocabulary TASK 14.4 Wave 2 Part E's own
 * instructions require for a REAL scanner ("reject cleanly — specific,
 * honest error codes"):
 *  - `credential_not_found` — the code does not resolve to any
 *    credential within the SCANNING company (company-scoped lookup only,
 *    never cross-tenant).
 *  - `credential_void` — the credential exists but has been voided.
 *  - `wrong_branch` — the credential's own `branchId` does not match the
 *    scanning branch. Chosen policy (explicit, documented here): a day
 *    pass/credential is branch-specific by default — cross-branch use is
 *    rejected outright. No evidence anywhere in the legacy forensic audit
 *    suggests a real park ever needed cross-branch admission, so this
 *    stays the simplest safe default rather than an invented allowance.
 *  - `already_inside` — an entry attempt against a credential that is
 *    already `currentlyInside=true` (duplicate entry scan).
 *  - `not_inside` — an exit attempt against a credential that is not
 *    currently inside.
 *  - `reentry_not_allowed` — chosen re-entry policy (documented in full
 *    on `packages/database/src/schema/access.ts`'s own `allowsReentry`
 *    column comment, reprinted here for this module's own readers):
 *    `allowsReentry=false` (the default) permits exactly ONE entry+exit
 *    cycle; a further entry attempt after a completed exit is rejected
 *    with this code. `allowsReentry=true` permits entry→exit→entry→exit
 *    indefinitely (a multi-use day pass) — the legacy never defined this
 *    anywhere, so this is this task's own minimal, explicit, and
 *    consistently-enforced invented rule, exactly as the task instructs.
 *  - `credential_currently_inside` — voiding a credential that is
 *    currently inside is rejected outright (chosen policy: an operator
 *    must record a real exit first — silently forcing an implicit exit
 *    here would be exactly the sentinel/hidden-state-mutation
 *    anti-pattern this codebase explicitly avoids elsewhere, e.g.
 *    `held_sale_carts`' own no-silent-expiry rule).
 *  - `credential_not_void` — TASK 14.5 (Wave 3) addition: an "unblock"
 *    (`AccessService.unvoidCredential`) attempted against a credential
 *    that is not currently `void` (already `issued`) — the honest,
 *    specific mirror of `credential_void` on the reverse transition.
 *  - `code_already_in_use` — TASK 14.5 (Wave 3) addition: a
 *    client-supplied wristband UID (`credentialKind='wristband'`)
 *    collides with `access_credentials_company_code_uq`. Only ever
 *    surfaced for a CLIENT-supplied code — a server-generated ticket
 *    code's own collision is silently retried internally (see
 *    `AccessService.issueCredential`'s own doc comment) and never reaches
 *    a caller as this code.
 *  - `validation_error` / `idempotency_conflict` / `resource_not_found`
 *    reuse the same generic vocabulary every other domain in this
 *    codebase already established (see `held-sales.types.ts`/
 *    `purchasing.repository.ts`'s own identical precedent) rather than
 *    inventing synonyms.
 */
export type AccessErrorCode =
  | 'validation_error'
  | 'idempotency_conflict'
  | 'resource_not_found'
  | 'credential_not_found'
  | 'credential_void'
  | 'wrong_branch'
  | 'already_inside'
  | 'not_inside'
  | 'reentry_not_allowed'
  | 'credential_currently_inside'
  | 'credential_not_void'
  | 'code_already_in_use';

export class AccessError extends Error {
  constructor(
    readonly code: AccessErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'AccessError';
  }
}
