import { randomUUID } from 'node:crypto';

import { normalizeCatalogCode, type DatabaseClient } from '@asone/database';

import type { AdminActor } from '../modules/admin/shared/admin.types.js';
import { AdminRepository } from '../modules/admin/shared/admin.repository.js';
import { AdministrationService } from '../modules/admin/shared/admin.service.js';
import { AuthService } from '../modules/auth/auth.service.js';
import type { AuthContext, AuthRepository } from '../modules/auth/auth.types.js';
import type { AuthTokens } from '../modules/auth/auth.tokens.js';
import { CashRepository } from '../modules/cash/cash.repository.js';
import { CashService } from '../modules/cash/cash.service.js';
import { CatalogRepository } from '../modules/catalog/catalog.repository.js';
import { CatalogService } from '../modules/catalog/catalog.service.js';
import { ProductCatalogRepository } from '../modules/catalog/product-catalog.repository.js';
import { ProductCatalogService } from '../modules/catalog/product-catalog.service.js';
import { InventoryDraftRepository } from '../modules/inventory/inventory-drafts.repository.js';
import { InventoryDraftService } from '../modules/inventory/inventory-drafts.service.js';
import { InventoryPostingRepository } from '../modules/inventory/inventory-posting.repository.js';
import { InventoryPostingService } from '../modules/inventory/inventory-posting.service.js';
import { InventoryLocationRepository } from '../modules/inventory/inventory.repository.js';
import { InventoryLocationService } from '../modules/inventory/inventory.service.js';
import { LoyaltyRepository } from '../modules/loyalty/loyalty.repository.js';
import { LoyaltyService } from '../modules/loyalty/loyalty.service.js';
import type { LoyaltyMutationContext } from '../modules/loyalty/loyalty.types.js';
import {
  ALL_PERMISSIONS_IN_CATALOGUE,
  BusinessConfigInputError,
  type BusinessConfigSummary,
  type LaunchConfig,
  type ResolveUserPassword,
  type SectionCount,
} from './business-config.types.js';
import { rejectPlaceholders } from './launch-config.validate.js';

/**
 * TASK 14.2 Part D — applies the REST of a launch's business configuration
 * (branches, registers, roles, catalog, an optional inventory
 * opening-balance movement, an optional rewards program) once a company +
 * owner ALREADY exists, via one reviewable `LaunchConfig` JSON file. This
 * is the layer immediately AFTER `../provisioning/production-owner.*`
 * (TASK 14.1): that tool creates exactly one company + one owner + a
 * loud refusal on re-run; THIS tool never creates a company, never
 * creates/touches the "owner" role or the owner's own user row, and
 * refuses outright (before writing anything) if the company named by
 * `config.company.slug` does not already exist — see `run()`'s own first
 * two checks.
 *
 * ## Idempotency / mutability policy (Part D.4/D.5 — stated explicitly,
 * as required)
 *
 * Every entity here is looked up FIRST by its natural key, scoped to the
 * resolved company (branch code, register code per branch, role code,
 * category code, product code, user by normalized email — globally
 * unique, matching `users_normalized_email_uq`): found → **skip entirely,
 * never update** (not name, not price, not permissions, not role/branch
 * assignment); not found → create through the real, already-tested
 * service for that entity (never a raw insert), exactly mirroring the
 * lookup-before-insert shape already proven in
 * `../development/bootstrap-owner.service.ts` and
 * `../development/seed-pos-catalog.service.ts`. This tool therefore
 * **only ever fills gaps on a rerun — it never updates an existing row's
 * mutable fields** (a product's price changed through the real admin
 * console after launch is never silently reverted by re-running this
 * tool against an updated config file). A product found already `draft`
 * is likewise left exactly as stored — this tool's own `status` field
 * only ever applies to a product it is CREATING, never to reconciling an
 * existing one (see Part C's own "gotcha" note about `draft` needing
 * explicit activation — that activation is a deliberate, separate,
 * already-reviewed admin action, not something a config re-apply should
 * ever do silently).
 *
 * A product code that already exists under a DIFFERENT category than the
 * config specifies is reported as an explicit conflict (`products.
 * conflicts`) and skipped — never silently overwritten, never silently
 * ignored (Part D.6).
 *
 * The "owner" role is deliberately NEVER created by this tool, even if
 * somehow missing — see `applyRoles`'s own doc comment.
 */

const REQUIRED_ADMIN_PERMISSIONS = Object.freeze([
  'branch.create',
  'user.create',
  'user.update',
  'role.create',
  'role.permission.manage',
  'role.assign',
  'branch_access.manage',
]);

