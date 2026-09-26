/// TASK 14.4 (Wave 2): widget tests for the "People" module —
/// `pos_people_screen.dart`/`pos_people_gateway.dart`. A standalone suite
/// (never wired through `PosShell`, which this task must not edit) —
/// `PosPeopleScreen` is pumped directly, mirroring `pos_shell_test.dart`'s
/// own `_Recording*Gateway`/`_pump` fixture pattern (see
/// `pos_shell_wave1_partbc_test.dart`'s own doc comment for the same
/// convention).
library;

import 'package:as_one/app/app.dart' show PlatformScope;
import 'package:as_one/core/errors/app_error.dart';
import 'package:as_one/core/networking/api_client.dart';
import 'package:as_one/features/authentication/auth_models.dart';
import 'package:as_one/features/pos/pos_models.dart';
import 'package:as_one/features/pos/pos_people_gateway.dart';
import 'package:as_one/features/pos/pos_people_screen.dart';
import 'package:as_one/features/pos/pos_read_gateway.dart';
import 'package:as_one/features/pos/pos_tokens.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  group('Empleados', () {
    testWidgets('creating an employee calls the real endpoint with the exact entered values', (tester) async {
      final gateway = _RecordingEmployeesGateway();
      await _pump(tester, employeesGateway: gateway);

      await tester.tap(find.byKey(const Key('pos-employees-new')));
      await tester.pumpAndSettle();

      await tester.enterText(find.byKey(const Key('pos-employee-form-code')), 'EMP-1');
      await tester.enterText(find.byKey(const Key('pos-employee-form-name')), 'Ana Torres');
      await tester.enterText(find.byKey(const Key('pos-employee-form-weekly-salary')), '1500.00');
      await tester.pump();

      await tester.tap(find.byKey(const Key('pos-employee-form-save')));
      await tester.pumpAndSettle();

      expect(gateway.createCalls, hasLength(1));
      final call = gateway.createCalls.single;
      expect(call.branchId, 'branch-id');
      expect(call.code, 'EMP-1');
      expect(call.displayName, 'Ana Torres');
      expect(call.weeklySalary, '1500.00');
      expect(call.currencyCode, 'MXN');
      // The newly-created employee shows up in the refreshed list.
      expect(find.text('Ana Torres'), findsOneWidget);
    });

    testWidgets('editing an employee sends the real If-Match version and the updated fields', (tester) async {
      final gateway = _RecordingEmployeesGateway(seed: [_activeEmployee]);
      await _pump(tester, employeesGateway: gateway);
      await tester.pumpAndSettle();

      await tester.tap(find.byKey(const Key('pos-employee-row-employee-1')));
      await tester.pumpAndSettle();
      await tester.tap(find.byKey(const Key('pos-employee-detail-edit')));
      await tester.pumpAndSettle();

      await tester.enterText(find.byKey(const Key('pos-employee-form-name')), 'Ana Torres Actualizada');
      await tester.tap(find.byKey(const Key('pos-employee-form-save')));
      await tester.pumpAndSettle();

      expect(gateway.updateCalls, hasLength(1));
      expect(gateway.updateCalls.single.id, 'employee-1');
      expect(gateway.updateCalls.single.version, 3);
      expect(gateway.updateCalls.single.input.displayName, 'Ana Torres Actualizada');
    });

    testWidgets('deactivating an employee calls the real endpoint and the row reflects the new status', (tester) async {
      final gateway = _RecordingEmployeesGateway(seed: [_activeEmployee]);
      await _pump(tester, employeesGateway: gateway);
      await tester.pumpAndSettle();

      await tester.tap(find.byKey(const Key('pos-employee-row-employee-1')));
      await tester.pumpAndSettle();
      expect(find.byKey(const Key('pos-employee-detail-deactivate')), findsOneWidget);

      await tester.tap(find.byKey(const Key('pos-employee-detail-deactivate')));
      await tester.pumpAndSettle();

      expect(gateway.deactivateCalls, ['employee-1']);
      expect(find.byKey(const Key('pos-employee-detail-reactivate')), findsOneWidget);
    });

    testWidgets('a deactivated employee cannot self-service clock in — the real employee_inactive rejection is shown', (
      tester,
    ) async {
      // The self-service picker only ever lists active employees (a real,
      // deliberate UI-level precaution) — an already-deactivated employee
      // therefore never auto-resolves as "self" there, so this exercises
      // the honest fallback path: manual employee id entry still reaches
      // the real endpoint, which is the actual, authoritative source of
      // the `employee_inactive` rejection (never fabricated client-side).
      final inactiveEmployee = _activeEmployee.deactivated();
      final employeesGateway = _RecordingEmployeesGateway(seed: [inactiveEmployee]);
      final timeClockGateway = _RecordingTimeClockGateway(
        clockInError: ApiException(AppFailure.fromCode('employee_inactive')),
      );
      await _pump(tester, employeesGateway: employeesGateway, timeClockGateway: timeClockGateway);
      await _navigateToTab(tester, 'Checador');
      await tester.pumpAndSettle();

      await tester.enterText(find.byKey(const Key('pos-timeclock-self-employee-id')), 'employee-1');
      await tester.pump();
      await tester.tap(find.byKey(const Key('pos-timeclock-clock-in')));
      await tester.pumpAndSettle();

      expect(timeClockGateway.clockInCalls, ['employee-1']);
      expect(
        find.text('Este empleado está inactivo y no puede registrar entrada.'),
        findsOneWidget,
      );
    });

    testWidgets('an actor without employee.manage sees the create/edit/deactivate actions disabled', (tester) async {
      final gateway = _RecordingEmployeesGateway(seed: [_activeEmployee]);
      await _pump(tester, employeesGateway: gateway, permissions: const ['employee.read']);
      await tester.pumpAndSettle();

      final newButton = tester.widget<FilledButton>(find.byKey(const Key('pos-employees-new')));
      expect(newButton.onPressed, isNull);

      await tester.tap(find.byKey(const Key('pos-employee-row-employee-1')));
      await tester.pumpAndSettle();
      final editButton = tester.widget<OutlinedButton>(find.byKey(const Key('pos-employee-detail-edit')));
      expect(editButton.onPressed, isNull);
      final deactivateButton = tester.widget<FilledButton>(find.byKey(const Key('pos-employee-detail-deactivate')));
      expect(deactivateButton.onPressed, isNull);
    });
  });

  // TASK 16.26 — `PosPeopleScreen`'s own roster/attendance data is only
  // ever fetched in `initState` (`_branchId => widget.context.session
  // .branchId`, read once). A live branch switch on the surrounding
  // `pos_shell.dart` module switch now supplies a branch-keyed
  // `ValueKey('employees-$branchId')` (mirroring `_Caja`/`_DashboardReady`'s
  // own established convention) specifically so Flutter fully discards and
  // rebuilds this widget's state on a branch change, rather than leaving
  // the previous branch's roster on screen. This test proves that
  // mechanism directly.
  group('Cambio de sucursal (TASK 16.26) — un remount con clave nueva descarta el roster anterior', () {
    testWidgets('un ValueKey distinto fuerza un remount real y una nueva consulta con el branchId de la sucursal nueva', (
      tester,
    ) async {
      tester.view.physicalSize = const Size(1440, 1000);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.reset);

      AuthenticatedContext contextFor(String branchId) => AuthenticatedContext(
        session: SessionContext(
          id: 'session-id',
          userId: 'user-id',
          companyId: 'company-id',
          branchId: branchId,
          permittedBranchIds: const ['branch-id', 'branch-other'],
          companyWideAccess: false,
          expiresAt: DateTime.utc(2099),
        ),
        user: _context.user,
        companies: _context.companies,
        branches: _context.branches,
        companyWideAccess: false,
        permissions: _context.permissions,
      );

      Widget buildFor(String branchId, PosEmployeesGateway gateway) => MaterialApp(
        theme: PosTheme.light(),
        home: Scaffold(
          body: SingleChildScrollView(
            child: PosPeopleScreen(
              key: ValueKey('employees-$branchId'),
              context: contextFor(branchId),
              employeesGateway: gateway,
              schedulesGateway: const EmptyPosSchedulesGateway(),
              timeClockGateway: const EmptyPosTimeClockGateway(),
              payrollGateway: const EmptyPosPayrollGateway(),
            ),
          ),
        ),
      );

      final branchAGateway = _RecordingEmployeesGateway(seed: [_activeEmployee]);
      await tester.pumpWidget(buildFor('branch-id', branchAGateway));
      await tester.pumpAndSettle();
      expect(find.text('Ana Torres'), findsOneWidget);

      final otherBranchEmployee = PosEmployee(
        id: 'employee-other',
        branchId: 'branch-other',
        code: 'EMP-9',
        displayName: 'Luis Ramírez',
        phone: null,
        email: null,
        jobTitle: 'Cajero',
        status: 'active',
        hireDate: '2024-02-01',
        weeklySalary: '1500.0000',
        currencyCode: 'MXN',
        userId: 'user-other',
        notes: null,
        deactivatedAt: null,
        deactivatedBy: null,
        version: 1,
        createdAt: DateTime.utc(2024, 2, 1),
        updatedAt: DateTime.utc(2024, 2, 1),
      );
      final branchBGateway = _RecordingEmployeesGateway(seed: [otherBranchEmployee]);
      await tester.pumpWidget(buildFor('branch-other', branchBGateway));
      await tester.pumpAndSettle();

      // The previous branch's employee never lingers after a real
      // remount, and the new branch's own roster is fetched fresh.
      expect(find.text('Ana Torres'), findsNothing);
      expect(find.text('Luis Ramírez'), findsOneWidget);
    });
  });

  group('Horarios', () {
    testWidgets('a day off with a scheduled_start shows the real client-side validation error, never submits', (
      tester,
    ) async {
      // A stale/corrupted row (isDayOff=true with a scheduled_start still
      // set) — the widget itself always clears both time fields the moment
      // a user flips "Día de descanso" on, so this combination can only
      // ever reach the form through already-loaded data, never live user
      // interaction. Opening this row's editor and saving without touching
      // the (hidden) time field still exercises the exact backend rule.
      final corrupted = PosEmployeeSchedule(
        id: 'schedule-1',
        branchId: 'branch-id',
        employeeId: 'employee-1',
        workDate: '2026-09-10',
        isDayOff: true,
        scheduledStart: '09:00',
        scheduledEnd: null,
        notes: null,
        createdAt: DateTime.utc(2026, 9, 1),
        updatedAt: DateTime.utc(2026, 9, 1),
      );
      final schedulesGateway = _RecordingSchedulesGateway(branchResult: [corrupted]);
      final employeesGateway = _RecordingEmployeesGateway(seed: [_activeEmployee]);
      await _pump(
        tester,
        employeesGateway: employeesGateway,
        schedulesGateway: schedulesGateway,
        readGateway: const _FixtureBusinessDateGateway(),
      );
      await _navigateToTab(tester, 'Horarios');
      await tester.pumpAndSettle();

      // TASK 16.29 — the matrix shows every employee as a row automatically;
      // no employee picker/"Cargar" step exists anymore. `2026-09-10` falls
      // inside `_FixtureBusinessDateGateway`'s own resolved week.
      await tester.tap(find.byKey(const Key('pos-schedule-cell-employee-1-2026-09-10')));
      await tester.pumpAndSettle();

      await tester.tap(find.byKey(const Key('pos-schedule-form-save')));
      await tester.pump();

      expect(
        find.text('Un día de descanso no debe incluir hora de inicio ni de fin.'),
        findsOneWidget,
      );
      expect(schedulesGateway.upsertCalls, isEmpty);
    });

    testWidgets('end time not after start time is rejected client-side before ever submitting', (tester) async {
      final schedulesGateway = _RecordingSchedulesGateway();
      final employeesGateway = _RecordingEmployeesGateway(seed: [_activeEmployee]);
      await _pump(
        tester,
        employeesGateway: employeesGateway,
        schedulesGateway: schedulesGateway,
        readGateway: const _FixtureBusinessDateGateway(),
      );
      await _navigateToTab(tester, 'Horarios');
      await tester.pumpAndSettle();

      // A cell with no existing schedule yet — opens the editor pre-filled
      // on that exact day (TASK 16.29's own `initialWorkDate` behavior).
      await tester.tap(find.byKey(const Key('pos-schedule-cell-employee-1-2026-09-10')));
      await tester.pumpAndSettle();

      await tester.enterText(find.byKey(const Key('pos-schedule-form-start')), '18:00');
      await tester.enterText(find.byKey(const Key('pos-schedule-form-end')), '09:00');
      await tester.tap(find.byKey(const Key('pos-schedule-form-save')));
      await tester.pump();

      expect(find.text('La hora de fin debe ser posterior a la hora de inicio.'), findsOneWidget);
      expect(schedulesGateway.upsertCalls, isEmpty);
    });

    testWidgets('a valid shift calls the real upsert endpoint with the exact entered values', (tester) async {
      final schedulesGateway = _RecordingSchedulesGateway();
      final employeesGateway = _RecordingEmployeesGateway(seed: [_activeEmployee]);
      await _pump(
        tester,
        employeesGateway: employeesGateway,
        schedulesGateway: schedulesGateway,
        readGateway: const _FixtureBusinessDateGateway(),
      );
      await _navigateToTab(tester, 'Horarios');
      await tester.pumpAndSettle();

      await tester.tap(find.byKey(const Key('pos-schedule-cell-employee-1-2026-09-10')));
      await tester.pumpAndSettle();

      // The date field is already pre-filled with the tapped cell's own
      // day — never touched here, proving the cell-driven prefill, not a
      // manually-typed date.
      expect(
        tester.widget<TextField>(find.byKey(const Key('pos-schedule-form-date'))).controller!.text,
        '2026-09-10',
      );
      await tester.enterText(find.byKey(const Key('pos-schedule-form-start')), '09:00');
      await tester.enterText(find.byKey(const Key('pos-schedule-form-end')), '18:00');
      await tester.tap(find.byKey(const Key('pos-schedule-form-save')));
      await tester.pumpAndSettle();

      expect(schedulesGateway.upsertCalls, hasLength(1));
      final call = schedulesGateway.upsertCalls.single;
      expect(call.employeeId, 'employee-1');
      expect(call.workDate, '2026-09-10');
      expect(call.isDayOff, isFalse);
      expect(call.scheduledStart, '09:00');
      expect(call.scheduledEnd, '18:00');
    });

    // TASK 16.28/16.29 (Phase 3/9) — quick week navigation, computed from
    // the resolved BUSINESS today (never device-local), matching TASK
    // 16.23B's own timezone semantics.
    testWidgets('week navigation jumps to real Monday-Sunday ranges around the resolved business today', (
      tester,
    ) async {
      final schedulesGateway = _RecordingSchedulesGateway();
      final employeesGateway = _RecordingEmployeesGateway(seed: [_activeEmployee]);
      await _pump(
        tester,
        employeesGateway: employeesGateway,
        schedulesGateway: schedulesGateway,
        readGateway: const _FixtureBusinessDateGateway(),
      );
      await _navigateToTab(tester, 'Horarios');
      await tester.pumpAndSettle();

      String iso(DateTime d) => '${d.year.toString().padLeft(4, '0')}-${d.month.toString().padLeft(2, '0')}-${d.day.toString().padLeft(2, '0')}';
      final today = DateTime.utc(2026, 9, 9); // matches _FixtureBusinessDateGateway.
      final monday = today.subtract(Duration(days: today.weekday - 1));

      // Business-today resolution corrects the initial provisional guess
      // to the CURRENT real week — never left at a device-local guess —
      // proven via the real gateway call the matrix actually issued.
      expect(schedulesGateway.listBranchCalls.last.dateFrom, iso(monday));
      expect(schedulesGateway.listBranchCalls.last.dateTo, iso(monday.add(const Duration(days: 6))));

      await tester.tap(find.byKey(const Key('pos-schedule-week-next')));
      await tester.pumpAndSettle();
      final nextMonday = monday.add(const Duration(days: 7));
      expect(schedulesGateway.listBranchCalls.last.dateFrom, iso(nextMonday));

      await tester.tap(find.byKey(const Key('pos-schedule-week-prev')));
      await tester.pumpAndSettle();
      await tester.tap(find.byKey(const Key('pos-schedule-week-prev')));
      await tester.pumpAndSettle();
      final prevMonday = monday.subtract(const Duration(days: 7));
      expect(schedulesGateway.listBranchCalls.last.dateFrom, iso(prevMonday));

      await tester.tap(find.byKey(const Key('pos-schedule-week-current')));
      await tester.pumpAndSettle();
      expect(schedulesGateway.listBranchCalls.last.dateFrom, iso(monday));
    });

    testWidgets('zero employees preserves the matrix header/week-nav structure with an honest inline message', (
      tester,
    ) async {
      final employeesGateway = _RecordingEmployeesGateway();
      await _pump(tester, employeesGateway: employeesGateway, readGateway: const _FixtureBusinessDateGateway());
      await _navigateToTab(tester, 'Horarios');
      await tester.pumpAndSettle();

      expect(find.byKey(const Key('pos-schedule-matrix')), findsOneWidget);
      expect(find.byKey(const Key('pos-schedule-week-range')), findsOneWidget);
      expect(find.byKey(const Key('pos-schedule-week-current')), findsOneWidget);
      expect(find.text('No hay empleados registrados en esta sucursal.'), findsOneWidget);
    });

    testWidgets('an employee with no schedule for a day renders that cell honestly as "Sin turno"', (tester) async {
      final employeesGateway = _RecordingEmployeesGateway(seed: [_activeEmployee]);
      final schedulesGateway = _RecordingSchedulesGateway(); // no schedules at all.
      await _pump(
        tester,
        employeesGateway: employeesGateway,
        schedulesGateway: schedulesGateway,
        readGateway: const _FixtureBusinessDateGateway(),
      );
      await _navigateToTab(tester, 'Horarios');
      await tester.pumpAndSettle();

      expect(find.byKey(const Key('pos-schedule-row-employee-1')), findsOneWidget);
      expect(find.text('Sin turno'), findsWidgets);
    });
  });

  group('Checador', () {
    testWidgets('a successful clock-in shows the real occurred_at time from the backend', (tester) async {
      final employeesGateway = _RecordingEmployeesGateway(seed: [_activeEmployee]);
      final timeClockGateway = _RecordingTimeClockGateway(
        clockInResult: PosTimeClockPunch(
          id: 'punch-1',
          branchId: 'branch-id',
          employeeId: 'employee-1',
          punchType: 'clock_in',
          occurredAt: DateTime.utc(2026, 9, 7, 15, 30),
          station: null,
          method: 'manual',
          isCorrection: false,
          correctionReason: null,
          correctedPunchId: null,
          createdAt: DateTime.utc(2026, 9, 7, 15, 30),
        ),
      );
      await _pump(tester, employeesGateway: employeesGateway, timeClockGateway: timeClockGateway);
      await _navigateToTab(tester, 'Checador');
      await tester.pumpAndSettle();

      await tester.tap(find.byKey(const Key('pos-timeclock-clock-in')));
      await tester.pumpAndSettle();

      expect(timeClockGateway.clockInCalls, ['employee-1']);
      // TASK 16.29.3 — a successful punch now shows the terminal's own
      // polished confirmation dialog, with the real employee/hora/método
      // fields the backend returned, instead of an inline message.
      expect(find.byKey(const Key('pos-timeclock-confirmation-title')), findsOneWidget);
      expect(
        tester.widget<Text>(find.byKey(const Key('pos-timeclock-confirmation-title'))).data,
        'Entrada registrada',
      );
      expect(
        tester.widget<Text>(find.byKey(const Key('pos-timeclock-confirmation-employee'))).data,
        'Ana Torres (EMP-1)',
      );
      // Computed the same way `_formatTime` itself converts — never a
      // hardcoded local-time string, which would be flaky across test
      // runners in different timezones.
      final localOccurred = DateTime.utc(2026, 9, 7, 15, 30).toLocal();
      final expectedTime =
          '${localOccurred.hour.toString().padLeft(2, '0')}:${localOccurred.minute.toString().padLeft(2, '0')}';
      expect(tester.widget<Text>(find.byKey(const Key('pos-timeclock-confirmation-time'))).data, expectedTime);
      expect(tester.widget<Text>(find.byKey(const Key('pos-timeclock-confirmation-method'))).data, 'Manual');

      await tester.tap(find.byKey(const Key('pos-timeclock-confirmation-close')));
      await tester.pumpAndSettle();
      // Dismissing clears the identification field, ready for the next
      // employee at a shared terminal.
      expect(
        tester.widget<TextField>(find.byKey(const Key('pos-timeclock-self-employee-id'))).controller!.text,
        '',
      );
    });

    testWidgets('a duplicate clock-in shows the real, honest backend rejection message', (tester) async {
      final employeesGateway = _RecordingEmployeesGateway(seed: [_activeEmployee]);
      final timeClockGateway = _RecordingTimeClockGateway(
        clockInError: ApiException(AppFailure.fromCode('duplicate_clock_in')),
      );
      await _pump(tester, employeesGateway: employeesGateway, timeClockGateway: timeClockGateway);
      await _navigateToTab(tester, 'Checador');
      await tester.pumpAndSettle();

      await tester.tap(find.byKey(const Key('pos-timeclock-clock-in')));
      await tester.pumpAndSettle();

      expect(find.text('Este empleado ya tiene una entrada abierta.'), findsOneWidget);
    });

    testWidgets('an invalid clock-out shows the real, honest backend rejection message', (tester) async {
      final employeesGateway = _RecordingEmployeesGateway(seed: [_activeEmployee]);
      final timeClockGateway = _RecordingTimeClockGateway(
        clockOutError: ApiException(AppFailure.fromCode('invalid_clock_out')),
      );
      await _pump(tester, employeesGateway: employeesGateway, timeClockGateway: timeClockGateway);
      await _navigateToTab(tester, 'Checador');
      await tester.pumpAndSettle();

      await tester.tap(find.byKey(const Key('pos-timeclock-clock-out')));
      await tester.pumpAndSettle();

      expect(
        find.text('No hay una entrada abierta para registrar la salida de este empleado.'),
        findsOneWidget,
      );
    });

    testWidgets('a correction inserts a new punch referencing the original — the original is never edited/deleted', (
      tester,
    ) async {
      // TASK 16.29 — "Historial de asistencia" is now branch-wide and
      // auto-loads (no employee picker/"Buscar" required to see data);
      // the "Corregir" action reaches this same, unmodified backend
      // contract (insert-only correction) via `punch.employeeId` now
      // instead of a separately-selected "managed employee".
      final employeesGateway = _RecordingEmployeesGateway(seed: [_activeEmployee]);
      final punch = PosTimeClockPunch(
        id: 'punch-1',
        branchId: 'branch-id',
        employeeId: 'employee-1',
        punchType: 'clock_in',
        occurredAt: DateTime.utc(2026, 9, 7, 9),
        station: null,
        method: 'manual',
        isCorrection: false,
        correctionReason: null,
        correctedPunchId: null,
        createdAt: DateTime.utc(2026, 9, 7, 9),
      );
      final timeClockGateway = _RecordingTimeClockGateway(listPunchesResult: [punch]);
      await _pump(
        tester,
        employeesGateway: employeesGateway,
        timeClockGateway: timeClockGateway,
        permissions: const [
          'employee.read',
          'employee.manage',
          'attendance.read',
          'attendance.manage',
        ],
      );
      await _navigateToTab(tester, 'Checador');
      await tester.pumpAndSettle();

      await tester.tap(find.byKey(const Key('pos-timeclock-correction-open-punch-1')));
      await tester.pumpAndSettle();
      await tester.enterText(find.byKey(const Key('pos-timeclock-correction-reason')), 'Se olvidó marcar a tiempo');
      await tester.tap(find.byKey(const Key('pos-timeclock-correction-save')));
      await tester.pumpAndSettle();

      expect(timeClockGateway.correctCalls, hasLength(1));
      final call = timeClockGateway.correctCalls.single;
      expect(call.correctedPunchId, 'punch-1');
      expect(call.correctionReason, 'Se olvidó marcar a tiempo');
      expect(call.employeeId, 'employee-1');
    });

    testWidgets('a viewer with only attendance.read sees the branch-wide history but never a Corregir action', (
      tester,
    ) async {
      final employeesGateway = _RecordingEmployeesGateway(seed: [_activeEmployee]);
      final punch = PosTimeClockPunch(
        id: 'punch-1',
        branchId: 'branch-id',
        employeeId: 'employee-1',
        punchType: 'clock_in',
        occurredAt: DateTime.utc(2026, 9, 7, 9),
        station: null,
        method: 'manual',
        isCorrection: false,
        correctionReason: null,
        correctedPunchId: null,
        createdAt: DateTime.utc(2026, 9, 7, 9),
      );
      final timeClockGateway = _RecordingTimeClockGateway(listPunchesResult: [punch]);
      await _pump(
        tester,
        employeesGateway: employeesGateway,
        timeClockGateway: timeClockGateway,
        permissions: const ['employee.read', 'attendance.read'],
      );
      await _navigateToTab(tester, 'Checador');
      await tester.pumpAndSettle();

      expect(find.byKey(const Key('pos-timeclock-punch-row-punch-1')), findsOneWidget);
      expect(find.byKey(const Key('pos-timeclock-correction-open-punch-1')), findsNothing);
    });

    testWidgets('zero punches preserves both the today and history panels with an honest inline message', (
      tester,
    ) async {
      final employeesGateway = _RecordingEmployeesGateway(seed: [_activeEmployee]);
      final timeClockGateway = _RecordingTimeClockGateway();
      await _pump(
        tester,
        employeesGateway: employeesGateway,
        timeClockGateway: timeClockGateway,
        permissions: const ['employee.read', 'attendance.read', 'attendance.manage'],
      );
      await _navigateToTab(tester, 'Checador');
      await tester.pumpAndSettle();

      expect(find.text('Checadas de hoy'), findsOneWidget);
      expect(find.text('Historial de asistencia'), findsOneWidget);
      expect(find.text('Sin checadas hoy.'), findsOneWidget);
      expect(find.text('No hay marcaciones en este rango.'), findsOneWidget);
    });

    // TASK 16.28 — the punch row must show the REAL, stored `method`
    // honestly (never fabricate 'Biométrico' for a manual entry, and
    // never hide a real device-sourced punch as manual either). No real
    // device exists yet, but the field/label plumbing is exercised here
    // ahead of one — see docs/WORKFORCE_SYSTEM.md.
    testWidgets('the punch method is shown honestly — Manual vs. Dispositivo, never fabricated', (tester) async {
      final employeesGateway = _RecordingEmployeesGateway(seed: [_activeEmployee]);
      final manualPunch = PosTimeClockPunch(
        id: 'punch-manual',
        branchId: 'branch-id',
        employeeId: 'employee-1',
        punchType: 'clock_in',
        occurredAt: DateTime.utc(2026, 9, 7, 9),
        station: null,
        method: 'manual',
        isCorrection: false,
        correctionReason: null,
        correctedPunchId: null,
        createdAt: DateTime.utc(2026, 9, 7, 9),
      );
      final devicePunch = PosTimeClockPunch(
        id: 'punch-device',
        branchId: 'branch-id',
        employeeId: 'employee-1',
        punchType: 'clock_out',
        occurredAt: DateTime.utc(2026, 9, 7, 18),
        station: 'Terminal 1',
        method: 'device',
        isCorrection: false,
        correctionReason: null,
        correctedPunchId: null,
        createdAt: DateTime.utc(2026, 9, 7, 18),
      );
      final timeClockGateway = _RecordingTimeClockGateway(listPunchesResult: [manualPunch, devicePunch]);
      await _pump(
        tester,
        employeesGateway: employeesGateway,
        timeClockGateway: timeClockGateway,
        permissions: const ['employee.read', 'employee.manage', 'attendance.read', 'attendance.manage'],
      );
      await _navigateToTab(tester, 'Checador');
      await tester.pumpAndSettle();

      expect(
        tester.widget<Text>(find.byKey(const Key('pos-timeclock-punch-method-punch-manual'))).data,
        'Método: Manual',
      );
      expect(
        tester.widget<Text>(find.byKey(const Key('pos-timeclock-punch-method-punch-device'))).data,
        'Método: Dispositivo',
      );
      expect(find.textContaining('Biométrico'), findsNothing);
    });

    // TASK 16.29.3 — the terminal-style upper Checador panel.
    group('Terminal', () {
      testWidgets('the title, live clock/date, and employee identification field all render', (tester) async {
        await _pump(tester, employeesGateway: _RecordingEmployeesGateway());
        await _navigateToTab(tester, 'Checador');
        await tester.pumpAndSettle();

        expect(find.text('CHECADOR'), findsOneWidget);
        expect(find.byKey(const Key('pos-timeclock-terminal-clock')), findsOneWidget);
        expect(find.byKey(const Key('pos-timeclock-terminal-date')), findsOneWidget);
        expect(find.byKey(const Key('pos-timeclock-self-employee-id')), findsOneWidget);
      });

      testWidgets('Entrada and Salida stay disabled until an employee is identified, then enable', (tester) async {
        await _pump(tester, employeesGateway: _RecordingEmployeesGateway());
        await _navigateToTab(tester, 'Checador');
        await tester.pumpAndSettle();

        FilledButton entradaButton() => tester.widget<FilledButton>(find.byKey(const Key('pos-timeclock-clock-in')));
        FilledButton salidaButton() => tester.widget<FilledButton>(find.byKey(const Key('pos-timeclock-clock-out')));
        expect(entradaButton().onPressed, isNull);
        expect(salidaButton().onPressed, isNull);

        await tester.enterText(find.byKey(const Key('pos-timeclock-self-employee-id')), 'EMP-1');
        await tester.pump();

        expect(entradaButton().onPressed, isNotNull);
        expect(salidaButton().onPressed, isNotNull);
      });

      testWidgets('typing a real employee code (case-insensitive) resolves it to the real employee id on punch', (
        tester,
      ) async {
        final employeesGateway = _RecordingEmployeesGateway(seed: [_activeEmployee]);
        final timeClockGateway = _RecordingTimeClockGateway();
        // Exercises the CODE lookup path against the real,
        // already-fetched branch roster — never a fabricated backend
        // "lookup by name/code" capability. Lowercase, unlike the
        // employee's real stored code ("EMP-1"), to prove the match is
        // case-insensitive.
        await _pump(tester, employeesGateway: employeesGateway, timeClockGateway: timeClockGateway);
        await _navigateToTab(tester, 'Checador');
        await tester.pumpAndSettle();

        await tester.enterText(find.byKey(const Key('pos-timeclock-self-employee-id')), 'emp-1');
        await tester.pump();
        await tester.tap(find.byKey(const Key('pos-timeclock-clock-in')));
        await tester.pumpAndSettle();

        expect(timeClockGateway.clockInCalls, ['employee-1']);
      });

      testWidgets('the automatic-device area says Próximamente and never claims a connected device', (tester) async {
        await _pump(tester, employeesGateway: _RecordingEmployeesGateway());
        await _navigateToTab(tester, 'Checador');
        await tester.pumpAndSettle();

        expect(find.byKey(const Key('pos-timeclock-device-placeholder')), findsOneWidget);
        expect(find.textContaining('Próximamente'), findsOneWidget);
        expect(find.textContaining('Conectado'), findsNothing);
      });

      testWidgets('the terminal renders without overflow at a desktop presentation size', (tester) async {
        await _pump(tester, employeesGateway: _RecordingEmployeesGateway());
        // `_pump` itself already sizes at 1440x1000; re-assert at the
        // task's own named 1365x768 presentation target too.
        tester.view.physicalSize = const Size(1365, 768);
        tester.view.devicePixelRatio = 1;
        await _navigateToTab(tester, 'Checador');
        await tester.pumpAndSettle();

        expect(tester.takeException(), isNull);
        expect(find.byKey(const Key('pos-timeclock-terminal')), findsOneWidget);
      });

      testWidgets('the terminal renders without overflow at a narrow width', (tester) async {
        await _pump(tester, employeesGateway: _RecordingEmployeesGateway());
        tester.view.physicalSize = const Size(390, 844);
        tester.view.devicePixelRatio = 1;
        await _navigateToTab(tester, 'Checador');
        await tester.pumpAndSettle();

        expect(tester.takeException(), isNull);
        expect(find.byKey(const Key('pos-timeclock-terminal')), findsOneWidget);
      });
    });
  });

  group('Nómina', () {
    testWidgets('Calcular shows the real computed lines from the backend — never client-computed figures', (
      tester,
    ) async {
      final payrollGateway = _RecordingPayrollGateway(
        periods: [_draftPeriod],
        calculateResult: PosPayrollPeriodDetail(
          period: _draftPeriod,
          lines: [
            PosPayrollPeriodLine(
              id: 'line-1',
              employeeId: 'employee-1',
              scheduledMinutes: 2400,
              workedMinutes: 2350,
              lateMinutes: 15,
              overtimeMinutes: 0,
              baseSalarySnapshot: '1500.0000',
              deductionAmount: '9.3750',
              bonusAmount: '0.0000',
              totalAmount: '1490.6250',
              currencyCode: 'MXN',
              computedAt: DateTime.utc(2026, 9, 7),
              computedBy: 'user-id',
            ),
          ],
        ),
      );
      await _pump(tester, payrollGateway: payrollGateway);
      await _navigateToTab(tester, 'Nómina');
      await tester.pumpAndSettle();

      await tester.tap(find.byKey(const Key('pos-payroll-period-row-period-1')));
      await tester.pumpAndSettle();

      await tester.tap(find.byKey(const Key('pos-payroll-calculate')));
      await tester.pumpAndSettle();

      expect(payrollGateway.calculateCalls, ['period-1']);
      expect(find.text('2400 min'), findsOneWidget);
      expect(find.text('15 min'), findsOneWidget);
      expect(find.text('\$1490.63'), findsOneWidget);
    });

    testWidgets('Cerrar periodo requires an explicit confirmation, then calls the real endpoint', (tester) async {
      final payrollGateway = _RecordingPayrollGateway(periods: [_draftPeriod]);
      await _pump(tester, payrollGateway: payrollGateway);
      await _navigateToTab(tester, 'Nómina');
      await tester.pumpAndSettle();

      await tester.tap(find.byKey(const Key('pos-payroll-period-row-period-1')));
      await tester.pumpAndSettle();

      await tester.tap(find.byKey(const Key('pos-payroll-close')));
      await tester.pumpAndSettle();

      expect(payrollGateway.closeCalls, isEmpty);
      expect(find.byKey(const Key('pos-payroll-close-confirm')), findsOneWidget);

      await tester.tap(find.byKey(const Key('pos-payroll-close-confirm')));
      await tester.pumpAndSettle();

      expect(payrollGateway.closeCalls, ['period-1']);
    });

    testWidgets('Reabrir requires its own distinct confirmation, then calls the real endpoint', (tester) async {
      final payrollGateway = _RecordingPayrollGateway(periods: [_closedPeriod]);
      await _pump(tester, payrollGateway: payrollGateway);
      await _navigateToTab(tester, 'Nómina');
      await tester.pumpAndSettle();

      await tester.tap(find.byKey(const Key('pos-payroll-period-row-period-2')));
      await tester.pumpAndSettle();

      await tester.tap(find.byKey(const Key('pos-payroll-reopen')));
      await tester.pumpAndSettle();

      expect(payrollGateway.reopenCalls, isEmpty);
      expect(find.byKey(const Key('pos-payroll-reopen-confirm')), findsOneWidget);

      await tester.tap(find.byKey(const Key('pos-payroll-reopen-confirm')));
      await tester.pumpAndSettle();

      expect(payrollGateway.reopenCalls, ['period-2']);
    });

    testWidgets('an actor without payroll.close cannot see/trigger close or reopen', (tester) async {
      final payrollGateway = _RecordingPayrollGateway(periods: [_draftPeriod, _closedPeriod]);
      await _pump(
        tester,
        payrollGateway: payrollGateway,
        permissions: const ['payroll.read', 'payroll.manage'],
      );
      await _navigateToTab(tester, 'Nómina');
      await tester.pumpAndSettle();

      await tester.tap(find.byKey(const Key('pos-payroll-period-row-period-1')));
      await tester.pumpAndSettle();

      final closeButton = tester.widget<OutlinedButton>(find.byKey(const Key('pos-payroll-close')));
      expect(closeButton.onPressed, isNull);
      final calculateButton = tester.widget<FilledButton>(find.byKey(const Key('pos-payroll-calculate')));
      expect(calculateButton.onPressed, isNotNull);

      await tester.tap(find.byKey(const Key('pos-payroll-close')));
      await tester.pumpAndSettle();
      expect(payrollGateway.closeCalls, isEmpty);
      expect(find.byKey(const Key('pos-payroll-close-confirm')), findsNothing);
    });
  });
}

