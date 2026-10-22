import { randomUUID } from 'node:crypto';

import Fastify, { type FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { createDatabaseClient, type DatabaseClient } from '@asone/database';
import { AppError } from '@asone/errors';

import type { AuthService } from '../auth/auth.service.js';
import type { AuthContext } from '../auth/auth.types.js';
import { CashRepository } from '../cash/cash.repository.js';
import { PartiesRepository } from './parties.repository.js';
import { PartyError, type PartyMutationContext } from './parties.types.js';
import { PartyPackagesService } from './party-packages.service.js';
import { registerPartyQuoteRoutes } from './party-quotes.routes.js';
import { PartyQuotesService } from './party-quotes.service.js';
import { PartyReservationsService } from './party-reservations.service.js';
import { PartyRoomsService } from './party-rooms.service.js';

/** TASK 17.6 — persisted party quotations (quote != reservation). */
const databaseUrl = process.env.DATABASE_TEST_URL;
const integration = databaseUrl === undefined ? describe.skip : describe;

function context(companyId: string, actorId: string): PartyMutationContext {
  return {
    companyId,
    actorId,
    requestId: `req-${randomUUID()}`,
    correlationId: `corr-${randomUUID()}`,
    timestamp: new Date('2026-10-01T10:00:00.000Z'),
    deviceId: undefined,
  };
}

async function expectPartyError(promise: Promise<unknown>, code: string): Promise<void> {
  const error = await promise.then(
    () => null,
    (caught: unknown) => caught,
  );
  expect(error).toBeInstanceOf(PartyError);
  expect((error as PartyError).code).toBe(code);
}

integration('PostgreSQL party quotes (TASK 17.6)', { concurrent: false }, () => {
  let database: DatabaseClient;
  let repository: PartiesRepository;
  let quotes: PartyQuotesService;
  let reservations: PartyReservationsService;

  const companyId = randomUUID();
  const otherCompanyId = randomUUID();
  const branchId = randomUUID();
  const otherBranchId = randomUUID();
  const otherCompanyBranchId = randomUUID();
  const userId = randomUUID();
  const otherCompanyUserId = randomUUID();
  const branchIds = [branchId];

  let roomId: string;
  let packageId: string;
  let otherBranchPackageId: string;

  beforeAll(async () => {
    if (databaseUrl === undefined || !new URL(databaseUrl).pathname.toLowerCase().includes('test'))
      throw new Error('DATABASE_TEST_URL must identify a dedicated test database.');
    database = createDatabaseClient({ connectionString: databaseUrl, applicationName: 'asone-party-quotes-integration' });
    await database.pool.query(
      `insert into companies(id,legal_name,display_name,slug,status,timezone,currency_code,locale)
       values($1,'Quotes Co','Quotes Co',$2,'active','UTC','MXN','es-MX'),
             ($3,'Other Quotes Co','Other Quotes Co',$4,'active','UTC','MXN','es-MX')`,
      [companyId, `quotes-${companyId}`, otherCompanyId, `quotes-${otherCompanyId}`],
    );
    await database.pool.query(
      `insert into branches(id,company_id,name,code,status,timezone)
       values($1,$2,'Quotes Main','QMAIN','active','UTC'),
             ($3,$2,'Quotes Second','QSECOND','active','UTC'),
             ($4,$5,'Quotes Other Co','QOTHER','active','UTC')`,
      [branchId, companyId, otherBranchId, otherCompanyBranchId, otherCompanyId],
    );
    await database.pool.query(
      `insert into users(id,email,normalized_email,display_name,status)
       values($1,$2,$2,'Quotes Seller','active'),($3,$4,$4,'Other Quotes User','active')`,
      [userId, `quotes-${userId}@example.test`, otherCompanyUserId, `quotes-${otherCompanyUserId}@example.test`],
    );
    await database.pool.query(
      `insert into company_memberships(id,company_id,user_id,status)
       values($1,$2,$3,'active'),($4,$5,$6,'active')`,
      [randomUUID(), companyId, userId, randomUUID(), otherCompanyId, otherCompanyUserId],
    );

    repository = new PartiesRepository(database);
    const rooms = new PartyRoomsService(repository);
    const packages = new PartyPackagesService(repository);
    quotes = new PartyQuotesService(repository);
    reservations = new PartyReservationsService(repository, new CashRepository(database));

    roomId = (
      await rooms.createRoom(context(companyId, userId), [branchId, otherBranchId], `room-${randomUUID()}`, {
        branchId,
        code: 'Q-A',
        name: 'Salon Cotizado',
        capacityChildren: 40,
        capacityAdults: 20,
      })
    ).value.id;
    packageId = (
      await packages.createPackage(context(companyId, userId), [branchId, otherBranchId], `pkg-${randomUUID()}`, {
        branchId,
        code: 'QBASIC',
        name: 'Paquete Basico',
        price: '3500.0000',
        durationMinutes: 120,
        childrenIncluded: 10,
        adultsIncluded: 5,
        childExtraCost: '80.0000',
        adultExtraCost: '50.0000',
        extraHalfHourCost: '250.0000',
      })
    ).value.id;
    otherBranchPackageId = (
      await packages.createPackage(context(companyId, userId), [branchId, otherBranchId], `pkg2-${randomUUID()}`, {
        branchId: otherBranchId,
        code: 'QOTHER',
        name: 'Paquete Otra Sucursal',
        price: '1000.0000',
        durationMinutes: 60,
        childrenIncluded: 5,
        adultsIncluded: 2,
        childExtraCost: '10.0000',
        adultExtraCost: '10.0000',
        extraHalfHourCost: '10.0000',
      })
    ).value.id;
  });

  afterAll(async () => {
    const ids = [[companyId, otherCompanyId]];
    await database.pool.query('delete from party_quotes where company_id=any($1)', ids);
    await database.pool.query('delete from party_reservation_snacks where company_id=any($1)', ids);
    await database.pool.query('delete from party_reservation_socks where company_id=any($1)', ids);
    await database.pool.query('delete from party_reservations where company_id=any($1)', ids);
    await database.pool.query('delete from party_packages where company_id=any($1)', ids);
    await database.pool.query('delete from party_rooms where company_id=any($1)', ids);
    await database.pool.query('delete from idempotency_keys where company_id=any($1)', ids);
    await database.pool.query('delete from outbox_events where company_id=any($1)', ids);
    await database.pool.query('delete from audit_log where company_id=any($1)', ids);
    await database.pool.query('delete from company_memberships where company_id=any($1)', ids);
    await database.pool.query('delete from branches where company_id=any($1)', ids);
    await database.pool.query('delete from companies where id=any($1)', ids);
    await database.pool.query('delete from users where id=any($1)', [[userId, otherCompanyUserId]]);
    await database.close();
  });

  const create = (extra: Record<string, unknown> = {}, key = `q-${randomUUID()}`): ReturnType<PartyQuotesService['createQuote']> =>
    quotes.createQuote(context(companyId, userId), branchIds, key, {
      branchId,
      packageId,
      childrenCount: 12, // 2 over 10 included -> 160 extra -> 3660 subtotal -> 4245.60 with 16% IVA
      adultsCount: 5,
      ...extra,
    });

  it('saves a quote with a frozen package snapshot and server-computed amounts, and reloads it from a fresh repository', async () => {
    const created = await create({ notes: 'Pastel de chocolate' });
    expect(created.value.status).toBe('draft');
    expect(created.value.quoteNumber).toMatch(/^COT-/);
    expect(created.value.subtotalAmount).toBe('3660.0000');
    expect(created.value.taxTotal).toBe('585.6000');
    expect(created.value.totalAmount).toBe('4245.6000');
    expect(created.value.packageSnapshot.package_name).toBe('Paquete Basico');
    expect(created.value.packageSnapshot.price).toBe('3500.0000');
    expect(created.value.sellerUserId).toBe(userId);

    const reread = await new PartiesRepository(database).quote(companyId, created.value.id);
    expect(reread?.totalAmount).toBe('4245.6000');
    expect(reread?.notes).toBe('Pastel de chocolate');
    expect(reread?.breakdown.children_extra).toBe('160.0000');
  });

  it('does not create a reservation, block a room or touch payments by saving a quote', async () => {
    const before = await database.pool.query<{ n: string }>('select count(*)::text n from party_reservations where company_id=$1', [companyId]);
    const q = await create();
    const after = await database.pool.query<{ n: string }>('select count(*)::text n from party_reservations where company_id=$1', [companyId]);
    expect(after.rows[0]?.n).toBe(before.rows[0]?.n);
    expect(q.value.convertedReservationId).toBeNull();
  });

  it('replays an idempotent create without duplicating, and rejects the same key with a different body', async () => {
    const key = `q-idem-${randomUUID()}`;
    const first = await create({ notes: 'idem' }, key);
    const second = await create({ notes: 'idem' }, key);
    expect(second.replayed).toBe(true);
    expect(second.value.id).toBe(first.value.id);
    expect(second.value.createdAt).toBeInstanceOf(Date);
    const count = await database.pool.query<{ n: string }>(
      'select count(*)::text n from party_quotes where company_id=$1 and notes=$2',
      [companyId, 'idem'],
    );
    expect(count.rows[0]?.n).toBe('1');
    await expect(create({ notes: 'idem', childrenCount: 3 }, key)).rejects.toBeDefined();
  });

  it('writes an audit entry for create, update and cancel', async () => {
    const q = await create({ notes: 'audit-me' });
    await quotes.updateQuote(context(companyId, userId), branchIds, q.value.id, q.value.version, { notes: 'audit-me-2' });
    const row = await quotes.quote(companyId, branchIds, q.value.id);
    await quotes.cancelQuote(context(companyId, userId), branchIds, `c-${randomUUID()}`, q.value.id, 'Cliente desistio');
    const audit = await database.pool.query<{ action: string }>(
      `select action from audit_log where company_id=$1 and entity_type='party_quote' and entity_id=$2 order by occurred_at`,
      [companyId, q.value.id],
    );
    const actions = audit.rows.map((r) => r.action);
    expect(actions).toEqual(expect.arrayContaining(['party_quote.created', 'party_quote.updated', 'party_quote.cancelled']));
    expect(row.version).toBe(q.value.version + 1n);
  });

  it('keeps a saved quote frozen when the package price changes, and still prices a NEW quote at the new price', async () => {
    const q = await create();
    await database.pool.query(`update party_packages set price='9000.0000', name='Paquete Renombrado' where id=$1`, [packageId]);
    try {
      const reread = await quotes.quote(companyId, branchIds, q.value.id);
      expect(reread.totalAmount).toBe('4245.6000');
      expect(reread.packageSnapshot.price).toBe('3500.0000');
      expect(reread.packageSnapshot.package_name).toBe('Paquete Basico');

      // Editing only non-pricing fields must NOT re-price from the changed package.
      const edited = await quotes.updateQuote(context(companyId, userId), branchIds, q.value.id, reread.version, {
        notes: 'solo notas',
        eventDate: '2028-03-01',
      });
      expect(edited.totalAmount).toBe('4245.6000');
      expect(edited.packageSnapshot.price).toBe('3500.0000');
      expect(edited.version).toBe(reread.version + 1n);

      // A NEW quote is priced from the package as it is now.
      const fresh = await create();
      expect(fresh.value.packageSnapshot.price).toBe('9000.0000');
      expect(fresh.value.subtotalAmount).not.toBe('3660.0000');
    } finally {
      await database.pool.query(`update party_packages set price='3500.0000', name='Paquete Basico' where id=$1`, [packageId]);
    }
  });

  it('re-prices only when a pricing input changes, and guards against stale edits', async () => {
    const q = await create({ childrenCount: 10, adultsCount: 5 });
    expect(q.value.subtotalAmount).toBe('3500.0000');
    const repriced = await quotes.updateQuote(context(companyId, userId), branchIds, q.value.id, q.value.version, {
      childrenCount: 12,
      extraHalfHours: 1,
    });
    // base 3500 + 2*80 + 1*250 = 3910; +16% = 4535.60
    expect(repriced.subtotalAmount).toBe('3910.0000');
    expect(repriced.totalAmount).toBe('4535.6000');
    await expectPartyError(
      quotes.updateQuote(context(companyId, userId), branchIds, q.value.id, q.value.version, { notes: 'stale' }),
      'version_conflict',
    );
  });

  it('cancels with a reason and refuses further edits, cancels or conversion', async () => {
    const q = await create();
    await expectPartyError(quotes.cancelQuote(context(companyId, userId), branchIds, `c-${randomUUID()}`, q.value.id, 'x'), 'validation_error');
    const cancelled = await quotes.cancelQuote(context(companyId, userId), branchIds, `c-${randomUUID()}`, q.value.id, 'Cliente desistio');
    expect(cancelled.value.status).toBe('cancelled');
    expect(cancelled.value.cancelReason).toBe('Cliente desistio');
    expect(cancelled.value.cancelledAt).toBeInstanceOf(Date);
    await expectPartyError(
      quotes.updateQuote(context(companyId, userId), branchIds, q.value.id, cancelled.value.version, { notes: 'late' }),
      'quote_not_editable',
    );
    await expectPartyError(
      quotes.cancelQuote(context(companyId, userId), branchIds, `c-${randomUUID()}`, q.value.id, 'otra vez'),
      'quote_not_editable',
    );
    await expectPartyError(
      reservations.createReservation(context(companyId, userId), branchIds, `r-${randomUUID()}`, {
        branchId,
        roomId,
        packageId,
        eventDate: '2028-04-01',
        startTime: '10:00',
        endTime: '12:00',
        childrenCount: 12,
        adultsCount: 5,
        quoteId: q.value.id,
      }),
      'quote_not_editable',
    );
  });

  it('isolates quotes by branch scope and company, with 404 semantics', async () => {
    const q = await create();
    await expectPartyError(quotes.quote(companyId, [otherBranchId], q.value.id), 'resource_not_found');
    await expectPartyError(quotes.quote(otherCompanyId, [otherCompanyBranchId], q.value.id), 'resource_not_found');
    await expectPartyError(
      quotes.updateQuote(context(companyId, userId), [otherBranchId], q.value.id, q.value.version, { notes: 'x' }),
      'resource_not_found',
    );
    await expectPartyError(quotes.createQuote(context(companyId, userId), branchIds, `q-${randomUUID()}`, { branchId: otherBranchId, packageId }), 'validation_error');
    // A package of another branch cannot price a quote for this branch.
    await expectPartyError(create({ packageId: otherBranchPackageId }), 'resource_not_found');

    const listed = await quotes.listQuotes(companyId, branchIds, { limit: 100 });
    expect(listed.items.some((item) => item.id === q.value.id)).toBe(true);
    const hidden = await quotes.listQuotes(companyId, [otherBranchId], { limit: 100 });
    expect(hidden.items.some((item) => item.id === q.value.id)).toBe(false);
    const foreign = await quotes.listQuotes(otherCompanyId, [otherCompanyBranchId], { limit: 100 });
    expect(foreign.items).toHaveLength(0);
  });

  it('paginates the quote list newest-first with a cursor and filters by status', async () => {
    const a = await create({ notes: 'page-a' });
    const b = await create({ notes: 'page-b' });
    await quotes.cancelQuote(context(companyId, userId), branchIds, `c-${randomUUID()}`, b.value.id, 'prueba paginacion');
    const first = await quotes.listQuotes(companyId, branchIds, { limit: 1 });
    expect(first.items).toHaveLength(1);
    expect(first.nextCursor).not.toBeNull();
    const second = await quotes.listQuotes(companyId, branchIds, { limit: 1, cursor: first.nextCursor ?? '' });
    expect(second.items[0]?.id).not.toBe(first.items[0]?.id);
    const cancelledOnly = await quotes.listQuotes(companyId, branchIds, { limit: 100, status: 'cancelled' });
    expect(cancelledOnly.items.every((item) => item.status === 'cancelled')).toBe(true);
    expect(cancelledOnly.items.some((item) => item.id === b.value.id)).toBe(true);
    expect(cancelledOnly.items.some((item) => item.id === a.value.id)).toBe(false);
  });

  describe('explicit quote -> reservation conversion', () => {
    it('creates the reservation from the FROZEN amounts, links the quote, and refuses a second conversion', async () => {
      const q = await create({ notes: 'convertir' });
      await database.pool.query(`update party_packages set price='9000.0000' where id=$1`, [packageId]);
      try {
        const key = `conv-${randomUUID()}`;
        const input = {
          branchId,
          roomId,
          packageId,
          eventDate: '2028-05-01',
          startTime: '10:00',
          endTime: '12:00',
          childrenCount: 12,
          adultsCount: 5,
          quoteId: q.value.id,
        };
        const converted = await reservations.createReservation(context(companyId, userId), branchIds, key, input);
        expect(converted.value.quotedTotal).toBe('4245.6000'); // frozen, not 9000-based
        expect(converted.value.subtotalAmount).toBe('3660.0000');
        expect(converted.value.packageNameSnapshot).toBe('Paquete Basico');

        const linked = await quotes.quote(companyId, branchIds, q.value.id);
        expect(linked.status).toBe('converted');
        expect(linked.convertedReservationId).toBe(converted.value.id);
        expect(linked.convertedAt).toBeInstanceOf(Date);

        // Same idempotency key: replay, no second reservation.
        const replay = await reservations.createReservation(context(companyId, userId), branchIds, key, input);
        expect(replay.replayed).toBe(true);
        expect(replay.value.id).toBe(converted.value.id);

        // Different key: the quote is already converted -> no duplicate reservation.
        await expectPartyError(
          reservations.createReservation(context(companyId, userId), branchIds, `conv-${randomUUID()}`, {
            ...input,
            eventDate: '2028-05-02',
          }),
          'quote_not_editable',
        );
        const linkedCount = await database.pool.query<{ n: string }>(
          `select count(*)::text n from party_quotes where converted_reservation_id=$1`,
          [converted.value.id],
        );
        expect(linkedCount.rows[0]?.n).toBe('1');
        await expectPartyError(
          quotes.updateQuote(context(companyId, userId), branchIds, q.value.id, linked.version, { notes: 'x' }),
          'quote_not_editable',
        );
      } finally {
        await database.pool.query(`update party_packages set price='3500.0000' where id=$1`, [packageId]);
      }
    });

    it('lets exactly one of two concurrent conversions win (no duplicate reservation)', async () => {
      const q = await create();
      const attempt = (date: string): Promise<string> =>
        reservations
          .createReservation(context(companyId, userId), branchIds, `conv-${randomUUID()}`, {
            branchId,
            roomId,
            packageId,
            eventDate: date,
            startTime: '10:00',
            endTime: '12:00',
            childrenCount: 12,
            adultsCount: 5,
            quoteId: q.value.id,
          })
          .then(
            () => 'ok' as const,
            (error: unknown) => (error as PartyError).code,
          );
      const outcomes = await Promise.all([attempt('2028-08-01'), attempt('2028-08-02')]);
      expect(outcomes.filter((outcome) => outcome === 'ok')).toHaveLength(1);
      expect(outcomes.filter((outcome) => outcome === 'quote_not_editable')).toHaveLength(1);
      const linked = await database.pool.query<{ n: string }>(
        `select count(*)::text n from party_reservations where company_id=$1 and event_date in ('2028-08-01','2028-08-02')`,
        [companyId],
      );
      expect(linked.rows[0]?.n).toBe('1');
      expect((await quotes.quote(companyId, branchIds, q.value.id)).status).toBe('converted');
    });

    it('rejects a conversion whose guests/package do not match the quote, leaving the quote draft', async () => {
      const q = await create();
      await expectPartyError(
        reservations.createReservation(context(companyId, userId), branchIds, `conv-${randomUUID()}`, {
          branchId,
          roomId,
          packageId,
          eventDate: '2028-06-01',
          startTime: '10:00',
          endTime: '12:00',
          childrenCount: 20,
          adultsCount: 5,
          quoteId: q.value.id,
        }),
        'validation_error',
      );
      expect((await quotes.quote(companyId, branchIds, q.value.id)).status).toBe('draft');
    });

    it('does not convert a quote of a branch outside the actor scope, leaving it a draft', async () => {
      const q = await create();
      expect((await quotes.quote(companyId, branchIds, q.value.id)).status).toBe('draft');
      await expectPartyError(
        reservations.createReservation(context(companyId, userId), [otherBranchId], `conv-${randomUUID()}`, {
          branchId: otherBranchId,
          roomId,
          packageId,
          eventDate: '2028-07-02',
          startTime: '10:00',
          endTime: '12:00',
          childrenCount: 12,
          adultsCount: 5,
          quoteId: q.value.id,
        }),
        'resource_not_found',
      );
      expect((await quotes.quote(companyId, branchIds, q.value.id)).status).toBe('draft');
    });
  });

  describe('printable document', () => {
    it('renders the SAVED quote (snapshot + frozen amounts), escapes input, and audits generation', async () => {
      const q = await create({ notes: '<script>alert(1)</script> & "pastel"' });
      await database.pool.query(`update party_packages set name='Nombre Nuevo', price='9999.0000' where id=$1`, [packageId]);
      try {
        const html = await quotes.document(context(companyId, userId), branchIds, q.value.id);
        expect(html).toContain(q.value.quoteNumber);
        expect(html).toContain('Quotes Co');
        expect(html).toContain('Quotes Main');
        expect(html).toContain('Quotes Seller');
        expect(html).toContain('Paquete Basico');
        expect(html).not.toContain('Nombre Nuevo');
        expect(html).toContain('$4,245.60');
        expect(html).toContain('$3,660.00');
        expect(html).toContain('Borrador');
        expect(html).not.toContain('<script>alert(1)</script>');
        expect(html).toContain('&lt;script&gt;');
        const audit = await database.pool.query<{ n: string }>(
          `select count(*)::text n from audit_log where company_id=$1 and entity_id=$2 and action='party_quote.document_generated'`,
          [companyId, q.value.id],
        );
        expect(audit.rows[0]?.n).toBe('1');
      } finally {
        await database.pool.query(`update party_packages set name='Paquete Basico', price='3500.0000' where id=$1`, [packageId]);
      }
    });

    it('is not available for a quote outside the actor scope', async () => {
      const q = await create();
      await expectPartyError(quotes.document(context(companyId, userId), [otherBranchId], q.value.id), 'resource_not_found');
    });
  });

  describe('HTTP layer', () => {
    function buildApp(permissions: string[], permitted: string[]): FastifyInstance {
      const authContext: AuthContext = {
        sessionId: randomUUID(),
        userId,
        membershipId: randomUUID(),
        companyId,
        branchId,
        expiresAt: new Date(Date.now() + 60_000),
        companyWideAccess: false,
        permissions,
        permittedBranchIds: permitted,
      };
      const authentication = {
        authenticate: vi.fn(() => Promise.resolve(authContext)),
        requirePermission: vi.fn((_context: AuthContext, permission: string) => {
          if (!authContext.permissions.includes(permission))
            throw new AppError({ code: 'permission_denied', message: 'Permission denied.', statusCode: 403 });
        }),
        requireBranchAccess: vi.fn((_context: AuthContext, requested: string) => {
          if (!authContext.permittedBranchIds.includes(requested))
            throw new AppError({ code: 'permission_denied', message: 'Branch not permitted.', statusCode: 403 });
        }),
      } as unknown as AuthService;
      const app = Fastify();
      app.addHook('onRequest', (request, _reply, done) => {
        request.requestContext = {
          requestId: randomUUID(),
          correlationId: randomUUID(),
          companyId: undefined,
          branchId: undefined,
          userId: undefined,
          sessionId: undefined,
          deviceId: undefined,
        };
        done();
      });
      app.setErrorHandler((error, request, reply) => {
        if (error instanceof AppError)
          return reply.code(error.statusCode).send({
            error: { code: error.code, message: error.message },
            meta: { request_id: request.requestContext.requestId, correlation_id: request.requestContext.correlationId },
          });
        return reply.code(500).send({ error: { code: 'internal_error', message: (error as Error).message } });
      });
      registerPartyQuoteRoutes(app, authentication, quotes);
      return app;
    }

    const headers = (): Record<string, string> => ({ authorization: 'Bearer x', 'idempotency-key': `http-${randomUUID()}`, 'content-type': 'application/json' });

    it('creates (201 + etag), reads, edits with If-Match, lists and prints a quote over HTTP', async () => {
      const app = buildApp(['party.read', 'party.manage'], [branchId]);
      await app.ready();
      try {
        const createdResponse = await app.inject({
          method: 'POST',
          url: '/api/v1/party-quotes',
          headers: headers(),
          payload: { branch_id: branchId, package_id: packageId, children_count: 12, adults_count: 5, notes: 'http' },
        });
        expect(createdResponse.statusCode).toBe(201);
        const created = createdResponse.json<{ data: { id: string; total_amount: string; version: string; status: string } }>().data;
        expect(created.total_amount).toBe('4245.6000');
        expect(created.status).toBe('draft');
        expect(createdResponse.headers.etag).toBe(`"${created.version}"`);

        const one = await app.inject({ method: 'GET', url: `/api/v1/party-quotes/${created.id}`, headers: { authorization: 'Bearer x' } });
        expect(one.statusCode).toBe(200);

        const patched = await app.inject({
          method: 'PATCH',
          url: `/api/v1/party-quotes/${created.id}`,
          headers: { authorization: 'Bearer x', 'if-match': `"${created.version}"`, 'content-type': 'application/json' },
          payload: { notes: 'editado' },
        });
        expect(patched.statusCode).toBe(200);
        const stale = await app.inject({
          method: 'PATCH',
          url: `/api/v1/party-quotes/${created.id}`,
          headers: { authorization: 'Bearer x', 'if-match': `"${created.version}"`, 'content-type': 'application/json' },
          payload: { notes: 'otra vez' },
        });
        expect(stale.statusCode).toBe(409);

        const list = await app.inject({ method: 'GET', url: `/api/v1/party-quotes?branch_id=${branchId}&status=draft`, headers: { authorization: 'Bearer x' } });
        expect(list.statusCode).toBe(200);
        expect(list.json<{ data: { id: string }[] }>().data.some((row) => row.id === created.id)).toBe(true);

        const doc = await app.inject({ method: 'GET', url: `/api/v1/party-quotes/${created.id}/document`, headers: { authorization: 'Bearer x' } });
        expect(doc.statusCode).toBe(200);
        expect(doc.headers['content-type']).toContain('text/html');
        expect(doc.body).toContain('Cotización');
      } finally {
        await app.close();
      }
    });

    it('enforces permissions and branch scope on the server (403 without party.manage, 403 for a foreign branch, 404 out of scope)', async () => {
      const readOnly = buildApp(['party.read'], [branchId]);
      await readOnly.ready();
      const noRead = buildApp([], [branchId]);
      await noRead.ready();
      const otherBranchOnly = buildApp(['party.read', 'party.manage'], [otherBranchId]);
      await otherBranchOnly.ready();
      try {
        const attempt = await readOnly.inject({
          method: 'POST',
          url: '/api/v1/party-quotes',
          headers: headers(),
          payload: { branch_id: branchId, package_id: packageId },
        });
        expect(attempt.statusCode).toBe(403);
        expect((await noRead.inject({ method: 'GET', url: '/api/v1/party-quotes', headers: { authorization: 'Bearer x' } })).statusCode).toBe(403);

        const foreignBranch = await otherBranchOnly.inject({
          method: 'POST',
          url: '/api/v1/party-quotes',
          headers: headers(),
          payload: { branch_id: branchId, package_id: packageId },
        });
        expect(foreignBranch.statusCode).toBe(403);

        const q = await create();
        const hidden = await otherBranchOnly.inject({ method: 'GET', url: `/api/v1/party-quotes/${q.value.id}`, headers: { authorization: 'Bearer x' } });
        expect(hidden.statusCode).toBe(404);
        const hiddenDoc = await otherBranchOnly.inject({ method: 'GET', url: `/api/v1/party-quotes/${q.value.id}/document`, headers: { authorization: 'Bearer x' } });
        expect(hiddenDoc.statusCode).toBe(404);
      } finally {
        await readOnly.close();
        await noRead.close();
        await otherBranchOnly.close();
      }
    });
  });
});
