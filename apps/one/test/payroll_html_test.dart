/// TASK 17.6 (Payroll V2) — the printable payroll documents are pure string
/// builders (like `cash_cut_html_test.dart`): everything they print is a
/// pre-formatted value supplied by the caller (which got it from the
/// backend), every dynamic value is escaped, a draft week is always labeled as
/// such and nothing is invented.
library;

import 'package:as_one/features/pos/payroll_html.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  group('formatting helpers', () {
    test('payrollMinutesLabel shows whole hours/minutes and a truthful zero', () {
      expect(payrollMinutesLabel(0), '0m');
      expect(payrollMinutesLabel(59), '59m');
      expect(payrollMinutesLabel(60), '1h');
      expect(payrollMinutesLabel(498), '8h 18m');
      expect(payrollMinutesLabel(2400), '40h');
    });

    test('payrollClockLabel is HH:MM from local minutes, or a dash when there is no punch', () {
      expect(payrollClockLabel(552), '09:12');
      expect(payrollClockLabel(1050), '17:30');
      expect(payrollClockLabel(0), '00:00');
      expect(payrollClockLabel(null), '—');
    });

    test('payrollScheduleLabel reads the schedule as stored', () {
      expect(payrollScheduleLabel(start: '09:00:00', end: '17:00:00', isDayOff: false), '09:00 – 17:00');
      expect(payrollScheduleLabel(start: null, end: null, isDayOff: true), 'Descanso');
      expect(payrollScheduleLabel(start: null, end: null, isDayOff: false), 'Sin horario');
    });

    test('payrollAttendanceLabel names every backend state and never invents an absence', () {
      expect(payrollAttendanceLabel('complete'), 'Completo');
      expect(payrollAttendanceLabel('no_punches'), 'Sin registro');
      expect(payrollAttendanceLabel('missing_clock_out'), 'Falta salida');
      expect(payrollAttendanceLabel('missing_clock_in'), 'Falta entrada');
      expect(payrollAttendanceLabel('unscheduled_work'), 'Trabajó sin horario');
      expect(payrollAttendanceLabel('day_off'), 'Descanso');
      expect(payrollAttendanceLabel('no_schedule'), 'Sin horario');
      expect(payrollAttendanceLabel('something_new'), 'something_new');
      expect(payrollAttendanceLabel('no_punches').toLowerCase(), isNot(contains('falta ')));
    });
  });

  group('buildPayrollWeeklyHtml', () {
    const row = PayrollWeeklyRow(
      employee: 'Ana <b>Torres</b>',
      scheduled: '40h',
      worked: '39h 10m',
      late: '15m',
      extra: '0m',
      base: '\$1500.00',
      adjustment: '\$200.00',
      total: '\$1690.63',
    );
    const totals = [
      PayrollWeeklyTotals(label: 'Total MXN · 1 empleado', base: '\$1500.00', adjustment: '\$200.00', total: '\$1690.63'),
    ];

    test('a CLOSED week says it is closed, carries the closing date and lists every column and the server totals', () {
      final html = buildPayrollWeeklyHtml(
        companyName: 'Empresa AS',
        branchLabel: 'Sucursal Centro',
        periodLabel: '2026-09-01 – 2026-09-07',
        closed: true,
        closedAt: DateTime(2026, 9, 8, 10, 30),
        generatedAt: DateTime(2026, 9, 9, 8),
        rows: [row],
        totals: totals,
      );
      expect(html, contains('Empresa AS'));
      expect(html, contains('Sucursal Centro'));
      expect(html, contains('2026-09-01 – 2026-09-07'));
      expect(html, contains('Nómina cerrada el 08/09/2026 10:30'));
      for (final column in ['Empleado', 'Programado', 'Trabajado', 'Retardo', 'Extra', 'Base', 'Ajuste', 'Total']) {
        expect(html, contains('>$column<'), reason: column);
      }
      expect(html, contains('39h 10m'));
      expect(html, contains('Total MXN · 1 empleado'));
      expect(html, contains('\$1690.63'));
      expect(html, isNot(contains('Documento preliminar')));
      expect(html, contains('window.print()'));
    });

    test('a DRAFT week is always labeled as not closed and as preliminary — never presented as a closed payroll', () {
      final html = buildPayrollWeeklyHtml(
        companyName: 'Empresa AS',
        branchLabel: 'Sucursal Centro',
        periodLabel: '2026-09-01 – 2026-09-07',
        closed: false,
        generatedAt: DateTime(2026, 9, 9, 8),
        rows: [row],
        totals: totals,
      );
      expect(html, contains('Borrador — nómina NO cerrada'));
      expect(html, contains('Documento preliminar'));
      expect(html, isNot(contains('Nómina cerrada')));
    });

    test('every dynamic value is escaped (no markup injection through a name)', () {
      final html = buildPayrollWeeklyHtml(
        companyName: '<script>alert(1)</script>',
        branchLabel: 'A & B',
        periodLabel: 'p',
        closed: false,
        generatedAt: DateTime(2026, 9, 9),
        rows: [row],
        totals: const [],
      );
      expect(html, isNot(contains('<script>alert(1)')));
      expect(html, contains('&lt;script&gt;alert(1)&lt;/script&gt;'));
      expect(html, contains('Ana &lt;b&gt;Torres&lt;/b&gt;'));
      expect(html, contains('A &amp; B'));
    });

    test('a week with no calculated employees prints an honest empty message, not a fabricated row', () {
      final html = buildPayrollWeeklyHtml(
        companyName: 'Empresa AS',
        branchLabel: 'Sucursal Centro',
        periodLabel: 'p',
        closed: false,
        generatedAt: DateTime(2026, 9, 9),
        rows: const [],
        totals: const [],
      );
      expect(html, contains('Esta semana aún no tiene empleados calculados.'));
    });
  });

  group('buildPayrollReceiptHtml', () {
    const days = [
      PayrollReceiptDay(
        date: '2026-09-01',
        schedule: '09:00 – 17:00',
        entry: '09:12',
        exit: '17:30',
        worked: '8h 18m',
        late: '2m',
        extra: '30m',
        state: 'Completo',
      ),
      PayrollReceiptDay(
        date: '2026-09-02',
        schedule: 'Descanso',
        entry: '—',
        exit: '—',
        worked: '0m',
        late: '0m',
        extra: '0m',
        state: 'Descanso',
      ),
    ];

    test('the receipt shows who, which week, the daily summary, the money breakdown and the payroll status', () {
      final html = buildPayrollReceiptHtml(
        companyName: 'Empresa AS',
        branchLabel: 'Sucursal Centro',
        employeeName: 'Ana Torres',
        employeeCode: 'EMP-1',
        jobTitle: 'Cajera',
        periodLabel: '2026-09-01 – 2026-09-07',
        closed: true,
        closedAt: DateTime(2026, 9, 8, 10, 30),
        generatedAt: DateTime(2026, 9, 9, 8),
        days: days,
        summary: const [
          MapEntry('Sueldo base', '\$1500.00'),
          MapEntry('Ajustes manuales', '\$200.00'),
          MapEntry('Total', '\$1690.63'),
        ],
        adjustments: const [
          PayrollReceiptAdjustment(kind: 'Bono', reason: 'Bono de puntualidad', amount: '+\$200.00'),
        ],
      );
      expect(html, contains('Recibo de nómina'));
      expect(html, contains('Ana Torres'));
      expect(html, contains('Código EMP-1'));
      expect(html, contains('Cajera'));
      expect(html, contains('09:12'));
      expect(html, contains('Completo'));
      expect(html, contains('Sueldo base'));
      expect(html, contains('\$1690.63'));
      expect(html, contains('Ajustes manuales'));
      expect(html, contains('Bono de puntualidad'));
      expect(html, contains('+\$200.00'));
      expect(html, contains('Nómina cerrada el 08/09/2026 10:30'));
      expect(html, isNot(contains('Recibo preliminar')));
    });

    test('a draft receipt is labeled preliminary, and a week with no adjustments prints no adjustments section', () {
      final html = buildPayrollReceiptHtml(
        companyName: 'Empresa AS',
        branchLabel: 'Sucursal Centro',
        employeeName: 'Ana Torres',
        periodLabel: 'p',
        closed: false,
        generatedAt: DateTime(2026, 9, 9),
        days: days,
        summary: const [MapEntry('Total', '\$1500.00')],
        adjustments: const [],
      );
      expect(html, contains('Borrador — nómina NO cerrada'));
      expect(html, contains('Recibo preliminar'));
      expect(html, isNot(contains('Ajustes manuales')));
      expect(html, isNot(contains('Código ')));
    });

    test('the receipt escapes dynamic values and carries no invented legal or contact text', () {
      final html = buildPayrollReceiptHtml(
        companyName: 'Empresa AS',
        branchLabel: 'Sucursal Centro',
        employeeName: '<img src=x onerror=alert(1)>',
        periodLabel: 'p',
        closed: true,
        generatedAt: DateTime(2026, 9, 9),
        days: days,
        summary: const [MapEntry('Total', '\$1500.00')],
        adjustments: const [PayrollReceiptAdjustment(kind: 'Bono', reason: '<b>x</b>', amount: '+\$1.00')],
      );
      expect(html, isNot(contains('<img src=x')));
      expect(html, contains('&lt;img src=x onerror=alert(1)&gt;'));
      expect(html, contains('&lt;b&gt;x&lt;/b&gt;'));
      for (final invented in ['Firma', 'Conforme', 'Tel.', 'Tel:', 'correo', 'RFC', 'IMSS']) {
        expect(html, isNot(contains(invented)), reason: invented);
      }
    });
  });
}
