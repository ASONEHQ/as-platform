/**
 * TASK 14.4 (Wave 2) — the "People" domain (Empleados/Horarios/Checador/
 * Nómina). See `packages/database/src/schema/people.ts`'s own doc comment
 * for the forensic-recovery rationale and `payroll.service.ts` for the
 * literal, faithfully-ported legacy payroll formula
 * (`calcularNominaEmpleado`, `AS POS V1.html` line ~13008).
 */

export const employeeStatuses = ['active', 'inactive'] as const;
export type EmployeeStatus = (typeof employeeStatuses)[number];

export interface EmployeeRow {
  id: string;
  companyId: string;
  branchId: string;
  code: string;
  displayName: string;
  phone: string | null;
  email: string | null;
  jobTitle: string | null;
  status: EmployeeStatus;
  hireDate: string | null;
  weeklySalary: string;
  currencyCode: string;
  userId: string | null;
  notes: string | null;
  createdBy: string;
  updatedBy: string;
  deactivatedAt: Date | null;
  deactivatedBy: string | null;
  version: bigint;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateEmployeeInput {
  id?: string;
  branchId: string;
  code: string;
  displayName: string;
  phone?: string | null;
  email?: string | null;
  jobTitle?: string | null;
  hireDate?: string | null;
  weeklySalary: string;
  currencyCode: string;
  userId?: string | null;
  notes?: string | null;
}

export interface UpdateEmployeeInput {
  displayName?: string;
  phone?: string | null;
  email?: string | null;
  jobTitle?: string | null;
  hireDate?: string | null;
  weeklySalary?: string;
  currencyCode?: string;
  userId?: string | null;
  notes?: string | null;
}

/** A day-off is `isDayOff=true` with both times null — never a fabricated
 * 00:00-00:00 shift (matches the DB check constraint exactly). */
export interface EmployeeScheduleRow {
  id: string;
  companyId: string;
  branchId: string;
  employeeId: string;
  workDate: string;
  scheduledStart: string | null;
  scheduledEnd: string | null;
  isDayOff: boolean;
  notes: string | null;
  createdBy: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface UpsertScheduleInput {
  id?: string;
  employeeId: string;
  workDate: string;
  isDayOff: boolean;
  scheduledStart?: string | null;
  scheduledEnd?: string | null;
  notes?: string | null;
}

export const timeClockPunchTypes = ['clock_in', 'clock_out'] as const;
export type TimeClockPunchType = (typeof timeClockPunchTypes)[number];

// TASK 16.28 — see `timeClockPunchMethods`'s own doc comment in
// `packages/database/src/schema/people.ts`.
export const timeClockPunchMethods = ['manual', 'device', 'biometric'] as const;
export type TimeClockPunchMethod = (typeof timeClockPunchMethods)[number];

export interface TimeClockPunchRow {
  id: string;
  companyId: string;
  branchId: string;
  employeeId: string;
  punchType: TimeClockPunchType;
  occurredAt: Date;
  station: string | null;
  method: TimeClockPunchMethod;
  isCorrection: boolean;
  correctionReason: string | null;
  correctedPunchId: string | null;
  createdBy: string;
  createdAt: Date;
}

export const payrollPeriodStatuses = ['draft', 'closed'] as const;
export type PayrollPeriodStatus = (typeof payrollPeriodStatuses)[number];

export interface PayrollPeriodRow {
  id: string;
  companyId: string;
  branchId: string;
  periodStart: string;
  periodEnd: string;
  status: PayrollPeriodStatus;
  closedAt: Date | null;
  closedBy: string | null;
  createdBy: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface PayrollPeriodLineRow {
  id: string;
  companyId: string;
  payrollPeriodId: string;
  employeeId: string;
  scheduledMinutes: number;
  workedMinutes: number;
  lateMinutes: number;
  overtimeMinutes: number;
  baseSalarySnapshot: string;
  deductionAmount: string;
  bonusAmount: string;
  totalAmount: string;
  currencyCode: string;
  computedAt: Date;
  computedBy: string;
}

export interface PeopleMutationContext {
  companyId: string;
  actorId: string;
  requestId: string;
  correlationId: string;
  timestamp: Date;
  deviceId?: string | undefined;
}

/**
 * `permission_denied` here is the SELF-SERVICE clock-in/out authorization
 * decision (see `time-clock.service.ts`'s own doc comment): it reuses the
 * existing generic `InfrastructureErrorCode` verbatim, exactly like every
 * other reused code below — no cast required. `employee_inactive`,
 * `duplicate_clock_in`, `invalid_clock_out` and `payroll_period_closed`
 * are the only genuinely new semantic concepts this domain introduces
 * (mirrors TASK 13.0/13.1/14.3's own restraint — see
 * `people.http-errors.ts`'s doc comment for the orchestrator hand-off
 * these four require).
 */
export type PeopleErrorCode =
  | 'validation_error'
  | 'resource_not_found'
  | 'resource_conflict'
  | 'version_conflict'
  | 'idempotency_conflict'
  | 'permission_denied'
  | 'employee_inactive'
  | 'duplicate_clock_in'
  | 'invalid_clock_out'
  | 'payroll_period_closed';

export class PeopleError extends Error {
  constructor(
    readonly code: PeopleErrorCode,
    message: string,
    readonly details?: Readonly<Record<string, unknown>>,
  ) {
    super(message);
    this.name = 'PeopleError';
  }
}
