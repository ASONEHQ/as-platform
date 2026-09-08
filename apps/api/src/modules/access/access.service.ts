import { randomBytes, randomUUID } from 'node:crypto';
import { createHash } from 'node:crypto';

import type { AccessRepository } from './access.repository.js';
import {
  AccessError,
  type AccessCredentialRow,
  type AccessEventRow,
  type AccessEventType,
  type AccessMutationContext,
} from './access.types.js';

/**
 * Minimal structural interface (not an import of the concrete
 * `SalesRepository` class) so this module never depends on the sales
 * module's own internals — mirrors `held-sales.service.ts`'s own
 * `SaleExistenceLookup` convention exactly. `SalesRepository.sale(companyId,
 * id)` already returns an object with these three fields (`SaleRow`), so
 * it can be passed in directly with no adapter.
 *
 * "Reuse real commercial facts, never invent a parallel financial
 * system" (this task's own instruction) — a credential's `saleId` is
 * always validated against this REAL `sales` row: it must exist in the
 * SAME company, belong to the SAME branch the credential is being issued
 * for, and be genuinely `completed` (§21.2's real "paid" terminal state —
 * see `sales.types.ts`'s own doc comment on `SaleStatus`). Never trusted
 * blindly from the request body.
 */
export interface SaleForCredentialLookup {
  sale(companyId: string, id: string): Promise<{ id: string; branchId: string; status: string } | null>;
}

function hash(value: object): string {
  return createHash('sha256')
    .update(JSON.stringify(Object.fromEntries(Object.entries(value).sort())))
    .digest('hex');
}
function nonBlank(value: string, field: string): string {
  const clean = value.trim();
  if (clean.length === 0) throw new AccessError('validation_error', `${field} cannot be blank.`);
  if (clean.length > 200) throw new AccessError('validation_error', `${field} is too long.`);
  return clean;
}

/**
 * Code generation strategy (this task's own explicit call, documented
 * here): `AC-` + 5 random bytes, hex-encoded and upper-cased — 10 hex
 * characters after the prefix, mirroring `MembershipsRepository.
 * generateMembershipNumber`'s own identical `randomBytes(5)` shape
 * exactly (never a project-invented variant). This is deliberately SHORT
 * ENOUGH to print on a wristband/ticket or be typed in by hand at a gate
 * if a scanner is unavailable, while still carrying 40 bits of real
 * randomness — practically unguessable for a physical day-pass (nobody is
 * brute-forcing a park gate scanner over a network; the real threat model
 * here is "don't let two independently-issued passes collide", which
 * `access_credentials_company_code_uq` enforces for real at the DB layer
 * regardless of this function's own odds). A `reward_entitlement_tokens`-
 * style long `randomBytes(24).toString('base64url')` QR token was
 * considered and rejected: those tokens are only ever scanned by a
 * camera, never hand-typed, which is not the day-to-day gate-staff reality
 * this domain targets.
 */
function generateAccessCode(): string {
  return `AC-${randomBytes(5).toString('hex').toUpperCase()}`;
}

function credentialPayload(value: AccessCredentialRow): Readonly<Record<string, unknown>> {
  return {
    access_credential_id: value.id,
    branch_id: value.branchId,
    status: value.status,
    currently_inside: value.currentlyInside,
  };
}

export class AccessService {
  public constructor(
    private readonly repository: AccessRepository,
    private readonly salesLookup: SaleForCredentialLookup,
  ) {}

