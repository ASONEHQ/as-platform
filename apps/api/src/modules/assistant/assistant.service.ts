import type { AssistantRepository } from './assistant.repository.js';
import { AssistantError, type AssistantAnswer, type AssistantIntent } from './assistant.types.js';

// Same fixed-point money convention every other module in this codebase
// uses (see `reports.service.ts`'s own `MONEY_SCALE`/`moneyUnits`/
// `formatMoney` trio, itself copied verbatim from `cash.service.ts`'s
// original) — duplicated locally rather than imported across modules,
// exactly like `product-catalog.service.ts` copies `reports.service.ts`'s
// own `csvEscape`/`csvRow` pair for something this small.
const MONEY_SCALE = 10_000n;
function moneyUnits(value: string): bigint {
  const [whole = '', fraction = ''] = value.split('.');
  const wholeDigits = whole.length === 0 ? '0' : whole;
  const fractionDigits = fraction.padEnd(4, '0').slice(0, 4);
  return BigInt(wholeDigits) * MONEY_SCALE + BigInt(fractionDigits.length === 0 ? '0' : fractionDigits);
}
function formatMoney(units: bigint): string {
  const negative = units < 0n;
  const magnitude = negative ? -units : units;
  const whole = magnitude / MONEY_SCALE;
  const fraction = (magnitude % MONEY_SCALE).toString().padStart(4, '0');
  return `${negative ? '-' : ''}${whole.toString()}.${fraction}`;
}

/** Lower-cases and strips Spanish accents (é/í/ó/…) before matching, so
 * "¿Cuántas ventas hubo hoy?" and "cuantas ventas hubo hoy" hit the same
 * rule. Deterministic string normalization only — no ML/fuzzy matching
 * anywhere in this file. */
const COMBINING_DIACRITICAL_MARKS = new RegExp('[\\u0300-\\u036f]', 'g');

function normalize(text: string): string {
  return text.toLowerCase().normalize('NFD').replace(COMBINING_DIACRITICAL_MARKS, '');
}

/**
 * The deterministic keyword/intent matcher itself — a local,
 * regex/keyword FAQ matcher, faithfully porting the legacy AS POS V1
 * assistant's own approach (see `assistant.types.ts`'s doc comment). No
 * LLM, no fuzzy/ML matching, no external call of any kind — a pure
 * function of the (normalized) input string.
 *
 * Rules, in the order they are checked:
 *  - contains "venta" AND ("hoy" OR "dia")              → sales_today
 *  - contains "caja" AND ("abierta"|"abierto"|"cerrada"|
 *    "cerrado"|"estado")                                → register_status
 *  - contains "agotado(s)"|"sin stock"|"bajo stock"|
 *    "stock bajo"                                       → low_stock_count
 *  - contains "fiesta" AND ("hoy" OR "dia")              → open_parties_today
 *  - anything else                                       → unknown
 */
export function matchIntent(question: string): AssistantIntent {
  const text = normalize(question);

  const mentionsTodayOrDay = /\b(hoy|dia)\b/.test(text);

  if (text.includes('venta') && mentionsTodayOrDay) return 'sales_today';

  if (text.includes('caja') && /\b(abierta|abierto|cerrada|cerrado|estado)\b/.test(text)) return 'register_status';

  if (/agotados?|sin stock|bajo stock|stock bajo/.test(text)) return 'low_stock_count';

  if (text.includes('fiesta') && mentionsTodayOrDay) return 'open_parties_today';

  return 'unknown';
}

/** The caller's own real, current UTC calendar date (`YYYY-MM-DD`) — the
 * single source of "today" every intent handler below shares, so a
 * `sales_today` and an `open_parties_today` answer computed from the same
 * request always agree on which calendar day "today" means. */
function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

const UNKNOWN_ANSWER_TEXT =
  'No tengo una respuesta preparada para esa pregunta. Puedo ayudarte con: ventas de hoy, ' +
  'si la caja está abierta, productos con stock bajo, y fiestas de hoy.';

export class AssistantService {
  public constructor(private readonly repository: AssistantRepository) {}

