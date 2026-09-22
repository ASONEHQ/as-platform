import { eq } from 'drizzle-orm';

import {
  auditLog,
  branches,
  companies,
  companyMemberships,
  createUuidV7,
  type DatabaseClient,
  permissions,
  rolePermissions,
  roles,
  userBranchAccess,
  userRoles,
  users,
} from '@asone/database';

import { hashPassword, validatePasswordStrength } from '../modules/auth/auth.passwords.js';
import { isSupportedCompanyCurrency, supportedCompanyCurrencyCodes } from '../modules/cash/supported-currencies.js';
import { isValidIanaTimezone } from '../modules/promotions/pricing.service.js';
import { ProvisioningInputError, type ProvisionOwnerInput, type ProvisionOwnerSummary } from './production-owner.types.js';

const ownerRoleCode = 'owner';

/**
 * TASK 14.1 Part E — production-safe first-tenant provisioning.
 *
 * D1 (why this is a NEW class, not a call into
 * `DevelopmentOwnerBootstrap`): the dev bootstrap is a real, tested,
 * idempotent UPSERT — safe to re-run any number of times against the ONE
 * fixed dev company it always targets, because "re-running local dev
 * setup" is a routine, expected action with no real business
 * consequence. Provisioning a REAL company's first owner is not that —
 * it is a one-time, high-stakes action against a real tenant a real
 * business will actually operate. This class therefore does the
 * opposite of upserting: it REFUSES outright (`already_provisioned`) if
 * a company with the given slug already exists, rather than silently
 * treating a second invocation as "update the existing one" — an
 * operator who runs this twice by mistake (wrong slug, retried after a
 * transient network blip, etc.) gets an honest, loud refusal instead of
 * an ambiguous "did that actually do anything new?" success. (Re-running
 * after a genuine partial failure — e.g. the process was killed mid-way
 * — is handled by D2 below, not by upsert semantics.)
 *
 * D2 (atomicity): the entire company + owner + role + permissions +
 * branch (if requested) graph is written inside ONE database
 * transaction — if the process dies or throws at any point, nothing
 * partial is left behind for the next attempt to trip over; the
 * "already exists" check at the top of `run()` is therefore always an
 * honest signal that a PRIOR run fully succeeded, never a half-finished
 * one.
 *
 * D3 (permissions — Part E.9 "use the actual permission mechanism"):
 * this class does NOT itself insert `permissions` rows — that remains
 * the job of the existing, already-tested `db:seed` /
 * `seedTechnicalPermissions` step, which every real deployment already
 * runs before provisioning (see `docs/PRODUCTION_DEPLOYMENT_RUNBOOK.md`).
 * `run()` reads the approved permission catalogue and refuses loudly if
 * it is missing, exactly mirroring the dev bootstrap's own "run db:seed
 * first" guard. The production owner is granted the COMPLETE current
 * `technicalPermissionCodes` set — every code that exists is
 * company-scoped and appropriate for that company's own top-level
 * administrator (there is no separate "platform superadmin" concept in
 * this schema) — never a curated subset (the dev bootstrap's own
 * curated list is deliberately scoped to what LOCAL QA exercises, not
 * to what a real business owner should be able to do).
 *
 * D4 (password — Part E.5/E.10): validated with the SAME
 * `validatePasswordStrength` production policy `AdministrationService
 * .updateMembership` already enforces for onboarding any other real
 * staff account (TASK 14.0) — one real policy, not a second one invented
 * here. The plaintext password is used exactly once, to compute an
 * Argon2id hash, and is never written to `auditLog`, never returned in
 * `ProvisionOwnerSummary`, never logged — the CLI wrapper (
 * `production-owner.cli.ts`) is equally careful never to echo it back.
 *
 * D5 (auditability — Part E.7): a real `audit_log` row is written in the
 * same transaction, `action: 'production.owner_provisioned'`, actor_type
 * `'system'` (there is no authenticated actor yet — this IS the action
 * that creates the first one), metadata carries only ids/counts, never
 * the password or any other secret.
 *
 * D6 (tenant isolation — Part E.11): every write here follows the exact
 * same `company_id`-scoped insert pattern every other mutation in this
 * codebase uses — nothing here bypasses or works around tenant
 * isolation; it is simply the FIRST write for a brand-new `company_id`.
 */