// --- Fixtures -----------------------------------------------------------

final _context = AuthenticatedContext(
  session: SessionContext(
    id: 'session-id',
    userId: 'user-id',
    companyId: 'company-id',
    branchId: 'branch-id',
    permittedBranchIds: const ['branch-id'],
    companyWideAccess: false,
    expiresAt: DateTime.utc(2099),
  ),
  user: const UserSummary(id: 'user-id', displayName: 'Usuario AS', email: 'user@example.test'),
  companies: const [CompanySummary(id: 'company-id', name: 'Empresa AS', current: true)],
  branches: const [
    BranchSummary(
      id: 'branch-id',
      code: 'CENTRO',
      name: 'Sucursal Centro',
      timezone: 'America/Mexico_City',
      current: true,
    ),
  ],
  companyWideAccess: false,
  permissions: const [
    'employee.read',
    'employee.manage',
    'schedule.read',
    'schedule.manage',
    'attendance.read',
    'attendance.manage',
    'payroll.read',
    'payroll.manage',
    'payroll.close',
  ],
);

final _activeEmployee = PosEmployee(
  id: 'employee-1',
  branchId: 'branch-id',
  code: 'EMP-1',
  displayName: 'Ana Torres',
  phone: null,
  email: null,
  jobTitle: 'Cajera',
  status: 'active',
  hireDate: '2024-01-15',
  weeklySalary: '1500.0000',
  currencyCode: 'MXN',
  userId: 'user-id',
  notes: null,
  deactivatedAt: null,
  deactivatedBy: null,
  version: 3,
  createdAt: DateTime.utc(2024, 1, 15),
  updatedAt: DateTime.utc(2024, 1, 15),
);

