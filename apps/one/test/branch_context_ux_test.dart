/// TASK 17.7.3 — branch-context UX: operational screens (Horarios, Checador,
/// current cash session) opened in the aggregate "Todas las sucursales"
/// context ask for a branch instead of spinning forever or blaming the
/// account, and picking one never widens access (the list offered is exactly
/// the session's own branches).
library;

import 'package:as_one/app/app.dart' show PlatformScope;
import 'package:as_one/features/authentication/auth_models.dart';
import 'package:as_one/features/pos/branch_required_panel.dart';
import 'package:as_one/features/pos/pos_people_gateway.dart';
import 'package:as_one/features/pos/pos_people_screen.dart';
import 'package:as_one/features/pos/pos_read_gateway.dart';
import 'package:as_one/features/pos/pos_tokens.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

const _branchA = BranchSummary(id: 'branch-a', code: 'A', name: 'Sucursal A', timezone: 'America/Mexico_City');
const _branchB = BranchSummary(id: 'branch-b', code: 'B', name: 'Sucursal B', timezone: 'America/Mexico_City');

AuthenticatedContext _ctx({
  String? selected,
  List<BranchSummary> branches = const [_branchA, _branchB],
  bool companyWide = true,
}) => AuthenticatedContext(
  session: SessionContext(
    id: 's',
    userId: 'u',
    companyId: 'c',
    branchId: selected,
    permittedBranchIds: [for (final b in branches) b.id],
    companyWideAccess: companyWide,
    expiresAt: DateTime.utc(2099),
  ),
  user: const UserSummary(id: 'u', displayName: 'Dueña', email: 'owner@example.test'),
  companies: const [CompanySummary(id: 'c', name: 'Empresa', current: true)],
  branches: [
    for (final b in branches)
      BranchSummary(id: b.id, code: b.code, name: b.name, timezone: b.timezone, current: b.id == selected),
  ],
  companyWideAccess: companyWide,
  permissions: const [
    'employee.read',
    'schedule.read',
    'schedule.manage',
    'attendance.read',
    'attendance.manage',
    'cash_session.read',
  ],
);

class _PeopleHarness extends StatefulWidget {
  const _PeopleHarness({required this.initial, this.failSwitch = false, this.noCallback = false, super.key});
  final AuthenticatedContext initial;
  final bool failSwitch;
  final bool noCallback;

  @override
  State<_PeopleHarness> createState() => _PeopleHarnessState();
}

class _PeopleHarnessState extends State<_PeopleHarness> {
  late AuthenticatedContext current = widget.initial;
  final requested = <String?>[];

  Future<void> _select(String? branchId) async {
    requested.add(branchId);
    if (widget.failSwitch) throw StateError('network');
    setState(() => current = _ctx(selected: branchId, branches: current.branches, companyWide: current.companyWideAccess));
  }

  @override
  Widget build(BuildContext context) => SingleChildScrollView(
    child: PosPeopleScreen(
      key: ValueKey('people-${current.session.branchId}'),
      context: current,
      employeesGateway: const EmptyPosEmployeesGateway(),
      schedulesGateway: const EmptyPosSchedulesGateway(),
      timeClockGateway: const EmptyPosTimeClockGateway(),
      payrollGateway: const EmptyPosPayrollGateway(),
      onBranchSelected: widget.noCallback ? null : _select,
    ),
  );
}

Future<GlobalKey<_PeopleHarnessState>> _pumpPeople(
  WidgetTester tester,
  AuthenticatedContext initial, {
  bool failSwitch = false,
  bool noCallback = false,
  Size size = const Size(1440, 900),
}) async {
  tester.view.physicalSize = size;
  tester.view.devicePixelRatio = 1;
  addTearDown(tester.view.reset);
  final key = GlobalKey<_PeopleHarnessState>();
  await tester.pumpWidget(
    PlatformScope(
      posReadGateway: const EmptyPosReadGateway(),
      child: MaterialApp(
        theme: PosTheme.light(),
        home: Scaffold(body: _PeopleHarness(key: key, initial: initial, failSwitch: failSwitch, noCallback: noCallback)),
      ),
    ),
  );
  await tester.pumpAndSettle();
  return key;
}

Future<void> _tab(WidgetTester tester, String label) async {
  await tester.tap(find.descendant(of: find.byKey(const Key('pos-people-tabs')), matching: find.text(label)));
  await tester.pumpAndSettle();
}