// TASK 16.5 — `AdministrationService.replaceRolePermissions`/`assignRole`
// now refuse to grant a role/permission the ACTING actor does not itself
// currently hold (a real self-/puppet-account privilege-escalation guard
// that previously did not exist — see `admin.service.ts`'s own doc
// comment on that check). This tool's synthetic actor previously held
// only `REQUIRED_ADMIN_PERMISSIONS` — deliberately minimal, but that
// minimalism was about documentation hygiene, not a genuine authority
// boundary: `applyRoles` below can already grant an arbitrary role ANY
// permission in the full catalogue (`role.permissions ===
// ALL_PERMISSIONS_IN_CATALOGUE` grants literally every one), and
// `buildAdminActor`'s own `userId`/`membershipId` are the REAL company
// owner's (looked up from `user_roles` below, never fabricated) — an
// owner who, per `provisioning/production-owner.service.ts`, already
// holds every permission that exists at provisioning time. Once the
// escalation guard exists, this actor's OWN permission set must
// accurately reflect that same real authority, or this already-real,
// already-documented, owner-run bulk-provisioning tool would be unable
// to do anything it was always meant to do. Resolved fresh from the
// database (`ownerPermissionCodes` below) rather than re-hardcoded here,
// so it stays correct even if the permission catalogue changes.
async function ownerPermissionCodes(
  database: DatabaseClient,
  companyId: string,
  membershipId: string,
): Promise<readonly string[]> {
  const rows = await database.pool.query<{ code: string }>(
    `select distinct p.code from user_roles ur
     join roles r on r.id = ur.role_id and r.company_id = ur.company_id and r.status = 'active'
     join role_permissions rp on rp.role_id = r.id and rp.company_id = r.company_id and rp.effect = 'allow'
     join permissions p on p.id = rp.permission_id
     where ur.membership_id = $1 and ur.company_id = $2 and ur.status = 'active'
       and not exists (
         select 1 from user_roles denied_ur
         join roles denied_r on denied_r.id = denied_ur.role_id and denied_r.company_id = denied_ur.company_id and denied_r.status = 'active'
         join role_permissions denied_rp on denied_rp.role_id = denied_r.id and denied_rp.company_id = denied_r.company_id
         where denied_ur.membership_id = ur.membership_id and denied_ur.company_id = ur.company_id
           and denied_ur.status = 'active' and denied_rp.permission_id = rp.permission_id
           and denied_rp.effect = 'deny'
       )`,
    [membershipId, companyId],
  );
  return rows.rows.map((row) => row.code);
}

/**
 * Fixed epoch used only for an inventory opening-balance movement's own
 * `occurredAt` — mirrors `../development/seed-pos-catalog.service.ts`'s
 * identical `seedEpoch` (see that file's own doc comment): `occurredAt`
 * is part of `InventoryDraftService.create`'s idempotency request hash,
 * so passing the run's own wall-clock timestamp (which differs on every
 * invocation) would make a rerun's hash differ from the first run's and
 * `idempotent()` would correctly — but unhelpfully — refuse it as a
 * genuine conflict. A fixed, documented epoch keeps every re-run's
 * request hash identical, which is what makes this idempotent.
 */
const OPENING_BALANCE_EPOCH = new Date('2020-01-01T00:00:00.000Z');

const PENDING_PREFIX = 'pending:';
function pendingId(kind: string, code: string): string {
  return `${PENDING_PREFIX}${kind}:${code}`;
}
function isPending(id: string): boolean {
  return id.startsWith(PENDING_PREFIX);
}

interface SharedMutationContext {
  readonly companyId: string;
  readonly actorId: string;
  readonly requestId: string;
  readonly correlationId: string;
  readonly timestamp: Date;
}

/**
 * Builds a synthetic, in-process `AdministrationService` actor for this
 * CLI's own trusted, already-DB-authenticated context — the same
 * "trusted internal context, not a real authenticated request" idea
 * `../development/seed-loyalty-rewards.service.ts` already uses for
 * `LoyaltyService`, applied here to `AdministrationService` specifically.
 * Both authorization guards it relies on — `AuthService.requirePermission`
 * / `requireBranchAccess` (`auth.service.ts`) — are PURE functions of the
 * `AuthContext` object alone (no repository or session lookup involved),
 * so a real `AuthService` can be constructed with a `repository`/`tokens`
 * that this tool never actually invokes (every `AdministrationService`
 * method this tool calls only ever reaches `requirePermission`, never
 * `login`/`authenticate`/`refresh`); any accidental invocation of either
 * stub throws immediately rather than silently returning fake data. The
 * synthetic context's own `AuthContext` object carries no permissions
 * itself — `buildAdminActor` (below, at the real call site) is what
 * actually sets `context.permissions`, resolved to the REAL company
 * owner's real, currently-granted permission set (never a fabricated
 * wildcard) — see that function's own doc comment for why, after TASK
 * 16.5's self-escalation guard.
 */
