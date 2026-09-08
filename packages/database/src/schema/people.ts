import { sql } from 'drizzle-orm';
import {
  bigint,
  char,
  check,
  date,
  foreignKey,
  index,
  integer,
  numeric,
  pgTable,
  text,
  time,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

import { branches, companies } from './organizations.js';
import { companyIdColumn, createdAtColumn, idColumn, updatedAtColumn } from './common.js';
import { companyMemberships } from './identity.js';

/**
 * TASK 14.4 (Wave 2, Part B) — the "People" domain (Planilla/Horarios/
 * Checador/Nómina), recovered from `docs/LEGACY_FUNCTIONAL_PARITY.md`'s
 * Empleados section. The forensic audit found the legacy's payroll
 * calculation (`calcularNominaEmpleado`) was the single most
 * substantively real HR feature in the whole codebase — this schema
 * exists to recover exactly that, on real Postgres, never in-memory.
 *
 * `employees` is DELIBERATELY separate from `users`/`company_memberships`
 * (the login/auth identity) — an employee record and a login account are
 * different concepts (this task's own explicit instruction). `userId` is
 * an optional link, never a merge of the two tables.
 */
export const employeeStatuses = ['active', 'inactive'] as const;

export const employees = pgTable(
  'employees',
  {
    id: idColumn(),
    companyId: companyIdColumn().references(() => companies.id, { onDelete: 'restrict' }),
    branchId: uuid('branch_id').notNull(),
    code: text('code').notNull(),
    displayName: text('display_name').notNull(),
    phone: text('phone'),
    email: text('email'),
    jobTitle: text('job_title'),
    status: text('status').notNull().default('active'),
    hireDate: date('hire_date', { mode: 'string' }),
    // Recovered legacy "pago semanal" concept — the base figure
    // `calcularNominaEmpleado` divides into a per-minute rate. A real,
    // fixed-point weekly salary; per-period actuals are always computed
    // fresh from this plus real schedule/attendance data, never stored
    // redundantly here.
    weeklySalary: numeric('weekly_salary', { precision: 19, scale: 4 }).notNull().default(sql`0`),
    currencyCode: char('currency_code', { length: 3 }).notNull(),
    // Optional link to a real login identity — NEVER a merge of the two
    // concepts. Nullable: a real employee may have no login at all (e.g.
    // kitchen/maintenance staff who never touch the POS).
    userId: uuid('user_id'),
    notes: text('notes'),
    createdBy: uuid('created_by').notNull(),
    updatedBy: uuid('updated_by').notNull(),
    // Soft-deactivation only — never a hard delete once historical
    // schedule/attendance/payroll rows may reference this employee (this
    // task's own explicit instruction).
    deactivatedAt: timestamp('deactivated_at', { withTimezone: true, mode: 'date' }),
    deactivatedBy: uuid('deactivated_by'),
    version: bigint('version', { mode: 'bigint' }).notNull().default(sql`1`),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
  },
  (table) => [
    unique('employees_company_id_id_uq').on(table.companyId, table.id),
    unique('employees_company_branch_id_uq').on(table.companyId, table.branchId, table.id),
    uniqueIndex('employees_company_code_uq').on(table.companyId, table.code),
    foreignKey({
      columns: [table.companyId, table.branchId],
      foreignColumns: [branches.companyId, branches.id],
      name: 'employees_branch_scope_fk',
    }).onDelete('restrict'),
    foreignKey({
      columns: [table.companyId, table.userId],
      foreignColumns: [companyMemberships.companyId, companyMemberships.userId],
      name: 'employees_user_scope_fk',
    }).onDelete('restrict'),
    foreignKey({
      columns: [table.companyId, table.createdBy],
      foreignColumns: [companyMemberships.companyId, companyMemberships.userId],
      name: 'employees_created_by_membership_fk',
    }).onDelete('restrict'),
    foreignKey({
      columns: [table.companyId, table.updatedBy],
      foreignColumns: [companyMemberships.companyId, companyMemberships.userId],
      name: 'employees_updated_by_membership_fk',
    }).onDelete('restrict'),
    foreignKey({
      columns: [table.companyId, table.deactivatedBy],
      foreignColumns: [companyMemberships.companyId, companyMemberships.userId],
      name: 'employees_deactivated_by_membership_fk',
    }).onDelete('restrict'),
    index('employees_company_branch_idx').on(table.companyId, table.branchId),
    index('employees_company_status_idx').on(table.companyId, table.status),
    check('employees_code_nonblank_ck', sql`length(btrim(${table.code})) > 0`),
    check('employees_display_name_nonblank_ck', sql`length(btrim(${table.displayName})) > 0`),
    check('employees_status_ck', sql`${table.status} in ('active', 'inactive')`),
    check('employees_weekly_salary_nonnegative_ck', sql`${table.weeklySalary} >= 0`),
    check('employees_currency_code_ck', sql`${table.currencyCode} ~ '^[A-Z]{3}$'`),
    check('employees_version_ck', sql`${table.version} >= 1`),
    check(
      'employees_deactivation_fields_ck',
      sql`(${table.status} = 'inactive') = (${table.deactivatedAt} is not null and ${table.deactivatedBy} is not null)
        or (${table.status} = 'active' and ${table.deactivatedAt} is null and ${table.deactivatedBy} is null)`,
    ),
  ],
);

/** One row per employee per calendar date — "Horarios." A day-off is
 * represented by `isDayOff=true` with null start/end, never a fabricated
 * 00:00-00:00 shift. */
export const employeeSchedules = pgTable(
  'employee_schedules',
  {
    id: idColumn(),
    companyId: companyIdColumn(),
    branchId: uuid('branch_id').notNull(),
    employeeId: uuid('employee_id').notNull(),
    workDate: date('work_date', { mode: 'string' }).notNull(),
    scheduledStart: time('scheduled_start'),
    scheduledEnd: time('scheduled_end'),
    isDayOff: text('is_day_off').notNull().default('false'),
    notes: text('notes'),
    createdBy: uuid('created_by').notNull(),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
  },
  (table) => [
    unique('employee_schedules_company_id_id_uq').on(table.companyId, table.id),
    uniqueIndex('employee_schedules_employee_date_uq').on(table.companyId, table.employeeId, table.workDate),
    foreignKey({
      columns: [table.companyId, table.branchId],
      foreignColumns: [branches.companyId, branches.id],
      name: 'employee_schedules_branch_scope_fk',
    }).onDelete('restrict'),
    foreignKey({
      columns: [table.companyId, table.branchId, table.employeeId],
      foreignColumns: [employees.companyId, employees.branchId, employees.id],
      name: 'employee_schedules_employee_scope_fk',
    }).onDelete('restrict'),
    foreignKey({
      columns: [table.companyId, table.createdBy],
      foreignColumns: [companyMemberships.companyId, companyMemberships.userId],
      name: 'employee_schedules_created_by_membership_fk',
    }).onDelete('restrict'),
    index('employee_schedules_company_employee_idx').on(table.companyId, table.employeeId),
    index('employee_schedules_company_date_idx').on(table.companyId, table.workDate),
    check('employee_schedules_is_day_off_ck', sql`${table.isDayOff} in ('true', 'false')`),
    check(
      'employee_schedules_range_ck',
      sql`(${table.isDayOff} = 'true' and ${table.scheduledStart} is null and ${table.scheduledEnd} is null)
        or (${table.isDayOff} = 'false' and ${table.scheduledStart} is not null and ${table.scheduledEnd} is not null
            and ${table.scheduledEnd} > ${table.scheduledStart})`,
    ),
  ],
);

export const timeClockPunchTypes = ['clock_in', 'clock_out'] as const;

/** "Checador" — server-timestamp-authoritative (`occurredAt` is always
 * set from the server clock at the moment the request is processed,
 * never trusted from a client-submitted value — see
 * `people.service.ts`'s own doc comment). An authorized correction is a
 * NEW row referencing the one it corrects, never a destructive rewrite
 * (`isCorrection`/`correctionReason`/`correctedPunchId`) — the original,
 * possibly-wrong punch is never deleted or mutated. */
export const timeClockPunches = pgTable(
  'time_clock_punches',
  {
    id: idColumn(),
    companyId: companyIdColumn(),
    branchId: uuid('branch_id').notNull(),
    employeeId: uuid('employee_id').notNull(),
    punchType: text('punch_type').notNull(),
    occurredAt: timestamp('occurred_at', { withTimezone: true, mode: 'date' }).notNull(),
    station: text('station'),
    isCorrection: text('is_correction').notNull().default('false'),
    correctionReason: text('correction_reason'),
    correctedPunchId: uuid('corrected_punch_id'),
    createdBy: uuid('created_by').notNull(),
    createdAt: createdAtColumn(),
  },
  (table) => [
    unique('time_clock_punches_company_id_id_uq').on(table.companyId, table.id),
    foreignKey({
      columns: [table.companyId, table.branchId],
      foreignColumns: [branches.companyId, branches.id],
      name: 'time_clock_punches_branch_scope_fk',
    }).onDelete('restrict'),
    foreignKey({
      columns: [table.companyId, table.branchId, table.employeeId],
      foreignColumns: [employees.companyId, employees.branchId, employees.id],
      name: 'time_clock_punches_employee_scope_fk',
    }).onDelete('restrict'),
    foreignKey({
      columns: [table.companyId, table.correctedPunchId],
      foreignColumns: [table.companyId, table.id],
      name: 'time_clock_punches_corrected_punch_scope_fk',
    }).onDelete('restrict'),
    foreignKey({
      columns: [table.companyId, table.createdBy],
      foreignColumns: [companyMemberships.companyId, companyMemberships.userId],
      name: 'time_clock_punches_created_by_membership_fk',
    }).onDelete('restrict'),
    index('time_clock_punches_company_employee_idx').on(table.companyId, table.employeeId, table.occurredAt),
    index('time_clock_punches_company_branch_idx').on(table.companyId, table.branchId),
    check('time_clock_punches_type_ck', sql`${table.punchType} in ('clock_in', 'clock_out')`),
    check('time_clock_punches_is_correction_ck', sql`${table.isCorrection} in ('true', 'false')`),
    check(
      'time_clock_punches_correction_fields_ck',
      sql`(${table.isCorrection} = 'true') = (${table.correctionReason} is not null and ${table.correctedPunchId} is not null)`,
    ),
  ],
);

export const payrollPeriodStatuses = ['draft', 'closed'] as const;

/** A payroll period is branch-scoped (mirrors `employees` itself being
 * branch-scoped) — one weekly close per branch. */
export const payrollPeriods = pgTable(
  'payroll_periods',
  {
    id: idColumn(),
    companyId: companyIdColumn().references(() => companies.id, { onDelete: 'restrict' }),
    branchId: uuid('branch_id').notNull(),
    periodStart: date('period_start', { mode: 'string' }).notNull(),
    periodEnd: date('period_end', { mode: 'string' }).notNull(),
    status: text('status').notNull().default('draft'),
    closedAt: timestamp('closed_at', { withTimezone: true, mode: 'date' }),
    closedBy: uuid('closed_by'),
    createdBy: uuid('created_by').notNull(),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
  },
  (table) => [
    unique('payroll_periods_company_id_id_uq').on(table.companyId, table.id),
    uniqueIndex('payroll_periods_branch_range_uq').on(table.companyId, table.branchId, table.periodStart, table.periodEnd),
    foreignKey({
      columns: [table.companyId, table.branchId],
      foreignColumns: [branches.companyId, branches.id],
      name: 'payroll_periods_branch_scope_fk',
    }).onDelete('restrict'),
    foreignKey({
      columns: [table.companyId, table.closedBy],
      foreignColumns: [companyMemberships.companyId, companyMemberships.userId],
      name: 'payroll_periods_closed_by_membership_fk',
    }).onDelete('restrict'),
    foreignKey({
      columns: [table.companyId, table.createdBy],
      foreignColumns: [companyMemberships.companyId, companyMemberships.userId],
      name: 'payroll_periods_created_by_membership_fk',
    }).onDelete('restrict'),
    index('payroll_periods_company_branch_idx').on(table.companyId, table.branchId),
    check('payroll_periods_status_ck', sql`${table.status} in ('draft', 'closed')`),
    check('payroll_periods_range_ck', sql`${table.periodEnd} >= ${table.periodStart}`),
    check(
      'payroll_periods_closed_fields_ck',
      sql`(${table.status} = 'closed') = (${table.closedAt} is not null and ${table.closedBy} is not null)`,
    ),
  ],
);

/** A calculation SNAPSHOT — frozen the instant it's (re)computed while
 * the period is still `draft`, and permanently immutable once the
 * period closes (enforced at the service layer: "never silently
 * recalculate closed payroll" is this task's own explicit instruction).
 * Every figure here is independently derived from real schedule/
 * attendance/employee rows at calculation time — never a second,
 * separately-maintained source of truth. */
export const payrollPeriodLines = pgTable(
  'payroll_period_lines',
  {
    id: idColumn(),
    companyId: companyIdColumn(),
    payrollPeriodId: uuid('payroll_period_id').notNull(),
    employeeId: uuid('employee_id').notNull(),
    scheduledMinutes: integer('scheduled_minutes').notNull().default(0),
    workedMinutes: integer('worked_minutes').notNull().default(0),
    lateMinutes: integer('late_minutes').notNull().default(0),
    overtimeMinutes: integer('overtime_minutes').notNull().default(0),
    baseSalarySnapshot: numeric('base_salary_snapshot', { precision: 19, scale: 4 }).notNull(),
    deductionAmount: numeric('deduction_amount', { precision: 19, scale: 4 }).notNull().default(sql`0`),
    bonusAmount: numeric('bonus_amount', { precision: 19, scale: 4 }).notNull().default(sql`0`),
    totalAmount: numeric('total_amount', { precision: 19, scale: 4 }).notNull(),
    currencyCode: char('currency_code', { length: 3 }).notNull(),
    computedAt: timestamp('computed_at', { withTimezone: true, mode: 'date' }).notNull(),
    computedBy: uuid('computed_by').notNull(),
  },
  (table) => [
    unique('payroll_period_lines_company_id_id_uq').on(table.companyId, table.id),
    uniqueIndex('payroll_period_lines_period_employee_uq').on(table.companyId, table.payrollPeriodId, table.employeeId),
    foreignKey({
      columns: [table.companyId, table.payrollPeriodId],
      foreignColumns: [payrollPeriods.companyId, payrollPeriods.id],
      name: 'payroll_period_lines_period_scope_fk',
    }).onDelete('restrict'),
    foreignKey({
      columns: [table.companyId, table.employeeId],
      foreignColumns: [employees.companyId, employees.id],
      name: 'payroll_period_lines_employee_scope_fk',
    }).onDelete('restrict'),
    foreignKey({
      columns: [table.companyId, table.computedBy],
      foreignColumns: [companyMemberships.companyId, companyMemberships.userId],
      name: 'payroll_period_lines_computed_by_membership_fk',
    }).onDelete('restrict'),
    index('payroll_period_lines_company_period_idx').on(table.companyId, table.payrollPeriodId),
    check('payroll_period_lines_scheduled_minutes_ck', sql`${table.scheduledMinutes} >= 0`),
    check('payroll_period_lines_worked_minutes_ck', sql`${table.workedMinutes} >= 0`),
    check('payroll_period_lines_late_minutes_ck', sql`${table.lateMinutes} >= 0`),
    check('payroll_period_lines_overtime_minutes_ck', sql`${table.overtimeMinutes} >= 0`),
    check('payroll_period_lines_base_salary_ck', sql`${table.baseSalarySnapshot} >= 0`),
    check('payroll_period_lines_deduction_ck', sql`${table.deductionAmount} >= 0`),
    check('payroll_period_lines_bonus_ck', sql`${table.bonusAmount} >= 0`),
    check('payroll_period_lines_total_nonnegative_ck', sql`${table.totalAmount} >= 0`),
    check('payroll_period_lines_currency_code_ck', sql`${table.currencyCode} ~ '^[A-Z]{3}$'`),
  ],
);

export type Employee = typeof employees.$inferSelect;
export type NewEmployee = typeof employees.$inferInsert;
export type EmployeeSchedule = typeof employeeSchedules.$inferSelect;
export type TimeClockPunch = typeof timeClockPunches.$inferSelect;
export type PayrollPeriod = typeof payrollPeriods.$inferSelect;
export type PayrollPeriodLine = typeof payrollPeriodLines.$inferSelect;