export class ProductionOwnerProvisioner {
  public constructor(
    private readonly database: DatabaseClient,
    private readonly passwordHasher: (password: string) => Promise<string> = hashPassword,
  ) {}

  public async run(input: ProvisionOwnerInput): Promise<ProvisionOwnerSummary> {
    const legalName = nonBlank(input.companyLegalName, 'company legal name');
    const displayName = nonBlank(input.companyDisplayName ?? input.companyLegalName, 'company display name');
    const slug = input.companySlug.trim().toLowerCase();
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(slug))
      throw new ProvisioningInputError(
        'The company slug must be lowercase kebab-case (e.g. "mi-tienda"), matching the database constraint exactly.',
      );
    const timezone = nonBlank(input.companyTimezone ?? 'America/Mexico_City', 'company timezone');
    // TASK 16.8B — defense in depth for the ONE other place a
    // company/branch timezone can be persisted outside the admin HTTP
    // routes (`AdministrationService.createBranch`/`updateBranch`/
    // `updateCompany`, which enforce the identical check). This CLI is
    // ops-invoked, not tenant-facing, but a real production tenant's
    // timezone still originates here at first-provisioning time — a typo
    // in `--company-timezone`/`--branch-timezone` deserves the exact same
    // honest, immediate rejection as a bad value typed into the admin UI,
    // never a silent write that only surfaces as a `POST /api/v1/sales`
    // 500 later.
    if (!isValidIanaTimezone(timezone))
      throw new ProvisioningInputError(`"${timezone}" is not a valid IANA timezone identifier (e.g. "America/Mexico_City").`);
    const currencyCode = (input.companyCurrencyCode ?? 'MXN').trim().toUpperCase();
    if (!/^[A-Z]{3}$/u.test(currencyCode))
      throw new ProvisioningInputError('The company currency code must be a 3-letter ISO code (e.g. "MXN").');
    // TASK 16.17 — a syntactically valid but unsupported currency (e.g.
    // "EUR") used to provision fine and only fail at the first register
    // close, when no cash-denomination set exists for it. Refused here,
    // where the operator can still fix it.
    if (!isSupportedCompanyCurrency(currencyCode))
      throw new ProvisioningInputError(
        `"${currencyCode}" is not a currency ACCESS GO supports yet (supported: ${supportedCompanyCurrencyCodes.join(', ')}).`,
      );
    const locale = nonBlank(input.companyLocale ?? 'es-MX', 'company locale');

