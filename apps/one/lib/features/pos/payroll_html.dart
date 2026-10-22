/// TASK 17.6 (Payroll V2) — printable payroll documents: the weekly payroll
/// report and the per-employee payroll receipt. Built exactly like this app's
/// other printable documents (`cash_cut_html.dart`, `pos_report_pdf.dart`,
/// `receipt_html.dart`): a full, self-contained HTML string handed to the
/// SAME `openReceiptPrintWindow` (`receipt_print.dart`) and printed through
/// the browser's own print-to-PDF — never a second PDF stack, never a button
/// that pretends to download a file it doesn't.
///
/// Pure string-building (no Flutter import) so it is trivially unit-testable.
/// Every value is a plain, PRE-FORMATTED string the caller got from the
/// backend (this file performs no payroll arithmetic of its own); it only
/// lays them out, escaping every dynamic value. A draft week is always
/// labeled as such — a preliminary document is never presented as a closed
/// payroll. It carries no legal claims and no invented contact details.
library;

String _escape(String value) => value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');

String _two(int n) => n.toString().padLeft(2, '0');

String _formatDateTime(DateTime value) {
  final local = value.toLocal();
  return '${_two(local.day)}/${_two(local.month)}/${local.year} ${_two(local.hour)}:${_two(local.minute)}';
}

/// `8h 18m` — whole minutes only (the backend's own unit); `0` is `0m`, a
/// truthful zero (scheduled/late/overtime of nothing), never a blank.
String payrollMinutesLabel(int minutes) {
  final hours = minutes ~/ 60;
  final rest = minutes % 60;
  if (hours == 0) return '${rest}m';
  return rest == 0 ? '${hours}h' : '${hours}h ${rest}m';
}

/// `09:12` from minutes since local midnight; `—` when there is no punch.
String payrollClockLabel(int? minutes) {
  if (minutes == null) return '—';
  return '${_two(minutes ~/ 60)}:${_two(minutes % 60)}';
}

/// `09:00 – 17:00`, `Descanso` or `Sin horario` — straight from the schedule.
String payrollScheduleLabel({required String? start, required String? end, required bool isDayOff}) {
  if (isDayOff) return 'Descanso';
  if (start == null || end == null) return 'Sin horario';
  String hhmm(String value) => value.length >= 5 ? value.substring(0, 5) : value;
  return '${hhmm(start)} – ${hhmm(end)}';
}

/// What actually happened that day, in plain Spanish — strictly the backend's
/// own classification; never an inferred "falta"/absence.
String payrollAttendanceLabel(String state) => switch (state) {
  'complete' => 'Completo',
  'unscheduled_work' => 'Trabajó sin horario',
  'missing_clock_out' => 'Falta salida',
  'missing_clock_in' => 'Falta entrada',
  'no_punches' => 'Sin registro',
  'day_off' => 'Descanso',
  'no_schedule' => 'Sin horario',
  _ => state,
};

const _styles = '''
  *{box-sizing:border-box} body{font-family:Arial,Helvetica,sans-serif;color:#1a1535;margin:0;padding:24px;font-size:12px}
  h1{font-size:18px;margin:0 0 2px} h2{font-size:13px;margin:18px 0 6px}
  .meta{color:#5a5880;margin:0 0 12px} .status{display:inline-block;padding:2px 8px;border-radius:99px;border:1px solid #9896b0;font-size:11px;margin-left:6px}
  .draft{border-color:#b45309;color:#b45309}
  table{width:100%;border-collapse:collapse} th,td{border-bottom:1px solid #e2e1f0;padding:5px 6px;text-align:left;vertical-align:top}
  th{font-size:11px;color:#5a5880;background:#f4f6fb} td.num,th.num{text-align:right;white-space:nowrap}
  tr.total td{font-weight:700;border-top:2px solid #1a1535}
  .note{margin-top:14px;padding:8px 10px;border:1px solid #e2e1f0;border-radius:6px;color:#5a5880}
  .foot{margin-top:18px;color:#9896b0;font-size:10px}
  .noprint{margin-bottom:12px} @media print{.noprint{display:none} body{padding:0}}
''';

