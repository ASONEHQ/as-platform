/**
 * TASK 14.1 Part E — the production-safe, one-time first-tenant
 * provisioning mechanism. Deliberately a SEPARATE module tree from
 * `../development/*` (never imported by it, never importing from it): the
 * dev bootstrap's own safety boundary — hard-gated to a loopback Postgres
 * host and an allowlisted database name (`validateBootstrapEnvironment`,
 * `apps/api/src/development/bootstrap-owner.service.ts`) — must stay
 * exactly as restrictive as it already is. This module's own safety
 * properties are different in kind, not degree: it is meant to run
 * against a REAL target (staging or production), so it cannot gate on
 * "loopback only" — instead it gates on explicit operator confirmation,
 * a real production-grade password policy, and refusing to silently
 * upsert over an already-provisioned company (see D6 in the service's own
 * doc comment).
 */

export class ProvisioningInputError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = 'ProvisioningInputError';
  }
}

/** Everything the operator must explicitly supply — nothing here has a
 * baked-in real-looking default (Part E.4 "No hardcoded real
 * credentials"). Optional fields fall back to a documented, clearly
 * generic default (e.g. `currencyCode` defaulting to `'MXN'`) only where
 * that default is genuinely just a sane starting point, never an
 * identity-bearing value (name/email/slug/password are always required
 * explicitly). */
export interface ProvisionOwnerInput {
  readonly companyLegalName: string;
  readonly companyDisplayName?: string | undefined;
  readonly companySlug: string;
  readonly companyTimezone?: string | undefined;
  readonly companyCurrencyCode?: string | undefined;
  readonly companyLocale?: string | undefined;
  readonly ownerDisplayName: string;
  readonly ownerEmail: string;
  /** Never logged, never echoed, never persisted anywhere but as an
   * Argon2id hash — see the service's own `run()` doc comment. */
  readonly ownerPassword: string;
  /** Optional — Part F: "if branch/register can already be created via
   * authenticated APIs, use that." Supplying both creates exactly one
   * first branch as a convenience; the owner can always create further
   * branches afterward through the real, already-authenticated
   * `POST /api/v1/companies/{id}/branches` endpoint. Supplying only one
   * of the two is rejected — both or neither. */
  readonly branchName?: string | undefined;
  readonly branchCode?: string | undefined;
  readonly branchTimezone?: string | undefined;
}

export interface ProvisionOwnerSummary {
  readonly companyId: string;
  readonly companySlug: string;
  readonly ownerUserId: string;
  readonly ownerEmail: string;
  readonly roleId: string;
  readonly permissionsGranted: number;
  readonly branchId: string | null;
  readonly success: true;
}
