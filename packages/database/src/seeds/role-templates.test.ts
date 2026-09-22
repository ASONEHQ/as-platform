import { describe, expect, it } from 'vitest';

import { roleTemplates } from './role-templates.js';
import { technicalPermissionCodes } from './technical-permissions.js';

/** TASK 16.16 — a template is a static, non-persisted starter permission
 * bundle (see `role-templates.ts`'s own doc comment for the full "never an
 * authorization concept" rationale). These are the only correctness
 * properties that actually matter for something that never touches the
 * database: every referenced code must be real (never drift from the
 * catalogue as it evolves), never duplicated within one template, and the
 * catalogue itself must stay small enough that "no 20+ manual picks" is a
 * true claim for the Cashier template specifically. */
describe('role templates (TASK 16.16)', () => {
  const catalogue = new Set<string>(technicalPermissionCodes);

  it('has at least the four baseline templates, each with a unique key', () => {
    const keys = roleTemplates.map((template) => template.key);
    expect(keys).toEqual([...new Set(keys)]);
    expect(keys).toEqual(
      expect.arrayContaining(['administrator', 'manager', 'cashier', 'beta_tester']),
    );
  });

  for (const template of roleTemplates) {
    it(`"${template.key}" only references permission codes that exist in the real catalogue`, () => {
      const unknown = template.permissionCodes.filter((code) => !catalogue.has(code));
      expect(unknown).toEqual([]);
    });

    it(`"${template.key}" never lists the same permission code twice`, () => {
      expect(template.permissionCodes).toEqual([...new Set(template.permissionCodes)]);
    });

    it(`"${template.key}" has a non-blank label and description`, () => {
      expect(template.label.trim().length).toBeGreaterThan(0);
      expect(template.description.trim().length).toBeGreaterThan(0);
    });
  }

  it('the Administrator template is exactly the full current catalogue — never a curated subset drifting out of sync', () => {
    const administrator = roleTemplates.find((template) => template.key === 'administrator');
    expect(administrator?.permissionCodes).toEqual(technicalPermissionCodes);
  });

  it('the Cashier template stays small — the whole point is avoiding a 20+ manual-pick role setup', () => {
    const cashier = roleTemplates.find((template) => template.key === 'cashier');
    expect(cashier?.permissionCodes.length ?? 0).toBeLessThan(20);
  });

  it('the Manager template never includes company/user/role/device/sync administration — that stays Owner/Administrator-tier', () => {
    const manager = roleTemplates.find((template) => template.key === 'manager');
    const forbidden = [
      'company.update',
      'company_settings.read',
      'company_settings.update',
      'user.create',
      'user.update',
      'role.read',
      'role.create',
      'role.update',
      'role.permission.manage',
      'role.assign',
      'permission.read',
      'device.read',
      'device.register',
      'device.revoke',
      'sync.execute',
    ];
    for (const code of forbidden) expect(manager?.permissionCodes ?? []).not.toContain(code);
  });

  // TASK 16.18 — "Administrador de pruebas" (internal beta tester). This is
  // the fail-closed regression the task itself demands (§14: a newly
  // introduced permission must NEVER silently appear here unless
  // deliberately added). `betaTesterPermissionCodes` is a hand-written
  // array literal, never derived from `technicalPermissionCodes` — so this
  // property holds structurally, not just today; this test documents and
  // pins it down explicitly rather than relying on that being merely true
  // by construction.
  describe('the "beta_tester" template (Administrador de pruebas, TASK 16.18)', () => {
    const betaTester = roleTemplates.find((template) => template.key === 'beta_tester');

    it('exists and is labeled "Administrador de pruebas"', () => {
      expect(betaTester?.label).toBe('Administrador de pruebas');
    });

    it('is a genuinely explicit, curated subset — never the full catalogue, unlike the Administrator template', () => {
      expect(betaTester?.permissionCodes).not.toEqual(technicalPermissionCodes);
      expect(betaTester?.permissionCodes.length ?? 0).toBeLessThan(technicalPermissionCodes.length);
    });

    it('never includes any tenant/platform-compromising capability', () => {
      const forbidden = [
        // Company/branch/device configuration — Owner/Administrador-tier.
        'company.read',
        'company.update',
        'company_settings.read',
        'company_settings.update',
        'branch.read',
        'branch.create',
        'branch.update',
        'branch_settings.read',
        'branch_settings.update',
        'device.read',
        'device.register',
        'device.revoke',
        'sync.execute',
        // User/role/permission administration — never, not even read-only.
        'user.read',
        'user.create',
        'user.update',
        'role.read',
        'role.create',
        'role.update',
        'role.permission.manage',
        'role.assign',
        'permission.read',
        // Branch/register scope stays Owner-controlled (TASK 16.18 Phase 6)
        // — a beta tester must never grant branch/register access to
        // themselves or anyone else.
        'branch_access.manage',
        // People/payroll/staff-credential/access-control data was never
        // named among the beta tester's operational modules and each
        // carries its own real sensitivity.
        'employee.read',
        'employee.manage',
        'schedule.read',
        'schedule.manage',
        'attendance.read',
        'attendance.manage',
        'payroll.read',
        'payroll.manage',
        'payroll.close',
        'staff_credential.manage',
        'access.scan',
        'access.read',
        'access.manage',
        'operational_area.read',
        'operational_area.manage',
        // Audit trail / data-recovery tooling.
        'audit.read',
        'recovery.read',
        // Manual ledger-correction / fraud-correction admin actions.
        'loyalty.read',
        'loyalty.manage',
        'loyalty.adjust',
        'reward.issue',
        'reward.revoke',
      ];
      for (const code of forbidden) expect(betaTester?.permissionCodes ?? []).not.toContain(code);
    });

    it('still grants broad, genuine operational visibility across the named commercial modules', () => {
      const expectedPresent = [
        'catalog.read',
        'product.manage',
        'inventory.read',
        'inventory.adjust',
        'sale.create',
        'sale.cancel',
        'refund.create',
        'customer.read',
        'party.read',
        'membership.read',
        'promotion.manage',
        'coupon.manage',
        'purchase.create',
        'purchase.receive',
        'supplier.read',
        'cash_register.read',
        'cash_session.open',
        'report.read',
      ];
      for (const code of expectedPresent) expect(betaTester?.permissionCodes ?? []).toContain(code);
    });
  });
});