function buildSyntheticAuthService(): AuthService {
  const neverCalled = (): never => {
    throw new Error(
      'business-config: the synthetic AuthService repository/tokens must never actually be invoked — ' +
        'AdministrationService only ever calls requirePermission()/requireBranchAccess(), both pure.',
    );
  };
  const stubRepository = new Proxy({}, { get: () => neverCalled }) as unknown as AuthRepository;
  const stubTokens = new Proxy({}, { get: () => neverCalled }) as unknown as AuthTokens;
  return new AuthService({
    repository: stubRepository,
    tokens: stubTokens,
    dummyPasswordHash: 'unused-synthetic-actor-never-logs-in',
    accessTokenTtlSeconds: 900,
    refreshTokenTtlSeconds: 3600,
  });
}

function buildAdminActor(input: {
  readonly companyId: string;
  readonly userId: string;
  readonly membershipId: string;
  readonly requestId: string;
  readonly correlationId: string;
  readonly permissions: readonly string[];
}): AdminActor {
  const context: AuthContext = {
    sessionId: 'business-config-cli',
    userId: input.userId,
    membershipId: input.membershipId,
    companyId: input.companyId,
    expiresAt: new Date(Date.now() + 3_600_000),
    companyWideAccess: true,
    permissions: input.permissions,
    permittedBranchIds: [],
  };
  return { context, requestId: input.requestId, correlationId: input.correlationId };
}

export interface RunOptions {
  readonly dryRun: boolean;
  /** Required only when `dryRun` is false AND `config.users` is
   * non-empty for at least one genuinely NEW user — see
   * `business-config.types.ts`'s own doc comment on `ResolveUserPassword`. */
  readonly resolveUserPassword?: ResolveUserPassword | undefined;
}

export class BusinessConfigProvisioner {
  private readonly administration: AdministrationService;
  private readonly catalog: CatalogService;
  private readonly products: ProductCatalogService;
  private readonly locations: InventoryLocationService;
  private readonly drafts: InventoryDraftService;
  private readonly posting: InventoryPostingService;
  private readonly cash: CashService;
  private readonly loyalty: LoyaltyService;

  public constructor(private readonly database: DatabaseClient) {
    this.administration = new AdministrationService(
      new AdminRepository(database),
      buildSyntheticAuthService(),
    );
    this.catalog = new CatalogService(new CatalogRepository(database));
    this.products = new ProductCatalogService(new ProductCatalogRepository(database));
    this.locations = new InventoryLocationService(new InventoryLocationRepository(database));
    this.drafts = new InventoryDraftService(new InventoryDraftRepository(database));
    this.posting = new InventoryPostingService(new InventoryPostingRepository(database));
    this.cash = new CashService(new CashRepository(database));
    this.loyalty = new LoyaltyService(new LoyaltyRepository(database));
  }