  /**
   * **Issuance permission** (documented design call, per this task's own
   * instruction): gated by `access.scan`, NOT a separate "issue"
   * permission — none was seeded specifically for issuance apart from
   * `access.scan` (see `technical-permissions.ts`'s own comment on this
   * exact pair). This mirrors the legacy's own real single-action
   * "scan-in" concept: issuance naturally happens at the gate/point of
   * sale by the same day-to-day gate-staff actor who will also be
   * scanning credentials, not as a separate admin step gated behind
   * `access.manage`. A park that wants issuance restricted to a different
   * actor than day-to-day scanning can already achieve that today by
   * granting `access.scan` to a narrower role than the one that also
   * holds `access.manage` — no additional permission code is needed for
   * that distinction.
   *
   * Idempotency: REQUIRED (mirrors `HeldSaleCartsService.createCart`/
   * `PurchasingService.createDirectPurchase`'s own established pattern
   * exactly) — a duplicate issuance request (e.g. a network retry after
   * the first request's response was lost) must not create two
   * credentials for the same sale.
   */
  public async issueCredential(
    context: AccessMutationContext,
    branchIds: readonly string[],
    key: string,
    input: { branchId: string; saleId: string; customerId?: string; allowsReentry?: boolean },
  ): Promise<{ value: AccessCredentialRow; replayed: boolean }> {
    if (!branchIds.includes(input.branchId))
      throw new AccessError('validation_error', 'The branch is not authorized for this actor.');
    const saleId = nonBlank(input.saleId, 'sale_id');
    const customerId = input.customerId === undefined ? null : nonBlank(input.customerId, 'customer_id');
    const allowsReentry = input.allowsReentry ?? false;
    const requestHash = hash({ branchId: input.branchId, saleId, customerId, allowsReentry });
    return this.repository.transaction((client) =>
      this.repository.idempotent(
        client,
        context,
        'access_credential.issue',
        key,
        requestHash,
        'access_credential',
        decodeCredential,
        async () => {
          // Real, already-paid sale required — never a bare, unaccountable
          // code (see this file's own doc comment on `SaleForCredentialLookup`).
          const sale = await this.salesLookup.sale(context.companyId, saleId);
          if (sale === null) throw new AccessError('validation_error', 'The sale was not found.');
          if (sale.branchId !== input.branchId)
            throw new AccessError('validation_error', 'The sale does not belong to this branch.');
          if (sale.status !== 'completed')
            throw new AccessError('validation_error', 'The sale is not completed — only a paid sale may issue a credential.');

          // The code is server-generated, never client-supplied — a
          // collision against `access_credentials_company_code_uq` is
          // therefore this module's own problem to retry, not a client
          // input error. Astronomically unlikely at 40 bits of randomness
          // per attempt; a handful of retries is a generous, honest
          // safety margin, never a silent infinite loop.
          //
          // A `SAVEPOINT` around each attempt is required, not optional:
          // once ANY statement inside a Postgres transaction errors (a
          // unique-violation included), the whole transaction is left in
          // an aborted state and every subsequent statement is rejected
          // until a rollback — so a plain retry-in-place would silently
          // fail on the second attempt. Rolling back to a savepoint (not
          // the whole transaction) clears just that one failed `INSERT`,
          // keeping the `idempotency_keys` placeholder row this
          // transaction already wrote intact.
          const id = randomUUID();
          let lastError: unknown;
          for (let attempt = 0; attempt < 5; attempt += 1) {
            await client.query('savepoint access_code_attempt');
            try {
              const created = await this.repository.insertCredential(client, {
                id,
                companyId: context.companyId,
                branchId: input.branchId,
                code: generateAccessCode(),
                saleId,
                customerId,
                allowsReentry,
                issuedBy: context.actorId,
                timestamp: context.timestamp,
              });
              await this.repository.auditAndPublish(client, context, {
                action: 'access_credential.issued',
                resourceType: 'access_credential',
                resourceId: created.id,
                eventType: 'access_credential.issued',
                branchId: created.branchId,
                generation: 1n,
                payload: credentialPayload(created),
              });
              return created;
            } catch (error) {
              lastError = error;
              const isCodeCollision =
                typeof error === 'object' &&
                error !== null &&
                'constraint' in error &&
                (error as { constraint?: unknown }).constraint === 'access_credentials_company_code_uq';
              await client.query('rollback to savepoint access_code_attempt');
              if (!isCodeCollision) throw error;
            }
          }
          throw lastError instanceof Error ? lastError : new Error('Could not generate a unique access code.');
        },
      ),
    );
  }

  public async credential(companyId: string, branchIds: readonly string[], id: string): Promise<AccessCredentialRow> {
    const value = await this.repository.credential(companyId, id);
    if (value === null || !branchIds.includes(value.branchId))
      throw new AccessError('resource_not_found', 'The access credential was not found.');
    return value;
  }

