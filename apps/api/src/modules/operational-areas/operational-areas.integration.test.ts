import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createDatabaseClient, type DatabaseClient } from '@asone/database';

import { OperationalAreasRepository } from './operational-areas.repository.js';
import { OperationalAreasService } from './operational-areas.service.js';
import { OperationalAreaError, type OperationalAreaMutationContext } from './operational-areas.types.js';

/** TASK 16.15 — CRUD, idempotency, and isolation for `operational_areas`:
 * a generic, tenant-configured grouping of registers within one branch.
 * The multi-register accounting/consolidation behavior that actually
 * *uses* an area (simultaneous registers, branch consolidation, register-
 * scoped authorization) is covered end-to-end by
 * `../branch-consolidation/branch-consolidation.integration.test.ts` —
 * this file covers the module's own CRUD surface in isolation. */
const databaseUrl = process.env.DATABASE_TEST_URL;
const integration = databaseUrl === undefined ? describe.skip : describe;

integration('PostgreSQL operational areas (TASK 16.15)', { concurrent: false }, () => {
  let database: DatabaseClient;
  let repository: OperationalAreasRepository;
  let areas: OperationalAreasService;

  const companyId = randomUUID();
  const otherCompanyId = randomUUID();
  const branchId = randomUUID();
  const otherBranchId = randomUUID();
  const otherCompanyBranchId = randomUUID();
  // TASK 16.15 — `operational_areas.created_by`/`updated_by` are validated
  // by a composite FK against `(company_memberships.company_id,
  // company_memberships.user_id)` (`operational_areas_created_by_
  // membership_fk` / `..._updated_by_membership_fk`) — the *value* stored
  // is still the plain `users.id`, the FK just proves that user is
  // actually a member of this company. So `actorId` below is a user id,
  // and a `company_memberships` row for it must exist too.
  const actorId = randomUUID();
  const branchIds = [branchId, otherBranchId];

  function context(timestamp = new Date('2026-09-21T10:00:00.000Z')): OperationalAreaMutationContext {
    return { companyId, actorId, requestId: `req-${randomUUID()}`, correlationId: `corr-${randomUUID()}`, timestamp };
  }

  beforeAll(async () => {
    if (databaseUrl === undefined || !new URL(databaseUrl).pathname.toLowerCase().includes('test'))
      throw new Error('DATABASE_TEST_URL must identify a dedicated test database.');
    database = createDatabaseClient({ connectionString: databaseUrl, applicationName: 'asone-operational-areas-integration' });
    repository = new OperationalAreasRepository(database);
    areas = new OperationalAreasService(repository);

    await database.pool.query(
      `insert into companies(id,legal_name,display_name,slug,status,timezone,currency_code,locale)
       values($1,'OpArea Co','OpArea Co',$2,'active','America/Mexico_City','MXN','es-MX'),
             ($3,'OpArea Other Co','OpArea Other Co',$4,'active','UTC','MXN','es-MX')`,
      [companyId, `oparea-${companyId}`, otherCompanyId, `oparea-other-${otherCompanyId}`],
    );
    await database.pool.query(
      `insert into branches(id,company_id,name,code,status,timezone)
       values($1,$2,'Main Branch','MAIN','active','America/Mexico_City'),
             ($3,$2,'Second Branch','SECOND','active','America/Mexico_City'),
             ($4,$5,'Other Co Branch','OTHERCOBR','active','UTC')`,
      [branchId, companyId, otherBranchId, otherCompanyBranchId, otherCompanyId],
    );
    await database.pool.query(
      `insert into users(id,email,normalized_email,display_name,status) values($1,$2,$2,'OpArea Actor','active')`,
      [actorId, `actor-${actorId}@example.test`],
    );
    await database.pool.query(
      `insert into company_memberships(id,company_id,user_id,status) values($1,$2,$3,'active')`,
      [randomUUID(), companyId, actorId],
    );
  });

  afterAll(async () => {
    const companyIds = [companyId, otherCompanyId];
    await database.pool.query('delete from operational_areas where company_id=any($1::uuid[])', [companyIds]);
    await database.pool.query('delete from idempotency_keys where company_id=any($1::uuid[])', [companyIds]);
    await database.pool.query('delete from outbox_events where company_id=any($1::uuid[])', [companyIds]);
    await database.pool.query('delete from audit_log where company_id=any($1::uuid[])', [companyIds]);
    await database.pool.query('delete from company_memberships where company_id=any($1::uuid[])', [companyIds]);
    await database.pool.query('delete from branches where company_id=any($1::uuid[])', [companyIds]);
    await database.pool.query('delete from companies where id=any($1::uuid[])', [companyIds]);
    await database.pool.query('delete from users where id=$1', [actorId]);
    await database.close();
  });

  describe('create', () => {
    it('creates an active area scoped to the named branch, and reads it back', async () => {
      const created = await areas.create(context(), branchIds, `create-${randomUUID()}`, {
        branchId,
        code: 'admissions',
        name: 'Admissions',
      });
      expect(created.replayed).toBe(false);
      expect(created.value.status).toBe('active');
      expect(created.value.branchId).toBe(branchId);

      const read = await areas.area(companyId, branchIds, created.value.id);
      expect(read).toMatchObject({ id: created.value.id, code: 'admissions', name: 'Admissions', status: 'active' });
    });

    it('rejects a branch not authorized for this actor', async () => {
      await expect(
        areas.create(context(), [branchId], `create-unauth-${randomUUID()}`, {
          branchId: otherCompanyBranchId,
          code: 'sneaky',
          name: 'Sneaky',
        }),
      ).rejects.toMatchObject({ code: 'validation_error' } satisfies Partial<OperationalAreaError>);
    });

    it('rejects a blank name/code', async () => {
      await expect(
        areas.create(context(), branchIds, `create-blank-${randomUUID()}`, { branchId, code: '  ', name: 'Has code' }),
      ).rejects.toMatchObject({ code: 'validation_error' });
      await expect(
        areas.create(context(), branchIds, `create-blank2-${randomUUID()}`, { branchId, code: 'ok', name: '   ' }),
      ).rejects.toMatchObject({ code: 'validation_error' });
    });

    it('rejects a duplicate active code within the same branch, but the same code is free again in a different branch', async () => {
      const key = `create-dup-${randomUUID()}`;
      await areas.create(context(), branchIds, key, { branchId, code: 'food', name: 'Food' });
      await expect(
        areas.create(context(), branchIds, `create-dup-again-${randomUUID()}`, { branchId, code: 'food', name: 'Food Again' }),
      ).rejects.toMatchObject({ code: 'validation_error' });
      // Different branch, same tenant — no conflict; codes are scoped
      // per-branch, never globally per-company.
      const otherBranchArea = await areas.create(context(), branchIds, `create-dup-other-branch-${randomUUID()}`, {
        branchId: otherBranchId,
        code: 'food',
        name: 'Food (Second Branch)',
      });
      expect(otherBranchArea.value.branchId).toBe(otherBranchId);
    });

    it('is idempotent: the same key+payload replays the original result, a changed payload under the same key conflicts', async () => {
      const key = `create-idem-${randomUUID()}`;
      const first = await areas.create(context(), branchIds, key, { branchId, code: 'events', name: 'Events' });
      expect(first.replayed).toBe(false);
      const replay = await areas.create(context(), branchIds, key, { branchId, code: 'events', name: 'Events' });
      expect(replay.replayed).toBe(true);
      expect(replay.value.id).toBe(first.value.id);
      await expect(
        areas.create(context(), branchIds, key, { branchId, code: 'events', name: 'Events Renamed' }),
      ).rejects.toMatchObject({ code: 'idempotency_conflict' });
    });
  });

  describe('read/list', () => {
    it('never returns an area outside the caller\'s permitted branches — same 404 shape as an area that never existed', async () => {
      const created = await areas.create(context(), branchIds, `create-scope-${randomUUID()}`, {
        branchId,
        code: 'scope-test',
        name: 'Scope Test',
      });
      await expect(areas.area(companyId, [otherBranchId], created.value.id)).rejects.toMatchObject({
        code: 'resource_not_found',
      });
      await expect(areas.area(companyId, branchIds, randomUUID())).rejects.toMatchObject({ code: 'resource_not_found' });
    });

    it('tenant isolation — another company can never read this company\'s area by id, even with its own branch list', async () => {
      const created = await areas.create(context(), branchIds, `create-tenant-${randomUUID()}`, {
        branchId,
        code: 'tenant-test',
        name: 'Tenant Test',
      });
      const otherRepository = new OperationalAreasRepository(database);
      const otherAreas = new OperationalAreasService(otherRepository);
      await expect(otherAreas.area(otherCompanyId, [otherCompanyBranchId], created.value.id)).rejects.toMatchObject({
        code: 'resource_not_found',
      });
    });

    it('lists areas filtered by branch and status, paginated', async () => {
      const branchForListing = randomUUID();
      await database.pool.query(
        `insert into branches(id,company_id,name,code,status,timezone) values($1,$2,'Listing Branch','LISTBR','active','America/Mexico_City')`,
        [branchForListing, companyId],
      );
      const listBranchIds = [...branchIds, branchForListing];
      const a = await areas.create(context(), listBranchIds, `list-a-${randomUUID()}`, {
        branchId: branchForListing,
        code: 'list-a',
        name: 'List A',
      });
      const b = await areas.create(context(), listBranchIds, `list-b-${randomUUID()}`, {
        branchId: branchForListing,
        code: 'list-b',
        name: 'List B',
      });
      await areas.update(context(), listBranchIds, b.value.id, b.value.version, { status: 'inactive' });

      const activeOnly = await areas.list(companyId, listBranchIds, { branchId: branchForListing, status: 'active', limit: 10 });
      expect(activeOnly.items.map((item) => item.id)).toEqual([a.value.id]);

      const all = await areas.list(companyId, listBranchIds, { branchId: branchForListing, limit: 10 });
      expect(all.items.map((item) => item.id).sort()).toEqual([a.value.id, b.value.id].sort());

      const page1 = await areas.list(companyId, listBranchIds, { branchId: branchForListing, limit: 1 });
      expect(page1.items).toHaveLength(1);
      expect(page1.nextCursor).not.toBeNull();
      const page2 = await areas.list(companyId, listBranchIds, {
        branchId: branchForListing,
        limit: 1,
        ...(page1.nextCursor === null ? {} : { cursor: page1.nextCursor }),
      });
      expect(page2.items).toHaveLength(1);
      expect(page2.items[0]?.id).not.toBe(page1.items[0]?.id);
    });
  });

  describe('update', () => {
    it('renames and deactivates under optimistic-version control, rejecting a stale version', async () => {
      const created = await areas.create(context(), branchIds, `update-${randomUUID()}`, {
        branchId,
        code: 'update-test',
        name: 'Before',
      });
      const updated = await areas.update(context(), branchIds, created.value.id, created.value.version, {
        name: 'After',
        status: 'inactive',
      });
      expect(updated.name).toBe('After');
      expect(updated.status).toBe('inactive');
      expect(updated.version).toBe(created.value.version + 1n);

      await expect(
        areas.update(context(), branchIds, created.value.id, created.value.version, { name: 'Stale Write' }),
      ).rejects.toMatchObject({ code: 'version_conflict' });
    });

    it('rejects updating an area outside the caller\'s permitted branches', async () => {
      const created = await areas.create(context(), branchIds, `update-scope-${randomUUID()}`, {
        branchId,
        code: 'update-scope',
        name: 'Update Scope',
      });
      await expect(
        areas.update(context(), [otherBranchId], created.value.id, created.value.version, { name: 'Hijacked' }),
      ).rejects.toMatchObject({ code: 'resource_not_found' });
    });
  });

  describe('audit trail (TASK 16.15 §33)', () => {
    it('a create and an update each write a real audit_log row and outbox event — the same existing infrastructure every other module uses, never a bespoke one', async () => {
      const created = await areas.create(context(), branchIds, `audit-create-${randomUUID()}`, {
        branchId,
        code: 'audit-test',
        name: 'Audit Test',
      });
      const createdAudit = await database.pool.query<{ action: string; entity_id: string }>(
        `select action, entity_id from audit_log where company_id=$1 and entity_type='operational_area' and entity_id=$2 and action='operational_area.created'`,
        [companyId, created.value.id],
      );
      expect(createdAudit.rows).toHaveLength(1);
      const createdOutbox = await database.pool.query<{ event_type: string }>(
        `select event_type from outbox_events where company_id=$1 and aggregate_type='operational_area' and aggregate_id=$2 and event_type='operational_area.created'`,
        [companyId, created.value.id],
      );
      expect(createdOutbox.rows).toHaveLength(1);

      await areas.update(context(), branchIds, created.value.id, created.value.version, { name: 'Audited Rename' });
      const updatedAudit = await database.pool.query<{ action: string }>(
        `select action from audit_log where company_id=$1 and entity_type='operational_area' and entity_id=$2 and action='operational_area.updated'`,
        [companyId, created.value.id],
      );
      expect(updatedAudit.rows).toHaveLength(1);
    });
  });
});