  public async run(config: LaunchConfig, options: RunOptions): Promise<BusinessConfigSummary> {
    const dryRun = options.dryRun;
    if (!dryRun) rejectPlaceholders(config);

    const permissionCatalogue = await this.database.pool.query<{ count: string }>(
      'select count(*)::text as count from permissions',
    );
    if (Number(permissionCatalogue.rows[0]?.count ?? '0') === 0)
      throw new BusinessConfigInputError(
        'The permission catalogue is empty. Run "pnpm --filter @asone/database db:seed" against this database first.',
      );

    const companyRows = await this.database.pool.query<{ id: string }>(
      'select id from companies where slug=$1',
      [config.company.slug],
    );
    const companyId = companyRows.rows[0]?.id;
    if (companyId === undefined)
      throw new BusinessConfigInputError(
        `Company "${config.company.slug}" was not found. Run "pnpm --filter @asone/api provision:production-owner" first to create the company and its owner — this tool only ever applies configuration to a company that already exists.`,
      );

    const ownerRows = await this.database.pool.query<{ user_id: string; membership_id: string }>(
      `select m.user_id as user_id, m.id as membership_id
       from user_roles ur
       join roles r on r.id = ur.role_id and r.company_id = ur.company_id
       join company_memberships m on m.id = ur.membership_id and m.company_id = ur.company_id
       where ur.company_id = $1 and r.code = 'owner' and ur.status = 'active'
       order by m.created_at asc
       limit 1`,
      [companyId],
    );
    const owner = ownerRows.rows[0];
    if (owner === undefined)
      throw new BusinessConfigInputError(
        `No active "owner" role assignment was found for company "${config.company.slug}". Run "pnpm --filter @asone/api provision:production-owner" first.`,
      );

    const requestId = `business-config-${randomUUID()}`;
    const correlationId = `business-config-${randomUUID()}`;
    const timestamp = new Date();
    const mutationContext: SharedMutationContext = {
      companyId,
      actorId: owner.user_id,
      requestId,
      correlationId,
      timestamp,
    };
    const actor = buildAdminActor({
      companyId,
      userId: owner.user_id,
      membershipId: owner.membership_id,
      requestId,
      correlationId,
      permissions: [
        ...new Set([
          ...REQUIRED_ADMIN_PERMISSIONS,
          ...(await ownerPermissionCodes(this.database, companyId, owner.membership_id)),
        ]),
      ],
    });

    const branches = await this.applyBranches(config, companyId, actor, dryRun);
    const registers = await this.applyRegisters(
      config,
      companyId,
      mutationContext,
      branches.idByCode,
      dryRun,
    );
    const roles = await this.applyRoles(config, companyId, actor, dryRun);
    const users = await this.applyUsers(
      config,
      actor,
      branches.idByCode,
      roles.idByCode,
      dryRun,
      options.resolveUserPassword,
    );
    const categories = await this.applyCategories(config, mutationContext, dryRun);
    const catalogResult = await this.applyProducts(
      config,
      mutationContext,
      categories.idByCode,
      dryRun,
    );
    const inventoryResult = await this.applyInventoryOpeningBalances(
      config,
      mutationContext,
      branches.idByCode,
      catalogResult.variantIdByCode,
      dryRun,
    );
    const rewardsProgram = await this.applyRewards(
      config,
      mutationContext,
      catalogResult.products.idByCode,
      dryRun,
    );

    return Object.freeze({
      dryRun,
      companyId,
      companySlug: config.company.slug,
      branches: branches.count,
      registers: registers.count,
      roles: roles.count,
      users: users.count,
      categories: categories.count,
      products: catalogResult.products.count,
      prices: catalogResult.prices.count,
      inventoryLocations: inventoryResult.locations.count,
      inventoryOpeningBalances: inventoryResult.balances.count,
      rewardsProgram,
      success: true as const,
    });
  }

  // --- Branches --------------------------------------------------------

  private async applyBranches(
    config: LaunchConfig,
    companyId: string,
    actor: AdminActor,
    dryRun: boolean,
  ): Promise<{ count: SectionCount; idByCode: Map<string, string> }> {
    const idByCode = new Map<string, string>();
    let created = 0;
    let existing = 0;
    for (const branch of config.branches) {
      const found = await this.database.pool.query<{ id: string }>(
        'select id from branches where company_id=$1 and code=$2',
        [companyId, branch.code],
      );
      const row = found.rows[0];
      if (row !== undefined) {
        idByCode.set(branch.code, row.id);
        existing += 1;
        continue;
      }
      if (dryRun) {
        idByCode.set(branch.code, pendingId('branch', branch.code));
        created += 1;
        continue;
      }
      const createdBranch = await this.administration.createBranch(actor, {
        code: branch.code,
        name: branch.name,
        timezone: branch.timezone,
        // `AdministrationService.createBranch` always writes
        // `JSON.stringify(values.address ?? null)` — omitting `address`
        // entirely serializes to the JSON scalar `null`, which is a real
        // (non-SQL-NULL) jsonb value and therefore fails the schema's own
        // `branches_address_object_ck` ("address is null OR
        // jsonb_typeof(address)='object'"). Passing an explicit empty
        // object is the smallest change on this side of that boundary —
        // `admin.service.ts` is out of this tool's scope to edit.
        address: {},
      });
      idByCode.set(branch.code, createdBranch.id as string);
      created += 1;
    }
    return { count: Object.freeze({ created, existing, conflicts: Object.freeze([]) }), idByCode };
  }

  // --- Registers ---------------------------------------------------------