extension on PosEmployee {
  PosEmployee deactivated() => PosEmployee(
    id: id,
    branchId: branchId,
    code: code,
    displayName: displayName,
    phone: phone,
    email: email,
    jobTitle: jobTitle,
    status: 'inactive',
    hireDate: hireDate,
    weeklySalary: weeklySalary,
    currencyCode: currencyCode,
    userId: userId,
    notes: notes,
    deactivatedAt: DateTime.utc(2026, 9, 1),
    deactivatedBy: 'user-id',
    version: version + 1,
    createdAt: createdAt,
    updatedAt: DateTime.utc(2026, 9, 1),
  );
}

final _draftPeriod = PosPayrollPeriod(
  id: 'period-1',
  branchId: 'branch-id',
  periodStart: '2026-09-01',
  periodEnd: '2026-09-07',
  status: 'draft',
  closedAt: null,
  closedBy: null,
  createdAt: DateTime.utc(2026, 9, 1),
  updatedAt: DateTime.utc(2026, 9, 1),
);

final _closedPeriod = PosPayrollPeriod(
  id: 'period-2',
  branchId: 'branch-id',
  periodStart: '2026-09-01',
  periodEnd: '2026-09-07',
  status: 'closed',
  closedAt: DateTime.utc(2026, 9, 8),
  closedBy: 'user-id',
  createdAt: DateTime.utc(2026, 9, 1),
  updatedAt: DateTime.utc(2026, 9, 8),
);

