import { randomUUID } from 'node:crypto';

import type { DatabaseClient } from '@asone/database';

import {
  PeopleError,
  type EmployeeRow,
  type EmployeeScheduleRow,
  type PayrollPeriodLineRow,
  type PayrollPeriodRow,
  type PeopleMutationContext,
  type TimeClockPunchRow,
  type UpdateEmployeeInput,
} from './people.types.js';

/** Structurally identical to every other module's own transaction
 * interface (see `PurchaseTransaction`/`PartyTransaction`) — reused by
 * spirit, not by import, matching this codebase's established
 * discipline. */
export interface PeopleTransaction {
  query(sql: string, values?: readonly unknown[]): Promise<unknown>;
}

interface QueryResult<T> {
  rows: T[];
  rowCount: number | null;
}
function result<T>(value: unknown): QueryResult<T> {
  return value as QueryResult<T>;
}
function constraint(error: unknown): string | undefined {
  return typeof error === 'object' && error !== null && 'constraint' in error
    ? String((error as { constraint?: unknown }).constraint)
    : undefined;
}
function jsonValue(_key: string, value: unknown): unknown {
  return typeof value === 'bigint' ? value.toString() : value;
}
/** `date`-typed columns round-trip through `node-postgres` as a native
 * `Date` at UTC midnight by default — see `parties.repository.ts`'s own
 * identical `dateOnly()` (each module keeps its own small copy, matching
 * this codebase's established discipline). Normalized here to the exact
 * `YYYY-MM-DD` the column actually stores. */
function dateOnly(value: Date | string): string {
  if (typeof value === 'string') return value;
  const year = value.getUTCFullYear().toString().padStart(4, '0');
  const month = (value.getUTCMonth() + 1).toString().padStart(2, '0');
  const day = value.getUTCDate().toString().padStart(2, '0');
  return `${year}-${month}-${day}`;
}

const EMPLOYEE_COLUMNS =
  'id,company_id,branch_id,code,display_name,phone,email,job_title,status,hire_date,weekly_salary,currency_code,user_id,notes,created_by,updated_by,deactivated_at,deactivated_by,version,created_at,updated_at';
const SCHEDULE_COLUMNS =
  'id,company_id,branch_id,employee_id,work_date,scheduled_start,scheduled_end,is_day_off,notes,created_by,created_at,updated_at';
const PUNCH_COLUMNS =
  'id,company_id,branch_id,employee_id,punch_type,occurred_at,station,method,is_correction,correction_reason,corrected_punch_id,created_by,created_at';
const PERIOD_COLUMNS =
  'id,company_id,branch_id,period_start,period_end,status,closed_at,closed_by,created_by,created_at,updated_at';
const LINE_COLUMNS =
  'id,company_id,payroll_period_id,employee_id,scheduled_minutes,worked_minutes,late_minutes,overtime_minutes,base_salary_snapshot,deduction_amount,bonus_amount,total_amount,currency_code,computed_at,computed_by';

interface EmployeeDb {
  id: string;
  company_id: string;
  branch_id: string;
  code: string;
  display_name: string;
  phone: string | null;
  email: string | null;
  job_title: string | null;
  status: string;
  hire_date: Date | string | null;
  weekly_salary: string;
  currency_code: string;
  user_id: string | null;
  notes: string | null;
  created_by: string;
  updated_by: string;
  deactivated_at: Date | string | null;
  deactivated_by: string | null;
  version: string;
  created_at: Date | string;
  updated_at: Date | string;
}
interface ScheduleDb {
  id: string;
  company_id: string;
  branch_id: string;
  employee_id: string;
  work_date: Date | string;
  scheduled_start: string | null;
  scheduled_end: string | null;
  is_day_off: string;
  notes: string | null;
  created_by: string;
  created_at: Date | string;
  updated_at: Date | string;
}
interface PunchDb {
  id: string;
  company_id: string;
  branch_id: string;
  employee_id: string;
  punch_type: string;
  occurred_at: Date | string;
  station: string | null;
  method: string;
  is_correction: string;
  correction_reason: string | null;
  corrected_punch_id: string | null;
  created_by: string;
  created_at: Date | string;
}
interface PeriodDb {
  id: string;
  company_id: string;
  branch_id: string;
  period_start: Date | string;
  period_end: Date | string;
  status: string;
  closed_at: Date | string | null;
  closed_by: string | null;
  created_by: string;
  created_at: Date | string;
  updated_at: Date | string;
}
interface LineDb {
  id: string;
  company_id: string;
  payroll_period_id: string;
  employee_id: string;
  scheduled_minutes: number;
  worked_minutes: number;
  late_minutes: number;
  overtime_minutes: number;
  base_salary_snapshot: string;
  deduction_amount: string;
  bonus_amount: string;
  total_amount: string;
  currency_code: string;
  computed_at: Date | string;
  computed_by: string;
}
interface IdempotencyDb {
  request_hash: string;
  response_body: unknown;
}

