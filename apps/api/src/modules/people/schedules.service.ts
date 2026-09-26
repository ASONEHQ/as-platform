import { randomUUID } from 'node:crypto';
import { createHash } from 'node:crypto';

import type { PeopleRepository } from './people.repository.js';
import { PeopleError, type EmployeeScheduleRow, type PeopleMutationContext, type UpsertScheduleInput } from './people.types.js';

const TIME_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)(?::([0-5]\d))?$/u;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/u;

function hash(value: object): string {
  return createHash('sha256')
    .update(JSON.stringify(Object.fromEntries(Object.entries(value).sort())))
    .digest('hex');
}
/** Exported for `payroll.service.ts` — which keeps its own re-export
 * rather than importing across sub-resource files, matching this
 * module's own "each file owns its small helpers" discipline. */
export function parseTimeToMinutes(value: string): number {
  const match = TIME_PATTERN.exec(value);
  if (match?.[1] === undefined || match[2] === undefined)
    throw new PeopleError('validation_error', 'A scheduled time must be HH:MM or HH:MM:SS.');
  return Number(match[1]) * 60 + Number(match[2]);
}
function schedulePayload(value: EmployeeScheduleRow): Readonly<Record<string, unknown>> {
  return {
    schedule_id: value.id,
    employee_id: value.employeeId,
    branch_id: value.branchId,
    work_date: value.workDate,
    is_day_off: value.isDayOff,
    scheduled_start: value.scheduledStart,
    scheduled_end: value.scheduledEnd,
  };
}
function decodeSchedule(raw: unknown): EmployeeScheduleRow {
  const value = raw as Omit<EmployeeScheduleRow, 'createdAt' | 'updatedAt'> & { createdAt: string; updatedAt: string };
  return { ...value, createdAt: new Date(value.createdAt), updatedAt: new Date(value.updatedAt) };
}

/**
 * TASK 14.4 — Horarios.
 *
 * DESIGN DECISION — upsert vs. reject-on-conflict: a schedule row for a
 * given `(employee, work_date)` is a single current FACT ("what is this
 * employee's shift on this date"), not an append-only history of edits —
 * unlike, say, a `time_clock_punches` correction, there is no legitimate
 * reason to keep a stale, wrong shift definition alongside the corrected
 * one once a manager fixes a scheduling mistake. A reject-on-conflict
 * design would force every ordinary schedule edit through a separate
 * "delete then recreate" dance for no real benefit, and the row's own
 * `updated_at` already gives a coarse "when was this last touched"
 * signal. So `upsertSchedule` is a genuine PUT-style upsert (`insert ...
 * on conflict (company_id, employee_id, work_date) do update`), and the
 * HTTP verb is `PUT /api/v1/schedules` accordingly (see
 * `schedules.routes.ts`).
 */
export class SchedulesService {
  public constructor(private readonly repository: PeopleRepository) {}

  public async upsertSchedule(
    context: PeopleMutationContext,
    branchIds: readonly string[],
    key: string,
    input: UpsertScheduleInput,
  ): Promise<{ value: EmployeeScheduleRow; replayed: boolean }> {
    const employee = await this.repository.employee(context.companyId, branchIds, input.employeeId);
    if (employee === null) throw new PeopleError('resource_not_found', 'The employee was not found.');
    if (!DATE_PATTERN.test(input.workDate))
      throw new PeopleError('validation_error', 'work_date must be a YYYY-MM-DD date.');
    let scheduledStart: string | null = null;
    let scheduledEnd: string | null = null;
    if (input.isDayOff) {
      if (
        (input.scheduledStart !== null && input.scheduledStart !== undefined) ||
        (input.scheduledEnd !== null && input.scheduledEnd !== undefined)
      )
        throw new PeopleError('validation_error', 'A day off must not include scheduled_start/scheduled_end.');
    } else {
      if (
        input.scheduledStart === null ||
        input.scheduledStart === undefined ||
        input.scheduledEnd === null ||
        input.scheduledEnd === undefined
      )
        throw new PeopleError('validation_error', 'scheduled_start and scheduled_end are required unless is_day_off is true.');
      const startMinutes = parseTimeToMinutes(input.scheduledStart);
      const endMinutes = parseTimeToMinutes(input.scheduledEnd);
      if (endMinutes <= startMinutes)
        throw new PeopleError('validation_error', 'scheduled_end must be after scheduled_start.');
      scheduledStart = input.scheduledStart;
      scheduledEnd = input.scheduledEnd;
    }
    const notes = input.notes ?? null;
    const id = input.id ?? randomUUID();
    const requestHash = hash({
      employeeId: input.employeeId,
      workDate: input.workDate,
      isDayOff: input.isDayOff,
      scheduledStart,
      scheduledEnd,
      notes,
      id: input.id ?? null,
    });
    return this.repository.transaction((client) =>
      this.repository.idempotent(
        client,
        context,
        'schedule.upsert',
        key,
        requestHash,
        'employee_schedule',
        decodeSchedule,
        async () => {
          const row = await this.repository.upsertSchedule(client, {
            id,
            companyId: context.companyId,
            branchId: employee.branchId,
            employeeId: input.employeeId,
            workDate: input.workDate,
            scheduledStart,
            scheduledEnd,
            isDayOff: input.isDayOff,
            notes,
            createdBy: context.actorId,
            timestamp: context.timestamp,
          });
          await this.repository.auditAndPublish(client, context, {
            action: 'schedule.upserted',
            resourceType: 'employee_schedule',
            resourceId: row.id,
            eventType: 'schedule.upserted',
            branchId: row.branchId,
            payload: schedulePayload(row),
          });
          return row;
        },
      ),
    );
  }

  public async listSchedules(
    companyId: string,
    branchIds: readonly string[],
    input: { employeeId: string; dateFrom: string; dateTo: string },
  ): Promise<EmployeeScheduleRow[]> {
    if (!DATE_PATTERN.test(input.dateFrom) || !DATE_PATTERN.test(input.dateTo))
      throw new PeopleError('validation_error', 'date_from/date_to must be YYYY-MM-DD dates.');
    const employee = await this.repository.employee(companyId, branchIds, input.employeeId);
    if (employee === null) throw new PeopleError('resource_not_found', 'The employee was not found.');
    return this.repository.listSchedules(companyId, branchIds, input);
  }

  /** TASK 16.29 — see `PeopleRepository.listSchedulesForBranch`'s own doc
   * comment. [branchId] must be one of the caller's own authorized
   * branches — never trusted merely because it looks like a UUID. */
  public async listSchedulesForBranch(
    companyId: string,
    branchIds: readonly string[],
    input: { branchId: string; dateFrom: string; dateTo: string },
  ): Promise<EmployeeScheduleRow[]> {
    if (!DATE_PATTERN.test(input.dateFrom) || !DATE_PATTERN.test(input.dateTo))
      throw new PeopleError('validation_error', 'date_from/date_to must be YYYY-MM-DD dates.');
    if (!branchIds.includes(input.branchId)) throw new PeopleError('resource_not_found', 'The branch was not found.');
    return this.repository.listSchedulesForBranch(companyId, input.branchId, input.dateFrom, input.dateTo);
  }
}