// TASK 16.28 (Phase 9) — a fixed, real business date so the Horarios
// week-navigation test can assert exact Monday-Sunday boundaries,
// mirroring `pos_shell_wave3_dashboard_test.dart`'s own
// `_FixtureReadGateway` pattern. Every other `PosReadGateway` method is
// unused by `PosPeopleScreen` and throws if ever called.
class _FixtureBusinessDateGateway implements PosReadGateway {
  const _FixtureBusinessDateGateway();

  @override
  Future<String> businessDate({required String timezone}) async => '2026-09-09';

  @override
  Future<List<PosCategory>> categories() => throw UnimplementedError();

  @override
  Future<List<PosInventoryBalance>> inventoryBalances({String? branchId}) => throw UnimplementedError();

  @override
  Future<PosProduct?> productByBarcode(String barcode, {String? branchId}) => throw UnimplementedError();

  @override
  Future<List<PosProduct>> products({String? branchId}) => throw UnimplementedError();

  @override
  Future<List<PosUser>> users() => throw UnimplementedError();
}

class _RecordingEmployeesGateway implements PosEmployeesGateway {
  _RecordingEmployeesGateway({List<PosEmployee> seed = const []}) : _items = [...seed];
  final List<PosEmployee> _items;

  final List<PosEmployeeCreateInput> createCalls = [];
  final List<({String id, PosEmployeeUpdateInput input, int version})> updateCalls = [];
  final List<String> deactivateCalls = [];
  final List<String> reactivateCalls = [];