function employee(row: EmployeeDb): EmployeeRow {
  return {
    id: row.id,
    companyId: row.company_id,
    branchId: row.branch_id,
    code: row.code,
    displayName: row.display_name,
    phone: row.phone,
    email: row.email,
    jobTitle: row.job_title,
    status: row.status as EmployeeRow['status'],
    hireDate: row.hire_date === null ? null : dateOnly(row.hire_date),
    weeklySalary: row.weekly_salary,
    currencyCode: row.currency_code,
    userId: row.user_id,
    notes: row.notes,
    createdBy: row.created_by,
    updatedBy: row.updated_by,
    deactivatedAt: row.deactivated_at === null ? null : new Date(row.deactivated_at),
    deactivatedBy: row.deactivated_by,
    version: BigInt(row.version),
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
  };
}
function schedule(row: ScheduleDb): EmployeeScheduleRow {
  return {
    id: row.id,
    companyId: row.company_id,
    branchId: row.branch_id,
    employeeId: row.employee_id,
    workDate: dateOnly(row.work_date),
    scheduledStart: row.scheduled_start,
    scheduledEnd: row.scheduled_end,
    isDayOff: row.is_day_off === 'true',
    notes: row.notes,
    createdBy: row.created_by,
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
  };
}
function punch(row: PunchDb): TimeClockPunchRow {
  return {
    id: row.id,
    companyId: row.company_id,
    branchId: row.branch_id,
    employeeId: row.employee_id,
    punchType: row.punch_type as TimeClockPunchRow['punchType'],
    occurredAt: new Date(row.occurred_at),
    station: row.station,
    method: row.method as TimeClockPunchRow['method'],
    isCorrection: row.is_correction === 'true',
    correctionReason: row.correction_reason,
    correctedPunchId: row.corrected_punch_id,
    createdBy: row.created_by,
    createdAt: new Date(row.created_at),
  };
}
function period(row: PeriodDb): PayrollPeriodRow {
  return {
    id: row.id,
    companyId: row.company_id,
    branchId: row.branch_id,
    periodStart: dateOnly(row.period_start),
    periodEnd: dateOnly(row.period_end),
    status: row.status as PayrollPeriodRow['status'],
    closedAt: row.closed_at === null ? null : new Date(row.closed_at),
    closedBy: row.closed_by,
    createdBy: row.created_by,
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
  };
}
function line(row: LineDb): PayrollPeriodLineRow {
  return {
    id: row.id,
    companyId: row.company_id,
    payrollPeriodId: row.payroll_period_id,
    employeeId: row.employee_id,
    scheduledMinutes: row.scheduled_minutes,
    workedMinutes: row.worked_minutes,
    lateMinutes: row.late_minutes,
    overtimeMinutes: row.overtime_minutes,
    baseSalarySnapshot: row.base_salary_snapshot,
    deductionAmount: row.deduction_amount,
    bonusAmount: row.bonus_amount,
    totalAmount: row.total_amount,
    currencyCode: row.currency_code,
    computedAt: new Date(row.computed_at),
    computedBy: row.computed_by,
  };
}

/** One row per LOCAL calendar work-date in a payroll period, joining
 * `employee_schedules` with the day's first `clock_in`/last `clock_out`
 * — see `PeopleRepository.payrollDailyFacts`'s own doc comment for why
 * the local-day bucketing/minute extraction is computed in SQL via the
 * branch's own IANA `timezone` rather than in JS. */
export interface PayrollDailyFactRow {
  workDate: string;
  scheduledStart: string | null;
  scheduledEnd: string | null;
  isDayOff: boolean;
  firstClockIn: Date | null;
  lastClockOut: Date | null;
  firstClockInMinutes: number | null;
  lastClockOutMinutes: number | null;
}
interface PayrollDailyFactDb {
  work_date: Date | string;
  scheduled_start: string | null;
  scheduled_end: string | null;
  is_day_off: string | null;
  first_clock_in: Date | string | null;
  last_clock_out: Date | string | null;
  first_clock_in_minutes: number | string | null;
  last_clock_out_minutes: number | string | null;
}

export class PeopleRepository {
  public constructor(private readonly database: DatabaseClient) {}

