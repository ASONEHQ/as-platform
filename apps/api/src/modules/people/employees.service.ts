import { randomUUID } from 'node:crypto';
import { createHash } from 'node:crypto';

import type { PeopleRepository } from './people.repository.js';
import {
  PeopleError,
  type CreateEmployeeInput,
  type EmployeeRow,
  type PeopleMutationContext,
  type UpdateEmployeeInput,
} from './people.types.js';

const CODE_PATTERN = /^\S.{0,48}\S$|^\S$/u;
const CURRENCY_CODE_PATTERN = /^[A-Z]{3}$/u;
const HIRE_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/u;
const WEEKLY_SALARY_PATTERN = /^(?:0|[1-9]\d{0,14})(?:\.\d{1,4})?$/u;

function hash(value: object): string {
  return createHash('sha256')
    .update(JSON.stringify(Object.fromEntries(Object.entries(value).sort())))
    .digest('hex');
}
function nonBlank(value: string, field: string, maxLength: number): string {
  const clean = value.trim();
  if (clean.length === 0) throw new PeopleError('validation_error', `${field} is required.`);
  if (clean.length > maxLength) throw new PeopleError('validation_error', `${field} is too long.`);
  return clean;
}
function nonBlankOptional(value: string | null | undefined, field: string, maxLength: number): string | null {
  if (value === undefined || value === null) return null;
  const clean = value.trim();
  if (clean.length === 0) return null;
  if (clean.length > maxLength) throw new PeopleError('validation_error', `${field} is too long.`);
  return clean;
}
function validateCode(code: string): string {
  const clean = code.trim();
  if (clean.length === 0 || clean.length > 50 || !CODE_PATTERN.test(clean))
    throw new PeopleError('validation_error', 'code must be 1-50 non-whitespace-padded characters.');
  return clean;
}
function validateCurrencyCode(value: string): string {
  const clean = value.trim().toUpperCase();
  if (!CURRENCY_CODE_PATTERN.test(clean))
    throw new PeopleError('validation_error', 'currency_code must be a 3-letter ISO code.');
  return clean;
}
function validateWeeklySalary(value: string): string {
  if (!WEEKLY_SALARY_PATTERN.test(value))
    throw new PeopleError('validation_error', 'weekly_salary must be a non-negative decimal with up to 4 fraction digits.');
  return value;
}
function validateHireDate(value: string | null | undefined): string | null {
  if (value === undefined || value === null) return null;
  if (!HIRE_DATE_PATTERN.test(value)) throw new PeopleError('validation_error', 'hire_date must be a YYYY-MM-DD date.');
  return value;
}

function employeePayload(value: EmployeeRow): Readonly<Record<string, unknown>> {
  return {
    employee_id: value.id,
    branch_id: value.branchId,
    code: value.code,
    display_name: value.displayName,
    status: value.status,
    weekly_salary: value.weeklySalary,
    currency_code: value.currencyCode,
    user_id: value.userId,
    version: value.version.toString(),
  };
}
function decodeEmployee(raw: unknown): EmployeeRow {
  const value = raw as Omit<EmployeeRow, 'deactivatedAt' | 'createdAt' | 'updatedAt' | 'version'> & {
    deactivatedAt: string | null;
    createdAt: string;
    updatedAt: string;
    version: string;
  };
  return {
    ...value,
    deactivatedAt: value.deactivatedAt === null ? null : new Date(value.deactivatedAt),
    createdAt: new Date(value.createdAt),
    updatedAt: new Date(value.updatedAt),
    version: BigInt(value.version),
  };
}

