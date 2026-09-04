import { eq, inArray } from 'drizzle-orm';

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

import { hashPassword as productionHashPassword } from '../modules/auth/auth.passwords.js';

const companySlug = 'inflapark-group';
const ownerEmail = 'ceo@inflapark.local';
const ownerRoleCode = 'owner';

const branchDefinitions = Object.freeze([
  { name: 'Puerta La Victoria', code: 'PLV' },
  { name: 'Portal Centro', code: 'PCE' },
  { name: 'Universidad', code: 'UNI' },
  { name: 'Juriquilla', code: 'JUR' },
  { name: 'CDMX', code: 'CDMX' },
  { name: 'Campeche', code: 'CAM' },
]);

export const ownerPermissionCodes = Object.freeze([
  'company.read',
  'company.update',
  'company_settings.read',
  'company_settings.update',
  'branch.read',
  'branch.create',
  'branch.update',
  'branch_settings.read',
  'branch_settings.update',
  'user.read',
  'user.create',
  'user.update',
  'role.read',
  'role.create',
  'role.update',
  'role.assign',
  'permission.read',
  'branch_access.manage',
  'device.read',
  'device.register',
  'device.revoke',
  'audit.read',
  'catalog.read',
  'inventory.read',
  // TASK 12.3C: the local dev owner is also the account used to exercise
  // the POS/CLIENTE flow end to end, including the CLIENTE→CAJERO
  // authorization gate, which requires `sale.create`. Granting it here
  // (idempotently, via the same rolePermissions upsert as every other
  // code in this list) means a fresh `dev:bootstrap-owner` run always
  // reproduces the correct local dev grant — no manual
  // `role_permissions` SQL insert needed after a database recreation.
  'sale.create',
  // Real-browser-QA fix: the same owner account completing a normal
  // CAJERO checkout (TASK 12.5A/12.5B) also needs the two permissions
  // that flow actually requires end to end — `sale.create` above got the
  // Sale created, but nothing granted the permissions its *own next
  // steps* need:
  //   - `sale.read`: `GET /sales/{sale_id}` and `GET /sales/{sale_id}
  //     /receipt` — the completed-sale success/receipt dialog
  //     (`_ReceiptSuccessDialog`) calls the latter immediately after a
  //     successful cash confirmation.
  //   - `payment.create`: `POST /sales/{sale_id}/cash-payments` (and the
  //     shared `POST /sales/{sale_id}/payments`/`POST /payments` routes
  //     for the card/terminal path) — the exact permission
  //     `PaymentService.createCashPayment`'s route requires; this is the
  //     one that was missing and returned "No tienes permiso para
  //     realizar esta acción." on "Confirmar pago en efectivo".
  // Deliberately NOT added: `sale.cancel`, `payment.read`,
  // `payment.reverse` — none of them are exercised by this checkout
  // flow, and this list grants only what the flow actually needs, never
  // every reserved permission that happens to exist (see
  // `packages/database/src/seeds/technical-permissions.ts`).
  'sale.read',
  'payment.create',
  // TASK 12.7: the local dev owner is also the account used to exercise
  // the full cash-register lifecycle end to end (open register, open
  // session, cash sale confirmation, manual cash in/out, close/count),
  // so it needs exactly the six reserved cash_* permissions that flow
  // touches — no more:
  //   - `cash_register.manage`: `POST /cash-registers` (create the
  //     register during the Part U dev seed / first-run setup) and
  //     `PUT /cash-registers/{id}/device-assignment`.
  //   - `cash_register.read`: `GET /cash-registers` /
  //     `GET /cash-registers/{id}` — the Caja module's register picker.
  //   - `cash_session.open`: `POST /cash-sessions` — "Abrir caja" with
  //     the cashier-entered opening float (Part C).
  //   - `cash_session.read`: `GET /cash-sessions/current`,
  //     `GET /cash-sessions/{id}`, `GET /cash-sessions/{id}/summary`,
  //     `GET /cash-sessions/{id}/movements`, and the cut-history list
  //     `GET /cash-sessions` (Part L) — every read the Caja screen and
  //     `PaymentService.resolveOpenCashSession` perform.
  //   - `cash_movement.create`: `POST /cash-sessions/{id}/movements` —
  //     manual "Entrada de efectivo" / "Salida de efectivo" (Part G).
  //   - `cash_session.close`: `POST /cash-sessions/{id}/closures` —
  //     "Cerrar caja" / corte (Part I).
  // Deliberately NOT added: nothing — this is the complete set Part P's
  // own permission registry reserves for cash operations; no wildcard,
  // no invented overlapping code.
  'cash_register.manage',
  'cash_register.read',
  'cash_session.open',
  'cash_session.read',
  'cash_movement.create',
  'cash_session.close',
]);

export interface BootstrapEnvironment {
  readonly NODE_ENV?: string | undefined;
  readonly DATABASE_URL?: string | undefined;
  readonly AS_DEV_BOOTSTRAP_PASSWORD?: string | undefined;
}