  @override
  Future<PosEmployee> createEmployee(PosEmployeeCreateInput input) async {
    createCalls.add(input);
    final created = PosEmployee(
      id: input.id ?? 'employee-new',
      branchId: input.branchId,
      code: input.code,
      displayName: input.displayName,
      phone: input.phone,
      email: input.email,
      jobTitle: input.jobTitle,
      status: 'active',
      hireDate: input.hireDate,
      weeklySalary: input.weeklySalary,
      currencyCode: input.currencyCode,
      userId: input.userId,
      notes: input.notes,
      deactivatedAt: null,
      deactivatedBy: null,
      version: 1,
      createdAt: DateTime.utc(2026, 9, 7),
      updatedAt: DateTime.utc(2026, 9, 7),
    );
    _items.add(created);
    return created;
  }

  @override
  Future<PosEmployeePage> listEmployees({String? cursor, int limit = 50, String? branchId, String? status}) async {
    final filtered = _items.where((employee) {
      if (branchId != null && employee.branchId != branchId) return false;
      if (status != null && employee.status != status) return false;
      return true;
    }).toList(growable: false);
    return PosEmployeePage(items: filtered, nextCursor: null);
  }

  @override
  Future<PosEmployee> employee(String id) async => _items.firstWhere((employee) => employee.id == id);

