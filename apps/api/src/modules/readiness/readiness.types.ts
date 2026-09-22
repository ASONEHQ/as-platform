/**
 * TASK 16.17 — tenant readiness ("what does this customer still need to
 * configure before it can sell?"). Purely OBSERVATIONAL: nothing in this
 * module ever writes a row, creates a default, or "fixes" anything — it
 * only reads the same tables the sale/cash/inventory paths themselves
 * depend on and reports what those paths would currently reject.
 */

export type ReadinessStatus =
  /** Configured and working. */
  | 'ok'
  /** A REQUIRED prerequisite is missing — some stage below is blocked. */
  | 'missing'
  /** Not blocking, but something is off and worth an admin's attention. */
  | 'warning'
  /** Optional configuration that simply isn't used (never blocks). */
  | 'optional_missing'
  /** Does not apply to this tenant right now (e.g. no tracked products). */
  | 'not_applicable';

/** The existing administration surface an admin should be routed to. A
 * symbolic name only — the backend knows nothing about Flutter modules. */
export type ReadinessSurface =
  | 'company'
  | 'branches'
  | 'operational_areas'
  | 'registers'
  | 'users'
  | 'catalog'
  | 'prices'
  | 'inventory_locations'
  | 'inventory_stock'
  | 'cash';

export interface ReadinessItem {
  readonly id: string;
  readonly label: string;
}

export interface ReadinessCheck {
  /** Stable machine code — the client maps it to Spanish copy. */
  readonly code: string;
  readonly scope: 'company' | 'branch';
  /** `false` = optional configuration, never blocks any stage. */
  readonly required: boolean;
  readonly status: ReadinessStatus;
  readonly surface: ReadinessSurface;
  /** How many of the thing exist (registers, areas, users…), when meaningful. */
  readonly count: number | null;
  /** A short list of the specific offenders (e.g. products with no price). */
  readonly items: readonly ReadinessItem[];
}

export type ReadinessStageKey = 'administration' | 'pos_entry' | 'register_open' | 'sale' | 'inventory';

export interface ReadinessStage {
  readonly key: ReadinessStageKey;
  /** `null` = the stage does not apply (inventory, when nothing is tracked). */
  readonly ready: boolean | null;
  /** Codes of the REQUIRED checks currently blocking this stage. */
  readonly blockedBy: readonly string[];
}

export interface BranchReadiness {
  readonly branchId: string;
  readonly code: string;
  readonly name: string;
  readonly checks: readonly ReadinessCheck[];
  readonly stages: readonly ReadinessStage[];
}

export interface TenantReadiness {
  readonly evaluatedAt: string;
  readonly company: {
    readonly id: string;
    readonly name: string;
    readonly currencyCode: string;
    readonly timezone: string;
    readonly checks: readonly ReadinessCheck[];
    readonly administrationReady: boolean;
  };
  readonly branches: readonly BranchReadiness[];
}

/** Raw facts about one company, read by the repository. */
export interface CompanyFacts {
  readonly id: string;
  readonly displayName: string;
  readonly status: string;
  readonly timezone: string;
  readonly currencyCode: string;
  readonly activeBranchCount: number;
}

/** Raw facts about one branch, read by the repository. */
export interface BranchFacts {
  readonly id: string;
  readonly code: string;
  readonly name: string;
  readonly timezone: string;
  readonly areaCount: number;
  readonly registerCount: number;
  readonly registersWithForeignAreaCount: number;
  readonly openSessionCount: number;
  /** Active users with branch access + the permissions to take a sale to the POS. */
  readonly posEntryOperatorCount: number;
  /** Active users who could open a register and take a CASH sale end to end. */
  readonly cashOperatorCount: number;
  /** Of `cashOperatorCount`, how many can actually use at least one register of this branch. */
  readonly cashOperatorWithRegisterCount: number;
  readonly activeProductCount: number;
  readonly pricedProductCount: number;
  readonly unpricedProducts: readonly ReadinessItem[];
  readonly unpricedProductCount: number;
  readonly foreignCurrencyPriceProducts: readonly ReadinessItem[];
  readonly foreignCurrencyPriceProductCount: number;
  readonly trackedProductCount: number;
  /** Tracked + priced products with nothing available at the default location. */
  readonly trackedWithoutStock: readonly ReadinessItem[];
  readonly trackedWithoutStockCount: number;
  readonly locationCount: number;
  readonly defaultLocationCount: number;
  readonly defaultLocationReceivingCount: number;
  /** Products that could be sold RIGHT NOW (priced in company currency and,
   * if tracked, with a default location and stock available). */
  readonly sellableProductCount: number;
}

export interface ReadinessFacts {
  readonly company: CompanyFacts;
  readonly branches: readonly BranchFacts[];
}