void main() {
  group('Horarios / Checador without a concrete branch', () {
    testWidgets('Horarios shows the branch-required state, never an endless spinner', (tester) async {
      await _pumpPeople(tester, _ctx());
      await _tab(tester, 'Horarios');
      expect(find.byKey(const Key('branch-required')), findsOneWidget);
      expect(find.text('Selecciona una sucursal para ver los horarios.'), findsOneWidget);
      expect(find.byType(CircularProgressIndicator), findsNothing);
    });

    testWidgets('Checador shows the branch-required state too', (tester) async {
      await _pumpPeople(tester, _ctx());
      await _tab(tester, 'Checador');
      expect(find.text('Selecciona una sucursal para usar el checador.'), findsOneWidget);
      expect(find.byType(CircularProgressIndicator), findsNothing);
    });

    testWidgets('choosing a branch from the panel goes through the single shell path and loads Horarios', (tester) async {
      final key = await _pumpPeople(tester, _ctx());
      await _tab(tester, 'Horarios');
      await tester.tap(find.byKey(const Key('branch-required-branch-b')));
      await tester.pumpAndSettle();
      expect(key.currentState!.requested, ['branch-b']);
      expect(key.currentState!.current.session.branchId, 'branch-b');
      expect(find.byKey(const Key('branch-required')), findsNothing);
    });

    testWidgets("only the session's own branches are ever offered", (tester) async {
      await _pumpPeople(tester, _ctx(branches: const [_branchA], companyWide: false));
      await _tab(tester, 'Horarios');
      expect(find.byKey(const Key('branch-required-branch-a')), findsOneWidget);
      expect(find.byKey(const Key('branch-required-branch-b')), findsNothing);
    });

    testWidgets('a user with NO accessible branch gets an access message, not a picker', (tester) async {
      await _pumpPeople(tester, _ctx(branches: const [], companyWide: false));
      await _tab(tester, 'Horarios');
      expect(find.byKey(const Key('branch-required-none')), findsOneWidget);
      expect(find.text('Tu usuario no tiene una sucursal autorizada.'), findsOneWidget);
      expect(find.byType(OutlinedButton), findsNothing);
    });

    testWidgets('a failed switch keeps the user in place with an honest, retryable message', (tester) async {
      await _pumpPeople(tester, _ctx(), failSwitch: true);
      await _tab(tester, 'Horarios');
      await tester.tap(find.byKey(const Key('branch-required-branch-a')));
      await tester.pumpAndSettle();
      expect(find.byKey(const Key('branch-required-error')), findsOneWidget);
      expect(find.byKey(const Key('branch-required')), findsOneWidget);
      expect(tester.widget<OutlinedButton>(find.byKey(const Key('branch-required-branch-a'))).onPressed, isNotNull);
    });

    testWidgets('without a switch callback the panel points at the top-bar selector', (tester) async {
      await _pumpPeople(tester, _ctx(), noCallback: true);
      await _tab(tester, 'Horarios');
      expect(find.byKey(const Key('branch-required-hint')), findsOneWidget);
      expect(find.byType(OutlinedButton), findsNothing);
    });

    testWidgets('Horarios with a selected branch renders normally (no panel)', (tester) async {
      await _pumpPeople(tester, _ctx(selected: 'branch-a'));
      await _tab(tester, 'Horarios');
      expect(find.byKey(const Key('branch-required')), findsNothing);
    });

    testWidgets('Empleados stays usable company-wide (no panel on the aggregate tab)', (tester) async {
      await _pumpPeople(tester, _ctx());
      expect(find.byKey(const Key('branch-required')), findsNothing);
    });

    for (final size in const [Size(1440, 900), Size(1365, 768), Size(1024, 768), Size(768, 1024), Size(390, 844)]) {
      testWidgets('the branch-required state lays out with no overflow at ${size.width.toInt()}x${size.height.toInt()}', (tester) async {
        await _pumpPeople(tester, _ctx(), size: size);
        await _tab(tester, 'Horarios');
        expect(find.byKey(const Key('branch-required-branch-a')), findsOneWidget);
        expect(tester.takeException(), isNull);
      });
    }
  });

  group('BranchRequiredPanel', () {
    testWidgets("shows the caller's message and offers each authorized branch", (tester) async {
      String? picked;
      await tester.pumpWidget(
        MaterialApp(
          theme: PosTheme.light(),
          home: Scaffold(
            body: BranchRequiredPanel(
              context: _ctx(),
              message: 'Selecciona una sucursal para consultar la caja actual.',
              onBranchSelected: (id) async => picked = id,
            ),
          ),
        ),
      );
      expect(find.text('Selecciona una sucursal para consultar la caja actual.'), findsOneWidget);
      await tester.tap(find.byKey(const Key('branch-required-branch-a')));
      await tester.pump();
      expect(picked, 'branch-a');
    });
  });
}