  public async transaction<T>(callback: (client: PeopleTransaction) => Promise<T>): Promise<T> {
    const client = await this.database.pool.connect();
    try {
      await client.query('begin');
      const value = await callback(client);
      await client.query('commit');
      return value;
    } catch (error) {
      await client.query('rollback');
      throw this.mapDatabaseError(error);
    } finally {
      client.release();
    }
  }

  /** Copied verbatim (adapted) from `PurchasingRepository.idempotent` —
   * see that method's own doc comment for the full rationale (advisory
   * lock scoped to `(company, operation, key)`, a placeholder row
   * inserted BEFORE `create()` runs, replay on a matching hash, and a
   * failed attempt leaving no trace via the enclosing `transaction()`'s
   * own rollback). */
  public async idempotent<T>(
    client: PeopleTransaction,
    context: PeopleMutationContext,
    operation: string,
    key: string,
    requestHash: string,
    resourceType: string,
    decode: (value: unknown) => T,
    create: () => Promise<T & { id: string }>,
  ): Promise<{ value: T; replayed: boolean }> {
    await client.query('select pg_advisory_xact_lock(hashtextextended($1,0))', [
      `${context.companyId}:${operation}:${key}`,
    ]);
    const existing = result<IdempotencyDb>(
      await client.query(
        `select request_hash,response_body from idempotency_keys
         where company_id=$1 and operation=$2 and key=$3`,
        [context.companyId, operation, key],
      ),
    ).rows[0];
    if (existing !== undefined) {
      if (existing.request_hash !== requestHash || existing.response_body === null)
        throw new PeopleError('idempotency_conflict', 'The idempotency key was used with another request.');
      return { value: decode(existing.response_body), replayed: true };
    }
    const id = randomUUID();
    await client.query(
      `insert into idempotency_keys
       (id,company_id,key,operation,request_hash,expires_at,created_at)
       values ($1,$2,$3,$4,$5,$6,$7)`,
      [
        id,
        context.companyId,
        key,
        operation,
        requestHash,
        new Date(context.timestamp.getTime() + 86_400_000),
        context.timestamp,
      ],
    );
    const value = await create();
    await client.query(
      `update idempotency_keys set response_status=201,response_body=$2::jsonb,
       resource_type=$3,resource_id=$4,completed_at=$5 where id=$1`,
      [id, JSON.stringify(value, jsonValue), resourceType, value.id, context.timestamp],
    );
    return { value, replayed: false };
  }

  public async auditAndPublish(
    client: PeopleTransaction,
    context: PeopleMutationContext,
    input: {
      action: string;
      resourceType: 'employee' | 'employee_schedule' | 'time_clock_punch' | 'payroll_period';
      resourceId: string;
      eventType: string;
      branchId: string;
      payload: Readonly<Record<string, unknown>>;
    },
  ): Promise<void> {
    await client.query(
      `insert into audit_log
       (id,company_id,actor_type,actor_id,action,entity_type,entity_id,request_id,correlation_id,metadata,occurred_at)
       values ($1,$2,'user',$3,$4,$5,$6,$7,$8,$9::jsonb,$10)`,
      [
        randomUUID(),
        context.companyId,
        context.actorId,
        input.action,
        input.resourceType,
        input.resourceId,
        context.requestId,
        context.correlationId,
        JSON.stringify(input.payload),
        context.timestamp,
      ],
    );
    await client.query(
      `insert into outbox_events
       (event_id,company_id,branch_id,event_type,schema_version,aggregate_type,aggregate_id,aggregate_version,
        correlation_id,payload,occurred_at,available_at,created_at)
       values ($1,$2,$3,$4,1,$5,$6,1,$7,$8::jsonb,$9,$9,$9)`,
      [
        randomUUID(),
        context.companyId,
        input.branchId,
        input.eventType,
        input.resourceType,
        input.resourceId,
        context.correlationId,
        JSON.stringify(input.payload),
        context.timestamp,
      ],
    );
  }

  // ---- Employees ----------------------------------------------------

  public async employeeCodeExists(companyId: string, code: string): Promise<boolean> {
    const row = result<{ exists: boolean }>(
      await this.database.pool.query(`select exists(select 1 from employees where company_id=$1 and code=$2) exists`, [
        companyId,
        code,
      ]),
    ).rows[0];
    return row?.exists ?? false;
  }

  public async membershipExists(companyId: string, userId: string): Promise<boolean> {
    const row = result<{ exists: boolean }>(
      await this.database.pool.query(
        `select exists(select 1 from company_memberships where company_id=$1 and user_id=$2) exists`,
        [companyId, userId],
      ),
    ).rows[0];
    return row?.exists ?? false;
  }

