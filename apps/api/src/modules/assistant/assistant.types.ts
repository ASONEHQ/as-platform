/**
 * TASK 12.2 — "Asistente" (AI assistant). `docs/LEGACY_FUNCTIONAL_PARITY.md`
 * §21's "AI assistant" row: the legacy AS POS V1 product had a REAL
 * feature here — a LOCAL, deterministic keyword/regex FAQ bot over live
 * in-memory data, explicitly NOT an LLM, with zero external API calls
 * anywhere in that file. This module is a faithful real PORT of that same
 * idea onto THIS platform's own real data: a genuinely deterministic
 * keyword/intent matcher (`assistant.service.ts`'s own `matchIntent`) that
 * calls real, already-existing repository queries for its answers. No LLM
 * or external API integration happens anywhere in this module — that is
 * explicitly out of scope this wave (see this task's own final report).
 */

/** A SMALL, real, well-scoped set of intents this wave — never
 * over-scoped beyond what this task actually asked for. */
export type AssistantIntent =
  | 'sales_today'
  | 'register_status'
  | 'low_stock_count'
  | 'open_parties_today'
  | 'unknown';

export interface AssistantAnswer {
  readonly intent: AssistantIntent;
  /** The caller's own question, trimmed — echoed back so a client can
   * correlate an answer with what it asked without keeping separate
   * state. */
  readonly question: string;
  /** A real, human-readable Spanish sentence built from REAL computed
   * data returned by `AssistantRepository` — never a canned string
   * unconnected to a real number. For the `unknown` intent this is still
   * an HONEST answer explaining what this assistant can actually help
   * with — never a fabricated guess at what the caller might have meant. */
  readonly answerText: string;
  /** The real structured figures the sentence above was built from
   * (`null` only for the `unknown` intent, which has no real data to
   * report). */
  readonly data: Readonly<Record<string, unknown>> | null;
}

export type AssistantErrorCode = 'validation_error';

/** Mirrors `ReportsError` (`reports.types.ts`)'s own tiny shape exactly —
 * `validation_error` is already a member of `InfrastructureErrorCode`
 * (`packages/errors`), so no new error code is needed for this module. */
export class AssistantError extends Error {
  constructor(
    readonly code: AssistantErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'AssistantError';
  }
}