  /**
   * The real replacement for the legacy's fake scanner. **Design call**
   * (documented per this task's own instruction): ONE endpoint that
   * infers entry-vs-exit from the credential's own `currentlyInside`
   * state, rather than two explicit endpoints — the simplest real
   * interaction for gate staff (scan the same code on the way in and on
   * the way out; the system already knows which direction is valid next,
   * there is no need to make a human pick). Concurrency correctness does
   * NOT depend on this inference being race-free by itself — it is only
   * a best-effort intent guess; the actual CAS `UPDATE` in
   * `AccessRepository.markEntry`/`markExit` is the real, race-free
   * guarantee (see those methods' own doc comments), and this method
   * always re-reads the row to report the honest, specific reason when
   * the guarded `UPDATE` affects zero rows — including when the guessed
   * direction itself turned out to be stale.
   *
   * **Idempotency**: deliberately NOT idempotency-keyed (unlike
   * `issueCredential`/`voidCredential`). A scan is "an action with a
   * natural result" (this task's own phrase) — its own CAS guard already
   * makes a network-retried duplicate scan of the SAME code land on a
   * clean, deterministic, and CORRECT rejection (`already_inside` for a
   * retried entry, `not_inside` for a retried exit) rather than silently
   * re-processing or duplicating anything; there is no unsafe "processed
   * twice" outcome an idempotency key would need to prevent here, unlike
   * `issueCredential` (which would otherwise create a second, real,
   * billable-adjacent credential) or `voidCredential` (an irreversible-
   * feeling terminal action a cashier should not risk double-submitting
   * under a flaky connection without a safety net).
   */
  public async scan(
    context: AccessMutationContext,
    branchId: string,
    code: string,
  ): Promise<{ credential: AccessCredentialRow; event: AccessEventRow }> {
    const cleanCode = nonBlank(code, 'code');
    return this.repository.transaction(async (client) => {
      const credential = await this.repository.credentialByCode(client, context.companyId, cleanCode);
      if (credential === null) throw new AccessError('credential_not_found', 'This code is not recognized.');
      if (credential.status === 'void') throw new AccessError('credential_void', 'This credential has been voided.');
      if (credential.branchId !== branchId)
        throw new AccessError('wrong_branch', 'This credential belongs to a different branch.');

      const eventType: AccessEventType = credential.currentlyInside ? 'exit' : 'entry';
      const updated =
        eventType === 'entry'
          ? await this.repository.markEntry(client, context.companyId, credential.id, branchId)
          : await this.repository.markExit(client, context.companyId, credential.id, branchId);

      if (updated === null) throw await this.reasonForFailedScan(client, context.companyId, credential.id, eventType);

      const event = await this.repository.insertEvent(client, {
        id: randomUUID(),
        companyId: context.companyId,
        branchId,
        credentialId: updated.id,
        eventType,
        occurredAt: context.timestamp,
        createdBy: context.actorId,
      });
      await this.repository.auditAndPublish(client, context, {
        action: `access_credential.${eventType}`,
        resourceType: 'access_event',
        resourceId: event.id,
        eventType: `access_credential.${eventType}`,
        branchId,
        generation: eventType === 'entry' ? 2n : 3n,
        payload: { ...credentialPayload(updated), event_id: event.id },
      });
      return { credential: updated, event };
    });
  }

  /** Re-reads the credential (on the SAME transaction connection — see
   * `AccessRepository.credentialInTx`'s own doc comment) after a losing
   * CAS `UPDATE` to report the honest, specific reason, rather than a
   * single generic "conflict". Every branch here corresponds to a real,
   * currently-true fact about the row at the moment of the re-read —
   * never a guess. */
  private async reasonForFailedScan(
    client: Parameters<AccessRepository['credentialInTx']>[0],
    companyId: string,
    id: string,
    intendedEventType: AccessEventType,
  ): Promise<AccessError> {
    const current = await this.repository.credentialInTx(client, companyId, id);
    if (current === null) return new AccessError('credential_not_found', 'This code is not recognized.');
    if (current.status === 'void') return new AccessError('credential_void', 'This credential has been voided.');
    if (intendedEventType === 'exit')
      return new AccessError('not_inside', 'This credential is not currently marked as inside.');
    if (current.currentlyInside) return new AccessError('already_inside', 'This credential is already inside.');
    return new AccessError(
      'reentry_not_allowed',
      'This single-use credential already completed one entry and exit — re-entry is not allowed.',
    );
  }

