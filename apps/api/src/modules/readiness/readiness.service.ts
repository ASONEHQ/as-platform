import { AppError } from '@asone/errors';

import { evaluateReadiness } from './readiness.evaluator.js';
import type { ReadinessRepository } from './readiness.repository.js';
import type { TenantReadiness } from './readiness.types.js';

/**
 * TASK 16.17 — read-only tenant readiness. Gathers the facts (one company,
 * the actor's own permitted active branches) and hands them to the pure
 * `evaluateReadiness` rulebook. Never writes, never creates a default,
 * never consults a tenant name — it works identically for every company.
 */
export class ReadinessService {
  public constructor(
    private readonly repository: ReadinessRepository,
    private readonly now: () => Date = () => new Date(),
  ) {}

  public async evaluate(
    companyId: string,
    permittedBranchIds: readonly string[],
    branchId?: string,
  ): Promise<TenantReadiness> {
    const company = await this.repository.companyFacts(companyId, permittedBranchIds);
    if (company === null) throw new AppError({ code: 'not_found', message: 'The company was not found.', statusCode: 404 });
    const branches = await this.repository.activeBranches(companyId, permittedBranchIds, branchId);
    const facts = await Promise.all(branches.map((branch) => this.repository.branchFacts(companyId, company.currencyCode, branch)));
    return evaluateReadiness({ company, branches: facts }, this.now());
  }
}