  private async applyRegisters(
    config: LaunchConfig,
    companyId: string,
    mutationContext: SharedMutationContext,
    branchIdByCode: Map<string, string>,
    dryRun: boolean,
  ): Promise<{ count: SectionCount }> {
    let created = 0;
    let existing = 0;
    for (const register of config.registers) {
      const branchId = branchIdByCode.get(register.branch_code);
      if (branchId === undefined)
        throw new BusinessConfigInputError(
          `registers: branch_code "${register.branch_code}" does not match any entry in this config's "branches" array.`,
        );
      if (isPending(branchId)) {
        // The branch itself only exists hypothetically in this dry run —
        // nothing to look up yet, but the register would be created too.
        created += 1;
        continue;
      }
      const found = await this.database.pool.query<{ id: string }>(
        `select id from cash_registers where company_id=$1 and branch_id=$2 and lower(code)=lower($3) and status<>'retired' and deleted_at is null`,
        [companyId, branchId, register.code],
      );
      if (found.rows[0] !== undefined) {
        existing += 1;
        continue;
      }
      if (dryRun) {
        created += 1;
        continue;
      }
      await this.cash.createRegister(
        mutationContext,
        [branchId],
        `business-config:${companyId}:register:${register.branch_code}:${register.code}`,
        { branchId, code: register.code, name: register.name },
      );
      created += 1;
    }
    return { count: Object.freeze({ created, existing, conflicts: Object.freeze([]) }) };
  }

  // --- Roles ---------------------------------------------------------------

  /**
   * The "owner" role is deliberately NEVER created here, even if this
   * loop somehow does not find it: TASK 14.1's `production-owner.service.
   * ts` creates it atomically alongside the company itself, with
   * `is_system: true` and every permission the catalogue holds at that
   * moment — `AdministrationService.createRole` (the only creation path
   * available to this tool) always sets `is_system: false`, which would
   * silently diverge from that exact provisioning path rather than
   * genuinely repair a broken company. A company resolved by `run()`
   * without an "owner" role is a broken/partial state this tool refuses
   * to paper over — the fix is re-running `provision:production-owner`
   * (which itself refuses on an already-existing company slug), never a
   * second, different way of creating an "owner" role here.
   */
  private async applyRoles(
    config: LaunchConfig,
    companyId: string,
    actor: AdminActor,
    dryRun: boolean,
  ): Promise<{ count: SectionCount; idByCode: Map<string, string> }> {
    const idByCode = new Map<string, string>();
    let created = 0;
    let existing = 0;
    for (const role of config.roles) {
      const found = await this.database.pool.query<{ id: string }>(
        'select id from roles where company_id=$1 and code=$2',
        [companyId, role.code],
      );
      const row = found.rows[0];
      if (row !== undefined) {
        idByCode.set(role.code, row.id);
        existing += 1;
        continue;
      }
      if (role.code === 'owner')
        throw new BusinessConfigInputError(
          `Role "owner" was not found for company "${config.company.slug}". This tool never creates the owner role itself — run "pnpm --filter @asone/api provision:production-owner" first.`,
        );
      if (dryRun) {
        idByCode.set(role.code, pendingId('role', role.code));
        created += 1;
        continue;
      }
      const createdRole = await this.administration.createRole(actor, {
        name: role.name,
        code: role.code,
      });
      const roleId = createdRole.id as string;

      let permissionIds: readonly string[];
      if (role.permissions === ALL_PERMISSIONS_IN_CATALOGUE) {
        const all = await this.database.pool.query<{ id: string }>('select id from permissions');
        permissionIds = all.rows.map((permission) => permission.id);
      } else {
        const foundPermissions = await this.database.pool.query<{ id: string; code: string }>(
          'select id, code from permissions where code = any($1::text[])',
          [role.permissions],
        );
        if (foundPermissions.rows.length !== role.permissions.length) {
          const foundCodes = new Set(foundPermissions.rows.map((permission) => permission.code));
          const missing = role.permissions.filter((code) => !foundCodes.has(code));
          throw new BusinessConfigInputError(
            `roles: role "${role.code}" references unknown permission code(s): ${missing.join(', ')}.`,
          );
        }
        permissionIds = foundPermissions.rows.map((permission) => permission.id);
      }
      await this.administration.replaceRolePermissions(
        actor,
        roleId,
        permissionIds.map((permissionId) => ({ permissionId, effect: 'allow' as const })),
      );
      idByCode.set(role.code, roleId);
      created += 1;
    }
    return { count: Object.freeze({ created, existing, conflicts: Object.freeze([]) }), idByCode };
  }

  // --- Users -----------------------------------------------------------

