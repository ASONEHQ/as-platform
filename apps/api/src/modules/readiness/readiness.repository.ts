import type { DatabaseClient } from '@asone/database';

import type { BranchFacts, CompanyFacts, ReadinessItem } from './readiness.types.js';

/** A user needs ALL of these, at a branch, to take a CASH sale from an
 * empty drawer to a completed, paid, receipted sale: see each route's own
 * `requirePermission` in `sales.routes.ts`/`payments.routes.ts`/
 * `cash.routes.ts`. */
export const cashOperatorPermissions = [
  'catalog.read',
  'cash_register.read',
  'cash_session.open',
  'sale.create',
  'payment.create',
] as const;

/** Enough to reach the POS and ring up a ticket (no cash-session right). */
export const posEntryPermissions = ['catalog.read', 'cash_register.read', 'sale.create'] as const;

const LIST_LIMIT = 10;

interface CountRow {
  area_count: number;
  register_count: number;
  register_foreign_area_count: number;
  open_session_count: number;
  location_count: number;
  default_location_count: number;
  default_location_receiving_count: number;
}
interface ProductAggregateRow {
  active_count: number;
  priced_count: number;
  unpriced_count: number;
  foreign_currency_count: number;
  tracked_count: number;
  tracked_without_stock_count: number;
  sellable_count: number;
}
interface ItemRow {
  id: string;
  name: string;
}

/**
 * Every query here is read-only and scoped by `company_id`. Nothing in this
 * class can mutate data — that is deliberate: readiness is an observation,
 * never a fix (TASK 16.17 §17, "existing tenant safety").
 */
export class ReadinessRepository {
  public constructor(private readonly database: DatabaseClient) {}

  public async companyFacts(companyId: string, permittedBranchIds: readonly string[]): Promise<CompanyFacts | null> {
    const company = await this.database.pool.query<{
      id: string;
      display_name: string;
      status: string;
      timezone: string;
      currency_code: string;
    }>(`select id,display_name,status,timezone,currency_code from companies where id=$1`, [companyId]);
    const row = company.rows[0];
    if (row === undefined) return null;
    const branches = await this.database.pool.query<{ count: number }>(
      `select count(*)::int as count from branches where company_id=$1 and status='active' and id=any($2::uuid[])`,
      [companyId, permittedBranchIds],
    );
    return {
      id: row.id,
      displayName: row.display_name,
      status: row.status,
      timezone: row.timezone,
      currencyCode: row.currency_code,
      activeBranchCount: branches.rows[0]?.count ?? 0,
    };
  }

  public async activeBranches(
    companyId: string,
    permittedBranchIds: readonly string[],
    onlyBranchId: string | undefined,
  ): Promise<readonly { id: string; code: string; name: string; timezone: string }[]> {
    const result = await this.database.pool.query<{ id: string; code: string; name: string; timezone: string }>(
      `select id,code,name,timezone from branches
       where company_id=$1 and status='active' and id=any($2::uuid[]) and ($3::uuid is null or id=$3::uuid)
       order by code,id limit 25`,
      [companyId, permittedBranchIds, onlyBranchId ?? null],
    );
    return result.rows;
  }

