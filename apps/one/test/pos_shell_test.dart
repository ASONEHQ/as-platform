import 'dart:async';

import 'package:as_one/features/authentication/auth_models.dart';
import 'package:as_one/features/pos/pos_models.dart';
import 'package:as_one/features/pos/pos_navigation.dart';
import 'package:as_one/features/pos/pos_read_controller.dart';
import 'package:as_one/features/pos/pos_read_gateway.dart';
import 'package:as_one/features/pos/pos_shell.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
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
    await tester.tap(find.byKey(const Key('nav-cafeteria')));
    await tester.pumpAndSettle();
    expect(find.text('Coming soon'), findsOneWidget);
    expect(find.text('Cafetería'), findsWidgets);
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

  group('Punto de Venta (TASK 12.2)', () {
    testWidgets('renders the POS shell with category strip, search, grid '
        'and an empty persistent ticket panel', (tester) async {
      await _pump(tester, const Size(1440, 900));
      await tester.tap(find.byKey(const Key('nav-pos')));
      await tester.pumpAndSettle();
      expect(find.byKey(const Key('pos-category-strip')), findsOneWidget);
      expect(find.byKey(const Key('pos-sale-search')), findsOneWidget);
      expect(find.byKey(const Key('pos-product-product-1')), findsOneWidget);
      expect(find.byKey(const Key('pos-ticket-panel')), findsOneWidget);
      expect(find.text('El ticket está vacío'), findsOneWidget);
      expect(find.text('Coming soon'), findsNothing);
      expect(tester.takeException(), isNull);
    });

    testWidgets('category selection changes read-only filtering', (
      tester,
    ) async {
      await _pump(tester, const Size(1440, 900));
      await tester.tap(find.byKey(const Key('nav-pos')));
      await tester.pumpAndSettle();
      expect(find.byKey(const Key('pos-product-product-1')), findsOneWidget);
      expect(find.byKey(const Key('pos-product-product-2')), findsOneWidget);

      await tester.tap(find.byKey(const Key('pos-category-cat-2')));
      await tester.pumpAndSettle();
      expect(find.byKey(const Key('pos-product-product-1')), findsNothing);
      expect(find.byKey(const Key('pos-product-product-2')), findsOneWidget);

      await tester.tap(find.byKey(const Key('pos-category-all')));
      await tester.pumpAndSettle();
      expect(find.byKey(const Key('pos-product-product-1')), findsOneWidget);
      expect(find.byKey(const Key('pos-product-product-2')), findsOneWidget);
    });

    testWidgets('product search filters the read-only grid', (tester) async {
      await _pump(tester, const Size(1440, 900));
      await tester.tap(find.byKey(const Key('nav-pos')));
      await tester.pumpAndSettle();
      await tester.enterText(
        find.byKey(const Key('pos-sale-search')),
        'refresco',
      );
      await tester.pump();
      expect(find.byKey(const Key('pos-product-product-3')), findsOneWidget);
      expect(find.byKey(const Key('pos-product-product-1')), findsNothing);
    });

    testWidgets('shows an out-of-stock badge only for zero-quantity '
        'balances matched to a product default variant', (tester) async {
      await _pump(tester, const Size(1440, 900));
      await tester.tap(find.byKey(const Key('nav-pos')));
      await tester.pumpAndSettle();
      final outOfStockCard = tester.widget<Opacity>(
        find.byKey(const Key('pos-product-product-3')),
      );
      expect(outOfStockCard.opacity, lessThan(1));
      expect(find.text('Agotado'), findsOneWidget);
      final inStockCard = tester.widget<Opacity>(
        find.byKey(const Key('pos-product-product-1')),
      );
      expect(inStockCard.opacity, 1);
    });

    testWidgets('product grid shows a loading state while products load', (
      tester,
    ) async {
      tester.view.physicalSize = const Size(1440, 900);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.reset);
      await tester.pumpWidget(
        MaterialApp(
          home: PosShell(
            context: _context,
            controller: PosReadController(const _SlowPosReadGateway()),
            onLogout: () {},
          ),
        ),
      );
      await tester.pump();
      await tester.tap(find.byKey(const Key('nav-pos')));
      await tester.pump();
      expect(find.byType(CircularProgressIndicator), findsOneWidget);
      expect(tester.takeException(), isNull);
    });

    testWidgets('product grid shows an empty state when there are no '
        'authorized products', (tester) async {
      tester.view.physicalSize = const Size(1440, 900);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.reset);
      await tester.pumpWidget(
        MaterialApp(
          home: PosShell(
            context: _context,
            controller: PosReadController(const _EmptyPosReadGateway()),
            onLogout: () {},
          ),
        ),
      );
      await tester.pumpAndSettle();
      await tester.tap(find.byKey(const Key('nav-pos')));
      await tester.pumpAndSettle();
      expect(find.text('No hay productos disponibles.'), findsOneWidget);
    });

    testWidgets('product grid shows a failure state with retry on gateway '
        'error', (tester) async {
      tester.view.physicalSize = const Size(1440, 900);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.reset);
      await tester.pumpWidget(
        MaterialApp(
          home: PosShell(
            context: _context,
            controller: PosReadController(const _FailingPosReadGateway()),
            onLogout: () {},
          ),
        ),
      );
      await tester.pumpAndSettle();
      await tester.tap(find.byKey(const Key('nav-pos')));
      await tester.pumpAndSettle();
      expect(find.text('No fue posible cargar'), findsOneWidget);
      expect(find.text('Reintentar'), findsOneWidget);
      expect(tester.takeException(), isNull);
    });

    testWidgets('collapses the ticket panel into a bar below the reference '
        'breakpoint and keeps it empty', (tester) async {
      await _pump(tester, const Size(768, 1024));
      await tester.tap(find.byTooltip('Abrir navegación'));
      await tester.pumpAndSettle();
      await tester.tap(find.byKey(const Key('nav-pos')));
      await tester.pumpAndSettle();
      expect(find.byKey(const Key('pos-ticket-panel')), findsNothing);
      expect(find.byKey(const Key('pos-ticket-bar')), findsOneWidget);
      await tester.tap(find.byKey(const Key('pos-ticket-bar')));
      await tester.pumpAndSettle();
      expect(find.text('El ticket está vacío'), findsOneWidget);
    });

    testWidgets('shows the persistent ticket panel at the wide reference '
        'breakpoint', (tester) async {
      await _pump(tester, const Size(1440, 900));
      await tester.tap(find.byKey(const Key('nav-pos')));
      await tester.pumpAndSettle();
      expect(find.byKey(const Key('pos-ticket-panel')), findsOneWidget);
      expect(find.byKey(const Key('pos-ticket-bar')), findsNothing);
    });

    testWidgets('F2 moves keyboard focus to the product search field', (
      tester,
    ) async {
      await _pump(tester, const Size(1440, 900));
      await tester.tap(find.byKey(const Key('nav-pos')));
      await tester.pumpAndSettle();
      await simulateKeyDownEvent(LogicalKeyboardKey.f2);
      await tester.pump();
      final field = tester.widget<TextField>(
        find.byKey(const Key('pos-sale-search')),
      );
      expect(field.focusNode?.hasFocus, isTrue);
    });
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
      id: 'product-1',
      code: 'P-001',
      name: 'Producto real',
      type: 'simple',
      status: 'active',
      tracksInventory: true,
      categoryId: 'cat-1',
    ),
    PosProduct(
      id: 'product-2',
      code: 'P-002',
      name: 'Agua embotellada',
      type: 'simple',
      status: 'active',
      tracksInventory: true,
      categoryId: 'cat-2',
      defaultVariantId: 'variant-2',
    ),
    PosProduct(
      id: 'product-3',
      code: 'P-003',
      name: 'Refresco de cola',
      type: 'simple',
      status: 'active',
      tracksInventory: true,
      categoryId: 'cat-1',
      defaultVariantId: 'variant-3',
    ),
  ];

  @override
  Future<List<PosCategory>> categories() async => const [
    PosCategory(id: 'cat-1', name: 'Bebidas', status: 'active'),
    PosCategory(id: 'cat-2', name: 'Snacks', status: 'active'),
  ];

  @override
  Future<List<PosInventoryBalance>> inventoryBalances({
    String? branchId,
  }) async => const [
    // variant-3 (Refresco de cola) is out of stock; variant-2 (Agua
    // embotellada) has no balance row at all, which must render as normal
    // (unknown), not out-of-stock.
    PosInventoryBalance(
      id: 'balance-1',
      branchId: 'branch-id',
      locationId: 'location-id',
      variantId: 'variant-3',
      onHand: '0',
      reserved: '0',
      inTransit: '0',
    ),
  ];

  @override
  Future<List<PosUser>> users() async => const [];
}

class _SlowPosReadGateway implements PosReadGateway {
  const _SlowPosReadGateway();

  @override
  Future<List<PosProduct>> products() => Completer<List<PosProduct>>().future;

  @override
  Future<List<PosCategory>> categories() async => const [];

  @override
  Future<List<PosInventoryBalance>> inventoryBalances({
    String? branchId,
  }) async => const [];

  @override
  Future<List<PosUser>> users() async => const [];
}

class _EmptyPosReadGateway implements PosReadGateway {
  const _EmptyPosReadGateway();

  @override
  Future<List<PosProduct>> products() async => const [];

  @override
  Future<List<PosCategory>> categories() async => const [];

  @override
  Future<List<PosInventoryBalance>> inventoryBalances({
    String? branchId,
  }) async => const [];

  @override
  Future<List<PosUser>> users() async => const [];
}

class _FailingPosReadGateway implements PosReadGateway {
  const _FailingPosReadGateway();

  @override
  Future<List<PosProduct>> products() async =>
      throw const FormatException('boom');

  @override
  Future<List<PosCategory>> categories() async => const [];

  @override
  Future<List<PosInventoryBalance>> inventoryBalances({
    String? branchId,
  }) async => const [];

  @override
  Future<List<PosUser>> users() async => const [];
}
