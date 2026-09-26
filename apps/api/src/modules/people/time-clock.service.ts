import { randomUUID } from 'node:crypto';
import { createHash } from 'node:crypto';

import type { PeopleRepository } from './people.repository.js';
import { PeopleError, type PeopleMutationContext, type TimeClockPunchRow, type TimeClockPunchType } from './people.types.js';

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
function punchPayload(value: TimeClockPunchRow): Readonly<Record<string, unknown>> {
  return {
    punch_id: value.id,
    employee_id: value.employeeId,
    branch_id: value.branchId,
    punch_type: value.punchType,
    occurred_at: value.occurredAt.toISOString(),
    method: value.method,
    is_correction: value.isCorrection,
    corrected_punch_id: value.correctedPunchId,
  };
}
function decodePunch(raw: unknown): TimeClockPunchRow {
  const value = raw as Omit<TimeClockPunchRow, 'occurredAt' | 'createdAt'> & { occurredAt: string; createdAt: string };
  return { ...value, occurredAt: new Date(value.occurredAt), createdAt: new Date(value.createdAt) };
}

/**
 * TASK 14.4 — Checador (time clock).
 *
 * DESIGN DECISION — self-service authorization shape: an ordinary
 * clock-in/clock-out is authorized when EITHER (a) the acting user's own
 * `AuthContext.userId` matches the target employee's linked
 * `employees.user_id` (the employee clocking themself in/out — the
 * everyday case a real kiosk/tablet flow needs), OR (b) the actor holds
 * `attendance.manage` (a supervisor recording a punch on someone else's
 * behalf, e.g. a forgotten badge). This check is necessarily done HERE,
 * not as a route-level `requirePermission` guard, because it depends on
 * data (`employees.user_id`) not known until the employee row is
 * fetched — an employee with no linked login (`user_id is null`, a real,
 * documented case per the schema's own doc comment) can therefore NEVER
 * self-service; only `attendance.manage` can record their punches,
 * which is intentional (no login identity, no self-service identity to
 * authorize against). `attendance.read` alone never authorizes a punch,
 * only reading history.
 *
 * DESIGN DECISION — correction timestamps: `occurredAt` for an ORDINARY
 * clock-in/clock-out is ALWAYS `context.timestamp` (the server clock at
 * request-processing time — this task's own explicit, non-negotiable
 * instruction). A CORRECTION is different in kind: it exists precisely
 * to record what actually happened at some point in the past (e.g. "the
 * employee really left at 18:00, not whatever the missed/wrong original
 * punch says") — so `correctPunch` accepts a client-submitted
 * `occurredAt`, but ONLY through the `attendance.manage`-gated
 * correction endpoint (see `time-clock.routes.ts`), never through the
 * ordinary self-service clock-in/clock-out path.
 */
export class TimeClockService {
  public constructor(private readonly repository: PeopleRepository) {}

  private async recordPunch(
    context: PeopleMutationContext,
    branchIds: readonly string[],
    key: string,
    operation: 'time_clock.clock_in' | 'time_clock.clock_out',
    punchType: TimeClockPunchType,
    input: { employeeId: string; station?: string | null },
    actor: { userId: string; hasManagePermission: boolean },
  ): Promise<{ value: TimeClockPunchRow; replayed: boolean }> {
    const employee = await this.repository.employee(context.companyId, branchIds, input.employeeId);
    if (employee === null) throw new PeopleError('resource_not_found', 'The employee was not found.');
    if (employee.userId !== actor.userId && !actor.hasManagePermission)
      throw new PeopleError(
        'permission_denied',
        'Only the employee themself, or a user with attendance.manage, may record this punch.',
      );
    if (punchType === 'clock_in' && employee.status !== 'active')
      throw new PeopleError('employee_inactive', 'An inactive employee cannot clock in.');

    const latest = await this.repository.latestPunch(context.companyId, input.employeeId);
    if (punchType === 'clock_in' && latest !== null && latest.punchType === 'clock_in')
      throw new PeopleError('duplicate_clock_in', 'This employee already has an open clock-in.');
    if (punchType === 'clock_out' && latest?.punchType !== 'clock_in')
      throw new PeopleError('invalid_clock_out', 'There is no open clock-in to close for this employee.');

    const station = nonBlankOptional(input.station, 'station', 100);
    const id = randomUUID();
    const requestHash = hash({ employeeId: input.employeeId, punchType, station });
    return this.repository.transaction((client) =>
      this.repository.idempotent(
        client,
        context,
        operation,
        key,
        requestHash,
        'time_clock_punch',
        decodePunch,
        async () => {
          const row = await this.repository.insertPunch(client, {
            id,
            companyId: context.companyId,
            branchId: employee.branchId,
            employeeId: input.employeeId,
            punchType,
            occurredAt: context.timestamp,
            station,
            // TASK 16.28 — 'manual' is hardcoded here, never accepted from
            // the request body: this route is the ordinary self-service/
            // manager-recorded punch, and there is no attendance
            // terminal/fingerprint reader integrated yet (see
            // `docs/WORKFORCE_SYSTEM.md`). A future device adapter records
            // its own punches through a SEPARATE, device-authenticated
            // entry point that can honestly pass 'device'/'biometric' —
            // never by trusting an arbitrary client-supplied method here.
            method: 'manual',
            isCorrection: false,
            correctionReason: null,
            correctedPunchId: null,
            createdBy: context.actorId,
            timestamp: context.timestamp,
          });
          await this.repository.auditAndPublish(client, context, {
            action: punchType === 'clock_in' ? 'time_clock.clocked_in' : 'time_clock.clocked_out',
            resourceType: 'time_clock_punch',
            resourceId: row.id,
            eventType: punchType === 'clock_in' ? 'time_clock.clocked_in' : 'time_clock.clocked_out',
            branchId: row.branchId,
            payload: punchPayload(row),
          });
          return row;
        },
      ),
    );
  }