  public async branchFacts(
    companyId: string,
    currencyCode: string,
    branch: { id: string; code: string; name: string; timezone: string },
  ): Promise<BranchFacts> {
    const counts = (
      await this.database.pool.query<CountRow>(
        `select
           (select count(*) from operational_areas where company_id=$1 and branch_id=$2 and status='active')::int as area_count,
           (select count(*) from cash_registers where company_id=$1 and branch_id=$2 and status='active' and deleted_at is null)::int as register_count,
           (select count(*) from cash_registers cr
             where cr.company_id=$1 and cr.branch_id=$2 and cr.status='active' and cr.deleted_at is null
               and cr.operational_area_id is not null
               and not exists (select 1 from operational_areas oa
                               where oa.company_id=cr.company_id and oa.id=cr.operational_area_id
                                 and oa.branch_id=cr.branch_id and oa.status='active'))::int as register_foreign_area_count,
           (select count(*) from cash_sessions where company_id=$1 and branch_id=$2 and status='open')::int as open_session_count,
           (select count(*) from inventory_locations where company_id=$1 and branch_id=$2 and status='active' and deleted_at is null)::int as location_count,
           (select count(*) from inventory_locations where company_id=$1 and branch_id=$2 and status='active' and deleted_at is null and is_default)::int as default_location_count,
           (select count(*) from inventory_locations where company_id=$1 and branch_id=$2 and status='active' and deleted_at is null and is_default and allows_receiving)::int as default_location_receiving_count`,
        [companyId, branch.id],
      )
    ).rows[0];
    if (counts === undefined) throw new Error('Readiness count query returned no row.');

    const operators = await this.operatorCounts(companyId, branch.id);
    const products = await this.productFacts(companyId, branch.id, currencyCode);

    return {
      id: branch.id,
      code: branch.code,
      name: branch.name,
      timezone: branch.timezone,
      areaCount: counts.area_count,
      registerCount: counts.register_count,
      registersWithForeignAreaCount: counts.register_foreign_area_count,
      openSessionCount: counts.open_session_count,
      posEntryOperatorCount: operators.posEntry,
      cashOperatorCount: operators.cash,
      cashOperatorWithRegisterCount: operators.cashWithRegister,
      activeProductCount: products.aggregate.active_count,
      pricedProductCount: products.aggregate.priced_count,
      unpricedProducts: products.unpriced,
      unpricedProductCount: products.aggregate.unpriced_count,
      foreignCurrencyPriceProducts: products.foreignCurrency,
      foreignCurrencyPriceProductCount: products.aggregate.foreign_currency_count,
      trackedProductCount: products.aggregate.tracked_count,
      trackedWithoutStock: products.trackedWithoutStock,
      trackedWithoutStockCount: products.aggregate.tracked_without_stock_count,
      locationCount: counts.location_count,
      defaultLocationCount: counts.default_location_count,
      defaultLocationReceivingCount: counts.default_location_receiving_count,
      sellableProductCount: products.aggregate.sellable_count,
    };
  }

