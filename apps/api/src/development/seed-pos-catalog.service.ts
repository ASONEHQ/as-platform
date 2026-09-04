import { randomUUID } from 'node:crypto';

import type { DatabaseClient } from '@asone/database';

import { CatalogRepository } from '../modules/catalog/catalog.repository.js';
import { CatalogService } from '../modules/catalog/catalog.service.js';
import { ProductCatalogRepository } from '../modules/catalog/product-catalog.repository.js';
import { ProductCatalogService } from '../modules/catalog/product-catalog.service.js';
import type { ProductTaxCode } from '../modules/catalog/product-catalog.types.js';
import { InventoryDraftRepository } from '../modules/inventory/inventory-drafts.repository.js';
import { InventoryDraftService } from '../modules/inventory/inventory-drafts.service.js';
import { InventoryPostingRepository } from '../modules/inventory/inventory-posting.repository.js';
import { InventoryPostingService } from '../modules/inventory/inventory-posting.service.js';
import { InventoryLocationRepository } from '../modules/inventory/inventory.repository.js';
import { InventoryLocationService } from '../modules/inventory/inventory.service.js';

/**
 * TASK 12.3C: development-only POS catalog fixture.
 *
 * This seed is exclusively for local/CI development and must stay
 * completely isolated from production: it targets only the `inflapark-group`
 * development company created by `dev:bootstrap-owner`
 * (see bootstrap-owner.service.ts) by natural key (slug), it never creates
 * that company itself, and `validateSeedEnvironment` refuses to run against
 * anything but a loopback, allowlisted-by-name development or test
 * database (mirroring bootstrap-owner.service.ts's own guard). Real
 * companies create and manage their own products, categories, prices, and
 * inventory from the administration module — this command is never invoked
 * automatically and never iterates any company other than the one resolved
 * by this fixed slug.
 *
 * Every entity is created through the real, already-tested catalog/inventory
 * services (`CatalogService`, `ProductCatalogService`,
 * `InventoryLocationService`, `InventoryDraftService`,
 * `InventoryPostingService`) with a deterministic idempotency key per
 * natural key — never raw inserts — so re-running this command is always
 * safe: each call replays its prior result instead of duplicating or
 * erroring, and every invariant those services already enforce (money
 * precision, tenant isolation, audit/outbox, the inventory ledger) applies
 * here exactly as it would to a real API caller.
 */

const companySlug = 'inflapark-group';
const ownerEmail = 'ceo@inflapark.local';
const keyPrefix = 'pos-catalog-seed';

/** Every stock-tracked product gets this many units on hand per branch —
 * an arbitrary but documented dev-fixture quantity, not a real count. */
const openingBalanceQuantity = '50';
const openingBalanceReasonCode = 'dev_seed_initial_stock';
/**
 * Fixed, arbitrary point in the past used as the effective-price
 * `valid_from` and the opening-balance movement's `occurred_at`. Both
 * fields default to the mutation context's timestamp when omitted, and
 * that context timestamp is `new Date()` at the moment this command runs —
 * which would make the request hash behind each operation's idempotency
 * key different on every invocation and break replay. Passing this fixed
 * epoch explicitly keeps every re-run's request hash identical, which is
 * what makes the seed idempotent.
 */
const seedEpoch = new Date('2020-01-01T00:00:00.000Z');

interface CategoryDefinition {
  readonly code: string;
  readonly name: string;
  readonly sortOrder: number;
}

/**
 * TASK 12.3C tax rule: `IVA_GENERAL` (16%) is assigned deliberately per
 * product after checking Mexican IVA treatment, not copied from the
 * Flutter prototype's blanket constant. Every item in this fixture —
 * admissions, packages, attractions, bottled retail goods, memberships,
 * and locker rental — is a standard-rated good or service; none qualifies
 * for the `IVA_EXEMPT` treatment reserved for unprocessed staple foods, so
 * none is marked exempt here. The exemption code path still exists end to
 * end (schema, API, Flutter) for the day a real merchant's catalog needs
 * it.
 */
interface ProductDefinition {
  readonly code: string;
  readonly name: string;
  readonly categoryCode: string;
  readonly sku: string;
  readonly tracksInventory: boolean;
  readonly taxCode: ProductTaxCode;
  /** Decimal string, MXN, company-wide (no branch override is seeded). */
  readonly price: string;
  /** Decimal string; `'0'` for non-physical admissions/services, since
   * standard_cost models cost of goods and these have none. */
  readonly standardCost: string;
}