  public async answer(
    companyId: string,
    branchIds: readonly string[],
    branchId: string | undefined,
    question: string,
  ): Promise<AssistantAnswer> {
    const trimmed = question.trim();
    if (trimmed.length === 0) throw new AssistantError('validation_error', 'La pregunta no puede estar vacía.');

    const intent = matchIntent(trimmed);
    if (intent === 'sales_today') return this.answerSalesToday(companyId, branchIds, branchId, trimmed);
    if (intent === 'register_status') return this.answerRegisterStatus(companyId, branchIds, branchId, trimmed);
    if (intent === 'low_stock_count') return this.answerLowStockCount(companyId, branchIds, branchId, trimmed);
    if (intent === 'open_parties_today') return this.answerOpenPartiesToday(companyId, branchIds, branchId, trimmed);

    // `unknown` — a real, honest answer for a question that matched
    // nothing. Never a fabricated guess.
    return { intent: 'unknown', question: trimmed, answerText: UNKNOWN_ANSWER_TEXT, data: null };
  }

  private async answerSalesToday(
    companyId: string,
    branchIds: readonly string[],
    branchId: string | undefined,
    question: string,
  ): Promise<AssistantAnswer> {
    const rows = await this.repository.salesTodayTotals(companyId, branchIds, branchId, todayIso());
    const transactionCount = rows.reduce((sum, row) => sum + row.transactionCount, 0);
    const grossTotals = rows.map((row) => ({
      currencyCode: row.currencyCode,
      amount: formatMoney(moneyUnits(row.grossTotal)),
    }));
    const answerText =
      transactionCount === 0
        ? 'Hoy no se ha registrado ninguna venta completada.'
        : `Hoy se han registrado ${String(transactionCount)} venta${transactionCount === 1 ? '' : 's'} completada${
            transactionCount === 1 ? '' : 's'
          } por un total de ${grossTotals.map((entry) => `${entry.amount} ${entry.currencyCode}`).join(', ')}.`;
    return {
      intent: 'sales_today',
      question,
      answerText,
      data: {
        transaction_count: transactionCount,
        gross_totals: grossTotals.map((entry) => ({ currency_code: entry.currencyCode, amount: entry.amount })),
      },
    };
  }

  private async answerRegisterStatus(
    companyId: string,
    branchIds: readonly string[],
    branchId: string | undefined,
    question: string,
  ): Promise<AssistantAnswer> {
    const isOpen = await this.repository.hasOpenCashSession(companyId, branchIds, branchId);
    const answerText = isOpen
      ? 'Sí, hay al menos una caja abierta en este momento.'
      : 'No, no hay ninguna caja abierta en este momento.';
    return { intent: 'register_status', question, answerText, data: { is_open: isOpen } };
  }

  private async answerLowStockCount(
    companyId: string,
    branchIds: readonly string[],
    branchId: string | undefined,
    question: string,
  ): Promise<AssistantAnswer> {
    const count = await this.repository.lowStockVariantCount(companyId, branchIds, branchId);
    const answerText =
      count === 0
        ? 'No hay productos con stock bajo o agotado en este momento.'
        : `Hay ${String(count)} producto${count === 1 ? '' : 's'} con stock bajo o agotado en este momento.`;
    return { intent: 'low_stock_count', question, answerText, data: { low_stock_variant_count: count } };
  }

  private async answerOpenPartiesToday(
    companyId: string,
    branchIds: readonly string[],
    branchId: string | undefined,
    question: string,
  ): Promise<AssistantAnswer> {
    const count = await this.repository.openPartiesTodayCount(companyId, branchIds, branchId, todayIso());
    const answerText =
      count === 0
        ? 'Hoy no hay fiestas reservadas (sin contar canceladas).'
        : `Hoy hay ${String(count)} fiesta${count === 1 ? '' : 's'} reservada${count === 1 ? '' : 's'} (sin contar canceladas).`;
    return { intent: 'open_parties_today', question, answerText, data: { open_parties_today_count: count } };
  }
}