  /**
   * Mirrors `AuthRepository.resolveContext`'s exact rules — a membership
   * reaches branch B when it holds a company-wide role, OR a role scoped to
   * B, OR an explicit `user_branch_access` row; its permissions at B are
   * the union of its company-wide and B-scoped ACTIVE roles' `allow`
   * grants minus any `deny`; and a register grant narrows which registers
   * it may use ("presence narrows, absence means unrestricted"; a
   * company-wide holder is never narrowed). Kept as a set-based query so a
   * tenant with many users costs three round trips, not three per user.
   */
  private async operatorCounts(
    companyId: string,
    branchId: string,
  ): Promise<{ posEntry: number; cash: number; cashWithRegister: number }> {
    const members = await this.database.pool.query<{ membership_id: string; company_wide: boolean }>(
      `with candidate as (
         select m.id as membership_id
         from company_memberships m
         join users u on u.id = m.user_id and u.status = 'active'
         where m.company_id = $1 and m.status = 'active'
       )
       select c.membership_id,
              exists (select 1 from user_roles ur join roles r on r.id = ur.role_id and r.company_id = ur.company_id
                      where ur.membership_id = c.membership_id and ur.company_id = $1 and ur.branch_id is null
                        and ur.status = 'active' and r.status = 'active') as company_wide
       from candidate c
       where exists (select 1 from user_roles ur join roles r on r.id = ur.role_id and r.company_id = ur.company_id
                     where ur.membership_id = c.membership_id and ur.company_id = $1 and ur.branch_id is null
                       and ur.status = 'active' and r.status = 'active')
          or exists (select 1 from user_roles ur join roles r on r.id = ur.role_id and r.company_id = ur.company_id
                     where ur.membership_id = c.membership_id and ur.company_id = $1 and ur.branch_id = $2
                       and ur.status = 'active' and r.status = 'active')
          or exists (select 1 from user_branch_access uba
                     where uba.membership_id = c.membership_id and uba.company_id = $1 and uba.branch_id = $2
                       and uba.status = 'active')`,
      [companyId, branchId],
    );
    if (members.rows.length === 0) return { posEntry: 0, cash: 0, cashWithRegister: 0 };
    const membershipIds = members.rows.map((row) => row.membership_id);

    const grants = await this.database.pool.query<{ membership_id: string; code: string }>(
      `select distinct ur.membership_id, p.code
       from user_roles ur
       join roles r on r.id = ur.role_id and r.company_id = ur.company_id and r.status = 'active'
       join role_permissions rp on rp.role_id = r.id and rp.company_id = r.company_id and rp.effect = 'allow'
       join permissions p on p.id = rp.permission_id
       where ur.company_id = $1 and ur.membership_id = any($3::uuid[]) and ur.status = 'active'
         and (ur.branch_id is null or ur.branch_id = $2)
         and not exists (
           select 1 from user_roles denied_ur
           join roles denied_r on denied_r.id = denied_ur.role_id and denied_r.company_id = denied_ur.company_id and denied_r.status = 'active'
           join role_permissions denied_rp on denied_rp.role_id = denied_r.id and denied_rp.company_id = denied_r.company_id
           where denied_ur.membership_id = ur.membership_id and denied_ur.company_id = ur.company_id and denied_ur.status = 'active'
             and (denied_ur.branch_id is null or denied_ur.branch_id = $2)
             and denied_rp.permission_id = rp.permission_id and denied_rp.effect = 'deny')`,
      [companyId, branchId, membershipIds],
    );
    const codesByMembership = new Map<string, Set<string>>();
    for (const row of grants.rows) {
      const set = codesByMembership.get(row.membership_id) ?? new Set<string>();
      set.add(row.code);
      codesByMembership.set(row.membership_id, set);
    }
    const holds = (membershipId: string, required: readonly string[]): boolean => {
      const set = codesByMembership.get(membershipId);
      return set !== undefined && required.every((code) => set.has(code));
    };

    const registers = await this.database.pool.query<{ id: string; operational_area_id: string | null }>(
      `select id, operational_area_id from cash_registers
       where company_id = $1 and branch_id = $2 and status = 'active' and deleted_at is null`,
      [companyId, branchId],
    );
    const registerGrants = await this.database.pool.query<{
      membership_id: string;
      cash_register_id: string | null;
      operational_area_id: string | null;
    }>(
      `select membership_id, cash_register_id, operational_area_id from user_register_access
       where company_id = $1 and membership_id = any($2::uuid[]) and status = 'active'`,
      [companyId, membershipIds],
    );
    const grantsByMembership = new Map<string, { registers: Set<string>; areas: Set<string> }>();
    for (const row of registerGrants.rows) {
      const entry = grantsByMembership.get(row.membership_id) ?? { registers: new Set<string>(), areas: new Set<string>() };
      if (row.cash_register_id !== null) entry.registers.add(row.cash_register_id);
      if (row.operational_area_id !== null) entry.areas.add(row.operational_area_id);
      grantsByMembership.set(row.membership_id, entry);
    }
    const usesRegister = (member: { membership_id: string; company_wide: boolean }): boolean => {
      if (registers.rows.length === 0) return false;
      if (member.company_wide) return true;
      const scope = grantsByMembership.get(member.membership_id);
      if (scope === undefined) return true;
      return registers.rows.some(
        (register) =>
          scope.registers.has(register.id) ||
          (register.operational_area_id !== null && scope.areas.has(register.operational_area_id)),
      );
    };

    let posEntry = 0;
    let cash = 0;
    let cashWithRegister = 0;
    for (const member of members.rows) {
      if (holds(member.membership_id, posEntryPermissions)) posEntry += 1;
      if (holds(member.membership_id, cashOperatorPermissions)) {
        cash += 1;
        if (usesRegister(member)) cashWithRegister += 1;
      }
    }
    return { posEntry, cash, cashWithRegister };
  }