export interface BootstrapSummary {
  readonly company: 'created' | 'existing';
  readonly branches: number;
  readonly user: 'created' | 'existing';
  readonly roleAssignment: 'created' | 'existing';
  readonly permissions: number;
  readonly success: true;
}

export interface ValidatedBootstrapInput {
  readonly databaseUrl: string;
  readonly password: string;
}

export class BootstrapInputError extends Error {}

export function validateBootstrapEnvironment(
  environment: BootstrapEnvironment,
): ValidatedBootstrapInput {
  const nodeEnvironment = environment.NODE_ENV;
  if (nodeEnvironment !== 'development' && nodeEnvironment !== 'test') {
    throw new BootstrapInputError(
      'Owner bootstrap requires an explicit development or test environment.',
    );
  }
  const rawDatabaseUrl = environment.DATABASE_URL;
  if (rawDatabaseUrl === undefined) throw new BootstrapInputError('DATABASE_URL is required.');
  let databaseUrl: URL;
  try {
    databaseUrl = new URL(rawDatabaseUrl);
  } catch {
    throw new BootstrapInputError('DATABASE_URL must be a valid PostgreSQL URL.');
  }
  if (
    !['postgres:', 'postgresql:'].includes(databaseUrl.protocol) ||
    !['127.0.0.1', 'localhost'].includes(databaseUrl.hostname)
  ) {
    throw new BootstrapInputError('Owner bootstrap requires a loopback PostgreSQL target.');
  }
  const databaseName = decodeURIComponent(databaseUrl.pathname.slice(1));
  const allowed =
    nodeEnvironment === 'development'
      ? databaseName === 'asone_local'
      : /^asone_[a-z0-9_]*test[a-z0-9_]*$/u.test(databaseName);
  if (!allowed)
    throw new BootstrapInputError('Database target is not allowlisted for owner bootstrap.');
  const password = environment.AS_DEV_BOOTSTRAP_PASSWORD;
  if (password === undefined)
    throw new BootstrapInputError('AS_DEV_BOOTSTRAP_PASSWORD is required.');
  validateBootstrapPassword(password);
  return Object.freeze({ databaseUrl: rawDatabaseUrl, password });
}

export function validateBootstrapPassword(password: string): void {
  const normalized = password.trim().toLowerCase();
  const placeholders = ['password', 'changeme', 'change_me', 'replace_me', 'example'];
  if (
    password.length < 12 ||
    !/[a-z]/u.test(password) ||
    !/[A-Z]/u.test(password) ||
    !/[0-9]/u.test(password) ||
    !/[^A-Za-z0-9]/u.test(password) ||
    placeholders.some((value) => normalized.includes(value))
  ) {
    throw new BootstrapInputError(
      'AS_DEV_BOOTSTRAP_PASSWORD does not satisfy the local password policy.',
    );
  }
}

export class DevelopmentOwnerBootstrap {
  public constructor(
    private readonly database: DatabaseClient,
    private readonly passwordHasher: (password: string) => Promise<string> = productionHashPassword,
  ) {}