const categoryDefinitions: readonly CategoryDefinition[] = Object.freeze([
  { code: 'ENTRADAS', name: 'Entradas', sortOrder: 0 },
  { code: 'PAQUETES', name: 'Paquetes', sortOrder: 1 },
  { code: 'ATRACCIONES', name: 'Atracciones', sortOrder: 2 },
  { code: 'TIENDA', name: 'Tienda', sortOrder: 3 },
  { code: 'MEMBRESIAS', name: 'Membresías', sortOrder: 4 },
  { code: 'EXTRAS', name: 'Extras', sortOrder: 5 },
]);

const productDefinitions: readonly ProductDefinition[] = Object.freeze([
  {
    code: 'ENT-90MIN',
    name: 'Entrada 90 minutos',
    categoryCode: 'ENTRADAS',
    sku: 'ENT-90MIN',
    tracksInventory: false,
    taxCode: 'IVA_GENERAL',
    price: '149.00',
    standardCost: '0',
  },
  {
    code: 'ENT-DAYPASS',
    name: 'Day Pass',
    categoryCode: 'ENTRADAS',
    sku: 'ENT-DAYPASS',
    tracksInventory: false,
    taxCode: 'IVA_GENERAL',
    price: '279.00',
    standardCost: '0',
  },
  {
    code: 'PAQ-FAM2',
    name: 'Family Pack 2 personas',
    categoryCode: 'PAQUETES',
    sku: 'PAQ-FAM2',
    tracksInventory: false,
    taxCode: 'IVA_GENERAL',
    price: '269.00',
    standardCost: '0',
  },
  {
    code: 'PAQ-FAM4',
    name: 'Family Pack 4 personas',
    categoryCode: 'PAQUETES',
    sku: 'PAQ-FAM4',
    tracksInventory: false,
    taxCode: 'IVA_GENERAL',
    price: '499.00',
    standardCost: '0',
  },
  {
    code: 'ATR-GARRA',
    name: 'Garra humana',
    categoryCode: 'ATRACCIONES',
    sku: 'ATR-GARRA',
    tracksInventory: false,
    taxCode: 'IVA_GENERAL',
    price: '59.00',
    standardCost: '0',
  },
  {
    code: 'TDA-CALCETAS',
    name: 'Calcetas antiderrapantes',
    categoryCode: 'TIENDA',
    sku: 'TDA-CALCETAS',
    tracksInventory: true,
    taxCode: 'IVA_GENERAL',
    price: '65.00',
    standardCost: '30.00',
  },
  {
    code: 'TDA-AGUA',
    name: 'Agua',
    categoryCode: 'TIENDA',
    sku: 'TDA-AGUA',
    tracksInventory: true,
    taxCode: 'IVA_GENERAL',
    price: '25.00',
    standardCost: '10.00',
  },
  {
    code: 'TDA-REFRESCO',
    name: 'Refresco',
    categoryCode: 'TIENDA',
    sku: 'TDA-REFRESCO',
    tracksInventory: true,
    taxCode: 'IVA_GENERAL',
    price: '30.00',
    standardCost: '14.00',
  },
  {
    code: 'MEM-MENSUAL',
    name: 'Membresía mensual',
    categoryCode: 'MEMBRESIAS',
    sku: 'MEM-MENSUAL',
    tracksInventory: false,
    taxCode: 'IVA_GENERAL',
    price: '899.00',
    standardCost: '0',
  },
  {
    code: 'EXT-LOCKER',
    name: 'Locker',
    categoryCode: 'EXTRAS',
    sku: 'EXT-LOCKER',
    tracksInventory: false,
    taxCode: 'IVA_GENERAL',
    price: '49.00',
    standardCost: '0',
  },
]);

export interface SeedEnvironment {
  readonly NODE_ENV?: string | undefined;
  readonly DATABASE_URL?: string | undefined;
}

export class PosCatalogSeedError extends Error {}

/** Mirrors bootstrap-owner.service.ts's `validateBootstrapEnvironment`
 * guard (development/test only, loopback host, allowlisted database name)
 * minus the password check — this seed creates no credentials. */
export function validateSeedEnvironment(environment: SeedEnvironment): { databaseUrl: string } {
  const nodeEnvironment = environment.NODE_ENV;
  if (nodeEnvironment !== 'development' && nodeEnvironment !== 'test')
    throw new PosCatalogSeedError(
      'The POS catalog dev seed requires an explicit development or test environment.',
    );
  const rawDatabaseUrl = environment.DATABASE_URL;
  if (rawDatabaseUrl === undefined) throw new PosCatalogSeedError('DATABASE_URL is required.');
  let databaseUrl: URL;
  try {
    databaseUrl = new URL(rawDatabaseUrl);
  } catch {
    throw new PosCatalogSeedError('DATABASE_URL must be a valid PostgreSQL URL.');
  }
  if (
    !['postgres:', 'postgresql:'].includes(databaseUrl.protocol) ||
    !['127.0.0.1', 'localhost'].includes(databaseUrl.hostname)
  )
    throw new PosCatalogSeedError('The POS catalog dev seed requires a loopback PostgreSQL target.');
  const databaseName = decodeURIComponent(databaseUrl.pathname.slice(1));
  const allowed =
    nodeEnvironment === 'development'
      ? databaseName === 'asone_local'
      : /^asone_[a-z0-9_]*test[a-z0-9_]*$/u.test(databaseName);
  if (!allowed)
    throw new PosCatalogSeedError('Database target is not allowlisted for the POS catalog dev seed.');
  return { databaseUrl: rawDatabaseUrl };
}