  public async insertEmployee(
    client: PeopleTransaction,
    input: {
      id: string;
      companyId: string;
      branchId: string;
      code: string;
      displayName: string;
      phone: string | null;
      email: string | null;
      jobTitle: string | null;
      hireDate: string | null;
      weeklySalary: string;
      currencyCode: string;
      userId: string | null;
      notes: string | null;
      createdBy: string;
      timestamp: Date;
    },
  ): Promise<EmployeeRow> {
    const row = result<EmployeeDb>(
      await client.query(
        `insert into employees
         (id,company_id,branch_id,code,display_name,phone,email,job_title,status,hire_date,weekly_salary,
          currency_code,user_id,notes,created_by,updated_by,version,created_at,updated_at)
         values ($1,$2,$3,$4,$5,$6,$7,$8,'active',$9,$10,$11,$12,$13,$14,$14,1,$15,$15)
         returning ${EMPLOYEE_COLUMNS}`,
        [
          input.id,
          input.companyId,
          input.branchId,
          input.code,
          input.displayName,
          input.phone,
          input.email,
          input.jobTitle,
          input.hireDate,
          input.weeklySalary,
          input.currencyCode,
          input.userId,
          input.notes,
          input.createdBy,
          input.timestamp,
        ],
      ),
    ).rows[0];
    if (row === undefined) throw new Error('Employee insertion did not return a row.');
    return employee(row);
  }

  public async employee(companyId: string, branchIds: readonly string[], id: string): Promise<EmployeeRow | null> {
    const row = result<EmployeeDb>(
      await this.database.pool.query(
        `select ${EMPLOYEE_COLUMNS} from employees where company_id=$1 and id=$2 and branch_id=any($3::uuid[])`,
        [companyId, id, branchIds],
      ),
    ).rows[0];
    return row === undefined ? null : employee(row);
  }

  public async listEmployees(
    companyId: string,
    branchIds: readonly string[],
    input: { limit: number; cursor?: string; branchId?: string; status?: string },
  ): Promise<{ items: EmployeeRow[]; nextCursor: string | null }> {
    const values: unknown[] = [companyId, branchIds];
    const where = ['company_id=$1', 'branch_id=any($2::uuid[])'];
    if (input.branchId !== undefined) {
      values.push(input.branchId);
      where.push(`branch_id=$${String(values.length)}`);
    }
    if (input.status !== undefined) {
      values.push(input.status);
      where.push(`status=$${String(values.length)}`);
    }
    if (input.cursor !== undefined) {
      const decoded = decodePeopleCursor(input.cursor);
      values.push(decoded.createdAt, decoded.id);
      where.push(`(created_at,id)<($${String(values.length - 1)},$${String(values.length)})`);
    }
    values.push(input.limit + 1);
    const rows = result<EmployeeDb>(
      await this.database.pool.query(
        `select ${EMPLOYEE_COLUMNS} from employees where ${where.join(' and ')}
         order by created_at desc, id desc limit $${String(values.length)}`,
        values,
      ),
    ).rows;
    const hasMore = rows.length > input.limit;
    const items = rows.slice(0, input.limit).map(employee);
    const last = items.at(-1);
    return {
      items,
      nextCursor: hasMore && last !== undefined ? encodePeopleCursor(last.createdAt, last.id) : null,
    };
  }

  /** Optimistic-concurrency update — the exact `version=version+1 where
   * ... and version=$expected` pattern `cash.repository.ts`'s own
   * `assignDevice`/session methods established (see that file). Returns
   * `null` on a version mismatch (translated to `version_conflict` by
   * the service), never throws for that case itself. */
  public async updateEmployee(
    client: PeopleTransaction,
    companyId: string,
    id: string,
    expectedVersion: bigint,
    input: UpdateEmployeeInput & { updatedBy: string; timestamp: Date },
  ): Promise<EmployeeRow | null> {
    const row = result<EmployeeDb>(
      await client.query(
        `update employees set
           display_name=coalesce($4,display_name),
           phone=case when $5::boolean then $6 else phone end,
           email=case when $7::boolean then $8 else email end,
           job_title=case when $9::boolean then $10 else job_title end,
           hire_date=case when $11::boolean then $12::date else hire_date end,
           weekly_salary=coalesce($13,weekly_salary),
           currency_code=coalesce($14,currency_code),
           user_id=case when $15::boolean then $16 else user_id end,
           notes=case when $17::boolean then $18 else notes end,
           updated_by=$19,
           updated_at=$20,
           version=version+1
         where company_id=$1 and id=$2 and version=$3
         returning ${EMPLOYEE_COLUMNS}`,
        [
          companyId,
          id,
          expectedVersion.toString(),
          input.displayName ?? null,
          'phone' in input,
          input.phone ?? null,
          'email' in input,
          input.email ?? null,
          'jobTitle' in input,
          input.jobTitle ?? null,
          'hireDate' in input,
          input.hireDate ?? null,
          input.weeklySalary ?? null,
          input.currencyCode ?? null,
          'userId' in input,
          input.userId ?? null,
          'notes' in input,
          input.notes ?? null,
          input.updatedBy,
          input.timestamp,
        ],
      ),
    ).rows[0];
    return row === undefined ? null : employee(row);
  }