    const ownerDisplayName = nonBlank(input.ownerDisplayName, 'owner display name');
    const ownerEmail = input.ownerEmail.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(ownerEmail))
      throw new ProvisioningInputError('The owner email does not look like a valid email address.');

    const strengthError = validatePasswordStrength(input.ownerPassword);
    if (strengthError !== null) throw new ProvisioningInputError(strengthError);

    if ((input.branchName === undefined) !== (input.branchCode === undefined))
      throw new ProvisioningInputError('Supply both a branch name and a branch code, or neither — not just one.');
    const branchName = input.branchName === undefined ? null : nonBlank(input.branchName, 'branch name');
    const branchCode = input.branchCode === undefined ? null : nonBlank(input.branchCode, 'branch code');
    const branchTimezone = input.branchTimezone === undefined ? timezone : nonBlank(input.branchTimezone, 'branch timezone');
    if (input.branchTimezone !== undefined && !isValidIanaTimezone(branchTimezone))
      throw new ProvisioningInputError(`"${branchTimezone}" is not a valid IANA timezone identifier (e.g. "America/Mexico_City").`);

    const passwordHash = await this.passwordHasher(input.ownerPassword);

    return this.database.transaction(async (transaction) => {
      const existingCompany = await transaction.query.companies.findFirst({
        where: eq(companies.slug, slug),
      });
      if (existingCompany !== undefined)
        throw new ProvisioningInputError(
          `A company with slug "${slug}" already exists (id ${existingCompany.id}). This tool refuses to run a second time against an already-provisioned company — see this file's own D1 doc comment for why. If you genuinely need to change an existing company/owner, use the authenticated admin API once logged in, not this tool.`,
        );

      const companyId = createUuidV7();
      await transaction.insert(companies).values({
        id: companyId,
        legalName,
        displayName,
        slug,
        status: 'active',
        timezone,
        currencyCode,
        locale,
      });

      let branchId: string | null = null;
      if (branchName !== null && branchCode !== null) {
        branchId = createUuidV7();
        await transaction.insert(branches).values({
          id: branchId,
          companyId,
          name: branchName,
          code: branchCode,
          status: 'active',
          timezone: branchTimezone,
        });
      }

      const userId = createUuidV7();
      await transaction.insert(users).values({
        id: userId,
        email: ownerEmail,
        normalizedEmail: ownerEmail,
        displayName: ownerDisplayName,
        status: 'active',
        passwordHash,
      });

      const membershipId = createUuidV7();
      await transaction.insert(companyMemberships).values({
        id: membershipId,
        companyId,
        userId,
        status: 'active',
      });

      const roleId = createUuidV7();
      await transaction.insert(roles).values({
        id: roleId,
        companyId,
        name: 'Owner',
        code: ownerRoleCode,
        description: 'Full-authority owner role, granted at production provisioning.',
        status: 'active',
        isSystem: true,
      });

      // D3 continued: rather than importing `technicalPermissionCodes`
      // (a `packages/database` internal seed list not part of its public
      // `exports` map — and re-exporting it just for this one comparison
      // would be a worse coupling than this), the owner is granted every
      // row that ACTUALLY exists in `permissions` right now — the real,
      // already-applied result of `db:seed`, not a second, potentially
      // stale copy of the list that produced it. An empty table (seed
      // never run) is refused loudly rather than silently granting zero
      // permissions to a "successfully" provisioned owner.
      const approvedPermissions = await transaction
        .select({ id: permissions.id, code: permissions.code })
        .from(permissions);
      if (approvedPermissions.length === 0)
        throw new ProvisioningInputError(
          'The permission catalogue is empty. Run the technical permissions seed ("pnpm --filter @asone/database db:seed") against this database before provisioning the first owner.',
        );
      for (const permission of approvedPermissions) {
        await transaction.insert(rolePermissions).values({
          companyId,
          roleId,
          permissionId: permission.id,
          effect: 'allow',
        });
      }

      await transaction.insert(userRoles).values({
        id: createUuidV7(),
        companyId,
        membershipId,
        roleId,
        branchId: null,
        status: 'active',
      });

      if (branchId !== null) {
        await transaction.insert(userBranchAccess).values({
          id: createUuidV7(),
          companyId,
          membershipId,
          userId,
          branchId,
          status: 'active',
          isDefault: true,
        });
      }

      await transaction.insert(auditLog).values({
        id: createUuidV7(),
        companyId,
        actorType: 'system',
        action: 'production.owner_provisioned',
        entityType: 'company_membership',
        entityId: membershipId,
        metadata: {
          company_slug: slug,
          owner_email: ownerEmail,
          branch_created: branchId !== null,
          permission_count: approvedPermissions.length,
        },
      });

      return Object.freeze({
        companyId,
        companySlug: slug,
        ownerUserId: userId,
        ownerEmail,
        roleId,
        permissionsGranted: approvedPermissions.length,
        branchId,
        success: true as const,
      });
    });
  }
}

function nonBlank(value: string, field: string): string {
  const trimmed = value.trim();
  if (trimmed.length === 0) throw new ProvisioningInputError(`The ${field} must not be blank.`);
  return trimmed;
}