interface CountSummary {
  readonly created: number;
  readonly existing: number;
}

export interface PosCatalogSeedSummary {
  readonly company: 'inflapark-group';
  readonly branches: number;
  readonly categories: CountSummary;
  readonly products: CountSummary;
  readonly variants: CountSummary;
  readonly prices: CountSummary;
  readonly inventoryLocations: CountSummary;
  readonly inventoryBalances: CountSummary;
  readonly success: true;
}

export class PosCatalogSeed {
  private readonly catalog: CatalogService;
  private readonly products: ProductCatalogService;
  private readonly locations: InventoryLocationService;
  private readonly drafts: InventoryDraftService;
  private readonly posting: InventoryPostingService;

  public constructor(private readonly database: DatabaseClient) {
    this.catalog = new CatalogService(new CatalogRepository(database));
    this.products = new ProductCatalogService(new ProductCatalogRepository(database));
    this.locations = new InventoryLocationService(new InventoryLocationRepository(database));
    this.drafts = new InventoryDraftService(new InventoryDraftRepository(database));
    this.posting = new InventoryPostingService(new InventoryPostingRepository(database));
  }

  public async run(): Promise<PosCatalogSeedSummary> {
    const companyRow = await this.database.pool.query<{ id: string }>(
      `select id from companies where slug=$1`,
      [companySlug],
    );
    const companyId = companyRow.rows[0]?.id;
    if (companyId === undefined)
      throw new PosCatalogSeedError(
        `Company "${companySlug}" was not found. Run "pnpm --filter @asone/api dev:bootstrap-owner" first.`,
      );
    const ownerRow = await this.database.pool.query<{ id: string }>(
      `select id from users where normalized_email=$1`,
      [ownerEmail],
    );
    const actorId = ownerRow.rows[0]?.id;
    if (actorId === undefined)
      throw new PosCatalogSeedError(
        `Owner user "${ownerEmail}" was not found. Run "pnpm --filter @asone/api dev:bootstrap-owner" first.`,
      );
    const branchRows = await this.database.pool.query<{ id: string; code: string; name: string }>(
      `select id,code,name from branches where company_id=$1 and status='active' order by code`,
      [companyId],
    );
    if (branchRows.rows.length === 0)
      throw new PosCatalogSeedError(
        `No active branches were found for "${companySlug}". Run "pnpm --filter @asone/api dev:bootstrap-owner" first.`,
      );

    const context = {
      companyId,
      actorId,
      requestId: `${keyPrefix}-${randomUUID()}`,
      correlationId: `${keyPrefix}-${randomUUID()}`,
      timestamp: new Date(),
    };

    const categories = { created: 0, existing: 0 };
    const categoryIds = new Map<string, string>();
    for (const definition of categoryDefinitions) {
      const result = await this.catalog.createCategory(
        context,
        `${keyPrefix}:category:${definition.code}`,
        { code: definition.code, name: definition.name, sortOrder: definition.sortOrder },
      );
      categoryIds.set(definition.code, result.value.id);
      if (result.replayed) categories.existing += 1;
      else categories.created += 1;
    }

    const products = { created: 0, existing: 0 };
    const variants = { created: 0, existing: 0 };
    const prices = { created: 0, existing: 0 };
    const productIds = new Map<string, string>();
    const variantIds = new Map<string, string>();
    for (const definition of productDefinitions) {
      const categoryId = categoryIds.get(definition.categoryCode);
      if (categoryId === undefined)
        throw new PosCatalogSeedError(
          `Category "${definition.categoryCode}" was not resolved before product seeding.`,
        );
      const productResult = await this.products.createProduct(
        context,
        `${keyPrefix}:product:${definition.code}`,
        {
          code: definition.code,
          name: definition.name,
          productType: 'simple',
          tracksInventory: definition.tracksInventory,
          taxCode: definition.taxCode,
          status: 'active',
          categoryId,
          defaultVariant: {
            sku: definition.sku,
            unitOfMeasureCode: 'unit',
            quantityScale: 0,
            standardCost: definition.standardCost,
            currencyCode: 'MXN',
          },
        },
      );
      productIds.set(definition.code, productResult.value.id);
      if (productResult.value.defaultVariant !== null)
        variantIds.set(definition.code, productResult.value.defaultVariant.id);
      if (productResult.replayed) {
        products.existing += 1;
        variants.existing += 1;
      } else {
        products.created += 1;
        variants.created += 1;
      }

      const priceResult = await this.products.createProductPrice(
        context,
        productResult.value.id,
        `${keyPrefix}:price:${definition.code}`,
        { amount: definition.price, currencyCode: 'MXN', validFrom: seedEpoch },
      );
      if (priceResult.replayed) prices.existing += 1;
      else prices.created += 1;
    }

    const inventoryLocations = { created: 0, existing: 0 };
    const inventoryBalances = { created: 0, existing: 0 };
    const stockTracked = productDefinitions.filter((definition) => definition.tracksInventory);
    if (stockTracked.length > 0) {
      for (const branch of branchRows.rows) {
        const locationResult = await this.locations.create(
          context,
          `${keyPrefix}:location:${branch.code}`,
          {
            branchId: branch.id,
            code: 'MAIN',
            name: `${branch.name} - Almacén principal`,
            locationType: 'main',
            allowsReceiving: true,
            allowsIssuing: true,
            isDefault: true,
          },
        );
        if (locationResult.replayed) inventoryLocations.existing += 1;
        else inventoryLocations.created += 1;

        const openingBalanceCreated = await this.ensureOpeningBalance(
          context,
          branch,
          locationResult.value.id,
          variantIds,
          stockTracked,
        );
        if (openingBalanceCreated) inventoryBalances.created += stockTracked.length;
        else inventoryBalances.existing += stockTracked.length;
      }
    }

    return Object.freeze({
      company: companySlug,
      branches: branchRows.rows.length,
      categories: Object.freeze(categories),
      products: Object.freeze(products),
      variants: Object.freeze(variants),
      prices: Object.freeze(prices),
      inventoryLocations: Object.freeze(inventoryLocations),
      inventoryBalances: Object.freeze(inventoryBalances),
      success: true,
    });
  }