  public clockIn(
    context: PeopleMutationContext,
    branchIds: readonly string[],
    key: string,
    input: { employeeId: string; station?: string | null },
    actor: { userId: string; hasManagePermission: boolean },
  ): Promise<{ value: TimeClockPunchRow; replayed: boolean }> {
    return this.recordPunch(context, branchIds, key, 'time_clock.clock_in', 'clock_in', input, actor);
  }

  public clockOut(
    context: PeopleMutationContext,
    branchIds: readonly string[],
    key: string,
    input: { employeeId: string; station?: string | null },
    actor: { userId: string; hasManagePermission: boolean },
  ): Promise<{ value: TimeClockPunchRow; replayed: boolean }> {
    return this.recordPunch(context, branchIds, key, 'time_clock.clock_out', 'clock_out', input, actor);
  }

  public async correctPunch(
    context: PeopleMutationContext,
    branchIds: readonly string[],
    key: string,
    input: {
      employeeId: string;
      punchType: TimeClockPunchType;
      occurredAt: string;
      station?: string | null;
      correctionReason: string;
      correctedPunchId: string;
    },
  ): Promise<{ value: TimeClockPunchRow; replayed: boolean }> {
    const employee = await this.repository.employee(context.companyId, branchIds, input.employeeId);
    if (employee === null) throw new PeopleError('resource_not_found', 'The employee was not found.');
    const corrected = await this.repository.punch(context.companyId, branchIds, input.correctedPunchId);
    if (corrected?.employeeId !== input.employeeId)
      throw new PeopleError('resource_not_found', 'The punch being corrected was not found.');
    const occurredAt = new Date(input.occurredAt);
    if (Number.isNaN(occurredAt.getTime()))
      throw new PeopleError('validation_error', 'occurred_at must be a valid ISO-8601 timestamp.');
    const correctionReason = nonBlank(input.correctionReason, 'correction_reason', 1000);
    const station = nonBlankOptional(input.station, 'station', 100);

    const id = randomUUID();
    const requestHash = hash({
      employeeId: input.employeeId,
      punchType: input.punchType,
      occurredAt: occurredAt.toISOString(),
      correctedPunchId: input.correctedPunchId,
      correctionReason,
      station,
    });
    return this.repository.transaction((client) =>
      this.repository.idempotent(
        client,
        context,
        'time_clock.correct',
        key,
        requestHash,
        'time_clock_punch',
        decodePunch,
        async () => {
          const row = await this.repository.insertPunch(client, {
            id,
            companyId: context.companyId,
            branchId: employee.branchId,
            employeeId: input.employeeId,
            punchType: input.punchType,
            occurredAt,
            station,
            // TASK 16.28 — a correction is always a human (attendance.manage)
            // fixing a record; see `recordPunch`'s own identical comment.
            method: 'manual',
            isCorrection: true,
            correctionReason,
            correctedPunchId: input.correctedPunchId,
            createdBy: context.actorId,
            timestamp: context.timestamp,
          });
          await this.repository.auditAndPublish(client, context, {
            action: 'time_clock.corrected',
            resourceType: 'time_clock_punch',
            resourceId: row.id,
            eventType: 'time_clock.corrected',
            branchId: row.branchId,
            payload: punchPayload(row),
          });
          return row;
        },
      ),
    );
  }

  public listPunches(
    companyId: string,
    branchIds: readonly string[],
    input: { employeeId: string; dateFrom?: string; dateTo?: string; limit: number },
  ): Promise<TimeClockPunchRow[]> {
    return this.repository.listPunches(companyId, branchIds, input);
  }
}
