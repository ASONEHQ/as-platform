import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createDatabaseClient, seedTechnicalPermissions, type DatabaseClient } from '@asone/database';

import { verifyPassword } from '../modules/auth/auth.passwords.js';
import { ProductionOwnerProvisioner } from '../provisioning/production-owner.service.js';
import { BusinessConfigInputError } from './business-config.types.js';
import { BusinessConfigProvisioner } from './business-config.service.js';
import type { LaunchConfig } from './business-config.types.js';

/**
 * TASK 14.2 Part D.12 — automated tests for the launch-config-driven
 * business-configuration tool, mirroring `../provisioning/
 * production-owner.integration.test.ts`'s own structure exactly:
 * exercises the real service against real Postgres (never a mock), one
 * UNIQUE randomly-suffixed company per test (never the literal
 * `inflapark-group`) so this never collides with real seed data or other
 * concurrent test runs sharing `asone_test`.
 */
const databaseUrl = process.env.DATABASE_TEST_URL;
const integration = databaseUrl === undefined ? describe.skip : describe;

const STRONG_PASSWORD = 'Correct-Horse-Battery-42!';

integration('PostgreSQL business-config provisioning (TASK 14.2)', () => {
  let database: DatabaseClient;
  let owner: ProductionOwnerProvisioner;
  let provisioner: BusinessConfigProvisioner;

  beforeAll(() => {
    if (databaseUrl === undefined || !new URL(databaseUrl).pathname.toLowerCase().includes('test'))
      throw new Error('DATABASE_TEST_URL must identify a dedicated test database.');
    database = createDatabaseClient({
      applicationName: 'asone-business-config-provisioning-integration',
      connectionString: databaseUrl,
    });
    owner = new ProductionOwnerProvisioner(database);
    provisioner = new BusinessConfigProvisioner(database);
  });

  beforeEach(async () => {
    await database.pool.query('truncate table companies,users,permissions cascade');
    await seedTechnicalPermissions(database.db);
  });

  afterAll(async () => database.close());

  function uniqueSlug(label: string): string {
    return `${label}-${Date.now().toString()}-${Math.random().toString(36).slice(2, 8)}`;
  }

  async function createCompanyWithOwner(slug: string): Promise<void> {
    await owner.run({
      companyLegalName: `${slug} S.A. de C.V.`,
      companySlug: slug,
      ownerDisplayName: 'Dueña de Prueba',
      ownerEmail: `owner-${slug}@example.test`,
      ownerPassword: STRONG_PASSWORD,
    });
  }

  function baseConfig(slug: string, overrides: Partial<LaunchConfig> = {}): LaunchConfig {
    return {
      company: {
        legal_name: `${slug} S.A. de C.V.`,
        display_name: slug,
        slug,
        timezone: 'America/Mexico_City',
        currency_code: 'MXN',
        locale: 'es-MX',
      },
      branches: [{ name: 'Sucursal Norte', code: 'NORTE', timezone: 'America/Mexico_City' }],
      registers: [{ branch_code: 'NORTE', code: 'CAJA-1', name: 'Caja 1' }],
      roles: [
        {
          code: 'cashier',
          name: 'Cajero',
          permissions: [
            'catalog.read',
            'inventory.read',
            'cash_register.read',
            'cash_session.open',
            'cash_session.read',
            'cash_movement.create',
            'cash_session.close',
            'sale.create',
            'sale.read',
            'payment.create',
            'customer.read',
            'customer.create',
          ],
        },
      ],
      users: [
        {
          display_name: 'Carla Cajera',
          email: `carla-${slug}@example.test`,
          role_code: 'cashier',
          branch_code: 'NORTE',
        },
      ],
      categories: [{ code: 'BEBIDAS', name: 'Bebidas', sort_order: 0 }],
      products: [
        {
          code: 'AGUA-500',
          sku: 'AGUA-500',
          name: 'Agua 500ml',
          category_code: 'BEBIDAS',
          product_type: 'simple',
          tracks_inventory: true,
          tax_code: 'IVA_GENERAL',
          status: 'active',
          unit_price: '20.00',
          unit_price_is_confirmed_final: false,
        },
        {
          code: 'ENTRADA-GEN',
          sku: 'ENTRADA-GEN',
          name: 'Entrada general',
          category_code: 'BEBIDAS',
          product_type: 'simple',
          tracks_inventory: false,
          tax_code: 'IVA_GENERAL',
          status: 'active',
          unit_price: '100.00',
          unit_price_is_confirmed_final: false,
        },
      ],
      inventory_opening_balances: [{ product_code: 'AGUA-500', branch_code: 'NORTE', quantity: '25' }],
      rewards: {
        enabled: false,
        program_name: 'Sellos Test',
        unit_type: 'stamp',
        earn_quantity_per_sale: 1,
        reward_threshold: 5,
        reward_type: 'vip_pass',
        reward_benefit_type: 'free_eligible_item',
        reward_benefit_scope_product_codes: ['ENTRADA-GEN'],
      },
      promotions: [],
      ...overrides,
    };
  }

  async function countRows(table: string, companyId: string): Promise<number> {
    const result = await database.pool.query<{ count: string }>(
      `select count(*)::text as count from ${table} where company_id=$1`,
      [companyId],
    );
    return Number(result.rows[0]?.count ?? '0');
  }

  it('fails clearly when the company does not exist yet (before any lookup or write)', async () => {
    const config = baseConfig(uniqueSlug('never-provisioned'));
    await expect(provisioner.run(config, { dryRun: false })).rejects.toThrow(/was not found/u);
    await expect(provisioner.run(config, { dryRun: false })).rejects.toBeInstanceOf(BusinessConfigInputError);
  });

  it('dry run resolves and validates everything but writes nothing', async () => {
    const slug = uniqueSlug('dry-run-co');
    await createCompanyWithOwner(slug);
    const config = baseConfig(slug);

    const summary = await provisioner.run(config, { dryRun: true });
    expect(summary.dryRun).toBe(true);
    expect(summary.branches).toMatchObject({ created: 1, existing: 0 });
    expect(summary.roles).toMatchObject({ created: 1, existing: 0 });
    expect(summary.users).toMatchObject({ created: 1, existing: 0 });
    expect(summary.categories).toMatchObject({ created: 1, existing: 0 });
    expect(summary.products).toMatchObject({ created: 2, existing: 0 });
    expect(summary.rewardsProgram).toBe('skipped_disabled');

    const [company] = await database.pool
      .query<{ id: string }>('select id from companies where slug=$1', [slug])
      .then((result) => result.rows);
    const companyId = company?.id;
    expect(companyId).toBeDefined();
    if (companyId === undefined) throw new Error('unreachable');
    expect(await countRows('branches', companyId)).toBe(0);
    expect(await countRows('product_categories', companyId)).toBe(0);
    expect(await countRows('products', companyId)).toBe(0);
    expect(await countRows('cash_registers', companyId)).toBe(0);
    const roleCount = await database.pool
      .query<{ count: string }>("select count(*)::text as count from roles where company_id=$1 and code='cashier'", [
        companyId,
      ])
      .then((result) => Number(result.rows[0]?.count ?? '0'));
    expect(roleCount).toBe(0);
  });

  it('applies a fresh launch config end to end, then a rerun creates nothing new (idempotent)', async () => {
    const slug = uniqueSlug('fresh-apply-co');
    await createCompanyWithOwner(slug);
    const config = baseConfig(slug);

    const firstSummary = await provisioner.run(config, {
      dryRun: false,
      resolveUserPassword: () => Promise.resolve(STRONG_PASSWORD),
    });
    expect(firstSummary.branches).toMatchObject({ created: 1, existing: 0 });
    expect(firstSummary.registers).toMatchObject({ created: 1, existing: 0 });
    expect(firstSummary.roles).toMatchObject({ created: 1, existing: 0 });
    expect(firstSummary.users).toMatchObject({ created: 1, existing: 0 });
    expect(firstSummary.categories).toMatchObject({ created: 1, existing: 0 });
    expect(firstSummary.products).toMatchObject({ created: 2, existing: 0, conflicts: [] });
    expect(firstSummary.prices).toMatchObject({ created: 2, existing: 0 });
    expect(firstSummary.inventoryLocations).toMatchObject({ created: 1, existing: 0 });
    expect(firstSummary.inventoryOpeningBalances).toMatchObject({ created: 1, existing: 0 });
    expect(firstSummary.rewardsProgram).toBe('skipped_disabled');

    const companyId = firstSummary.companyId;

    // Real rows exist, with real content — not just a summary count.
    const [branch] = await database.pool
      .query<{ code: string; timezone: string }>('select code, timezone from branches where company_id=$1', [companyId])
      .then((result) => result.rows);
    expect(branch).toMatchObject({ code: 'NORTE' });

    const [register] = await database.pool
      .query<{ code: string }>('select code from cash_registers where company_id=$1', [companyId])
      .then((result) => result.rows);
    expect(register?.code).toBe('CAJA-1');

    const [role] = await database.pool
      .query<{ id: string }>("select id from roles where company_id=$1 and code='cashier'", [companyId])
      .then((result) => result.rows);
    expect(role).toBeDefined();
    const permissionCount = await database.pool
      .query<{ count: string }>('select count(*)::text as count from role_permissions where company_id=$1 and role_id=$2', [
        companyId,
        role?.id,
      ])
      .then((result) => Number(result.rows[0]?.count ?? '0'));
    expect(permissionCount).toBe(12);

    const [user] = await database.pool
      .query<{ id: string; status: string; password_hash: string }>(
        'select id, status, password_hash from users where normalized_email=$1',
        [`carla-${slug}@example.test`],
      )
      .then((result) => result.rows);
    expect(user?.status).toBe('active');
    expect(await verifyPassword(user?.password_hash ?? '', STRONG_PASSWORD)).toBe(true);
    const userRoleCount = await database.pool
      .query<{ count: string }>('select count(*)::text as count from user_roles where company_id=$1 and membership_id in (select id from company_memberships where user_id=$2)', [
        companyId,
        user?.id,
      ])
      .then((result) => Number(result.rows[0]?.count ?? '0'));
    expect(userRoleCount).toBe(1);

    expect(await countRows('products', companyId)).toBe(2);
    const priceCount = await database.pool
      .query<{ count: string }>('select count(*)::text as count from product_prices where company_id=$1', [companyId])
      .then((result) => Number(result.rows[0]?.count ?? '0'));
    expect(priceCount).toBe(2);

    const [movement] = await database.pool
      .query<{ status: string }>("select status from inventory_movements where company_id=$1 and movement_type='opening_balance'", [
        companyId,
      ])
      .then((result) => result.rows);
    expect(movement?.status).toBe('posted');

    // --- Rerun: a password resolver that throws proves it's never
    // invoked (the one user already exists and must be skipped, never
    // recreated/reassigned).
    const secondSummary = await provisioner.run(config, {
      dryRun: false,
      resolveUserPassword: () => {
        throw new Error('resolveUserPassword must not be called for an already-existing user.');
      },
    });
    expect(secondSummary.branches).toMatchObject({ created: 0, existing: 1 });
    expect(secondSummary.registers).toMatchObject({ created: 0, existing: 1 });
    expect(secondSummary.roles).toMatchObject({ created: 0, existing: 1 });
    expect(secondSummary.users).toMatchObject({ created: 0, existing: 1 });
    expect(secondSummary.categories).toMatchObject({ created: 0, existing: 1 });
    expect(secondSummary.products).toMatchObject({ created: 0, existing: 2, conflicts: [] });
    expect(secondSummary.prices).toMatchObject({ created: 0, existing: 2 });
    expect(secondSummary.inventoryLocations).toMatchObject({ created: 0, existing: 1 });
    expect(secondSummary.inventoryOpeningBalances).toMatchObject({ created: 0, existing: 1 });

    // No duplicate rows anywhere.
    expect(await countRows('branches', companyId)).toBe(1);
    expect(await countRows('cash_registers', companyId)).toBe(1);
    expect(await countRows('product_categories', companyId)).toBe(1);
    expect(await countRows('products', companyId)).toBe(2);
    const priceCountAfter = await database.pool
      .query<{ count: string }>('select count(*)::text as count from product_prices where company_id=$1', [companyId])
      .then((result) => Number(result.rows[0]?.count ?? '0'));
    expect(priceCountAfter).toBe(2);
    const userCountAfter = await database.pool
      .query<{ count: string }>('select count(*)::text as count from users where normalized_email=$1', [
        `carla-${slug}@example.test`,
      ])
      .then((result) => Number(result.rows[0]?.count ?? '0'));
    expect(userCountAfter).toBe(1);
  });

  it('reports (and skips, never overwrites) a product code reused under a different category', async () => {
    const slug = uniqueSlug('conflict-co');
    await createCompanyWithOwner(slug);
    const config = baseConfig(slug, { users: [], inventory_opening_balances: [] });
    await provisioner.run(config, { dryRun: false });

    const conflicting = baseConfig(slug, {
      users: [],
      inventory_opening_balances: [],
      categories: [
        { code: 'BEBIDAS', name: 'Bebidas', sort_order: 0 },
        { code: 'OTRA', name: 'Otra categoría', sort_order: 1 },
      ],
      products: [
        {
          code: 'AGUA-500',
          sku: 'AGUA-500',
          name: 'Agua 500ml',
          category_code: 'OTRA',
          product_type: 'simple',
          tracks_inventory: true,
          tax_code: 'IVA_GENERAL',
          status: 'active',
          unit_price: '20.00',
          unit_price_is_confirmed_final: false,
        },
      ],
    });
    const summary = await provisioner.run(conflicting, { dryRun: false });
    expect(summary.products.conflicts).toHaveLength(1);
    expect(summary.products.conflicts[0]).toMatch(/different category/u);

    const [product] = await database.pool
      .query<{ category_id: string }>('select category_id from products where company_id=$1 and normalized_code=$2', [
        summary.companyId,
        'agua-500',
      ])
      .then((result) => result.rows);
    const [originalCategory] = await database.pool
      .query<{ id: string }>("select id from product_categories where company_id=$1 and code='BEBIDAS'", [
        summary.companyId,
      ])
      .then((result) => result.rows);
    expect(product?.category_id).toBe(originalCategory?.id);
  });

  it('skips an already-existing user by normalized email, never reassigning their role', async () => {
    const slug = uniqueSlug('existing-user-co');
    await createCompanyWithOwner(slug);
    const config = baseConfig(slug, { inventory_opening_balances: [] });

    const preExistingEmail = `carla-${slug}@example.test`;
    const insertedUserId = randomUUID();
    await database.pool.query(
      `insert into users (id,email,normalized_email,display_name,status,password_hash) values ($1,$2,lower($2),$3,'active',$4)`,
      [insertedUserId, preExistingEmail, 'Alguien Más', 'not-a-real-hash-but-long-enough-for-the-check-constraint'],
    );

    const summary = await provisioner.run(config, {
      dryRun: false,
      resolveUserPassword: () => {
        throw new Error('resolveUserPassword must not be called for an already-existing user.');
      },
    });
    expect(summary.users).toMatchObject({ created: 0, existing: 1 });

    const userRoleCount = await database.pool
      .query<{ count: string }>('select count(*)::text as count from user_roles where company_id=$1', [summary.companyId])
      .then((result) => Number(result.rows[0]?.count ?? '0'));
    // Only the pre-existing owner's own role assignment (from
    // production-owner provisioning) — never one for the pre-existing
    // "Alguien Más" identity, which this tool must never touch.
    expect(userRoleCount).toBe(1);
    const [stillUnchanged] = await database.pool
      .query<{ display_name: string }>('select display_name from users where id=$1', [insertedUserId])
      .then((result) => result.rows);
    expect(stillUnchanged?.display_name).toBe('Alguien Más');
  });

  it('refuses when the permission catalogue is empty, before writing anything', async () => {
    const slug = uniqueSlug('no-permissions-co');
    await createCompanyWithOwner(slug);
    await database.pool.query('delete from role_permissions');
    await database.pool.query('delete from permissions');
    const config = baseConfig(slug);
    await expect(provisioner.run(config, { dryRun: false })).rejects.toThrow(/permission catalogue is empty/u);
  });
});
