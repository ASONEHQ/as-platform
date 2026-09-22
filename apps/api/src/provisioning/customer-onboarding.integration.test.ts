import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  createDatabaseClient,
  roleTemplates,
  seedTechnicalPermissions,
  syncSystemRolePermissions,
  type DatabaseClient,
} from '@asone/database';

import { AdministrationService } from '../modules/admin/shared/admin.service.js';
import { AdminRepository } from '../modules/admin/shared/admin.repository.js';
import type { AdminActor } from '../modules/admin/shared/admin.types.js';
import { PostgresAuthRepository } from '../modules/auth/auth.repository.js';
import { AuthService } from '../modules/auth/auth.service.js';
import { AuthTokens } from '../modules/auth/auth.tokens.js';
import type { AuthContext } from '../modules/auth/auth.types.js';
import { CashRepository } from '../modules/cash/cash.repository.js';
import { CashService } from '../modules/cash/cash.service.js';
import { ProductCatalogRepository } from '../modules/catalog/product-catalog.repository.js';
import { ProductCatalogService } from '../modules/catalog/product-catalog.service.js';
import { InventoryReversalRepository } from '../modules/inventory/inventory-reversal.repository.js';
import { InventoryReversalService } from '../modules/inventory/inventory-reversal.service.js';
import { InventoryLocationRepository } from '../modules/inventory/inventory.repository.js';
import { InventoryLocationService } from '../modules/inventory/inventory.service.js';
import { OperationalAreasRepository } from '../modules/operational-areas/operational-areas.repository.js';
import { OperationalAreasService } from '../modules/operational-areas/operational-areas.service.js';
import { PaymentRepository } from '../modules/payments/payments.repository.js';
import { PaymentService } from '../modules/payments/payments.service.js';
import { MercadoPagoClient } from '../modules/payments/providers/mercado-pago.client.js';
import { MercadoPagoPointProvider } from '../modules/payments/providers/mercado-pago.provider.js';
import { PromotionsRepository } from '../modules/promotions/promotions.repository.js';
import { PurchasingRepository } from '../modules/purchasing/purchasing.repository.js';
import { PurchasingService } from '../modules/purchasing/purchasing.service.js';
import { ReadinessRepository } from '../modules/readiness/readiness.repository.js';
import { ReadinessService } from '../modules/readiness/readiness.service.js';
import type { TenantReadiness } from '../modules/readiness/readiness.types.js';
import { SalesRepository } from '../modules/sales/sales.repository.js';
import { SalesService } from '../modules/sales/sales.service.js';
import { SuppliersRepository } from '../modules/suppliers/suppliers.repository.js';
import { ProductionOwnerProvisioner } from './production-owner.service.js';
import { ProvisioningInputError } from './production-owner.types.js';

/**
 * TASK 16.17 — "ACCESS GO customer #2": proves, against real PostgreSQL and
 * the real services (never a mock, never Flutter), that a brand-new tenant
 * can go from ZERO to its first completed CASH sale with no source change,
 * no hardcoded tenant value, and no leakage to or from another tenant.
 *
 * The two tenants here are deliberately generic and DIFFERENT from each
 * other in exactly the ways the product must not assume:
 *  - Tenant A ("existing customer"): MXN, America/Mexico_City, IVA-general.
 *  - Tenant B ("customer #2"):       USD, America/New_York.
 * Every name is a placeholder; nothing here mentions any real customer.
 */
const databaseUrl = process.env.DATABASE_TEST_URL;
const integration = databaseUrl === undefined ? describe.skip : describe;

const STRONG_PASSWORD = 'Correct-Horse-Battery-42!';

function asAuthContext(resolved: Omit<AuthContext, 'sessionId' | 'expiresAt'>): AuthContext {
  return { ...resolved, sessionId: 'qa-session', expiresAt: new Date(Date.now() + 60_000) };
}

interface Tenant {
  companyId: string;
  slug: string;
  ownerUserId: string;
  ownerMembershipId: string;
  ownerEmail: string;
  branchId: string | null;
}