  public async setEmployeeActivation(
    client: PeopleTransaction,
    companyId: string,
    id: string,
    input: { active: boolean; actorId: string; timestamp: Date },
  ): Promise<EmployeeRow | null> {
    const row = result<EmployeeDb>(
      await client.query(
        input.active
          ? `update employees set status='active',deactivated_at=null,deactivated_by=null,
               updated_by=$3,updated_at=$4,version=version+1
             where company_id=$1 and id=$2 and status='inactive'
             returning ${EMPLOYEE_COLUMNS}`
          : `update employees set status='inactive',deactivated_at=$4,deactivated_by=$3,
               updated_by=$3,updated_at=$4,version=version+1
             where company_id=$1 and id=$2 and status='active'
             returning ${EMPLOYEE_COLUMNS}`,
        [companyId, id, input.actorId, input.timestamp],
      ),
    ).rows[0];
    return row === undefined ? null : employee(row);
  }

  // ---- Employee schedules --------------------------------------------

  /** PUT-style upsert on `(company_id, employee_id, work_date)` — see
   * `schedules.service.ts`'s own doc comment for why this beats a
   * reject-on-conflict design for this particular resource. */
  public async upsertSchedule(
    client: PeopleTransaction,
    input: {
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
      timestamp: Date;
    },
  ): Promise<EmployeeScheduleRow> {
    const row = result<ScheduleDb>(
      await client.query(
        `insert into employee_schedules
         (id,company_id,branch_id,employee_id,work_date,scheduled_start,scheduled_end,is_day_off,notes,
          created_by,created_at,updated_at)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$11)
         on conflict (company_id,employee_id,work_date) do update set
           branch_id=excluded.branch_id,
           scheduled_start=excluded.scheduled_start,
           scheduled_end=excluded.scheduled_end,
           is_day_off=excluded.is_day_off,
           notes=excluded.notes,
           updated_at=excluded.updated_at
         returning ${SCHEDULE_COLUMNS}`,
        [
          input.id,
          input.companyId,
          input.branchId,
          input.employeeId,
          input.workDate,
          input.scheduledStart,
          input.scheduledEnd,
          input.isDayOff ? 'true' : 'false',
          input.notes,
          input.createdBy,
          input.timestamp,
        ],
      ),
    ).rows[0];
    if (row === undefined) throw new Error('Schedule upsert did not return a row.');
    return schedule(row);
  }

  public async listSchedules(
    companyId: string,
    branchIds: readonly string[],
    input: { employeeId: string; dateFrom: string; dateTo: string },
  ): Promise<EmployeeScheduleRow[]> {
    const rows = result<ScheduleDb>(
      await this.database.pool.query(
        `select ${SCHEDULE_COLUMNS} from employee_schedules
         where company_id=$1 and employee_id=$2 and branch_id=any($3::uuid[])
           and work_date between $4 and $5
         order by work_date asc`,
        [companyId, input.employeeId, branchIds, input.dateFrom, input.dateTo],
      ),
    ).rows;
    return rows.map(schedule);
  }

  // ---- Time clock -----------------------------------------------------

  public async latestPunch(companyId: string, employeeId: string): Promise<TimeClockPunchRow | null> {
    const row = result<PunchDb>(
      await this.database.pool.query(
        `select ${PUNCH_COLUMNS} from time_clock_punches
         where company_id=$1 and employee_id=$2
         order by occurred_at desc, created_at desc limit 1`,
        [companyId, employeeId],
      ),
    ).rows[0];
    return row === undefined ? null : punch(row);
  }

