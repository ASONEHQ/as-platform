import { sql } from 'drizzle-orm';
import {
  bigint,
  char,
  check,
  date,
  foreignKey,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  text,
  time,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

import { companyIdColumn, createdAtColumn, idColumn, updatedAtColumn } from './common.js';
import { customers } from './customers.js';
import { companyMemberships } from './identity.js';
import { branches, companies } from './organizations.js';

/**
 * TASK 14.3 (Wave 1, Part A) — the "Fiestas" recovery domain.
 * `docs/LEGACY_FIESTAS_RECOVERY.md` is the behavioral specification this
 * schema implements; nothing here invents legacy behavior beyond what
 * that forensic audit actually found. Deliberately a GENERIC multi-tenant
 * domain — "party" (not "fiesta"/"evento") is used throughout so this
 * reads correctly for any park/FEC, not just Inflapark. No park-specific
 * room/package/pricing/policy value is hardcoded anywhere in this file;
 * every business-specific value lives in these tables' rows, applied via
 * the same generic `provision:business-config` CLI pattern established
 * in TASK 14.2 (see `apps/api/src/business-config`).
 *
 * Three legacy weaknesses are explicitly NOT reproduced (see the
 * recovery doc's own classification):
 *  - persistence: this whole domain is real PostgreSQL, never in-memory;
 *  - customer linkage: `customerId` is a real FK into `customers`, never
 *    a free-text name (a frozen display-name/phone SNAPSHOT is kept
 *    alongside it, mirroring `sales.customer_display_name`'s own
 *    precedent, so a later customer-record edit never rewrites history);
 *  - permissions: `party.read`/`party.manage`/`party.cancel`/
 *    `party.payment.record` are real, server-enforced permission codes
 *    (see `packages/database/src/seeds/technical-permissions.ts`), never
 *    a UI-only flag that nothing actually checks.
 */

export const partyRoomStatuses = ['active', 'maintenance', 'out_of_service'] as const;
export const partyPackageStatuses = ['active', 'inactive'] as const;
// Legacy's exact 5-state machine (Confirmada / Pendiente de anticipo /
// Apartada / Cancelada / Finalizada), translated — see the recovery
// doc's Capability 12 ("Status workflow"). `held` = "Apartada" (a slot
// reserved before any deposit commitment); `pending_deposit` = awaiting
// the anticipo specifically; `confirmed` = deposit received / booking
// firm; `completed` = the event has happened; `cancelled` is terminal.
export const partyReservationStatuses = [
  'held',
  'pending_deposit',
  'confirmed',
  'completed',
  'cancelled',
] as const;
export const partyAccountStatuses = ['open', 'closed'] as const;
export const partyReservationPaymentPurposes = ['deposit', 'balance', 'additional'] as const;
export const partyDocumentTypes = ['waiver', 'contract'] as const;

export const partyRooms = pgTable(
  'party_rooms',
  {
    id: idColumn(),
    companyId: companyIdColumn().references(() => companies.id, { onDelete: 'restrict' }),
    branchId: uuid('branch_id').notNull(),
    code: text('code').notNull(),
    name: text('name').notNull(),
    status: text('status').notNull().default('active'),
    // Legacy's real recovered capacity fields (recovery doc Capability 4).
    capacityChildren: integer('capacity_children'),
    capacityAdults: integer('capacity_adults'),
    capacityTotal: integer('capacity_total'),
    // Calendar-identifying color, purely cosmetic — recovered as a real
    // legacy field (`color` on `guardarSalon`).
    color: text('color'),
    notes: text('notes'),
    createdBy: uuid('created_by').notNull(),
    updatedBy: uuid('updated_by').notNull(),
    version: bigint('version', { mode: 'bigint' }).notNull().default(sql`1`),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
  },
  (table) => [
    unique('party_rooms_company_id_id_uq').on(table.companyId, table.id),
    unique('party_rooms_company_branch_id_uq').on(table.companyId, table.branchId, table.id),
    uniqueIndex('party_rooms_company_branch_code_uq').on(table.companyId, table.branchId, table.code),
    foreignKey({
      columns: [table.companyId, table.branchId],
      foreignColumns: [branches.companyId, branches.id],
      name: 'party_rooms_branch_scope_fk',
    }).onDelete('restrict'),
    foreignKey({
      columns: [table.companyId, table.createdBy],
      foreignColumns: [companyMemberships.companyId, companyMemberships.userId],
      name: 'party_rooms_created_by_membership_fk',
    }).onDelete('restrict'),
    foreignKey({
      columns: [table.companyId, table.updatedBy],
      foreignColumns: [companyMemberships.companyId, companyMemberships.userId],
      name: 'party_rooms_updated_by_membership_fk',
    }).onDelete('restrict'),
    index('party_rooms_company_branch_idx').on(table.companyId, table.branchId),
    index('party_rooms_company_status_idx').on(table.companyId, table.status),
    check('party_rooms_code_nonblank_ck', sql`length(btrim(${table.code})) > 0`),
    check('party_rooms_name_nonblank_ck', sql`length(btrim(${table.name})) > 0`),
    check('party_rooms_status_ck', sql`${table.status} in ('active', 'maintenance', 'out_of_service')`),
    check(
      'party_rooms_capacity_children_ck',
      sql`${table.capacityChildren} is null or ${table.capacityChildren} >= 0`,
    ),
    check(
      'party_rooms_capacity_adults_ck',
      sql`${table.capacityAdults} is null or ${table.capacityAdults} >= 0`,
    ),
    check(
      'party_rooms_capacity_total_ck',
      sql`${table.capacityTotal} is null or ${table.capacityTotal} >= 0`,
    ),
    check('party_rooms_version_ck', sql`${table.version} >= 1`),
  ],
);

export const partyPackages = pgTable(
  'party_packages',
  {
    id: idColumn(),
    companyId: companyIdColumn().references(() => companies.id, { onDelete: 'restrict' }),
    // Nullable: a package may apply company-wide (all branches) or be
    // scoped to one branch — recovery doc Capability 5 notes the legacy
    // `salonesDisponibles[]` per-room restriction; this implementation
    // keeps the coarser, still-real branch-level restriction and
    // deliberately does not model a package-to-specific-rooms join table
    // in this wave (documented simplification, see
    // `docs/LEGACY_MISSING_PORTS.md`).
    branchId: uuid('branch_id'),
    code: text('code').notNull(),
    name: text('name').notNull(),
    description: text('description'),
    status: text('status').notNull().default('active'),
    price: numeric('price', { precision: 19, scale: 4 }).notNull(),
    currencyCode: char('currency_code', { length: 3 }).notNull(),
    durationMinutes: integer('duration_minutes').notNull(),
    childrenIncluded: integer('children_included').notNull().default(0),
    adultsIncluded: integer('adults_included').notNull().default(0),
    childExtraCost: numeric('child_extra_cost', { precision: 19, scale: 4 }).notNull().default(sql`0`),
    adultExtraCost: numeric('adult_extra_cost', { precision: 19, scale: 4 }).notNull().default(sql`0`),
    capacityMax: integer('capacity_max'),
    // TASK 14.3 Part A.7 (Cotizador): extra-time pricing, recovered from
    // legacy `tiempo.costoMediaHoraExtra`.
    extraHalfHourCost: numeric('extra_half_hour_cost', { precision: 19, scale: 4 }).notNull().default(sql`0`),
    // TASK 16.19 — the same explicit tax CLASSIFICATION `products.tax_code`
    // already carries (`packages/database/src/catalog/pricing.ts`'s
    // `ProductTaxCode`/`ivaBasisPointsForTaxCode`), reused rather than a
    // second tax concept: a party package is priced and taxed exactly like
    // a sellable line, closing Phase 10's explicit "...+ taxes = total"
    // requirement, which TASK 14.3 (Wave 1, Part A) did not yet implement.
    taxCode: text('tax_code').notNull().default('IVA_GENERAL'),
    // Structured-but-flexible recovery of legacy's rich nested
    // alimentos/pastel/decoracion/entretenimiento/regalos objects — kept
    // as reviewable JSON rather than one rigid column per legacy field
    // (a deliberate scope decision for this wave; see
    // `docs/LEGACY_MISSING_PORTS.md`). Always a JSON object when present.
    includes: jsonb('includes').$type<Readonly<Record<string, unknown>>>(),
    // TASK 16.19 — `restrictions.eligibleRoomIds?: string[]` is the real,
    // finer-grained recovery of legacy's per-room `salonesDisponibles[]`
    // restriction this table's own original doc comment (below) flagged
    // as a deliberately deferred simplification. Kept inside this same
    // flexible jsonb column (not a new join table) for the same reason
    // `includes` already is: absent/empty means "every room in this
    // package's own branch scope is eligible" (backward compatible with
    // every package created before this task), a non-empty array narrows
    // eligibility to exactly those room ids. Validated shape (array of
    // non-blank strings) at the service layer, not by a DB check
    // constraint, matching `includes`'/`restrictions`' own established
    // "structurally an object, semantically validated in code" contract.
    restrictions: jsonb('restrictions').$type<Readonly<Record<string, unknown>>>(),
    createdBy: uuid('created_by').notNull(),
    updatedBy: uuid('updated_by').notNull(),
    version: bigint('version', { mode: 'bigint' }).notNull().default(sql`1`),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
  },
  (table) => [
    unique('party_packages_company_id_id_uq').on(table.companyId, table.id),
    uniqueIndex('party_packages_company_code_uq').on(table.companyId, table.code),
    foreignKey({
      columns: [table.companyId, table.branchId],
      foreignColumns: [branches.companyId, branches.id],
      name: 'party_packages_branch_scope_fk',
    }).onDelete('restrict'),
    foreignKey({
      columns: [table.companyId, table.createdBy],
      foreignColumns: [companyMemberships.companyId, companyMemberships.userId],
      name: 'party_packages_created_by_membership_fk',
    }).onDelete('restrict'),
    foreignKey({
      columns: [table.companyId, table.updatedBy],
      foreignColumns: [companyMemberships.companyId, companyMemberships.userId],
      name: 'party_packages_updated_by_membership_fk',
    }).onDelete('restrict'),
    index('party_packages_company_branch_idx').on(table.companyId, table.branchId),
    index('party_packages_company_status_idx').on(table.companyId, table.status),
    check('party_packages_code_nonblank_ck', sql`length(btrim(${table.code})) > 0`),
    check('party_packages_name_nonblank_ck', sql`length(btrim(${table.name})) > 0`),
    check('party_packages_status_ck', sql`${table.status} in ('active', 'inactive')`),
    check('party_packages_price_nonnegative_ck', sql`${table.price} >= 0`),
    check('party_packages_currency_code_ck', sql`${table.currencyCode} ~ '^[A-Z]{3}$'`),
    check('party_packages_duration_positive_ck', sql`${table.durationMinutes} > 0`),
    check('party_packages_children_included_ck', sql`${table.childrenIncluded} >= 0`),
    check('party_packages_adults_included_ck', sql`${table.adultsIncluded} >= 0`),
    check('party_packages_child_extra_cost_ck', sql`${table.childExtraCost} >= 0`),
    check('party_packages_adult_extra_cost_ck', sql`${table.adultExtraCost} >= 0`),
    check('party_packages_extra_half_hour_cost_ck', sql`${table.extraHalfHourCost} >= 0`),
    check(
      'party_packages_capacity_max_ck',
      sql`${table.capacityMax} is null or ${table.capacityMax} >= 0`,
    ),
    check('party_packages_tax_code_ck', sql`${table.taxCode} in ('IVA_GENERAL', 'IVA_EXEMPT')`),
    check('party_packages_version_ck', sql`${table.version} >= 1`),
    check(
      'party_packages_includes_object_ck',
      sql`${table.includes} is null or jsonb_typeof(${table.includes}) = 'object'`,
    ),
    check(
      'party_packages_restrictions_object_ck',
      sql`${table.restrictions} is null or jsonb_typeof(${table.restrictions}) = 'object'`,
    ),
  ],
);

export const partyReservations = pgTable(
  'party_reservations',
  {
    id: idColumn(),
    companyId: companyIdColumn().references(() => companies.id, { onDelete: 'restrict' }),
    branchId: uuid('branch_id').notNull(),
    reservationNumber: text('reservation_number').notNull(),
    // Recovery doc Capability 2 (Customer linkage) — real FK, never
    // free-text. Nullable to allow a genuine walk-in inquiry before a
    // customer record exists, mirroring `sales.customer_id`'s own
    // established nullable pattern; `customerDisplayName`/`customerPhone`
    // are a frozen SNAPSHOT (never re-derived from the live customer row)
    // so a later customer edit never silently rewrites this reservation's
    // own history — same reasoning as `sales.customer_display_name`.
    customerId: uuid('customer_id'),
    customerDisplayName: text('customer_display_name'),
    customerPhone: text('customer_phone'),
    celebrantName: text('celebrant_name'),
    celebrantAge: integer('celebrant_age'),
    roomId: uuid('room_id').notNull(),
    packageId: uuid('package_id').notNull(),
    // TASK 16.19 — `room.name`/`package.name` AS THEY WERE at booking
    // time, frozen exactly like `customerDisplayName`/`customerPhone`
    // above already are. Before this task, `generateDocument` always
    // live-joined `party_rooms`/`party_packages`, so renaming a room or
    // editing a package after booking silently changed the text of an
    // already-issued contract/waiver — a real violation of the "an
    // already-issued contract must not silently mutate" requirement.
    // Nullable so a reservation created before this migration (which has
    // no snapshot) keeps falling back to a live join, never breaking.
    roomNameSnapshot: text('room_name_snapshot'),
    packageNameSnapshot: text('package_name_snapshot'),
    eventDate: date('event_date', { mode: 'string' }).notNull(),
    startTime: time('start_time').notNull(),
    endTime: time('end_time').notNull(),
    childrenCount: integer('children_count').notNull().default(0),
    // TASK 16.19 — `computePartyQuote` always accepted an `adults` input
    // (it drives `adultsExtra` pricing exactly like `childrenCount`
    // drives `childrenExtra`), but TASK 14.3 never persisted it on the
    // reservation itself — the count used to derive `quotedTotal` was
    // silently discarded after booking, making it impossible to later
    // enforce room/package capacity, show real guest counts on a
    // contract, or correctly recompute the quote on an edit. Real column
    // now, mirroring `childrenCount` exactly.
    adultsCount: integer('adults_count').notNull().default(0),
    // Recovery doc Capability 10 (Seller assignment) — a real, nullable FK
    // into the actual staff/membership relation, never an arbitrary
    // string the legacy stored.
    sellerUserId: uuid('seller_user_id'),
    status: text('status').notNull().default('held'),
    accountStatus: text('account_status').notNull().default('open'),
    // TASK 16.19 — itemized breakdown of `quotedTotal` (Phase 10: "package
    // + guest counts + extras + taxes = total", clearly distinguishing
    // SUBTOTAL/TAX/TOTAL). `subtotalAmount` is the package+extras amount
    // before tax; `discountTotal` is reserved for a future authorized
    // discount (always `0` today — no discount mechanism is wired into
    // party pricing yet, see `docs/LEGACY_FUNCTIONAL_PARITY.md`'s TASK
    // 16.19 section for why that is a disclosed follow-up, not silently
    // dropped); `taxTotal` is this reservation's own frozen tax amount.
    // Nullable (`subtotalAmount`) only so a pre-migration reservation
    // (which has no breakdown) can be told apart from a genuine zero.
    subtotalAmount: numeric('subtotal_amount', { precision: 19, scale: 4 }),
    discountTotal: numeric('discount_total', { precision: 19, scale: 4 }).notNull().default(sql`0`),
    taxTotal: numeric('tax_total', { precision: 19, scale: 4 }).notNull().default(sql`0`),
    // The Cotizador's price snapshot at booking time (recovery doc
    // Capability 7) — deliberately frozen, never recomputed from the
    // package's live price after booking (a later package price change
    // must not silently alter an already-booked reservation's total).
    // TASK 16.19: now the true GRAND total (subtotal − discount + tax),
    // not merely the untaxed package+extras amount — every existing
    // consumer (`balance`, cash-cut `contracted_value`, this row's own
    // `party_reservations_quoted_total_ck`) already treats this field as
    // "the total amount the customer owes," so its ROLE is unchanged,
    // only its computed VALUE becomes more correct.
    quotedTotal: numeric('quoted_total', { precision: 19, scale: 4 }).notNull(),
    currencyCode: char('currency_code', { length: 3 }).notNull(),
    notes: text('notes'),
    cancelledAt: timestamp('cancelled_at', { withTimezone: true, mode: 'date' }),
    cancelledBy: uuid('cancelled_by'),
    cancellationReason: text('cancellation_reason'),
    createdBy: uuid('created_by').notNull(),
    updatedBy: uuid('updated_by').notNull(),
    version: bigint('version', { mode: 'bigint' }).notNull().default(sql`1`),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
  },
  (table) => [
    unique('party_reservations_company_id_id_uq').on(table.companyId, table.id),
    unique('party_reservations_company_branch_id_uq').on(table.companyId, table.branchId, table.id),
    uniqueIndex('party_reservations_company_number_uq').on(table.companyId, table.reservationNumber),
    foreignKey({
      columns: [table.companyId, table.branchId],
      foreignColumns: [branches.companyId, branches.id],
      name: 'party_reservations_branch_scope_fk',
    }).onDelete('restrict'),
    foreignKey({
      columns: [table.companyId, table.customerId],
      foreignColumns: [customers.companyId, customers.id],
      name: 'party_reservations_customer_scope_fk',
    }).onDelete('restrict'),
    foreignKey({
      columns: [table.companyId, table.branchId, table.roomId],
      foreignColumns: [partyRooms.companyId, partyRooms.branchId, partyRooms.id],
      name: 'party_reservations_room_scope_fk',
    }).onDelete('restrict'),
    foreignKey({
      columns: [table.companyId, table.packageId],
      foreignColumns: [partyPackages.companyId, partyPackages.id],
      name: 'party_reservations_package_scope_fk',
    }).onDelete('restrict'),
    foreignKey({
      columns: [table.companyId, table.sellerUserId],
      foreignColumns: [companyMemberships.companyId, companyMemberships.userId],
      name: 'party_reservations_seller_membership_fk',
    }).onDelete('restrict'),
    foreignKey({
      columns: [table.companyId, table.cancelledBy],
      foreignColumns: [companyMemberships.companyId, companyMemberships.userId],
      name: 'party_reservations_cancelled_by_membership_fk',
    }).onDelete('restrict'),
    foreignKey({
      columns: [table.companyId, table.createdBy],
      foreignColumns: [companyMemberships.companyId, companyMemberships.userId],
      name: 'party_reservations_created_by_membership_fk',
    }).onDelete('restrict'),
    foreignKey({
      columns: [table.companyId, table.updatedBy],
      foreignColumns: [companyMemberships.companyId, companyMemberships.userId],
      name: 'party_reservations_updated_by_membership_fk',
    }).onDelete('restrict'),
    index('party_reservations_company_branch_idx').on(table.companyId, table.branchId),
    index('party_reservations_company_status_idx').on(table.companyId, table.status),
    index('party_reservations_company_customer_idx').on(table.companyId, table.customerId),
    // TASK 14.3 Part A.5 — the calendar/conflict working set: every
    // active-reservation lookup for a given room+date range goes through
    // this index (also what the row-lock-then-scan conflict check in
    // `PartyReservationsService` filters on first).
    index('party_reservations_company_room_date_idx').on(
      table.companyId,
      table.roomId,
      table.eventDate,
    ),
    check('party_reservations_reservation_number_nonblank_ck', sql`length(btrim(${table.reservationNumber})) > 0`),
    check(
      'party_reservations_status_ck',
      sql`${table.status} in ('held', 'pending_deposit', 'confirmed', 'completed', 'cancelled')`,
    ),
    check('party_reservations_account_status_ck', sql`${table.accountStatus} in ('open', 'closed')`),
    check('party_reservations_children_count_ck', sql`${table.childrenCount} >= 0`),
    check('party_reservations_adults_count_ck', sql`${table.adultsCount} >= 0`),
    check(
      'party_reservations_subtotal_amount_ck',
      sql`${table.subtotalAmount} is null or ${table.subtotalAmount} >= 0`,
    ),
    check('party_reservations_discount_total_ck', sql`${table.discountTotal} >= 0`),
    check('party_reservations_tax_total_ck', sql`${table.taxTotal} >= 0`),
    check('party_reservations_quoted_total_ck', sql`${table.quotedTotal} >= 0`),
    check('party_reservations_currency_code_ck', sql`${table.currencyCode} ~ '^[A-Z]{3}$'`),
    check('party_reservations_celebrant_age_ck', sql`${table.celebrantAge} is null or ${table.celebrantAge} >= 0`),
    check('party_reservations_end_after_start_ck', sql`${table.endTime} > ${table.startTime}`),
    check(
      'party_reservations_customer_display_name_ck',
      sql`${table.customerId} is null or (${table.customerDisplayName} is not null and length(btrim(${table.customerDisplayName})) > 0)`,
    ),
    // Recovery doc Capability 8/12: cancellation must be explicit and
    // audited, never silent — the three cancellation fields are either
    // all null (not cancelled) or all populated (cancelled), and only
    // `status='cancelled'` may carry them.
    check(
      'party_reservations_cancellation_fields_ck',
      sql`(${table.status} <> 'cancelled' and ${table.cancelledAt} is null and ${table.cancelledBy} is null and ${table.cancellationReason} is null)
        or (${table.status} = 'cancelled' and ${table.cancelledAt} is not null and ${table.cancelledBy} is not null and ${table.cancellationReason} is not null)`,
    ),
    check('party_reservations_version_ck', sql`${table.version} >= 1`),
  ],
);

// TASK 14.3 Part A.5 — the real, database-enforced half of conflict
// prevention: a `party_reservations_room_time_excl` GIST exclusion
// constraint (requires the `btree_gist` extension) is appended by hand
// to this domain's migration (drizzle-kit's schema DSL has no first-
// class EXCLUDE-constraint support) — see
// `packages/database/drizzle/0024_vengeful_metal_master.sql`'s own tail. It
// guarantees two ACTIVE reservations for the same room can never
// overlap in time, database-enforced, never only application-checked.
// `PartyReservationsService` additionally takes an application-level
// `SELECT ... FOR UPDATE` lock on the target `party_rooms` row before
// checking/inserting, purely to turn a rejected-by-constraint race into
// a clean application error rather than a raw Postgres exception — this
// constraint is the actual last-line, race-free guarantee.

export const partyReservationSnacks = pgTable(
  'party_reservation_snacks',
  {
    id: idColumn(),
    companyId: companyIdColumn(),
    reservationId: uuid('reservation_id').notNull(),
    // Recovered "connect sellable/inventory-backed items to current
    // catalog rather than duplicating product truth" — nullable only for
    // a genuinely custom one-off snack with no catalog product behind it.
    productId: uuid('product_id'),
    nameSnapshot: text('name_snapshot').notNull(),
    unitPriceSnapshot: numeric('unit_price_snapshot', { precision: 19, scale: 4 }).notNull(),
    quantity: numeric('quantity', { precision: 19, scale: 6 }).notNull(),
    // TASK 16.19 — `lineTotal` is now tax-INCLUSIVE (pretax subtotal +
    // `taxTotal`), mirroring `sale_items.line_total`'s own established
    // meaning exactly. A pre-migration row has `taxTotal` default `0`, so
    // its existing `lineTotal` value is unchanged by this redefinition —
    // it was always implicitly untaxed.
    lineTotal: numeric('line_total', { precision: 19, scale: 4 }).notNull(),
    // TASK 16.19 — closes the documented gap: snack pricing inside a
    // party reservation previously bypassed the platform's tax engine
    // entirely (no `tax_snapshot`, unlike `sale_items`). Resolved from
    // the linked product's own real `tax_code` when `productId` is set;
    // for a genuinely custom, catalog-less snack, the reservation's own
    // package `tax_code` is used as the honest default (see
    // `party-reservations.service.ts`'s `addSnack`). Same `{tax_code,
    // basis_points}` shape as `sale_items.taxSnapshot`, not a new format.
    taxSnapshot: jsonb('tax_snapshot').$type<Readonly<Record<string, unknown>>>(),
    taxTotal: numeric('tax_total', { precision: 19, scale: 4 }).notNull().default(sql`0`),
    createdAt: createdAtColumn(),
  },
  (table) => [
    unique('party_reservation_snacks_company_id_id_uq').on(table.companyId, table.id),
    foreignKey({
      columns: [table.companyId, table.reservationId],
      foreignColumns: [partyReservations.companyId, partyReservations.id],
      name: 'party_reservation_snacks_reservation_scope_fk',
    }).onDelete('restrict'),
    index('party_reservation_snacks_reservation_idx').on(table.companyId, table.reservationId),
    check('party_reservation_snacks_name_nonblank_ck', sql`length(btrim(${table.nameSnapshot})) > 0`),
    check('party_reservation_snacks_unit_price_ck', sql`${table.unitPriceSnapshot} >= 0`),
    check('party_reservation_snacks_quantity_positive_ck', sql`${table.quantity} > 0`),
    check('party_reservation_snacks_line_total_ck', sql`${table.lineTotal} >= 0`),
    check('party_reservation_snacks_tax_total_ck', sql`${table.taxTotal} >= 0`),
    check(
      'party_reservation_snacks_tax_snapshot_object_ck',
      sql`${table.taxSnapshot} is null or jsonb_typeof(${table.taxSnapshot}) = 'object'`,
    ),
  ],
);

export const partyReservationSocks = pgTable(
  'party_reservation_socks',
  {
    id: idColumn(),
    companyId: companyIdColumn(),
    reservationId: uuid('reservation_id').notNull(),
    size: text('size').notNull(),
    quantity: integer('quantity').notNull(),
    // Recovery doc Capability 11 — the real inventory-tracked variant
    // this size maps to, when the business tracks socks as real stock;
    // nullable if it doesn't.
    productVariantId: uuid('product_variant_id'),
    stockDeducted: text('stock_deducted').notNull().default('pending'),
    stockDeductedAt: timestamp('stock_deducted_at', { withTimezone: true, mode: 'date' }),
    createdAt: createdAtColumn(),
  },
  (table) => [
    unique('party_reservation_socks_company_id_id_uq').on(table.companyId, table.id),
    foreignKey({
      columns: [table.companyId, table.reservationId],
      foreignColumns: [partyReservations.companyId, partyReservations.id],
      name: 'party_reservation_socks_reservation_scope_fk',
    }).onDelete('restrict'),
    index('party_reservation_socks_reservation_idx').on(table.companyId, table.reservationId),
    check('party_reservation_socks_size_nonblank_ck', sql`length(btrim(${table.size})) > 0`),
    check('party_reservation_socks_quantity_positive_ck', sql`${table.quantity} > 0`),
    check(
      'party_reservation_socks_stock_deducted_ck',
      sql`${table.stockDeducted} in ('pending', 'deducted', 'not_applicable')`,
    ),
    check(
      'party_reservation_socks_stock_deducted_at_ck',
      sql`(${table.stockDeducted} = 'deducted') = (${table.stockDeductedAt} is not null)`,
    ),
  ],
);

/**
 * TASK 14.3 Part A.8 (Deposits/balances) — deliberately NOT a parallel
 * financial ledger. Each row is a thin, auditable link from a
 * reservation to a REAL, already-proven `cash_movements` row (a
 * `cash_in` of type matching `purpose`, posted through the existing
 * `CashService.createMovement` — the exact same idempotent, audited
 * mechanism every other cash-in/cash-out in this platform already uses).
 * `amountSnapshot` mirrors the movement's own amount purely for a fast
 * read without a join; the movement itself remains the one source of
 * truth for the actual money fact. See `docs/LEGACY_FIESTAS_RECOVERY.md`
 * Capability 7 and the task's own instruction: "Cash behavior may use
 * the existing production-safe cash architecture."
 */
export const partyReservationPayments = pgTable(
  'party_reservation_payments',
  {
    id: idColumn(),
    companyId: companyIdColumn(),
    branchId: uuid('branch_id').notNull(),
    reservationId: uuid('reservation_id').notNull(),
    cashMovementId: uuid('cash_movement_id').notNull(),
    purpose: text('purpose').notNull(),
    amountSnapshot: numeric('amount_snapshot', { precision: 19, scale: 4 }).notNull(),
    createdBy: uuid('created_by').notNull(),
    createdAt: createdAtColumn(),
  },
  (table) => [
    unique('party_reservation_payments_company_id_id_uq').on(table.companyId, table.id),
    // A cash movement is the payment fact exactly once — never linked to
    // two different reservations.
    unique('party_reservation_payments_movement_uq').on(table.companyId, table.cashMovementId),
    foreignKey({
      columns: [table.companyId, table.branchId],
      foreignColumns: [branches.companyId, branches.id],
      name: 'party_reservation_payments_branch_scope_fk',
    }).onDelete('restrict'),
    foreignKey({
      columns: [table.companyId, table.reservationId],
      foreignColumns: [partyReservations.companyId, partyReservations.id],
      name: 'party_reservation_payments_reservation_scope_fk',
    }).onDelete('restrict'),
    foreignKey({
      columns: [table.companyId, table.createdBy],
      foreignColumns: [companyMemberships.companyId, companyMemberships.userId],
      name: 'party_reservation_payments_created_by_membership_fk',
    }).onDelete('restrict'),
    index('party_reservation_payments_reservation_idx').on(table.companyId, table.reservationId),
    check(
      'party_reservation_payments_purpose_ck',
      sql`${table.purpose} in ('deposit', 'balance', 'additional')`,
    ),
    check('party_reservation_payments_amount_positive_ck', sql`${table.amountSnapshot} > 0`),
  ],
);

/**
 * TASK 14.3 Part A.11 (Documents) — mirrors the platform's existing
 * receipt pattern: the printable HTML itself is always regenerated
 * on-demand from the reservation's live data (never stored as a blob,
 * exactly like `GET /sales/:id/receipt` never stores a rendered
 * receipt) — this table is purely an audit trail of *when* a document
 * was generated and by whom, not a document store.
 */
export const partyReservationDocuments = pgTable(
  'party_reservation_documents',
  {
    id: idColumn(),
    companyId: companyIdColumn(),
    reservationId: uuid('reservation_id').notNull(),
    documentType: text('document_type').notNull(),
    generatedBy: uuid('generated_by').notNull(),
    generatedAt: createdAtColumn(),
  },
  (table) => [
    unique('party_reservation_documents_company_id_id_uq').on(table.companyId, table.id),
    foreignKey({
      columns: [table.companyId, table.reservationId],
      foreignColumns: [partyReservations.companyId, partyReservations.id],
      name: 'party_reservation_documents_reservation_scope_fk',
    }).onDelete('restrict'),
    foreignKey({
      columns: [table.companyId, table.generatedBy],
      foreignColumns: [companyMemberships.companyId, companyMemberships.userId],
      name: 'party_reservation_documents_generated_by_membership_fk',
    }).onDelete('restrict'),
    index('party_reservation_documents_reservation_idx').on(table.companyId, table.reservationId),
    check(
      'party_reservation_documents_type_ck',
      sql`${table.documentType} in ('waiver', 'contract')`,
    ),
  ],
);

export type PartyRoom = typeof partyRooms.$inferSelect;
export type NewPartyRoom = typeof partyRooms.$inferInsert;
export type PartyPackage = typeof partyPackages.$inferSelect;
export type NewPartyPackage = typeof partyPackages.$inferInsert;
export type PartyReservation = typeof partyReservations.$inferSelect;
export type NewPartyReservation = typeof partyReservations.$inferInsert;
export type PartyReservationSnack = typeof partyReservationSnacks.$inferSelect;
export type PartyReservationSock = typeof partyReservationSocks.$inferSelect;
export type PartyReservationPayment = typeof partyReservationPayments.$inferSelect;
export type PartyReservationDocument = typeof partyReservationDocuments.$inferSelect;
