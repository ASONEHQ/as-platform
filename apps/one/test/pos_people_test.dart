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

    // TASK 17.5 §14.2 — a real `showDatePicker` instead of a manually-typed
    // `YYYY-MM-DD` string; the field stays `readOnly` and only the picker
    // itself can set a value, which flows into the exact same
    // `hireDate`/create-payload path as before.
    testWidgets('the hire-date field opens a real date picker and sends the picked date on save', (tester) async {
      final gateway = _RecordingEmployeesGateway();
      await _pump(tester, employeesGateway: gateway);

      await tester.tap(find.byKey(const Key('pos-employees-new')));
      await tester.pumpAndSettle();

      final hireDateField = find.byKey(const Key('pos-employee-form-hire-date'));
      final textFieldWidget = tester.widget<TextField>(hireDateField);
      expect(textFieldWidget.readOnly, isTrue);

      await tester.tap(hireDateField);
      await tester.pumpAndSettle();
      // A real Material date picker opened — not a manual text entry.
      expect(find.byType(DatePickerDialog), findsOneWidget);

      await tester.tap(find.text('OK'));
      await tester.pumpAndSettle();

      final updatedField = tester.widget<TextField>(hireDateField);
      final pickedText = updatedField.controller!.text;
      expect(pickedText, matches(RegExp(r'^\d{4}-\d{2}-\d{2}$')));

      await tester.enterText(find.byKey(const Key('pos-employee-form-code')), 'EMP-2');
      await tester.enterText(find.byKey(const Key('pos-employee-form-name')), 'Luis Peña');
      await tester.enterText(find.byKey(const Key('pos-employee-form-weekly-salary')), '1200.00');
      await tester.pump();
      await tester.tap(find.byKey(const Key('pos-employee-form-save')));
      await tester.pumpAndSettle();

      expect(gateway.createCalls.single.hireDate, pickedText);
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

    // TASK 17.4 — the detail dialog is reachable with mere `employee.read`
    // (unlike create/edit/deactivate, which are all `employee.manage`-
    // gated above), so compensation must be gated inside the dialog too —
    // matching `_EmployeeCard`'s own pre-existing `showSalary` gate one
    // screen back, never shown just because the field exists on the model.
    testWidgets('sin employee.manage, la ficha del empleado nunca muestra el salario semanal', (tester) async {
      final gateway = _RecordingEmployeesGateway(seed: [_activeEmployee]);
      await _pump(tester, employeesGateway: gateway, permissions: const ['employee.read']);
      await tester.pumpAndSettle();

      await tester.tap(find.byKey(const Key('pos-employee-row-employee-1')));
      await tester.pumpAndSettle();

      expect(find.text('Salario semanal'), findsNothing);
    });

    testWidgets('con employee.manage, la ficha del empleado sí muestra el salario semanal', (tester) async {
      final gateway = _RecordingEmployeesGateway(seed: [_activeEmployee]);
      await _pump(tester, employeesGateway: gateway, permissions: const ['employee.read', 'employee.manage']);
      await tester.pumpAndSettle();

      await tester.tap(find.byKey(const Key('pos-employee-row-employee-1')));
      await tester.pumpAndSettle();

      expect(find.text('Salario semanal'), findsOneWidget);
    });

    // TASK 17.4.2 §18/§23 — cards, "Nuevo empleado", search/filter, the
    // detail dialog and salary gating must all stay usable at true phone
    // width, with no overflow anywhere.
    testWidgets('TASK 17.4.2 §18 — a 390x844 la lista, la búsqueda, "Nuevo empleado" y la ficha no revientan', (
      tester,
    ) async {
      final gateway = _RecordingEmployeesGateway(seed: [_activeEmployee]);
      await _pump(tester, employeesGateway: gateway, permissions: const ['employee.read', 'employee.manage']);
      tester.view.physicalSize = const Size(390, 844);
      tester.view.devicePixelRatio = 1;
      await tester.pumpAndSettle();

      expect(tester.takeException(), isNull);
      expect(find.byKey(const Key('pos-employees-grid')), findsOneWidget);
      expect(find.byKey(const Key('pos-employees-search')), findsOneWidget);
      expect(find.byKey(const Key('pos-employees-new')), findsOneWidget);

      final row = find.byKey(const Key('pos-employee-row-employee-1'));
      await tester.ensureVisible(row);
      await tester.tap(row);
      await tester.pumpAndSettle();
      expect(tester.takeException(), isNull);
      expect(find.text('Salario semanal'), findsOneWidget);
    });

    // TASK 16.31 (Phase 19/21/28) — the card/detail visual upgrade must
    // only ever show real fields, omit a genuinely-absent one elegantly
    // (never "—"/"null"), and never fabricate a user-link resolution.
    testWidgets('the employee card shows a real phone number when present, and omits the row when absent', (
      tester,
    ) async {
      final withPhone = PosEmployee(
        id: 'employee-2',
        branchId: 'branch-id',
        code: 'EMP-2',
        displayName: 'Luis Hernández',
        phone: '442-100-0001',
        email: null,
        jobTitle: 'Mantenimiento',
        status: 'active',
        hireDate: '2024-02-01',
        weeklySalary: '1200.0000',
        currencyCode: 'MXN',
        userId: null,
        notes: null,
        deactivatedAt: null,
        deactivatedBy: null,
        version: 1,
        createdAt: DateTime.utc(2024, 2, 1),
        updatedAt: DateTime.utc(2024, 2, 1),
      );
      final gateway = _RecordingEmployeesGateway(seed: [_activeEmployee, withPhone]);
      await _pump(tester, employeesGateway: gateway);
      await tester.pumpAndSettle();

      expect(find.text('442-100-0001'), findsOneWidget);
      expect(find.text('null'), findsNothing);
    });

    testWidgets('employee detail honestly shows "Usuario vinculado" vs "Sin usuario vinculado" — never a raw id as the primary line', (
      tester,
    ) async {
      final unlinked = PosEmployee(
        id: 'employee-3',
        branchId: 'branch-id',
        code: 'EMP-3',
        displayName: 'Marta Ruiz',
        phone: null,
        email: null,
        jobTitle: 'Cocina',
        status: 'active',
        hireDate: '2024-03-01',
        weeklySalary: '1300.0000',
        currencyCode: 'MXN',
        userId: null,
        notes: null,
        deactivatedAt: null,
        deactivatedBy: null,
        version: 1,
        createdAt: DateTime.utc(2024, 3, 1),
        updatedAt: DateTime.utc(2024, 3, 1),
      );
      final gateway = _RecordingEmployeesGateway(seed: [_activeEmployee, unlinked]);
      await _pump(tester, employeesGateway: gateway);
      await tester.pumpAndSettle();

      // _activeEmployee.userId == 'user-id' — linked.
      await tester.tap(find.byKey(const Key('pos-employee-row-employee-1')));
      await tester.pumpAndSettle();
      expect(
        tester.widget<Text>(find.byKey(const Key('pos-employee-detail-user-link-status'))).data,
        'Usuario vinculado',
      );
      await tester.tap(find.text('Cerrar'));
      await tester.pumpAndSettle();

      await tester.tap(find.byKey(const Key('pos-employee-row-employee-3')));
      await tester.pumpAndSettle();
      expect(
        tester.widget<Text>(find.byKey(const Key('pos-employee-detail-user-link-status'))).data,
        'Sin usuario vinculado',
      );
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
    PosPayrollPeriodDetail calculated({List<PosPayrollCurrencyTotals> totals = const []}) =>
        PosPayrollPeriodDetail(period: _draftPeriod, lines: [_payrollLine()], totals: totals);

    Future<void> openWeek(
      WidgetTester tester,
      _RecordingPayrollGateway gateway, {
      String periodKey = 'period-1',
      List<String>? permissions,
      Size size = const Size(1440, 1000),
    }) async {
      await _pump(tester, payrollGateway: gateway, permissions: permissions, size: size);
      await _navigateToTab(tester, 'Nómina');
      await tester.pumpAndSettle();
      await tester.tap(find.byKey(Key('pos-payroll-period-row-$periodKey')));
      await tester.pumpAndSettle();
    }

    Future<void> openEmployee(WidgetTester tester) async {
      await tester.tap(find.byKey(const Key('pos-payroll-line-row-line-1')));
      await tester.pumpAndSettle();
    }

    testWidgets('Calcular shows the real computed lines from the backend — never client-computed figures', (
      tester,
    ) async {
      final payrollGateway = _RecordingPayrollGateway(periods: [_draftPeriod], calculateResult: calculated());
      await openWeek(tester, payrollGateway);

      await tester.tap(find.byKey(const Key('pos-payroll-calculate')));
      await tester.pumpAndSettle();

      expect(payrollGateway.calculateCalls, ['period-1']);
      expect(find.text('40h'), findsOneWidget); // 2400 scheduled minutes
      expect(find.text('39h 10m'), findsOneWidget); // 2350 worked minutes
      expect(find.text('15m'), findsOneWidget); // late
      expect(find.text('\$1490.63'), findsOneWidget);
    });

    testWidgets('the weekly table has the target columns, frozen employee names and the SERVER column totals', (
      tester,
    ) async {
      final payrollGateway = _RecordingPayrollGateway(
        periods: [_draftPeriod],
        lines: [_payrollLine()],
        totals: const [_payrollTotals],
      );
      await openWeek(tester, payrollGateway);

      for (final header in ['Empleado', 'Programado', 'Trabajado', 'Retardo', 'Extra', 'Base', 'Ajuste', 'Total']) {
        expect(find.text(header), findsWidgets, reason: header);
      }
      // The name comes from the frozen snapshot on the line, not the live list.
      expect(find.text('Ana Torres'), findsOneWidget);
      expect(find.byKey(const Key('pos-payroll-totals-MXN')), findsOneWidget);
      expect(find.text('Total MXN · 1 empleado'), findsOneWidget);
      // The row total and the server's column total are both displayed.
      expect(find.text('\$1490.63'), findsNWidgets(2));
      expect(find.byKey(const Key('pos-payroll-print-week')), findsOneWidget);
      expect(find.byKey(const Key('pos-payroll-history')), findsOneWidget);
      expect(find.byKey(const Key('pos-payroll-close')), findsOneWidget);
      expect(tester.takeException(), isNull);
    });

    testWidgets('a week with no calculated lines is an honest empty state, and close/PDF stay disabled', (tester) async {
      final payrollGateway = _RecordingPayrollGateway(periods: [_draftPeriod]);
      await openWeek(tester, payrollGateway);

      expect(find.byKey(const Key('pos-payroll-empty')), findsOneWidget);
      expect(find.byKey(const Key('pos-payroll-table')), findsNothing);
      expect(tester.widget<OutlinedButton>(find.byKey(const Key('pos-payroll-close'))).onPressed, isNull);
      expect(tester.widget<OutlinedButton>(find.byKey(const Key('pos-payroll-print-week'))).onPressed, isNull);
    });

    testWidgets('Cerrar nómina requires an explicit confirmation, then calls the real endpoint', (tester) async {
      final payrollGateway = _RecordingPayrollGateway(periods: [_draftPeriod], lines: [_payrollLine()]);
      await openWeek(tester, payrollGateway);

      await tester.tap(find.byKey(const Key('pos-payroll-close')));
      await tester.pumpAndSettle();

      expect(payrollGateway.closeCalls, isEmpty);
      expect(find.byKey(const Key('pos-payroll-close-confirm')), findsOneWidget);
      expect(find.textContaining('1 empleado'), findsOneWidget);

      await tester.tap(find.byKey(const Key('pos-payroll-close-confirm')));
      await tester.pumpAndSettle();

      expect(payrollGateway.closeCalls, ['period-1']);
    });

    testWidgets('Reabrir demands a reason (recorded with the call) and does nothing without one', (tester) async {
      final payrollGateway = _RecordingPayrollGateway(periods: [_closedPeriod], lines: [_payrollLine()]);
      await openWeek(tester, payrollGateway, periodKey: 'period-2');

      await tester.tap(find.byKey(const Key('pos-payroll-reopen')));
      await tester.pumpAndSettle();
      expect(payrollGateway.reopenCalls, isEmpty);

      // No reason: the dialog stays open, nothing is sent.
      await tester.tap(find.byKey(const Key('pos-payroll-reopen-confirm')));
      await tester.pumpAndSettle();
      expect(payrollGateway.reopenCalls, isEmpty);
      expect(find.text('Escribe un motivo (mínimo 3 caracteres).'), findsOneWidget);

      await tester.enterText(find.byKey(const Key('pos-payroll-reopen-reason')), 'Se corrigió una checada fuera de lugar');
      await tester.tap(find.byKey(const Key('pos-payroll-reopen-confirm')));
      await tester.pumpAndSettle();

      expect(payrollGateway.reopenCalls, ['period-2']);
      expect(payrollGateway.reopenReasons, ['Se corrigió una checada fuera de lugar']);
    });

    testWidgets('an actor without payroll.close cannot see/trigger close or reopen', (tester) async {
      final payrollGateway = _RecordingPayrollGateway(periods: [_draftPeriod, _closedPeriod], lines: [_payrollLine()]);
      await openWeek(tester, payrollGateway, permissions: const ['payroll.read', 'payroll.manage']);

      final closeButton = tester.widget<OutlinedButton>(find.byKey(const Key('pos-payroll-close')));
      expect(closeButton.onPressed, isNull);
      final calculateButton = tester.widget<FilledButton>(find.byKey(const Key('pos-payroll-calculate')));
      expect(calculateButton.onPressed, isNotNull);

      await tester.tap(find.byKey(const Key('pos-payroll-close')));
      await tester.pumpAndSettle();
      expect(payrollGateway.closeCalls, isEmpty);
      expect(find.byKey(const Key('pos-payroll-close-confirm')), findsNothing);
    });

    testWidgets('a backend error on calculate is shown honestly (never a silent failure)', (tester) async {
      final payrollGateway = _RecordingPayrollGateway(periods: [_draftPeriod], calculateFailure: 'La nómina ya está cerrada.');
      await openWeek(tester, payrollGateway);

      await tester.tap(find.byKey(const Key('pos-payroll-calculate')));
      await tester.pumpAndSettle();

      expect(find.text('La nómina ya está cerrada.'), findsOneWidget);
    });

    testWidgets('"PDF de la semana" is a real action: it builds the document and says so if the browser blocks the window', (
      tester,
    ) async {
      final payrollGateway = _RecordingPayrollGateway(
        periods: [_draftPeriod],
        lines: [_payrollLine()],
        totals: const [_payrollTotals],
      );
      await openWeek(tester, payrollGateway);

      await tester.tap(find.byKey(const Key('pos-payroll-print-week')));
      await tester.pump();

      // The VM has no browser print window, so the honest outcome is the notice.
      expect(find.textContaining('bloqueó la ventana de impresión'), findsOneWidget);
      expect(tester.takeException(), isNull);
    });

    testWidgets('tapping an employee opens their week: daily breakdown (frozen), money summary and adjustments', (
      tester,
    ) async {
      final payrollGateway = _RecordingPayrollGateway(periods: [_draftPeriod], lines: [_payrollLine()], days: _payrollDays);
      await openWeek(tester, payrollGateway);
      await openEmployee(tester);

      expect(payrollGateway.employeeDetailCalls, ['period-1/employee-1']);
      expect(find.byKey(const Key('pos-payroll-employee-dialog')), findsOneWidget);
      expect(find.text('Ana Torres'), findsWidgets);
      expect(find.textContaining('Código EMP-1'), findsOneWidget);
      expect(find.textContaining('Cajera'), findsOneWidget);
      // All 7 days are present with the backend's own classification.
      for (final date in ['2026-09-01', '2026-09-02', '2026-09-03', '2026-09-04', '2026-09-05', '2026-09-06', '2026-09-07']) {
        expect(find.byKey(Key('pos-payroll-day-row-$date')), findsOneWidget, reason: date);
      }
      expect(find.text('09:12'), findsOneWidget); // first entry
      expect(find.text('17:30'), findsOneWidget); // last exit
      expect(find.text('09:00 – 17:00'), findsWidgets);
      expect(find.text('Completo'), findsOneWidget);
      expect(find.text('Descanso'), findsWidgets);
      expect(find.text('Sin registro'), findsOneWidget);
      expect(find.text('Trabajó sin horario'), findsOneWidget);
      expect(find.text('Falta salida'), findsOneWidget);
      expect(find.text('Sin horario'), findsWidgets);
      // A day with no punch shows an honest dash, never an invented time.
      expect(find.text('—'), findsWidgets);
      expect(find.byKey(const Key('pos-payroll-summary-total')), findsOneWidget);
      expect(find.byKey(const Key('pos-payroll-no-adjustments')), findsOneWidget);
    });

    testWidgets('a line computed before Payroll V2 says its name/title are the current ones and that no daily detail exists', (
      tester,
    ) async {
      final payrollGateway = _RecordingPayrollGateway(
        periods: [_draftPeriod],
        lines: [_payrollLine(snapshot: false)],
      );
      await openWeek(tester, payrollGateway);
      await openEmployee(tester);

      expect(find.byKey(const Key('pos-payroll-no-snapshot')), findsOneWidget);
      expect(find.byKey(const Key('pos-payroll-no-days')), findsOneWidget);
    });

    testWidgets('adding an adjustment validates locally, then sends kind/amount/reason with ONE idempotency key', (
      tester,
    ) async {
      final payrollGateway = _RecordingPayrollGateway(periods: [_draftPeriod], lines: [_payrollLine()], days: _payrollDays);
      await openWeek(tester, payrollGateway);
      await openEmployee(tester);

      await tester.ensureVisible(find.byKey(const Key('pos-payroll-add-adjustment')));
      await tester.tap(find.byKey(const Key('pos-payroll-add-adjustment')));
      await tester.pumpAndSettle();

      // Zero amount and a missing reason never reach the backend.
      await tester.enterText(find.byKey(const Key('pos-payroll-adjustment-amount')), '0');
      await tester.enterText(find.byKey(const Key('pos-payroll-adjustment-reason')), 'Bono');
      await tester.tap(find.byKey(const Key('pos-payroll-adjustment-save')));
      await tester.pumpAndSettle();
      expect(find.text('Captura un monto mayor a cero (hasta 4 decimales).'), findsOneWidget);
      expect(payrollGateway.adjustmentCalls, isEmpty);

      await tester.enterText(find.byKey(const Key('pos-payroll-adjustment-amount')), '200.50');
      await tester.enterText(find.byKey(const Key('pos-payroll-adjustment-reason')), 'ab');
      await tester.tap(find.byKey(const Key('pos-payroll-adjustment-save')));
      await tester.pumpAndSettle();
      expect(find.text('Escribe el motivo del ajuste (mínimo 3 caracteres).'), findsOneWidget);
      expect(payrollGateway.adjustmentCalls, isEmpty);

      await tester.tap(find.text('Deducción (-)'));
      await tester.pumpAndSettle();
      await tester.enterText(find.byKey(const Key('pos-payroll-adjustment-reason')), 'Faltante de caja');
      await tester.tap(find.byKey(const Key('pos-payroll-adjustment-save')));
      await tester.pumpAndSettle();

      expect(payrollGateway.adjustmentCalls, hasLength(1));
      final call = payrollGateway.adjustmentCalls.single;
      expect(call.kind, 'deduction');
      expect(call.amount, '200.50');
      expect(call.reason, 'Faltante de caja');
      expect(call.employeeId, 'employee-1');
      expect(call.key, isNotEmpty);
      // The detail reloads and now lists the recorded adjustment (kind + reason).
      expect(find.text('Faltante de caja'), findsOneWidget);
      expect(find.byKey(const Key('pos-payroll-no-adjustments')), findsNothing);
    });

    testWidgets('a failed submission keeps the SAME idempotency key on retry — a lost response can never double-record', (
      tester,
    ) async {
      final payrollGateway = _RecordingPayrollGateway(
        periods: [_draftPeriod],
        lines: [_payrollLine()],
        days: _payrollDays,
        adjustmentFailures: 1,
      );
      await openWeek(tester, payrollGateway);
      await openEmployee(tester);
      await tester.ensureVisible(find.byKey(const Key('pos-payroll-add-adjustment')));
      await tester.tap(find.byKey(const Key('pos-payroll-add-adjustment')));
      await tester.pumpAndSettle();

      await tester.enterText(find.byKey(const Key('pos-payroll-adjustment-amount')), '50');
      await tester.enterText(find.byKey(const Key('pos-payroll-adjustment-reason')), 'Bono de puntualidad');
      await tester.tap(find.byKey(const Key('pos-payroll-adjustment-save')));
      await tester.pumpAndSettle();
      expect(find.byKey(const Key('pos-payroll-adjustment-error')), findsOneWidget); // dialog stays open

      await tester.tap(find.byKey(const Key('pos-payroll-adjustment-save')));
      await tester.pumpAndSettle();

      expect(payrollGateway.adjustmentCalls, hasLength(2));
      expect(payrollGateway.adjustmentCalls[0].key, payrollGateway.adjustmentCalls[1].key);
    });

    testWidgets('voiding an adjustment asks for a reason, keeps the row (marked ANULADO) and never deletes it', (
      tester,
    ) async {
      final payrollGateway = _RecordingPayrollGateway(
        periods: [_draftPeriod],
        lines: [_payrollLine(adjustmentAmount: '200.0000')],
        days: _payrollDays,
        adjustments: [_bonusAdjustment()],
      );
      await openWeek(tester, payrollGateway);
      await openEmployee(tester);

      expect(find.text('Bono de puntualidad'), findsOneWidget);
      await tester.ensureVisible(find.byKey(const Key('pos-payroll-adjustment-void-adj-1')));
      await tester.tap(find.byKey(const Key('pos-payroll-adjustment-void-adj-1')));
      await tester.pumpAndSettle();
      expect(payrollGateway.voidCalls, isEmpty);

      await tester.tap(find.byKey(const Key('pos-payroll-void-confirm')));
      await tester.pumpAndSettle();
      expect(payrollGateway.voidCalls, isEmpty); // no reason -> nothing sent

      await tester.enterText(find.byKey(const Key('pos-payroll-void-reason')), 'Capturado por error');
      await tester.tap(find.byKey(const Key('pos-payroll-void-confirm')));
      await tester.pumpAndSettle();

      expect(payrollGateway.voidCalls, hasLength(1));
      expect(payrollGateway.voidCalls.single.reason, 'Capturado por error');
      expect(find.byKey(const Key('pos-payroll-adjustment-voided-adj-1')), findsOneWidget);
      expect(find.text('Bono de puntualidad'), findsOneWidget); // still listed
    });

    testWidgets('a CLOSED week accepts no adjustments: the add button and every void are disabled', (tester) async {
      final payrollGateway = _RecordingPayrollGateway(
        periods: [_closedPeriod],
        lines: [_payrollLine(adjustmentAmount: '200.0000')],
        days: _payrollDays,
        adjustments: [_bonusAdjustment()],
      );
      await openWeek(tester, payrollGateway, periodKey: 'period-2');
      expect(find.byKey(const Key('pos-payroll-calculate')), findsNothing);
      await openEmployee(tester);

      expect(tester.widget<FilledButton>(find.byKey(const Key('pos-payroll-add-adjustment'))).onPressed, isNull);
      expect(tester.widget<TextButton>(find.byKey(const Key('pos-payroll-adjustment-void-adj-1'))).onPressed, isNull);
    });

    testWidgets('without payroll.manage the actor can read the week but cannot add or void adjustments', (tester) async {
      final payrollGateway = _RecordingPayrollGateway(
        periods: [_draftPeriod],
        lines: [_payrollLine()],
        days: _payrollDays,
        adjustments: [_bonusAdjustment()],
      );
      await openWeek(tester, payrollGateway, permissions: const ['payroll.read']);
      await openEmployee(tester);

      expect(tester.widget<FilledButton>(find.byKey(const Key('pos-payroll-add-adjustment'))).onPressed, isNull);
      expect(tester.widget<TextButton>(find.byKey(const Key('pos-payroll-adjustment-void-adj-1'))).onPressed, isNull);
      expect(find.byKey(const Key('pos-payroll-print-receipt')), findsOneWidget); // reading/printing stays available
    });

    testWidgets('"Recibo / PDF" is a real action and says so if the browser blocks the window', (tester) async {
      final payrollGateway = _RecordingPayrollGateway(periods: [_draftPeriod], lines: [_payrollLine()], days: _payrollDays);
      await openWeek(tester, payrollGateway);
      await openEmployee(tester);

      await tester.ensureVisible(find.byKey(const Key('pos-payroll-print-receipt')));
      await tester.tap(find.byKey(const Key('pos-payroll-print-receipt')));
      await tester.pump();

      expect(find.textContaining('bloqueó la ventana de impresión'), findsOneWidget);
    });

    testWidgets('a new payroll period defaults to the CURRENT Monday–Sunday week', (tester) async {
      await _pump(tester, payrollGateway: _RecordingPayrollGateway(periods: [_draftPeriod]));
      await _navigateToTab(tester, 'Nómina');
      await tester.pumpAndSettle();

      await tester.tap(find.byKey(const Key('pos-payroll-new')));
      await tester.pumpAndSettle();

      final now = DateTime.now();
      final monday = DateTime(now.year, now.month, now.day).subtract(Duration(days: now.weekday - DateTime.monday));
      String iso(DateTime value) =>
          '${value.year.toString().padLeft(4, '0')}-${value.month.toString().padLeft(2, '0')}-${value.day.toString().padLeft(2, '0')}';
      expect(tester.widget<TextField>(find.byKey(const Key('pos-payroll-form-start'))).controller!.text, iso(monday));
      expect(
        tester.widget<TextField>(find.byKey(const Key('pos-payroll-form-end'))).controller!.text,
        iso(monday.add(const Duration(days: 6))),
      );
    });

    for (final size in [
      const Size(1440, 900),
      const Size(1365, 768),
      const Size(1024, 768),
      const Size(390, 844),
    ]) {
      testWidgets('the weekly workspace and the employee detail render with no overflow at ${size.width.toInt()}x${size.height.toInt()}', (
        tester,
      ) async {
        final payrollGateway = _RecordingPayrollGateway(
          periods: [_draftPeriod],
          lines: [_payrollLine()],
          totals: const [_payrollTotals],
          days: _payrollDays,
          adjustments: [_bonusAdjustment()],
        );
        await openWeek(tester, payrollGateway, size: size);
        expect(tester.takeException(), isNull);
        expect(find.byKey(const Key('pos-payroll-table')), findsOneWidget);
        expect(find.byKey(const Key('pos-payroll-calculate')), findsOneWidget);

        await tester.ensureVisible(find.byKey(const Key('pos-payroll-line-row-line-1')));
        await openEmployee(tester);
        expect(tester.takeException(), isNull);
        expect(find.byKey(const Key('pos-payroll-days-table')), findsOneWidget);
        await tester.ensureVisible(find.byKey(const Key('pos-payroll-add-adjustment')));
        await tester.tap(find.byKey(const Key('pos-payroll-add-adjustment')));
        await tester.pumpAndSettle();
        expect(tester.takeException(), isNull);
        expect(find.byKey(const Key('pos-payroll-adjustment-save')), findsOneWidget);
      });
    }
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

/// A payroll line fixture. `snapshot: false` simulates a line computed before
/// Payroll V2 (no frozen employee identity).
PosPayrollPeriodLine _payrollLine({String adjustmentAmount = '0.0000', bool snapshot = true}) => PosPayrollPeriodLine(
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
  adjustmentAmount: adjustmentAmount,
  employeeName: snapshot ? 'Ana Torres' : null,
  employeeCode: snapshot ? 'EMP-1' : null,
  jobTitle: snapshot ? 'Cajera' : null,
  snapshotAvailable: snapshot,
);

const _payrollTotals = PosPayrollCurrencyTotals(
  currencyCode: 'MXN',
  employeeCount: 1,
  baseSalary: '1500.0000',
  deduction: '9.3750',
  bonus: '0.0000',
  adjustment: '0.0000',
  total: '1490.6250',
);

/// One payroll week as the backend would freeze it: a worked day, a day off,
/// a scheduled day with no punches, work without a schedule, an open punch and
/// two unscheduled days.
const _payrollDays = [
  PosPayrollDay(
    workDate: '2026-09-01',
    scheduledStart: '09:00:00',
    scheduledEnd: '17:00:00',
    isDayOff: false,
    scheduledMinutes: 480,
    workedMinutes: 498,
    lateMinutes: 2,
    overtimeMinutes: 30,
    firstInMinute: 552,
    lastOutMinute: 1050,
    attendanceState: 'complete',
  ),
  PosPayrollDay(
    workDate: '2026-09-02',
    scheduledStart: null,
    scheduledEnd: null,
    isDayOff: true,
    scheduledMinutes: 0,
    workedMinutes: 0,
    lateMinutes: 0,
    overtimeMinutes: 0,
    firstInMinute: null,
    lastOutMinute: null,
    attendanceState: 'day_off',
  ),
  PosPayrollDay(
    workDate: '2026-09-03',
    scheduledStart: '09:00:00',
    scheduledEnd: '17:00:00',
    isDayOff: false,
    scheduledMinutes: 480,
    workedMinutes: 0,
    lateMinutes: 0,
    overtimeMinutes: 0,
    firstInMinute: null,
    lastOutMinute: null,
    attendanceState: 'no_punches',
  ),
  PosPayrollDay(
    workDate: '2026-09-04',
    scheduledStart: null,
    scheduledEnd: null,
    isDayOff: false,
    scheduledMinutes: 0,
    workedMinutes: 240,
    lateMinutes: 0,
    overtimeMinutes: 0,
    firstInMinute: 600,
    lastOutMinute: 840,
    attendanceState: 'unscheduled_work',
  ),
  PosPayrollDay(
    workDate: '2026-09-05',
    scheduledStart: '09:00:00',
    scheduledEnd: '17:00:00',
    isDayOff: false,
    scheduledMinutes: 480,
    workedMinutes: 0,
    lateMinutes: 0,
    overtimeMinutes: 0,
    firstInMinute: 540,
    lastOutMinute: null,
    attendanceState: 'missing_clock_out',
  ),
  PosPayrollDay(
    workDate: '2026-09-06',
    scheduledStart: null,
    scheduledEnd: null,
    isDayOff: false,
    scheduledMinutes: 0,
    workedMinutes: 0,
    lateMinutes: 0,
    overtimeMinutes: 0,
    firstInMinute: null,
    lastOutMinute: null,
    attendanceState: 'no_schedule',
  ),
  PosPayrollDay(
    workDate: '2026-09-07',
    scheduledStart: null,
    scheduledEnd: null,
    isDayOff: false,
    scheduledMinutes: 0,
    workedMinutes: 0,
    lateMinutes: 0,
    overtimeMinutes: 0,
    firstInMinute: null,
    lastOutMinute: null,
    attendanceState: 'no_schedule',
  ),
];

PosPayrollAdjustment _bonusAdjustment() => PosPayrollAdjustment(
  id: 'adj-1',
  payrollPeriodId: 'period-1',
  employeeId: 'employee-1',
  kind: 'bonus',
  amount: '200.0000',
  currencyCode: 'MXN',
  reason: 'Bono de puntualidad',
  createdBy: 'user-id',
  createdAt: DateTime.utc(2026, 9, 6),
);

class _RecordedAdjustment {
  const _RecordedAdjustment({
    required this.employeeId,
    required this.kind,
    required this.amount,
    required this.reason,
    required this.key,
  });
  final String employeeId;
  final String kind;
  final String amount;
  final String reason;
  final String key;
}

class _RecordedVoid {
  const _RecordedVoid({required this.adjustmentId, required this.reason});
  final String adjustmentId;
  final String reason;
}

class _RecordingPayrollGateway implements PosPayrollGateway {
  _RecordingPayrollGateway({
    List<PosPayrollPeriod> periods = const [],
    this.calculateResult,
    this.calculateFailure,
    this.lines = const [],
    this.totals = const [],
    this.days = const [],
    List<PosPayrollAdjustment> adjustments = const [],
    this.adjustmentFailures = 0,
  }) : _periods = [...periods],
       _adjustments = [...adjustments];
  final List<PosPayrollPeriod> _periods;
  final PosPayrollPeriodDetail? calculateResult;
  final String? calculateFailure;
  final List<PosPayrollPeriodLine> lines;
  final List<PosPayrollCurrencyTotals> totals;
  final List<PosPayrollDay> days;
  final List<PosPayrollAdjustment> _adjustments;
  int adjustmentFailures;

  final List<String> calculateCalls = [];
  final List<String> closeCalls = [];
  final List<String> reopenCalls = [];
  final List<String> reopenReasons = [];
  final List<String> employeeDetailCalls = [];
  final List<_RecordedAdjustment> adjustmentCalls = [];
  final List<_RecordedVoid> voidCalls = [];

  @override
  Future<PosPayrollPeriod> createPeriod({
    required String branchId,
    required String periodStart,
    required String periodEnd,
  }) async => throw StateError('not used');

  @override
  Future<PosPayrollPeriodDetail> period(String id) async {
    final period = _periods.firstWhere((value) => value.id == id);
    return PosPayrollPeriodDetail(period: period, lines: lines, totals: totals);
  }

  @override
  Future<List<PosPayrollPeriod>> listPeriods({String? branchId, String? status, int limit = 50}) async =>
      _periods.where((period) => status == null || period.status == status).toList(growable: false);

  @override
  Future<PosPayrollPeriodDetail> calculate(String id) async {
    calculateCalls.add(id);
    final failure = calculateFailure;
    if (failure != null) throw ApiException(AppFailure(AppErrorKind.unknown, failure));
    return calculateResult ??
        PosPayrollPeriodDetail(period: _periods.firstWhere((value) => value.id == id), lines: lines, totals: totals);
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
  Future<PosPayrollPeriod> reopen(String id, {required String reason}) async {
    reopenCalls.add(id);
    reopenReasons.add(reason);
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

  @override
  Future<PosPayrollEmployeeDetail> employeeDetail({required String periodId, required String employeeId}) async {
    employeeDetailCalls.add('$periodId/$employeeId');
    final period = _periods.firstWhere((value) => value.id == periodId);
    return PosPayrollEmployeeDetail(
      period: period,
      line: lines.firstWhere((line) => line.employeeId == employeeId),
      days: days,
      adjustments: List.of(_adjustments),
    );
  }

  @override
  Future<PosPayrollAdjustmentChange> createAdjustment({
    required String periodId,
    required String employeeId,
    required String kind,
    required String amount,
    required String reason,
    required String idempotencyKey,
  }) async {
    adjustmentCalls.add(
      _RecordedAdjustment(employeeId: employeeId, kind: kind, amount: amount, reason: reason, key: idempotencyKey),
    );
    if (adjustmentFailures > 0) {
      adjustmentFailures -= 1;
      throw const ApiException(AppFailure(AppErrorKind.unknown, 'Fallo simulado al registrar el ajuste.'));
    }
    final adjustment = PosPayrollAdjustment(
      id: 'adj-new-${_adjustments.length + 1}',
      payrollPeriodId: periodId,
      employeeId: employeeId,
      kind: kind,
      amount: amount,
      currencyCode: 'MXN',
      reason: reason,
      createdBy: 'user-id',
      createdAt: DateTime.utc(2026, 9, 7),
    );
    _adjustments.add(adjustment);
    return PosPayrollAdjustmentChange(adjustment: adjustment, line: lines.first);
  }

  @override
  Future<PosPayrollAdjustmentChange> voidAdjustment({
    required String periodId,
    required String adjustmentId,
    required String reason,
    required String idempotencyKey,
  }) async {
    voidCalls.add(_RecordedVoid(adjustmentId: adjustmentId, reason: reason));
    final index = _adjustments.indexWhere((value) => value.id == adjustmentId);
    final existing = _adjustments[index];
    final voided = PosPayrollAdjustment(
      id: existing.id,
      payrollPeriodId: existing.payrollPeriodId,
      employeeId: existing.employeeId,
      kind: existing.kind,
      amount: existing.amount,
      currencyCode: existing.currencyCode,
      reason: existing.reason,
      createdBy: existing.createdBy,
      createdAt: existing.createdAt,
      voidedAt: DateTime.utc(2026, 9, 7),
      voidedBy: 'user-id',
      voidReason: reason,
    );
    _adjustments[index] = voided;
    return PosPayrollAdjustmentChange(adjustment: voided, line: lines.first);
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
  Size size = const Size(1440, 1000),
}) async {
  tester.view.physicalSize = size;
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