String _shell({required String title, required String body}) =>
    '<!doctype html><html lang="es"><head><meta charset="utf-8"><title>${_escape(title)}</title>'
    '<style>$_styles</style></head><body>'
    '<div class="noprint"><button onclick="window.print()">Imprimir / PDF</button></div>'
    '$body</body></html>';

/// One employee row of the weekly payroll report (all pre-formatted).
class PayrollWeeklyRow {
  const PayrollWeeklyRow({
    required this.employee,
    required this.scheduled,
    required this.worked,
    required this.late,
    required this.extra,
    required this.base,
    required this.adjustment,
    required this.total,
  });
  final String employee;
  final String scheduled;
  final String worked;
  final String late;
  final String extra;
  final String base;
  final String adjustment;
  final String total;
}

/// A server-computed totals row (one per currency).
class PayrollWeeklyTotals {
  const PayrollWeeklyTotals({
    required this.label,
    required this.base,
    required this.adjustment,
    required this.total,
  });
  final String label;
  final String base;
  final String adjustment;
  final String total;
}

/// The weekly payroll report: company/branch, period, status, one row per
/// employee and the totals the BACKEND computed.
String buildPayrollWeeklyHtml({
  required String companyName,
  required String branchLabel,
  required String periodLabel,
  required bool closed,
  required DateTime generatedAt,
  required List<PayrollWeeklyRow> rows,
  required List<PayrollWeeklyTotals> totals,
  DateTime? closedAt,
}) {
  final statusLabel = closed
      ? 'Nómina cerrada${closedAt == null ? '' : ' el ${_formatDateTime(closedAt)}'}'
      : 'Borrador — nómina NO cerrada';
  final rowsHtml = rows.isEmpty
      ? '<tr><td colspan="8">Esta semana aún no tiene empleados calculados.</td></tr>'
      : rows
            .map(
              (row) =>
                  '<tr><td>${_escape(row.employee)}</td>'
                  '<td class="num">${_escape(row.scheduled)}</td><td class="num">${_escape(row.worked)}</td>'
                  '<td class="num">${_escape(row.late)}</td><td class="num">${_escape(row.extra)}</td>'
                  '<td class="num">${_escape(row.base)}</td><td class="num">${_escape(row.adjustment)}</td>'
                  '<td class="num">${_escape(row.total)}</td></tr>',
            )
            .join();
  final totalsHtml = totals
      .map(
        (item) =>
            '<tr class="total"><td colspan="5">${_escape(item.label)}</td>'
            '<td class="num">${_escape(item.base)}</td><td class="num">${_escape(item.adjustment)}</td>'
            '<td class="num">${_escape(item.total)}</td></tr>',
      )
      .join();
  final body =
      '<h1>${_escape(companyName)}</h1>'
      '<p class="meta">Nómina semanal — ${_escape(branchLabel)} — ${_escape(periodLabel)}'
      '<span class="status${closed ? '' : ' draft'}">${_escape(statusLabel)}</span></p>'
      '<table><thead><tr><th>Empleado</th><th class="num">Programado</th><th class="num">Trabajado</th>'
      '<th class="num">Retardo</th><th class="num">Extra</th><th class="num">Base</th>'
      '<th class="num">Ajuste</th><th class="num">Total</th></tr></thead>'
      '<tbody>$rowsHtml$totalsHtml</tbody></table>'
      '${closed ? '' : '<p class="note">Documento preliminar: la semana sigue abierta y sus cifras pueden cambiar hasta que se cierre la nómina.</p>'}'
      '<p class="foot">Generado el ${_escape(_formatDateTime(generatedAt))}</p>';
  return _shell(title: 'Nómina $periodLabel', body: body);
}

