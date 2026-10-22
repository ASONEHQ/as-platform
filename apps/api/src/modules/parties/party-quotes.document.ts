import type { PartyQuoteRow } from './parties.types.js';

/**
 * TASK 17.6 — the printable quotation. Rendered from the SAVED quote (its
 * frozen package snapshot and frozen amounts) — never from the live package —
 * so reprinting an old quote shows exactly what was quoted. Escapes every
 * dynamic value, carries no legal terms and no invented contact details: only
 * what is in the data (business/branch name, folio, customer, seller, event,
 * package, line items, subtotal/discount/tax/total, notes, status, dates).
 */

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

/** `1234.5000` -> `$1,234.50` (round half up to cents; exact BigInt, no floats). */
function displayMoney(value: string): string {
  const match = /^(-?)(\d+)(?:\.(\d{1,4}))?$/u.exec(value);
  if (match === null) return value;
  const negative = match[1] === '-';
  const units = BigInt(match[2] ?? '0') * 10_000n + BigInt((match[3] ?? '').padEnd(4, '0'));
  const cents = (units + 50n) / 100n;
  const whole = (cents / 100n).toString().replace(/\B(?=(\d{3})+(?!\d))/gu, ',');
  const fraction = (cents % 100n).toString().padStart(2, '0');
  return `${negative ? '-' : ''}$${whole}.${fraction}`;
}

const STATUS_LABELS: Readonly<Record<string, string>> = {
  draft: 'Borrador',
  converted: 'Convertida en fiesta',
  cancelled: 'Cancelada',
};

function formatDate(value: Date): string {
  const pad = (n: number): string => n.toString().padStart(2, '0');
  return `${pad(value.getUTCDate())}/${pad(value.getUTCMonth() + 1)}/${String(value.getUTCFullYear())}`;
}

export function renderPartyQuoteHtml(input: {
  quote: PartyQuoteRow;
  companyName: string;
  branchName: string;
  sellerName: string | null;
  roomName: string | null;
  generatedAt: Date;
}): string {
  const { quote } = input;
  const snapshot = quote.packageSnapshot;
  const extraChildren = Math.max(0, quote.childrenCount - snapshot.children_included);
  const extraAdults = Math.max(0, quote.adultsCount - snapshot.adults_included);
  const lines: { label: string; amount: string }[] = [
    { label: `Paquete: ${snapshot.package_name}`, amount: quote.breakdown.base },
  ];
  if (extraChildren > 0)
    lines.push({
      label: `${String(extraChildren)} ${extraChildren === 1 ? 'niño adicional' : 'niños adicionales'} × ${displayMoney(snapshot.child_extra_cost)}`,
      amount: quote.breakdown.children_extra,
    });
  if (extraAdults > 0)
    lines.push({
      label: `${String(extraAdults)} ${extraAdults === 1 ? 'adulto adicional' : 'adultos adicionales'} × ${displayMoney(snapshot.adult_extra_cost)}`,
      amount: quote.breakdown.adults_extra,
    });
  if (quote.extraHalfHours > 0)
    lines.push({
      label: `${String(quote.extraHalfHours)} ${quote.extraHalfHours === 1 ? 'media hora adicional' : 'medias horas adicionales'} × ${displayMoney(snapshot.extra_half_hour_cost)}`,
      amount: quote.breakdown.time_extra,
    });
  const discount = quote.discountTotal !== '0.0000' && quote.discountTotal !== '0';
  const consumables = (snapshot.included_consumables ?? []).filter((item) => item.quantity > 0);

  const detail: [string, string][] = [['Folio', quote.quoteNumber]];
  detail.push(['Estado', STATUS_LABELS[quote.status] ?? quote.status]);
  if (quote.customerDisplayName !== null) detail.push(['Cliente', quote.customerDisplayName]);
  if (quote.customerPhone !== null) detail.push(['Teléfono del cliente', quote.customerPhone]);
  if (input.sellerName !== null) detail.push(['Atendió', input.sellerName]);
  if (quote.eventDate !== null) detail.push(['Fecha del evento', quote.eventDate]);
  if (quote.startTime !== null) detail.push(['Hora de inicio', quote.startTime.slice(0, 5)]);
  if (input.roomName !== null) detail.push(['Salón', input.roomName]);
  detail.push(['Niños / adultos', `${String(quote.childrenCount)} / ${String(quote.adultsCount)}`]);
  detail.push(['Fecha de la cotización', formatDate(quote.createdAt)]);

  const detailHtml = detail
    .map(([label, value]) => `<tr><th>${escapeHtml(label)}</th><td>${escapeHtml(value)}</td></tr>`)
    .join('');
  const linesHtml = lines
    .map((line) => `<tr><td>${escapeHtml(line.label)}</td><td class="num">${escapeHtml(displayMoney(line.amount))}</td></tr>`)
    .join('');
  const consumablesHtml =
    consumables.length === 0
      ? ''
      : `<h2>Incluye</h2><ul>${consumables
          .map((item) => `<li>${escapeHtml(item.label)} × ${String(item.quantity)}</li>`)
          .join('')}</ul>`;
  const notesHtml =
    quote.notes === null ? '' : `<h2>Notas</h2><p class="notes">${escapeHtml(quote.notes)}</p>`;

  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><title>${escapeHtml(`Cotización ${quote.quoteNumber}`)}</title>
<style>
  *{box-sizing:border-box} body{font-family:Arial,Helvetica,sans-serif;color:#1a1535;margin:0;padding:28px;font-size:13px}
  h1{font-size:20px;margin:0} h2{font-size:14px;margin:20px 0 6px}
  .sub{color:#5a5880;margin:2px 0 14px}
  table{width:100%;border-collapse:collapse} th,td{padding:6px 8px;border-bottom:1px solid #e2e1f0;text-align:left;vertical-align:top}
  th{width:38%;color:#5a5880;font-weight:600} td.num{text-align:right;white-space:nowrap}
  .lines th{width:auto} tr.total td{font-weight:700;font-size:15px;border-top:2px solid #1a1535}
  .notes{white-space:pre-wrap} .foot{margin-top:22px;color:#9896b0;font-size:11px}
  .noprint{margin-bottom:14px} @media print{.noprint{display:none} body{padding:0}}
</style></head><body>
<div class="noprint"><button onclick="window.print()">Imprimir / PDF</button></div>
<h1>${escapeHtml(input.companyName)}</h1>
<p class="sub">${escapeHtml(input.branchName)} — Cotización de fiesta</p>
<table>${detailHtml}</table>
<h2>Detalle</h2>
<table class="lines"><tbody>${linesHtml}
<tr><td>Subtotal</td><td class="num">${escapeHtml(displayMoney(quote.subtotalAmount))}</td></tr>
${discount ? `<tr><td>Descuento</td><td class="num">-${escapeHtml(displayMoney(quote.discountTotal))}</td></tr>` : ''}
<tr><td>Impuestos</td><td class="num">${escapeHtml(displayMoney(quote.taxTotal))}</td></tr>
<tr class="total"><td>Total (${escapeHtml(quote.currencyCode)})</td><td class="num">${escapeHtml(displayMoney(quote.totalAmount))}</td></tr>
</tbody></table>
${consumablesHtml}${notesHtml}
<p class="foot">Generado el ${escapeHtml(formatDate(input.generatedAt))}</p>
</body></html>`;
}
