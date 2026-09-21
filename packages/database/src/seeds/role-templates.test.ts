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

  it('has at least the three baseline templates, each with a unique key', () => {
    const keys = roleTemplates.map((template) => template.key);
    expect(keys).toEqual([...new Set(keys)]);
    expect(keys).toEqual(expect.arrayContaining(['administrator', 'manager', 'cashier']));
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
});
