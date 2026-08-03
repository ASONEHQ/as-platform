import 'package:as_one/features/authentication/auth_models.dart';
import 'package:as_one/features/pos/pos_models.dart';
import 'package:as_one/features/pos/pos_navigation.dart';
import 'package:as_one/features/pos/pos_read_controller.dart';
import 'package:as_one/features/pos/pos_read_gateway.dart';
import 'package:as_one/features/pos/pos_shell.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  test('keeps all 25 canonical modules in their inspected order', () {
    expect(PosModule.values, hasLength(25));
    expect(PosModule.values.first.label, 'Dashboard');
    expect(PosModule.values.last.label, 'Configuración');
    expect(PosModule.values.map((item) => item.label).toSet(), hasLength(25));
  });

  testWidgets('renders the canonical desktop shell without fake KPIs', (
    tester,
  ) async {
    await _pump(tester, const Size(1440, 900));
    expect(find.byKey(const Key('pos-sidebar')), findsOneWidget);
    expect(find.byKey(const Key('pos-topbar')), findsOneWidget);
    expect(find.text('Empresa AS'), findsWidgets);
    expect(find.text('Sucursales autorizadas'), findsOneWidget);
    expect(find.textContaining('Ingresos'), findsNothing);
    expect(find.textContaining(r'$'), findsNothing);
    expect(tester.takeException(), isNull);
  });

  testWidgets('shows unsupported modules as Coming soon', (tester) async {
    await _pump(tester, const Size(1440, 900));
    await tester.tap(find.byKey(const Key('nav-pos')));
    await tester.pumpAndSettle();
    expect(find.text('Coming soon'), findsOneWidget);
    expect(find.text('Punto de Venta'), findsWidgets);
  });

  testWidgets('loads products through the read gateway and filters locally', (
    tester,
  ) async {
    await _pump(tester, const Size(1440, 900));
    await tester.tap(find.byKey(const Key('nav-products')));
    await tester.pumpAndSettle();
    expect(find.text('Producto real'), findsOneWidget);
    await tester.enterText(
      find.byKey(const Key('pos-product-search')),
      'sin coincidencia',
    );
    await tester.pump();
    expect(find.text('Sin resultados para la búsqueda.'), findsOneWidget);
  });

  testWidgets('uses mobile navigation below the reference breakpoint', (
    tester,
  ) async {
    await _pump(tester, const Size(390, 844));
    expect(find.byKey(const Key('pos-sidebar')), findsNothing);
    expect(find.byTooltip('Abrir navegación'), findsOneWidget);
    await tester.tap(find.byTooltip('Abrir navegación'));
    await tester.pumpAndSettle();
    expect(find.byKey(const Key('pos-sidebar')), findsOneWidget);
    expect(tester.takeException(), isNull);
  });

  testWidgets('toggles the preserved dark theme', (tester) async {
    await _pump(tester, const Size(1024, 768));
    expect(find.byTooltip('Usar tema oscuro'), findsOneWidget);
    await tester.tap(find.byTooltip('Usar tema oscuro'));
    await tester.pumpAndSettle();
    expect(find.byTooltip('Usar tema claro'), findsOneWidget);
  });

  for (final size in const [
    Size(768, 1024),
    Size(1024, 768),
    Size(1920, 1080),
  ]) {
    testWidgets('keeps the shell stable at ${size.width.toInt()} px', (
      tester,
    ) async {
      await _pump(tester, size);
      expect(find.byKey(const Key('pos-topbar')), findsOneWidget);
      expect(tester.takeException(), isNull);
    });
  }

  testWidgets('renders the visual-only read-only dialog', (tester) async {
    await _pump(tester, const Size(1440, 900));
    await tester.tap(find.byKey(const Key('pos-read-only-dialog')));
    await tester.pumpAndSettle();
    expect(find.text('Modo de solo lectura'), findsOneWidget);
    expect(find.text('Entendido'), findsOneWidget);
  });
}

Future<void> _pump(WidgetTester tester, Size size) async {
  tester.view.physicalSize = size;
  tester.view.devicePixelRatio = 1;
  addTearDown(tester.view.reset);
  await tester.pumpWidget(
    MaterialApp(
      home: PosShell(
        context: _context,
        controller: PosReadController(const _FakeReadGateway()),
        onLogout: () {},
      ),
    ),
  );
  await tester.pumpAndSettle();
}

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
  user: const UserSummary(
    id: 'user-id',
    displayName: 'Usuario AS',
    email: 'user@example.test',
  ),
  companies: const [
    CompanySummary(id: 'company-id', name: 'Empresa AS', current: true),
  ],
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
  permissions: const ['catalog.read', 'inventory.read', 'user.read'],
);

class _FakeReadGateway implements PosReadGateway {
  const _FakeReadGateway();

  @override
  Future<List<PosProduct>> products() async => const [
    PosProduct(
      id: 'product-id',
      code: 'P-001',
      name: 'Producto real',
      type: 'simple',
      status: 'active',
      tracksInventory: true,
    ),
  ];

  @override
  Future<List<PosInventoryBalance>> inventoryBalances({
    String? branchId,
  }) async => const [];

  @override
  Future<List<PosUser>> users() async => const [];
}