/// One day of the employee's week in the receipt (all pre-formatted).
class PayrollReceiptDay {
  const PayrollReceiptDay({
    required this.date,
    required this.schedule,
    required this.entry,
    required this.exit,
    required this.worked,
    required this.late,
    required this.extra,
    required this.state,
  });
  final String date;
  final String schedule;
  final String entry;
  final String exit;
  final String worked;
  final String late;
  final String extra;
  final String state;
}

/// One ACTIVE manual adjustment in the receipt (voided ones are not listed:
/// a receipt shows what counts toward the total).
class PayrollReceiptAdjustment {
  const PayrollReceiptAdjustment({required this.kind, required this.reason, required this.amount});
  final String kind;
  final String reason;
  final String amount;
}

/// The employee's payroll receipt for one week: identity, daily attendance
/// summary, the money breakdown and the status of the payroll.
String buildPayrollReceiptHtml({
  required String companyName,
  required String branchLabel,
  required String employeeName,
  String? employeeCode,
  String? jobTitle,
  required String periodLabel,
  required bool closed,
  required DateTime generatedAt,
  required List<PayrollReceiptDay> days,
  required List<MapEntry<String, String>> summary,
  required List<PayrollReceiptAdjustment> adjustments,
  DateTime? closedAt,
}) {
  final statusLabel = closed
      ? 'Nómina cerrada${closedAt == null ? '' : ' el ${_formatDateTime(closedAt)}'}'
      : 'Borrador — nómina NO cerrada';
  final identity = [
    if (employeeCode != null && employeeCode.isNotEmpty) 'Código ${_escape(employeeCode)}',
    if (jobTitle != null && jobTitle.isNotEmpty) _escape(jobTitle),
  ].join(' · ');
  final daysHtml = days
      .map(
        (day) =>
            '<tr><td>${_escape(day.date)}</td><td>${_escape(day.schedule)}</td>'
            '<td class="num">${_escape(day.entry)}</td><td class="num">${_escape(day.exit)}</td>'
            '<td class="num">${_escape(day.worked)}</td><td class="num">${_escape(day.late)}</td>'
            '<td class="num">${_escape(day.extra)}</td><td>${_escape(day.state)}</td></tr>',
      )
      .join();
  final summaryHtml = summary
      .map((entry) => '<tr><td>${_escape(entry.key)}</td><td class="num">${_escape(entry.value)}</td></tr>')
      .join();
  final adjustmentsHtml = adjustments.isEmpty
      ? ''
      : '<h2>Ajustes manuales</h2><table><thead><tr><th>Tipo</th><th>Motivo</th><th class="num">Monto</th></tr></thead><tbody>'
            '${adjustments.map((item) => '<tr><td>${_escape(item.kind)}</td><td>${_escape(item.reason)}</td><td class="num">${_escape(item.amount)}</td></tr>').join()}'
            '</tbody></table>';
  final body =
      '<h1>${_escape(companyName)}</h1>'
      '<p class="meta">Recibo de nómina — ${_escape(branchLabel)} — ${_escape(periodLabel)}'
      '<span class="status${closed ? '' : ' draft'}">${_escape(statusLabel)}</span></p>'
      '<h2>${_escape(employeeName)}</h2>'
      '${identity.isEmpty ? '' : '<p class="meta">$identity</p>'}'
      '<h2>Asistencia de la semana</h2>'
      '<table><thead><tr><th>Fecha</th><th>Horario</th><th class="num">Entrada</th><th class="num">Salida</th>'
      '<th class="num">Trabajado</th><th class="num">Retardo</th><th class="num">Extra</th><th>Estado</th></tr></thead>'
      '<tbody>$daysHtml</tbody></table>'
      '<h2>Resumen</h2><table><tbody>$summaryHtml</tbody></table>'
      '$adjustmentsHtml'
      '${closed ? '' : '<p class="note">Recibo preliminar: la semana sigue abierta y sus cifras pueden cambiar hasta que se cierre la nómina.</p>'}'
      '<p class="foot">Generado el ${_escape(_formatDateTime(generatedAt))}</p>';
  return _shell(title: 'Recibo de nómina — $employeeName', body: body);
}