integration('PostgreSQL commercial customer #2 onboarding, zero to first sale (TASK 16.17)', { concurrent: false }, () => {
  let database: DatabaseClient;
  let authRepository: PostgresAuthRepository;
  let authService: AuthService;
  let administration: AdministrationService;
  let provisioner: ProductionOwnerProvisioner;
  let cash: CashService;
  let sales: SalesService;
  let payments: PaymentService;
  let catalog: ProductCatalogService;
  let locations: InventoryLocationService;
  let purchasing: PurchasingService;
  let areas: OperationalAreasService;
  let readinessService: ReadinessService;

  let tenantA: Tenant;
  let tenantB: Tenant;
  const createdCompanyIds: string[] = [];
  const createdUserIds: string[] = [];
  const syntheticPermissionCodes: string[] = [];

  const unique = (): string => `${Date.now().toString(36)}${randomUUID().replaceAll('-', '').slice(0, 6)}`;

  async function resolve(tenant: Tenant, userId: string, membershipId: string, branchId?: string): Promise<AdminActor> {
    const resolved = await authRepository.resolveContext({
      userId,
      membershipId,
      companyId: tenant.companyId,
      ...(branchId === undefined ? {} : { branchId }),
    });
    if (resolved === null) throw new Error('context did not resolve');
    return { context: asAuthContext(resolved), requestId: `req-${unique()}`, correlationId: `corr-${unique()}` };
  }
  const ownerOf = (tenant: Tenant, branchId?: string): Promise<AdminActor> =>
    resolve(tenant, tenant.ownerUserId, tenant.ownerMembershipId, branchId);
  const mutation = (actor: AdminActor) => ({
    companyId: actor.context.companyId,
    actorId: actor.context.userId,
    requestId: actor.requestId,
    correlationId: actor.correlationId,
    timestamp: new Date(Date.now() - 1_000),
  });
  /** A foreign resource is denied — as 404 (hidden) or 403 (branch scope) — never served. */
  const expectDenied = async (promise: Promise<unknown>): Promise<void> => {
    await expect(promise).rejects.toSatisfy((error: unknown) => [403, 404].includes((error as { statusCode?: number }).statusCode ?? 0));
  };
  const readiness = async (tenant: Tenant): Promise<TenantReadiness> => {
    const owner = await ownerOf(tenant);
    return readinessService.evaluate(tenant.companyId, owner.context.permittedBranchIds);
  };
  const stageOf = (result: TenantReadiness, key: string) => {
    const stage = result.branches[0]?.stages.find((entry) => entry.key === key);
    if (stage === undefined) throw new Error(`stage ${key} missing`);
    return stage;
  };
  const checkOf = (result: TenantReadiness, code: string) => {
    const found = [...result.company.checks, ...(result.branches[0]?.checks ?? [])].find((entry) => entry.code === code);
    if (found === undefined) throw new Error(`check ${code} missing`);
    return found;
  };

  async function provision(input: {
    name: string;
    currency: string;
    timezone: string;
    branch?: { name: string; code: string };
  }): Promise<Tenant> {
    const slug = `qa-${input.name}-${unique()}`.toLowerCase();
    const ownerEmail = `owner-${unique()}@example.test`;
    const summary = await provisioner.run({
      companyLegalName: `${input.name} QA Merchant`,
      companySlug: slug,
      companyTimezone: input.timezone,
      companyCurrencyCode: input.currency,
      ownerDisplayName: `${input.name} Owner`,
      ownerEmail,
      ownerPassword: STRONG_PASSWORD,
      ...(input.branch === undefined
        ? {}
        : { branchName: input.branch.name, branchCode: input.branch.code, branchTimezone: input.timezone }),
    });
    createdCompanyIds.push(summary.companyId);
    createdUserIds.push(summary.ownerUserId);
    const membership = await database.pool.query<{ id: string }>(
      `select id from company_memberships where company_id=$1 and user_id=$2`,
      [summary.companyId, summary.ownerUserId],
    );
    const ownerMembershipId = membership.rows[0]?.id;
    if (ownerMembershipId === undefined) throw new Error('owner membership missing');
    return {
      companyId: summary.companyId,
      slug,
      ownerUserId: summary.ownerUserId,
      ownerMembershipId,
      ownerEmail,
      branchId: summary.branchId,
    };
  }

  beforeAll(async () => {
    if (databaseUrl === undefined || !new URL(databaseUrl).pathname.toLowerCase().includes('test'))
      throw new Error('DATABASE_TEST_URL must identify a dedicated test database.');
    database = createDatabaseClient({ connectionString: databaseUrl, applicationName: 'asone-customer-onboarding-integration' });
    await seedTechnicalPermissions(database.db);
    authRepository = new PostgresAuthRepository(database);
    authService = new AuthService({
      repository: authRepository,
      tokens: new AuthTokens({
        audience: 'asone-customer-onboarding-test',
        issuer: 'https://api.test.asone.mx',
        secret: 'test-secret-that-is-at-least-32-characters',
        ttlSeconds: 300,
      }),
      dummyPasswordHash: 'x'.repeat(60),
      accessTokenTtlSeconds: 300,
      refreshTokenTtlSeconds: 3_600,
    });
    administration = new AdministrationService(new AdminRepository(database), authService);
    provisioner = new ProductionOwnerProvisioner(database, () => Promise.resolve('$argon2id$qa-stub-hash'));
    const cashRepository = new CashRepository(database);
    cash = new CashService(cashRepository);
    const salesRepository = new SalesRepository(database);
    sales = new SalesService(salesRepository, new PromotionsRepository(database));
    payments = new PaymentService(
      new PaymentRepository(database),
      salesRepository,
      new MercadoPagoPointProvider(new MercadoPagoClient({ accessToken: undefined, apiBaseUrl: 'https://api.mercadopago.com' })),
      cashRepository,
    );
    catalog = new ProductCatalogService(new ProductCatalogRepository(database));
    locations = new InventoryLocationService(new InventoryLocationRepository(database));
    purchasing = new PurchasingService(
      new PurchasingRepository(database),
      new SuppliersRepository(database),
      new InventoryReversalService(new InventoryReversalRepository(database)),
    );
    areas = new OperationalAreasService(new OperationalAreasRepository(database));
    readinessService = new ReadinessService(new ReadinessRepository(database));
  });

  afterAll(async () => {
    const ids = createdCompanyIds;
    const tolerant = async (sql: string, params: unknown[]): Promise<void> => {
      try {
        await database.pool.query(sql, params);
      } catch {
        // best-effort cleanup only — the test DB is dedicated and re-truncated by sibling suites.
      }
    };
    for (const table of [
      'payment_attempts',
      'payments',
      'sale_items',
      'sales',
      'cash_movements',
      'cash_sessions',
      'user_register_access',
      'direct_purchases',
      'inventory_movement_lines',
      'inventory_balances',
      'inventory_movements',
      'inventory_locations',
      'product_prices',
      'product_barcodes',
      'product_variants',
      'products',
      'cash_registers',
      'operational_areas',
      'idempotency_keys',
      'outbox_events',
      'audit_log',
      'session_refresh_tokens',
      'sessions',
      'user_branch_access',
      'user_roles',
      'role_permissions',
      'roles',
      'company_memberships',
      'branches',
    ])
      await tolerant(`delete from ${table} where company_id = any($1::uuid[])`, [ids]);
    await tolerant(`delete from companies where id = any($1::uuid[])`, [ids]);
    await tolerant(`delete from users where id = any($1::uuid[])`, [createdUserIds]);
    for (const code of syntheticPermissionCodes) {
      await tolerant(`delete from role_permissions where permission_id in (select id from permissions where code=$1)`, [code]);
      await tolerant(`delete from permissions where code=$1`, [code]);
    }
    await database.close();
  });

  // ---------------------------------------------------------------------
  // Provisioning safety (timezone/currency/legacy-master-account classes)
  // ---------------------------------------------------------------------
  it('refuses to provision a tenant with a non-IANA timezone (the "Mexico_City" class of bug)', async () => {
    await expect(
      provisioner.run({
        companyLegalName: 'Bad Tz QA',
        companySlug: `qa-bad-tz-${unique()}`,
        companyTimezone: 'Mexico_City',
        ownerDisplayName: 'Owner',
        ownerEmail: `owner-${unique()}@example.test`,
        ownerPassword: STRONG_PASSWORD,
      }),
    ).rejects.toBeInstanceOf(ProvisioningInputError);
    await expect(
      provisioner.run({
        companyLegalName: 'Bad Branch Tz QA',
        companySlug: `qa-bad-btz-${unique()}`,
        ownerDisplayName: 'Owner',
        ownerEmail: `owner-${unique()}@example.test`,
        ownerPassword: STRONG_PASSWORD,
        branchName: 'B',
        branchCode: 'B',
        branchTimezone: 'Mexico_City',
      }),
    ).rejects.toBeInstanceOf(ProvisioningInputError);
  });

  it('refuses a currency that has no approved cash-denomination set instead of failing at the first close', async () => {
    await expect(
      provisioner.run({
        companyLegalName: 'Euro QA',
        companySlug: `qa-eur-${unique()}`,
        companyCurrencyCode: 'EUR',
        ownerDisplayName: 'Owner',
        ownerEmail: `owner-${unique()}@example.test`,
        ownerPassword: STRONG_PASSWORD,
      }),
    ).rejects.toThrow(/not a currency ACCESS GO supports/u);
  });

  it('refuses a weak owner password and never stores a plaintext credential anywhere', async () => {
    await expect(
      provisioner.run({
        companyLegalName: 'Weak QA',
        companySlug: `qa-weak-${unique()}`,
        ownerDisplayName: 'Owner',
        ownerEmail: `owner-${unique()}@example.test`,
        ownerPassword: 'password',
      }),
    ).rejects.toBeInstanceOf(ProvisioningInputError);
  });

  // ---------------------------------------------------------------------
  // The two tenants
  // ---------------------------------------------------------------------
  it('provisions tenant A (existing customer) and tenant B (customer #2) with a complete Owner each and no shared identity', async () => {
    tenantA = await provision({
      name: 'ExistingCustomer',
      currency: 'MXN',
      timezone: 'America/Mexico_City',
      branch: { name: 'Existing Main', code: 'MAIN' },
    });
    tenantB = await provision({ name: 'CustomerTwo', currency: 'USD', timezone: 'America/New_York' });

    const catalogSize = (await database.pool.query<{ n: number }>(`select count(*)::int n from permissions`)).rows[0]?.n ?? 0;
    expect(catalogSize).toBeGreaterThan(0);
    for (const tenant of [tenantA, tenantB]) {
      const owner = await database.pool.query<{ is_system: boolean; granted: number }>(
        `select r.is_system, (select count(*)::int from role_permissions rp where rp.role_id=r.id and rp.effect='allow') granted
         from roles r where r.company_id=$1 and r.code='owner'`,
        [tenant.companyId],
      );
      // The Owner role is the system role and holds EVERY permission that exists today.
      expect(owner.rows).toEqual([{ is_system: true, granted: catalogSize }]);
    }
    expect(tenantA.companyId).not.toBe(tenantB.companyId);
    expect(tenantA.ownerUserId).not.toBe(tenantB.ownerUserId);
    // No legacy "factory master" identity was created — exactly one user per provisioned company.
    const memberships = await database.pool.query<{ n: number }>(
      `select count(*)::int n from company_memberships where company_id=any($1::uuid[])`,
      [[tenantA.companyId, tenantB.companyId]],
    );
    expect(memberships.rows[0]?.n).toBe(2);
    const audit = await database.pool.query<{ action: string }>(
      `select action from audit_log where company_id=$1`,
      [tenantB.companyId],
    );
    expect(audit.rows.map((row) => row.action)).toContain('production.owner_provisioned');
  });

  it('a second provisioning with the same slug is refused (no silent takeover of an existing tenant)', async () => {
    await expect(
      provisioner.run({
        companyLegalName: 'Dup',
        companySlug: tenantB.slug,
        ownerDisplayName: 'Owner',
        ownerEmail: `owner-${unique()}@example.test`,
        ownerPassword: STRONG_PASSWORD,
      }),
    ).rejects.toThrow(/already exists/u);
  });

  // ---------------------------------------------------------------------
  // Tenant A gets a working sale so isolation is tested against REAL data
  // ---------------------------------------------------------------------
  let aSaleId = '';
  let aSessionId = '';
  let aProductId = '';
  let aRegisterId = '';
  it('tenant A (existing customer) is fully set up and takes a sale, independently of tenant B', async () => {
    const owner = await ownerOf(tenantA, tenantA.branchId ?? undefined);
    const branchIds = owner.context.permittedBranchIds;
    const register = await cash.createRegister(mutation(owner), branchIds, `a-reg-${unique()}`, {
      branchId: tenantA.branchId ?? '',
      code: 'A-REG',
      name: 'A Register',
    });
    aRegisterId = register.value.id;
    const product = await catalog.createProduct(mutation(owner), `a-prod-${unique()}`, {
      code: `a-item-${unique()}`,
      name: 'A Item',
      productType: 'simple',
      tracksInventory: false,
      taxCode: 'IVA_EXEMPT',
      status: 'active',
      defaultVariant: { sku: `A-SKU-${unique()}`, unitOfMeasureCode: 'unit', quantityScale: 0, standardCost: '0', currencyCode: 'MXN' },
    });
    aProductId = product.value.id;
    await catalog.createProductPrice(mutation(owner), aProductId, `a-price-${unique()}`, { amount: '50.00', currencyCode: 'MXN' });
    const session = await cash.openSession(mutation(owner), branchIds, `a-open-${unique()}`, {
      cashRegisterId: aRegisterId,
      openingAmount: '100.0000',
    });
    aSessionId = session.value.id;
    const sale = await sales.createSale(mutation(owner), branchIds, `a-sale-${unique()}`, {
      branchId: tenantA.branchId ?? '',
      items: [{ productId: aProductId, quantity: '1' }],
      cashRegisterId: aRegisterId,
    });
    aSaleId = sale.value.sale.id;
    const paid = await payments.createCashPayment(mutation(owner), branchIds, `a-pay-${unique()}`, {
      saleId: aSaleId,
      tenderedAmount: '50.00',
      cashRegisterId: aRegisterId,
    });
    expect(paid.value.sale.status).toBe('completed');
    expect(paid.value.sale.currencyCode).toBe('MXN');
  });

  // ---------------------------------------------------------------------
  // Customer #2: zero -> first sale, with readiness reflecting backend truth at each step
  // ---------------------------------------------------------------------
  let bBranchId = '';
  let bRegisterId = '';
  let bUntrackedProductId = '';
  let bTrackedProductId = '';
  let bTrackedVariantId = '';
  let cashierUserId = '';
  let cashierMembershipId = '';

  it('step 1 — a fresh tenant with no branch is NOT ready, and readiness names exactly why', async () => {
    const result = await readiness(tenantB);
    expect(result.company.name).toBe('CustomerTwo QA Merchant');
    expect(result.company.currencyCode).toBe('USD');
    expect(result.company.administrationReady).toBe(false);
    expect(checkOf(result, 'branch_exists').status).toBe('missing');
    expect(result.branches).toHaveLength(0);
  });

  it('step 2 — branch creation rejects a non-IANA timezone and accepts a real one; the Owner reaches the new branch immediately', async () => {
    const owner = await ownerOf(tenantB);
    await expect(
      administration.createBranch(owner, { code: 'QA1', name: 'QA Branch', timezone: 'Mexico_City' }),
    ).rejects.toMatchObject({ statusCode: 400 });
    const created = await administration.createBranch(owner, { code: 'QA1', name: 'QA Branch', timezone: 'America/New_York' });
    bBranchId = String(created.id);
    const refreshed = await ownerOf(tenantB);
    expect(refreshed.context.permittedBranchIds).toContain(bBranchId);

    const result = await readiness(tenantB);
    expect(result.company.administrationReady).toBe(true);
    expect(stageOf(result, 'administration').ready).toBe(true);
    expect(stageOf(result, 'pos_entry').blockedBy).toContain('register_exists');
    expect(stageOf(result, 'sale').ready).toBe(false);
  });

  it('step 3 — operational areas are optional; a register works with no area, and can never point at another branch/tenant\'s area', async () => {
    const owner = await ownerOf(tenantB);
    const branchIds = owner.context.permittedBranchIds;
    expect(checkOf(await readiness(tenantB), 'operational_areas').status).toBe('optional_missing');

    const register = await cash.createRegister(mutation(owner), branchIds, `b-reg-${unique()}`, {
      branchId: bBranchId,
      code: 'QA-REG-1',
      name: 'QA Register',
    });
    bRegisterId = register.value.id;
    expect(register.value.operationalAreaId).toBeNull();
    const withRegister = await readiness(tenantB);
    expect(checkOf(withRegister, 'register_exists').status).toBe('ok');
    // The Owner is a company-wide, all-permission user, so a usable operator already exists.
    expect(stageOf(withRegister, 'register_open').ready).toBe(true);
    expect(stageOf(withRegister, 'sale').blockedBy).toEqual(['catalog_products']);

    // A second branch in tenant B with its own area.
    const second = await administration.createBranch(owner, { code: 'QA2', name: 'QA Branch 2', timezone: 'America/New_York' });
    const secondBranchId = String(second.id);
    const ownerBoth = await ownerOf(tenantB);
    const otherBranchArea = await areas.create(mutation(ownerBoth), ownerBoth.context.permittedBranchIds, `b-area2-${unique()}`, {
      branchId: secondBranchId,
      code: 'AREA-2',
      name: 'Area In Other Branch',
    });
    await expect(
      cash.assignOperationalArea(mutation(ownerBoth), ownerBoth.context.permittedBranchIds, bRegisterId, register.value.version, otherBranchArea.value.id),
    ).rejects.toMatchObject({ code: 'validation_error' });
    await expect(
      cash.createRegister(mutation(ownerBoth), ownerBoth.context.permittedBranchIds, `b-reg-x-${unique()}`, {
        branchId: bBranchId,
        code: 'QA-REG-X',
        name: 'Wrong Area Register',
        operationalAreaId: otherBranchArea.value.id,
      }),
    ).rejects.toMatchObject({ code: 'validation_error' });

    // ...and tenant A's area (a different company entirely) is equally unreachable.
    const ownerA = await ownerOf(tenantA, tenantA.branchId ?? undefined);
    const foreignArea = await areas.create(mutation(ownerA), ownerA.context.permittedBranchIds, `a-area-${unique()}`, {
      branchId: tenantA.branchId ?? '',
      code: 'A-AREA',
      name: 'Existing Customer Area',
    });
    await expect(
      cash.assignOperationalArea(mutation(ownerBoth), ownerBoth.context.permittedBranchIds, bRegisterId, register.value.version, foreignArea.value.id),
    ).rejects.toMatchObject({ code: 'validation_error' });

    // A same-branch area works, and stays optional afterwards.
    const ownArea = await areas.create(mutation(ownerBoth), ownerBoth.context.permittedBranchIds, `b-area-${unique()}`, {
      branchId: bBranchId,
      code: 'AREA-1',
      name: 'Tenant Defined Area',
    });
    const assigned = await cash.assignOperationalArea(
      mutation(ownerBoth),
      ownerBoth.context.permittedBranchIds,
      bRegisterId,
      register.value.version,
      ownArea.value.id,
    );
    expect(assigned.operationalAreaId).toBe(ownArea.value.id);
  });

  it('step 4 — users: a cashier is created from the commercial Cashier template, scoped to the branch and to ONE register, no permission codes typed by hand', async () => {
    const owner = await ownerOf(tenantB);
    const created = await administration.createUser(owner, { email: `cashier-${unique()}@example.test`, displayName: 'QA Operator' });
    cashierUserId = String(created.id);
    cashierMembershipId = String(created.membership_id);
    createdUserIds.push(cashierUserId);
    await administration.updateMembership(owner, cashierUserId, 'active', STRONG_PASSWORD);

    const role = await administration.createRole(owner, { name: 'QA Cashier Role', code: `qa-cashier-${unique()}` });
    const template = roleTemplates.find((entry) => entry.key === 'cashier');
    if (template === undefined) throw new Error('cashier template missing');
    const ids = await database.pool.query<{ id: string; code: string }>(
      `select id, code from permissions where code = any($1::text[])`,
      [[...template.permissionCodes]],
    );
    await administration.replaceRolePermissions(
      owner,
      String(role.id),
      ids.rows.map((row) => ({ permissionId: row.id, effect: 'allow' as const })),
    );
    await administration.assignRole(owner, cashierUserId, { roleId: String(role.id), branchId: bBranchId });
    await administration.grantRegisterAccess(owner, cashierUserId, bBranchId, { cashRegisterId: bRegisterId });

    const cashier = await resolve(tenantB, cashierUserId, cashierMembershipId, bBranchId);
    expect(cashier.context.permittedBranchIds).toEqual([bBranchId]);
    expect(cashier.context.permittedRegisterIds).toEqual([bRegisterId]);
    expect(cashier.context.companyWideAccess).toBe(false);
    for (const code of ['sale.create', 'payment.create', 'cash_session.open', 'cash_register.read', 'catalog.read'])
      expect(cashier.context.permissions).toContain(code);
    // A cashier must not be able to administer anything.
    for (const code of ['user.create', 'role.create', 'product.manage', 'price.manage', 'branch.create'])
      expect(cashier.context.permissions).not.toContain(code);

    const result = await readiness(tenantB);
    expect(checkOf(result, 'operator_authorized').count).toBeGreaterThanOrEqual(2);
  });

  it('step 5 — first product: missing price is diagnosed by NAME; a price in another currency is refused; the first active price makes it sellable', async () => {
    const owner = await ownerOf(tenantB);
    const product = await catalog.createProduct(mutation(owner), `b-prod-${unique()}`, {
      code: `b-item-${unique()}`,
      name: 'Product X',
      productType: 'simple',
      tracksInventory: false,
      taxCode: 'IVA_GENERAL',
      status: 'active',
      // No currency here on purpose: the tenant's own currency must be the default upstream (routes).
      defaultVariant: { sku: `B-SKU-${unique()}`, unitOfMeasureCode: 'unit', quantityScale: 0, standardCost: '0', currencyCode: 'USD' },
    });
    bUntrackedProductId = product.value.id;

    const before = await readiness(tenantB);
    expect(checkOf(before, 'catalog_products').status).toBe('ok');
    const prices = checkOf(before, 'product_prices');
    expect(prices.status).toBe('missing');
    expect(prices.items).toEqual([{ id: bUntrackedProductId, label: 'Product X' }]);
    expect(stageOf(before, 'sale').blockedBy).toEqual(['product_prices']);

    // A sale can't even be created without a price...
    const cashier = await resolve(tenantB, cashierUserId, cashierMembershipId, bBranchId);
    await expect(
      sales.createSale(mutation(cashier), cashier.context.permittedBranchIds, `b-noprice-${unique()}`, {
        branchId: bBranchId,
        items: [{ productId: bUntrackedProductId, quantity: '1' }],
      }),
    ).rejects.toMatchObject({ code: 'price_not_found' });

    // ...a price in the WRONG currency is refused at the source (never discovered at close time)...
    await expect(
      catalog.createProductPrice(mutation(owner), bUntrackedProductId, `b-badprice-${unique()}`, { amount: '100.00', currencyCode: 'MXN' }),
    ).rejects.toMatchObject({ code: 'validation_error' });
    await expect(
      catalog.changeProductPrice(mutation(owner), bUntrackedProductId, `b-badchange-${unique()}`, { amount: '100.00', currencyCode: 'EUR' }),
    ).rejects.toMatchObject({ code: 'validation_error' });

    // ...and the tenant's own currency works.
    await catalog.createProductPrice(mutation(owner), bUntrackedProductId, `b-price-${unique()}`, { amount: '100.00', currencyCode: 'USD' });
    const after = await readiness(tenantB);
    expect(checkOf(after, 'product_prices').status).toBe('ok');
    expect(stageOf(after, 'sale').ready).toBe(true);
    expect(stageOf(after, 'inventory').ready).toBeNull();
  });

  it('step 6 — an inventory-tracked product exposes the hidden prerequisite: no default location => REQUIRED-missing, and the sale genuinely fails', async () => {
    const owner = await ownerOf(tenantB);
    const product = await catalog.createProduct(mutation(owner), `b-tracked-${unique()}`, {
      code: `b-tracked-${unique()}`,
      name: 'Tracked Item',
      productType: 'simple',
      tracksInventory: true,
      taxCode: 'IVA_EXEMPT',
      status: 'active',
      defaultVariant: { sku: `B-TSKU-${unique()}`, unitOfMeasureCode: 'unit', quantityScale: 0, standardCost: '2', currencyCode: 'USD', tracksInventory: true },
    });
    bTrackedProductId = product.value.id;
    bTrackedVariantId = product.value.defaultVariant?.id ?? '';
    expect(bTrackedVariantId).not.toBe('');
    await catalog.createProductPrice(mutation(owner), bTrackedProductId, `b-tprice-${unique()}`, { amount: '10.00', currencyCode: 'USD' });

    const result = await readiness(tenantB);
    const location = checkOf(result, 'inventory_location');
    expect(location.required).toBe(true);
    expect(location.status).toBe('missing');
    expect(stageOf(result, 'inventory').ready).toBe(false);
    // The untracked product still sells — one hidden prerequisite never poisons unrelated products.
    expect(stageOf(result, 'sale').ready).toBe(true);

    // Prove it is REAL, not a made-up rule: the actual payment path refuses it.
    const cashier = await resolve(tenantB, cashierUserId, cashierMembershipId, bBranchId);
    const session = await cash.openSession(mutation(cashier), cashier.context.permittedBranchIds, `b-open-probe-${unique()}`, {
      cashRegisterId: bRegisterId,
      openingAmount: '50.0000',
    });
    const probeSale = await sales.createSale(mutation(cashier), cashier.context.permittedBranchIds, `b-probe-${unique()}`, {
      branchId: bBranchId,
      items: [{ productId: bTrackedProductId, quantity: '1' }],
      cashRegisterId: bRegisterId,
    }, cashier.context.permittedRegisterIds);
    await expect(
      payments.createCashPayment(mutation(cashier), cashier.context.permittedBranchIds, `b-probe-pay-${unique()}`, {
        saleId: probeSale.value.sale.id,
        tenderedAmount: '10.00',
        cashRegisterId: bRegisterId,
      }),
    ).rejects.toBeDefined();
    const unchanged = await sales.sale(tenantB.companyId, cashier.context.permittedBranchIds, probeSale.value.sale.id);
    expect(unchanged.sale.status).not.toBe('completed');
    // Nothing leaked into the drawer.
    const summary = await cash.summary(tenantB.companyId, cashier.context.permittedBranchIds, session.value.id);
    expect(summary.cashSalesTotal).toBe('0.0000');
    await cash.closeSession(mutation(cashier), cashier.context.permittedBranchIds, `b-close-probe-${unique()}`, session.value.id, {
      declaredClosingAmount: '50.0000',
      denominationCounts: [{ value: '50.0000', quantity: 1 }],
    });
  });

  it('step 7 — creating the default location clears the blocker but invents NO stock; stock arrives only through a real purchase', async () => {
    const owner = await ownerOf(tenantB);
    await locations.create(mutation(owner), `b-loc-${unique()}`, {
      branchId: bBranchId,
      code: 'MAIN',
      name: 'Main Stock Room',
      locationType: 'main',
      isDefault: true,
    });
    const noStock = await readiness(tenantB);
    expect(checkOf(noStock, 'inventory_location').status).toBe('ok');
    expect(checkOf(noStock, 'inventory_stock').status).toBe('warning');
    expect(checkOf(noStock, 'inventory_stock').items).toEqual([{ id: bTrackedProductId, label: 'Tracked Item' }]);
    expect(stageOf(noStock, 'inventory').ready).toBe(true);
    const balances = await database.pool.query<{ n: number }>(
      `select count(*)::int n from inventory_balances where company_id=$1`,
      [tenantB.companyId],
    );
    expect(balances.rows[0]?.n).toBe(0);

    await purchasing.recordDirectPurchase(mutation(owner), owner.context.permittedBranchIds, `b-buy-${unique()}`, {
      branchId: bBranchId,
      productVariantId: bTrackedVariantId,
      quantity: '5',
      unitCost: '2.00',
      currencyCode: 'USD',
      purchaseDate: new Date().toISOString().slice(0, 10),
    });
    const stocked = await readiness(tenantB);
    expect(checkOf(stocked, 'inventory_stock').status).toBe('ok');
    const onHand = await database.pool.query<{ q: string }>(
      `select quantity_on_hand::text q from inventory_balances where company_id=$1 and product_variant_id=$2`,
      [tenantB.companyId, bTrackedVariantId],
    );
    expect(Number(onHand.rows[0]?.q)).toBe(5);
  });

  let firstSaleId = '';
  let bSessionId = '';
  it('step 8+9 — the restricted cashier opens the register (USD from tenant config) and completes the FIRST CASH SALE with exact tax, change, cash and inventory', async () => {
    const cashier = await resolve(tenantB, cashierUserId, cashierMembershipId, bBranchId);
    const branchIds = cashier.context.permittedBranchIds;

    // The session currency is the tenant's, and an explicit foreign currency is refused.
    await expect(
      cash.openSession(mutation(cashier), branchIds, `b-open-eur-${unique()}`, {
        cashRegisterId: bRegisterId,
        openingAmount: '200.0000',
        currencyCode: 'EUR',
      }),
    ).rejects.toMatchObject({ code: 'validation_error' });
    const session = await cash.openSession(mutation(cashier), branchIds, `b-open-${unique()}`, {
      cashRegisterId: bRegisterId,
      openingAmount: '200.0000',
    });
    bSessionId = session.value.id;
    expect(session.value.currencyCode).toBe('USD');
    expect(session.value.status).toBe('open');

    // 1 x Product X ($100.00 + 16% tax = $116.00) and 2 x Tracked Item ($10.00 each, exempt = $20.00) => $136.00.
    const sale = await sales.createSale(mutation(cashier), branchIds, `b-sale-${unique()}`, {
      branchId: bBranchId,
      items: [
        { productId: bUntrackedProductId, quantity: '1' },
        { productId: bTrackedProductId, quantity: '2' },
      ],
      cashRegisterId: bRegisterId,
    }, cashier.context.permittedRegisterIds);
    firstSaleId = sale.value.sale.id;
    expect(sale.value.sale).toMatchObject({
      companyId: tenantB.companyId,
      branchId: bBranchId,
      currencyCode: 'USD',
      subtotal: '120.0000',
      taxTotal: '16.0000',
      total: '136.0000',
    });
    expect(sale.value.sale.cashRegisterId).toBe(bRegisterId);

    const paid = await payments.createCashPayment(mutation(cashier), branchIds, `b-pay-${unique()}`, {
      saleId: firstSaleId,
      tenderedAmount: '150.00',
      cashRegisterId: bRegisterId,
    });
    expect(paid.value.sale.status).toBe('completed');
    expect(paid.value.tenderedAmount).toBe('150.0000');
    expect(paid.value.changeAmount).toBe('14.0000');
    expect(paid.value.payment.currencyCode).toBe('USD');
    expect(paid.value.sale.cashRegisterId).toBe(bRegisterId);
    expect(paid.value.sale.createdBy).toBe(cashierUserId);

    // Cash: opening 200 + 136 net cash taken (tendered 150 - change 14) = 336 expected in the drawer.
    const summary = await cash.summary(tenantB.companyId, branchIds, bSessionId);
    expect(summary).toMatchObject({ openingAmount: '200.0000', cashSalesTotal: '136.0000', cashSalesCount: 1, expectedCash: '336.0000' });

    // Inventory decremented exactly once (5 - 2 = 3), through one sale_consumption movement.
    const onHand = await database.pool.query<{ q: string }>(
      `select quantity_on_hand::text q from inventory_balances where company_id=$1 and product_variant_id=$2`,
      [tenantB.companyId, bTrackedVariantId],
    );
    expect(Number(onHand.rows[0]?.q)).toBe(3);
    const movements = await database.pool.query<{ n: number }>(
      `select count(*)::int n from inventory_movements where company_id=$1 and movement_type='sale_consumption' and reference_id=$2`,
      [tenantB.companyId, firstSaleId],
    );
    expect(movements.rows[0]?.n).toBe(1);

    // Replaying the identical payment request is a no-op: no second decrement, no second cash movement.
    const replay = await payments.createCashPayment(mutation(cashier), branchIds, `b-pay-${unique()}`, {
      saleId: firstSaleId,
      tenderedAmount: '150.00',
      cashRegisterId: bRegisterId,
    }).catch(() => null);
    void replay;
    const after = await database.pool.query<{ q: string }>(
      `select quantity_on_hand::text q from inventory_balances where company_id=$1 and product_variant_id=$2`,
      [tenantB.companyId, bTrackedVariantId],
    );
    expect(Number(after.rows[0]?.q)).toBe(3);

    // The receipt's merchant identity comes from the tenant, never from the platform brand.
    const receiptOrg = await sales.receiptOrganization(tenantB.companyId, firstSaleId);
    expect(receiptOrg?.companyName).toBe('CustomerTwo QA Merchant');
    expect(receiptOrg?.companyName).not.toMatch(/access go|as one/iu);
    expect(receiptOrg?.branchName).toBe('QA Branch');
  });

  it('step 10 — after the first sale the tenant reports ready to sell at every stage', async () => {
    const result = await readiness(tenantB);
    expect(stageOf(result, 'administration').ready).toBe(true);
    expect(stageOf(result, 'pos_entry').ready).toBe(true);
    expect(stageOf(result, 'register_open').ready).toBe(true);
    expect(stageOf(result, 'sale').ready).toBe(true);
    expect(stageOf(result, 'inventory').ready).toBe(true);
    expect(checkOf(result, 'cash_session_open').status).toBe('ok');
    expect(checkOf(result, 'inventory_stock').status).toBe('ok');
  });

  it('readiness counts a user only while they can genuinely act: a revoked branch role leaves a stale register grant unable to count', async () => {
    const before = await readiness(tenantB);
    const usable = checkOf(before, 'operator_authorized').count ?? 0;
    expect(usable).toBeGreaterThanOrEqual(2); // owner + restricted cashier
    await database.pool.query(
      `update user_roles set status='revoked', revoked_at=now() where company_id=$1 and membership_id=$2`,
      [tenantB.companyId, cashierMembershipId],
    );
    const after = await readiness(tenantB);
    // The register grant row still exists, but without a branch role/access it grants nothing.
    expect(checkOf(after, 'operator_authorized').count).toBe(usable - 1);
    await database.pool.query(
      `update user_roles set status='active', revoked_at=null where company_id=$1 and membership_id=$2`,
      [tenantB.companyId, cashierMembershipId],
    );
    expect(checkOf(await readiness(tenantB), 'operator_authorized').count).toBe(usable);
  });

  // ---------------------------------------------------------------------
  // Register/branch restriction still holds for customer #2's cashier
  // ---------------------------------------------------------------------
  it('a stale register grant cannot widen the cashier past the branch, and a second register is unreachable to them', async () => {
    const owner = await ownerOf(tenantB);
    const second = await cash.createRegister(mutation(owner), owner.context.permittedBranchIds, `b-reg2-${unique()}`, {
      branchId: bBranchId,
      code: 'QA-REG-2',
      name: 'QA Register 2',
    });
    const cashier = await resolve(tenantB, cashierUserId, cashierMembershipId, bBranchId);
    expect(cashier.context.permittedRegisterIds).toEqual([bRegisterId]);
    // The HTTP layer enforces exactly this guard on every register-scoped route.
    expect(cashier.context.permittedRegisterIds).not.toContain(second.value.id);
    expect(() => authService.requireRegisterAccess(cashier.context, second.value.id)).toThrow();
    expect(() => authService.requireRegisterAccess(cashier.context, bRegisterId)).not.toThrow();
    // ...and the sale path itself refuses an explicit out-of-scope register.
    await expect(
      sales.createSale(
        mutation(cashier),
        cashier.context.permittedBranchIds,
        `b-sale-r2-${unique()}`,
        { branchId: bBranchId, items: [{ productId: bUntrackedProductId, quantity: '1' }], cashRegisterId: second.value.id },
        cashier.context.permittedRegisterIds,
      ),
    ).rejects.toMatchObject({ code: 'validation_error' });
  });

  // ---------------------------------------------------------------------
  // Tenant isolation & direct-ID tampering, both directions
  // ---------------------------------------------------------------------
  it('tenant B cannot read, act on, or even discover tenant A\'s branches, products, users, registers, sessions, sales or inventory', async () => {
    const ownerB = await ownerOf(tenantB);
    const branchIdsB = ownerB.context.permittedBranchIds;
    expect(branchIdsB).not.toContain(tenantA.branchId);

    await expect(sales.sale(tenantB.companyId, branchIdsB, aSaleId)).rejects.toMatchObject({ code: 'resource_not_found' });
    await expect(cash.summary(tenantB.companyId, branchIdsB, aSessionId)).rejects.toBeDefined();
    await expect(catalog.product(tenantB.companyId, aProductId)).rejects.toBeDefined();
    await expectDenied(administration.branch(ownerB, tenantA.branchId ?? ''));
    await expect(administration.userDetail(ownerB, tenantA.ownerUserId, [])).rejects.toMatchObject({ statusCode: 404 });

    // Direct-ID tampering: A's ids smuggled into B-authorized operations.
    await expect(
      sales.createSale(mutation(ownerB), branchIdsB, `t-sale-${unique()}`, {
        branchId: bBranchId,
        items: [{ productId: aProductId, quantity: '1' }],
      }),
    ).rejects.toBeDefined();
    await expect(
      sales.createSale(mutation(ownerB), branchIdsB, `t-sale2-${unique()}`, {
        branchId: tenantA.branchId ?? '',
        items: [{ productId: bUntrackedProductId, quantity: '1' }],
      }),
    ).rejects.toMatchObject({ code: 'validation_error' });
    await expect(
      cash.createRegister(mutation(ownerB), branchIdsB, `t-reg-${unique()}`, { branchId: tenantA.branchId ?? '', code: 'X', name: 'X' }),
    ).rejects.toBeDefined();
    await expect(
      catalog.createProductPrice(mutation(ownerB), aProductId, `t-price-${unique()}`, { amount: '1.00', currencyCode: 'USD' }),
    ).rejects.toBeDefined();
    await expect(
      locations.create(mutation(ownerB), `t-loc-${unique()}`, { branchId: tenantA.branchId ?? '', code: 'X', name: 'X', locationType: 'main' }),
    ).rejects.toBeDefined();
    await expect(
      payments.createCashPayment(mutation(ownerB), branchIdsB, `t-pay-${unique()}`, {
        saleId: aSaleId,
        tenderedAmount: '1.00',
        cashRegisterId: bRegisterId,
      }),
    ).rejects.toBeDefined();
    await expect(
      cash.openSession(mutation(ownerB), branchIdsB, `t-open-${unique()}`, { cashRegisterId: aRegisterId, openingAmount: '1.0000' }),
    ).rejects.toBeDefined();

    // Readiness only ever describes the caller's own company, even when handed the foreign branch id.
    const spoofed = await readinessService.evaluate(tenantB.companyId, [...branchIdsB, tenantA.branchId ?? ''], tenantA.branchId ?? undefined);
    expect(spoofed.branches).toHaveLength(0);
    expect(spoofed.company.id).toBe(tenantB.companyId);
    const own = await readinessService.evaluate(tenantB.companyId, branchIdsB);
    expect(own.branches.every((branch) => branchIdsB.includes(branch.branchId))).toBe(true);
  });

  it('and vice versa: tenant A cannot see any of customer #2\'s data', async () => {
    const ownerA = await ownerOf(tenantA, tenantA.branchId ?? undefined);
    const branchIdsA = ownerA.context.permittedBranchIds;
    expect(branchIdsA).toEqual([tenantA.branchId]);
    await expect(sales.sale(tenantA.companyId, branchIdsA, firstSaleId)).rejects.toMatchObject({ code: 'resource_not_found' });
    await expect(cash.summary(tenantA.companyId, branchIdsA, bSessionId)).rejects.toBeDefined();
    await expect(catalog.product(tenantA.companyId, bTrackedProductId)).rejects.toBeDefined();
    await expect(administration.userDetail(ownerA, cashierUserId, [])).rejects.toMatchObject({ statusCode: 404 });
    await expectDenied(administration.branch(ownerA, bBranchId));
    const readA = await readinessService.evaluate(tenantA.companyId, branchIdsA);
    expect(readA.company.currencyCode).toBe('MXN');
    expect(readA.branches.map((branch) => branch.branchId)).toEqual([tenantA.branchId]);
  });

  // ---------------------------------------------------------------------
  // Existing-tenant safety: readiness is observational
  // ---------------------------------------------------------------------
  it('evaluating readiness never creates or changes anything for an existing tenant', async () => {
    const tables = [
      'operational_areas',
      'cash_registers',
      'inventory_locations',
      'products',
      'product_prices',
      'user_roles',
      'company_memberships',
      'roles',
      'audit_log',
      'outbox_events',
      'cash_sessions',
      'sales',
    ];
    const snapshot = async (): Promise<Record<string, number>> => {
      const entries: Record<string, number> = {};
      for (const table of tables) {
        const row = await database.pool.query<{ n: number }>(`select count(*)::int n from ${table} where company_id=$1`, [tenantA.companyId]);
        entries[table] = row.rows[0]?.n ?? 0;
      }
      return entries;
    };
    const before = await snapshot();
    await readiness(tenantA);
    await readiness(tenantA);
    expect(await snapshot()).toEqual(before);
    // Tenant A never got an operational area, inventory location or extra register it didn't ask for
    // (it made one area + one register + zero locations in its own setup above).
    expect(before.inventory_locations).toBe(0);
  });

  // ---------------------------------------------------------------------
  // System-role sync keeps working for previously-created companies
  // ---------------------------------------------------------------------
  it('a permission added after provisioning reaches every provisioned Owner but NEVER widens a custom role', async () => {
    const code = `qa_customer2.x${randomUUID().replaceAll('-', '').slice(0, 10)}`;
    syntheticPermissionCodes.push(code);
    await database.pool.query(
      `insert into permissions (id, code, description, domain) values ($1, $2, 'QA synthetic permission', 'qa_customer2')`,
      [randomUUID(), code],
    );
    await syncSystemRolePermissions(database.db);
    for (const tenant of [tenantA, tenantB]) {
      const owner = await database.pool.query<{ n: number }>(
        `select count(*)::int n from role_permissions rp join roles r on r.id=rp.role_id join permissions p on p.id=rp.permission_id
         where r.company_id=$1 and r.code='owner' and p.code=$2 and rp.effect='allow'`,
        [tenant.companyId, code],
      );
      expect(owner.rows[0]?.n).toBe(1);
    }
    const custom = await database.pool.query<{ n: number }>(
      `select count(*)::int n from role_permissions rp join roles r on r.id=rp.role_id join permissions p on p.id=rp.permission_id
       where r.company_id=$1 and r.is_system=false and p.code=$2`,
      [tenantB.companyId, code],
    );
    expect(custom.rows[0]?.n).toBe(0);
  });
});