  @override
  Future<PosEmployee> updateEmployee(String id, PosEmployeeUpdateInput input, {required int version}) async {
    updateCalls.add((id: id, input: input, version: version));
    final index = _items.indexWhere((employee) => employee.id == id);
    final existing = _items[index];
    final updated = PosEmployee(
      id: existing.id,
      branchId: existing.branchId,
      code: existing.code,
      displayName: input.displayName ?? existing.displayName,
      phone: input.phone ?? existing.phone,
      email: input.email ?? existing.email,
      jobTitle: input.jobTitle ?? existing.jobTitle,
      status: existing.status,
      hireDate: input.hireDate ?? existing.hireDate,
      weeklySalary: input.weeklySalary ?? existing.weeklySalary,
      currencyCode: input.currencyCode ?? existing.currencyCode,
      userId: input.userId ?? existing.userId,
      notes: input.notes ?? existing.notes,
      deactivatedAt: existing.deactivatedAt,
      deactivatedBy: existing.deactivatedBy,
      version: existing.version + 1,
      createdAt: existing.createdAt,
      updatedAt: DateTime.utc(2026, 9, 7),
    );
    _items[index] = updated;
    return updated;
  }

  @override
  Future<PosEmployee> deactivateEmployee(String id) async {
    deactivateCalls.add(id);
    final index = _items.indexWhere((employee) => employee.id == id);
    final existing = _items[index];
    final updated = PosEmployee(
      id: existing.id,
      branchId: existing.branchId,
      code: existing.code,
      displayName: existing.displayName,
      phone: existing.phone,
      email: existing.email,
      jobTitle: existing.jobTitle,
      status: 'inactive',
      hireDate: existing.hireDate,
      weeklySalary: existing.weeklySalary,
      currencyCode: existing.currencyCode,
      userId: existing.userId,
      notes: existing.notes,
      deactivatedAt: DateTime.utc(2026, 9, 7),
      deactivatedBy: 'user-id',
      version: existing.version + 1,
      createdAt: existing.createdAt,
      updatedAt: DateTime.utc(2026, 9, 7),
    );
    _items[index] = updated;
    return updated;
  }