  private async applyUsers(
    config: LaunchConfig,
    actor: AdminActor,
    branchIdByCode: Map<string, string>,
    roleIdByCode: Map<string, string>,
    dryRun: boolean,
    resolveUserPassword: ResolveUserPassword | undefined,
  ): Promise<{ count: SectionCount }> {
    let created = 0;
    let existing = 0;
    for (const [index, user] of config.users.entries()) {
      const normalizedEmail = user.email.trim().toLowerCase();
      const found = await this.database.pool.query<{ id: string }>(
        'select id from users where normalized_email=$1',
        [normalizedEmail],
      );
      // Part D.4 — a user is looked up by normalized email (globally
      // unique, `users_normalized_email_uq`) and, if found, is skipped
      // ENTIRELY: never reassigned a role, never re-branch-scoped, never
      // given a new password.
      if (found.rows[0] !== undefined) {
        existing += 1;
        continue;
      }
      const branchId = branchIdByCode.get(user.branch_code);
      if (branchId === undefined)
        throw new BusinessConfigInputError(
          `users[${index.toString()}]: branch_code "${user.branch_code}" does not match any entry in this config's "branches" array.`,
        );
      const roleId = roleIdByCode.get(user.role_code);
      if (roleId === undefined)
        throw new BusinessConfigInputError(
          `users[${index.toString()}]: role_code "${user.role_code}" does not match any entry in this config's "roles" array.`,
        );
      if (dryRun) {
        created += 1;
        continue;
      }
      if (isPending(branchId) || isPending(roleId))
        throw new BusinessConfigInputError(
          `users[${index.toString()}]: internal ordering error — its branch/role was not actually created before this user.`,
        );
      if (resolveUserPassword === undefined)
        throw new BusinessConfigInputError(
          'A password source is required to create new users in a real (non-dry-run) apply — see business-config.cli.ts (interactive masked prompt, or --users-password-env-prefix).',
        );
      const password = await resolveUserPassword(user, index);
      if (password.length === 0)
        throw new BusinessConfigInputError(
          `users[${index.toString()}]: an empty password was supplied.`,
        );

      const createdUser = await this.administration.createUser(actor, {
        email: user.email.trim(),
        displayName: user.display_name.trim(),
      });
      const userId = createdUser.id as string;
      // TASK 14.0's real first-activation path — validates + hashes the
      // password exactly like every other new hire in this codebase; no
      // parallel activation flow is invented here.
      await this.administration.updateMembership(actor, userId, 'active', password);
      await this.administration.assignRole(actor, userId, { roleId, branchId });
      await this.administration.changeBranchAccess(actor, userId, branchId, {
        status: 'active',
        isDefault: true,
      });
      created += 1;
    }
    return { count: Object.freeze({ created, existing, conflicts: Object.freeze([]) }) };
  }

  // --- Categories --------------------------------------------------------

  private async applyCategories(
    config: LaunchConfig,
    mutationContext: SharedMutationContext,
    dryRun: boolean,
  ): Promise<{ count: SectionCount; idByCode: Map<string, string> }> {
    const idByCode = new Map<string, string>();
    let created = 0;
    let existing = 0;
    for (const category of config.categories) {
      const normalizedCode = normalizeCatalogCode(category.code);
      const found = await this.database.pool.query<{ id: string }>(
        'select id from product_categories where company_id=$1 and normalized_code=$2',
        [mutationContext.companyId, normalizedCode],
      );
      const row = found.rows[0];
      if (row !== undefined) {
        idByCode.set(category.code, row.id);
        existing += 1;
        continue;
      }
      if (dryRun) {
        idByCode.set(category.code, pendingId('category', category.code));
        created += 1;
        continue;
      }
      const result = await this.catalog.createCategory(
        mutationContext,
        `business-config:${mutationContext.companyId}:category:${category.code}`,
        { code: category.code, name: category.name, sortOrder: category.sort_order ?? 0 },
      );
      idByCode.set(category.code, result.value.id);
      created += 1;
    }
    return { count: Object.freeze({ created, existing, conflicts: Object.freeze([]) }), idByCode };
  }

  // --- Products + prices ---------------------------------------------------