/**
 * TASK 14.4 — Empleados CRUD. See this module's own `employees.routes.ts`
 * doc comment for the exact HTTP shape (create/read/list/update via
 * optimistic-concurrency `If-Match`, soft deactivate/reactivate).
 *
 * DESIGN DECISION — reactivation: the spec left "deactivate is soft,
 * reactivate if natural" open. Reactivation IS supported here
 * (`setActive(..., true)`) — a deactivated employee is a common, everyday
 * correction (an accidental deactivation, or a seasonal worker returning)
 * and the schema already models it as a plain status flip with no
 * historical-record implications (unlike, say, an irreversible financial
 * close) — so rejecting it outright would just push operators toward a
 * clumsy work-around (re-creating a new employee row under a new code),
 * which is strictly worse for the very schedule/attendance/payroll
 * history this schema exists to keep intact for ONE stable employee id.
 *
 * DESIGN DECISION — idempotency: every mutation here (create, update,
 * deactivate, reactivate) goes through `PeopleRepository.idempotent`,
 * per this task's own explicit instruction ("Apply it to every real
 * mutation"). `update` ALSO carries an optimistic-concurrency
 * `expectedVersion` check (mirroring `cash.service.ts`'s
 * `assignDevice`) — the two are complementary, not redundant: If-Match
 * (version) rejects an update that raced against a DIFFERENT change,
 * while the Idempotency-Key makes a client's own bare retry of the
 * SAME request safe (never double-applies, never double-bumps
 * `version`).
 */
export class EmployeesService {
  public constructor(private readonly repository: PeopleRepository) {}

  public async createEmployee(
    context: PeopleMutationContext,
    branchIds: readonly string[],
    key: string,
    input: CreateEmployeeInput,
  ): Promise<{ value: EmployeeRow; replayed: boolean }> {
    if (!branchIds.includes(input.branchId)) throw new PeopleError('resource_not_found', 'The branch was not found.');
    const code = validateCode(input.code);
    const displayName = nonBlank(input.displayName, 'display_name', 200);
    const currencyCode = validateCurrencyCode(input.currencyCode);
    const weeklySalary = validateWeeklySalary(input.weeklySalary);
    const hireDate = validateHireDate(input.hireDate);
    const phone = nonBlankOptional(input.phone, 'phone', 50);
    const email = nonBlankOptional(input.email, 'email', 200);
    const jobTitle = nonBlankOptional(input.jobTitle, 'job_title', 100);
    const notes = nonBlankOptional(input.notes, 'notes', 2000);
    const userId = input.userId ?? null;
    if (userId !== null && !(await this.repository.membershipExists(context.companyId, userId)))
      throw new PeopleError('validation_error', 'user_id must reference an active membership of this company.');
    if (await this.repository.employeeCodeExists(context.companyId, code))
      throw new PeopleError('resource_conflict', 'An employee with this code already exists.');

    const id = input.id ?? randomUUID();
    const requestHash = hash({
      branchId: input.branchId,
      code,
      displayName,
      phone,
      email,
      jobTitle,
      hireDate,
      weeklySalary,
      currencyCode,
      userId,
      notes,
      id: input.id ?? null,
    });
    return this.repository.transaction((client) =>
      this.repository.idempotent(
        client,
        context,
        'employee.create',
        key,
        requestHash,
        'employee',
        decodeEmployee,
        async () => {
          const row = await this.repository.insertEmployee(client, {
            id,
            companyId: context.companyId,
            branchId: input.branchId,
            code,
            displayName,
            phone,
            email,
            jobTitle,
            hireDate,
            weeklySalary,
            currencyCode,
            userId,
            notes,
            createdBy: context.actorId,
            timestamp: context.timestamp,
          });
          await this.repository.auditAndPublish(client, context, {
            action: 'employee.created',
            resourceType: 'employee',
            resourceId: row.id,
            eventType: 'employee.created',
            branchId: row.branchId,
            payload: employeePayload(row),
          });
          return row;
        },
      ),
    );
  }

  public async employee(companyId: string, branchIds: readonly string[], id: string): Promise<EmployeeRow> {
    const value = await this.repository.employee(companyId, branchIds, id);
    if (value === null) throw new PeopleError('resource_not_found', 'The employee was not found.');
    return value;
  }

  public listEmployees(
    companyId: string,
    branchIds: readonly string[],
    input: Parameters<PeopleRepository['listEmployees']>[2],
  ): ReturnType<PeopleRepository['listEmployees']> {
    return this.repository.listEmployees(companyId, branchIds, input);
  }