  public async insertPunch(
    client: PeopleTransaction,
    input: {
      id: string;
      companyId: string;
      branchId: string;
      employeeId: string;
      punchType: string;
      occurredAt: Date;
      station: string | null;
      method: string;
      isCorrection: boolean;
      correctionReason: string | null;
      correctedPunchId: string | null;
      createdBy: string;
      timestamp: Date;
    },
  ): Promise<TimeClockPunchRow> {
    const row = result<PunchDb>(
      await client.query(
        `insert into time_clock_punches
         (id,company_id,branch_id,employee_id,punch_type,occurred_at,station,method,is_correction,correction_reason,
          corrected_punch_id,created_by,created_at)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
         returning ${PUNCH_COLUMNS}`,
        [
          input.id,
          input.companyId,
          input.branchId,
          input.employeeId,
          input.punchType,
          input.occurredAt,
          input.station,
          input.method,
          input.isCorrection ? 'true' : 'false',
          input.correctionReason,
          input.correctedPunchId,
          input.createdBy,
          input.timestamp,
        ],
      ),
    ).rows[0];
    if (row === undefined) throw new Error('Punch insertion did not return a row.');
    return punch(row);
  }

  public async punch(companyId: string, branchIds: readonly string[], id: string): Promise<TimeClockPunchRow | null> {
    const row = result<PunchDb>(
      await this.database.pool.query(
        `select ${PUNCH_COLUMNS} from time_clock_punches
         where company_id=$1 and id=$2 and branch_id=any($3::uuid[])`,
        [companyId, id, branchIds],
      ),
    ).rows[0];
    return row === undefined ? null : punch(row);
  }

  public async listPunches(
    companyId: string,
    branchIds: readonly string[],
    input: { employeeId: string; dateFrom?: string; dateTo?: string; limit: number },
  ): Promise<TimeClockPunchRow[]> {
    const values: unknown[] = [companyId, input.employeeId, branchIds];
    const where = ['company_id=$1', 'employee_id=$2', 'branch_id=any($3::uuid[])'];
    if (input.dateFrom !== undefined) {
      values.push(input.dateFrom);
      where.push(`occurred_at>=$${String(values.length)}::date`);
    }
    if (input.dateTo !== undefined) {
      values.push(input.dateTo);
      where.push(`occurred_at<($${String(values.length)}::date + interval '1 day')`);
    }
    values.push(input.limit);
    const rows = result<PunchDb>(
      await this.database.pool.query(
        `select ${PUNCH_COLUMNS} from time_clock_punches where ${where.join(' and ')}
         order by occurred_at desc limit $${String(values.length)}`,
        values,
      ),
    ).rows;
    return rows.map(punch);
  }

  // ---- Payroll --------------------------------------------------------

  public async branchTimezone(companyId: string, branchId: string): Promise<string | null> {
    const row = result<{ timezone: string }>(
      await this.database.pool.query(`select timezone from branches where company_id=$1 and id=$2`, [
        companyId,
        branchId,
      ]),
    ).rows[0];
    return row?.timezone ?? null;
  }

  public async activeEmployeesForBranch(
    companyId: string,
    branchId: string,
  ): Promise<{ id: string; weeklySalary: string; currencyCode: string }[]> {
    const rows = result<{ id: string; weekly_salary: string; currency_code: string }>(
      await this.database.pool.query(
        `select id,weekly_salary,currency_code from employees
         where company_id=$1 and branch_id=$2 and status='active'
         order by code asc`,
        [companyId, branchId],
      ),
    ).rows;
    return rows.map((row) => ({ id: row.id, weeklySalary: row.weekly_salary, currencyCode: row.currency_code }));
  }