  private async applyProducts(
    config: LaunchConfig,
    mutationContext: SharedMutationContext,
    categoryIdByCode: Map<string, string>,
    dryRun: boolean,
  ): Promise<{
    products: { count: SectionCount; idByCode: Map<string, string> };
    prices: { count: SectionCount };
    variantIdByCode: Map<string, string>;
  }> {
    const idByCode = new Map<string, string>();
    const variantIdByCode = new Map<string, string>();
    let productsCreated = 0;
    let productsExisting = 0;
    const productConflicts: string[] = [];
    let pricesCreated = 0;
    let pricesExisting = 0;

    for (const product of config.products) {
      const categoryId = categoryIdByCode.get(product.category_code);
      if (categoryId === undefined)
        throw new BusinessConfigInputError(
          `products: category_code "${product.category_code}" does not match any entry in this config's "categories" array.`,
        );

      const normalizedCode = normalizeCatalogCode(product.code);
      const found = await this.database.pool.query<{ id: string; category_id: string | null }>(
        'select id, category_id from products where company_id=$1 and normalized_code=$2',
        [mutationContext.companyId, normalizedCode],
      );
      const row = found.rows[0];
      if (row !== undefined) {
        // Part D.6 — a conflicting immutable identifier (same product
        // code, different category) is reported, never silently
        // overwritten or silently ignored; either way the existing row
        // is left completely untouched (Part D.5 — never update).
        if (!isPending(categoryId) && row.category_id !== categoryId)
          productConflicts.push(
            `product "${product.code}" already exists under a different category than this config specifies (stored category_id=${row.category_id ?? 'null'}, config category_code="${product.category_code}") — left untouched.`,
          );
        idByCode.set(product.code, row.id);
        productsExisting += 1;
        pricesExisting += 1;
        const variantRow = await this.database.pool.query<{ id: string }>(
          'select id from product_variants where company_id=$1 and product_id=$2 and is_default=true',
          [mutationContext.companyId, row.id],
        );
        if (variantRow.rows[0] !== undefined)
          variantIdByCode.set(product.code, variantRow.rows[0].id);
        continue;
      }
      if (dryRun) {
        idByCode.set(product.code, pendingId('product', product.code));
        productsCreated += 1;
        pricesCreated += 1;
        continue;
      }
      const productResult = await this.products.createProduct(
        mutationContext,
        `business-config:${mutationContext.companyId}:product:${product.code}`,
        {
          code: product.code,
          name: product.name,
          productType: product.product_type,
          tracksInventory: product.tracks_inventory,
          taxCode: product.tax_code,
          status: product.status,
          categoryId,
          defaultVariant: {
            sku: product.sku,
            unitOfMeasureCode: 'unit',
            quantityScale: 0,
            standardCost: '0',
            currencyCode: config.company.currency_code,
          },
        },
      );
      idByCode.set(product.code, productResult.value.id);
      if (productResult.value.defaultVariant !== null)
        variantIdByCode.set(product.code, productResult.value.defaultVariant.id);
      productsCreated += 1;

      await this.products.createProductPrice(
        mutationContext,
        productResult.value.id,
        `business-config:${mutationContext.companyId}:price:${product.code}`,
        {
          amount: product.unit_price,
          currencyCode: config.company.currency_code,
          validFrom: mutationContext.timestamp,
        },
      );
      pricesCreated += 1;
    }

    return {
      products: {
        count: Object.freeze({
          created: productsCreated,
          existing: productsExisting,
          conflicts: Object.freeze(productConflicts),
        }),
        idByCode,
      },
      prices: {
        count: Object.freeze({
          created: pricesCreated,
          existing: pricesExisting,
          conflicts: Object.freeze([]),
        }),
      },
      variantIdByCode,
    };
  }

  // --- Inventory opening balances ------------------------------------------