  public async run(password: string): Promise<BootstrapSummary> {
    validateBootstrapPassword(password);
    const passwordHash = await this.passwordHasher(password);
    return this.database.transaction(async (transaction) => {
      const existingCompany = await transaction.query.companies.findFirst({
        where: eq(companies.slug, companySlug),
      });
      const companyId = existingCompany?.id ?? createUuidV7();
      if (existingCompany === undefined) {
        await transaction.insert(companies).values({
          id: companyId,
          legalName: 'Inflapark Group',
          displayName: 'Inflapark Group',
          slug: companySlug,
          status: 'active',
          timezone: 'America/Mexico_City',
          currencyCode: 'MXN',
          locale: 'es-MX',
        });
      } else {
        await transaction
          .update(companies)
          .set({
            legalName: 'Inflapark Group',
            displayName: 'Inflapark Group',
            status: 'active',
            timezone: 'America/Mexico_City',
            currencyCode: 'MXN',
            locale: 'es-MX',
            updatedAt: new Date(),
          })
          .where(eq(companies.id, companyId));
      }

      const branchIds: string[] = [];
      for (const definition of branchDefinitions) {
        const existing = await transaction.query.branches.findFirst({
          where: (table, operators) =>
            operators.and(
              operators.eq(table.companyId, companyId),
              operators.eq(table.code, definition.code),
            ),
        });
        const branchId = existing?.id ?? createUuidV7();
        branchIds.push(branchId);
        if (existing === undefined) {
          await transaction.insert(branches).values({
            id: branchId,
            companyId,
            name: definition.name,
            code: definition.code,
            status: 'active',
            timezone: 'America/Mexico_City',
          });
        } else {
          await transaction
            .update(branches)
            .set({
              name: definition.name,
              status: 'active',
              timezone: 'America/Mexico_City',
              updatedAt: new Date(),
            })
            .where(eq(branches.id, branchId));
        }
      }

      const existingUser = await transaction.query.users.findFirst({
        where: eq(users.normalizedEmail, ownerEmail),
      });
      const userId = existingUser?.id ?? createUuidV7();
      if (existingUser === undefined) {
        await transaction.insert(users).values({
          id: userId,
          email: ownerEmail,
          normalizedEmail: ownerEmail,
          displayName: 'Bryant Aguilera Sánchez',
          status: 'active',
          passwordHash,
        });
      } else {
        await transaction
          .update(users)
          .set({
            email: ownerEmail,
            displayName: 'Bryant Aguilera Sánchez',
            status: 'active',
            passwordHash,
            updatedAt: new Date(),
          })
          .where(eq(users.id, userId));
      }

      const existingMembership = await transaction.query.companyMemberships.findFirst({
        where: (table, operators) =>
          operators.and(
            operators.eq(table.companyId, companyId),
            operators.eq(table.userId, userId),
          ),
      });
      const membershipId = existingMembership?.id ?? createUuidV7();
      if (existingMembership === undefined) {
        await transaction.insert(companyMemberships).values({
          id: membershipId,
          companyId,
          userId,
          status: 'active',
        });
      } else {
        await transaction
          .update(companyMemberships)
          .set({ status: 'active', updatedAt: new Date() })
          .where(eq(companyMemberships.id, membershipId));
      }

      const existingRole = await transaction.query.roles.findFirst({
        where: (table, operators) =>
          operators.and(
            operators.eq(table.companyId, companyId),
            operators.eq(table.code, ownerRoleCode),
          ),
      });
      const roleId = existingRole?.id ?? createUuidV7();
      if (existingRole === undefined) {
        await transaction.insert(roles).values({
          id: roleId,
          companyId,
          name: 'Chief Executive Officer',
          code: ownerRoleCode,
          description: 'Development owner for local AS ONE administration.',
          status: 'active',
          isSystem: true,
        });
      } else {
        await transaction
          .update(roles)
          .set({
            name: 'Chief Executive Officer',
            description: 'Development owner for local AS ONE administration.',
            status: 'active',
            isSystem: true,
            updatedAt: new Date(),
          })
          .where(eq(roles.id, roleId));
      }

      const approvedPermissions = await transaction
        .select({ id: permissions.id, code: permissions.code })
        .from(permissions)
        .where(inArray(permissions.code, ownerPermissionCodes));
      if (approvedPermissions.length !== ownerPermissionCodes.length) {
        throw new BootstrapInputError(
          'Required approved permissions are missing; run db:seed first.',
        );
      }
      for (const permission of approvedPermissions) {
        await transaction
          .insert(rolePermissions)
          .values({ companyId, roleId, permissionId: permission.id, effect: 'allow' })
          .onConflictDoUpdate({
            target: [
              rolePermissions.companyId,
              rolePermissions.roleId,
              rolePermissions.permissionId,
            ],
            set: { effect: 'allow' },
          });
      }

      const existingAssignment = await transaction.query.userRoles.findFirst({
        where: (table, operators) =>
          operators.and(
            operators.eq(table.companyId, companyId),
            operators.eq(table.membershipId, membershipId),
            operators.eq(table.roleId, roleId),
            operators.isNull(table.branchId),
          ),
      });
      if (existingAssignment === undefined) {
        await transaction.insert(userRoles).values({
          id: createUuidV7(),
          companyId,
          membershipId,
          roleId,
          branchId: null,
          status: 'active',
        });
      } else {
        await transaction
          .update(userRoles)
          .set({ status: 'active', revokedAt: null })
          .where(eq(userRoles.id, existingAssignment.id));
      }

      for (const [index, branchId] of branchIds.entries()) {
        const existingAccess = await transaction.query.userBranchAccess.findFirst({
          where: (table, operators) =>
            operators.and(
              operators.eq(table.companyId, companyId),
              operators.eq(table.membershipId, membershipId),
              operators.eq(table.branchId, branchId),
            ),
        });
        if (existingAccess === undefined) {
          await transaction.insert(userBranchAccess).values({
            id: createUuidV7(),
            companyId,
            membershipId,
            userId,
            branchId,
            status: 'active',
            isDefault: index === 0,
          });
        } else {
          await transaction
            .update(userBranchAccess)
            .set({
              status: 'active',
              isDefault: index === 0,
              revokedAt: null,
              updatedAt: new Date(),
            })
            .where(eq(userBranchAccess.id, existingAccess.id));
        }
      }

      await transaction.insert(auditLog).values({
        id: createUuidV7(),
        companyId,
        actorType: 'system',
        action: 'development.owner_bootstrapped',
        entityType: 'company_membership',
        entityId: membershipId,
        metadata: {
          environment: 'local',
          branch_count: branchIds.length,
          permission_count: approvedPermissions.length,
        },
      });

      return Object.freeze({
        company: existingCompany === undefined ? 'created' : 'existing',
        branches: branchIds.length,
        user: existingUser === undefined ? 'created' : 'existing',
        roleAssignment: existingAssignment === undefined ? 'created' : 'existing',
        permissions: approvedPermissions.length,
        success: true,
      });
    });
  }
}