  private async productFacts(
    companyId: string,
    branchId: string,
    currencyCode: string,
  ): Promise<{
    aggregate: ProductAggregateRow;
    unpriced: readonly ReadinessItem[];
    foreignCurrency: readonly ReadinessItem[];
    trackedWithoutStock: readonly ReadinessItem[];
  }> {
    // One classification of every sellable-identity product for this
    // branch, reused by all four reads below. A price counts when it is
    // active NOW and applies to this branch (branch override or company-wide) —
    // exactly the window `SalesRepository.resolveProductLines` reads.
    const base = `
      with base as (
        select p.id, p.name,
               coalesce(pv.tracks_inventory, false) as tracked,
               exists (select 1 from product_prices pp
                       where pp.company_id = p.company_id and pp.product_id = p.id and pp.status = 'active'
                         and pp.valid_from <= now() and (pp.valid_until is null or pp.valid_until > now())
                         and (pp.branch_id is null or pp.branch_id = $2)) as has_any_price,
               exists (select 1 from product_prices pp
                       where pp.company_id = p.company_id and pp.product_id = p.id and pp.status = 'active'
                         and pp.valid_from <= now() and (pp.valid_until is null or pp.valid_until > now())
                         and (pp.branch_id is null or pp.branch_id = $2) and pp.currency_code = $3) as has_company_price,
               exists (select 1 from inventory_locations il
                       where il.company_id = p.company_id and il.branch_id = $2 and il.is_default and il.status = 'active'
                         and il.deleted_at is null) as has_default_location,
               coalesce((select sum(ib.quantity_on_hand - ib.quantity_reserved)
                         from inventory_balances ib
                         join inventory_locations il on il.company_id = ib.company_id and il.id = ib.inventory_location_id
                         where ib.company_id = p.company_id and ib.branch_id = $2 and ib.product_variant_id = pv.id
                           and il.is_default and il.status = 'active' and il.deleted_at is null), 0) as available
        from products p
        left join product_variants pv
          on pv.company_id = p.company_id and pv.product_id = p.id and pv.is_default = true and pv.status <> 'retired'
        where p.company_id = $1 and p.status = 'active' and p.deleted_at is null
      )`;
    const params = [companyId, branchId, currencyCode];
    const aggregate = (
      await this.database.pool.query<ProductAggregateRow>(
        `${base}
         select count(*)::int as active_count,
                count(*) filter (where has_company_price)::int as priced_count,
                count(*) filter (where not has_any_price)::int as unpriced_count,
                count(*) filter (where has_any_price and not has_company_price)::int as foreign_currency_count,
                count(*) filter (where tracked)::int as tracked_count,
                count(*) filter (where tracked and has_company_price and (not has_default_location or available <= 0))::int as tracked_without_stock_count,
                count(*) filter (where has_company_price and (not tracked or (has_default_location and available > 0)))::int as sellable_count
         from base`,
        params,
      )
    ).rows[0];
    if (aggregate === undefined) throw new Error('Readiness product aggregate returned no row.');
    const list = async (predicate: string): Promise<readonly ReadinessItem[]> =>
      (
        await this.database.pool.query<ItemRow>(
          `${base} select id, name from base where ${predicate} order by name, id limit ${String(LIST_LIMIT)}`,
          params,
        )
      ).rows.map((row) => ({ id: row.id, label: row.name }));
    return {
      aggregate,
      unpriced: await list('not has_any_price'),
      foreignCurrency: await list('has_any_price and not has_company_price'),
      trackedWithoutStock: await list('tracked and has_company_price and (not has_default_location or available <= 0)'),
    };
  }
}
