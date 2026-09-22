import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
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
import { coupons } from './promotions.js';

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
    // TASK 16.20 (Part D4 "package-included socks" / Part E "event
    // snacks") — a package's own real, structured "this many of this
    // real catalog item are included" list, recovering legacy's
    // `paquete.incluye` concept (per-package quantities of socks/food/
    // etc — `docs/LEGACY_FUNCTIONAL_PARITY.md`'s TASK 16.19 §1 forensic
    // audit already found this rich in the legacy data model) as
    // genuinely structured data instead of `includes`' own free-text
    // key/value tag editor (which cannot express "25 of THIS specific
    // catalog product/variant" — only a human-readable label/value
    // string). A JSON array, each entry:
    // `{kind: 'sock'|'snack', label: string, quantity: number,
    //   productId?: string, productVariantId?: string, size?: string}`
    // — `kind='sock'` needs `size` (+ `productVariantId` when that size
    // is inventory-tracked); `kind='snack'` needs `productId`. Never a
    // hardcoded tenant product ("Calcetas INFLAPARK") — always a real
    // reference the tenant's own catalog/room-package admin configured,
    // or `productVariantId`/`productId` omitted entirely for a
    // non-inventory-tracked consumable (planned-quantity bookkeeping
    // only, matching a custom/catalog-less snack's own existing
    // pattern). `PartyReservationsService.createReservation` reads this
    // ONCE, at booking time, to auto-populate `party_reservation_socks`/
    // `party_reservation_snacks` with the PLANNED quantity (never
    // consuming inventory itself — see those tables' own `issued_
    // quantity` doc comments for the planned/issued distinction this
    // whole design turns on).
    includedConsumables: jsonb('included_consumables').$type<
      ReadonlyArray<Readonly<Record<string, unknown>>>
    >(),
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
    check(
      'party_packages_included_consumables_array_ck',
      sql`${table.includedConsumables} is null or jsonb_typeof(${table.includedConsumables}) = 'array'`,
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
    // before tax; `taxTotal` is this reservation's own frozen tax amount.
    // Nullable (`subtotalAmount`) only so a pre-migration reservation
    // (which has no breakdown) can be told apart from a genuine zero.
    subtotalAmount: numeric('subtotal_amount', { precision: 19, scale: 4 }),
    // TASK 16.20 (Part L1) — closes the TASK 16.19-disclosed gap: `0`
    // until a coupon is actually applied via `PartyReservationsService.
    // applyCoupon`, which recomputes this from the coupon's own real
    // `benefit_type`/`benefit_percentage_basis_points`/
    // `benefit_fixed_amount` against `subtotalAmount` — never a
    // client-submitted number. `taxTotal` is recomputed at the same
    // moment against the POST-discount base, same tax model
    // `computePartyQuote` already uses.
    discountTotal: numeric('discount_total', { precision: 19, scale: 4 }).notNull().default(sql`0`),
    taxTotal: numeric('tax_total', { precision: 19, scale: 4 }).notNull().default(sql`0`),
    // TASK 16.20 (Part L1) — the one coupon a reservation may have
    // applied (parties keep this deliberately simpler than sales'
    // multi-coupon stacking — legacy itself only ever applied one coupon
    // per party too). `couponId` is a real FK; `couponCodeSnapshot`
    // freezes the code AS TYPED at apply time (mirrors every other
    // snapshot column in this table) so a later coupon rename/deactivation
    // never rewrites this reservation's own history. The actual
    // redemption-slot bookkeeping (concurrency-safe usage-limit
    // enforcement) lives in `party_reservation_coupon_redemptions` below —
    // a dedicated table, deliberately NOT a reuse of sales' own
    // `coupon_redemptions` (whose `sale_id` is `not null` — see
    // `docs/LEGACY_FUNCTIONAL_PARITY.md`'s TASK 16.19/16.20 sections for
    // why extending that already-certified table was judged riskier than
    // this small, mirrored, module-local one).
    couponId: uuid('coupon_id'),
    couponCodeSnapshot: text('coupon_code_snapshot'),
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
    foreignKey({
      columns: [table.companyId, table.couponId],
      foreignColumns: [coupons.companyId, coupons.id],
      name: 'party_reservations_coupon_scope_fk',
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
    check(
      'party_reservations_coupon_snapshot_ck',
      sql`(${table.couponId} is null) = (${table.couponCodeSnapshot} is null)`,
    ),
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
    // TASK 16.20 (Part D4/E — mirrors `party_reservation_socks.quantity`
    // exactly) — the PLANNED quantity. Never moves inventory by itself;
    // see `issuedQuantity` below for the one real consumption moment.
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
    // TASK 16.20 — closes the confirmed gap from the catalog/inventory
    // audit: "snacks do not post to the inventory ledger at all." Real
    // inventory-tracked variant this snack resolves to (mirrors
    // `resolveProductLines`'s default-variant SQL pattern,
    // `sales.repository.ts`), nullable for a genuinely custom, catalog-less
    // snack, or a real catalog product that simply doesn't track
    // inventory (`products.tracks_inventory=false`).
    productVariantId: uuid('product_variant_id'),
    // Default differs from socks ('pending'): most snacks are NOT
    // inventory-tracked (custom one-off items, or a catalog product with
    // `tracks_inventory=false`), so `'not_applicable'` is the honest
    // default; `addSnack` sets this to `'pending'` only when a real
    // trackable variant was actually resolved.
    stockDeducted: text('stock_deducted').notNull().default('not_applicable'),
    stockDeductedAt: timestamp('stock_deducted_at', { withTimezone: true, mode: 'date' }),
    // TASK 16.20 — the ACTUAL quantity physically issued/delivered,
    // frozen the moment `deductSnack` posts the one real inventory
    // movement (`party-snack-deduction.ts`). Deliberately independent of
    // `quantity` (the plan) — same "planned vs issued" distinction as
    // `party_reservation_socks.issuedQuantity`. Decimal, matching this
    // table's own existing `quantity` scale (unlike socks' integer).
    issuedQuantity: numeric('issued_quantity', { precision: 19, scale: 6 }),
    // TASK 16.20 (Part D5) — `true` only for a row `createReservation`
    // itself auto-created from the package's `includedConsumables` at
    // booking time; `false` for a row an operator explicitly added.
    includedInPackage: boolean('included_in_package').notNull().default(false),
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
    check(
      'party_reservation_snacks_stock_deducted_ck',
      sql`${table.stockDeducted} in ('pending', 'deducted', 'not_applicable')`,
    ),
    check(
      'party_reservation_snacks_stock_deducted_at_ck',
      sql`(${table.stockDeducted} = 'deducted') = (${table.stockDeductedAt} is not null)`,
    ),
    check(
      'party_reservation_snacks_issued_quantity_ck',
      sql`(${table.stockDeducted} = 'deducted') = (${table.issuedQuantity} is not null)`,
    ),
    check(
      'party_reservation_snacks_issued_quantity_positive_ck',
      sql`${table.issuedQuantity} is null or ${table.issuedQuantity} > 0`,
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
    // TASK 16.20 (Part D4 "included/planned vs issued/consumed") — the
    // PLANNED quantity (from the package's own `includedConsumables`, or
    // whatever an operator manually adds) — this column's meaning is
    // unchanged from TASK 14.3; it never moves inventory by itself (a
    // reservation/quote never consumes stock just by existing — see
    // `issuedQuantity` below for the one real consumption moment).
    quantity: integer('quantity').notNull(),
    // Recovery doc Capability 11 — the real inventory-tracked variant
    // this size maps to, when the business tracks socks as real stock;
    // nullable if it doesn't.
    productVariantId: uuid('product_variant_id'),
    stockDeducted: text('stock_deducted').notNull().default('pending'),
    stockDeductedAt: timestamp('stock_deducted_at', { withTimezone: true, mode: 'date' }),
    // TASK 16.20 — the ACTUAL quantity physically issued/delivered,
    // frozen the moment `deductSock` posts the one real inventory
    // movement (`party-sock-deduction.ts`) — deliberately independent
    // of `quantity` (the plan) exactly like legacy's own two-step
    // "asignar" (plan, `guardarCalcetasFiesta`, line ~9270) then
    // "descontar" (consume, `descontarCalcetasFiesta`, line ~9205) — the
    // real legacy precedent for this distinction, re-verified against
    // the actual HTML for this task. `null` until issued; an operator
    // may issue a DIFFERENT amount than planned (e.g. package included
    // 25, only 23 children attended) — see `PartyReservationsService.
    // deductSock`'s own doc comment. Corrected in place by `correctSock`
    // (a real compensating inventory movement, never a silent rewrite —
    // see that method's own doc comment) without ever touching this
    // row's own frozen `quantity` plan.
    issuedQuantity: integer('issued_quantity'),
    // TASK 16.20 (Part D5 "additional socks... must be traceable") —
    // `true` only for a row `PartyReservationsService.createReservation`
    // itself auto-created from the package's `includedConsumables` at
    // booking time; `false` for a row an operator explicitly added
    // (whether topping up a package-included size or a genuinely extra
    // one) — the Flutter event-day view groups by this flag so
    // "Incluido en paquete" vs "Adicional" is honest, never guessed from
    // creation order or size matching.
    includedInPackage: boolean('included_in_package').notNull().default(false),
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
    check(
      'party_reservation_socks_issued_quantity_ck',
      sql`(${table.stockDeducted} = 'deducted') = (${table.issuedQuantity} is not null)`,
    ),
    check(
      'party_reservation_socks_issued_quantity_positive_ck',
      sql`${table.issuedQuantity} is null or ${table.issuedQuantity} > 0`,
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
 * TASK 16.20 (Part L1) — the party-domain mirror of `coupon_redemptions`
 * (`promotions.ts`), scoped to `reservationId` instead of `saleId`. A
 * SEPARATE table rather than widening the sales one: `coupon_redemptions.
 * sale_id` is `not null` and that table is already certified/tested
 * against real POS sales — adding a nullable, mutually-exclusive
 * `reservation_id` there would touch mature, working financial code for a
 * new, unrelated domain. This table gives parties the exact same
 * concurrency guarantee (`PartyReservationsService.applyCoupon` locks the
 * coupon row and counts existing redemptions here inside the SAME
 * transaction as the reservation it's applied to) with zero risk to the
 * sales path. `usageLimitTotal` on a coupon is therefore tracked as TWO
 * independent pools (one for sales, one for party reservations) — a
 * disclosed, deliberate scope decision (see `docs/LEGACY_FUNCTIONAL_
 * PARITY.md`'s TASK 16.20 section), not a silent gap: merging the pools
 * would require a cross-table locked count spanning two otherwise-
 * unrelated modules for a benefit legacy itself never needed (V1's own
 * coupons had no cross-context usage limit either).
 */
export const partyReservationCouponRedemptions = pgTable(
  'party_reservation_coupon_redemptions',
  {
    id: idColumn(),
    companyId: companyIdColumn(),
    branchId: uuid('branch_id').notNull(),
    reservationId: uuid('reservation_id').notNull(),
    couponId: uuid('coupon_id').notNull(),
    amount: numeric('amount', { precision: 19, scale: 4 }).notNull(),
    redeemedAt: timestamp('redeemed_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (table) => [
    unique('party_reservation_coupon_redemptions_company_coupon_reservation_uq').on(
      table.companyId,
      table.couponId,
      table.reservationId,
    ),
    foreignKey({
      columns: [table.companyId, table.couponId],
      foreignColumns: [coupons.companyId, coupons.id],
      name: 'party_reservation_coupon_redemptions_coupon_scope_fk',
    }).onDelete('restrict'),
    foreignKey({
      columns: [table.companyId, table.reservationId],
      foreignColumns: [partyReservations.companyId, partyReservations.id],
      name: 'party_reservation_coupon_redemptions_reservation_scope_fk',
    }).onDelete('restrict'),
    index('party_reservation_coupon_redemptions_coupon_idx').on(table.companyId, table.couponId),
    index('party_reservation_coupon_redemptions_reservation_idx').on(table.companyId, table.reservationId),
    check('party_reservation_coupon_redemptions_amount_ck', sql`${table.amount} >= 0`),
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
    // TASK 16.20 (Part P) — resolves the TASK 16.19-disclosed gap. The
    // HTML itself is still NEVER stored (regenerated fresh every call,
    // exactly as before) — this freezes only the LEGAL CLAUSE TEXT that
    // generation used, as a JSON array of strings, the one part of the
    // document where "an already-issued contract must not silently
    // mutate" (TASK 16.19's own requirement) genuinely matters: without
    // this, a tenant editing `parties.contract_terms` next month, or a
    // future platform code change to the generic default clauses, would
    // silently rewrite the wording of every past reservation's document
    // on its next reprint. `generateDocument` reuses the EARLIEST
    // existing snapshot for a given (reservation, document_type) rather
    // than re-resolving the live setting on every call — see that
    // method's own doc comment. Nullable only so a pre-migration row
    // (generated before this column existed) is told apart from a
    // genuine future row. A real `jsonb` column (not `text`) so a read
    // round-trips as an already-parsed array, never a raw JSON string
    // that would silently double-encode on the next insert.
    termsSnapshot: jsonb('terms_snapshot').$type<readonly string[]>(),
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
    check(
      'party_reservation_documents_terms_snapshot_array_ck',
      sql`${table.termsSnapshot} is null or jsonb_typeof(${table.termsSnapshot}) = 'array'`,
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
