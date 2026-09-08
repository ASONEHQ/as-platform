import { sql } from 'drizzle-orm';
import { check, foreignKey, index, pgTable, text, timestamp, unique, uniqueIndex, uuid } from 'drizzle-orm/pg-core';

import { branches, companies } from './organizations.js';
import { companyIdColumn, createdAtColumn, idColumn } from './common.js';
import { customers } from './customers.js';
import { companyMemberships } from './identity.js';
import { sales } from './sales.js';

/**
 * TASK 14.4 (Wave 2, Part E) — a REAL replacement for the legacy's own
 * FAKE "Control de Acceso" ticket scan (confirmed by forensic audit:
 * `accScan()` accepted any input and fabricated a random customer name,
 * always reporting success — see `docs/LEGACY_FUNCTIONAL_PARITY.md`'s
 * Accesos section). This is explicitly classified H (safely replaced),
 * never counted as "the legacy mechanism was real and this ports it" —
 * it is new, production-safe work replacing something that never
 * actually validated anything.
 *
 * Design: the smallest explicit domain that reuses real commercial
 * facts rather than inventing a parallel financial system (this task's
 * own instruction) — a credential is always issued against a real,
 * already-paid `sales` row, never a bare, unaccountable code. `code` is
 * the real, unique, scannable string; `currentlyInside` is the one
 * authoritative presence flag per credential (flips true on a valid
 * entry, false on a valid exit) — occupancy is always
 * `count(*) where currently_inside = true`, never a separately
 * incremented/decremented counter that could drift from the real
 * per-credential state.
 *
 * TASK 14.5 (Wave 3, Phase 3) — NFC wristband lifecycle recovery. Forensic
 * re-read of the legacy source (`AS POS V1.html`'s `DB.pulseras` +
 * `activarPulsera`/`bloquearPulsera`/`desbloquearPulsera`/
 * `extenderPulsera`) found: activate/block/unblock are a REAL, persisted
 * local state CRUD (each mutates `DB.pulseras` and re-renders); "extend"
 * is NOT — it only ever shows a `prompt()` dialog and a toast, never
 * writing the entered minutes anywhere, and the very `pul-expira`/
 * `pul-cliente`/`pul-sucursal` DOM ids its own `activarPulsera()` reads
 * from don't exist in the legacy's own modal markup (dead fallback code,
 * always the same computed defaults). So "extend" is correctly NOT ported
 * — see this task's own final report for the full citation. A wristband
 * is simply another physical form-factor for the exact same real
 * credential concept already modeled here (a UID a person carries that
 * maps to a real, already-paid entitlement) — never a parallel table.
 * `credentialKind` distinguishes a server-generated printed-ticket code
 * from a manually-entered (keyboard/scanner) wristband UID; every other
 * mechanic (`status`/`currentlyInside`/`allowsReentry`/scan validation/
 * occupancy) is reused verbatim — a wristband-kind credential scans
 * exactly like a ticket-kind one. "Block"/"unblock" reuse the credential's
 * existing `status` transition (`issued` <-> `void`) rather than a new
 * status value: block IS a void (see `access.service.ts`'s own
 * `voidCredential`), and unblock is the one genuinely new transition this
 * wave adds (`markUnvoid` in `access.repository.ts`) — the legacy's own
 * block/unblock cycle is reversible, unlike a ticket void, which had no
 * legacy precedent for reversal at all until this wave.
 */
export const accessCredentialStatuses = ['issued', 'void'] as const;
export const accessCredentialKinds = ['ticket', 'wristband'] as const;