  @override
  Future<PosEmployee> reactivateEmployee(String id) async {
    reactivateCalls.add(id);
    final index = _items.indexWhere((employee) => employee.id == id);
    final existing = _items[index];
    final updated = PosEmployee(
      id: existing.id,
      branchId: existing.branchId,
      code: existing.code,
      displayName: existing.displayName,
      phone: existing.phone,
      email: existing.email,
      jobTitle: existing.jobTitle,
      status: 'active',
      hireDate: existing.hireDate,
      weeklySalary: existing.weeklySalary,
      currencyCode: existing.currencyCode,
      userId: existing.userId,
      notes: existing.notes,
      deactivatedAt: null,
      deactivatedBy: null,
      version: existing.version + 1,
      createdAt: existing.createdAt,
      updatedAt: DateTime.utc(2026, 9, 7),
    );
    _items[index] = updated;
    return updated;
  }
}

class _RecordingSchedulesGateway implements PosSchedulesGateway {
  _RecordingSchedulesGateway({this.listResult = const [], List<PosEmployeeSchedule>? branchResult})
    : branchResult = branchResult ?? listResult;
  final List<PosEmployeeSchedule> listResult;
  // TASK 16.29 — the Horarios weekly matrix's own branch-wide fixture;
  // defaults to `listResult` so pre-16.29 tests that never set either
  // keep working unchanged.
  final List<PosEmployeeSchedule> branchResult;
  final List<PosScheduleUpsertInput> upsertCalls = [];
  final List<({String branchId, String dateFrom, String dateTo})> listBranchCalls = [];

  @override
  Future<PosEmployeeSchedule> upsertSchedule(PosScheduleUpsertInput input) async {
    upsertCalls.add(input);
    return PosEmployeeSchedule(
      id: input.id ?? 'schedule-1',
      branchId: 'branch-id',
      employeeId: input.employeeId,
      workDate: input.workDate,
      isDayOff: input.isDayOff,
      scheduledStart: input.scheduledStart,
      scheduledEnd: input.scheduledEnd,
      notes: input.notes,
      createdAt: DateTime.utc(2026, 9, 7),
      updatedAt: DateTime.utc(2026, 9, 7),
    );
  }

  @override
  Future<List<PosEmployeeSchedule>> listSchedules({
    required String employeeId,
    required String dateFrom,
    required String dateTo,
  }) async => listResult;

  @override
  Future<List<PosEmployeeSchedule>> listSchedulesForBranch({
    required String branchId,
    required String dateFrom,
    required String dateTo,
  }) async {
    listBranchCalls.add((branchId: branchId, dateFrom: dateFrom, dateTo: dateTo));
    return branchResult;
  }
}

class _RecordingTimeClockGateway implements PosTimeClockGateway {
  _RecordingTimeClockGateway({
    this.clockInResult,
    this.clockOutResult,
    this.clockInError,
    this.clockOutError,
    this.listPunchesResult = const [],
    List<PosTimeClockPunch>? branchResult,
  }) : branchResult = branchResult ?? listPunchesResult;

  final PosTimeClockPunch? clockInResult;
  final PosTimeClockPunch? clockOutResult;
  final ApiException? clockInError;
  final ApiException? clockOutError;
  final List<PosTimeClockPunch> listPunchesResult;
  // TASK 16.29 — Checador's own branch-wide fixture; defaults to
  // `listPunchesResult` so pre-16.29 tests keep working unchanged.
  final List<PosTimeClockPunch> branchResult;

  final List<String> clockInCalls = [];
  final List<String> clockOutCalls = [];
  final List<PosTimeClockCorrectionInput> correctCalls = [];
  final List<({String branchId, String? dateFrom, String? dateTo})> listBranchCalls = [];