  /** Per LOCAL calendar date in `[periodStart, periodEnd]`: that day's
   * schedule (if any) plus the day's FIRST `clock_in` / LAST `clock_out`
   * (correction rows included — a correction is a real punch event, see
   * `people.ts`'s schema doc comment) — mirrors the legacy's own
   * `entradaHora`/`salidaHora` (first entrada, last salida) exactly. The
   * "local calendar date" bucketing AND the `*_minutes` (minutes since
   * LOCAL midnight) are computed here in Postgres via `at time zone
   * $timezone` — using the branch's own real IANA timezone rather than
   * the legacy's implicit browser-local `Date` math is a deliberate,
   * necessary adaptation for a real multi-tenant server (this task's own
   * ADR-0001 already establishes "adapt representation, never the
   * formula" as the correct posture) — `workedMinutesForDay` itself is
   * timezone-agnostic (a plain elapsed-instant duration), computed in
   * `payroll.service.ts` from the raw `firstClockIn`/`lastClockOut`
   * instants returned here. */
  public async payrollDailyFacts(
    companyId: string,
    employeeId: string,
    periodStart: string,
    periodEnd: string,
    timezone: string,
  ): Promise<PayrollDailyFactRow[]> {
    const rows = result<PayrollDailyFactDb>(
      await this.database.pool.query(
        `with days as (
           select generate_series($3::date, $4::date, interval '1 day')::date as work_date
         ),
         sched as (
           select work_date, scheduled_start, scheduled_end, is_day_off
           from employee_schedules
           where company_id=$1 and employee_id=$2 and work_date between $3 and $4
         ),
         punches as (
           select
             (occurred_at at time zone $5)::date as local_date,
             min(occurred_at) filter (where punch_type='clock_in') as first_in,
             max(occurred_at) filter (where punch_type='clock_out') as last_out
           from time_clock_punches
           where company_id=$1 and employee_id=$2
             and (occurred_at at time zone $5)::date between $3 and $4
           group by 1
         )
         select
           d.work_date as work_date,
           s.scheduled_start::text as scheduled_start,
           s.scheduled_end::text as scheduled_end,
           coalesce(s.is_day_off,'false') as is_day_off,
           p.first_in as first_clock_in,
           p.last_out as last_clock_out,
           case when p.first_in is not null
             then round(extract(epoch from ((p.first_in at time zone $5) - date_trunc('day', p.first_in at time zone $5)))/60)
           end as first_clock_in_minutes,
           case when p.last_out is not null
             then round(extract(epoch from ((p.last_out at time zone $5) - date_trunc('day', p.last_out at time zone $5)))/60)
           end as last_clock_out_minutes
         from days d
         left join sched s on s.work_date=d.work_date
         left join punches p on p.local_date=d.work_date
         order by d.work_date asc`,
        [companyId, employeeId, periodStart, periodEnd, timezone],
      ),
    ).rows;
    return rows.map((row) => ({
      workDate: dateOnly(row.work_date),
      scheduledStart: row.scheduled_start,
      scheduledEnd: row.scheduled_end,
      isDayOff: row.is_day_off === 'true',
      firstClockIn: row.first_clock_in === null ? null : new Date(row.first_clock_in),
      lastClockOut: row.last_clock_out === null ? null : new Date(row.last_clock_out),
      firstClockInMinutes: row.first_clock_in_minutes === null ? null : Number(row.first_clock_in_minutes),
      lastClockOutMinutes: row.last_clock_out_minutes === null ? null : Number(row.last_clock_out_minutes),
    }));
  }

  public async insertPayrollPeriod(
    client: PeopleTransaction,
    input: {
      id: string;
      companyId: string;
      branchId: string;
      periodStart: string;
      periodEnd: string;
      createdBy: string;
      timestamp: Date;
    },
  ): Promise<PayrollPeriodRow> {
    const row = result<PeriodDb>(
      await client.query(
        `insert into payroll_periods
         (id,company_id,branch_id,period_start,period_end,status,created_by,created_at,updated_at)
         values ($1,$2,$3,$4,$5,'draft',$6,$7,$7)
         returning ${PERIOD_COLUMNS}`,
        [input.id, input.companyId, input.branchId, input.periodStart, input.periodEnd, input.createdBy, input.timestamp],
      ),
    ).rows[0];
    if (row === undefined) throw new Error('Payroll period insertion did not return a row.');
    return period(row);
  }

  public async payrollPeriod(
    companyId: string,
    branchIds: readonly string[],
    id: string,
  ): Promise<PayrollPeriodRow | null> {
    const row = result<PeriodDb>(
      await this.database.pool.query(
        `select ${PERIOD_COLUMNS} from payroll_periods where company_id=$1 and id=$2 and branch_id=any($3::uuid[])`,
        [companyId, id, branchIds],
      ),
    ).rows[0];
    return row === undefined ? null : period(row);
  }

  public async listPayrollPeriods(
    companyId: string,
    branchIds: readonly string[],
    input: { branchId?: string; status?: string; limit: number },
  ): Promise<PayrollPeriodRow[]> {
    const values: unknown[] = [companyId, branchIds];
    const where = ['company_id=$1', 'branch_id=any($2::uuid[])'];
    if (input.branchId !== undefined) {
      values.push(input.branchId);
      where.push(`branch_id=$${String(values.length)}`);
    }
    if (input.status !== undefined) {
      values.push(input.status);
      where.push(`status=$${String(values.length)}`);
    }
    values.push(input.limit);
    const rows = result<PeriodDb>(
      await this.database.pool.query(
        `select ${PERIOD_COLUMNS} from payroll_periods where ${where.join(' and ')}
         order by period_start desc limit $${String(values.length)}`,
        values,
      ),
    ).rows;
    return rows.map(period);
  }