  public async updateEmployee(
    context: PeopleMutationContext,
    branchIds: readonly string[],
    key: string,
    id: string,
    expectedVersion: bigint,
    input: UpdateEmployeeInput,
  ): Promise<{ value: EmployeeRow; replayed: boolean }> {
    const current = await this.repository.employee(context.companyId, branchIds, id);
    if (current === null) throw new PeopleError('resource_not_found', 'The employee was not found.');
    const patch: UpdateEmployeeInput = {};
    if (input.displayName !== undefined) patch.displayName = nonBlank(input.displayName, 'display_name', 200);
    if ('phone' in input) patch.phone = nonBlankOptional(input.phone, 'phone', 50);
    if ('email' in input) patch.email = nonBlankOptional(input.email, 'email', 200);
    if ('jobTitle' in input) patch.jobTitle = nonBlankOptional(input.jobTitle, 'job_title', 100);
    if ('hireDate' in input) patch.hireDate = validateHireDate(input.hireDate);
    if (input.weeklySalary !== undefined) patch.weeklySalary = validateWeeklySalary(input.weeklySalary);
    if (input.currencyCode !== undefined) patch.currencyCode = validateCurrencyCode(input.currencyCode);
    if ('userId' in input) {
      if (input.userId !== null && !(await this.repository.membershipExists(context.companyId, input.userId)))
        throw new PeopleError('validation_error', 'user_id must reference an active membership of this company.');
      patch.userId = input.userId ?? null;
    }
    if ('notes' in input) patch.notes = nonBlankOptional(input.notes, 'notes', 2000);

    const requestHash = hash({ id, expectedVersion: expectedVersion.toString(), patch });
    return this.repository.transaction((client) =>
      this.repository.idempotent(
        client,
        context,
        'employee.update',
        key,
        requestHash,
        'employee',
        decodeEmployee,
        async () => {
          const updated = await this.repository.updateEmployee(client, context.companyId, id, expectedVersion, {
            ...patch,
            updatedBy: context.actorId,
            timestamp: context.timestamp,
          });
          if (updated === null) throw new PeopleError('version_conflict', 'The employee version changed.');
          await this.repository.auditAndPublish(client, context, {
            action: 'employee.updated',
            resourceType: 'employee',
            resourceId: updated.id,
            eventType: 'employee.updated',
            branchId: updated.branchId,
            payload: employeePayload(updated),
          });
          return updated;
        },
      ),
    );
  }

  private async setActive(
    context: PeopleMutationContext,
    branchIds: readonly string[],
    key: string,
    id: string,
    active: boolean,
  ): Promise<{ value: EmployeeRow; replayed: boolean }> {
    const current = await this.repository.employee(context.companyId, branchIds, id);
    if (current === null) throw new PeopleError('resource_not_found', 'The employee was not found.');
    const requestHash = hash({ id, active });
    return this.repository.transaction((client) =>
      this.repository.idempotent(
        client,
        context,
        active ? 'employee.reactivate' : 'employee.deactivate',
        key,
        requestHash,
        'employee',
        decodeEmployee,
        async () => {
          const updated = await this.repository.setEmployeeActivation(client, context.companyId, id, {
            active,
            actorId: context.actorId,
            timestamp: context.timestamp,
          });
          if (updated === null)
            throw new PeopleError(
              'resource_conflict',
              active ? 'The employee is already active.' : 'The employee is already inactive.',
            );
          await this.repository.auditAndPublish(client, context, {
            action: active ? 'employee.reactivated' : 'employee.deactivated',
            resourceType: 'employee',
            resourceId: updated.id,
            eventType: active ? 'employee.reactivated' : 'employee.deactivated',
            branchId: updated.branchId,
            payload: employeePayload(updated),
          });
          return updated;
        },
      ),
    );
  }

  public deactivateEmployee(
    context: PeopleMutationContext,
    branchIds: readonly string[],
    key: string,
    id: string,
  ): Promise<{ value: EmployeeRow; replayed: boolean }> {
    return this.setActive(context, branchIds, key, id, false);
  }

  public reactivateEmployee(
    context: PeopleMutationContext,
    branchIds: readonly string[],
    key: string,
    id: string,
  ): Promise<{ value: EmployeeRow; replayed: boolean }> {
    return this.setActive(context, branchIds, key, id, true);
  }
}