export const accessCredentials = pgTable(
  'access_credentials',
  {
    id: idColumn(),
    companyId: companyIdColumn().references(() => companies.id, { onDelete: 'restrict' }),
    branchId: uuid('branch_id').notNull(),
    code: text('code').notNull(),
    // Printed-ticket codes are always server-generated (`AC-` +
    // random hex); a wristband's `code` IS its physical UID, entered
    // manually via keyboard/scanner at activation time (no NFC-reader
    // vendor integration exists in the legacy or is required this wave —
    // see this task's own instruction). Every other column/mechanic below
    // is shared identically between both kinds.
    credentialKind: text('credential_kind').notNull().default('ticket'),
    saleId: uuid('sale_id'),
    customerId: uuid('customer_id'),
    // Legacy had no explicit re-entry semantics documented anywhere in
    // the forensic audit — this task's own instruction: "if the legacy
    // did not clearly define re-entry semantics, document the chosen
    // minimal safe rule." Chosen rule (documented here, not invented
    // silently): a credential defaults to single-use
    // (`allowsReentry=false` — once used for entry, a second entry scan
    // is rejected); a park that wants multi-use day passes can issue one
    // with `allowsReentry=true` at issuance time, explicitly.
    allowsReentry: text('allows_reentry').notNull().default('false'),
    status: text('status').notNull().default('issued'),
    currentlyInside: text('currently_inside').notNull().default('false'),
    issuedAt: createdAtColumn(),
    issuedBy: uuid('issued_by').notNull(),
    voidedAt: timestamp('voided_at', { withTimezone: true, mode: 'date' }),
    voidedBy: uuid('voided_by'),
  },
  (table) => [
    unique('access_credentials_company_id_id_uq').on(table.companyId, table.id),
    uniqueIndex('access_credentials_company_code_uq').on(table.companyId, table.code),
    foreignKey({
      columns: [table.companyId, table.branchId],
      foreignColumns: [branches.companyId, branches.id],
      name: 'access_credentials_branch_scope_fk',
    }).onDelete('restrict'),
    foreignKey({
      columns: [table.companyId, table.branchId, table.saleId],
      foreignColumns: [sales.companyId, sales.branchId, sales.id],
      name: 'access_credentials_sale_scope_fk',
    }).onDelete('restrict'),
    foreignKey({
      columns: [table.companyId, table.customerId],
      foreignColumns: [customers.companyId, customers.id],
      name: 'access_credentials_customer_scope_fk',
    }).onDelete('restrict'),
    foreignKey({
      columns: [table.companyId, table.issuedBy],
      foreignColumns: [companyMemberships.companyId, companyMemberships.userId],
      name: 'access_credentials_issued_by_membership_fk',
    }).onDelete('restrict'),
    foreignKey({
      columns: [table.companyId, table.voidedBy],
      foreignColumns: [companyMemberships.companyId, companyMemberships.userId],
      name: 'access_credentials_voided_by_membership_fk',
    }).onDelete('restrict'),
    index('access_credentials_company_branch_idx').on(table.companyId, table.branchId),
    // The real occupancy index — every dashboard/report occupancy query
    // filters exactly on this.
    index('access_credentials_company_branch_inside_idx').on(table.companyId, table.branchId, table.currentlyInside),
    check('access_credentials_code_nonblank_ck', sql`length(btrim(${table.code})) > 0`),
    check('access_credentials_kind_ck', sql`${table.credentialKind} in ('ticket', 'wristband')`),
    check('access_credentials_status_ck', sql`${table.status} in ('issued', 'void')`),
    check('access_credentials_allows_reentry_ck', sql`${table.allowsReentry} in ('true', 'false')`),
    check('access_credentials_currently_inside_ck', sql`${table.currentlyInside} in ('true', 'false')`),
    check(
      'access_credentials_voided_fields_ck',
      sql`(${table.status} = 'void') = (${table.voidedAt} is not null and ${table.voidedBy} is not null)`,
    ),
    // A voided credential can never be "inside" — voiding and presence
    // are mutually exclusive facts.
    check(
      'access_credentials_void_not_inside_ck',
      sql`${table.status} <> 'void' or ${table.currentlyInside} = 'false'`,
    ),
  ],
);

export const accessEventTypes = ['entry', 'exit'] as const;

/** Immutable, append-only — an entry/exit event is a historical fact,
 * never updated or deleted (this task's own explicit instruction). */
export const accessEvents = pgTable(
  'access_events',
  {
    id: idColumn(),
    companyId: companyIdColumn(),
    branchId: uuid('branch_id').notNull(),
    credentialId: uuid('credential_id').notNull(),
    eventType: text('event_type').notNull(),
    occurredAt: timestamp('occurred_at', { withTimezone: true, mode: 'date' }).notNull(),
    createdBy: uuid('created_by').notNull(),
    createdAt: createdAtColumn(),
  },
  (table) => [
    unique('access_events_company_id_id_uq').on(table.companyId, table.id),
    foreignKey({
      columns: [table.companyId, table.branchId],
      foreignColumns: [branches.companyId, branches.id],
      name: 'access_events_branch_scope_fk',
    }).onDelete('restrict'),
    foreignKey({
      columns: [table.companyId, table.credentialId],
      foreignColumns: [accessCredentials.companyId, accessCredentials.id],
      name: 'access_events_credential_scope_fk',
    }).onDelete('restrict'),
    foreignKey({
      columns: [table.companyId, table.createdBy],
      foreignColumns: [companyMemberships.companyId, companyMemberships.userId],
      name: 'access_events_created_by_membership_fk',
    }).onDelete('restrict'),
    index('access_events_company_credential_idx').on(table.companyId, table.credentialId, table.occurredAt),
    index('access_events_company_branch_occurred_idx').on(table.companyId, table.branchId, table.occurredAt),
    check('access_events_type_ck', sql`${table.eventType} in ('entry', 'exit')`),
  ],
);

export type AccessCredential = typeof accessCredentials.$inferSelect;
export type NewAccessCredential = typeof accessCredentials.$inferInsert;
export type AccessEvent = typeof accessEvents.$inferSelect;
