import { randomUUID } from 'node:crypto';

import type { DatabaseClient } from '@asone/database';

import { CashRepository } from '../modules/cash/cash.repository.js';
import { CashService } from '../modules/cash/cash.service.js';
import { PosCatalogSeedError, validateSeedEnvironment } from './seed-pos-catalog.service.js';

/**
 * TASK 12.7 Part U: development-only cash-register fixture.
 *
 * A physical cash drawer is real operational data — "no hardcoded
 * operational data" (Part A) — so this command creates only the
 * `cash_registers` row every branch needs to exist before a human can open
 * a session against it. It deliberately does NOT:
 *   - open a cash session ("the human must open the drawer manually in
 *     QA", Part U);
 *   - guess or hardcode an opening float;
 *   - run automatically in production (guarded exactly like
 *     `seed-pos-catalog.service.ts`: development/test only, loopback host,
 *     allowlisted database name — reusing that exact same
 *     `validateSeedEnvironment` guard, not a second copy of it).
 *
 * One register per existing branch (Part A: "do not hardcode 'Caja 1' as
 * the only register" is about the *architecture*, not this fixture — a
 * real company can create additional registers per branch through
 * `POST /cash-registers` any time; this seed only guarantees the minimum
 * one every branch needs to be usable at all), created through the real,
 * already-tested `CashService.createRegister` with a deterministic
 * idempotency key per branch — never a raw insert — so re-running this
 * command is always safe: it replays instead of duplicating.
 */

const companySlug = 'inflapark-group';
const ownerEmail = 'ceo@inflapark.local';
const keyPrefix = 'cash-register-seed';
const registerCode = 'CAJA-1';
const registerName = 'Caja 1';

export interface CashRegisterSeedSummary {
  readonly company: 'inflapark-group';
  readonly registers: { readonly created: number; readonly existing: number };
  readonly success: true;
}

export class CashRegisterSeed {
  private readonly cash: CashService;

  public constructor(private readonly database: DatabaseClient) {
    this.cash = new CashService(new CashRepository(database));
  }

  public async run(): Promise<CashRegisterSeedSummary> {
    const companyRow = await this.database.pool.query<{ id: string }>(
      `select id from companies where slug=$1`,
      [companySlug],
    );
    const companyId = companyRow.rows[0]?.id;
    if (companyId === undefined)
      throw new PosCatalogSeedError(
        `Company "${companySlug}" was not found. Run "pnpm --filter @asone/api dev:bootstrap-owner" first.`,
      );
    const ownerRow = await this.database.pool.query<{ id: string }>(
      `select id from users where normalized_email=$1`,
      [ownerEmail],
    );
    const actorId = ownerRow.rows[0]?.id;
    if (actorId === undefined)
      throw new PosCatalogSeedError(
        `Owner user "${ownerEmail}" was not found. Run "pnpm --filter @asone/api dev:bootstrap-owner" first.`,
      );
    const branchRows = await this.database.pool.query<{ id: string; code: string }>(
      `select id,code from branches where company_id=$1 and status='active' order by code`,
      [companyId],
    );
    if (branchRows.rows.length === 0)
      throw new PosCatalogSeedError(
        `No active branches were found for "${companySlug}". Run "pnpm --filter @asone/api dev:bootstrap-owner" first.`,
      );

    const context = {
      companyId,
      actorId,
      requestId: `${keyPrefix}-${randomUUID()}`,
      correlationId: `${keyPrefix}-${randomUUID()}`,
      timestamp: new Date(),
    };
    const branchIds = branchRows.rows.map((row) => row.id);

    const registers = { created: 0, existing: 0 };
    for (const branch of branchRows.rows) {
      const result = await this.cash.createRegister(
        context,
        branchIds,
        `${keyPrefix}:register:${branch.code}`,
        { branchId: branch.id, code: registerCode, name: registerName },
      );
      if (result.replayed) registers.existing += 1;
      else registers.created += 1;
    }

    return Object.freeze({ company: companySlug, registers: Object.freeze(registers), success: true });
  }
}

export { validateSeedEnvironment };