  public async replacePayrollPeriodLines(
    client: PeopleTransaction,
    companyId: string,
    payrollPeriodId: string,
    lines: readonly {
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
      computedBy: string;
      timestamp: Date;
    }[],
  ): Promise<PayrollPeriodLineRow[]> {
    await client.query(`delete from payroll_period_lines where company_id=$1 and payroll_period_id=$2`, [
      companyId,
      payrollPeriodId,
    ]);
    const inserted: PayrollPeriodLineRow[] = [];
    for (const item of lines) {
      const row = result<LineDb>(
        await client.query(
          `insert into payroll_period_lines
           (id,company_id,payroll_period_id,employee_id,scheduled_minutes,worked_minutes,late_minutes,
            overtime_minutes,base_salary_snapshot,deduction_amount,bonus_amount,total_amount,currency_code,
            computed_at,computed_by)
           values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
           returning ${LINE_COLUMNS}`,
          [
            randomUUID(),
            companyId,
            payrollPeriodId,
            item.employeeId,
            item.scheduledMinutes,
            item.workedMinutes,
            item.lateMinutes,
            item.overtimeMinutes,
            item.baseSalarySnapshot,
            item.deductionAmount,
            item.bonusAmount,
            item.totalAmount,
            item.currencyCode,
            item.timestamp,
            item.computedBy,
          ],
        ),
      ).rows[0];
      if (row === undefined) throw new Error('Payroll period line insertion did not return a row.');
      inserted.push(line(row));
    }
    return inserted;
  }

  public async payrollPeriodLines(companyId: string, payrollPeriodId: string): Promise<PayrollPeriodLineRow[]> {
    const rows = result<LineDb>(
      await this.database.pool.query(
        `select ${LINE_COLUMNS} from payroll_period_lines where company_id=$1 and payroll_period_id=$2 order by employee_id asc`,
        [companyId, payrollPeriodId],
      ),
    ).rows;
    return rows.map(line);
  }

  public async setPayrollPeriodStatus(
    client: PeopleTransaction,
    companyId: string,
    id: string,
    input: { close: boolean; actorId: string; timestamp: Date },
  ): Promise<PayrollPeriodRow | null> {
    const row = result<PeriodDb>(
      await client.query(
        input.close
          ? `update payroll_periods set status='closed',closed_at=$4,closed_by=$3,updated_at=$4
             where company_id=$1 and id=$2 and status='draft'
             returning ${PERIOD_COLUMNS}`
          : `update payroll_periods set status='draft',closed_at=null,closed_by=null,updated_at=$3
             where company_id=$1 and id=$2 and status='closed'
             returning ${PERIOD_COLUMNS}`,
        input.close ? [companyId, id, input.actorId, input.timestamp] : [companyId, id, input.timestamp],
      ),
    ).rows[0];
    return row === undefined ? null : period(row);
  }

  private mapDatabaseError(error: unknown): unknown {
    switch (constraint(error)) {
      case 'employees_company_code_uq':
        return new PeopleError('resource_conflict', 'An employee with this code already exists.');
      case 'employee_schedules_range_ck':
        return new PeopleError('validation_error', 'A day off must have no scheduled times, and a shift must have scheduled_end after scheduled_start.');
      case 'employees_user_scope_fk':
        return new PeopleError('validation_error', 'user_id must reference an active membership of this company.');
      // TASK 15.0 RC certification: a real, live rehearsal caught this
      // raw Postgres 23505 leaking through as an unhandled 500 — a
      // payroll period for the same (branch_id, period_start, period_end)
      // already exists. Same class of bug the RC security pass already
      // fixed for a malformed-UUID path param; this is the people
      // module's own missing case for an already-real, already-enforced
      // DB constraint.
      case 'payroll_periods_branch_range_uq':
        return new PeopleError('resource_conflict', 'A payroll period already exists for this branch and date range.');
      default:
        return error;
    }
  }
}

/** Same opaque `(created_at, id)` cursor shape every other reverse-
 * chronological list in this codebase uses — each module keeps its own
 * small copy (see `purchasing.repository.ts`'s identical pair). */
export function encodePeopleCursor(createdAt: Date, id: string): string {
  return Buffer.from(JSON.stringify([createdAt.toISOString(), id]), 'utf8').toString('base64url');
}
export function decodePeopleCursor(cursor: string): { createdAt: Date; id: string } {
  try {
    const decoded = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as unknown;
    if (
      !Array.isArray(decoded) ||
      decoded.length !== 2 ||
      typeof decoded[0] !== 'string' ||
      typeof decoded[1] !== 'string'
    )
      throw new Error('malformed');
    const createdAt = new Date(decoded[0]);
    if (Number.isNaN(createdAt.getTime())) throw new Error('malformed');
    return { createdAt, id: decoded[1] };
  } catch {
    throw new PeopleError('validation_error', 'The cursor is invalid.');
  }
}