  @override
  Future<PosTimeClockPunch> clockIn({required String employeeId, String? station}) async {
    clockInCalls.add(employeeId);
    if (clockInError != null) return Future.error(clockInError!);
    return clockInResult ??
        PosTimeClockPunch(
          id: 'punch-in-1',
          branchId: 'branch-id',
          employeeId: employeeId,
          punchType: 'clock_in',
          occurredAt: DateTime.utc(2026, 9, 7, 9),
          station: station,
          method: 'manual',
          isCorrection: false,
          correctionReason: null,
          correctedPunchId: null,
          createdAt: DateTime.utc(2026, 9, 7, 9),
        );
  }

  @override
  Future<PosTimeClockPunch> clockOut({required String employeeId, String? station}) async {
    clockOutCalls.add(employeeId);
    if (clockOutError != null) return Future.error(clockOutError!);
    return clockOutResult ??
        PosTimeClockPunch(
          id: 'punch-out-1',
          branchId: 'branch-id',
          employeeId: employeeId,
          punchType: 'clock_out',
          occurredAt: DateTime.utc(2026, 9, 7, 18),
          station: station,
          method: 'manual',
          isCorrection: false,
          correctionReason: null,
          correctedPunchId: null,
          createdAt: DateTime.utc(2026, 9, 7, 18),
        );
  }

  @override
  Future<PosTimeClockPunch> correctPunch(PosTimeClockCorrectionInput input) async {
    correctCalls.add(input);
    return PosTimeClockPunch(
      id: 'punch-correction-1',
      branchId: 'branch-id',
      employeeId: input.employeeId,
      punchType: input.punchType,
      occurredAt: DateTime.parse(input.occurredAt),
      station: input.station,
      method: 'manual',
      isCorrection: true,
      correctionReason: input.correctionReason,
      correctedPunchId: input.correctedPunchId,
      createdAt: DateTime.utc(2026, 9, 7),
    );
  }

  @override
  Future<List<PosTimeClockPunch>> listPunches({
    required String employeeId,
    String? dateFrom,
    String? dateTo,
    int limit = 100,
  }) async => listPunchesResult;

  @override
  Future<List<PosTimeClockPunch>> listPunchesForBranch({
    required String branchId,
    String? dateFrom,
    String? dateTo,
    int limit = 100,
  }) async {
    listBranchCalls.add((branchId: branchId, dateFrom: dateFrom, dateTo: dateTo));
    return branchResult;
  }
}

class _RecordingPayrollGateway implements PosPayrollGateway {
  _RecordingPayrollGateway({List<PosPayrollPeriod> periods = const [], this.calculateResult}) : _periods = [...periods];
  final List<PosPayrollPeriod> _periods;
  final PosPayrollPeriodDetail? calculateResult;

  final List<String> calculateCalls = [];
  final List<String> closeCalls = [];
  final List<String> reopenCalls = [];

  @override
  Future<PosPayrollPeriod> createPeriod({
    required String branchId,
    required String periodStart,
    required String periodEnd,
  }) async => throw StateError('not used');

  @override
  Future<PosPayrollPeriodDetail> period(String id) async {
    final period = _periods.firstWhere((value) => value.id == id);
    return PosPayrollPeriodDetail(period: period, lines: const []);
  }

  @override
  Future<List<PosPayrollPeriod>> listPeriods({String? branchId, String? status, int limit = 50}) async =>
      _periods.where((period) => status == null || period.status == status).toList(growable: false);

  @override
  Future<PosPayrollPeriodDetail> calculate(String id) async {
    calculateCalls.add(id);
    return calculateResult ?? PosPayrollPeriodDetail(period: _periods.firstWhere((value) => value.id == id), lines: const []);
  }

  @override
  Future<PosPayrollPeriod> close(String id) async {
    closeCalls.add(id);
    final index = _periods.indexWhere((value) => value.id == id);
    final existing = _periods[index];
    final updated = PosPayrollPeriod(
      id: existing.id,
      branchId: existing.branchId,
      periodStart: existing.periodStart,
      periodEnd: existing.periodEnd,
      status: 'closed',
      closedAt: DateTime.utc(2026, 9, 7),
      closedBy: 'user-id',
      createdAt: existing.createdAt,
      updatedAt: DateTime.utc(2026, 9, 7),
    );
    _periods[index] = updated;
    return updated;
  }

  @override
  Future<PosPayrollPeriod> reopen(String id) async {
    reopenCalls.add(id);
    final index = _periods.indexWhere((value) => value.id == id);
    final existing = _periods[index];
    final updated = PosPayrollPeriod(
      id: existing.id,
      branchId: existing.branchId,
      periodStart: existing.periodStart,
      periodEnd: existing.periodEnd,
      status: 'draft',
      closedAt: null,
      closedBy: null,
      createdAt: existing.createdAt,
      updatedAt: DateTime.utc(2026, 9, 7),
    );
    _periods[index] = updated;
    return updated;
  }
}

Future<void> _pump(
  WidgetTester tester, {
  PosEmployeesGateway? employeesGateway,
  PosSchedulesGateway? schedulesGateway,
  PosTimeClockGateway? timeClockGateway,
  PosPayrollGateway? payrollGateway,
  PosReadGateway? readGateway,
  List<String>? permissions,
}) async {
  tester.view.physicalSize = const Size(1440, 1000);
  tester.view.devicePixelRatio = 1;
  addTearDown(tester.view.reset);
  final effectiveContext = permissions == null
      ? _context
      : AuthenticatedContext(
          session: _context.session,
          user: _context.user,
          companies: _context.companies,
          branches: _context.branches,
          companyWideAccess: _context.companyWideAccess,
          permissions: permissions,
        );
  await tester.pumpWidget(
    // TASK 16.28 (Phase 9) — mirrors the real app's own tree (`AsOneApp`'s
    // `MaterialApp.builder` wraps every route in `PlatformScope`, see
    // `app.dart`): Horarios now resolves "business today" via
    // `PlatformScope.of(context).posReadGateway`, which throws with no
    // such ancestor — same convention `pos_shell_wave3_dashboard_test.dart`
    // already established for `_Dashboard`.
    PlatformScope(
      posReadGateway: readGateway ?? const EmptyPosReadGateway(),
      child: MaterialApp(
        theme: PosTheme.light(),
        home: Scaffold(
          body: SingleChildScrollView(
            child: PosPeopleScreen(
              context: effectiveContext,
              employeesGateway: employeesGateway ?? const EmptyPosEmployeesGateway(),
              schedulesGateway: schedulesGateway ?? const EmptyPosSchedulesGateway(),
              timeClockGateway: timeClockGateway ?? const EmptyPosTimeClockGateway(),
              payrollGateway: payrollGateway ?? const EmptyPosPayrollGateway(),
            ),
          ),
        ),
      ),
    ),
  );
  await tester.pumpAndSettle();
}

Future<void> _navigateToTab(WidgetTester tester, String label) async {
  await tester.tap(find.descendant(of: find.byKey(const Key('pos-people-tabs')), matching: find.text(label)));
  await tester.pumpAndSettle();
}