  /**
   * Creates (or resumes) one `opening_balance` inventory movement per
   * branch carrying one line per stock-tracked product, then submits and
   * posts it — the same draft-then-post ledger workflow a real inventory
   * receipt goes through (ADR-0004: `inventory_balances` is only ever
   * written by posting a movement, never by a direct insert). Returns
   * `true` when this call newly posted the movement, `false` when an
   * earlier run already carried it all the way to `posted`.
   */
  private async ensureOpeningBalance(
    context: { companyId: string; actorId: string; requestId: string; correlationId: string; timestamp: Date },
    branch: { id: string; code: string; name: string },
    locationId: string,
    variantIds: Map<string, string>,
    stockTracked: readonly ProductDefinition[],
  ): Promise<boolean> {
    const movementKey = `${keyPrefix}:opening-balance:${branch.code}`;
    const createResult = await this.drafts.create(context, [branch.id], movementKey, {
      branchId: branch.id,
      movementType: 'opening_balance',
      occurredAt: seedEpoch,
      reasonCode: openingBalanceReasonCode,
      notes: 'AS Platform TASK 12.3C development POS catalog seed — initial stock for testing only.',
    });
    const movementId = createResult.value.id as string;
    const movement = await this.drafts.get(context.companyId, [branch.id], movementId);
    if (movement.status === 'posted') return false;

    let version = movement.version;
    for (const definition of stockTracked) {
      const variantId = variantIds.get(definition.code);
      if (variantId === undefined)
        throw new PosCatalogSeedError(
          `Variant for product "${definition.code}" was not resolved before inventory seeding.`,
        );
      const lineResult = await this.drafts.addLine(
        context,
        [branch.id],
        movementId,
        version,
        `${keyPrefix}:opening-balance-line:${branch.code}:${definition.code}`,
        {
          productVariantId: variantId,
          destinationLocationId: locationId,
          quantity: openingBalanceQuantity,
          unitOfMeasureCode: 'unit',
        },
        false,
      );
      version = BigInt((lineResult.value as { version: number }).version);
    }
    const submitResult = await this.posting.submit(
      context,
      [branch.id],
      movementId,
      version,
      `${keyPrefix}:opening-balance-submit:${branch.code}`,
    );
    const submitVersion = BigInt((submitResult.value as { version: number }).version);
    await this.posting.post(
      context,
      [branch.id],
      movementId,
      submitVersion,
      `${keyPrefix}:opening-balance-post:${branch.code}`,
    );
    return true;
  }
}