  /**
   * **Void-while-inside policy** (documented design call, per this
   * task's own instruction): rejected outright with
   * `credential_currently_inside`, asking the operator to process a real
   * exit first. Silently forcing an implicit exit here would be exactly
   * the sentinel/hidden-state-mutation anti-pattern this codebase
   * explicitly avoids elsewhere (e.g. `held_sale_carts`' own no-silent-
   * expiry rule, TASK 14.3A) — a void is a records-correction action
   * (lost pass, refunded reservation, fraud), not a substitute for a real
   * gate exit scan.
   *
   * Idempotency: REQUIRED (this task's own explicit recommendation) — an
   * irreversible-feeling terminal action a cashier/operator should not
   * risk double-submitting under a flaky connection without a safety net,
   * mirroring `HeldSaleCartsService.discardCart`'s own identical
   * reasoning for its own terminal action.
   */
  public async voidCredential(
    context: AccessMutationContext,
    branchIds: readonly string[],
    id: string,
    key: string,
  ): Promise<{ value: AccessCredentialRow; replayed: boolean }> {
    const requestHash = hash({ id, op: 'void' });
    return this.repository.transaction((client) =>
      this.repository.idempotent(
        client,
        context,
        'access_credential.void',
        key,
        requestHash,
        'access_credential',
        decodeCredential,
        async () => {
          const current = await this.repository.credentialInTx(client, context.companyId, id);
          if (current === null || !branchIds.includes(current.branchId))
            throw new AccessError('resource_not_found', 'The access credential was not found.');
          const updated = await this.repository.markVoid(client, context.companyId, id, {
            voidedAt: context.timestamp,
            voidedBy: context.actorId,
          });
          if (updated === null) {
            const refreshed = await this.repository.credentialInTx(client, context.companyId, id);
            if (refreshed?.status === 'void')
              throw new AccessError('credential_void', 'This credential has already been voided.');
            throw new AccessError(
              'credential_currently_inside',
              'This credential is currently inside — process an exit before voiding it.',
            );
          }
          await this.repository.auditAndPublish(client, context, {
            action: 'access_credential.voided',
            resourceType: 'access_credential',
            resourceId: updated.id,
            eventType: 'access_credential.voided',
            branchId: updated.branchId,
            generation: 4n,
            payload: credentialPayload(updated),
          });
          return updated;
        },
      ),
    );
  }

  public currentlyInside(
    companyId: string,
    branchIds: readonly string[],
    input: { limit: number; cursor?: string; branchId?: string },
  ): ReturnType<AccessRepository['listCurrentlyInside']> {
    return this.repository.listCurrentlyInside(companyId, branchIds, input);
  }

  public listEvents(
    companyId: string,
    branchIds: readonly string[],
    input: { limit: number; cursor?: string; branchId?: string; occurredFrom?: Date; occurredTo?: Date },
  ): ReturnType<AccessRepository['listEvents']> {
    return this.repository.listEvents(companyId, branchIds, input);
  }

  public async occupancy(
    companyId: string,
    branchIds: readonly string[],
    branchId: string,
  ): Promise<{ branchId: string; count: number }> {
    if (!branchIds.includes(branchId))
      throw new AccessError('validation_error', 'The branch is not authorized for this actor.');
    const count = await this.repository.occupancyCount(companyId, branchId);
    return { branchId, count };
  }
}

function decodeCredential(raw: unknown): AccessCredentialRow {
  const value = raw as Omit<AccessCredentialRow, 'issuedAt' | 'voidedAt'> & {
    issuedAt: string;
    voidedAt: string | null;
  };
  return {
    ...value,
    issuedAt: new Date(value.issuedAt),
    voidedAt: value.voidedAt === null ? null : new Date(value.voidedAt),
  };
}