  private async applyInventoryOpeningBalances(
    config: LaunchConfig,
    mutationContext: SharedMutationContext,
    branchIdByCode: Map<string, string>,
    variantIdByCode: Map<string, string>,
    dryRun: boolean,
  ): Promise<{ locations: { count: SectionCount }; balances: { count: SectionCount } }> {
    let locationsCreated = 0;
    let locationsExisting = 0;
    let balancesCreated = 0;
    let balancesExisting = 0;

    const byBranch = new Map<string, { productCode: string; quantity: string }[]>();
    for (const balance of config.inventory_opening_balances) {
      const lines = byBranch.get(balance.branch_code) ?? [];
      lines.push({ productCode: balance.product_code, quantity: balance.quantity });
      byBranch.set(balance.branch_code, lines);
    }

    for (const [branchCode, lines] of byBranch) {
      const branchId = branchIdByCode.get(branchCode);
      if (branchId === undefined)
        throw new BusinessConfigInputError(
          `inventory_opening_balances: branch_code "${branchCode}" does not match any entry in this config's "branches" array.`,
        );
      if (dryRun || isPending(branchId)) {
        locationsCreated += 1;
        balancesCreated += lines.length;
        continue;
      }

      const locationResult = await this.locations.create(
        mutationContext,
        `business-config:${mutationContext.companyId}:location:${branchCode}`,
        {
          branchId,
          code: 'MAIN',
          name: `${branchCode} - Almacén principal`,
          locationType: 'main',
          allowsReceiving: true,
          allowsIssuing: true,
          isDefault: true,
        },
      );
      if (locationResult.replayed) locationsExisting += 1;
      else locationsCreated += 1;

      const movementKey = `business-config:${mutationContext.companyId}:opening-balance:${branchCode}`;
      const createResult = await this.drafts.create(mutationContext, [branchId], movementKey, {
        branchId,
        movementType: 'opening_balance',
        occurredAt: OPENING_BALANCE_EPOCH,
        reasonCode: 'business_config_opening_stock',
        notes:
          'AS ONE TASK 14.2 business-config launch tool — initial stock from the launch config file.',
      });
      const movementId = createResult.value.id as string;
      const movement = await this.drafts.get(mutationContext.companyId, [branchId], movementId);
      if (movement.status === 'posted') {
        balancesExisting += lines.length;
        continue;
      }

      let version = movement.version;
      for (const line of lines) {
        const variantId = variantIdByCode.get(line.productCode);
        if (variantId === undefined)
          throw new BusinessConfigInputError(
            `inventory_opening_balances: product_code "${line.productCode}" could not be resolved to a product variant (is it marked tracks_inventory: true in "products"?).`,
          );
        if (isPending(variantId))
          throw new BusinessConfigInputError(
            `inventory_opening_balances: internal ordering error — product "${line.productCode}" was not actually created before this movement.`,
          );
        const lineResult = await this.drafts.addLine(
          mutationContext,
          [branchId],
          movementId,
          version,
          `${movementKey}:line:${line.productCode}`,
          {
            productVariantId: variantId,
            destinationLocationId: locationResult.value.id,
            quantity: line.quantity,
            unitOfMeasureCode: 'unit',
          },
          false,
        );
        version = BigInt((lineResult.value as { version: number }).version);
      }
      const submitResult = await this.posting.submit(
        mutationContext,
        [branchId],
        movementId,
        version,
        `${movementKey}:submit`,
      );
      const submitVersion = BigInt((submitResult.value as { version: number }).version);
      await this.posting.post(
        mutationContext,
        [branchId],
        movementId,
        submitVersion,
        `${movementKey}:post`,
      );
      balancesCreated += lines.length;
    }

    return {
      locations: {
        count: Object.freeze({
          created: locationsCreated,
          existing: locationsExisting,
          conflicts: Object.freeze([]),
        }),
      },
      balances: {
        count: Object.freeze({
          created: balancesCreated,
          existing: balancesExisting,
          conflicts: Object.freeze([]),
        }),
      },
    };
  }

  // --- Rewards / loyalty program --------------------------------------------

  /**
   * If `rewards.enabled` is false (the launch default — "Do NOT force
   * launch dependency on Rewards"), this deliberately creates nothing at
   * all — not even an inactive program row — matching the task's own
   * "if not enabled: keep program inactive" instruction in the most
   * literal, safest way available.
   */
  private async applyRewards(
    config: LaunchConfig,
    mutationContext: SharedMutationContext,
    productIdByCode: Map<string, string>,
    dryRun: boolean,
  ): Promise<'created' | 'existing' | 'skipped_disabled'> {
    if (!config.rewards.enabled) return 'skipped_disabled';

    const loyaltyContext: LoyaltyMutationContext = {
      companyId: mutationContext.companyId,
      actorId: mutationContext.actorId,
      actorPermissions: ['loyalty.read', 'loyalty.manage'],
      requestId: mutationContext.requestId,
      correlationId: mutationContext.correlationId,
      timestamp: mutationContext.timestamp,
    };
    const existing = (await this.loyalty.listPrograms(loyaltyContext, null)).find(
      (program) => program.name === config.rewards.program_name,
    );
    if (existing !== undefined) return 'existing';
    if (dryRun) return 'created';

    const scopeProductIds: string[] = [];
    for (const code of config.rewards.reward_benefit_scope_product_codes) {
      const id = productIdByCode.get(code);
      if (id === undefined)
        throw new BusinessConfigInputError(
          `rewards: reward_benefit_scope_product_codes references unknown product "${code}".`,
        );
      if (isPending(id))
        throw new BusinessConfigInputError(
          `rewards: internal ordering error — product "${code}" was not actually created before the rewards program.`,
        );
      scopeProductIds.push(id);
    }

    await this.loyalty.createProgram(
      loyaltyContext,
      `business-config:${mutationContext.companyId}:loyalty-program:${config.rewards.program_name}`,
      {
        name: config.rewards.program_name,
        active: true,
        unitType: config.rewards.unit_type,
        earnQuantityPerSale: config.rewards.earn_quantity_per_sale,
        rewardThreshold: config.rewards.reward_threshold,
        rewardType: config.rewards.reward_type,
        rewardRepeatable: true,
        rewardBenefitType: config.rewards.reward_benefit_type,
        rewardScopeProductIds: scopeProductIds,
        rewardScopeCategoryIds: [],
      },
    );
    return 'created';
  }
}
