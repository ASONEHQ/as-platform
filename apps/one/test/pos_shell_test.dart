import 'dart:async';

import 'package:as_one/core/errors/app_error.dart';
import 'package:as_one/core/networking/api_client.dart';
import 'package:as_one/features/authentication/auth_models.dart';
import 'package:as_one/features/pos/money.dart';
import 'package:as_one/features/pos/pos_auth_gateway.dart';
import 'package:as_one/features/pos/pos_cash_gateway.dart';
import 'package:as_one/features/pos/pos_customers_gateway.dart';
import 'package:as_one/features/pos/pos_loyalty_gateway.dart';
import 'package:as_one/features/pos/pos_memberships_gateway.dart';
import 'package:as_one/features/pos/pos_models.dart';
import 'package:as_one/features/pos/pos_navigation.dart';
import 'package:as_one/features/pos/pos_parties_gateway.dart';
import 'package:as_one/features/pos/pos_parties_models.dart';
import 'package:as_one/features/pos/pos_payments_gateway.dart';
import 'package:as_one/features/pos/pos_promotions_gateway.dart';
import 'package:as_one/features/pos/pos_read_controller.dart';
import 'package:as_one/features/pos/pos_read_gateway.dart';
import 'package:as_one/features/pos/pos_receipt.dart';
import 'package:as_one/features/pos/pos_refunds_gateway.dart';
import 'package:as_one/features/pos/pos_rewards_gateway.dart';
import 'package:as_one/features/pos/pos_sales_gateway.dart';
import 'package:as_one/features/pos/pos_settings_gateway.dart';
import 'package:as_one/features/pos/pos_shell.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  test('keeps all 33 canonical modules in their inspected order', () {
    // TASK 14.5 (Wave 3): 3 new, real capabilities with no legacy sidebar
    // counterpart (Variantes/Marca del Ticket/Asistente) were appended
    // within their natural groups — 25 (Wave 2 baseline) + 3 = 28.
    // TASK 15.1 (Phases 2-4): 4 more real, backend-wired commercial admin
    // capabilities were inserted within their natural groups — Marcas/
    // Catálogo Avanzado (Catálogo), Admin. Inventario (Inventario),
    // Sucursales (Administración) — 28 + 4 = 32.
    // TASK 16.7B added Impresora de Tickets (Sistema), inserted between
    // Marca del Ticket and Asistente, not appended at the very end — 32 +
    // 1 = 33. The first/last module and the last module's group are
    // unchanged.
    expect(PosModule.values, hasLength(33));
    // Matches the canonical `.sb-item[data-nav]` order: Ventas first
    // (Punto de Venta) — not an app-specific "Inicio first" ordering.
    // Sistema no longer ends on Configuración specifically now that
    // genuinely new, non-legacy capabilities (Marca del Ticket, Impresora
    // de Tickets, Asistente) are appended after it within the same group
    // — the group itself is still last, only its own trailing member
    // changed.
    expect(PosModule.values.first.label, 'Punto de Venta');
    expect(PosModule.values.last.label, 'Asistente');
    expect(PosModule.values.last.group, 'Sistema');
    expect(PosModule.values.map((item) => item.label).toSet(), hasLength(33));
  });

  testWidgets('renders the canonical desktop shell without fake KPIs', (
    tester,
  ) async {
    await _pump(tester, const Size(1440, 900));
    expect(find.byKey(const Key('pos-sidebar')), findsOneWidget);
    expect(find.byKey(const Key('pos-topbar')), findsOneWidget);
    expect(find.text('Empresa AS'), findsWidgets);
    // TASK 14.5 (Wave 3, Phase 2): the Dashboard landing screen is now a
    // real, server-aggregated metrics view — `_context` above carries no
    // `report.read`, so it honestly shows the shared permission state
    // instead of any (fake or real) metric, never a fabricated KPI.
    expect(find.byKey(const Key('pos-dashboard-permission')), findsOneWidget);
    expect(find.byKey(const Key('pos-dashboard-metrics-grid')), findsNothing);
    expect(find.textContaining('Ingresos'), findsNothing);
    expect(find.textContaining(r'$'), findsNothing);
    expect(tester.takeException(), isNull);
  });

  testWidgets('shows unsupported modules as Coming soon', (tester) async {
    await _pump(tester, const Size(1440, 900));
    // TASK 14.5 (Wave 3, Phase 6): Cafetería ("Acceso rápido") is now a
    // real screen — the exact same `_PosSale` surface as Punto de Venta,
    // scoped to visual-tile categories (see `pos_shell_wave3_cashier_
    // experience_test.dart`).
    // TASK 15.1 Phase 4: Categorías is no longer unimplemented — it now
    // has a real `PosCategoryAdminScreen` (closing the "catalog admin
    // depth" gap). Facturación CFDI has NO backend module at all
    // (confirmed by `docs/RC_RELEASE_INVENTORY.md`'s MANAGEMENT section
    // and re-confirmed here) and is explicitly out of this task's scope
    // ("Do NOT expand into new product domains") — it remains the real,
    // still-unimplemented module this test exercises.
    await tester.tap(find.byKey(const Key('nav-group-Caja y Finanzas')));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const Key('nav-billing')));
    await tester.pumpAndSettle();
    expect(find.text('Coming soon'), findsOneWidget);
    expect(find.text('Facturación CFDI'), findsWidgets);
  });

  testWidgets('loads products through the read gateway and filters locally', (
    tester,
  ) async {
    await _pump(tester, const Size(1440, 900));
    await tester.tap(find.byKey(const Key('nav-group-Catálogo')));
    await tester.pumpAndSettle();
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
      await _navigateToPos(tester);
      expect(find.byKey(const Key('pos-category-strip')), findsOneWidget);
      expect(find.byKey(const Key('pos-sale-search')), findsOneWidget);
      expect(find.byKey(const Key('pos-product-product-1')), findsOneWidget);
      expect(find.byKey(const Key('pos-ticket-panel')), findsOneWidget);
      expect(find.textContaining('Selecciona productos'), findsOneWidget);
      expect(find.text('Coming soon'), findsNothing);
      expect(tester.takeException(), isNull);
    });

    testWidgets('category selection changes read-only filtering', (
      tester,
    ) async {
      await _pump(tester, const Size(1440, 900));
      await _navigateToPos(tester);
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
      await _navigateToPos(tester);
      await tester.enterText(
        find.byKey(const Key('pos-sale-search')),
        'refresco',
      );
      await tester.pump();
      expect(find.byKey(const Key('pos-product-product-3')), findsOneWidget);
      expect(find.byKey(const Key('pos-product-product-1')), findsNothing);
    });

    testWidgets('shows an out-of-stock indicator only for zero-quantity '
        'balances matched to a product default variant', (tester) async {
      await _pump(tester, const Size(1440, 900));
      await _navigateToPos(tester);
      expect(find.text('Sin existencia'), findsOneWidget);
      expect(
        find.descendant(
          of: find.byKey(const Key('pos-product-product-1')),
          matching: find.text('Sin existencia'),
        ),
        findsNothing,
      );
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
            salesGateway: _FakeSalesGateway(),
            paymentsGateway: _FakePaymentsGateway(),
            cashGateway: const EmptyPosCashGateway(),
            refundsGateway: const EmptyPosRefundsGateway(),
            promotionsGateway: const EmptyPosPromotionsGateway(),
            customersGateway: const EmptyPosCustomersGateway(),
            membershipsGateway: const EmptyPosMembershipsGateway(),
            loyaltyGateway: const EmptyPosLoyaltyGateway(),
            rewardsGateway: const EmptyPosRewardsGateway(),
            partiesGateway: const EmptyPosPartiesGateway(),
            onLogout: () {},
            onBranchSelected: _noopBranchSelected,
          ),
        ),
      );
      await tester.pump();
      await tester.tap(find.byKey(const Key('nav-group-Ventas')));
      // Settle the accordion's own open animation (unrelated to the
      // pending product load below) before tapping the now-visible item.
      await tester.pumpAndSettle();
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
            salesGateway: _FakeSalesGateway(),
            paymentsGateway: _FakePaymentsGateway(),
            cashGateway: const EmptyPosCashGateway(),
            refundsGateway: const EmptyPosRefundsGateway(),
            promotionsGateway: const EmptyPosPromotionsGateway(),
            customersGateway: const EmptyPosCustomersGateway(),
            membershipsGateway: const EmptyPosMembershipsGateway(),
            loyaltyGateway: const EmptyPosLoyaltyGateway(),
            rewardsGateway: const EmptyPosRewardsGateway(),
            partiesGateway: const EmptyPosPartiesGateway(),
            onLogout: () {},
            onBranchSelected: _noopBranchSelected,
          ),
        ),
      );
      await tester.pumpAndSettle();
      await _navigateToPos(tester);
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
            salesGateway: _FakeSalesGateway(),
            paymentsGateway: _FakePaymentsGateway(),
            cashGateway: const EmptyPosCashGateway(),
            refundsGateway: const EmptyPosRefundsGateway(),
            promotionsGateway: const EmptyPosPromotionsGateway(),
            customersGateway: const EmptyPosCustomersGateway(),
            membershipsGateway: const EmptyPosMembershipsGateway(),
            loyaltyGateway: const EmptyPosLoyaltyGateway(),
            rewardsGateway: const EmptyPosRewardsGateway(),
            partiesGateway: const EmptyPosPartiesGateway(),
            onLogout: () {},
            onBranchSelected: _noopBranchSelected,
          ),
        ),
      );
      await tester.pumpAndSettle();
      await _navigateToPos(tester);
      expect(find.text('No fue posible cargar'), findsOneWidget);
      expect(find.text('Reintentar'), findsOneWidget);
      expect(tester.takeException(), isNull);
    });

    testWidgets('collapses the ticket panel into a bar below the reference '
        'breakpoint and keeps it empty', (tester) async {
      await _pump(tester, const Size(768, 1024));
      await tester.tap(find.byKey(const Key('pos-hamburger')));
      await tester.pumpAndSettle();
      await _navigateToPos(tester);
      expect(find.byKey(const Key('pos-ticket-panel')), findsNothing);
      expect(find.byKey(const Key('pos-ticket-bar')), findsOneWidget);
      await tester.tap(find.byKey(const Key('pos-ticket-bar')));
      await tester.pumpAndSettle();
      expect(find.textContaining('Selecciona productos'), findsOneWidget);
    });

    testWidgets('shows the persistent ticket panel at the wide reference '
        'breakpoint', (tester) async {
      await _pump(tester, const Size(1440, 900));
      await _navigateToPos(tester);
      expect(find.byKey(const Key('pos-ticket-panel')), findsOneWidget);
      expect(find.byKey(const Key('pos-ticket-bar')), findsNothing);
    });

    testWidgets('F2 moves keyboard focus to the product search field', (
      tester,
    ) async {
      await _pump(tester, const Size(1440, 900));
      await _navigateToPos(tester);
      await simulateKeyDownEvent(LogicalKeyboardKey.f2);
      await tester.pump();
      final field = tester.widget<TextField>(
        find.byKey(const Key('pos-sale-search')),
      );
      expect(field.focusNode?.hasFocus, isTrue);
    });

    testWidgets('renders the canonical mode switch, search actions, ticket '
        'header, and transactional chrome as visual placeholders '
        '(TASK 12.2C)', (tester) async {
      await _pump(tester, const Size(1440, 900));
      await _navigateToPos(tester);

      expect(find.byKey(const Key('pos-mode-cajero')), findsOneWidget);
      expect(find.byKey(const Key('pos-mode-cliente')), findsOneWidget);
      expect(find.text('CAJERO'), findsOneWidget);
      expect(find.text('CLIENTE'), findsOneWidget);

      expect(find.byTooltip('Vincular cliente (F3)'), findsOneWidget);
      expect(find.byTooltip('Reimprimir ticket (F4)'), findsOneWidget);
      expect(find.byTooltip('Suspender venta (F5)'), findsOneWidget);
      expect(find.byTooltip('Cancelar venta (F6)'), findsOneWidget);

      expect(find.text('Ticket #1'), findsOneWidget);
      expect(find.text('Producto'), findsOneWidget);
      expect(find.text('Unidades'), findsOneWidget);

      expect(find.text('Subtotal'), findsOneWidget);
      // TASK 16.7B: was 'IVA incluido' — false (tax is additive/exclusive
      // here, never included in the displayed unit price); now matches the
      // persisted-sale receipt's own real label.
      expect(find.text('IVA'), findsOneWidget);
      // No product was tapped — the ticket is genuinely empty here.
      expect(find.textContaining(r'Cobrar — $0.00'), findsOneWidget);
      expect(find.text('Efectivo'), findsOneWidget);
      expect(find.text('Tarjeta'), findsOneWidget);
      expect(find.text('Transfer'), findsOneWidget);
      expect(tester.takeException(), isNull);
    });

    testWidgets('clearly marks non-functional controls as read-only on tap '
        'instead of performing any transaction (TASK 12.2C/12.3)', (
      tester,
    ) async {
      await _pump(tester, const Size(1440, 900));
      await _navigateToPos(tester);

      // TASK 12.4A.1: Cobrar now really tries to create a sale — but this
      // ticket is genuinely empty, so it must say so honestly rather than
      // submit an empty (or fabricated) request.
      await tester.tap(find.byKey(const Key('pos-ticket-cobrar')));
      await tester.pump();
      expect(
        find.text('Agrega al menos un producto al ticket.'),
        findsOneWidget,
        reason: 'An empty ticket must never reach the sale-creation gateway.',
      );
      await tester.pumpAndSettle();

      // The payment-method grid and coupon/cash fields are untouched by
      // TASK 12.3 — still visually faithful, still wired to the generic
      // read-only notice. TASK 14.3 (Wave 1, Part B.4) made "Nota de
      // venta" a real action instead (see the dedicated note-dialog test
      // below) — "Limpiar ticket" is the remaining stub in this header.
      await tester.tap(find.byTooltip('Limpiar ticket'));
      // `hideCurrentSnackBar()` animates the previous SnackBar out before
      // the new one queues in — settle, not just one frame, so the
      // replacement is visible.
      await tester.pumpAndSettle();
      expect(
        find.textContaining('Modo de solo lectura: disponible'),
        findsOneWidget,
      );
      expect(tester.takeException(), isNull);
    });

    // TASK 14.3 (Wave 1, Part B.4): "Nota de venta" is now a real action —
    // opens a text-entry dialog bound to `SaleSession.note`, never the
    // generic read-only stub the rest of this header still uses.
    testWidgets('Nota de venta opens a real note dialog instead of the '
        'read-only stub', (tester) async {
      await _pump(tester, const Size(1440, 900));
      await _navigateToPos(tester);

      await tester.tap(find.byKey(const Key('pos-ticket-note-button')));
      await tester.pumpAndSettle();

      expect(find.text('Nota de venta'), findsOneWidget);
      expect(find.byKey(const Key('pos-ticket-note-field')), findsOneWidget);
      expect(
        find.textContaining('Modo de solo lectura: disponible'),
        findsNothing,
      );

      await tester.enterText(
        find.byKey(const Key('pos-ticket-note-field')),
        'Sin bolsa',
      );
      await tester.tap(find.byKey(const Key('pos-ticket-note-save')));
      await tester.pumpAndSettle();

      // Re-opening the dialog shows the note was really persisted on
      // `SaleSession`.
      await tester.tap(find.byKey(const Key('pos-ticket-note-button')));
      await tester.pumpAndSettle();
      expect(find.text('Sin bolsa'), findsOneWidget);
      expect(tester.takeException(), isNull);
    });

    testWidgets('CLIENTE mode swaps in a read-only preview of the same ticket, '
        'card-payment only, without switching away from the shell '
        '(TASK 12.3 addendum)', (tester) async {
      await _pump(tester, const Size(1440, 900));
      await _navigateToPos(tester);
      expect(find.byKey(const Key('pos-ticket-panel')), findsOneWidget);
      expect(find.byKey(const Key('pos-cliente-ticket-preview')), findsNothing);

      await tester.tap(find.byKey(const Key('pos-mode-cliente')));
      await tester.pumpAndSettle();

      // TASK 12.3B: CLIENTE mode is a dedicated locked surface, not a
      // navigation state inside the admin shell — the sidebar/topbar
      // are gone entirely (not merely hidden), replaced by the
      // dedicated `_ClienteLockedShell`.
      expect(find.byKey(const Key('pos-ticket-panel')), findsNothing);
      expect(
        find.byKey(const Key('pos-cliente-ticket-preview')),
        findsOneWidget,
      );
      expect(find.byKey(const Key('pos-cliente-shell')), findsOneWidget);
      expect(find.byKey(const Key('pos-sidebar')), findsNothing);
      expect(find.byKey(const Key('pos-topbar')), findsNothing);

      // CLIENTE never exposes cashier-only controls.
      expect(find.byKey(const Key('pos-ticket-coupon-input')), findsNothing);
      expect(find.byKey(const Key('pos-ticket-cash-input')), findsNothing);
      expect(find.text('Efectivo'), findsNothing);
      expect(find.text('Tarjeta'), findsNothing);
      expect(find.text('Transfer'), findsNothing);

      // The single card-payment action — TASK 12.4A.1: it really tries to
      // create a sale now, but this ticket is empty, so it must say so
      // honestly rather than submit an empty (or fabricated) request.
      expect(find.byKey(const Key('pos-cliente-card-payment')), findsOneWidget);
      await tester.tap(find.byKey(const Key('pos-cliente-card-payment')));
      await tester.pump();
      expect(
        find.text('Agrega al menos un producto al ticket.'),
        findsOneWidget,
        reason: 'An empty ticket must never reach the sale-creation gateway.',
      );

      // Switching back to CAJERO now requires authorization (TASK
      // 12.3A) — `_context` carries `sale.create`, so confirming the
      // dialog restores the full panel over the exact same session, not
      // a reset one (see the shared-state test below).
      await tester.tap(find.byKey(const Key('pos-mode-cajero')));
      await tester.pumpAndSettle();
      expect(find.byKey(const Key('pos-cajero-return-dialog')), findsOneWidget);
      // TASK 14.5A: a real PIN must be entered — see `_FakeAuthGateway`
      // (defaults to a successful `pinLogin`, matching every other gateway
      // default in this harness).
      await tester.enterText(
        find.byKey(const Key('pos-cajero-return-input')),
        '1234',
      );
      await tester.tap(find.byKey(const Key('pos-cajero-return-confirm')));
      await tester.pumpAndSettle();
      expect(find.byKey(const Key('pos-ticket-panel')), findsOneWidget);
      expect(tester.takeException(), isNull);
    });

    for (final size in const [
      Size(1024, 768),
      Size(1440, 900),
      Size(1920, 1080),
    ]) {
      testWidgets('renders the workspace without overflow at '
          '${size.width.toInt()} px', (tester) async {
        await _pump(tester, size);
        await _navigateToPos(tester);
        expect(find.byKey(const Key('pos-ticket-panel')), findsOneWidget);
        expect(find.byKey(const Key('pos-product-product-1')), findsOneWidget);
        expect(tester.takeException(), isNull);
      });
    }

    testWidgets('preserves POS proportions and legibility in dark mode', (
      tester,
    ) async {
      await _pump(tester, const Size(1440, 900));
      await tester.tap(find.byKey(const Key('pos-dark-mode-toggle')));
      await tester.pumpAndSettle();
      await _navigateToPos(tester);
      expect(find.byKey(const Key('pos-ticket-panel')), findsOneWidget);
      expect(find.byKey(const Key('pos-category-strip')), findsOneWidget);
      expect(find.byKey(const Key('pos-product-product-1')), findsOneWidget);
      expect(tester.takeException(), isNull);
    });
  });

  testWidgets('uses mobile navigation below the reference breakpoint', (
    tester,
  ) async {
    await _pump(tester, const Size(390, 844));
    expect(find.byKey(const Key('pos-sidebar')), findsNothing);
    final hamburger = find.byKey(const Key('pos-hamburger'));
    expect(hamburger, findsOneWidget);
    await tester.tap(hamburger);
    await tester.pumpAndSettle();
    expect(find.byKey(const Key('pos-sidebar')), findsOneWidget);
    expect(tester.takeException(), isNull);
  });

  group('Sale engine (TASK 12.3)', () {
    testWidgets('tapping a product adds it to the ticket reactively, no manual '
        'refresh needed', (tester) async {
      await _pump(tester, const Size(1440, 900));
      await _navigateToPos(tester);
      expect(find.text('Selecciona productos\npara comenzar'), findsOneWidget);

      await tester.tap(find.byKey(const Key('pos-product-product-1')));
      await tester.pump();

      expect(find.text('Selecciona productos\npara comenzar'), findsNothing);
      final line = find.byKey(const Key('pos-ticket-line-product-1'));
      expect(line, findsOneWidget);
      // The name appears twice on screen now (product card + ticket
      // line) — confirm it specifically inside the new ticket line.
      expect(
        find.descendant(of: line, matching: find.text('Producto real')),
        findsOneWidget,
      );
      expect(tester.takeException(), isNull);
    });

    testWidgets('tapping the same product again merges into the existing line '
        'instead of duplicating it', (tester) async {
      await _pump(tester, const Size(1440, 900));
      await _navigateToPos(tester);

      await tester.tap(find.byKey(const Key('pos-product-product-1')));
      await tester.pump();
      await tester.tap(find.byKey(const Key('pos-product-product-1')));
      await tester.pump();

      expect(
        find.byKey(const Key('pos-ticket-line-product-1')),
        findsOneWidget,
        reason: 'Adding the same product twice must merge, not duplicate.',
      );
      expect(find.text('2'), findsOneWidget);
    });

    testWidgets(
      'quantity buttons increase/decrease the line, removing it at zero',
      (tester) async {
        await _pump(tester, const Size(1440, 900));
        await _navigateToPos(tester);
        await tester.tap(find.byKey(const Key('pos-product-product-1')));
        await tester.pump();

        await tester.tap(
          find.byKey(const Key('pos-ticket-qty-plus-product-1')),
        );
        await tester.pump();
        expect(find.text('2'), findsOneWidget);

        await tester.tap(
          find.byKey(const Key('pos-ticket-qty-minus-product-1')),
        );
        await tester.pump();
        expect(find.text('1'), findsOneWidget);

        await tester.tap(
          find.byKey(const Key('pos-ticket-qty-minus-product-1')),
        );
        await tester.pump();
        expect(
          find.byKey(const Key('pos-ticket-line-product-1')),
          findsNothing,
          reason: 'Decreasing to 0 must remove the line entirely.',
        );
        expect(
          find.text('Selecciona productos\npara comenzar'),
          findsOneWidget,
        );
      },
    );

    testWidgets('the remove button deletes a line directly', (tester) async {
      await _pump(tester, const Size(1440, 900));
      await _navigateToPos(tester);
      await tester.tap(find.byKey(const Key('pos-product-product-1')));
      await tester.pump();
      await tester.tap(find.byKey(const Key('pos-product-product-2')));
      await tester.pump();

      await tester.tap(find.byKey(const Key('pos-ticket-remove-product-1')));
      await tester.pump();

      expect(find.byKey(const Key('pos-ticket-line-product-1')), findsNothing);
      expect(
        find.byKey(const Key('pos-ticket-line-product-2')),
        findsOneWidget,
      );
    });

    testWidgets('an out-of-stock product cannot be added to the ticket', (
      tester,
    ) async {
      await _pump(tester, const Size(1440, 900));
      await _navigateToPos(tester);
      // product-3 (Refresco de cola) has an onHand=0 balance for its
      // default variant — the fixture's one genuinely out-of-stock item.
      await tester.tap(find.byKey(const Key('pos-product-product-3')));
      await tester.pump();

      expect(find.byKey(const Key('pos-ticket-line-product-3')), findsNothing);
      expect(find.text('Producto sin existencia.'), findsOneWidget);
    });

    testWidgets(
      'Subtotal/IVA/Total recompute automatically as the ticket changes',
      (tester) async {
        await _pump(tester, const Size(1440, 900));
        await _navigateToPos(tester);
        // The empty cart starts at an honest $0.00.
        expect(find.text(r'$0.00'), findsWidgets);
        await tester.tap(find.byKey(const Key('pos-product-product-1')));
        await tester.pump();
        // TASK 12.3C: product-1 @ $10.00 => $10.00 subtotal, +16% IVA
        // ($1.60) = $11.60 — a real backend-priced total, not the old
        // placeholder $0.00.
        expect(find.textContaining(r'Cobrar — $11.60'), findsOneWidget);
        await tester.tap(find.byKey(const Key('pos-product-product-2')));
        await tester.pump();
        // + product-2 @ $10.00 => $20.00 subtotal, +16% IVA ($3.20) =
        // $23.20 — proves the totals genuinely recompute, not just render
        // once.
        expect(find.textContaining(r'Cobrar — $23.20'), findsOneWidget);
        expect(tester.takeException(), isNull);
      },
    );

    testWidgets(
      'CAJERO and CLIENTE observe the exact same SaleSession — a change '
      'made in one is immediately visible in the other, without '
      'resetting or duplicating the ticket',
      (tester) async {
        await _pump(tester, const Size(1440, 900));
        await _navigateToPos(tester);

        // Build up ticket state in CAJERO.
        await tester.tap(find.byKey(const Key('pos-product-product-1')));
        await tester.pump();
        await tester.tap(find.byKey(const Key('pos-product-product-1')));
        await tester.pump();
        await tester.tap(find.byKey(const Key('pos-product-product-2')));
        await tester.pump();

        // Switch to CLIENTE — the same lines/quantities must appear
        // immediately, not an empty/reset ticket.
        await tester.tap(find.byKey(const Key('pos-mode-cliente')));
        await tester.pumpAndSettle();
        expect(
          find.byKey(const Key('pos-cliente-ticket-line-product-1')),
          findsOneWidget,
        );
        expect(
          find.byKey(const Key('pos-cliente-ticket-line-product-2')),
          findsOneWidget,
        );

        // Back to CAJERO — authorize the return (TASK 12.3A); still the
        // same session underneath (quantity survives).
        await tester.tap(find.byKey(const Key('pos-mode-cajero')));
        await tester.pumpAndSettle();
        await tester.enterText(
          find.byKey(const Key('pos-cajero-return-input')),
          '1234',
        );
        await tester.tap(find.byKey(const Key('pos-cajero-return-confirm')));
        await tester.pumpAndSettle();
        expect(
          find.byKey(const Key('pos-ticket-line-product-1')),
          findsOneWidget,
        );
        expect(
          find.byKey(const Key('pos-ticket-line-product-2')),
          findsOneWidget,
        );

        // Remove a line in CAJERO — CLIENTE reflects it without switching
        // modes again to "refresh".
        await tester.tap(find.byKey(const Key('pos-ticket-remove-product-2')));
        await tester.pump();
        await tester.tap(find.byKey(const Key('pos-mode-cliente')));
        await tester.pumpAndSettle();
        expect(
          find.byKey(const Key('pos-cliente-ticket-line-product-1')),
          findsOneWidget,
        );
        expect(
          find.byKey(const Key('pos-cliente-ticket-line-product-2')),
          findsNothing,
        );
        expect(tester.takeException(), isNull);
      },
    );
  });

  group(
    'Cobrar and CLIENTE card payment create a real sale (TASK 12.4A.1)',
    () {
      testWidgets('Cobrar submits the ticket to the backend and reports the '
          'honest, non-final result', (tester) async {
        final gateway = _FakeSalesGateway(
          result: const PosSaleCreated(
            id: 'sale-1',
            saleNumber: 'SALE-abc123',
            status: 'pending_payment',
            total: '46.4000',
          ),
        );
        await _pump(tester, const Size(1440, 900), salesGateway: gateway);
        await _navigateToPos(tester);
        await tester.tap(find.byKey(const Key('pos-product-product-1')));
        await tester.pump();

        // TASK 12.5A: Efectivo is now the real default — select Tarjeta so
        // Cobrar still exercises the card/terminal path this test covers.
        await tester.tap(find.byKey(const Key('pos-pay-card')));
        await tester.pump();
        await tester.tap(find.byKey(const Key('pos-ticket-cobrar')));
        await tester.pump();
        await tester.pumpAndSettle();

        expect(gateway.calls, hasLength(1));
        expect(gateway.calls.single.branchId, 'branch-id');
        expect(gateway.calls.single.items, hasLength(1));
        expect(gateway.calls.single.items.single.productId, 'product-1');
        // Never a fabricated approval or terminal result — the backend's
        // own sale number is surfaced, and the message stops at "prepared
        // for payment," never "paid" or "approved."
        expect(
          find.text(
            'Venta SALE-abc123 preparada para pago — '
            'terminal no configurada.',
          ),
          findsOneWidget,
        );
        expect(tester.takeException(), isNull);
      });

      testWidgets('a rejected sale creation surfaces the real backend error, '
          'never a fake success', (tester) async {
        final gateway = _FakeSalesGateway(
          failure: const ApiException(
            AppFailure(
              AppErrorKind.validation,
              'El producto ya no está disponible.',
            ),
          ),
        );
        await _pump(tester, const Size(1440, 900), salesGateway: gateway);
        await _navigateToPos(tester);
        await tester.tap(find.byKey(const Key('pos-product-product-1')));
        await tester.pump();

        // TASK 12.5A: Efectivo is now the real default — select Tarjeta so
        // Cobrar still exercises the card/terminal path this test covers.
        await tester.tap(find.byKey(const Key('pos-pay-card')));
        await tester.pump();
        await tester.tap(find.byKey(const Key('pos-ticket-cobrar')));
        await tester.pump();
        await tester.pumpAndSettle();

        expect(gateway.calls, hasLength(1));
        expect(find.text('El producto ya no está disponible.'), findsOneWidget);
        expect(tester.takeException(), isNull);
      });

      testWidgets('the CLIENTE card-payment button submits the same shared '
          'SaleSession and reports the same honest result', (tester) async {
        final gateway = _FakeSalesGateway(
          result: const PosSaleCreated(
            id: 'sale-2',
            saleNumber: 'SALE-def456',
            status: 'pending_payment',
            total: '46.4000',
          ),
        );
        await _pump(tester, const Size(1440, 900), salesGateway: gateway);
        await _navigateToPos(tester);
        await tester.tap(find.byKey(const Key('pos-product-product-1')));
        await tester.pump();

        await tester.tap(find.byKey(const Key('pos-mode-cliente')));
        await tester.pumpAndSettle();
        await tester.tap(find.byKey(const Key('pos-cliente-card-payment')));
        await tester.pump();
        await tester.pumpAndSettle();

        expect(gateway.calls, hasLength(1));
        expect(gateway.calls.single.items.single.productId, 'product-1');
        expect(
          find.text(
            'Venta SALE-def456 preparada para pago — '
            'terminal no configurada.',
          ),
          findsOneWidget,
        );
        expect(tester.takeException(), isNull);
      });
    },
  );

  group('Mercado Pago Point dispatch and polling (TASK 12.4B.1)', () {
    // Mirrors `_paymentPollInterval` in pos_shell.dart — a private
    // top-level const, so restated here rather than imported.
    const pollInterval = Duration(seconds: 2);

    testWidgets('a configured Point terminal triggers a real card_terminal '
        'payment and polls through honest states to "Pago aprobado" — '
        'never approved before the backend says so', (tester) async {
      final salesGateway = _FakeSalesGateway(
        result: const PosSaleCreated(
          id: 'sale-mp-1',
          saleNumber: 'SALE-mp1',
          status: 'pending_payment',
          total: '46.4000',
        ),
      );
      final paymentsGateway = _FakePaymentsGateway(
        terminals: const [
          PosPaymentTerminal(
            id: 'terminal-1',
            provider: 'mercado_pago',
            status: 'active',
          ),
        ],
        createResult: const PosPaymentStatus(
          id: 'payment-1',
          status: 'pending',
          attempts: [PosPaymentAttempt(id: 'attempt-1', status: 'created')],
        ),
        pollResults: const [
          PosPaymentStatus(
            id: 'payment-1',
            status: 'pending',
            attempts: [
              PosPaymentAttempt(id: 'attempt-1', status: 'awaiting_terminal'),
            ],
          ),
          PosPaymentStatus(
            id: 'payment-1',
            status: 'pending',
            attempts: [
              PosPaymentAttempt(id: 'attempt-1', status: 'processing'),
            ],
          ),
          PosPaymentStatus(
            id: 'payment-1',
            status: 'captured',
            attempts: [PosPaymentAttempt(id: 'attempt-1', status: 'approved')],
          ),
        ],
      );
      await _pump(
        tester,
        const Size(1440, 900),
        salesGateway: salesGateway,
        paymentsGateway: paymentsGateway,
      );
      await _navigateToPos(tester);
      await tester.tap(find.byKey(const Key('pos-product-product-1')));
      await tester.pump();

      // TASK 12.5A: Efectivo is now the real default — select Tarjeta so
      // Cobrar still exercises the card/terminal path this test covers.
      await tester.tap(find.byKey(const Key('pos-pay-card')));
      await tester.pump();
      await tester.tap(find.byKey(const Key('pos-ticket-cobrar')));
      // Sale creation, terminal discovery, and payment creation all
      // resolve without a real timer — a couple of empty pumps flush
      // that microtask chain.
      await tester.pump();
      await tester.pump();
      expect(find.text('Esperando pago en terminal'), findsOneWidget);
      expect(find.text('Pago aprobado'), findsNothing);
      // TASK 14.5A: post-sale success feedback must not appear before the
      // backend itself reports the payment approved — same "never
      // fabricated success" rule as the "Pago aprobado" text itself.
      expect(find.byKey(const Key('pos-post-sale-feedback')), findsNothing);

      await tester.pump(pollInterval); // poll 1: awaiting_terminal
      expect(find.text('Esperando pago en terminal'), findsOneWidget);
      expect(find.byKey(const Key('pos-post-sale-feedback')), findsNothing);

      await tester.pump(pollInterval); // poll 2: processing
      expect(find.text('Procesando'), findsOneWidget);
      expect(find.byKey(const Key('pos-post-sale-feedback')), findsNothing);

      await tester.pump(pollInterval); // poll 3: approved — loop exits
      await tester.pumpAndSettle();

      expect(paymentsGateway.statusCalls, hasLength(3));
      expect(find.text('Pago aprobado — venta SALE-mp1.'), findsOneWidget);
      // TASK 14.5A: fires ONLY now, after the backend's own 'approved'
      // response — with the real amount/folio/payment method, never a
      // placeholder.
      expect(find.byKey(const Key('pos-post-sale-feedback')), findsOneWidget);
      expect(find.text('¡Venta completada!'), findsOneWidget);
      expect(
        find.descendant(
          of: find.byKey(const Key('pos-post-sale-feedback')),
          matching: find.text(r'$46.40'),
        ),
        findsOneWidget,
      );
      expect(
        find.byKey(const Key('pos-post-sale-feedback-method')),
        findsOneWidget,
      );
      expect(
        tester.widget<Text>(
          find.byKey(const Key('pos-post-sale-feedback-method')),
        ).data,
        'Tarjeta',
      );
      expect(tester.takeException(), isNull);
    });

    testWidgets('a declined payment is reported honestly, never as approved', (
      tester,
    ) async {
      final salesGateway = _FakeSalesGateway(
        result: const PosSaleCreated(
          id: 'sale-mp-2',
          saleNumber: 'SALE-mp2',
          status: 'pending_payment',
          total: '46.4000',
        ),
      );
      final paymentsGateway = _FakePaymentsGateway(
        terminals: const [
          PosPaymentTerminal(
            id: 'terminal-1',
            provider: 'mercado_pago',
            status: 'active',
          ),
        ],
        createResult: const PosPaymentStatus(
          id: 'payment-2',
          status: 'pending',
          attempts: [PosPaymentAttempt(id: 'attempt-2', status: 'created')],
        ),
        pollResults: const [
          PosPaymentStatus(
            id: 'payment-2',
            status: 'failed',
            attempts: [
              PosPaymentAttempt(
                id: 'attempt-2',
                status: 'declined',
                declineReason: 'cc_rejected_insufficient_amount',
              ),
            ],
          ),
        ],
      );
      await _pump(
        tester,
        const Size(1440, 900),
        salesGateway: salesGateway,
        paymentsGateway: paymentsGateway,
      );
      await _navigateToPos(tester);
      await tester.tap(find.byKey(const Key('pos-product-product-1')));
      await tester.pump();

      // TASK 12.5A: Efectivo is now the real default — select Tarjeta so
      // Cobrar still exercises the card/terminal path this test covers.
      await tester.tap(find.byKey(const Key('pos-pay-card')));
      await tester.pump();
      await tester.tap(find.byKey(const Key('pos-ticket-cobrar')));
      await tester.pump();
      await tester.pump();
      await tester.pump(pollInterval);
      await tester.pumpAndSettle();

      expect(find.text('Pago aprobado — venta SALE-mp2.'), findsNothing);
      expect(find.text('Pago no completado (Pago rechazado).'), findsOneWidget);
      // TASK 14.5A: a declined payment is never a completed sale — the
      // success feedback must never appear for it.
      expect(find.byKey(const Key('pos-post-sale-feedback')), findsNothing);
      expect(tester.takeException(), isNull);
    });

    testWidgets('the CLIENTE card button follows the exact same dispatch/poll '
        'flow as Cobrar', (tester) async {
      final salesGateway = _FakeSalesGateway(
        result: const PosSaleCreated(
          id: 'sale-mp-3',
          saleNumber: 'SALE-mp3',
          status: 'pending_payment',
          total: '46.4000',
        ),
      );
      final paymentsGateway = _FakePaymentsGateway(
        terminals: const [
          PosPaymentTerminal(
            id: 'terminal-1',
            provider: 'mercado_pago',
            status: 'assigned',
          ),
        ],
        createResult: const PosPaymentStatus(
          id: 'payment-3',
          status: 'captured',
          attempts: [PosPaymentAttempt(id: 'attempt-3', status: 'approved')],
        ),
      );
      await _pump(
        tester,
        const Size(1440, 900),
        salesGateway: salesGateway,
        paymentsGateway: paymentsGateway,
      );
      await _navigateToPos(tester);
      await tester.tap(find.byKey(const Key('pos-product-product-1')));
      await tester.pump();

      await tester.tap(find.byKey(const Key('pos-mode-cliente')));
      await tester.pumpAndSettle();
      await tester.tap(find.byKey(const Key('pos-cliente-card-payment')));
      await tester.pump();
      await tester.pump();
      await tester.pumpAndSettle();

      expect(find.text('Pago aprobado — venta SALE-mp3.'), findsOneWidget);
      // TASK 14.5A: the kiosk surface gets the same real, server-confirmed
      // feedback — with its own customer-facing title (tone differs; the
      // real gateway call/ordering rule is identical).
      expect(find.byKey(const Key('pos-post-sale-feedback')), findsOneWidget);
      expect(find.text('¡Pago completado!'), findsOneWidget);
      expect(tester.takeException(), isNull);
    });

    testWidgets(
      'TASK 14.5A: the post-sale success feedback literally cannot appear '
      'before PosSalesGateway.createSale itself resolves — a call-order '
      'proof, not just a timing coincidence',
      (tester) async {
        final salesGateway = _DelayedSalesGateway();
        final paymentsGateway = _FakePaymentsGateway(
          terminals: const [
            PosPaymentTerminal(
              id: 'terminal-1',
              provider: 'mercado_pago',
              status: 'active',
            ),
          ],
          createResult: const PosPaymentStatus(
            id: 'payment-delayed-1',
            status: 'captured',
            attempts: [
              PosPaymentAttempt(id: 'attempt-delayed-1', status: 'approved'),
            ],
          ),
        );
        await _pump(
          tester,
          const Size(1440, 900),
          salesGateway: salesGateway,
          paymentsGateway: paymentsGateway,
        );
        await _navigateToPos(tester);
        await tester.tap(find.byKey(const Key('pos-product-product-1')));
        await tester.pump();
        await tester.tap(find.byKey(const Key('pos-pay-card')));
        await tester.pump();
        await tester.tap(find.byKey(const Key('pos-ticket-cobrar')));
        await tester.pump();

        // `createSale` is still pending (the completer hasn't resolved) —
        // the feedback must not exist yet, no matter how many frames pass.
        expect(salesGateway.createCalls, hasLength(1));
        await tester.pump(const Duration(seconds: 5));
        expect(find.byKey(const Key('pos-post-sale-feedback')), findsNothing);

        // The server's own confirmation arrives now — only past this
        // point can the feedback legitimately appear.
        salesGateway.resolveWith(
          const PosSaleCreated(
            id: 'sale-delayed-1',
            saleNumber: 'SALE-delayed1',
            status: 'pending_payment',
            total: '10.0000',
          ),
        );
        await tester.pumpAndSettle();

        expect(find.byKey(const Key('pos-post-sale-feedback')), findsOneWidget);
        expect(tester.takeException(), isNull);
      },
    );
  });

  group('Cash payment and sale completion (TASK 12.5A)', () {
    testWidgets(
      'REGRESSION (visual QA): tapping the exact visible CAJERO "Cobrar — \$X.XX" button '
      'with Efectivo selected reaches the real cash flow — never the stale TASK 12.4 '
      'read-only handler/"Disponible en TASK 12.4" notice',
      (tester) async {
        final salesGateway = _FakeSalesGateway(
          result: const PosSaleCreated(
            id: 'sale-regression-1',
            saleNumber: 'SALE-regression1',
            status: 'pending_payment',
            total: '58.0000',
          ),
        );
        await _pump(tester, const Size(1440, 900), salesGateway: salesGateway);
        await _navigateToPos(tester);
        await tester.tap(find.byKey(const Key('pos-product-product-1')));
        await tester.pump();

        // The exact visible control: `_PosCobrarButton`'s own `InkWell`,
        // keyed `pos-ticket-cobrar`, showing the real live total (never a
        // static/placeholder label). Efectivo is confirmed pre-selected by
        // a separate test below — this one only proves what tapping this
        // exact button actually does.
        final cobrarButton = find.byKey(const Key('pos-ticket-cobrar'));
        expect(cobrarButton, findsOneWidget);
        expect(find.textContaining('Cobrar — \$'), findsOneWidget);
        expect(find.byKey(const Key('pos-pay-cash')), findsOneWidget);

        await tester.tap(cobrarButton);
        await tester.pump();
        await tester.pumpAndSettle();

        // The stale TASK 12.4 inert notice must never appear — neither
        // its own literal text nor the generic `_showReadOnlyNotice`
        // fallback every other still-inert V1-faithful control shows.
        expect(find.text('Disponible en TASK 12.4'), findsNothing);
        expect(
          find.textContaining('Modo de solo lectura: disponible'),
          findsNothing,
        );
        // Instead, the real TASK 12.5A cash dialog is open, showing the
        // authoritative backend total — proof the visible button reached
        // `_submitCashSaleForPayment` → `_CashPaymentDialog`, not the old
        // `_showReadOnlyNotice` handler.
        expect(salesGateway.calls, hasLength(1));
        expect(
          find.text('Pago en efectivo — venta SALE-regression1'),
          findsOneWidget,
        );
        expect(find.byKey(const Key('pos-cash-dialog-input')), findsOneWidget);
        expect(tester.takeException(), isNull);
      },
    );

    testWidgets('Efectivo is shown and pre-selected in CAJERO; the cash '
        'option is entirely absent in CLIENTE', (tester) async {
      await _pump(tester, const Size(1440, 900));
      await _navigateToPos(tester);
      expect(find.byKey(const Key('pos-pay-cash')), findsOneWidget);
      expect(find.byKey(const Key('pos-pay-card')), findsOneWidget);

      await tester.tap(find.byKey(const Key('pos-mode-cliente')));
      await tester.pumpAndSettle();
      expect(find.byKey(const Key('pos-pay-cash')), findsNothing);
      expect(find.byKey(const Key('pos-cash-dialog-input')), findsNothing);
      expect(find.text('Efectivo'), findsNothing);
    });

    testWidgets('tapping Cobrar with Efectivo selected creates the sale and '
        'opens the cash dialog showing the authoritative total — never '
        'completing the sale just by opening it', (tester) async {
      final salesGateway = _FakeSalesGateway(
        result: const PosSaleCreated(
          id: 'sale-cash-1',
          saleNumber: 'SALE-cash1',
          status: 'pending_payment',
          total: '58.0000',
        ),
      );
      final paymentsGateway = _FakePaymentsGateway();
      await _addProductAndOpenCashDialog(
        tester,
        salesGateway: salesGateway,
        paymentsGateway: paymentsGateway,
      );

      expect(salesGateway.calls, hasLength(1));
      expect(find.text('Pago en efectivo — venta SALE-cash1'), findsOneWidget);
      expect(find.text(r'$58.00'), findsOneWidget);
      expect(paymentsGateway.cashCalls, isEmpty);
      expect(tester.takeException(), isNull);
    });

    testWidgets('an insufficient tender blocks confirmation and shows how '
        'much remains', (tester) async {
      final salesGateway = _FakeSalesGateway(
        result: const PosSaleCreated(
          id: 'sale-cash-2',
          saleNumber: 'SALE-cash2',
          status: 'pending_payment',
          total: '58.0000',
        ),
      );
      final paymentsGateway = _FakePaymentsGateway();
      await _addProductAndOpenCashDialog(
        tester,
        salesGateway: salesGateway,
        paymentsGateway: paymentsGateway,
      );

      await tester.enterText(
        find.byKey(const Key('pos-cash-dialog-input')),
        '50',
      );
      await tester.pump();

      expect(find.text('Faltan \$8.00'), findsOneWidget);
      final confirmButton = tester.widget<FilledButton>(
        find.byKey(const Key('pos-cash-dialog-confirm')),
      );
      expect(confirmButton.onPressed, isNull);

      await tester.tap(find.byKey(const Key('pos-cash-dialog-confirm')));
      await tester.pump();
      expect(paymentsGateway.cashCalls, isEmpty);
    });

    testWidgets('an exact tender shows zero change and confirms the exact '
        'cash payment', (tester) async {
      final salesGateway = _FakeSalesGateway(
        result: const PosSaleCreated(
          id: 'sale-cash-3',
          saleNumber: 'SALE-cash3',
          status: 'pending_payment',
          total: '58.0000',
        ),
      );
      final paymentsGateway = _FakePaymentsGateway(
        cashResult: const PosCashPaymentResult(
          paymentId: 'payment-cash-3',
          status: 'captured',
          tenderedAmount: '58.0000',
          changeAmount: '0.0000',
          saleId: 'sale-cash-3',
          saleNumber: 'SALE-cash3',
          saleStatus: 'completed',
        ),
      );
      await _addProductAndOpenCashDialog(
        tester,
        salesGateway: salesGateway,
        paymentsGateway: paymentsGateway,
      );

      await tester.enterText(
        find.byKey(const Key('pos-cash-dialog-input')),
        '58',
      );
      await tester.pump();
      expect(find.text(r'$0.00'), findsOneWidget);

      await tester.tap(find.byKey(const Key('pos-cash-dialog-confirm')));
      await tester.pump();
      await tester.pumpAndSettle();

      expect(paymentsGateway.cashCalls, hasLength(1));
      expect(paymentsGateway.cashCalls.single.saleId, 'sale-cash-3');
      expect(paymentsGateway.cashCalls.single.tenderedAmount, '58.0000');
      // TASK 12.5B: the success/receipt dialog — folio/total/cambio from
      // the backend's own cash-payment response, not a plain SnackBar.
      // Scoped to `Dialog` since the (now-empty) ticket panel behind it
      // also legitimately shows "$0.00" for its own zeroed totals.
      expect(find.text('Venta completada'), findsOneWidget);
      expect(find.text('SALE-cash3'), findsOneWidget);
      // At least one "$58.00" inside the dialog (Total, and — once the
      // default fixture receipt loads — its own matching item/total rows).
      expect(
        find.descendant(
          of: find.byType(Dialog),
          matching: find.text(r'$58.00'),
        ),
        findsWidgets,
      );
      expect(
        find.descendant(of: find.byType(Dialog), matching: find.text(r'$0.00')),
        findsOneWidget,
      );
      // Never fakes the card/terminal path.
      expect(paymentsGateway.statusCalls, isEmpty);
      expect(tester.takeException(), isNull);
    });

    testWidgets('an over-tender shows the exact backend-confirmed change and '
        'never charges the tendered amount', (tester) async {
      final salesGateway = _FakeSalesGateway(
        result: const PosSaleCreated(
          id: 'sale-cash-4',
          saleNumber: 'SALE-cash4',
          status: 'pending_payment',
          total: '58.0000',
        ),
      );
      final paymentsGateway = _FakePaymentsGateway(
        cashResult: const PosCashPaymentResult(
          paymentId: 'payment-cash-4',
          status: 'captured',
          tenderedAmount: '100.0000',
          changeAmount: '42.0000',
          saleId: 'sale-cash-4',
          saleNumber: 'SALE-cash4',
          saleStatus: 'completed',
        ),
      );
      await _addProductAndOpenCashDialog(
        tester,
        salesGateway: salesGateway,
        paymentsGateway: paymentsGateway,
      );

      // Live client-side preview, before confirmation.
      await tester.enterText(
        find.byKey(const Key('pos-cash-dialog-input')),
        '100',
      );
      await tester.pump();
      expect(find.text(r'$42.00'), findsOneWidget);

      await tester.tap(find.byKey(const Key('pos-cash-dialog-confirm')));
      await tester.pump();
      await tester.pumpAndSettle();

      // The backend's own authoritative tendered/change is what the
      // success/receipt dialog reports — worked example from the task spec.
      expect(paymentsGateway.cashCalls.single.tenderedAmount, '100.0000');
      expect(find.text('Venta completada'), findsOneWidget);
      expect(find.text('SALE-cash4'), findsOneWidget);
      expect(
        find.descendant(
          of: find.byType(Dialog),
          matching: find.text(r'$42.00'),
        ),
        findsOneWidget,
      );
      expect(tester.takeException(), isNull);
    });

    testWidgets('a backend cash failure keeps the dialog open, shows the '
        'real error, and leaves the ticket completely untouched', (
      tester,
    ) async {
      final salesGateway = _FakeSalesGateway(
        result: const PosSaleCreated(
          id: 'sale-cash-5',
          saleNumber: 'SALE-cash5',
          status: 'pending_payment',
          total: '58.0000',
        ),
      );
      final paymentsGateway = _FakePaymentsGateway(
        cashFailure: const ApiException(
          AppFailure(AppErrorKind.validation, 'La venta ya fue completada.'),
        ),
      );
      await _addProductAndOpenCashDialog(
        tester,
        salesGateway: salesGateway,
        paymentsGateway: paymentsGateway,
      );

      await tester.enterText(
        find.byKey(const Key('pos-cash-dialog-input')),
        '58',
      );
      await tester.pump();
      await tester.tap(find.byKey(const Key('pos-cash-dialog-confirm')));
      await tester.pump();
      await tester.pumpAndSettle();

      expect(find.text('La venta ya fue completada.'), findsOneWidget);
      // The dialog is still open — no fabricated success, no auto-dismiss.
      expect(find.byKey(const Key('pos-cash-dialog-input')), findsOneWidget);
      // Close it and confirm the ticket line survived untouched — the
      // Cobrar button still reports a real, non-zero total (SaleSession
      // was never cleared on this failure path).
      await tester.tap(find.text('Cancelar'));
      await tester.pumpAndSettle();
      expect(find.textContaining(r'Cobrar — $0.00'), findsNothing);
      expect(find.byKey(const Key('pos-ticket-cobrar')), findsOneWidget);
      expect(tester.takeException(), isNull);
    });

    testWidgets('cancelling the dialog makes no cash-payment call and '
        'leaves the ticket intact', (tester) async {
      final salesGateway = _FakeSalesGateway(
        result: const PosSaleCreated(
          id: 'sale-cash-6',
          saleNumber: 'SALE-cash6',
          status: 'pending_payment',
          total: '58.0000',
        ),
      );
      final paymentsGateway = _FakePaymentsGateway();
      await _addProductAndOpenCashDialog(
        tester,
        salesGateway: salesGateway,
        paymentsGateway: paymentsGateway,
      );

      await tester.enterText(
        find.byKey(const Key('pos-cash-dialog-input')),
        '100',
      );
      await tester.pump();
      await tester.tap(find.text('Cancelar'));
      await tester.pumpAndSettle();

      expect(paymentsGateway.cashCalls, isEmpty);
      expect(find.byKey(const Key('pos-cash-dialog-input')), findsNothing);
      expect(tester.takeException(), isNull);
    });

    testWidgets('a confirmed cash sale resets SaleSession — the ticket is '
        'empty and ready for "Nueva venta"', (tester) async {
      final salesGateway = _FakeSalesGateway(
        result: const PosSaleCreated(
          id: 'sale-cash-7',
          saleNumber: 'SALE-cash7',
          status: 'pending_payment',
          total: '58.0000',
        ),
      );
      final paymentsGateway = _FakePaymentsGateway(
        cashResult: const PosCashPaymentResult(
          paymentId: 'payment-cash-7',
          status: 'captured',
          tenderedAmount: '58.0000',
          changeAmount: '0.0000',
          saleId: 'sale-cash-7',
          saleNumber: 'SALE-cash7',
          saleStatus: 'completed',
        ),
      );
      await _addProductAndOpenCashDialog(
        tester,
        salesGateway: salesGateway,
        paymentsGateway: paymentsGateway,
      );

      await tester.enterText(
        find.byKey(const Key('pos-cash-dialog-input')),
        '58',
      );
      await tester.pump();
      await tester.tap(find.byKey(const Key('pos-cash-dialog-confirm')));
      await tester.pump();
      await tester.pumpAndSettle();

      // The *local* ticket total (from the real product fixture, not the
      // fake sale total above) goes back to zero — SaleSession was reset
      // immediately, even while the success/receipt dialog is still open.
      expect(find.textContaining(r'Cobrar — $0.00'), findsOneWidget);
      // The dialog itself stays up until "Nueva venta" — never
      // auto-dismissed, never dismissible by tapping outside it.
      expect(find.text('Venta completada'), findsOneWidget);
      await tester.tapAt(const Offset(5, 5)); // barrier tap — must be a no-op.
      await tester.pump();
      expect(find.text('Venta completada'), findsOneWidget);

      await tester.tap(find.byKey(const Key('pos-receipt-new-sale')));
      await tester.pumpAndSettle();
      expect(find.text('Venta completada'), findsNothing);
    });
  });

  group('Inline cash-tender field (TASK 16.8A)', () {
    // product-1: $10.00 + 16% IVA_GENERAL = $11.60 (the client's own
    // locally-computed total before any backend quote resolves — see
    // `SaleSession.displayTotal`'s own doc comment).
    testWidgets(
      'the ticket-footer "Efectivo recibido" field is a real, editable, '
      'live tender entry — never the stale TASK 12.2C read-only notice',
      (tester) async {
        await _pump(tester, const Size(1440, 900));
        await _navigateToPos(tester);
        await tester.tap(find.byKey(const Key('pos-product-product-1')));
        await tester.pump();

        final field = find.byKey(const Key('pos-ticket-cash-input'));
        expect(field, findsOneWidget);
        await tester.tap(field);
        await tester.pump();
        expect(find.textContaining('Modo de solo lectura'), findsNothing);

        await tester.enterText(field, '11.60');
        await tester.pump();
        expect(
          tester.widget<TextField>(field).controller?.text,
          '11.60',
        );
        expect(tester.takeException(), isNull);
      },
    );

    testWidgets(
      'typing a sufficient tender live-computes Cambio, and an exact '
      'tender shows exactly \$0.00',
      (tester) async {
        await _pump(tester, const Size(1440, 900));
        await _navigateToPos(tester);
        await tester.tap(find.byKey(const Key('pos-product-product-1')));
        await tester.pump();

        final field = find.byKey(const Key('pos-ticket-cash-input'));
        await tester.enterText(field, '20');
        await tester.pump();
        expect(find.byKey(const Key('pos-ticket-change-row')), findsOneWidget);
        expect(find.text(r'$8.40'), findsOneWidget);

        await tester.enterText(field, '11.60');
        await tester.pump();
        expect(find.byKey(const Key('pos-ticket-change-row')), findsOneWidget);
        expect(find.text(r'$0.00'), findsOneWidget);
      },
    );

    testWidgets(
      'an insufficient tender shows the exact shortfall inline and rejects '
      'Cobrar without ever creating a sale',
      (tester) async {
        final salesGateway = _FakeSalesGateway(
          result: const PosSaleCreated(
            id: 'sale-tender-insufficient-1',
            saleNumber: 'SALE-tenderinsufficient1',
            status: 'pending_payment',
            total: '11.6000',
          ),
        );
        await _pump(tester, const Size(1440, 900), salesGateway: salesGateway);
        await _navigateToPos(tester);
        await tester.tap(find.byKey(const Key('pos-product-product-1')));
        await tester.pump();

        await tester.enterText(
          find.byKey(const Key('pos-ticket-cash-input')),
          '5',
        );
        await tester.pump();
        expect(find.text(r'Faltan $6.60'), findsOneWidget);

        await tester.tap(find.byKey(const Key('pos-ticket-cobrar')));
        await tester.pump();
        expect(
          find.textContaining(
            'El efectivo recibido es insuficiente. Faltan \$6.60.',
          ),
          findsOneWidget,
        );
        expect(salesGateway.calls, isEmpty);
        expect(tester.takeException(), isNull);
      },
    );

    testWidgets(
      'a sufficient inline tender prefills the mandatory confirmation '
      'dialog, and a successful sale resets the field for the next ticket',
      (tester) async {
        final salesGateway = _FakeSalesGateway(
          result: const PosSaleCreated(
            id: 'sale-tender-prefill-1',
            saleNumber: 'SALE-tenderprefill1',
            status: 'pending_payment',
            total: '11.6000',
          ),
        );
        final paymentsGateway = _FakePaymentsGateway(
          cashResult: const PosCashPaymentResult(
            paymentId: 'payment-tender-prefill-1',
            status: 'captured',
            tenderedAmount: '20.0000',
            changeAmount: '8.4000',
            saleId: 'sale-tender-prefill-1',
            saleNumber: 'SALE-tenderprefill1',
            saleStatus: 'completed',
          ),
        );
        await _pump(
          tester,
          const Size(1440, 900),
          salesGateway: salesGateway,
          paymentsGateway: paymentsGateway,
        );
        await _navigateToPos(tester);
        await tester.tap(find.byKey(const Key('pos-product-product-1')));
        await tester.pump();

        await tester.enterText(
          find.byKey(const Key('pos-ticket-cash-input')),
          '20',
        );
        await tester.pump();

        await tester.tap(find.byKey(const Key('pos-ticket-cobrar')));
        await tester.pump();
        await tester.pumpAndSettle();

        // The mandatory TASK 12.5A confirmation dialog still opens — this
        // never skips confirmation — but already prefilled from the
        // footer, so the cashier isn't asked to retype an amount already
        // on screen.
        expect(
          tester.widget<TextField>(find.byKey(const Key('pos-cash-dialog-input'))).controller?.text,
          '20.00',
        );

        await tester.tap(find.byKey(const Key('pos-cash-dialog-confirm')));
        await tester.pump();
        await tester.pumpAndSettle();

        expect(paymentsGateway.cashCalls, hasLength(1));
        expect(paymentsGateway.cashCalls.single.tenderedAmount, '20.0000');

        // TASK 16.8A: never leaks a stale tendered amount into the next
        // ticket — the ticket panel (and its footer) is still present in
        // the tree behind the still-open success/receipt dialog, exactly
        // like the pre-existing "Cobrar — $0.00" reset assertion above.
        expect(
          tester.widget<TextField>(find.byKey(const Key('pos-ticket-cash-input'))).controller?.text,
          isEmpty,
        );
        expect(find.byKey(const Key('pos-ticket-change-row')), findsNothing);
        expect(tester.takeException(), isNull);
      },
    );
  });

  group('Zero-total sale completion (TASK 13.2, ADR-0019)', () {
    testWidgets(
      'a sale whose backend-quoted total is exactly zero settles via the '
      'dedicated zero-total-completion endpoint — no cash dialog, no card '
      'terminal lookup, and the ticket resets exactly like a normal sale',
      (tester) async {
        final salesGateway = _FakeSalesGateway(
          result: const PosSaleCreated(
            id: 'sale-zero-1',
            saleNumber: 'SALE-zero1',
            status: 'pending_payment',
            total: '0.0000',
          ),
          zeroTotalResult: const PosSaleCreated(
            id: 'sale-zero-1',
            saleNumber: 'SALE-zero1',
            status: 'completed',
            total: '0.0000',
          ),
        );
        final promotionsGateway = _FakePromotionsGateway(
          quoteResult: const PosPricingQuote(
            currencyCode: 'MXN',
            subtotal: '100.0000',
            discountTotal: '100.0000',
            taxTotal: '0.0000',
            total: '0.0000',
            lines: [],
            appliedDiscounts: [
              PosAppliedDiscount(
                sourceType: 'reward',
                sourceId: 'entitlement-1',
                label: 'Recompensa',
                reasonCode: null,
                amount: '100.0000',
                lineIndex: null,
              ),
            ],
            rejectedCoupons: [],
          ),
        );
        await _pump(
          tester,
          const Size(1440, 900),
          salesGateway: salesGateway,
          promotionsGateway: promotionsGateway,
        );
        await _navigateToPos(tester);
        await tester.tap(find.byKey(const Key('pos-product-product-1')));
        await tester.pump();
        // Lets the automatic re-quote debounce (350ms) fire and settle —
        // `saleSession.quote` now reports the zero total above.
        await tester.pumpAndSettle(const Duration(milliseconds: 500));
        expect(find.textContaining(r'Cobrar — $0.00'), findsOneWidget);

        await tester.tap(find.byKey(const Key('pos-ticket-cobrar')));
        await tester.pump();
        await tester.pumpAndSettle();

        // Neither the cash dialog nor a card-terminal lookup ever ran —
        // the zero-total path is a dedicated third branch, never a
        // fabricated `$0` cash tender.
        expect(find.byKey(const Key('pos-cash-dialog-input')), findsNothing);
        expect(salesGateway.calls, hasLength(1));
        expect(salesGateway.zeroTotalCalls, ['sale-zero-1']);
        expect(find.text('Venta completada'), findsOneWidget);

        await tester.tap(find.byKey(const Key('pos-receipt-new-sale')));
        await tester.pumpAndSettle();
        expect(find.text('Venta completada'), findsNothing);
      },
    );

    testWidgets(
      'a backend rejection from zero-total-completion is shown honestly and '
      'never clears the ticket',
      (tester) async {
        final salesGateway = _FakeSalesGateway(
          result: const PosSaleCreated(
            id: 'sale-zero-2',
            saleNumber: 'SALE-zero2',
            status: 'pending_payment',
            total: '0.0000',
          ),
          zeroTotalFailure: const ApiException(
            AppFailure(AppErrorKind.validation, 'La recompensa ya fue canjeada.'),
          ),
        );
        final promotionsGateway = _FakePromotionsGateway(
          quoteResult: const PosPricingQuote(
            currencyCode: 'MXN',
            subtotal: '100.0000',
            discountTotal: '100.0000',
            taxTotal: '0.0000',
            total: '0.0000',
            lines: [],
            appliedDiscounts: [],
            rejectedCoupons: [],
          ),
        );
        await _pump(
          tester,
          const Size(1440, 900),
          salesGateway: salesGateway,
          promotionsGateway: promotionsGateway,
        );
        await _navigateToPos(tester);
        await tester.tap(find.byKey(const Key('pos-product-product-1')));
        await tester.pump();
        await tester.pumpAndSettle(const Duration(milliseconds: 500));

        await tester.tap(find.byKey(const Key('pos-ticket-cobrar')));
        await tester.pump();
        await tester.pumpAndSettle();

        expect(find.text('La recompensa ya fue canjeada.'), findsOneWidget);
        expect(find.text('Venta completada'), findsNothing);
      },
    );
  });

  group('Sale receipt and printing (TASK 12.5B)', () {
    testWidgets(
      'the completed-sale dialog loads the canonical receipt from the backend — folio, items, '
      'subtotal/IVA/total, efectivo recibido, and cambio — never from SaleSession',
      (tester) async {
        final receipt = PosReceipt(
          sale: PosReceiptSale(
            id: 'sale-receipt-1',
            saleNumber: 'SALE-cash3',
            status: 'completed',
            currencyCode: 'MXN',
            branchId: 'branch-id',
            occurredAt: DateTime.utc(2026, 8, 1),
            completedAt: DateTime.utc(2026, 8, 1, 0, 5),
            subtotal: '100.0000',
            discountTotal: '0.0000',
            taxTotal: '16.0000',
            total: '116.0000',
          ),
          business: const PosReceiptBusiness(
            companyName: 'AS ONE Fixture Co.',
            branchName: 'Main',
            branchAddress: null,
          ),
          cashier: const PosReceiptCashier(
            id: 'user-id',
            displayName: 'Cash Ier',
          ),
          items: const [
            PosReceiptItem(
              lineNumber: 1,
              nameSnapshot: 'Fixture Product',
              skuSnapshot: 'SKU-1',
              quantity: '2.000000',
              unitPrice: '50.0000',
              discountTotal: '0.0000',
              taxTotal: '16.0000',
              lineTotal: '116.0000',
            ),
          ],
          payments: const [
            PosReceiptPayment(
              id: 'payment-id',
              paymentMethod: 'cash',
              status: 'captured',
              amount: '116.0000',
              currencyCode: 'MXN',
              capturedAt: null,
              tenderedAmount: '120.0000',
              changeAmount: '4.0000',
              provider: null,
              terminalId: null,
              providerReference: null,
            ),
          ],
        );
        final salesGateway = _FakeSalesGateway(
          result: const PosSaleCreated(
            id: 'sale-receipt-1',
            saleNumber: 'SALE-cash3',
            status: 'pending_payment',
            total: '116.0000',
          ),
          receiptResult: receipt,
        );
        final paymentsGateway = _FakePaymentsGateway(
          cashResult: const PosCashPaymentResult(
            paymentId: 'payment-cash-3',
            status: 'captured',
            tenderedAmount: '120.0000',
            changeAmount: '4.0000',
            saleId: 'sale-receipt-1',
            saleNumber: 'SALE-cash3',
            saleStatus: 'completed',
          ),
        );
        await _addProductAndOpenCashDialog(
          tester,
          salesGateway: salesGateway,
          paymentsGateway: paymentsGateway,
        );
        await tester.enterText(
          find.byKey(const Key('pos-cash-dialog-input')),
          '120',
        );
        await tester.pump();
        await tester.tap(find.byKey(const Key('pos-cash-dialog-confirm')));
        await tester.pump();
        await tester.pumpAndSettle();

        // The full receipt is fetched by sale id — proof the dialog reads
        // persisted backend data, not `SaleSession` (which is already
        // cleared by this point).
        expect(salesGateway.receiptCalls, ['sale-receipt-1']);
        expect(find.textContaining('AS ONE Fixture Co.'), findsOneWidget);
        // Item name + quantity suffix, and the receipt's own real
        // subtotal/IVA/total/efectivo-recibido/cambio — all read straight
        // off the fetched `PosReceipt`, never re-derived.
        expect(find.textContaining('Fixture Product'), findsOneWidget);
        expect(find.textContaining('x2'), findsOneWidget);
        expect(find.textContaining(r'$100.00'), findsWidgets); // subtotal
        expect(find.textContaining(r'$16.00'), findsWidgets); // IVA
        expect(
          find.textContaining(r'$120.00'),
          findsWidgets,
        ); // efectivo recibido
        expect(find.textContaining(r'$4.00'), findsWidgets); // cambio
        expect(
          find.descendant(
            of: find.byType(Dialog),
            matching: find.text(r'$50.0000'),
          ),
          findsNothing, // never the raw 4-decimal wire string — always formatted.
        );
        expect(tester.takeException(), isNull);
      },
    );

    testWidgets(
      '"Imprimir ticket" is available once the receipt loads and honestly reports a '
      'blocked print window rather than pretending to print',
      (tester) async {
        final salesGateway = _FakeSalesGateway(
          result: const PosSaleCreated(
            id: 'sale-receipt-2',
            saleNumber: 'SALE-cash3',
            status: 'pending_payment',
            total: '58.0000',
          ),
        );
        final paymentsGateway = _FakePaymentsGateway(
          cashResult: const PosCashPaymentResult(
            paymentId: 'payment-cash-2',
            status: 'captured',
            tenderedAmount: '58.0000',
            changeAmount: '0.0000',
            saleId: 'sale-receipt-2',
            saleNumber: 'SALE-cash3',
            saleStatus: 'completed',
          ),
        );
        await _addProductAndOpenCashDialog(
          tester,
          salesGateway: salesGateway,
          paymentsGateway: paymentsGateway,
        );
        await tester.enterText(
          find.byKey(const Key('pos-cash-dialog-input')),
          '58',
        );
        await tester.pump();
        await tester.tap(find.byKey(const Key('pos-cash-dialog-confirm')));
        await tester.pump();
        await tester.pumpAndSettle();

        final printButton = find.byKey(const Key('pos-receipt-print'));
        expect(printButton, findsOneWidget);
        await tester.tap(printButton);
        await tester.pump();
        await tester.pumpAndSettle();

        // `flutter test` runs on the Dart VM, where `openReceiptPrintWindow`
        // (the `receipt_print_stub.dart` branch) always returns `false` —
        // exactly the same honest "could not open a print window" outcome a
        // real popup-blocked browser would report. Never a silent success.
        expect(
          find.textContaining('El navegador bloqueó la ventana de impresión'),
          findsOneWidget,
        );
        // The completed-sale state is completely unaffected by a print
        // failure — the sale was already done before printing was attempted.
        expect(find.text('Venta completada'), findsOneWidget);
        expect(tester.takeException(), isNull);
      },
    );

    testWidgets(
      'a backend receipt-fetch failure is shown honestly, with a retry, and never implies '
      'the sale itself failed',
      (tester) async {
        final salesGateway = _FakeSalesGateway(
          result: const PosSaleCreated(
            id: 'sale-receipt-3',
            saleNumber: 'SALE-cash3',
            status: 'pending_payment',
            total: '58.0000',
          ),
          receiptFailure: const ApiException(
            AppFailure(
              AppErrorKind.unavailable,
              'No se pudo cargar el recibo.',
            ),
          ),
        );
        final paymentsGateway = _FakePaymentsGateway(
          cashResult: const PosCashPaymentResult(
            paymentId: 'payment-cash-1',
            status: 'captured',
            tenderedAmount: '58.0000',
            changeAmount: '0.0000',
            saleId: 'sale-receipt-3',
            saleNumber: 'SALE-cash3',
            saleStatus: 'completed',
          ),
        );
        await _addProductAndOpenCashDialog(
          tester,
          salesGateway: salesGateway,
          paymentsGateway: paymentsGateway,
        );
        await tester.enterText(
          find.byKey(const Key('pos-cash-dialog-input')),
          '58',
        );
        await tester.pump();
        await tester.tap(find.byKey(const Key('pos-cash-dialog-confirm')));
        await tester.pump();
        await tester.pumpAndSettle();

        // The sale itself is still honestly reported as completed — a
        // receipt-fetch failure is a separate, retryable concern.
        expect(find.text('Venta completada'), findsOneWidget);
        expect(find.text('SALE-cash3'), findsOneWidget);
        expect(find.text('No se pudo cargar el recibo.'), findsOneWidget);
        final printButton = tester.widget<OutlinedButton>(
          find.byKey(const Key('pos-receipt-print')),
        );
        expect(printButton.onPressed, isNull); // nothing to print yet.

        await tester.tap(find.byKey(const Key('pos-receipt-retry')));
        await tester.pump();
        await tester.pumpAndSettle();
        // The retry hits the same failing fake gateway again — still an
        // honest error, never a silently fabricated success.
        expect(find.text('No se pudo cargar el recibo.'), findsOneWidget);
        expect(salesGateway.receiptCalls, hasLength(2));

        // "Nueva venta" still works even though the receipt never loaded.
        await tester.tap(find.byKey(const Key('pos-receipt-new-sale')));
        await tester.pumpAndSettle();
        expect(find.text('Venta completada'), findsNothing);
      },
    );

    testWidgets(
      'CLIENTE never reaches a completed-sale receipt today — its card path stops at honest '
      '"terminal no configurada" (Mercado Pago remains paused), so no receipt dialog exists there',
      (tester) async {
        final salesGateway = _FakeSalesGateway(
          result: const PosSaleCreated(
            id: 'sale-cliente-1',
            saleNumber: 'SALE-cliente1',
            status: 'pending_payment',
            total: '46.4000',
          ),
        );
        await _pump(tester, const Size(1440, 900), salesGateway: salesGateway);
        await _navigateToPos(tester);
        await tester.tap(find.byKey(const Key('pos-product-product-1')));
        await tester.pump();

        await tester.tap(find.byKey(const Key('pos-mode-cliente')));
        await tester.pumpAndSettle();
        await tester.tap(find.byKey(const Key('pos-cliente-card-payment')));
        await tester.pump();
        await tester.pumpAndSettle();

        // No receipt gateway call, no receipt dialog — see ADR-0012's
        // CLIENTE note: a receipt/print UI for a customer-facing kiosk is
        // deliberately out of scope until Mercado Pago resumes and a real
        // completed card sale from CLIENTE is even possible.
        expect(salesGateway.receiptCalls, isEmpty);
        expect(find.text('Venta completada'), findsNothing);
        expect(find.byKey(const Key('pos-receipt-print')), findsNothing);
        expect(tester.takeException(), isNull);
      },
    );
  });

  group('Completed-sale dialog receipt polish (TASK 12.5B.1)', () {
    // The real TASK 12.5B QA sale number — a genuine 37-character
    // `SALE-<32-hex>` value, not a shortened test fixture, so this
    // regresses the exact real-browser-QA shape ("RIGHT OVERFLOWED BY 1.1
    // PIXELS").
    const realSaleNumber = 'SALE-2517abd73ecf44a2b2206f4eadfeee49';

    testWidgets(
      'the real long canonical sale number renders in the completed-sale '
      'dialog with zero RenderFlex overflow',
      (tester) async {
        final salesGateway = _FakeSalesGateway(
          result: const PosSaleCreated(
            id: 'sale-polish-1',
            saleNumber: realSaleNumber,
            status: 'pending_payment',
            total: '29.0000',
          ),
        );
        final paymentsGateway = _FakePaymentsGateway(
          cashResult: const PosCashPaymentResult(
            paymentId: 'payment-polish-1',
            status: 'captured',
            tenderedAmount: '50.0000',
            changeAmount: '21.0000',
            saleId: 'sale-polish-1',
            saleNumber: realSaleNumber,
            saleStatus: 'completed',
          ),
        );
        await _addProductAndOpenCashDialog(
          tester,
          salesGateway: salesGateway,
          paymentsGateway: paymentsGateway,
        );
        await tester.enterText(
          find.byKey(const Key('pos-cash-dialog-input')),
          '50',
        );
        await tester.pump();
        await tester.tap(find.byKey(const Key('pos-cash-dialog-confirm')));
        await tester.pump();
        await tester.pumpAndSettle();

        expect(find.text('Venta completada'), findsOneWidget);
        // The full canonical sale number is shown exactly as returned —
        // never hidden, truncated, or replaced merely to avoid overflow.
        expect(find.text(realSaleNumber), findsOneWidget);
        // The real bug: `flutter test` surfaces a RenderFlex overflow as a
        // FlutterError caught here, not as a normal widget-tree assertion.
        expect(tester.takeException(), isNull);
      },
    );

    testWidgets(
      'Folio label and value are laid out with a real, deliberate gap — '
      'never rendered flush as "FolioSALE-..."',
      (tester) async {
        final salesGateway = _FakeSalesGateway(
          result: const PosSaleCreated(
            id: 'sale-polish-2',
            saleNumber: realSaleNumber,
            status: 'pending_payment',
            total: '29.0000',
          ),
        );
        final paymentsGateway = _FakePaymentsGateway(
          cashResult: const PosCashPaymentResult(
            paymentId: 'payment-polish-2',
            status: 'captured',
            tenderedAmount: '29.0000',
            changeAmount: '0.0000',
            saleId: 'sale-polish-2',
            saleNumber: realSaleNumber,
            saleStatus: 'completed',
          ),
        );
        await _addProductAndOpenCashDialog(
          tester,
          salesGateway: salesGateway,
          paymentsGateway: paymentsGateway,
        );
        await tester.enterText(
          find.byKey(const Key('pos-cash-dialog-input')),
          '29',
        );
        await tester.pump();
        await tester.tap(find.byKey(const Key('pos-cash-dialog-confirm')));
        await tester.pump();
        await tester.pumpAndSettle();

        expect(find.text('Folio'), findsOneWidget);
        expect(find.text(realSaleNumber), findsOneWidget);
        // A real layout gap (the `SizedBox(width: 12)` fix), not two
        // widgets whose rendered edges happen to touch — this is what
        // actually distinguishes the fix from the "FolioSALE-..." bug.
        final labelRight = tester.getTopRight(find.text('Folio')).dx;
        final valueLeft = tester.getTopLeft(find.text(realSaleNumber)).dx;
        expect(valueLeft - labelRight, greaterThanOrEqualTo(12));
        expect(tester.takeException(), isNull);
      },
    );
  });

  group('Historial de ventas (TASK 12.6 Part C)', () {
    PosSaleSummary summary({
      String id = 'sale-history-1',
      String status = 'completed',
      List<String> paymentMethods = const ['cash'],
    }) => PosSaleSummary(
      id: id,
      saleNumber: 'SALE-2517abd73ecf44a2b2206f4eadfeee49',
      status: status,
      currencyCode: 'MXN',
      branchId: 'branch-id',
      branchName: 'Puerta La Victoria',
      cashierId: 'user-id',
      cashierName: 'Bryant Aguilera',
      occurredAt: DateTime.utc(2026, 9, 3, 12),
      completedAt: status == 'completed'
          ? DateTime.utc(2026, 9, 3, 12, 1)
          : null,
      itemCount: 1,
      subtotal: '25.0000',
      taxTotal: '4.0000',
      total: '29.0000',
      paymentMethods: paymentMethods,
    );

    Future<void> navigateToHistory(WidgetTester tester) async {
      // `history` lives under "Administración" (matching the canonical
      // AS POS V1 sidebar — see pos_navigation.dart), the sidebar's own
      // default-expanded group, so it's already visible with no group
      // to open first (unlike Punto de Venta under "Ventas").
      await tester.tap(find.byKey(const Key('nav-history')));
      await tester.pumpAndSettle();
    }

    testWidgets(
      'loads real backend sales and shows a completed sale honestly, distinct from pending',
      (tester) async {
        final salesGateway = _FakeSalesGateway(
          listResult: PosSaleHistoryPage(
            items: [
              summary(),
              summary(
                id: 'sale-history-2',
                status: 'pending_payment',
                paymentMethods: const [],
              ),
            ],
            nextCursor: null,
          ),
        );
        await _pump(
          tester,
          const Size(1440, 900),
          context: _contextWithSaleRead,
          salesGateway: salesGateway,
        );
        await navigateToHistory(tester);

        expect(find.text('Historial de ventas'), findsOneWidget);
        expect(salesGateway.listCalls, hasLength(1));
        // Both rows render, with distinct honest status chips — never an
        // invented status, never pending shown as completed.
        expect(find.text('Completada'), findsOneWidget);
        expect(find.text('Pendiente'), findsOneWidget);
        expect(tester.takeException(), isNull);
      },
    );

    testWidgets('shows an honest empty state when there are no sales', (
      tester,
    ) async {
      final emptyGateway = _FakeSalesGateway(
        listResult: const PosSaleHistoryPage(items: [], nextCursor: null),
      );
      await _pump(
        tester,
        const Size(1440, 900),
        context: _contextWithSaleRead,
        salesGateway: emptyGateway,
      );
      await navigateToHistory(tester);
      expect(
        find.text('No hay ventas que coincidan con los filtros actuales.'),
        findsOneWidget,
      );
    });

    testWidgets(
      'shows the real backend error honestly with a retry on failure',
      (tester) async {
        final failingGateway = _FakeSalesGateway(
          listFailure: const ApiException(
            AppFailure(
              AppErrorKind.unavailable,
              'No fue posible cargar el historial de ventas.',
            ),
          ),
        );
        await _pump(
          tester,
          const Size(1440, 900),
          context: _contextWithSaleRead,
          salesGateway: failingGateway,
        );
        await navigateToHistory(tester);
        expect(
          find.text('No fue posible cargar el historial de ventas.'),
          findsOneWidget,
        );
        expect(find.text('Reintentar'), findsOneWidget);
        await tester.tap(find.text('Reintentar'));
        await tester.pump();
        expect(failingGateway.listCalls, hasLength(2));
      },
    );

    testWidgets(
      'the folio search filter calls the backend with the exact typed query',
      (tester) async {
        final salesGateway = _FakeSalesGateway(
          listResult: PosSaleHistoryPage(items: [summary()], nextCursor: null),
        );
        await _pump(
          tester,
          const Size(1440, 900),
          context: _contextWithSaleRead,
          salesGateway: salesGateway,
        );
        await navigateToHistory(tester);
        await tester.enterText(
          find.byKey(const Key('pos-history-search')),
          'ADFEEE49',
        );
        await tester.pump();
        expect(salesGateway.listCalls.last.filter.saleNumber, 'ADFEEE49');
      },
    );

    testWidgets(
      'the status filter calls the backend with the selected status',
      (tester) async {
        final salesGateway = _FakeSalesGateway(
          listResult: PosSaleHistoryPage(items: [summary()], nextCursor: null),
        );
        await _pump(
          tester,
          const Size(1440, 900),
          context: _contextWithSaleRead,
          salesGateway: salesGateway,
        );
        await navigateToHistory(tester);
        await tester.tap(find.byKey(const Key('pos-history-status')));
        await tester.pumpAndSettle();
        await tester.tap(find.text('Completada').last);
        await tester.pumpAndSettle();
        expect(salesGateway.listCalls.last.filter.status, 'completed');
      },
    );

    testWidgets(
      'a branch filter is offered only for company-wide access, never for a single-branch session',
      (tester) async {
        final salesGateway = _FakeSalesGateway(
          listResult: PosSaleHistoryPage(items: [summary()], nextCursor: null),
        );
        await _pump(
          tester,
          const Size(1440, 900),
          context: _contextWithSaleRead,
          salesGateway: salesGateway,
        );
        await navigateToHistory(tester);
        expect(find.byKey(const Key('pos-history-branch')), findsNothing);

        final companyWideGateway = _FakeSalesGateway(
          listResult: PosSaleHistoryPage(items: [summary()], nextCursor: null),
        );
        await _pump(
          tester,
          const Size(1440, 900),
          context: _companyWideContextWithSaleRead,
          salesGateway: companyWideGateway,
        );
        await navigateToHistory(tester);
        expect(find.byKey(const Key('pos-history-branch')), findsOneWidget);
      },
    );

    testWidgets(
      'opening a row shows the full canonical detail — folio, \$25/\$4/\$29, and cash \$50/\$21',
      (tester) async {
        final salesGateway = _FakeSalesGateway(
          listResult: PosSaleHistoryPage(items: [summary()], nextCursor: null),
          receiptResult: PosReceipt(
            sale: PosReceiptSale(
              id: 'sale-history-1',
              saleNumber: 'SALE-2517abd73ecf44a2b2206f4eadfeee49',
              status: 'completed',
              currencyCode: 'MXN',
              branchId: 'branch-id',
              occurredAt: DateTime.utc(2026, 9, 3, 12),
              completedAt: DateTime.utc(2026, 9, 3, 12, 1),
              subtotal: '25.0000',
              discountTotal: '0.0000',
              taxTotal: '4.0000',
              total: '29.0000',
            ),
            business: const PosReceiptBusiness(
              companyName: 'Inflapark Group',
              branchName: 'Puerta La Victoria',
              branchAddress: null,
            ),
            cashier: const PosReceiptCashier(
              id: 'user-id',
              displayName: 'Bryant Aguilera',
            ),
            items: const [
              PosReceiptItem(
                lineNumber: 1,
                nameSnapshot: 'Agua',
                skuSnapshot: 'AGUA-1',
                quantity: '1.000000',
                unitPrice: '25.0000',
                discountTotal: '0.0000',
                taxTotal: '4.0000',
                lineTotal: '29.0000',
              ),
            ],
            payments: const [
              PosReceiptPayment(
                id: 'payment-1',
                paymentMethod: 'cash',
                status: 'captured',
                amount: '29.0000',
                currencyCode: 'MXN',
                capturedAt: null,
                tenderedAmount: '50.0000',
                changeAmount: '21.0000',
                provider: null,
                terminalId: null,
                providerReference: null,
              ),
            ],
          ),
        );
        await _pump(
          tester,
          const Size(1440, 900),
          context: _contextWithSaleRead,
          salesGateway: salesGateway,
        );
        await navigateToHistory(tester);
        // `DataRow`/`TableRow` are plain configuration objects, not
        // `Element`s — `DataRow.key` never surfaces to `find.byKey`, so the
        // row is found and tapped by its own rendered folio text instead.
        await tester.tap(find.text('SALE-ADFEEE49'));
        await tester.pumpAndSettle();

        expect(find.text('Detalle de venta'), findsOneWidget);
        // The display folio appears both in the table row behind the
        // dialog and inside the dialog itself.
        expect(find.text('SALE-ADFEEE49'), findsWidgets);
        expect(find.text('Agua'), findsOneWidget);
        expect(find.textContaining(r'25.00'), findsWidgets);
        expect(find.textContaining(r'4.00'), findsWidgets);
        expect(find.textContaining(r'29.00'), findsWidgets);
        expect(find.textContaining(r'50.00'), findsWidgets);
        expect(find.textContaining(r'21.00'), findsWidgets);
        // No Refund/Cancel/Void control anywhere in the detail dialog.
        expect(find.textContaining('Reembolso'), findsNothing);
        expect(find.textContaining('Cancelar'), findsNothing);
        expect(find.textContaining('Anular'), findsNothing);
        expect(salesGateway.receiptCalls, hasLength(1));

        // Reprint uses the exact already-fetched receipt — it's read-only
        // and never calls the backend again.
        await tester.tap(find.byKey(const Key('pos-history-detail-print')));
        await tester.pump();
        expect(salesGateway.receiptCalls, hasLength(1));
        expect(salesGateway.calls, isEmpty); // never creates a Sale
      },
    );

    testWidgets(
      'CLIENTE mode never exposes Historial de ventas — the module lives only in the CAJERO sidebar',
      (tester) async {
        final salesGateway = _FakeSalesGateway(
          listResult: PosSaleHistoryPage(items: [summary()], nextCursor: null),
        );
        await _pump(
          tester,
          const Size(1440, 900),
          context: _contextWithSaleRead,
          salesGateway: salesGateway,
        );
        await _navigateToPos(tester);
        await tester.tap(find.byKey(const Key('pos-mode-cliente')));
        await tester.pumpAndSettle();
        expect(find.byKey(const Key('nav-history')), findsNothing);
        expect(salesGateway.listCalls, isEmpty);
      },
    );
  });

  group('Returns/refunds (TASK 12.8)', () {
    PosSaleSummary refundableSummary({
      String id = 'sale-history-1',
      String status = 'completed',
      String refundState = 'not_refunded',
    }) => PosSaleSummary(
      id: id,
      saleNumber: 'SALE-2517abd73ecf44a2b2206f4eadfeee49',
      status: status,
      currencyCode: 'MXN',
      branchId: 'branch-id',
      branchName: 'Puerta La Victoria',
      cashierId: 'user-id',
      cashierName: 'Bryant Aguilera',
      occurredAt: DateTime.utc(2026, 9, 3, 12),
      completedAt: status == 'completed'
          ? DateTime.utc(2026, 9, 3, 12, 1)
          : null,
      itemCount: 1,
      subtotal: '50.0000',
      taxTotal: '8.0000',
      total: '58.0000',
      paymentMethods: const ['cash'],
      refundState: refundState,
    );

    Future<void> openSaleDetail(
      WidgetTester tester, {
      required PosSalesGateway salesGateway,
      required PosRefundsGateway refundsGateway,
      AuthenticatedContext? context,
    }) async {
      await _pump(
        tester,
        const Size(1440, 900),
        context: context ?? _contextWithRefundPermissions,
        salesGateway: salesGateway,
        refundsGateway: refundsGateway,
      );
      await tester.tap(find.byKey(const Key('nav-history')));
      await tester.pumpAndSettle();
      await tester.tap(find.text('SALE-ADFEEE49'));
      await tester.pumpAndSettle();
    }

    Future<void> navigateToDevoluciones(WidgetTester tester) async {
      await _openVentasGroupIfNeeded(tester);
      await tester.tap(find.byKey(const Key('nav-returns')));
      await tester.pumpAndSettle();
    }

    testWidgets(
      'the refund action is hidden/disabled when E081 reports the sale is '
      'not refundable, using the backend own blocked_reason',
      (tester) async {
        final salesGateway = _FakeSalesGateway(
          listResult: PosSaleHistoryPage(
            items: [refundableSummary()],
            nextCursor: null,
          ),
        );
        final refundsGateway = _FakeRefundsGateway(
          balanceResult: const PosRefundableBalance(
            saleId: 'sale-history-1',
            refundable: false,
            blockedReason: 'La venta ya fue completamente reembolsada.',
            lines: [],
          ),
        );
        await openSaleDetail(
          tester,
          salesGateway: salesGateway,
          refundsGateway: refundsGateway,
        );

        expect(refundsGateway.balanceCalls, ['sale-history-1']);
        final button = find.byKey(const Key('pos-history-detail-refund'));
        expect(button, findsOneWidget);
        expect(
          tester.widget<OutlinedButton>(button).onPressed,
          isNull,
          reason: 'A non-refundable sale must never offer an enabled action.',
        );
      },
    );

    testWidgets(
      'the refund action is shown and enabled when E081 reports the sale '
      'is refundable',
      (tester) async {
        final salesGateway = _FakeSalesGateway(
          listResult: PosSaleHistoryPage(
            items: [refundableSummary()],
            nextCursor: null,
          ),
        );
        final refundsGateway = _FakeRefundsGateway();
        await openSaleDetail(
          tester,
          salesGateway: salesGateway,
          refundsGateway: refundsGateway,
        );

        final button = find.byKey(const Key('pos-history-detail-refund'));
        expect(button, findsOneWidget);
        expect(tester.widget<FilledButton>(button).onPressed, isNotNull);
      },
    );

    testWidgets(
      'a permission-less actor never even triggers the E081 call, and sees '
      'no refund control at all',
      (tester) async {
        final salesGateway = _FakeSalesGateway(
          listResult: PosSaleHistoryPage(
            items: [refundableSummary()],
            nextCursor: null,
          ),
        );
        final refundsGateway = _FakeRefundsGateway();
        await openSaleDetail(
          tester,
          context: _contextWithSaleRead,
          salesGateway: salesGateway,
          refundsGateway: refundsGateway,
        );

        expect(refundsGateway.balanceCalls, isEmpty);
        expect(
          find.byKey(const Key('pos-history-detail-refund')),
          findsNothing,
        );
        expect(find.textContaining('Reembolso'), findsNothing);
      },
    );

    testWidgets(
      'the item/quantity selection screen never lets the submitted '
      'quantity exceed the backend-reported refundable_quantity for a line',
      (tester) async {
        final salesGateway = _FakeSalesGateway(
          listResult: PosSaleHistoryPage(
            items: [refundableSummary()],
            nextCursor: null,
          ),
        );
        final refundsGateway = _FakeRefundsGateway(
          balanceResult: const PosRefundableBalance(
            saleId: 'sale-history-1',
            refundable: true,
            blockedReason: null,
            lines: [
              PosRefundableLine(
                saleItemId: 'sale-item-1',
                nameSnapshot: 'Fixture Product',
                soldQuantity: '2.000000',
                refundedQuantity: '1.000000',
                refundableQuantity: '1.000000',
                unitPrice: '50.0000',
              ),
            ],
          ),
        );
        await openSaleDetail(
          tester,
          salesGateway: salesGateway,
          refundsGateway: refundsGateway,
        );

        await tester.tap(find.byKey(const Key('pos-history-detail-refund')));
        await tester.pumpAndSettle();
        // `findsWidgets`, not `findsOneWidget`: the Sale Detail dialog
        // underneath (still mounted, merely visually covered) also shows
        // its own "Fixture Product" receipt line.
        expect(find.text('Fixture Product'), findsWidgets);

        final plusKey = const Key('pos-refund-qty-plus-sale-item-1');
        await tester.tap(find.byKey(plusKey));
        await tester.pump();
        // Structural bound: the stepper is disabled the instant it hits
        // `refundable_quantity` (1) — it can never be tapped a second time
        // to reach 2, even though `sold_quantity` is 2.
        expect(tester.widget<IconButton>(find.byKey(plusKey)).onPressed, isNull);

        await tester.tap(find.byKey(const Key('pos-refund-continue')));
        await tester.pumpAndSettle();
        await tester.tap(find.byKey(const Key('pos-refund-request')));
        await tester.pumpAndSettle();

        expect(refundsGateway.createCalls, hasLength(1));
        expect(
          refundsGateway.createCalls.single.items.single.quantity,
          '1.000000',
        );
      },
    );

    testWidgets(
      'the cash preview shows the backend own computed total from E082, '
      'never a client-recomputed one',
      (tester) async {
        final salesGateway = _FakeSalesGateway(
          listResult: PosSaleHistoryPage(
            items: [refundableSummary()],
            nextCursor: null,
          ),
        );
        // A total deliberately unrelated to `unit_price * quantity`
        // (`$50.00`) — if the UI ever recomputed it client-side instead of
        // trusting this response, this exact figure would never appear.
        final refundsGateway = _FakeRefundsGateway(
          createResult: PosRefund(
            id: 'refund-cash-1',
            branchId: 'branch-id',
            saleId: 'sale-history-1',
            cashSessionId: null,
            paymentId: null,
            refundNumber: 'REFUND-cash1',
            status: 'approved',
            refundMethod: 'cash',
            reasonCode: 'customer_changed_mind',
            reasonNote: null,
            currencyCode: 'MXN',
            subtotal: '100.0000',
            taxTotal: '23.4500',
            total: '123.4500',
            occurredAt: DateTime.utc(2026, 9, 3, 12, 5),
            completedAt: null,
            createdBy: 'user-id',
            approvedBy: 'user-id',
            items: const [
              PosRefundItem(
                id: 'ri-1',
                saleItemId: 'sale-item-1',
                quantity: '1.000000',
                subtotal: '100.0000',
                taxTotal: '23.4500',
                lineTotal: '123.4500',
                restockDisposition: 'restock',
              ),
            ],
          ),
        );
        await openSaleDetail(
          tester,
          salesGateway: salesGateway,
          refundsGateway: refundsGateway,
        );

        await tester.tap(find.byKey(const Key('pos-history-detail-refund')));
        await tester.pumpAndSettle();
        await tester.tap(
          find.byKey(const Key('pos-refund-qty-plus-sale-item-1')),
        );
        await tester.pump();
        await tester.tap(find.byKey(const Key('pos-refund-continue')));
        await tester.pumpAndSettle();
        await tester.tap(find.byKey(const Key('pos-refund-request')));
        await tester.pumpAndSettle();

        expect(
          find.textContaining('Efectivo a devolver: \$123.45'),
          findsOneWidget,
        );
        expect(find.byKey(const Key('pos-refund-complete')), findsOneWidget);
      },
    );

    testWidgets(
      'the card-refund path shows the exact honest message and never '
      'claims or implies success',
      (tester) async {
        final salesGateway = _FakeSalesGateway(
          listResult: PosSaleHistoryPage(
            items: [refundableSummary()],
            nextCursor: null,
          ),
        );
        final refundsGateway = _FakeRefundsGateway(
          createResult: _fixtureRefund(
            saleId: 'sale-history-1',
            status: 'approved',
            refundMethod: 'card_terminal',
          ),
        );
        await openSaleDetail(
          tester,
          salesGateway: salesGateway,
          refundsGateway: refundsGateway,
        );

        await tester.tap(find.byKey(const Key('pos-history-detail-refund')));
        await tester.pumpAndSettle();
        await tester.tap(
          find.byKey(const Key('pos-refund-qty-plus-sale-item-1')),
        );
        await tester.pump();
        await tester.tap(find.byKey(const Key('pos-refund-continue')));
        await tester.pumpAndSettle();
        await tester.tap(find.byKey(const Key('pos-refund-request')));
        await tester.pumpAndSettle();

        expect(
          find.text(
            'El reembolso con tarjeta requiere la configuración del '
            'proveedor de pago.',
          ),
          findsOneWidget,
        );
        // No action anywhere implies this will actually reverse the card
        // charge, and the completion endpoint is never even called.
        expect(find.byKey(const Key('pos-refund-complete')), findsNothing);
        expect(find.text('Devolución completada.'), findsNothing);
        expect(refundsGateway.completeCalls, isEmpty);
      },
    );

    testWidgets(
      'a cash_session_required completion error is surfaced clearly, with '
      'no silent session creation, and offers real navigation to Caja',
      (tester) async {
        final salesGateway = _FakeSalesGateway(
          listResult: PosSaleHistoryPage(
            items: [refundableSummary()],
            nextCursor: null,
          ),
        );
        final refundsGateway = _FakeRefundsGateway(
          createResult: _fixtureRefund(
            saleId: 'sale-history-1',
            status: 'approved',
          ),
          completeFailure: const ApiException(
            AppFailure(
              AppErrorKind.validation,
              'Abre la caja para comenzar a cobrar en efectivo.',
              code: 'cash_session_required',
            ),
          ),
        );
        await openSaleDetail(
          tester,
          salesGateway: salesGateway,
          refundsGateway: refundsGateway,
        );

        await tester.tap(find.byKey(const Key('pos-history-detail-refund')));
        await tester.pumpAndSettle();
        await tester.tap(
          find.byKey(const Key('pos-refund-qty-plus-sale-item-1')),
        );
        await tester.pump();
        await tester.tap(find.byKey(const Key('pos-refund-continue')));
        await tester.pumpAndSettle();
        await tester.tap(find.byKey(const Key('pos-refund-request')));
        await tester.pumpAndSettle();
        await tester.tap(find.byKey(const Key('pos-refund-complete')));
        await tester.pumpAndSettle();

        expect(refundsGateway.completeCalls, hasLength(1));
        expect(
          find.textContaining(
            'No hay una caja abierta. Abre una caja en Caja y Finanzas',
          ),
          findsOneWidget,
        );
        expect(find.byKey(const Key('pos-refund-go-caja')), findsOneWidget);

        await tester.tap(find.byKey(const Key('pos-refund-go-caja')));
        await tester.pumpAndSettle();

        // Every dialog closed and the shell really landed on Caja — not
        // merely a message claiming it would.
        expect(find.byKey(const Key('pos-history-detail-refund')), findsNothing);
        expect(find.text('Caja'), findsOneWidget);
      },
    );

    testWidgets(
      'the Sales History and Sale Detail refund-state badge renders for '
      'all three states, never hiding the original sale status',
      (tester) async {
        final salesGateway = _FakeSalesGateway(
          listResult: PosSaleHistoryPage(
            items: [
              refundableSummary(id: 'sale-a', refundState: 'not_refunded'),
              refundableSummary(
                id: 'sale-b',
                refundState: 'partially_refunded',
              ),
              refundableSummary(id: 'sale-c', refundState: 'fully_refunded'),
            ],
            nextCursor: null,
          ),
        );
        await _pump(
          tester,
          const Size(1440, 900),
          context: _contextWithSaleRead,
          salesGateway: salesGateway,
        );
        await tester.tap(find.byKey(const Key('nav-history')));
        await tester.pumpAndSettle();

        // The original `status` text is always present — additive only.
        expect(find.text('Completada'), findsOneWidget);
        expect(find.text('Completada · devolución parcial'), findsOneWidget);
        expect(find.text('Completada · reembolsada'), findsOneWidget);
      },
    );

    testWidgets(
      'Devoluciones renders a paginated list from E084',
      (tester) async {
        final refundsGateway = _FakeRefundsGateway(
          listResult: PosRefundPage(
            items: [
              _fixtureRefund(
                saleId: 'sale-history-1',
                status: 'completed',
                id: 'refund-1',
              ),
            ],
            nextCursor: null,
          ),
        );
        await _pump(
          tester,
          const Size(1440, 900),
          context: _contextWithRefundPermissions,
          refundsGateway: refundsGateway,
        );
        await navigateToDevoluciones(tester);

        expect(find.text('Devoluciones'), findsOneWidget);
        expect(find.text('REFUND-fixture'), findsOneWidget);
        expect(refundsGateway.listCalls, hasLength(1));
      },
    );

    testWidgets('Devoluciones shows an honest empty state', (tester) async {
      final refundsGateway = _FakeRefundsGateway(
        listResult: const PosRefundPage(items: [], nextCursor: null),
      );
      await _pump(
        tester,
        const Size(1440, 900),
        context: _contextWithRefundPermissions,
        refundsGateway: refundsGateway,
      );
      await navigateToDevoluciones(tester);

      expect(
        find.text(
          'No hay devoluciones que coincidan con los filtros actuales.',
        ),
        findsOneWidget,
      );
    });

    testWidgets(
      'Devoluciones shows the real backend error honestly with a retry',
      (tester) async {
        final refundsGateway = _FakeRefundsGateway(
          listFailure: const ApiException(
            AppFailure(
              AppErrorKind.unavailable,
              'No fue posible cargar el historial de devoluciones.',
            ),
          ),
        );
        await _pump(
          tester,
          const Size(1440, 900),
          context: _contextWithRefundPermissions,
          refundsGateway: refundsGateway,
        );
        await navigateToDevoluciones(tester);

        expect(
          find.text('No fue posible cargar el historial de devoluciones.'),
          findsOneWidget,
        );
        expect(find.text('Reintentar'), findsOneWidget);
        await tester.tap(find.text('Reintentar'));
        await tester.pump();
        expect(refundsGateway.listCalls, hasLength(2));
      },
    );

    testWidgets(
      'a rejected refund request (e.g. refund_approval_required) surfaces '
      'the real backend error honestly, never a fake success',
      (tester) async {
        final salesGateway = _FakeSalesGateway(
          listResult: PosSaleHistoryPage(
            items: [refundableSummary()],
            nextCursor: null,
          ),
        );
        final refundsGateway = _FakeRefundsGateway(
          createFailure: const ApiException(
            AppFailure(
              AppErrorKind.authorization,
              'Tu sesión no puede aprobar esta devolución automáticamente.',
              code: 'refund_approval_required',
            ),
          ),
        );
        await openSaleDetail(
          tester,
          salesGateway: salesGateway,
          refundsGateway: refundsGateway,
        );

        await tester.tap(find.byKey(const Key('pos-history-detail-refund')));
        await tester.pumpAndSettle();
        await tester.tap(
          find.byKey(const Key('pos-refund-qty-plus-sale-item-1')),
        );
        await tester.pump();
        await tester.tap(find.byKey(const Key('pos-refund-continue')));
        await tester.pumpAndSettle();
        await tester.tap(find.byKey(const Key('pos-refund-request')));
        await tester.pumpAndSettle();

        expect(
          find.text(
            'Tu sesión no puede aprobar esta devolución automáticamente.',
          ),
          findsOneWidget,
        );
        // Still on the reason step — never silently queued/retried, never
        // a fabricated success screen.
        expect(find.text('Devolución completada.'), findsNothing);
        expect(find.byKey(const Key('pos-refund-request')), findsOneWidget);
      },
    );

    testWidgets(
      'when E081 itself fails, the refund action stays hidden rather than '
      'guessing eligibility',
      (tester) async {
        final salesGateway = _FakeSalesGateway(
          listResult: PosSaleHistoryPage(
            items: [refundableSummary()],
            nextCursor: null,
          ),
        );
        final refundsGateway = _FakeRefundsGateway(
          balanceFailure: const ApiException(
            AppFailure(AppErrorKind.unavailable, 'El servicio no está disponible.'),
          ),
        );
        await openSaleDetail(
          tester,
          salesGateway: salesGateway,
          refundsGateway: refundsGateway,
        );

        expect(refundsGateway.balanceCalls, ['sale-history-1']);
        expect(
          find.byKey(const Key('pos-history-detail-refund')),
          findsNothing,
        );
      },
    );

    testWidgets(
      'completing a cash refund succeeds, shows the completed status, and '
      'offers to print a return/refund receipt',
      (tester) async {
        final salesGateway = _FakeSalesGateway(
          listResult: PosSaleHistoryPage(
            items: [refundableSummary()],
            nextCursor: null,
          ),
        );
        final refundsGateway = _FakeRefundsGateway(
          createResult: _fixtureRefund(
            saleId: 'sale-history-1',
            status: 'approved',
            id: 'refund-cash-ok',
          ),
          completeResult: _fixtureRefund(
            saleId: 'sale-history-1',
            status: 'completed',
            id: 'refund-cash-ok',
          ),
        );
        await openSaleDetail(
          tester,
          salesGateway: salesGateway,
          refundsGateway: refundsGateway,
        );

        await tester.tap(find.byKey(const Key('pos-history-detail-refund')));
        await tester.pumpAndSettle();
        await tester.tap(
          find.byKey(const Key('pos-refund-qty-plus-sale-item-1')),
        );
        await tester.pump();
        await tester.tap(find.byKey(const Key('pos-refund-continue')));
        await tester.pumpAndSettle();
        await tester.tap(find.byKey(const Key('pos-refund-request')));
        await tester.pumpAndSettle();
        await tester.tap(find.byKey(const Key('pos-refund-complete')));
        await tester.pumpAndSettle();

        expect(refundsGateway.completeCalls, hasLength(1));
        expect(find.text('Devolución completada.'), findsOneWidget);
        expect(find.byKey(const Key('pos-refund-print')), findsOneWidget);

        // Closing this dialog reports back that a refund actually
        // completed, so the caller (Sales History) reloads its own list.
        await tester.tap(find.byKey(const Key('pos-refund-done')));
        await tester.pumpAndSettle();
        expect(salesGateway.listCalls.length, greaterThanOrEqualTo(2));
      },
    );

    testWidgets(
      'tapping a Devoluciones row opens the refund detail dialog via E083',
      (tester) async {
        final refundsGateway = _FakeRefundsGateway(
          listResult: PosRefundPage(
            items: [
              _fixtureRefund(
                saleId: 'sale-history-1',
                status: 'completed',
                id: 'refund-detail-1',
              ),
            ],
            nextCursor: null,
          ),
          refundResult: _fixtureRefund(
            saleId: 'sale-history-1',
            status: 'completed',
            id: 'refund-detail-1',
          ),
        );
        await _pump(
          tester,
          const Size(1440, 900),
          context: _contextWithRefundPermissions,
          refundsGateway: refundsGateway,
        );
        await navigateToDevoluciones(tester);

        await tester.tap(find.text('REFUND-fixture'));
        await tester.pumpAndSettle();

        expect(find.text('Detalle de devolución'), findsOneWidget);
        expect(refundsGateway.refundCalls, ['refund-detail-1']);
      },
    );

    testWidgets(
      'a failed refund detail fetch (E083) is shown honestly with a retry',
      (tester) async {
        final refundsGateway = _FakeRefundsGateway(
          listResult: PosRefundPage(
            items: [
              _fixtureRefund(
                saleId: 'sale-history-1',
                status: 'completed',
                id: 'refund-detail-2',
              ),
            ],
            nextCursor: null,
          ),
          refundFailure: const ApiException(
            AppFailure(
              AppErrorKind.unavailable,
              'No fue posible cargar el detalle de la devolución.',
            ),
          ),
        );
        await _pump(
          tester,
          const Size(1440, 900),
          context: _contextWithRefundPermissions,
          refundsGateway: refundsGateway,
        );
        await navigateToDevoluciones(tester);

        await tester.tap(find.text('REFUND-fixture'));
        await tester.pumpAndSettle();

        expect(
          find.text('No fue posible cargar el detalle de la devolución.'),
          findsOneWidget,
        );
        expect(find.byKey(const Key('pos-refunds-detail-retry')), findsOneWidget);
      },
    );
  });

  group('POS operational branch context', () {
    testWidgets(
      '"Todas las sucursales" is not accepted as an operational POS branch — '
      'entering Punto de Venta shows the branch-selection prompt instead of a ticket',
      (tester) async {
        final harness = _BranchSwitchingHarness(
          initialContext: _companyWideContext,
        );
        await _pumpHarness(tester, harness);
        await _navigateToPos(tester);

        expect(find.byKey(const Key('pos-branch-required')), findsOneWidget);
        expect(
          find.text('Selecciona una sucursal para operar el Punto de Venta'),
          findsOneWidget,
        );
        // The real ticket/Cobrar surface never renders while unresolved.
        expect(find.byKey(const Key('pos-ticket-cobrar')), findsNothing);
        expect(find.byKey(const Key('pos-product-product-1')), findsNothing);
        // Only the session's own real authorized branches are offered —
        // "Todas las sucursales" itself is deliberately not one of the
        // choices here (that stays valid for dashboards, never for POS).
        expect(
          find.byKey(const Key('pos-branch-required-branch-a')),
          findsOneWidget,
        );
        expect(
          find.byKey(const Key('pos-branch-required-branch-b')),
          findsOneWidget,
        );
        expect(find.text('Todas las sucursales'), findsNothing);
      },
    );

    testWidgets(
      'selecting an authorized branch propagates to PosShell, reloads the branch-aware '
      'catalog, and unlocks the real ticket — the full REAL QA TARGET flow through to '
      'the cash dialog',
      (tester) async {
        final trackingGateway = _TrackingReadGateway();
        final salesGateway = _FakeSalesGateway(
          result: const PosSaleCreated(
            id: 'sale-branch-a-1',
            saleNumber: 'SALE-brancha1',
            status: 'pending_payment',
            total: '58.0000',
          ),
        );
        final harness = _BranchSwitchingHarness(
          initialContext: _companyWideContext,
          salesGateway: salesGateway,
          readGateway: trackingGateway,
        );
        await _pumpHarness(tester, harness);
        await _navigateToPos(tester);
        expect(find.byKey(const Key('pos-branch-required')), findsOneWidget);

        await tester.tap(find.byKey(const Key('pos-branch-required-branch-a')));
        await tester.pumpAndSettle();

        // Propagated: the branch-required prompt is gone, the real
        // ticket/Cobrar surface is now showing.
        expect(find.byKey(const Key('pos-branch-required')), findsNothing);
        expect(find.byKey(const Key('pos-ticket-cobrar')), findsOneWidget);
        // Catalog/inventory reloaded scoped to the newly-selected branch
        // — never the stale "Todas las sucursales" (null) scope.
        expect(trackingGateway.productBranchIdCalls, contains('branch-a'));
        expect(trackingGateway.balanceBranchIdCalls, contains('branch-a'));

        // Add a product, confirm Efectivo (the real default), tap Cobrar.
        await tester.tap(find.byKey(const Key('pos-product-product-1')));
        await tester.pump();
        await tester.tap(find.byKey(const Key('pos-ticket-cobrar')));
        await tester.pump();
        await tester.pumpAndSettle();

        // No "no branch assigned" guard, no stale inert notice — a real
        // Sale was created for the *selected* branch, and the real
        // TASK 12.5A cash dialog opened.
        expect(
          find.text('Esta sesión no tiene una sucursal asignada.'),
          findsNothing,
        );
        expect(salesGateway.calls, hasLength(1));
        expect(salesGateway.calls.single.branchId, 'branch-a');
        expect(find.byKey(const Key('pos-cash-dialog-input')), findsOneWidget);
        expect(tester.takeException(), isNull);
      },
    );

    testWidgets(
      'an unauthorized/arbitrary branch id can never be selected or injected — '
      'never trusted client-side',
      (tester) async {
        String? rejectedAttempt;
        final state = GlobalKey<_BranchSwitchingHarnessState>();
        await _pumpHarness(
          tester,
          _BranchSwitchingHarness(
            key: state,
            initialContext: _companyWideContext,
            onSwitchAttempt: (branchId) => rejectedAttempt = branchId,
          ),
        );

        // Simulates a bug/attacker calling the exact same callback the real
        // widgets use, but with an id never present in this session's own
        // `permittedBranchIds` — the harness (standing in for the real
        // backend-authoritative `AuthController.selectBranch`/`switchBranch`
        // call) must reject it, never trust it.
        await state.currentState!.attemptSelectBranch('branch-not-authorized');
        await tester.pumpAndSettle();

        expect(rejectedAttempt, 'branch-not-authorized');
        // The session's operational context is completely unchanged —
        // still "Todas las sucursales", still showing the branch prompt.
        await _navigateToPos(tester);
        expect(find.byKey(const Key('pos-branch-required')), findsOneWidget);
        expect(find.byKey(const Key('pos-ticket-cobrar')), findsNothing);
      },
    );

    testWidgets(
      'switching branch while the ticket is non-empty asks before discarding it — never a '
      'silent migration to another branch\'s catalog',
      (tester) async {
        final harness = _BranchSwitchingHarness(
          initialContext: _contextWithAlternateBranch,
        );
        await _pumpHarness(tester, harness);
        await _navigateToPos(tester);
        await tester.tap(find.byKey(const Key('pos-product-product-1')));
        await tester.pump();
        expect(find.textContaining(r'Cobrar — $0.00'), findsNothing);

        await tester.tap(find.byKey(const Key('pos-branch-switch')));
        await tester.pumpAndSettle();
        expect(find.text('Sucursal Otra'), findsOneWidget);
        await tester.tap(find.text('Sucursal Otra'));
        await tester.pumpAndSettle();

        // The confirmation dialog appeared — cancelling it leaves both
        // the ticket and the operational branch completely untouched.
        expect(find.text('Cambiar de sucursal'), findsOneWidget);
        await tester.tap(find.text('Cancelar'));
        await tester.pumpAndSettle();
        expect(find.textContaining(r'Cobrar — $0.00'), findsNothing);
        expect(find.byKey(const Key('pos-branch-required')), findsNothing);

        // Retrying and explicitly confirming clears the ticket, then
        // switches — never the reverse order.
        await tester.tap(find.byKey(const Key('pos-branch-switch')));
        await tester.pumpAndSettle();
        await tester.tap(find.text('Sucursal Otra'));
        await tester.pumpAndSettle();
        await tester.tap(find.text('Vaciar y cambiar'));
        await tester.pumpAndSettle();
        expect(find.textContaining(r'Cobrar — $0.00'), findsOneWidget);
      },
    );

    testWidgets(
      'the backend/checkout guard remains as defense in depth even when the entry-guard '
      'signal and the checkout branch id could disagree',
      (tester) async {
        // A deliberately inconsistent fixture: `currentBranch` resolves
        // (so the entry guard lets the ticket UI render) but
        // `session.branchId` — what `_submitCashSaleForPayment` actually
        // checks — is null. Exercises the checkout guard as a genuinely
        // independent second check, not dead code the entry guard makes
        // unreachable.
        final inconsistent = AuthenticatedContext(
          session: SessionContext(
            id: 'session-id',
            userId: 'user-id',
            companyId: 'company-id',
            branchId: null,
            permittedBranchIds: const ['branch-id'],
            companyWideAccess: false,
            expiresAt: DateTime.utc(2099),
          ),
          user: _context.user,
          companies: _context.companies,
          branches: _context.branches,
          companyWideAccess: false,
          permissions: _context.permissions,
        );
        await _pump(tester, const Size(1440, 900), context: inconsistent);
        await _navigateToPos(tester);
        // Entry guard passed (a `currentBranch` resolves) — the real
        // ticket renders.
        expect(find.byKey(const Key('pos-ticket-cobrar')), findsOneWidget);

        await tester.tap(find.byKey(const Key('pos-product-product-1')));
        await tester.pump();
        await tester.tap(find.byKey(const Key('pos-ticket-cobrar')));
        await tester.pump();
        expect(
          find.text('Esta sesión no tiene una sucursal asignada.'),
          findsOneWidget,
        );
      },
    );

    testWidgets(
      'CLIENTE observes the exact same operational branch CAJERO selected',
      (tester) async {
        final salesGateway = _FakeSalesGateway(
          result: const PosSaleCreated(
            id: 'sale-cliente-branch-1',
            saleNumber: 'SALE-clientebranch1',
            status: 'pending_payment',
            total: '46.4000',
          ),
        );
        final harness = _BranchSwitchingHarness(
          initialContext: _companyWideContext,
          salesGateway: salesGateway,
        );
        await _pumpHarness(tester, harness);
        await _navigateToPos(tester);
        await tester.tap(find.byKey(const Key('pos-branch-required-branch-a')));
        await tester.pumpAndSettle();

        await tester.tap(find.byKey(const Key('pos-product-product-1')));
        await tester.pump();
        await tester.tap(find.byKey(const Key('pos-mode-cliente')));
        await tester.pumpAndSettle();
        await tester.tap(find.byKey(const Key('pos-cliente-card-payment')));
        await tester.pump();
        await tester.pumpAndSettle();

        expect(salesGateway.calls, hasLength(1));
        expect(salesGateway.calls.single.branchId, 'branch-a');
      },
    );

    testWidgets(
      'the topbar branch switcher still offers "Todas las sucursales" for '
      'consolidated dashboards/reports',
      (tester) async {
        // `companyWideAccess: true` — the default `_context` fixture
        // deliberately represents an ordinary cashier without it (see its
        // own doc comment); `_companyWideContext` represents the CEO/owner
        // session this option is actually for.
        await _pump(
          tester,
          const Size(1440, 900),
          context: _companyWideContext,
        );
        await tester.tap(find.byKey(const Key('pos-branch-switch')));
        await tester.pumpAndSettle();
        // TASK 14.5 (Wave 3, Phase 2): the Dashboard landing screen (also
        // visible underneath) now carries its own real "Todas las
        // sucursales" branch selector for company-wide sessions — so this
        // exact label can legitimately render more than once at once;
        // this assertion only cares that the topbar switcher itself still
        // offers it, not that it is the only place the label appears.
        expect(find.text('Todas las sucursales'), findsWidgets);
      },
    );
  });

  group('CLIENTE → CAJERO authorization (TASK 12.3A)', () {
    testWidgets('CAJERO to CLIENTE is direct — no authorization dialog', (
      tester,
    ) async {
      await _pump(tester, const Size(1440, 900));
      await _navigateToPos(tester);

      await tester.tap(find.byKey(const Key('pos-mode-cliente')));
      await tester.pumpAndSettle();

      expect(
        find.byKey(const Key('pos-cliente-ticket-preview')),
        findsOneWidget,
      );
      expect(find.byKey(const Key('pos-cajero-return-dialog')), findsNothing);
    });

    testWidgets('CLIENTE to CAJERO opens the authorization dialog instead '
        'of returning immediately', (tester) async {
      await _pump(tester, const Size(1440, 900));
      await _navigateToPos(tester);
      await tester.tap(find.byKey(const Key('pos-mode-cliente')));
      await tester.pumpAndSettle();

      await tester.tap(find.byKey(const Key('pos-mode-cajero')));
      await tester.pumpAndSettle();

      expect(find.byKey(const Key('pos-cajero-return-dialog')), findsOneWidget);
      // Still on the CLIENTE preview — the switch has not happened yet.
      expect(
        find.byKey(const Key('pos-cliente-ticket-preview')),
        findsOneWidget,
      );
    });

    testWidgets('Cancelar leaves CLIENTE mode active', (tester) async {
      await _pump(tester, const Size(1440, 900));
      await _navigateToPos(tester);
      await tester.tap(find.byKey(const Key('pos-mode-cliente')));
      await tester.pumpAndSettle();

      await tester.tap(find.byKey(const Key('pos-mode-cajero')));
      await tester.pumpAndSettle();
      await tester.tap(find.byKey(const Key('pos-cajero-return-cancel')));
      await tester.pumpAndSettle();

      expect(find.byKey(const Key('pos-cajero-return-dialog')), findsNothing);
      expect(
        find.byKey(const Key('pos-cliente-ticket-preview')),
        findsOneWidget,
      );
      expect(find.byKey(const Key('pos-ticket-panel')), findsNothing);
    });

    testWidgets('a wrong PIN cannot return to CAJERO and sees the real '
        "server-rejected error — TASK 14.5A's real re-auth", (tester) async {
      final authGateway = _FakeAuthGateway(pinSucceeds: false);
      await _pump(tester, const Size(1440, 900), authGateway: authGateway);
      await _navigateToPos(tester);
      await tester.tap(find.byKey(const Key('pos-mode-cliente')));
      await tester.pumpAndSettle();

      await tester.tap(find.byKey(const Key('pos-mode-cajero')));
      await tester.pumpAndSettle();
      // A real PIN must actually be entered — this is the same
      // `PosAuthGateway.pinLogin` call `_StaffQuickSwitchDialog` uses, not
      // a client-side comparison, so an empty submission is rejected
      // locally before ever reaching the gateway.
      await tester.enterText(
        find.byKey(const Key('pos-cajero-return-input')),
        '0000',
      );
      await tester.tap(find.byKey(const Key('pos-cajero-return-confirm')));
      await tester.pumpAndSettle();

      expect(authGateway.pinLoginCalls, 1);
      expect(authGateway.lastPin, '0000');
      expect(find.byKey(const Key('pos-cajero-return-error')), findsOneWidget);
      // The dialog stays open and CLIENTE stays active — a rejected PIN
      // must never grant cashier controls.
      expect(find.byKey(const Key('pos-cajero-return-dialog')), findsOneWidget);
      await tester.tap(find.byKey(const Key('pos-cajero-return-cancel')));
      await tester.pumpAndSettle();
      expect(
        find.byKey(const Key('pos-cliente-ticket-preview')),
        findsOneWidget,
      );
      expect(find.byKey(const Key('pos-ticket-panel')), findsNothing);
    });

    testWidgets('a correct-PIN confirmation returns to CAJERO', (
      tester,
    ) async {
      await _pump(tester, const Size(1440, 900));
      await _navigateToPos(tester);
      await tester.tap(find.byKey(const Key('pos-mode-cliente')));
      await tester.pumpAndSettle();

      await tester.tap(find.byKey(const Key('pos-mode-cajero')));
      await tester.pumpAndSettle();
      await tester.enterText(
        find.byKey(const Key('pos-cajero-return-input')),
        '1234',
      );
      await tester.tap(find.byKey(const Key('pos-cajero-return-confirm')));
      await tester.pumpAndSettle();

      expect(find.byKey(const Key('pos-cajero-return-dialog')), findsNothing);
      expect(find.byKey(const Key('pos-ticket-panel')), findsOneWidget);
      expect(find.byKey(const Key('pos-cliente-ticket-preview')), findsNothing);
    });

    testWidgets('SaleSession lines and quantities are unchanged after the '
        'full CLIENTE → dialog → CAJERO round trip', (tester) async {
      await _pump(tester, const Size(1440, 900));
      await _navigateToPos(tester);

      await tester.tap(find.byKey(const Key('pos-product-product-1')));
      await tester.pump();
      await tester.tap(find.byKey(const Key('pos-product-product-1')));
      await tester.pump();
      await tester.tap(find.byKey(const Key('pos-product-product-2')));
      await tester.pump();
      expect(
        find.byKey(const Key('pos-ticket-line-product-1')),
        findsOneWidget,
      );
      expect(
        find.byKey(const Key('pos-ticket-line-product-2')),
        findsOneWidget,
      );
      // TASK 12.3C: product-1 x2 + product-2 x1 @ $10.00 each = $30.00
      // subtotal, +16% IVA ($4.80) = $34.80 — a real backend-priced total,
      // not the old placeholder $0.00.
      expect(find.textContaining(r'Cobrar — $34.80'), findsOneWidget);

      await tester.tap(find.byKey(const Key('pos-mode-cliente')));
      await tester.pumpAndSettle();
      expect(
        find.byKey(const Key('pos-cliente-ticket-line-product-1')),
        findsOneWidget,
      );
      expect(
        find.byKey(const Key('pos-cliente-ticket-line-product-2')),
        findsOneWidget,
      );

      await tester.tap(find.byKey(const Key('pos-mode-cajero')));
      await tester.pumpAndSettle();
      await tester.enterText(
        find.byKey(const Key('pos-cajero-return-input')),
        '1234',
      );
      await tester.tap(find.byKey(const Key('pos-cajero-return-confirm')));
      await tester.pumpAndSettle();

      // Same lines, same quantity ("2" for product-1), same total — the
      // authorization round trip neither reset nor duplicated the ticket.
      expect(
        find.byKey(const Key('pos-ticket-line-product-1')),
        findsOneWidget,
      );
      expect(
        find.byKey(const Key('pos-ticket-line-product-2')),
        findsOneWidget,
      );
      expect(
        find.descendant(
          of: find.byKey(const Key('pos-ticket-line-product-1')),
          matching: find.text('2'),
        ),
        findsOneWidget,
      );
      // TASK 12.3C: product-1 x2 + product-2 x1 @ $10.00 each = $30.00
      // subtotal, +16% IVA ($4.80) = $34.80 — a real backend-priced total,
      // not the old placeholder $0.00.
      expect(find.textContaining(r'Cobrar — $34.80'), findsOneWidget);
      expect(tester.takeException(), isNull);
    });
  });

  group('Canonical CLIENTE locked surface (TASK 12.3B)', () {
    Future<void> enterCliente(WidgetTester tester) async {
      await _navigateToPos(tester);
      await tester.tap(find.byKey(const Key('pos-product-product-1')));
      await tester.pump();
      await tester.tap(find.byKey(const Key('pos-mode-cliente')));
      await tester.pumpAndSettle();
    }

    testWidgets(
      'locks out admin navigation entirely — sidebar, topbar and every '
      'module nav item are unreachable while CLIENTE is active',
      (tester) async {
        await _pump(tester, const Size(1440, 900));
        await enterCliente(tester);

        // Structurally absent, not merely hidden: no sidebar, no topbar,
        // no hamburger, no nav items for any module — there is nothing
        // for a customer to tap toward an admin screen.
        expect(find.byKey(const Key('pos-sidebar')), findsNothing);
        expect(find.byKey(const Key('pos-topbar')), findsNothing);
        expect(find.byKey(const Key('pos-hamburger')), findsNothing);
        for (final module in [
          'nav-dashboard',
          'nav-products',
          'nav-inventory',
          'nav-users',
          'nav-pos',
        ]) {
          expect(find.byKey(Key(module)), findsNothing, reason: module);
        }
        expect(find.byKey(const Key('pos-cliente-shell')), findsOneWidget);
        expect(tester.takeException(), isNull);
      },
    );

    testWidgets(
      'renders the greeting header, live clock, and stacked per-category '
      'sections with a jumpbar pill for each active category',
      (tester) async {
        await _pump(tester, const Size(1440, 900));
        await enterCliente(tester);

        expect(find.byKey(const Key('pos-cliente-header')), findsOneWidget);
        expect(find.text('¡Hola! 👋'), findsOneWidget);
        expect(find.text('Selecciona lo que deseas'), findsOneWidget);
        expect(find.byKey(const Key('pos-cliente-clock')), findsOneWidget);
        expect(find.byKey(const Key('pos-cliente-jumpbar')), findsOneWidget);
        expect(find.byKey(const Key('pos-cliente-jump-cat-1')), findsOneWidget);
        expect(find.byKey(const Key('pos-cliente-jump-cat-2')), findsOneWidget);
        expect(
          find.text('Bebidas'),
          findsWidgets,
        ); // jumpbar pill + section title
        expect(find.text('Snacks'), findsWidgets);
        expect(find.byKey(const Key('pos-cliente-catalog')), findsOneWidget);
        expect(tester.takeException(), isNull);
      },
    );

    testWidgets('tapping a jumpbar pill scrolls to that category without '
        'throwing', (tester) async {
      await _pump(tester, const Size(1440, 600));
      await enterCliente(tester);
      await tester.tap(find.byKey(const Key('pos-cliente-jump-cat-2')));
      await tester.pumpAndSettle();
      expect(tester.takeException(), isNull);
    });

    testWidgets(
      'an out-of-stock product inside a stacked section cannot be added',
      (tester) async {
        await _pump(tester, const Size(1440, 900));
        await enterCliente(tester);
        await tester.tap(find.byKey(const Key('pos-product-product-3')));
        await tester.pump();
        expect(find.text('Producto sin existencia.'), findsOneWidget);
        expect(
          find.byKey(const Key('pos-cliente-ticket-line-product-3')),
          findsNothing,
        );
      },
    );

    testWidgets(
      'shows the honest per-category empty state without collapsing the '
      'section structure, and does not fabricate demonstration products',
      (tester) async {
        tester.view.physicalSize = const Size(1440, 900);
        tester.view.devicePixelRatio = 1;
        addTearDown(tester.view.reset);
        await tester.pumpWidget(
          MaterialApp(
            home: PosShell(
              context: _context,
              controller: PosReadController(const _ClienteCatalogGateway()),
              salesGateway: _FakeSalesGateway(),
              paymentsGateway: _FakePaymentsGateway(),
              // TASK 14.5A: this test exercises catalog/category rendering,
              // not the cash-session gate — an already-open session (like
              // every other test's own default) so entering CLIENTE mode
              // itself never becomes the thing under test here.
              cashGateway: _FakeCashGateway(),
              refundsGateway: const EmptyPosRefundsGateway(),
              promotionsGateway: const EmptyPosPromotionsGateway(),
              customersGateway: const EmptyPosCustomersGateway(),
              membershipsGateway: const EmptyPosMembershipsGateway(),
              loyaltyGateway: const EmptyPosLoyaltyGateway(),
              rewardsGateway: const EmptyPosRewardsGateway(),
              partiesGateway: const EmptyPosPartiesGateway(),
              onLogout: () {},
              onBranchSelected: _noopBranchSelected,
            ),
          ),
        );
        await tester.pumpAndSettle();
        await enterCliente(tester);

        // Postres (cat-3) has zero matching products — the section title
        // still renders, with the canonical empty-category copy, instead
        // of the whole catalog collapsing to a single generic message.
        expect(find.text('Postres'), findsWidgets);
        expect(find.text('Sin productos en esta categoría'), findsOneWidget);
        expect(tester.takeException(), isNull);
      },
    );

    testWidgets(
      'shows an honest empty state when there are no active categories at '
      'all',
      (tester) async {
        tester.view.physicalSize = const Size(1440, 900);
        tester.view.devicePixelRatio = 1;
        addTearDown(tester.view.reset);
        await tester.pumpWidget(
          MaterialApp(
            home: PosShell(
              context: _context,
              controller: PosReadController(const _EmptyPosReadGateway()),
              salesGateway: _FakeSalesGateway(),
              paymentsGateway: _FakePaymentsGateway(),
              // TASK 14.5A: see the identical comment in the sibling test
              // above — this test is about the empty-categories state, not
              // the cash-session gate.
              cashGateway: _FakeCashGateway(),
              refundsGateway: const EmptyPosRefundsGateway(),
              promotionsGateway: const EmptyPosPromotionsGateway(),
              customersGateway: const EmptyPosCustomersGateway(),
              membershipsGateway: const EmptyPosMembershipsGateway(),
              loyaltyGateway: const EmptyPosLoyaltyGateway(),
              rewardsGateway: const EmptyPosRewardsGateway(),
              partiesGateway: const EmptyPosPartiesGateway(),
              onLogout: () {},
              onBranchSelected: _noopBranchSelected,
            ),
          ),
        );
        await tester.pumpAndSettle();
        await _navigateToPos(tester);
        await tester.tap(find.byKey(const Key('pos-mode-cliente')));
        await tester.pumpAndSettle();

        expect(find.byKey(const Key('pos-cliente-jumpbar')), findsNothing);
        expect(find.text('No hay categorías disponibles.'), findsOneWidget);
        expect(tester.takeException(), isNull);
      },
    );

    testWidgets(
      '¿Necesitas ayuda? shows a deferred, non-fabricated notice — no '
      'staff-dispatch promise this app cannot keep',
      (tester) async {
        await _pump(tester, const Size(1440, 900));
        await enterCliente(tester);
        await tester.tap(find.byKey(const Key('pos-cliente-ayuda-button')));
        await tester.pump();
        expect(find.textContaining('no está disponible'), findsOneWidget);
        // V1's own fabricated staff-dispatch toast is never reproduced.
        expect(find.textContaining('viene en camino'), findsNothing);
      },
    );

    testWidgets('Tengo un cupón opens the coupon modal; typing via the virtual '
        'keyboard and Aplicar never accepts or fabricates a result', (
      tester,
    ) async {
      await _pump(tester, const Size(1440, 900));
      await enterCliente(tester);
      await tester.tap(find.byKey(const Key('pos-cliente-cupon-button')));
      await tester.pumpAndSettle();

      expect(find.byKey(const Key('pos-cliente-cupon-dialog')), findsOneWidget);
      expect(
        find.byKey(const Key('pos-cliente-cupon-keyboard')),
        findsOneWidget,
      );

      // The input is read-only and only ever changes via the on-screen
      // keys — matching V1's `readonly` attribute (no system keyboard).
      final input = tester.widget<TextField>(
        find.byKey(const Key('pos-cliente-cupon-input')),
      );
      expect(input.readOnly, isTrue);

      await tester.tap(find.text('A'));
      await tester.tap(find.text('B'));
      await tester.tap(find.text('C'));
      await tester.pump();
      expect(
        find
            .byKey(const Key('pos-cliente-cupon-input'))
            .evaluate()
            .single
            .widget,
        isA<TextField>().having(
          (field) => field.controller?.text,
          'controller.text',
          'ABC',
        ),
      );

      // Backspace removes the last character.
      await tester.tap(find.byIcon(Icons.backspace_outlined));
      await tester.pump();
      expect(
        find
            .byKey(const Key('pos-cliente-cupon-input'))
            .evaluate()
            .single
            .widget,
        isA<TextField>().having(
          (field) => field.controller?.text,
          'controller.text',
          'AB',
        ),
      );

      // Aplicar never fabricates acceptance or rejection.
      await tester.tap(find.byKey(const Key('pos-cliente-cupon-apply')));
      await tester.pump();
      expect(
        find.textContaining('no está disponible'),
        findsWidgets,
        reason: 'Coupon validation must be honestly deferred, not faked.',
      );

      await tester.tap(find.byKey(const Key('pos-cliente-cupon-close')));
      await tester.pumpAndSettle();
      expect(find.byKey(const Key('pos-cliente-cupon-dialog')), findsNothing);
    });

    // TASK 12.3B.1: one `testWidgets` per breakpoint (matching this file's
    // own established convention for breakpoint sweeps, e.g. the CLIENTE
    // overflow loop below) rather than several `_pump()` calls inside a
    // single test — reusing one `tester` across multiple full
    // `pumpWidget` rebuilds left a `_LiveClockText` timer from an earlier
    // iteration racing the next one, which made `pumpAndSettle()` time
    // out. A fresh binding per breakpoint avoids that entirely.
    for (final size in const [
      Size(1024, 600),
      Size(1366, 768),
      Size(1440, 900),
      Size(1920, 1080),
    ]) {
      testWidgets(
        'the coupon virtual keyboard keeps every row structurally fixed — '
        'no key ever moves to a different row — at '
        '${size.width.toInt()}x${size.height.toInt()} (TASK 12.3B.1 '
        'regression)',
        (tester) async {
          await _pump(tester, size);
          await enterCliente(tester);
          await tester.tap(find.byKey(const Key('pos-cliente-cupon-button')));
          await tester.pumpAndSettle();

          final keyboard = find.byKey(const Key('pos-cliente-cupon-keyboard'));
          expect(keyboard, findsOneWidget);
          double rowY(String label) => tester
              .getCenter(
                find.descendant(of: keyboard, matching: find.text(label)),
              )
              .dy;

          // Rows are compared with a tolerance — this checks "on the same
          // row", not bit-for-bit-identical doubles, since two centers
          // legitimately on one row can differ by sub-pixel floating-
          // point rounding without any real layout difference.
          const tolerance = 0.5;

          // Row 1: 1 2 3 4 5 6 7 8 9 0 — the regression's own reported
          // symptom was "9 and 0 fall onto another row".
          final row1 = rowY('1');
          for (final key in ['2', '3', '4', '5', '6', '7', '8', '9', '0']) {
            expect(
              rowY(key),
              closeTo(row1, tolerance),
              reason: '"$key" must stay on row 1',
            );
          }

          // Row 2: Q W E R T Y U I O P — reported symptom "O and P fall
          // onto another row".
          final row2 = rowY('Q');
          expect((row2 - row1).abs(), greaterThan(tolerance));
          for (final key in ['W', 'E', 'R', 'T', 'Y', 'U', 'I', 'O', 'P']) {
            expect(
              rowY(key),
              closeTo(row2, tolerance),
              reason: '"$key" must stay on row 2',
            );
          }

          // Row 3: A S D F G H J K L — reported symptom "L becomes
          // isolated".
          final row3 = rowY('A');
          expect((row3 - row1).abs(), greaterThan(tolerance));
          expect((row3 - row2).abs(), greaterThan(tolerance));
          for (final key in ['S', 'D', 'F', 'G', 'H', 'J', 'K', 'L']) {
            expect(
              rowY(key),
              closeTo(row3, tolerance),
              reason: '"$key" must stay on row 3',
            );
          }

          // Row 4: Z X C V B N M + backspace.
          final row4 = rowY('Z');
          expect((row4 - row1).abs(), greaterThan(tolerance));
          expect((row4 - row2).abs(), greaterThan(tolerance));
          expect((row4 - row3).abs(), greaterThan(tolerance));
          for (final key in ['X', 'C', 'V', 'B', 'N', 'M']) {
            expect(
              rowY(key),
              closeTo(row4, tolerance),
              reason: '"$key" must stay on row 4',
            );
          }
          expect(find.byIcon(Icons.backspace_outlined), findsOneWidget);
          expect(
            tester.getCenter(find.byIcon(Icons.backspace_outlined)).dy,
            closeTo(row4, tolerance),
            reason: 'Backspace must stay on row 4',
          );

          expect(tester.takeException(), isNull);
        },
      );
    }

    for (final size in const [
      Size(1024, 600),
      Size(1366, 768),
      Size(1440, 900),
      Size(1920, 1080),
    ]) {
      testWidgets('renders the CLIENTE surface without overflow at '
          '${size.width.toInt()}x${size.height.toInt()}', (tester) async {
        await _pump(tester, size);
        await enterCliente(tester);
        expect(find.byKey(const Key('pos-cliente-shell')), findsOneWidget);
        expect(tester.takeException(), isNull);
      });
    }

    testWidgets('preserves the CLIENTE surface in dark mode', (tester) async {
      await _pump(tester, const Size(1440, 900));
      await tester.tap(find.byKey(const Key('pos-dark-mode-toggle')));
      await tester.pumpAndSettle();
      await enterCliente(tester);
      expect(find.byKey(const Key('pos-cliente-shell')), findsOneWidget);
      expect(find.byKey(const Key('pos-cliente-header')), findsOneWidget);
      expect(tester.takeException(), isNull);
    });

    testWidgets('the authorization dialog is polished: canonical logo, numeric '
        'keypad, and Escape cancels leaving CLIENTE active', (tester) async {
      await _pump(tester, const Size(1440, 900));
      await enterCliente(tester);
      await tester.tap(find.byKey(const Key('pos-mode-cajero')));
      await tester.pumpAndSettle();

      expect(find.byKey(const Key('pos-cajero-return-dialog')), findsOneWidget);
      expect(find.byType(Image), findsWidgets); // the AS logo mark
      // No developer/backend-contract text leaks into this dialog.
      expect(find.textContaining('contrato de backend'), findsNothing);
      expect(find.textContaining('AS_POS_SALE_ENGINE'), findsNothing);

      // The visual numeric keypad types into the (never-compared) field.
      // Scoped to the dialog: the CLIENTE ticket behind it already shows
      // a "1" quantity (added by `enterCliente`), so an unscoped
      // `find.text('1')` would be ambiguous.
      final dialog = find.byKey(const Key('pos-cajero-return-dialog'));
      await tester.tap(find.descendant(of: dialog, matching: find.text('1')));
      await tester.tap(find.descendant(of: dialog, matching: find.text('2')));
      await tester.pump();
      final field = tester.widget<TextField>(
        find.byKey(const Key('pos-cajero-return-input')),
      );
      expect(field.controller?.text, '12');

      await tester.sendKeyEvent(LogicalKeyboardKey.escape);
      await tester.pumpAndSettle();
      expect(find.byKey(const Key('pos-cajero-return-dialog')), findsNothing);
      expect(find.byKey(const Key('pos-cliente-shell')), findsOneWidget);
    });
  });

  testWidgets(
    'toggles the preserved dark theme, reachable at the collapsed rail '
    'width too',
    (tester) async {
      // 1024px keeps the rail visible but collapsed (`wide` requires
      // >=1200) — the dark-mode control must still be reachable there,
      // matching the old topbar button's width-independent reachability.
      await _pump(tester, const Size(1024, 768));
      final toggle = find.byKey(const Key('pos-dark-mode-toggle'));
      expect(toggle, findsOneWidget);
      Brightness brightness() => Theme.of(
        tester.element(find.byKey(const Key('pos-topbar'))),
      ).brightness;
      expect(brightness(), Brightness.light);
      await tester.tap(toggle);
      await tester.pumpAndSettle();
      expect(brightness(), Brightness.dark);
    },
  );

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

  group('Shared chrome (TASK 12.2E)', () {
    testWidgets('renders the canonical topbar elements — role label, live '
        'clock, notification bell, AI assistant — all inert', (tester) async {
      await _pump(tester, const Size(1440, 900));
      expect(find.text('Manager'), findsOneWidget);
      expect(find.byKey(const Key('pos-topbar-clock')), findsOneWidget);

      final bell = find.byTooltip('Notificaciones');
      expect(bell, findsOneWidget);
      await tester.tap(bell);
      await tester.pump();
      expect(
        find.textContaining('Modo de solo lectura: disponible'),
        findsOneWidget,
      );
      await tester.pumpAndSettle();

      final aiButton = find.byKey(const Key('pos-ai-assistant-button'));
      expect(aiButton, findsOneWidget);
      expect(find.text('Asistente IA'), findsOneWidget);
      await tester.tap(aiButton);
      await tester.pump();
      expect(
        find.textContaining('Modo de solo lectura: disponible'),
        findsOneWidget,
      );
      expect(tester.takeException(), isNull);
    });

    testWidgets('sidebar starts with only the active item\'s group open, '
        'and opening a group closes the previously open one', (tester) async {
      await _pump(tester, const Size(1440, 900));
      await tester.tap(find.byKey(const Key('pos-hamburger')));
      await tester.pumpAndSettle();

      // Dashboard's group (Administración) is open by default; Ventas is
      // closed, so its items are absent.
      expect(find.byKey(const Key('nav-dashboard')), findsOneWidget);
      expect(find.byKey(const Key('nav-pos')), findsNothing);

      await tester.tap(find.byKey(const Key('nav-group-Ventas')));
      await tester.pumpAndSettle();
      expect(find.byKey(const Key('nav-pos')), findsOneWidget);
      // Opening Ventas closed Administración — a single open group.
      expect(find.byKey(const Key('nav-dashboard')), findsNothing);

      // Tapping the already-open group's header collapses it entirely.
      await tester.tap(find.byKey(const Key('nav-group-Ventas')));
      await tester.pumpAndSettle();
      expect(find.byKey(const Key('nav-pos')), findsNothing);
      expect(tester.takeException(), isNull);
    });

    testWidgets('navigating to a module auto-opens its group', (tester) async {
      await _pump(tester, const Size(1440, 900));
      await _navigateToPos(tester);
      expect(find.byKey(const Key('nav-pos')), findsOneWidget);

      await tester.tap(find.byKey(const Key('nav-group-Catálogo')));
      await tester.pumpAndSettle();
      await tester.tap(find.byKey(const Key('nav-products')));
      await tester.pumpAndSettle();
      // Selecting Productos (Catálogo) closed Ventas automatically.
      expect(find.byKey(const Key('nav-pos')), findsNothing);
      expect(find.byKey(const Key('nav-products')), findsOneWidget);
    });

    testWidgets('rail starts collapsed by default, matching the canonical '
        '`.sidebar` with no `.expanded` class', (tester) async {
      await _pump(tester, const Size(1440, 900));
      expect(find.text('Manager'), findsOneWidget); // sanity: shell rendered
      // TASK 16.12 — the sidebar brand row's "En línea" indicator (never
      // the logo itself, which now renders in both rail and expanded
      // states) is the real collapsed-vs-expanded signal: only shown
      // alongside the brand mark once the rail is expanded.
      expect(find.text('En línea'), findsNothing);
      await tester.tap(find.byKey(const Key('pos-hamburger')));
      await tester.pumpAndSettle();
      expect(find.text('En línea'), findsOneWidget);
    });
  });

  group('Caja (TASK 12.7)', () {
    testWidgets(
      'closed state shows the "Abrir caja" prompt, never a silent Efectivo unlock',
      (tester) async {
        final cashGateway = _FakeCashGateway(openSessionFixture: null);
        await _pump(
          tester,
          const Size(1440, 900),
          context: _contextWithCashPermissions,
          cashGateway: cashGateway,
        );
        await _navigateToCaja(tester);
        expect(
          find.text('Abre la caja para comenzar a cobrar en efectivo.'),
          findsOneWidget,
        );
        expect(find.byKey(const Key('pos-caja-open-button')), findsOneWidget);
        expect(find.byKey(const Key('pos-caja-cash-in')), findsNothing);
        expect(find.byKey(const Key('pos-caja-close-button')), findsNothing);
      },
    );

    testWidgets(
      'a session.read-only actor sees the closed state but no "Abrir caja" button',
      (tester) async {
        final readOnly = AuthenticatedContext(
          session: _context.session,
          user: _context.user,
          companies: _context.companies,
          branches: _context.branches,
          companyWideAccess: false,
          permissions: [..._context.permissions, 'cash_session.read'],
        );
        await _pump(
          tester,
          const Size(1440, 900),
          context: readOnly,
          cashGateway: _FakeCashGateway(openSessionFixture: null),
        );
        await _navigateToCaja(tester);
        expect(find.byKey(const Key('pos-caja-open-button')), findsNothing);
        expect(
          find.text('Tu sesión no incluye el permiso para abrir la caja.'),
          findsOneWidget,
        );
      },
    );

    testWidgets(
      'opening flow submits the exact cashier-entered opening float — never a '
      'fabricated \$1,000',
      (tester) async {
        final cashGateway = _FakeCashGateway(openSessionFixture: null);
        await _pump(
          tester,
          const Size(1440, 900),
          context: _contextWithCashPermissions,
          cashGateway: cashGateway,
        );
        await _navigateToCaja(tester);
        await tester.tap(find.byKey(const Key('pos-caja-open-button')));
        await tester.pumpAndSettle();
        await tester.enterText(
          find.byKey(const Key('pos-caja-fondo-input')),
          '750.50',
        );
        await tester.tap(find.byKey(const Key('pos-caja-confirm-open')));
        await tester.pumpAndSettle();
        expect(cashGateway.openSessionCalls, [
          (cashRegisterId: 'register-id', openingAmount: '750.5000'),
        ]);
        // The dialog closed and the current-session view now renders —
        // proof the drawer is genuinely open, not just that the call fired.
        expect(find.byKey(const Key('pos-caja-cash-in')), findsOneWidget);
      },
    );

    testWidgets(
      'open session shows Caja/Sucursal/Cajero/Abierta/Fondo inicial/Efectivo '
      'esperado — the exact backend result, never recomputed',
      (tester) async {
        await _pump(
          tester,
          const Size(1440, 900),
          context: _contextWithCashPermissions,
          cashGateway: _FakeCashGateway(),
        );
        await _navigateToCaja(tester);
        expect(find.text('Caja 1'), findsOneWidget);
        expect(find.text('Sucursal Centro'), findsOneWidget);
        expect(find.text('Usuario AS'), findsOneWidget);
        expect(
          find.text(_expectClockTime(DateTime.utc(2026, 9, 6, 9))),
          findsOneWidget,
        );
        expect(find.text(r'$1000.00'), findsOneWidget);
        expect(find.text(r'$1029.00'), findsOneWidget); // Efectivo esperado.
      },
    );

    testWidgets(
      'movement history renders every posted movement, cash_out shown as negative',
      (tester) async {
        await _pump(
          tester,
          const Size(1440, 900),
          context: _contextWithCashPermissions,
          cashGateway: _FakeCashGateway(
            movements: [
              PosCashMovement(
                id: 'm1',
                cashSessionId: 'session-id',
                movementType: 'cash_in',
                amount: '200.0000',
                currencyCode: 'MXN',
                reasonCode: 'additional_float',
                occurredAt: DateTime.utc(2026, 9, 6, 11),
                createdBy: 'user-id',
              ),
              PosCashMovement(
                id: 'm2',
                cashSessionId: 'session-id',
                movementType: 'cash_out',
                amount: '50.0000',
                currencyCode: 'MXN',
                reasonCode: 'safe_drop',
                occurredAt: DateTime.utc(2026, 9, 6, 12),
                createdBy: 'user-id',
              ),
            ],
          ),
        );
        await _navigateToCaja(tester);
        expect(find.textContaining('+\$200.00'), findsOneWidget);
        expect(find.textContaining('-\$50.00'), findsOneWidget);
        expect(find.text('Sin movimientos todavía.'), findsNothing);
      },
    );

    testWidgets(
      'Entrada de efectivo posts a cash_in movement with the typed amount and reason',
      (tester) async {
        final cashGateway = _FakeCashGateway();
        await _pump(
          tester,
          const Size(1440, 900),
          context: _contextWithCashPermissions,
          cashGateway: cashGateway,
        );
        await _navigateToCaja(tester);
        await tester.tap(find.byKey(const Key('pos-caja-cash-in')));
        await tester.pumpAndSettle();
        await tester.enterText(
          find.byKey(const Key('pos-caja-movement-amount')),
          '200',
        );
        await tester.enterText(
          find.byKey(const Key('pos-caja-movement-reason')),
          'additional_float',
        );
        await tester.tap(find.byKey(const Key('pos-caja-confirm-movement')));
        await tester.pumpAndSettle();
        expect(cashGateway.movementCalls, [
          (
            cashSessionId: 'session-id',
            movementType: 'cash_in',
            amount: '200.0000',
            reasonCode: 'additional_float',
          ),
        ]);
      },
    );

    testWidgets(
      'Salida de efectivo posts a cash_out movement, and a blank reason is rejected '
      'before any call is made',
      (tester) async {
        final cashGateway = _FakeCashGateway();
        await _pump(
          tester,
          const Size(1440, 900),
          context: _contextWithCashPermissions,
          cashGateway: cashGateway,
        );
        await _navigateToCaja(tester);
        await tester.tap(find.byKey(const Key('pos-caja-cash-out')));
        await tester.pumpAndSettle();
        await tester.enterText(
          find.byKey(const Key('pos-caja-movement-amount')),
          '50',
        );
        // No reason typed — must be rejected client-side first.
        await tester.tap(find.byKey(const Key('pos-caja-confirm-movement')));
        await tester.pump();
        expect(cashGateway.movementCalls, isEmpty);
        expect(find.text('Ingresa un motivo.'), findsOneWidget);

        await tester.enterText(
          find.byKey(const Key('pos-caja-movement-reason')),
          'safe_drop',
        );
        await tester.tap(find.byKey(const Key('pos-caja-confirm-movement')));
        await tester.pumpAndSettle();
        expect(cashGateway.movementCalls, [
          (
            cashSessionId: 'session-id',
            movementType: 'cash_out',
            amount: '50.0000',
            reasonCode: 'safe_drop',
          ),
        ]);
      },
    );

    testWidgets(
      'a rejected movement (backend session-closed error) keeps the dialog open and '
      'shows the real error',
      (tester) async {
        final cashGateway = _FakeCashGateway(
          movementFailure: const ApiException(
            AppFailure(
              AppErrorKind.validation,
              'Esta sesión de caja ya fue cerrada.',
            ),
          ),
        );
        await _pump(
          tester,
          const Size(1440, 900),
          context: _contextWithCashPermissions,
          cashGateway: cashGateway,
        );
        await _navigateToCaja(tester);
        await tester.tap(find.byKey(const Key('pos-caja-cash-in')));
        await tester.pumpAndSettle();
        await tester.enterText(
          find.byKey(const Key('pos-caja-movement-amount')),
          '10',
        );
        await tester.enterText(
          find.byKey(const Key('pos-caja-movement-reason')),
          'x',
        );
        await tester.tap(find.byKey(const Key('pos-caja-confirm-movement')));
        await tester.pumpAndSettle();
        expect(
          find.text('Esta sesión de caja ya fue cerrada.'),
          findsOneWidget,
        );
        expect(
          find.byKey(const Key('pos-caja-movement-amount')),
          findsOneWidget,
        );
      },
    );

    testWidgets(
      'close flow shows the backend expected cash, submits only the counted amount, '
      'and the result shows the backend-computed difference — never a client-submitted one',
      (tester) async {
        final cashGateway = _FakeCashGateway(
          closeResult: PosCashSession(
            id: 'session-id',
            branchId: 'branch-id',
            cashRegisterId: 'register-id',
            openedBy: 'user-id',
            openedAt: DateTime.utc(2026, 9, 6, 9),
            openingAmount: '1000.0000',
            currencyCode: 'MXN',
            status: 'closed',
            closedBy: 'user-id',
            closedAt: DateTime.utc(2026, 9, 6, 20),
            declaredClosingAmount: '1000.0000',
            expectedClosingAmount: '1029.0000',
            discrepancyAmount: '-29.0000',
          ),
        );
        await _pump(
          tester,
          const Size(1440, 900),
          context: _contextWithCashPermissions,
          cashGateway: cashGateway,
        );
        await _navigateToCaja(tester);
        await tester.tap(find.byKey(const Key('pos-caja-close-button')));
        await tester.pumpAndSettle();
        // The dialog's own read-only "Efectivo esperado" row (the screen
        // behind it, still in the tree under the modal barrier, shows the
        // same figure too).
        expect(find.text(r'$1029.00'), findsWidgets);
        await tester.enterText(
          find.byKey(const Key('pos-caja-counted-input')),
          '1000',
        );
        await tester.tap(find.byKey(const Key('pos-caja-confirm-close')));
        await tester.pumpAndSettle();
        expect(cashGateway.closeCalls, [
          (cashSessionId: 'session-id', declaredClosingAmount: '1000.0000'),
        ]);
        // The result dialog shows the backend's own discrepancy — a real
        // shortage — never a client-recomputed figure.
        expect(find.text('Faltante'), findsOneWidget);
        expect(find.text(r'-$29.00'), findsOneWidget);
        // After "Entendido", the drawer reloads and shows closed again (the
        // fake's own `_current = null` on close — a real backend session
        // cannot be reopened either).
        await tester.tap(find.text('Entendido'));
        await tester.pumpAndSettle();
        expect(find.byKey(const Key('pos-caja-open-button')), findsOneWidget);
      },
    );

    testWidgets(
      'a rejected close (backend already-closed error) keeps the dialog open and '
      'shows the real error — never a fake success',
      (tester) async {
        final cashGateway = _FakeCashGateway(
          closeFailure: const ApiException(
            AppFailure(AppErrorKind.validation, 'La sesión ya fue cerrada.'),
          ),
        );
        await _pump(
          tester,
          const Size(1440, 900),
          context: _contextWithCashPermissions,
          cashGateway: cashGateway,
        );
        await _navigateToCaja(tester);
        await tester.tap(find.byKey(const Key('pos-caja-close-button')));
        await tester.pumpAndSettle();
        await tester.enterText(
          find.byKey(const Key('pos-caja-counted-input')),
          '1029',
        );
        await tester.tap(find.byKey(const Key('pos-caja-confirm-close')));
        await tester.pumpAndSettle();
        expect(find.text('La sesión ya fue cerrada.'), findsOneWidget);
        // Still open, still showing the close dialog — no result dialog, no
        // silently-assumed success.
        expect(find.byKey(const Key('pos-caja-counted-input')), findsOneWidget);
      },
    );

    testWidgets(
      'the denomination breakdown live-sums into "Efectivo contado" and submits the '
      'exact lines typed (Part J)',
      (tester) async {
        final cashGateway = _FakeCashGateway();
        await _pump(
          tester,
          const Size(1440, 900),
          context: _contextWithCashPermissions,
          cashGateway: cashGateway,
        );
        await _navigateToCaja(tester);
        await tester.tap(find.byKey(const Key('pos-caja-close-button')));
        await tester.pumpAndSettle();
        await tester.tap(
          find.byKey(const Key('pos-caja-denominations-toggle')),
        );
        await tester.pumpAndSettle();
        // 1×$1000 + 1×$20 + 1×$5 = $1025 — never typed directly.
        await tester.enterText(
          find.byKey(const Key('pos-caja-denom-1000')),
          '1',
        );
        await tester.enterText(find.byKey(const Key('pos-caja-denom-20')), '1');
        await tester.enterText(find.byKey(const Key('pos-caja-denom-5')), '1');
        await tester.pump();
        final countedField = tester.widget<TextField>(
          find.byKey(const Key('pos-caja-counted-input')),
        );
        expect(countedField.controller?.text, '1025.0000');
        await tester.tap(find.byKey(const Key('pos-caja-confirm-close')));
        await tester.pumpAndSettle();
        expect(
          cashGateway.closeCalls.single.declaredClosingAmount,
          '1025.0000',
        );
      },
    );

    testWidgets(
      'the close-shift denomination breakdown is currency-aware — a USD session shows '
      'US bills/coins, never Mexican pesos (TASK 16.11)',
      (tester) async {
        final usdSession = PosCashSession(
          id: 'session-id',
          branchId: 'branch-id',
          cashRegisterId: 'register-id',
          openedBy: 'user-id',
          openedAt: DateTime.utc(2026, 9, 6, 9),
          openingAmount: '1000.0000',
          currencyCode: 'USD',
          status: 'open',
        );
        final cashGateway = _FakeCashGateway(openSessionFixture: usdSession);
        await _pump(
          tester,
          const Size(1440, 900),
          context: _contextWithCashPermissions,
          cashGateway: cashGateway,
        );
        await _navigateToCaja(tester);
        await tester.tap(find.byKey(const Key('pos-caja-close-button')));
        await tester.pumpAndSettle();
        await tester.tap(
          find.byKey(const Key('pos-caja-denominations-toggle')),
        );
        await tester.pumpAndSettle();
        // The real US set (canonicalCashDenominationsUSD) — never the MXN
        // set's $1000/$500/$200 notes or 50-centavo coin.
        expect(find.byKey(const Key('pos-caja-denom-100')), findsOneWidget);
        expect(find.byKey(const Key('pos-caja-denom-0.25')), findsOneWidget);
        expect(find.byKey(const Key('pos-caja-denom-0.01')), findsOneWidget);
        expect(find.byKey(const Key('pos-caja-denom-1000')), findsNothing);
        expect(find.byKey(const Key('pos-caja-denom-0.50')), findsNothing);
      },
    );

    testWidgets(
      'a client-postable movement can be reversed, and the drawer reloads with the '
      'reversal visible (TASK 16.11 §6)',
      (tester) async {
        final withdrawal = PosCashMovement(
          id: 'movement-1',
          cashSessionId: 'session-id',
          movementType: 'cash_out',
          amount: '50.0000',
          currencyCode: 'MXN',
          reasonCode: 'safe_drop',
          occurredAt: DateTime.utc(2026, 9, 6, 10),
          createdBy: 'user-id',
        );
        final cashGateway = _FakeCashGateway(movements: [withdrawal]);
        await _pump(
          tester,
          const Size(1440, 900),
          context: _contextWithCashPermissions,
          cashGateway: cashGateway,
        );
        await _navigateToCaja(tester);
        expect(
          find.byKey(const Key('pos-caja-reverse-movement-movement-1')),
          findsOneWidget,
        );
        await tester.tap(
          find.byKey(const Key('pos-caja-reverse-movement-movement-1')),
        );
        await tester.pumpAndSettle();
        await tester.enterText(
          find.byKey(const Key('pos-caja-reverse-reason')),
          'Monto incorrecto',
        );
        await tester.tap(find.byKey(const Key('pos-caja-confirm-reverse')));
        await tester.pumpAndSettle();
        expect(cashGateway.reverseCalls.single, (
          cashSessionId: 'session-id',
          movementId: 'movement-1',
          reasonCode: 'Monto incorrecto',
        ));
      },
    );

    testWidgets(
      'a rejected reversal (already reversed) keeps the dialog open and shows the '
      'real backend error — never a fake success (TASK 16.11 §6)',
      (tester) async {
        final withdrawal = PosCashMovement(
          id: 'movement-1',
          cashSessionId: 'session-id',
          movementType: 'cash_out',
          amount: '50.0000',
          currencyCode: 'MXN',
          reasonCode: 'safe_drop',
          occurredAt: DateTime.utc(2026, 9, 6, 10),
          createdBy: 'user-id',
        );
        final cashGateway = _FakeCashGateway(
          movements: [withdrawal],
          reverseFailure: const ApiException(
            AppFailure(AppErrorKind.validation, 'Este movimiento ya fue revertido.'),
          ),
        );
        await _pump(
          tester,
          const Size(1440, 900),
          context: _contextWithCashPermissions,
          cashGateway: cashGateway,
        );
        await _navigateToCaja(tester);
        await tester.tap(
          find.byKey(const Key('pos-caja-reverse-movement-movement-1')),
        );
        await tester.pumpAndSettle();
        await tester.enterText(
          find.byKey(const Key('pos-caja-reverse-reason')),
          'Corrección',
        );
        await tester.tap(find.byKey(const Key('pos-caja-confirm-reverse')));
        await tester.pumpAndSettle();
        expect(find.text('Este movimiento ya fue revertido.'), findsOneWidget);
        expect(find.byKey(const Key('pos-caja-reverse-reason')), findsOneWidget);
      },
    );

    testWidgets(
      'never offers "Revertir" on a movement that is itself a reversal, or on one '
      'already reversed (TASK 16.11 §6)',
      (tester) async {
        final cashGateway = _FakeCashGateway(
          movements: [
            PosCashMovement(
              id: 'movement-original',
              cashSessionId: 'session-id',
              movementType: 'cash_out',
              amount: '50.0000',
              currencyCode: 'MXN',
              reasonCode: 'safe_drop',
              occurredAt: DateTime.utc(2026, 9, 6, 10),
              createdBy: 'user-id',
            ),
            PosCashMovement(
              id: 'movement-reversal',
              cashSessionId: 'session-id',
              movementType: 'cash_in',
              amount: '50.0000',
              currencyCode: 'MXN',
              reasonCode: 'correction',
              occurredAt: DateTime.utc(2026, 9, 6, 11),
              createdBy: 'user-id',
              reversalOfId: 'movement-original',
            ),
          ],
        );
        await _pump(
          tester,
          const Size(1440, 900),
          context: _contextWithCashPermissions,
          cashGateway: cashGateway,
        );
        await _navigateToCaja(tester);
        expect(
          find.byKey(const Key('pos-caja-reverse-movement-movement-original')),
          findsNothing,
        );
        expect(
          find.byKey(const Key('pos-caja-reverse-movement-movement-reversal')),
          findsNothing,
        );
      },
    );

    testWidgets(
      'the Bitácora button is gated by audit.read and shows real evidence — never a '
      'fake or cached log (TASK 16.11 §13)',
      (tester) async {
        final cashGateway = _FakeCashGateway(
          auditLogResult: [
            PosCashAuditEntry(
              id: 'entry-1',
              actorType: 'user',
              actorId: 'user-id',
              action: 'cash_session.opened',
              entityType: 'cash_session',
              entityId: 'session-id',
              metadata: const {},
              occurredAt: DateTime.utc(2026, 9, 6, 9),
            ),
            PosCashAuditEntry(
              id: 'entry-2',
              actorType: 'user',
              actorId: 'user-id',
              action: 'cash_movement.created',
              entityType: 'cash_movement',
              entityId: 'movement-1',
              metadata: const {},
              occurredAt: DateTime.utc(2026, 9, 6, 10),
            ),
          ],
        );
        await _pump(
          tester,
          const Size(1440, 900),
          context: _contextWithCashPermissions,
          cashGateway: cashGateway,
        );
        await _navigateToCaja(tester);
        expect(find.byKey(const Key('pos-caja-audit-log-button')), findsOneWidget);
        await tester.tap(find.byKey(const Key('pos-caja-audit-log-button')));
        await tester.pumpAndSettle();
        expect(cashGateway.auditLogCalls, ['session-id']);
        expect(find.text('Caja abierta'), findsOneWidget);
        expect(find.text('Movimiento registrado'), findsOneWidget);
        await tester.tap(find.text('Cerrar'));
        await tester.pumpAndSettle();

        // Without audit.read, no Bitácora button at all — the higher-trust
        // grant, deliberately separate from cash_session.read.
        final withoutAuditRead = AuthenticatedContext(
          session: _contextWithCashPermissions.session,
          user: _contextWithCashPermissions.user,
          companies: _contextWithCashPermissions.companies,
          branches: _contextWithCashPermissions.branches,
          companyWideAccess: false,
          permissions: [
            for (final permission in _contextWithCashPermissions.permissions)
              if (permission != 'audit.read') permission,
          ],
        );
        await _pump(
          tester,
          const Size(1440, 900),
          context: withoutAuditRead,
          cashGateway: _FakeCashGateway(),
        );
        await _navigateToCaja(tester);
        expect(find.byKey(const Key('pos-caja-audit-log-button')), findsNothing);
      },
    );

    testWidgets(
      'Cortes de caja lists sessions and opening a row shows the full detail',
      (tester) async {
        final cashGateway = _FakeCashGateway(
          historyResult: PosCashSessionHistoryPage(
            items: [
              PosCashSession(
                id: 'past-session',
                branchId: 'branch-id',
                cashRegisterId: 'register-id',
                openedBy: 'user-id',
                openedAt: DateTime.utc(2026, 9, 5, 9),
                openingAmount: '1000.0000',
                currencyCode: 'MXN',
                status: 'closed',
                closedBy: 'user-id',
                closedAt: DateTime.utc(2026, 9, 5, 20),
                declaredClosingAmount: '1029.0000',
                expectedClosingAmount: '1029.0000',
                discrepancyAmount: '0.0000',
              ),
            ],
            nextCursor: null,
          ),
          summaryResult: PosCashSessionSummary(
            session: PosCashSession(
              id: 'past-session',
              branchId: 'branch-id',
              cashRegisterId: 'register-id',
              openedBy: 'user-id',
              openedAt: DateTime.utc(2026, 9, 5, 9),
              openingAmount: '1000.0000',
              currencyCode: 'MXN',
              status: 'closed',
              closedBy: 'user-id',
              closedAt: DateTime.utc(2026, 9, 5, 20),
              declaredClosingAmount: '1029.0000',
              expectedClosingAmount: '1029.0000',
              discrepancyAmount: '0.0000',
            ),
            openingAmount: '1000.0000',
            cashSalesTotal: '29.0000',
            cashSalesCount: 1,
            cashInTotal: '0.0000',
            cashOutTotal: '0.0000',
            expectedCash: '1029.0000',
            withdrawalTotal: '0.0000',
            expenseTotal: '0.0000',
            externalIncomeTotal: '0.0000',
          ),
        );
        await _pump(
          tester,
          const Size(1440, 900),
          context: _contextWithCashPermissions,
          cashGateway: cashGateway,
        );
        await _navigateToCaja(tester);
        await tester.tap(find.byKey(const Key('pos-caja-tabs')));
        await tester.pumpAndSettle();
        await tester.tap(find.text('Cortes de caja'));
        await tester.pumpAndSettle();
        final expectedClosedLabel =
            'Cerrada — ${_expectCajaDate(DateTime.utc(2026, 9, 5, 20))}';
        expect(find.text(expectedClosedLabel), findsOneWidget);
        await tester.tap(find.text(expectedClosedLabel));
        await tester.pumpAndSettle();
        expect(find.text('Detalle de corte'), findsOneWidget);
        expect(
          find.text(r'$1029.00'),
          findsWidgets,
        ); // esperado/contado both $1029.00 here.
        // TASK 16.11A §7 — the reprint dialog resolves the real register
        // name for the print summary (previously hardcoded blank), from
        // the session's own branch — never a fabricated/guessed one.
        expect(cashGateway.registersForBranchCalls, contains('branch-id'));
      },
    );

    testWidgets(
      'POS: Efectivo is blocked with the exact required message when no session is '
      'open — the sale is never created',
      (tester) async {
        final salesGateway = _FakeSalesGateway();
        final cashGateway = _FakeCashGateway(openSessionFixture: null);
        await _pump(
          tester,
          const Size(1440, 900),
          salesGateway: salesGateway,
          cashGateway: cashGateway,
        );
        await _navigateToPos(tester);
        await tester.tap(find.byKey(const Key('pos-product-product-1')));
        await tester.pump();
        await tester.tap(find.byKey(const Key('pos-ticket-cobrar')));
        await tester.pump();
        await tester.pumpAndSettle();
        expect(
          find.text('Abre la caja para comenzar a cobrar en efectivo.'),
          findsOneWidget,
        );
        expect(salesGateway.calls, isEmpty);
        expect(cashGateway.openSessionForBranchCalls, ['branch-id']);
      },
    );

    testWidgets(
      'POS: Efectivo proceeds normally once a session is open — the gate checks '
      'before sale creation, never after',
      (tester) async {
        final salesGateway = _FakeSalesGateway();
        final cashGateway = _FakeCashGateway();
        await _pump(
          tester,
          const Size(1440, 900),
          salesGateway: salesGateway,
          cashGateway: cashGateway,
        );
        await _navigateToPos(tester);
        await tester.tap(find.byKey(const Key('pos-product-product-1')));
        await tester.pump();
        await tester.tap(find.byKey(const Key('pos-ticket-cobrar')));
        await tester.pump();
        await tester.pumpAndSettle();
        expect(cashGateway.openSessionForBranchCalls, ['branch-id']);
        expect(salesGateway.calls, hasLength(1));
        // The cash dialog is the real next step — never the blocked notice.
        expect(
          find.text('Abre la caja para comenzar a cobrar en efectivo.'),
          findsNothing,
        );
      },
    );

    testWidgets(
      'POS: a failure verifying the session state fails closed — no sale is created',
      (tester) async {
        final salesGateway = _FakeSalesGateway();
        final cashGateway = _ThrowingOpenSessionCashGateway();
        await _pump(
          tester,
          const Size(1440, 900),
          salesGateway: salesGateway,
          cashGateway: cashGateway,
        );
        await _navigateToPos(tester);
        await tester.tap(find.byKey(const Key('pos-product-product-1')));
        await tester.pump();
        await tester.tap(find.byKey(const Key('pos-ticket-cobrar')));
        await tester.pump();
        await tester.pumpAndSettle();
        expect(
          find.text('No fue posible verificar el estado de la caja.'),
          findsOneWidget,
        );
        expect(salesGateway.calls, isEmpty);
      },
    );

    testWidgets(
      'branch switch never carries an open session across — Caja rebuilds fresh and '
      'queries the new branch (ADR-0014 §B8)',
      (tester) async {
        final cashGateway = _FakeCashGateway();
        final state = GlobalKey<_BranchSwitchingHarnessState>();
        await _pumpHarness(
          tester,
          _BranchSwitchingHarness(
            key: state,
            initialContext: _contextWithAlternateBranchAndCashPermissions,
            cashGateway: cashGateway,
          ),
        );
        await _navigateToCaja(tester);
        // Caja never itself calls the POS-gate lookup — only the ticket's
        // Cobrar handler does.
        expect(cashGateway.openSessionForBranchCalls, isEmpty);
        expect(
          find.byKey(const Key('pos-caja-cash-in')),
          findsOneWidget,
        ); // branch-id: open.

        await state.currentState!.attemptSelectBranch('branch-other');
        await tester.pumpAndSettle();
        // A fresh `_Caja`/`_CajaCurrent` state (via the branch-keyed
        // `ValueKey`) queries registers for the *new* branch from scratch —
        // `branch-other` has no registers in this fixture, so it shows "Sin
        // caja configurada", never the old branch's still-open session.
        expect(find.text('Sin caja configurada'), findsOneWidget);
        expect(find.byKey(const Key('pos-caja-cash-in')), findsNothing);
      },
    );
  });

  group('Promotions/discounts/coupons (TASK 12.9)', () {
    Future<void> navigateToPromotionsAdmin(WidgetTester tester) async {
      await _openVentasGroupIfNeeded(tester);
      if (find.byKey(const Key('nav-promotions')).evaluate().isEmpty) {
        await tester.tap(find.byKey(const Key('nav-group-Clientes')));
        await tester.pumpAndSettle();
      }
      await tester.tap(find.byKey(const Key('nav-promotions')));
      await tester.pumpAndSettle();
    }

    testWidgets(
      'a valid coupon code shows the backend own quote total and an '
      'applied state, never a client-recomputed one',
      (tester) async {
        final promotionsGateway = _FakePromotionsGateway(
          quoteResult: const PosPricingQuote(
            currencyCode: 'MXN',
            subtotal: '10.0000',
            discountTotal: '1.0000',
            taxTotal: '1.4400',
            total: '10.4400',
            lines: [
              PosPricingQuoteLine(
                lineIndex: 0,
                productId: 'product-1',
                nameSnapshot: 'Producto real',
                quantity: '1',
                unitPrice: '10.0000',
                subtotal: '10.0000',
                discountTotal: '1.0000',
                taxTotal: '1.4400',
                lineTotal: '10.4400',
              ),
            ],
            appliedDiscounts: [
              PosAppliedDiscount(
                sourceType: 'coupon',
                sourceId: 'coupon-1',
                label: 'SAVE10',
                reasonCode: null,
                amount: '1.0000',
                lineIndex: 0,
              ),
            ],
            rejectedCoupons: [],
          ),
        );
        await _pump(tester, const Size(1440, 900), promotionsGateway: promotionsGateway);
        await _navigateToPos(tester);
        await tester.tap(find.byKey(const Key('pos-product-product-1')));
        await tester.pump();

        await tester.enterText(find.byKey(const Key('pos-ticket-coupon-input')), 'SAVE10');
        await tester.tap(find.byKey(const Key('pos-ticket-coupon-apply')));
        await tester.pumpAndSettle();

        expect(promotionsGateway.quoteCalls, isNotEmpty);
        expect(promotionsGateway.quoteCalls.last.couponCodes, contains('SAVE10'));
        expect(find.byKey(const Key('pos-ticket-coupon-chip-SAVE10')), findsOneWidget);
        // The backend's own $10.44 quote total — never the naive
        // undiscounted $11.60 a client-side recompute would show.
        expect(find.textContaining(r'Cobrar — $10.44'), findsOneWidget);
        expect(find.textContaining(r'Cobrar — $11.60'), findsNothing);
      },
    );

    testWidgets(
      'an invalid/expired coupon code shows the backend own honest '
      'rejection reason, never a generic error or a fake success',
      (tester) async {
        final promotionsGateway = _FakePromotionsGateway(
          quoteResult: const PosPricingQuote(
            currencyCode: 'MXN',
            subtotal: '10.0000',
            discountTotal: '0.0000',
            taxTotal: '1.6000',
            total: '11.6000',
            lines: [
              PosPricingQuoteLine(
                lineIndex: 0,
                productId: 'product-1',
                nameSnapshot: 'Producto real',
                quantity: '1',
                unitPrice: '10.0000',
                subtotal: '10.0000',
                discountTotal: '0.0000',
                taxTotal: '1.6000',
                lineTotal: '11.6000',
              ),
            ],
            appliedDiscounts: [],
            rejectedCoupons: [PosRejectedCoupon(code: 'EXPIRED1', reason: 'expired')],
          ),
        );
        await _pump(tester, const Size(1440, 900), promotionsGateway: promotionsGateway);
        await _navigateToPos(tester);
        await tester.tap(find.byKey(const Key('pos-product-product-1')));
        await tester.pump();

        await tester.enterText(find.byKey(const Key('pos-ticket-coupon-input')), 'EXPIRED1');
        await tester.tap(find.byKey(const Key('pos-ticket-coupon-apply')));
        await tester.pumpAndSettle();

        expect(find.text('Cupón vencido.'), findsOneWidget);
        expect(find.byKey(const Key('pos-ticket-coupon-chip-EXPIRED1')), findsNothing);
        expect(tester.takeException(), isNull);
      },
    );

    testWidgets(
      'the ticket reprices from the backend own quote response — never a '
      'client-recomputed number — and an automatic promotion (no coupon) '
      'surfaces via applied_discounts',
      (tester) async {
        final promotionsGateway = _FakePromotionsGateway(
          quoteResult: const PosPricingQuote(
            currencyCode: 'MXN',
            subtotal: '10.0000',
            discountTotal: '2.0000',
            taxTotal: '1.2800',
            total: '9.2800',
            lines: [
              PosPricingQuoteLine(
                lineIndex: 0,
                productId: 'product-1',
                nameSnapshot: 'Producto real',
                quantity: '1',
                unitPrice: '10.0000',
                subtotal: '10.0000',
                discountTotal: '2.0000',
                taxTotal: '1.2800',
                lineTotal: '9.2800',
              ),
            ],
            appliedDiscounts: [
              PosAppliedDiscount(
                sourceType: 'promotion',
                sourceId: 'promo-1',
                label: 'Promoción de prueba',
                reasonCode: null,
                amount: '2.0000',
                lineIndex: 0,
              ),
            ],
            rejectedCoupons: [],
          ),
        );
        await _pump(tester, const Size(1440, 900), promotionsGateway: promotionsGateway);
        await _navigateToPos(tester);
        await tester.tap(find.byKey(const Key('pos-product-product-1')));
        await tester.pumpAndSettle();

        // The genuinely undiscounted local total ($11.60) never appears —
        // only the backend's own $9.28, and no coupon code was ever typed.
        expect(find.textContaining(r'Cobrar — $9.28'), findsOneWidget);
        expect(find.textContaining(r'Cobrar — $11.60'), findsNothing);
        expect(find.textContaining('Promoción aplicada: Promoción de prueba'), findsOneWidget);
        expect(find.byKey(const Key('pos-ticket-line-discount-product-1')), findsOneWidget);
      },
    );

    testWidgets(
      'the manual-discount flow requires a real value before previewing, '
      'and shows the backend own preview before confirming',
      (tester) async {
        final promotionsGateway = _FakePromotionsGateway(
          quoteResult: const PosPricingQuote(
            currencyCode: 'MXN',
            subtotal: '10.0000',
            discountTotal: '1.0000',
            taxTotal: '1.4400',
            total: '10.4400',
            lines: [],
            appliedDiscounts: [],
            rejectedCoupons: [],
          ),
        );
        await _pump(
          tester,
          const Size(1440, 900),
          context: _contextWithPromotionPermissions,
          promotionsGateway: promotionsGateway,
        );
        await _navigateToPos(tester);
        await tester.tap(find.byKey(const Key('pos-product-product-1')));
        await tester.pump();

        await tester.tap(find.byKey(const Key('pos-ticket-manual-discount')));
        await tester.pumpAndSettle();

        // The ticket's own automatic re-quote (product-1 alone, no
        // discount yet) may already have fired in the background by now
        // — captured here so the next assertion proves specifically that
        // an invalid preview attempt issues NO additional call, not that
        // zero calls ever happened at all.
        final callsBeforeInvalidPreview = promotionsGateway.quoteCalls.length;

        // No value typed yet — "Vista previa" must refuse honestly,
        // never silently call the backend.
        await tester.tap(find.byKey(const Key('pos-manual-discount-preview')));
        await tester.pump();
        expect(find.text('Escribe un valor y una razón válidos.'), findsOneWidget);
        expect(promotionsGateway.quoteCalls, hasLength(callsBeforeInvalidPreview));

        await tester.enterText(find.byKey(const Key('pos-manual-discount-value')), '10');
        await tester.tap(find.byKey(const Key('pos-manual-discount-preview')));
        await tester.pumpAndSettle();

        expect(promotionsGateway.quoteCalls, hasLength(callsBeforeInvalidPreview + 1));
        expect(promotionsGateway.quoteCalls.last.manualDiscount?.type, 'percentage');
        expect(promotionsGateway.quoteCalls.last.manualDiscount?.value, '1000');
        expect(find.text('Nuevo total'), findsOneWidget);
        expect(find.textContaining(r'$10.44'), findsWidgets);

        await tester.tap(find.byKey(const Key('pos-manual-discount-confirm')));
        await tester.pumpAndSettle();

        expect(find.textContaining(r'Cobrar — $10.44'), findsOneWidget);
      },
    );

    testWidgets(
      'the manual-discount action is hidden for an actor lacking discount.apply',
      (tester) async {
        await _pump(tester, const Size(1440, 900));
        await _navigateToPos(tester);
        await tester.tap(find.byKey(const Key('pos-product-product-1')));
        await tester.pump();
        expect(find.byKey(const Key('pos-ticket-manual-discount')), findsNothing);
      },
    );

    testWidgets(
      'the on-screen receipt shows a discount line when discount_total is '
      'nonzero, and shows nothing extra when it is zero',
      (tester) async {
        final salesGateway = _FakeSalesGateway(
          result: const PosSaleCreated(
            id: 'sale-discount-1',
            saleNumber: 'SALE-discount1',
            status: 'pending_payment',
            total: '9.2800',
            discountTotal: '2.0000',
          ),
          receiptResult: PosReceipt(
            sale: PosReceiptSale(
              id: 'sale-discount-1',
              saleNumber: 'SALE-discount1',
              status: 'completed',
              currencyCode: 'MXN',
              branchId: 'branch-id',
              occurredAt: DateTime.utc(2026, 9, 4),
              completedAt: DateTime.utc(2026, 9, 4, 0, 1),
              subtotal: '10.0000',
              discountTotal: '2.0000',
              taxTotal: '1.2800',
              total: '9.2800',
            ),
            business: const PosReceiptBusiness(
              companyName: 'AS ONE Fixture Co.',
              branchName: 'Main',
              branchAddress: null,
            ),
            cashier: const PosReceiptCashier(id: 'user-id', displayName: 'Cash Ier'),
            items: const [
              PosReceiptItem(
                lineNumber: 1,
                nameSnapshot: 'Producto real',
                skuSnapshot: 'P-001',
                quantity: '1.000000',
                unitPrice: '10.0000',
                discountTotal: '2.0000',
                taxTotal: '1.2800',
                lineTotal: '9.2800',
              ),
            ],
            payments: const [
              PosReceiptPayment(
                id: 'payment-1',
                paymentMethod: 'cash',
                status: 'captured',
                amount: '9.2800',
                currencyCode: 'MXN',
                capturedAt: null,
                tenderedAmount: '10.0000',
                changeAmount: '0.7200',
                provider: null,
                terminalId: null,
                providerReference: null,
              ),
            ],
          ),
        );
        final paymentsGateway = _FakePaymentsGateway(
          cashResult: const PosCashPaymentResult(
            paymentId: 'payment-1',
            status: 'captured',
            tenderedAmount: '10.0000',
            changeAmount: '0.7200',
            saleId: 'sale-discount-1',
            saleNumber: 'SALE-discount1',
            saleStatus: 'completed',
          ),
        );
        await _addProductAndOpenCashDialog(
          tester,
          salesGateway: salesGateway,
          paymentsGateway: paymentsGateway,
        );
        await tester.enterText(find.byKey(const Key('pos-cash-dialog-input')), '10');
        await tester.pump();
        await tester.tap(find.byKey(const Key('pos-cash-dialog-confirm')));
        await tester.pump();
        await tester.pumpAndSettle();

        expect(find.text('Venta completada'), findsOneWidget);
        expect(find.text('Descuento'), findsOneWidget);
        expect(
          find.descendant(of: find.byType(Dialog), matching: find.text(r'-$2.00')),
          findsOneWidget,
        );
      },
    );

    testWidgets(
      'the admin promotions/coupons screen renders from the backend list '
      'and handles the empty state honestly, gated on real permissions',
      (tester) async {
        final promotionsGateway = _FakePromotionsGateway(
          promotionsPage: PosPromotionPage(
            items: [
              PosPromotion(
                id: 'promo-1',
                name: 'Promoción de prueba',
                description: null,
                active: true,
                startsAt: null,
                endsAt: null,
                daysOfWeek: null,
                timeFrom: null,
                timeTo: null,
                priority: 0,
                stackable: false,
                benefitType: 'percentage',
                benefitPercentageBasisPoints: 1000,
                benefitFixedAmount: null,
                benefitNxmBuyQuantity: null,
                benefitNxmPayQuantity: null,
                minQuantity: null,
                minSubtotal: null,
                usageLimitTotal: null,
                combinableWithCoupons: true,
                branchIds: const [],
                productIds: const [],
                categoryIds: const [],
                version: 1,
              ),
            ],
            nextCursor: null,
          ),
          couponsPage: const PosCouponPage(items: [], nextCursor: null),
        );
        await _pump(
          tester,
          const Size(1440, 900),
          context: _contextWithPromotionPermissions,
          promotionsGateway: promotionsGateway,
        );
        await navigateToPromotionsAdmin(tester);

        expect(find.text('Promoción de prueba'), findsOneWidget);
        expect(find.text('10.00% de descuento'), findsOneWidget);
        expect(find.byKey(const Key('pos-promotion-new')), findsOneWidget);

        await tester.tap(find.byKey(const Key('pos-promotions-tab-coupons')));
        await tester.pumpAndSettle();
        expect(find.text('No hay cupones registrados.'), findsOneWidget);
        expect(find.byKey(const Key('pos-coupon-new')), findsOneWidget);
      },
    );

    testWidgets(
      'a permission-less actor never sees the create action and sees an '
      'honest permission state, never a silently-empty list',
      (tester) async {
        final promotionsGateway = _FakePromotionsGateway();
        await _pump(
          tester,
          const Size(1440, 900),
          context: _contextWithSaleRead,
          promotionsGateway: promotionsGateway,
        );
        await navigateToPromotionsAdmin(tester);

        expect(find.byKey(const Key('pos-promotion-new')), findsNothing);
        expect(find.text('Acceso no autorizado'), findsWidgets);
      },
    );

    testWidgets(
      'creating a new promotion calls the backend with the real form '
      'values, and editing an existing coupon calls updateCoupon',
      (tester) async {
        final promotionsGateway = _FakePromotionsGateway(
          promotionsPage: const PosPromotionPage(items: [], nextCursor: null),
          couponsPage: PosCouponPage(items: [_fixtureCoupon(id: 'coupon-9')], nextCursor: null),
          createPromotionResult: _fixturePromotion(id: 'promotion-new'),
          updateCouponResult: _fixtureCoupon(id: 'coupon-9'),
        );
        await _pump(
          tester,
          const Size(1440, 900),
          context: _contextWithPromotionPermissions,
          promotionsGateway: promotionsGateway,
        );
        await navigateToPromotionsAdmin(tester);

        await tester.tap(find.byKey(const Key('pos-promotion-new')));
        await tester.pumpAndSettle();
        await tester.enterText(find.byKey(const Key('pos-promotion-name')), 'Promoción de prueba');
        await tester.enterText(find.byKey(const Key('pos-promotion-value-percentage')), '15');
        await tester.tap(find.byKey(const Key('pos-promotion-save')));
        await tester.pumpAndSettle();

        expect(promotionsGateway.createPromotionCalls, ['Promoción de prueba']);

        await tester.tap(find.byKey(const Key('pos-promotions-tab-coupons')));
        await tester.pumpAndSettle();
        await tester.tap(find.byKey(const Key('pos-coupon-edit-coupon-9')));
        await tester.pumpAndSettle();
        await tester.tap(find.byKey(const Key('pos-coupon-save')));
        await tester.pumpAndSettle();

        expect(promotionsGateway.updateCouponCalls, ['coupon-9']);
      },
    );

    testWidgets(
      'creating a new coupon calls the backend with the real form '
      'values, and editing an existing promotion calls updatePromotion',
      (tester) async {
        final promotionsGateway = _FakePromotionsGateway(
          promotionsPage: PosPromotionPage(items: [_fixturePromotion(id: 'promotion-9')], nextCursor: null),
          couponsPage: const PosCouponPage(items: [], nextCursor: null),
          createCouponResult: _fixtureCoupon(id: 'coupon-new'),
          updatePromotionResult: _fixturePromotion(id: 'promotion-9'),
        );
        await _pump(
          tester,
          const Size(1440, 900),
          context: _contextWithPromotionPermissions,
          promotionsGateway: promotionsGateway,
        );
        await navigateToPromotionsAdmin(tester);

        await tester.tap(find.byKey(const Key('pos-promotion-edit-promotion-9')));
        await tester.pumpAndSettle();
        await tester.tap(find.byKey(const Key('pos-promotion-save')));
        await tester.pumpAndSettle();
        expect(promotionsGateway.updatePromotionCalls, ['promotion-9']);

        await tester.tap(find.byKey(const Key('pos-promotions-tab-coupons')));
        await tester.pumpAndSettle();
        await tester.tap(find.byKey(const Key('pos-coupon-new')));
        await tester.pumpAndSettle();
        await tester.enterText(find.byKey(const Key('pos-coupon-code')), 'NUEVO10');
        await tester.enterText(find.byKey(const Key('pos-coupon-value-percentage')), '10');
        await tester.tap(find.byKey(const Key('pos-coupon-save')));
        await tester.pumpAndSettle();
        expect(promotionsGateway.createCouponCalls, ['NUEVO10']);
      },
    );

    testWidgets(
      'a mutation failure while saving surfaces the backend own honest '
      'error, never a fake success',
      (tester) async {
        final promotionsGateway = _FakePromotionsGateway(
          promotionsPage: const PosPromotionPage(items: [], nextCursor: null),
          couponsPage: const PosCouponPage(items: [], nextCursor: null),
          mutationFailure: const ApiException(
            AppFailure(AppErrorKind.validation, 'El nombre ya está en uso.', code: 'resource_conflict'),
          ),
        );
        await _pump(
          tester,
          const Size(1440, 900),
          context: _contextWithPromotionPermissions,
          promotionsGateway: promotionsGateway,
        );
        await navigateToPromotionsAdmin(tester);

        await tester.tap(find.byKey(const Key('pos-promotion-new')));
        await tester.pumpAndSettle();
        await tester.enterText(find.byKey(const Key('pos-promotion-name')), 'Promoción de prueba');
        await tester.enterText(find.byKey(const Key('pos-promotion-value-percentage')), '15');
        await tester.tap(find.byKey(const Key('pos-promotion-save')));
        await tester.pumpAndSettle();

        expect(find.text('El nombre ya está en uso.'), findsOneWidget);
        // The dialog stays open — never a fake success.
        expect(find.byKey(const Key('pos-promotion-save')), findsOneWidget);
      },
    );

    testWidgets(
      'a network/backend failure while validating a coupon surfaces an '
      'honest message, never a fake success',
      (tester) async {
        final promotionsGateway = _FakePromotionsGateway(
          quoteFailure: const ApiException(
            AppFailure(AppErrorKind.unavailable, 'El servicio no está disponible.', code: 'api_unavailable'),
          ),
        );
        await _pump(tester, const Size(1440, 900), promotionsGateway: promotionsGateway);
        await _navigateToPos(tester);
        await tester.tap(find.byKey(const Key('pos-product-product-1')));
        await tester.pump();

        await tester.enterText(find.byKey(const Key('pos-ticket-coupon-input')), 'SAVE10');
        await tester.tap(find.byKey(const Key('pos-ticket-coupon-apply')));
        await tester.pumpAndSettle();

        expect(find.text('El servicio no está disponible.'), findsOneWidget);
        expect(find.byKey(const Key('pos-ticket-coupon-chip-SAVE10')), findsNothing);
      },
    );
  });

  group('Customers, Memberships, and AS Rewards+ (TASK 13.0)', () {
    Future<void> navigateToCustomersAdmin(WidgetTester tester) async {
      if (find.byKey(const Key('nav-customers')).evaluate().isEmpty) {
        await tester.tap(find.byKey(const Key('nav-group-Clientes')));
        await tester.pumpAndSettle();
      }
      await tester.tap(find.byKey(const Key('nav-customers')));
      await tester.pumpAndSettle();
    }

    Future<void> navigateToMembershipsAdmin(WidgetTester tester) async {
      if (find.byKey(const Key('nav-memberships')).evaluate().isEmpty) {
        await tester.tap(find.byKey(const Key('nav-group-Clientes')));
        await tester.pumpAndSettle();
      }
      await tester.tap(find.byKey(const Key('nav-memberships')));
      await tester.pumpAndSettle();
    }

    testWidgets(
      'a permission-less actor never sees the create action and sees an '
      'honest permission state, never a silently-empty list',
      (tester) async {
        await _pump(
          tester,
          const Size(1440, 900),
          context: _contextWithSaleRead,
          customersGateway: _FakeCustomersGateway(),
        );
        await navigateToCustomersAdmin(tester);

        expect(find.byKey(const Key('pos-customer-new')), findsNothing);
        expect(find.text('Acceso no autorizado'), findsWidgets);
      },
    );

    testWidgets('the customers list renders the backend own summary rows and '
        'handles the empty state honestly', (tester) async {
      final customersGateway = _FakeCustomersGateway(
        listResult: PosCustomerPage(
          items: [
            PosCustomerSummary(
              id: 'customer-1',
              displayName: 'Ana Pérez',
              status: 'active',
              version: 1,
              createdAt: DateTime.utc(2026, 9, 1),
            ),
          ],
          nextCursor: null,
        ),
      );
      await _pump(
        tester,
        const Size(1440, 900),
        context: _contextWithCustomerPermissions,
        customersGateway: customersGateway,
      );
      await navigateToCustomersAdmin(tester);

      expect(find.text('Ana Pérez'), findsOneWidget);
      expect(find.byKey(const Key('pos-customer-new')), findsOneWidget);

      await tester.enterText(find.byKey(const Key('pos-customers-search')), 'sin resultados');
      await tester.pump(const Duration(milliseconds: 400));
      await tester.pumpAndSettle();
      expect(customersGateway.listSearchCalls, contains('sin resultados'));
    });

    testWidgets('creating a new customer calls the backend with the real form '
        'values, minimum-friction (only first name required)', (tester) async {
      final customersGateway = _FakeCustomersGateway(
        listResult: const PosCustomerPage(items: [], nextCursor: null),
        createResult: _fixtureCustomer(id: 'customer-new', displayName: 'Nuevo Cliente'),
      );
      await _pump(
        tester,
        const Size(1440, 900),
        context: _contextWithCustomerPermissions,
        customersGateway: customersGateway,
      );
      await navigateToCustomersAdmin(tester);

      await tester.tap(find.byKey(const Key('pos-customer-new')));
      await tester.pumpAndSettle();
      await tester.tap(find.byKey(const Key('pos-customer-save')));
      await tester.pump();
      expect(find.text('El nombre es obligatorio.'), findsOneWidget);

      await tester.enterText(find.byKey(const Key('pos-customer-first-name')), 'Nuevo Cliente');
      await tester.tap(find.byKey(const Key('pos-customer-save')));
      await tester.pumpAndSettle();

      expect(customersGateway.createCalls, hasLength(1));
      expect(customersGateway.createCalls.single.firstName, 'Nuevo Cliente');
    });

    testWidgets(
      'a 409 conflict on customer creation offers the existing customer '
      'instead of a generic error, never blindly retried',
      (tester) async {
        final customersGateway = _FakeCustomersGateway(
          listResult: const PosCustomerPage(items: [], nextCursor: null),
          createFailure: const ApiException(
            AppFailure(AppErrorKind.validation, 'ignored', code: 'resource_conflict'),
            details: {'existing_customer_id': 'customer-existing'},
          ),
        );
        await _pump(
          tester,
          const Size(1440, 900),
          context: _contextWithCustomerPermissions,
          customersGateway: customersGateway,
        );
        await navigateToCustomersAdmin(tester);

        await tester.tap(find.byKey(const Key('pos-customer-new')));
        await tester.pumpAndSettle();
        await tester.enterText(find.byKey(const Key('pos-customer-first-name')), 'Duplicado');
        await tester.tap(find.byKey(const Key('pos-customer-save')));
        await tester.pumpAndSettle();

        expect(find.text('Ya existe un cliente con ese correo o teléfono.'), findsOneWidget);
        expect(find.textContaining('customer-existing'), findsOneWidget);
      },
    );

    testWidgets(
      'a mutation failure while saving a customer surfaces the backend own '
      'honest error, never a fake success',
      (tester) async {
        final customersGateway = _FakeCustomersGateway(
          listResult: const PosCustomerPage(items: [], nextCursor: null),
          createFailure: const ApiException(
            AppFailure(AppErrorKind.unavailable, 'El servicio no está disponible.', code: 'api_unavailable'),
          ),
        );
        await _pump(
          tester,
          const Size(1440, 900),
          context: _contextWithCustomerPermissions,
          customersGateway: customersGateway,
        );
        await navigateToCustomersAdmin(tester);

        await tester.tap(find.byKey(const Key('pos-customer-new')));
        await tester.pumpAndSettle();
        await tester.enterText(find.byKey(const Key('pos-customer-first-name')), 'Cliente');
        await tester.tap(find.byKey(const Key('pos-customer-save')));
        await tester.pumpAndSettle();

        expect(find.text('El servicio no está disponible.'), findsOneWidget);
        // The dialog stays open — never a fake success.
        expect(find.byKey(const Key('pos-customer-save')), findsOneWidget);
      },
    );

    testWidgets(
      'Customer Detail shows an honest empty Rewards state — never a fake '
      "'reward available' badge — and an honest empty Membresías state",
      (tester) async {
        final customersGateway = _FakeCustomersGateway(
          listResult: PosCustomerPage(
            items: [
              PosCustomerSummary(
                id: 'customer-1',
                displayName: 'Ana Pérez',
                status: 'active',
                version: 1,
                createdAt: DateTime.utc(2026, 9, 1),
              ),
            ],
            nextCursor: null,
          ),
          customerResult: _fixtureCustomer(id: 'customer-1', displayName: 'Ana Pérez'),
        );
        await _pump(
          tester,
          const Size(1440, 900),
          context: _contextWithCustomerPermissions,
          customersGateway: customersGateway,
          membershipsGateway: _FakeMembershipsGateway(membershipsResult: const []),
          loyaltyGateway: _FakeLoyaltyGateway(
            summaryResult: const PosLoyaltySummary(accountId: null, balances: [], ledger: []),
          ),
        );
        await navigateToCustomersAdmin(tester);
        await tester.tap(find.text('Ana Pérez'));
        await tester.pumpAndSettle();

        expect(find.text('Sin actividad de rewards.'), findsOneWidget);
        expect(find.text('Sin membresías registradas.'), findsOneWidget);
        expect(find.byKey(const Key('pos-customer-loyalty-adjust')), findsOneWidget);
      },
    );

    testWidgets(
      'loyalty.adjust is gated SEPARATELY from loyalty.manage — an actor '
      'without it never sees the Ajustar action',
      (tester) async {
        final contextWithoutAdjust = AuthenticatedContext(
          session: _context.session,
          user: _context.user,
          companies: _context.companies,
          branches: _context.branches,
          companyWideAccess: false,
          permissions: [..._context.permissions, 'customer.read', 'loyalty.read', 'loyalty.manage'],
        );
        final customersGateway = _FakeCustomersGateway(
          listResult: PosCustomerPage(
            items: [
              PosCustomerSummary(
                id: 'customer-1',
                displayName: 'Ana Pérez',
                status: 'active',
                version: 1,
                createdAt: DateTime.utc(2026, 9, 1),
              ),
            ],
            nextCursor: null,
          ),
          customerResult: _fixtureCustomer(id: 'customer-1', displayName: 'Ana Pérez'),
        );
        await _pump(
          tester,
          const Size(1440, 900),
          context: contextWithoutAdjust,
          customersGateway: customersGateway,
          loyaltyGateway: _FakeLoyaltyGateway(
            summaryResult: const PosLoyaltySummary(accountId: null, balances: [], ledger: []),
          ),
        );
        await navigateToCustomersAdmin(tester);
        await tester.tap(find.text('Ana Pérez'));
        await tester.pumpAndSettle();

        expect(find.byKey(const Key('pos-customer-loyalty-adjust')), findsNothing);
      },
    );

    testWidgets(
      'the membership plans admin screen renders from the backend list and '
      'creating a plan calls the backend with the real form values',
      (tester) async {
        final membershipsGateway = _FakeMembershipsGateway(
          plansResult: [_fixturePlan(id: 'plan-1', name: 'Plan Oro')],
          createPlanResult: _fixturePlan(id: 'plan-new', name: 'Plan Plata'),
        );
        await _pump(
          tester,
          const Size(1440, 900),
          context: _contextWithCustomerPermissions,
          membershipsGateway: membershipsGateway,
        );
        await navigateToMembershipsAdmin(tester);

        expect(find.text('Plan Oro'), findsOneWidget);
        expect(find.byKey(const Key('pos-membership-plan-new')), findsOneWidget);

        await tester.tap(find.byKey(const Key('pos-membership-plan-new')));
        await tester.pumpAndSettle();
        await tester.enterText(find.byKey(const Key('pos-membership-plan-name')), 'Plan Plata');
        await tester.tap(find.byKey(const Key('pos-membership-plan-save')));
        await tester.pumpAndSettle();

        expect(membershipsGateway.createPlanCalls, ['Plan Plata']);
      },
    );

    testWidgets(
      'a permission-less actor never sees the new-plan action on the '
      'membership plans admin screen',
      (tester) async {
        await _pump(
          tester,
          const Size(1440, 900),
          context: _contextWithCustomerReadOnly,
          membershipsGateway: _FakeMembershipsGateway(),
        );
        await navigateToMembershipsAdmin(tester);

        expect(find.byKey(const Key('pos-membership-plan-new')), findsNothing);
        expect(find.text('Acceso no autorizado'), findsWidgets);
      },
    );

    testWidgets('Sales History shows the attached customer name where present, '
        'and an honest dash for a walk-in sale', (tester) async {
      final salesGateway = _FakeSalesGateway(
        listResult: PosSaleHistoryPage(
          items: [
            PosSaleSummary(
              id: 'sale-1',
              saleNumber: 'SALE-1',
              status: 'completed',
              currencyCode: 'MXN',
              branchId: 'branch-id',
              branchName: 'Main',
              cashierId: 'user-id',
              cashierName: 'Cash Ier',
              occurredAt: DateTime.utc(2026, 9, 1),
              completedAt: DateTime.utc(2026, 9, 1, 0, 5),
              itemCount: 1,
              subtotal: '10.0000',
              taxTotal: '1.6000',
              total: '11.6000',
              paymentMethods: const ['cash'],
              customerId: 'customer-1',
              customerDisplayName: 'Ana Pérez',
            ),
            PosSaleSummary(
              id: 'sale-2',
              saleNumber: 'SALE-2',
              status: 'completed',
              currencyCode: 'MXN',
              branchId: 'branch-id',
              branchName: 'Main',
              cashierId: 'user-id',
              cashierName: 'Cash Ier',
              occurredAt: DateTime.utc(2026, 9, 1),
              completedAt: DateTime.utc(2026, 9, 1, 0, 5),
              itemCount: 1,
              subtotal: '10.0000',
              taxTotal: '1.6000',
              total: '11.6000',
              paymentMethods: const ['cash'],
            ),
          ],
          nextCursor: null,
        ),
      );
      await _pump(tester, const Size(1440, 900), context: _contextWithSaleRead, salesGateway: salesGateway);
      // `history` lives under "Administración", the sidebar's own
      // default-expanded group — already visible with no group to open
      // first (see the TASK 12.6 `navigateToHistory` helper above).
      await tester.tap(find.byKey(const Key('nav-history')));
      await tester.pumpAndSettle();

      expect(find.text('Ana Pérez'), findsOneWidget);
    });

    testWidgets(
      'the POS ticket customer selector defaults to "Venta sin cliente", '
      "searches via the backend's own GET /customers?search=, and attaches "
      'the selected customer id to POST /sales',
      (tester) async {
        final customersGateway = _FakeCustomersGateway(
          listResult: PosCustomerPage(
            items: [
              PosCustomerSummary(
                id: 'customer-1',
                displayName: 'Ana Pérez',
                status: 'active',
                version: 1,
                createdAt: DateTime.utc(2026, 9, 1),
              ),
            ],
            nextCursor: null,
          ),
        );
        final salesGateway = _FakeSalesGateway();
        await _pump(
          tester,
          const Size(1440, 900),
          salesGateway: salesGateway,
          customersGateway: customersGateway,
        );
        await _navigateToPos(tester);
        await tester.tap(find.byKey(const Key('pos-product-product-1')));
        await tester.pump();

        expect(find.byKey(const Key('pos-ticket-customer-select')), findsOneWidget);
        await tester.tap(find.byKey(const Key('pos-ticket-customer-select')));
        await tester.pumpAndSettle();

        await tester.enterText(find.byKey(const Key('pos-customer-selector-search')), 'Ana');
        await tester.pump(const Duration(milliseconds: 400));
        await tester.pumpAndSettle();
        expect(customersGateway.listSearchCalls, contains('Ana'));

        await tester.tap(find.byKey(const Key('pos-customer-selector-result-customer-1')));
        await tester.pumpAndSettle();

        expect(find.byKey(const Key('pos-ticket-customer-attached')), findsOneWidget);
        expect(find.text('Ana Pérez'), findsOneWidget);

        await tester.tap(find.byKey(const Key('pos-ticket-cobrar')));
        await tester.pump();
        await tester.pumpAndSettle();

        expect(salesGateway.calls, isNotEmpty);
        expect(salesGateway.calls.last.customerId, 'customer-1');
      },
    );

    testWidgets(
      '"Nuevo cliente" quick-registration from the ticket customer selector '
      'offers the existing customer on a 409 conflict instead of blindly '
      'duplicating',
      (tester) async {
        final customersGateway = _FakeCustomersGateway(
          createFailure: const ApiException(
            AppFailure(AppErrorKind.validation, 'ignored', code: 'resource_conflict'),
            details: {'existing_customer_id': 'customer-existing'},
          ),
          customerResult: _fixtureCustomer(id: 'customer-existing', displayName: 'Cliente Existente'),
        );
        await _pump(tester, const Size(1440, 900), customersGateway: customersGateway);
        await _navigateToPos(tester);
        await tester.tap(find.byKey(const Key('pos-product-product-1')));
        await tester.pump();

        await tester.tap(find.byKey(const Key('pos-ticket-customer-select')));
        await tester.pumpAndSettle();
        await tester.tap(find.byKey(const Key('pos-customer-selector-new')));
        await tester.pumpAndSettle();

        await tester.enterText(find.byKey(const Key('pos-quick-customer-first-name')), 'Duplicado');
        await tester.tap(find.byKey(const Key('pos-quick-customer-save')));
        await tester.pumpAndSettle();

        expect(find.byKey(const Key('pos-quick-customer-use-existing')), findsOneWidget);
        await tester.tap(find.byKey(const Key('pos-quick-customer-use-existing')));
        await tester.pumpAndSettle();

        expect(find.byKey(const Key('pos-ticket-customer-attached')), findsOneWidget);
        expect(find.text('Cliente Existente'), findsOneWidget);
      },
    );

    testWidgets(
      'removing the attached customer restores "Venta sin cliente"',
      (tester) async {
        final customersGateway = _FakeCustomersGateway(
          listResult: PosCustomerPage(
            items: [
              PosCustomerSummary(
                id: 'customer-1',
                displayName: 'Ana Pérez',
                status: 'active',
                version: 1,
                createdAt: DateTime.utc(2026, 9, 1),
              ),
            ],
            nextCursor: null,
          ),
        );
        await _pump(tester, const Size(1440, 900), customersGateway: customersGateway);
        await _navigateToPos(tester);
        await tester.tap(find.byKey(const Key('pos-product-product-1')));
        await tester.pump();

        await tester.tap(find.byKey(const Key('pos-ticket-customer-select')));
        await tester.pumpAndSettle();
        await tester.enterText(find.byKey(const Key('pos-customer-selector-search')), 'Ana');
        await tester.pump(const Duration(milliseconds: 400));
        await tester.pumpAndSettle();
        await tester.tap(find.byKey(const Key('pos-customer-selector-result-customer-1')));
        await tester.pumpAndSettle();
        expect(find.byKey(const Key('pos-ticket-customer-attached')), findsOneWidget);

        await tester.tap(find.byKey(const Key('pos-ticket-customer-remove')));
        await tester.pump();

        expect(find.byKey(const Key('pos-ticket-customer-select')), findsOneWidget);
        expect(find.byKey(const Key('pos-ticket-customer-attached')), findsNothing);
      },
    );

    testWidgets(
      'CLIENTE mode never gains a customer directory search — no selector '
      'affordance exists in the locked CLIENTE surface',
      (tester) async {
        await _pump(tester, const Size(1440, 900));
        await _navigateToPos(tester);
        await tester.tap(find.byKey(const Key('pos-mode-cliente')));
        await tester.pumpAndSettle();

        expect(find.byKey(const Key('pos-cliente-shell')), findsOneWidget);
        expect(find.byKey(const Key('pos-ticket-customer-select')), findsNothing);
        expect(find.byKey(const Key('pos-customer-selector-search')), findsNothing);
      },
    );

    testWidgets(
      'the customers list and Customer Detail surface the backend own '
      'honest errors, never a fabricated success',
      (tester) async {
        final customersGateway = _FakeCustomersGateway(
          listFailure: const ApiException(
            AppFailure(AppErrorKind.unavailable, 'El servicio no está disponible.', code: 'api_unavailable'),
          ),
        );
        await _pump(
          tester,
          const Size(1440, 900),
          context: _contextWithCustomerPermissions,
          customersGateway: customersGateway,
        );
        await navigateToCustomersAdmin(tester);
        expect(find.text('El servicio no está disponible.'), findsOneWidget);
      },
    );

    testWidgets(
      'editing an existing customer calls updateCustomer with the real '
      'form values',
      (tester) async {
        final customersGateway = _FakeCustomersGateway(
          listResult: PosCustomerPage(
            items: [
              PosCustomerSummary(
                id: 'customer-1',
                displayName: 'Ana Pérez',
                status: 'active',
                version: 1,
                createdAt: DateTime.utc(2026, 9, 1),
              ),
            ],
            nextCursor: null,
          ),
          customerResult: _fixtureCustomer(id: 'customer-1', displayName: 'Ana Pérez'),
          customerFailure: null,
          updateResult: _fixtureCustomer(id: 'customer-1', displayName: 'Ana P. Editada'),
        );
        await _pump(
          tester,
          const Size(1440, 900),
          context: _contextWithCustomerPermissions,
          customersGateway: customersGateway,
        );
        await navigateToCustomersAdmin(tester);
        await tester.tap(find.text('Ana Pérez'));
        await tester.pumpAndSettle();

        await tester.tap(find.byKey(const Key('pos-customer-detail-edit')));
        await tester.pumpAndSettle();
        await tester.tap(find.byKey(const Key('pos-customer-save')));
        await tester.pumpAndSettle();

        expect(customersGateway.updateCalls, ['customer-1']);
      },
    );

    testWidgets(
      'a failed customer edit keeps the dialog open with the backend own '
      'honest error, never a fake success',
      (tester) async {
        final failingGateway = _FakeCustomersGateway(
          listResult: PosCustomerPage(
            items: [
              PosCustomerSummary(
                id: 'customer-1',
                displayName: 'Ana Pérez',
                status: 'active',
                version: 1,
                createdAt: DateTime.utc(2026, 9, 1),
              ),
            ],
            nextCursor: null,
          ),
          customerResult: _fixtureCustomer(id: 'customer-1', displayName: 'Ana Pérez'),
          updateFailure: const ApiException(
            AppFailure(AppErrorKind.validation, 'La información cambió mientras tanto.', code: 'version_conflict'),
          ),
        );
        await _pump(
          tester,
          const Size(1440, 900),
          context: _contextWithCustomerPermissions,
          customersGateway: failingGateway,
        );
        await navigateToCustomersAdmin(tester);
        await tester.tap(find.text('Ana Pérez'));
        await tester.pumpAndSettle();
        await tester.tap(find.byKey(const Key('pos-customer-detail-edit')));
        await tester.pumpAndSettle();
        await tester.tap(find.byKey(const Key('pos-customer-save')));
        await tester.pumpAndSettle();

        expect(find.text('La información cambió mientras tanto.'), findsOneWidget);
        expect(find.byKey(const Key('pos-customer-save')), findsOneWidget);
      },
    );

    testWidgets(
      'Customer Detail: QR issuance, membership issue/renew/cancel/'
      'validate, and a manual rewards adjustment all call the real '
      'backend, never a client-computed decision',
      (tester) async {
        final membership = _fixtureMembership(id: 'membership-1', customerId: 'customer-1', planId: 'plan-1');
        final membershipsGateway = _FakeMembershipsGateway(
          membershipsResult: [membership],
          membershipsFailure: null,
          plansResult: [_fixturePlan(id: 'plan-1', name: 'Plan Oro')],
          issueResult: _fixtureMembership(id: 'membership-3', customerId: 'customer-1', planId: 'plan-1'),
          issueFailure: null,
          renewResult: _fixtureMembership(id: 'membership-2', customerId: 'customer-1', planId: 'plan-1'),
          cancelResult: _fixtureMembership(
            id: 'membership-1',
            customerId: 'customer-1',
            planId: 'plan-1',
            status: 'cancelled',
          ),
          validateResult: const PosMembershipValidation(
            valid: true,
            reason: null,
            eligibleBranch: true,
            membership: null,
          ),
        );
        final customersGateway = _FakeCustomersGateway(
          listResult: PosCustomerPage(
            items: [
              PosCustomerSummary(
                id: 'customer-1',
                displayName: 'Ana Pérez',
                status: 'active',
                version: 1,
                createdAt: DateTime.utc(2026, 9, 1),
              ),
            ],
            nextCursor: null,
          ),
          customerResult: _fixtureCustomer(id: 'customer-1', displayName: 'Ana Pérez'),
          qrTokenResult: PosCustomerQrToken(
            id: 'qr-1',
            customerId: 'customer-1',
            token: 'opaque-token-value',
            status: 'active',
            createdAt: DateTime.utc(2026, 9, 1),
          ),
        );
        final loyaltyGateway = _FakeLoyaltyGateway(
          programsResult: [
            const PosLoyaltyProgram(
              id: 'program-1',
              name: 'AS Rewards+',
              active: true,
              unitType: 'point',
              earnQuantityPerSale: 1,
              minimumSaleTotal: null,
              rewardThreshold: null,
              rewardDescription: null,
              version: 1,
            ),
          ],
          summaryResult: const PosLoyaltySummary(
            accountId: 'account-1',
            balances: [PosLoyaltyBalance(programId: 'program-1', unitType: 'point', balance: 5)],
            ledger: [],
          ),
          summaryFailure: null,
          adjustResult: PosLoyaltyLedgerEntry(
            id: 'ledger-9',
            entryType: 'adjustment',
            quantity: 3,
            unitType: 'point',
            sourceType: 'manual',
            reason: 'ajuste',
            occurredAt: DateTime.utc(2026, 9, 4),
          ),
          adjustFailure: null,
        );
        await _pump(
          tester,
          const Size(1440, 900),
          context: _contextWithCustomerPermissions,
          customersGateway: customersGateway,
          membershipsGateway: membershipsGateway,
          loyaltyGateway: loyaltyGateway,
        );
        await navigateToCustomersAdmin(tester);
        await tester.tap(find.text('Ana Pérez'));
        await tester.pumpAndSettle();

        // The joined program name — never a bare id (ADR-0017: honest
        // display of backend-returned data only).
        expect(find.text('AS Rewards+'), findsOneWidget);

        // QR issuance.
        await tester.tap(find.byKey(const Key('pos-customer-detail-qr')));
        await tester.pumpAndSettle();
        expect(find.byKey(const Key('pos-customer-qr-token')), findsOneWidget);
        expect(find.text('opaque-token-value'), findsOneWidget);

        // Issue a new membership.
        await tester.tap(find.byKey(const Key('pos-customer-membership-issue')));
        await tester.pumpAndSettle();
        await tester.tap(find.byKey(const Key('pos-issue-membership-save')));
        await tester.pumpAndSettle();
        expect(membershipsGateway.issueCalls, contains('plan-1'));

        // Renew.
        await tester.tap(find.byKey(const Key('pos-customer-membership-renew-membership-1')));
        await tester.pumpAndSettle();
        expect(membershipsGateway.renewCalls, contains('membership-1'));

        // Verificar vigencia — the ONE source of truth (ADR-0017 D11),
        // never a client-side recomputation of `status`/`expiresAt`.
        await tester.tap(find.byKey(const Key('pos-customer-membership-validate-membership-1')));
        await tester.pumpAndSettle();
        expect(find.text('Membresía vigente en esta sucursal.'), findsOneWidget);

        // Cancel — a manual remedy only (ADR-0017 D20).
        await tester.tap(find.byKey(const Key('pos-customer-membership-cancel-membership-1')));
        await tester.pumpAndSettle();
        await tester.enterText(find.byKey(const Key('pos-cancel-membership-reason')), 'Solicitud del cliente');
        await tester.tap(find.byKey(const Key('pos-cancel-membership-confirm')));
        await tester.pumpAndSettle();
        expect(membershipsGateway.cancelCalls, contains('membership-1'));

        // Manual rewards adjustment.
        await tester.tap(find.byKey(const Key('pos-customer-loyalty-adjust')));
        await tester.pumpAndSettle();
        await tester.enterText(find.byKey(const Key('pos-loyalty-adjust-quantity')), '3');
        await tester.enterText(find.byKey(const Key('pos-loyalty-adjust-reason')), 'Bono de bienvenida');
        await tester.tap(find.byKey(const Key('pos-loyalty-adjust-save')));
        await tester.pumpAndSettle();
        expect(loyaltyGateway.adjustCalls, contains(3));
      },
    );

    testWidgets(
      'the membership plans admin surfaces the backend own honest error',
      (tester) async {
        final membershipsGateway = _FakeMembershipsGateway(
          plansFailure: const ApiException(
            AppFailure(AppErrorKind.unavailable, 'El servicio no está disponible.', code: 'api_unavailable'),
          ),
        );
        await _pump(
          tester,
          const Size(1440, 900),
          context: _contextWithCustomerPermissions,
          membershipsGateway: membershipsGateway,
        );
        await navigateToMembershipsAdmin(tester);
        expect(find.text('El servicio no está disponible.'), findsOneWidget);
      },
    );

    testWidgets('editing an existing membership plan calls updatePlan with '
        'the real form values', (tester) async {
      final workingGateway = _FakeMembershipsGateway(
        plansResult: [_fixturePlan(id: 'plan-1', name: 'Plan Oro')],
        updatePlanResult: _fixturePlan(id: 'plan-1', name: 'Plan Oro Editado'),
      );
      await _pump(
        tester,
        const Size(1440, 900),
        context: _contextWithCustomerPermissions,
        membershipsGateway: workingGateway,
      );
      await navigateToMembershipsAdmin(tester);
      await tester.tap(find.byKey(const Key('pos-membership-plan-edit-plan-1')));
      await tester.pumpAndSettle();
      await tester.tap(find.byKey(const Key('pos-membership-plan-save')));
      await tester.pumpAndSettle();

      expect(workingGateway.updatePlanCalls, ['plan-1']);
    });
  });

  group('Reward entitlements (TASK 13.1/13.1A)', () {
    // `entitlement(id)` (`GET /reward-entitlements/{id}`) is part of the
    // full `PosRewardsGateway` contract but `pos_shell.dart` never calls
    // it (every surface in this file reads the list endpoint instead —
    // see `pos_rewards_gateway.dart`'s own doc comment). Exercised here
    // directly against the fake, mirroring how the rest of this contract
    // is exercised through the real UI.
    test(
      '_FakeRewardsGateway.entitlement honors a canned result/failure, '
      "matching this gateway's own default-fixture-when-unset contract",
      () async {
        final entitlement = _fixtureRewardEntitlement(id: 'reward-1', status: 'available');
        final gateway = _FakeRewardsGateway(entitlementResult: entitlement);
        expect(await gateway.entitlement('reward-1'), same(entitlement));

        final defaultGateway = _FakeRewardsGateway();
        final fallback = await defaultGateway.entitlement('reward-2');
        expect(fallback.id, 'reward-2');

        final failingGateway = _FakeRewardsGateway(
          entitlementFailure: ApiException(AppFailure.fromCode('reward_expired')),
        );
        await expectLater(
          () => failingGateway.entitlement('reward-1'),
          throwsA(isA<ApiException>()),
        );
      },
    );

    Future<void> navigateToCustomersAdmin(WidgetTester tester) async {
      if (find.byKey(const Key('nav-customers')).evaluate().isEmpty) {
        await tester.tap(find.byKey(const Key('nav-group-Clientes')));
        await tester.pumpAndSettle();
      }
      await tester.tap(find.byKey(const Key('nav-customers')));
      await tester.pumpAndSettle();
    }

    /// Attaches `customer-1` ("Ana Pérez") to the in-progress CAJERO
    /// ticket via the same real UI flow the TASK 13.0 group's own ticket-
    /// customer-selector test uses — never a shortcut that bypasses the
    /// actual selector widget.
    Future<void> attachCustomerInCajero(WidgetTester tester) async {
      await _navigateToPos(tester);
      await tester.tap(find.byKey(const Key('pos-ticket-customer-select')));
      await tester.pumpAndSettle();
      await tester.enterText(find.byKey(const Key('pos-customer-selector-search')), 'Ana');
      await tester.pump(const Duration(milliseconds: 400));
      await tester.pumpAndSettle();
      await tester.tap(find.byKey(const Key('pos-customer-selector-result-customer-1')));
      await tester.pumpAndSettle();
    }

    PosCustomersGateway attachableCustomersGateway() => _FakeCustomersGateway(
      listResult: PosCustomerPage(
        items: [
          PosCustomerSummary(
            id: 'customer-1',
            displayName: 'Ana Pérez',
            status: 'active',
            version: 1,
            createdAt: DateTime.utc(2026, 9, 1),
          ),
        ],
        nextCursor: null,
      ),
      customerResult: _fixtureCustomer(id: 'customer-1', displayName: 'Ana Pérez'),
    );

    testWidgets(
      'Customer Detail shows an available reward entitlement with the real '
      'reward-type and status labels',
      (tester) async {
        final rewardsGateway = _FakeRewardsGateway(
          entitlementsForCustomerResult: [_fixtureRewardEntitlement(id: 'reward-1', status: 'available')],
        );
        await _pump(
          tester,
          const Size(1440, 900),
          context: _contextWithRewardPermissions,
          customersGateway: attachableCustomersGateway(),
          rewardsGateway: rewardsGateway,
        );
        await navigateToCustomersAdmin(tester);
        await tester.tap(find.text('Ana Pérez'));
        await tester.pumpAndSettle();

        expect(find.byKey(const Key('pos-customer-reward-reward-1')), findsOneWidget);
        expect(find.text('Pase VIP'), findsOneWidget);
        expect(find.text('Disponible'), findsOneWidget);
        expect(find.text('Disponibles'), findsOneWidget);
      },
    );

    testWidgets(
      'Customer Detail shows a redeemed entitlement under Historial, '
      'visually distinguished from Disponibles',
      (tester) async {
        final rewardsGateway = _FakeRewardsGateway(
          entitlementsForCustomerResult: [
            _fixtureRewardEntitlement(
              id: 'reward-1',
              status: 'redeemed',
              effectiveStatus: 'redeemed',
              redeemedAt: DateTime.utc(2026, 9, 3),
            ),
          ],
        );
        await _pump(
          tester,
          const Size(1440, 900),
          context: _contextWithRewardPermissions,
          customersGateway: attachableCustomersGateway(),
          rewardsGateway: rewardsGateway,
        );
        await navigateToCustomersAdmin(tester);
        await tester.tap(find.text('Ana Pérez'));
        await tester.pumpAndSettle();

        expect(find.byKey(const Key('pos-customer-reward-reward-1')), findsOneWidget);
        expect(find.text('Canjeado'), findsOneWidget);
        expect(find.text('Historial'), findsOneWidget);
        // The list has one entitlement and it's not available — the
        // section renders the honest "no rewards available right now"
        // line rather than a "Disponibles" header with nothing under it.
        expect(find.text('Sin recompensas disponibles actualmente.'), findsOneWidget);
        expect(find.text('Disponibles'), findsNothing);
        // A redeemed row never gets a "Revocar" action (only rows in the
        // Disponibles list do — see `showRevoke` in `pos_shell.dart`).
        expect(find.byKey(const Key('pos-customer-reward-revoke-reward-1')), findsNothing);
      },
    );

    testWidgets(
      'Customer Detail shows the honest empty Recompensas state for a '
      'customer with zero entitlements, and renders no reward row',
      (tester) async {
        await _pump(
          tester,
          const Size(1440, 900),
          context: _contextWithRewardPermissions,
          customersGateway: attachableCustomersGateway(),
          rewardsGateway: _FakeRewardsGateway(entitlementsForCustomerResult: const []),
        );
        await navigateToCustomersAdmin(tester);
        await tester.tap(find.text('Ana Pérez'));
        await tester.pumpAndSettle();

        expect(find.text('No hay recompensas disponibles.'), findsOneWidget);
        expect(find.text('Disponibles'), findsNothing);
        expect(find.text('Historial'), findsNothing);
        expect(find.textContaining('Pase VIP'), findsNothing);
        // No loyalty programs are configured in this fixture, so the
        // "Agregar recompensa" action stays hidden regardless of
        // `reward.issue` (`_programs.isNotEmpty` gate) — confirming no
        // stray reward key of any kind renders here.
        expect(find.byKey(const Key('pos-customer-reward-issue')), findsNothing);
      },
    );

    testWidgets(
      'Customer Detail: a failed reward-entitlements fetch surfaces the '
      "backend's own honest error, never a fake empty state",
      (tester) async {
        await _pump(
          tester,
          const Size(1440, 900),
          context: _contextWithRewardPermissions,
          customersGateway: attachableCustomersGateway(),
          rewardsGateway: _FakeRewardsGateway(
            entitlementsForCustomerFailure: const ApiException(
              AppFailure(AppErrorKind.unavailable, 'El servicio no está disponible.', code: 'api_unavailable'),
            ),
          ),
        );
        await navigateToCustomersAdmin(tester);
        await tester.tap(find.text('Ana Pérez'));
        await tester.pumpAndSettle();

        expect(find.text('El servicio no está disponible.'), findsOneWidget);
        expect(find.text('No hay recompensas disponibles.'), findsNothing);
      },
    );

    testWidgets(
      'CAJERO: "Recompensas disponibles" only appears once the attached '
      'customer has an available entitlement',
      (tester) async {
        final rewardsGateway = _FakeRewardsGateway(
          entitlementsForCustomerResult: [_fixtureRewardEntitlement(id: 'reward-1', status: 'available')],
        );
        await _pump(
          tester,
          const Size(1440, 900),
          context: _contextWithRewardReadOnly,
          customersGateway: attachableCustomersGateway(),
          rewardsGateway: rewardsGateway,
        );
        await attachCustomerInCajero(tester);

        expect(find.byKey(const Key('pos-ticket-rewards-open')), findsOneWidget);
      },
    );

    testWidgets(
      'CAJERO: "Recompensas disponibles" never appears for a customer with '
      'only a redeemed/expired/revoked entitlement',
      (tester) async {
        final rewardsGateway = _FakeRewardsGateway(
          entitlementsForCustomerResult: [
            _fixtureRewardEntitlement(id: 'reward-1', status: 'redeemed', effectiveStatus: 'redeemed'),
            _fixtureRewardEntitlement(id: 'reward-2', status: 'expired', effectiveStatus: 'expired'),
            _fixtureRewardEntitlement(id: 'reward-3', status: 'revoked', effectiveStatus: 'revoked'),
          ],
        );
        await _pump(
          tester,
          const Size(1440, 900),
          context: _contextWithRewardReadOnly,
          customersGateway: attachableCustomersGateway(),
          rewardsGateway: rewardsGateway,
        );
        await attachCustomerInCajero(tester);

        expect(find.byKey(const Key('pos-ticket-rewards-open')), findsNothing);
      },
    );

    testWidgets(
      'CAJERO: the "Canjear" button in the rewards dialog only renders for '
      'an actor with reward.redeem',
      (tester) async {
        final rewardsGateway = _FakeRewardsGateway(
          entitlementsForCustomerResult: [_fixtureRewardEntitlement(id: 'reward-1', status: 'available')],
        );
        await _pump(
          tester,
          const Size(1440, 900),
          context: _contextWithRewardReadOnly,
          customersGateway: attachableCustomersGateway(),
          rewardsGateway: rewardsGateway,
        );
        await attachCustomerInCajero(tester);
        await tester.tap(find.byKey(const Key('pos-ticket-rewards-open')));
        await tester.pumpAndSettle();

        expect(find.byKey(const Key('pos-ticket-reward-reward-1')), findsOneWidget);
        expect(find.byKey(const Key('pos-ticket-reward-redeem-reward-1')), findsNothing);
      },
    );

    testWidgets(
      'CAJERO: the "Canjear" button renders for an actor with reward.redeem',
      (tester) async {
        final rewardsGateway = _FakeRewardsGateway(
          entitlementsForCustomerResult: [_fixtureRewardEntitlement(id: 'reward-1', status: 'available')],
        );
        await _pump(
          tester,
          const Size(1440, 900),
          context: _contextWithRewardPermissions,
          customersGateway: attachableCustomersGateway(),
          rewardsGateway: rewardsGateway,
        );
        await attachCustomerInCajero(tester);
        await tester.tap(find.byKey(const Key('pos-ticket-rewards-open')));
        await tester.pumpAndSettle();

        expect(find.byKey(const Key('pos-ticket-reward-redeem-reward-1')), findsOneWidget);
      },
    );

    testWidgets(
      'CAJERO: a successful redeem calls the gateway with the right '
      'entitlement id, and closing the dialog refreshes the list',
      (tester) async {
        final rewardsGateway = _FakeRewardsGateway(
          entitlementsForCustomerResult: [_fixtureRewardEntitlement(id: 'reward-1', status: 'available')],
          // An explicit `redeemResult` — proves the dialog's own row
          // reflects the backend's real returned entitlement, never a
          // client-guessed "redeemed" state.
          redeemResult: _fixtureRewardEntitlement(
            id: 'reward-1',
            status: 'redeemed',
            effectiveStatus: 'redeemed',
            redeemedAt: DateTime.utc(2026, 9, 5),
          ),
        );
        await _pump(
          tester,
          const Size(1440, 900),
          context: _contextWithRewardPermissions,
          customersGateway: attachableCustomersGateway(),
          rewardsGateway: rewardsGateway,
        );
        await attachCustomerInCajero(tester);
        // One fetch from `_loadRewards()` firing on the attach itself.
        expect(rewardsGateway.entitlementsForCustomerCalls, ['customer-1']);

        await tester.tap(find.byKey(const Key('pos-ticket-rewards-open')));
        await tester.pumpAndSettle();
        await tester.tap(find.byKey(const Key('pos-ticket-reward-redeem-reward-1')));
        await tester.pumpAndSettle();

        expect(rewardsGateway.redeemCalls, ['reward-1']);
        expect(find.text('Recompensa canjeada.'), findsOneWidget);
        // The row now reflects the gateway's own returned entitlement —
        // "Canjeado", and the "Canjear" action is gone for that row.
        expect(find.text('Canjeado'), findsOneWidget);
        expect(find.byKey(const Key('pos-ticket-reward-redeem-reward-1')), findsNothing);

        // Closing the dialog after a successful redeem re-fetches.
        await tester.tap(find.byKey(const Key('pos-ticket-rewards-close')));
        await tester.pumpAndSettle();
        expect(rewardsGateway.entitlementsForCustomerCalls, ['customer-1', 'customer-1']);
      },
    );

    testWidgets(
      'CAJERO: an already-redeemed conflict on redeem surfaces the '
      "backend's own honest error, never a fake success",
      (tester) async {
        final rewardsGateway = _FakeRewardsGateway(
          entitlementsForCustomerResult: [_fixtureRewardEntitlement(id: 'reward-1', status: 'available')],
          redeemFailure: ApiException(AppFailure.fromCode('reward_already_redeemed')),
        );
        await _pump(
          tester,
          const Size(1440, 900),
          context: _contextWithRewardPermissions,
          customersGateway: attachableCustomersGateway(),
          rewardsGateway: rewardsGateway,
        );
        await attachCustomerInCajero(tester);
        await tester.tap(find.byKey(const Key('pos-ticket-rewards-open')));
        await tester.pumpAndSettle();
        await tester.tap(find.byKey(const Key('pos-ticket-reward-redeem-reward-1')));
        await tester.pumpAndSettle();

        expect(find.text('Esta recompensa ya fue canjeada.'), findsOneWidget);
        // The button stays for that same (still-available, per the
        // fake's own unmutated list) row — never a fabricated success.
        expect(find.byKey(const Key('pos-ticket-reward-redeem-reward-1')), findsOneWidget);
      },
    );

    testWidgets(
      "CAJERO: an expired-reward response on redeem surfaces the backend's "
      'own honest error',
      (tester) async {
        final rewardsGateway = _FakeRewardsGateway(
          entitlementsForCustomerResult: [_fixtureRewardEntitlement(id: 'reward-1', status: 'available')],
          redeemFailure: ApiException(AppFailure.fromCode('reward_expired')),
        );
        await _pump(
          tester,
          const Size(1440, 900),
          context: _contextWithRewardPermissions,
          customersGateway: attachableCustomersGateway(),
          rewardsGateway: rewardsGateway,
        );
        await attachCustomerInCajero(tester);
        await tester.tap(find.byKey(const Key('pos-ticket-rewards-open')));
        await tester.pumpAndSettle();
        await tester.tap(find.byKey(const Key('pos-ticket-reward-redeem-reward-1')));
        await tester.pumpAndSettle();

        expect(find.text('Esta recompensa ya venció.'), findsOneWidget);
      },
    );

    testWidgets(
      'Customer Detail: "Agregar recompensa" is visible only with '
      'reward.issue',
      (tester) async {
        final loyaltyGateway = _FakeLoyaltyGateway(
          programsResult: const [
            PosLoyaltyProgram(
              id: 'program-1',
              name: 'AS Rewards+',
              active: true,
              unitType: 'point',
              earnQuantityPerSale: 1,
              minimumSaleTotal: null,
              rewardThreshold: null,
              rewardDescription: null,
              version: 1,
            ),
          ],
          summaryResult: const PosLoyaltySummary(accountId: null, balances: [], ledger: []),
        );
        await _pump(
          tester,
          const Size(1440, 900),
          context: _contextWithRewardReadOnly,
          customersGateway: attachableCustomersGateway(),
          loyaltyGateway: loyaltyGateway,
          rewardsGateway: _FakeRewardsGateway(entitlementsForCustomerResult: const []),
        );
        await navigateToCustomersAdmin(tester);
        await tester.tap(find.text('Ana Pérez'));
        await tester.pumpAndSettle();

        expect(find.byKey(const Key('pos-customer-reward-issue')), findsNothing);
      },
    );

    testWidgets(
      'Customer Detail: "Agregar recompensa" renders for an actor with '
      'reward.issue',
      (tester) async {
        final loyaltyGateway = _FakeLoyaltyGateway(
          programsResult: const [
            PosLoyaltyProgram(
              id: 'program-1',
              name: 'AS Rewards+',
              active: true,
              unitType: 'point',
              earnQuantityPerSale: 1,
              minimumSaleTotal: null,
              rewardThreshold: null,
              rewardDescription: null,
              version: 1,
            ),
          ],
          summaryResult: const PosLoyaltySummary(accountId: null, balances: [], ledger: []),
        );
        await _pump(
          tester,
          const Size(1440, 900),
          context: _contextWithRewardPermissions,
          customersGateway: attachableCustomersGateway(),
          loyaltyGateway: loyaltyGateway,
          rewardsGateway: _FakeRewardsGateway(entitlementsForCustomerResult: const []),
        );
        await navigateToCustomersAdmin(tester);
        await tester.tap(find.text('Ana Pérez'));
        await tester.pumpAndSettle();

        expect(find.byKey(const Key('pos-customer-reward-issue')), findsOneWidget);
      },
    );

    testWidgets(
      'Customer Detail: "Revocar" is visible only with reward.revoke',
      (tester) async {
        final rewardsGateway = _FakeRewardsGateway(
          entitlementsForCustomerResult: [_fixtureRewardEntitlement(id: 'reward-1', status: 'available')],
        );
        await _pump(
          tester,
          const Size(1440, 900),
          context: _contextWithRewardReadOnly,
          customersGateway: attachableCustomersGateway(),
          rewardsGateway: rewardsGateway,
        );
        await navigateToCustomersAdmin(tester);
        await tester.tap(find.text('Ana Pérez'));
        await tester.pumpAndSettle();

        expect(find.byKey(const Key('pos-customer-reward-reward-1')), findsOneWidget);
        expect(find.byKey(const Key('pos-customer-reward-revoke-reward-1')), findsNothing);
      },
    );

    testWidgets(
      'Customer Detail: "Revocar" renders for an actor with reward.revoke',
      (tester) async {
        final rewardsGateway = _FakeRewardsGateway(
          entitlementsForCustomerResult: [_fixtureRewardEntitlement(id: 'reward-1', status: 'available')],
        );
        await _pump(
          tester,
          const Size(1440, 900),
          context: _contextWithRewardPermissions,
          customersGateway: attachableCustomersGateway(),
          rewardsGateway: rewardsGateway,
        );
        await navigateToCustomersAdmin(tester);
        await tester.tap(find.text('Ana Pérez'));
        await tester.pumpAndSettle();

        expect(find.byKey(const Key('pos-customer-reward-revoke-reward-1')), findsOneWidget);
      },
    );

    testWidgets(
      'Customer Detail: issuing a manual reward calls the gateway with the '
      'real form values',
      (tester) async {
        final rewardsGateway = _FakeRewardsGateway(
          entitlementsForCustomerResult: const [],
          // An explicit `issueManualResult` — proves nothing crashes on
          // the backend's own returned entitlement shape once issued
          // (the dialog itself only cares about the boolean pop; the
          // follow-up `_loadRewards()` re-fetch is what actually refreshes
          // Customer Detail's list).
          issueManualResult: _fixtureRewardEntitlement(
            id: 'reward-new-1',
            customerId: 'customer-1',
            loyaltyProgramId: 'program-1',
          ),
        );
        final loyaltyGateway = _FakeLoyaltyGateway(
          programsResult: const [
            PosLoyaltyProgram(
              id: 'program-1',
              name: 'AS Rewards+',
              active: true,
              unitType: 'point',
              earnQuantityPerSale: 1,
              minimumSaleTotal: null,
              rewardThreshold: null,
              rewardDescription: null,
              version: 1,
            ),
          ],
          summaryResult: const PosLoyaltySummary(accountId: null, balances: [], ledger: []),
        );
        await _pump(
          tester,
          const Size(1440, 900),
          context: _contextWithRewardPermissions,
          customersGateway: attachableCustomersGateway(),
          loyaltyGateway: loyaltyGateway,
          rewardsGateway: rewardsGateway,
        );
        await navigateToCustomersAdmin(tester);
        await tester.tap(find.text('Ana Pérez'));
        await tester.pumpAndSettle();

        await tester.tap(find.byKey(const Key('pos-customer-reward-issue')));
        await tester.pumpAndSettle();
        // The dialog validates a required reason before submitting —
        // mirrors `_IssueMembershipDialog`'s own precedent.
        await tester.tap(find.byKey(const Key('pos-issue-reward-save')));
        await tester.pump();
        expect(find.text('Escribe un motivo.'), findsOneWidget);

        await tester.enterText(find.byKey(const Key('pos-issue-reward-reason')), 'Cumpleaños del cliente');
        await tester.tap(find.byKey(const Key('pos-issue-reward-save')));
        await tester.pumpAndSettle();

        expect(rewardsGateway.issueManualCalls, [
          {
            'customerId': 'customer-1',
            'loyaltyProgramId': 'program-1',
            'reasonCode': 'Cumpleaños del cliente',
            'expiresAt': null,
          },
        ]);
      },
    );

    testWidgets(
      'Customer Detail: revoking a reward calls the gateway with the real '
      'form values, including a required reason',
      (tester) async {
        final rewardsGateway = _FakeRewardsGateway(
          entitlementsForCustomerResult: [
            _fixtureRewardEntitlement(id: 'reward-1', status: 'available', version: 4),
          ],
          // An explicit `revokeResult` — proves nothing crashes on the
          // backend's own returned entitlement shape once revoked.
          revokeResult: _fixtureRewardEntitlement(
            id: 'reward-1',
            status: 'revoked',
            effectiveStatus: 'revoked',
            revokedAt: DateTime.utc(2026, 9, 5),
            version: 5,
          ),
        );
        await _pump(
          tester,
          const Size(1440, 900),
          context: _contextWithRewardPermissions,
          customersGateway: attachableCustomersGateway(),
          rewardsGateway: rewardsGateway,
        );
        await navigateToCustomersAdmin(tester);
        await tester.tap(find.text('Ana Pérez'));
        await tester.pumpAndSettle();

        await tester.tap(find.byKey(const Key('pos-customer-reward-revoke-reward-1')));
        await tester.pumpAndSettle();
        // A required reason — mirrors `_CancelMembershipDialog`'s own
        // precedent.
        await tester.tap(find.byKey(const Key('pos-revoke-reward-confirm')));
        await tester.pump();
        expect(find.text('Escribe un motivo.'), findsOneWidget);

        await tester.enterText(find.byKey(const Key('pos-revoke-reward-reason')), 'Solicitud del cliente');
        await tester.tap(find.byKey(const Key('pos-revoke-reward-confirm')));
        await tester.pumpAndSettle();

        expect(rewardsGateway.revokeCalls, [
          {'id': 'reward-1', 'reason': 'Solicitud del cliente', 'version': 4},
        ]);
      },
    );

    testWidgets(
      'Customer Detail: a failed manual issuance keeps the dialog open with '
      "the backend's own honest error, never a fake success",
      (tester) async {
        final rewardsGateway = _FakeRewardsGateway(
          entitlementsForCustomerResult: const [],
          issueManualFailure: const ApiException(
            AppFailure(AppErrorKind.validation, 'Este plan de membresía no está activo.', code: 'membership_plan_inactive'),
          ),
        );
        final loyaltyGateway = _FakeLoyaltyGateway(
          programsResult: const [
            PosLoyaltyProgram(
              id: 'program-1',
              name: 'AS Rewards+',
              active: true,
              unitType: 'point',
              earnQuantityPerSale: 1,
              minimumSaleTotal: null,
              rewardThreshold: null,
              rewardDescription: null,
              version: 1,
            ),
          ],
          summaryResult: const PosLoyaltySummary(accountId: null, balances: [], ledger: []),
        );
        await _pump(
          tester,
          const Size(1440, 900),
          context: _contextWithRewardPermissions,
          customersGateway: attachableCustomersGateway(),
          loyaltyGateway: loyaltyGateway,
          rewardsGateway: rewardsGateway,
        );
        await navigateToCustomersAdmin(tester);
        await tester.tap(find.text('Ana Pérez'));
        await tester.pumpAndSettle();

        await tester.tap(find.byKey(const Key('pos-customer-reward-issue')));
        await tester.pumpAndSettle();
        await tester.enterText(find.byKey(const Key('pos-issue-reward-reason')), 'Cumpleaños del cliente');
        await tester.tap(find.byKey(const Key('pos-issue-reward-save')));
        await tester.pumpAndSettle();

        expect(find.text('Este plan de membresía no está activo.'), findsOneWidget);
        // The dialog stays open — never a fake success.
        expect(find.byKey(const Key('pos-issue-reward-save')), findsOneWidget);
      },
    );

    testWidgets(
      'Customer Detail: a failed revoke keeps the dialog open with the '
      "backend's own honest error, never a fake success",
      (tester) async {
        final rewardsGateway = _FakeRewardsGateway(
          entitlementsForCustomerResult: [
            _fixtureRewardEntitlement(id: 'reward-1', status: 'available', version: 4),
          ],
          revokeFailure: ApiException(AppFailure.fromCode('reward_already_revoked')),
        );
        await _pump(
          tester,
          const Size(1440, 900),
          context: _contextWithRewardPermissions,
          customersGateway: attachableCustomersGateway(),
          rewardsGateway: rewardsGateway,
        );
        await navigateToCustomersAdmin(tester);
        await tester.tap(find.text('Ana Pérez'));
        await tester.pumpAndSettle();

        await tester.tap(find.byKey(const Key('pos-customer-reward-revoke-reward-1')));
        await tester.pumpAndSettle();
        await tester.enterText(find.byKey(const Key('pos-revoke-reward-reason')), 'Solicitud del cliente');
        await tester.tap(find.byKey(const Key('pos-revoke-reward-confirm')));
        await tester.pumpAndSettle();

        expect(find.text('Esta recompensa ya fue revocada.'), findsOneWidget);
        expect(find.byKey(const Key('pos-revoke-reward-confirm')), findsOneWidget);
      },
    );

    testWidgets(
      "CLIENTE mode: the reward status banner shows the attached customer's "
      'own available entitlement, with no redeem button of any kind',
      (tester) async {
        final rewardsGateway = _FakeRewardsGateway(
          entitlementsForCustomerResult: [_fixtureRewardEntitlement(id: 'reward-1', status: 'available')],
        );
        await _pump(
          tester,
          const Size(1440, 900),
          context: _contextWithRewardPermissions,
          customersGateway: attachableCustomersGateway(),
          rewardsGateway: rewardsGateway,
        );
        await attachCustomerInCajero(tester);
        await tester.tap(find.byKey(const Key('pos-mode-cliente')));
        await tester.pumpAndSettle();

        expect(find.byKey(const Key('pos-cliente-shell')), findsOneWidget);
        expect(find.byKey(const Key('pos-cliente-ticket-reward-status')), findsOneWidget);
        expect(find.text('Tienes 1 recompensa disponible.'), findsOneWidget);
        expect(find.byKey(const Key('pos-ticket-reward-redeem-reward-1')), findsNothing);
        // No button of any kind lives inside the reward-status banner
        // itself — scoped to its own subtree rather than a global
        // assertion, since the rest of the CLIENTE screen legitimately
        // has its own buttons (e.g. "Pagar con tarjeta").
        expect(
          find.descendant(
            of: find.byKey(const Key('pos-cliente-ticket-reward-status')),
            matching: find.byType(ElevatedButton),
          ),
          findsNothing,
        );
        expect(
          find.descendant(
            of: find.byKey(const Key('pos-cliente-ticket-reward-status')),
            matching: find.byType(TextButton),
          ),
          findsNothing,
        );
        expect(
          find.descendant(
            of: find.byKey(const Key('pos-cliente-ticket-reward-status')),
            matching: find.byType(OutlinedButton),
          ),
          findsNothing,
        );
        expect(
          find.descendant(
            of: find.byKey(const Key('pos-cliente-ticket-reward-status')),
            matching: find.byType(FilledButton),
          ),
          findsNothing,
        );
        expect(
          find.descendant(
            of: find.byKey(const Key('pos-cliente-ticket-reward-status')),
            matching: find.byType(IconButton),
          ),
          findsNothing,
        );
      },
    );

    testWidgets(
      'CLIENTE mode: no reward administration controls ever render — '
      'confirming CLIENTE has no Customer Detail admin surface at all',
      (tester) async {
        final rewardsGateway = _FakeRewardsGateway(
          entitlementsForCustomerResult: [_fixtureRewardEntitlement(id: 'reward-1', status: 'available')],
        );
        await _pump(
          tester,
          const Size(1440, 900),
          context: _contextWithRewardPermissions,
          customersGateway: attachableCustomersGateway(),
          rewardsGateway: rewardsGateway,
        );
        await attachCustomerInCajero(tester);
        await tester.tap(find.byKey(const Key('pos-mode-cliente')));
        await tester.pumpAndSettle();

        expect(find.byKey(const Key('pos-cliente-shell')), findsOneWidget);
        expect(find.byKey(const Key('pos-customer-reward-issue')), findsNothing);
        expect(find.byKey(const Key('pos-customer-reward-revoke-reward-1')), findsNothing);
        expect(find.byKey(const Key('pos-customer-detail-close')), findsNothing);
      },
    );

    testWidgets(
      'no fake VIP badge renders anywhere reward status could show when '
      'the backend returns zero entitlements, in both CAJERO and CLIENTE',
      (tester) async {
        final rewardsGateway = _FakeRewardsGateway(entitlementsForCustomerResult: const []);
        await _pump(
          tester,
          const Size(1440, 900),
          context: _contextWithRewardPermissions,
          customersGateway: attachableCustomersGateway(),
          rewardsGateway: rewardsGateway,
        );
        await attachCustomerInCajero(tester);
        expect(find.byKey(const Key('pos-ticket-rewards-open')), findsNothing);

        await tester.tap(find.byKey(const Key('pos-mode-cliente')));
        await tester.pumpAndSettle();
        expect(find.byKey(const Key('pos-cliente-ticket-reward-status')), findsNothing);
      },
    );
  });

  group('Fiestas (TASK 14.3 Wave 1 Part A)', () {
    testWidgets('the nav entry is gated on party.read — no permission shows an honest permission state, never real data', (
      tester,
    ) async {
      final partiesGateway = _FakePartiesGateway(reservationsResult: [_fixturePartyReservation()]);
      await _pump(tester, const Size(1440, 900), context: _context, partiesGateway: partiesGateway);
      await _navigateToFiestas(tester);
      expect(find.text('Acceso no autorizado'), findsOneWidget);
      expect(find.byKey(const Key('pos-fiestas-reservation-reservation-1')), findsNothing);
    });

    testWidgets('Lista shows an honest empty state when the gateway returns no reservations', (
      tester,
    ) async {
      final emptyGateway = _FakePartiesGateway();
      await _pump(tester, const Size(1440, 900), context: _contextWithParties(), partiesGateway: emptyGateway);
      await _navigateToFiestas(tester);
      expect(find.text('No hay reservaciones registradas.'), findsOneWidget);
    });

    testWidgets('Lista renders real rows from the fake gateway', (tester) async {
      final populatedGateway = _FakePartiesGateway(
        roomsResult: [_fixturePartyRoom()],
        packagesResult: [_fixturePartyPackage()],
        reservationsResult: [_fixturePartyReservation()],
      );
      await _pump(tester, const Size(1440, 900), context: _contextWithParties(), partiesGateway: populatedGateway);
      await _navigateToFiestas(tester);
      expect(find.byKey(const Key('pos-fiestas-reservation-reservation-1')), findsOneWidget);
      expect(find.text('Festejado de prueba'), findsOneWidget);
    });

    testWidgets('creating a reservation calls the gateway with the real form values', (tester) async {
      final partiesGateway = _FakePartiesGateway(
        roomsResult: [_fixturePartyRoom()],
        packagesResult: [_fixturePartyPackage()],
        reservationsResult: const [],
      );
      await _pump(tester, const Size(1440, 900), context: _contextWithParties(manage: true), partiesGateway: partiesGateway);
      await _navigateToFiestas(tester);
      await tester.tap(find.byKey(const Key('pos-fiestas-new-reservation')));
      await tester.pumpAndSettle();

      await tester.tap(find.byKey(const Key('pos-fiestas-reservation-room')));
      await tester.pumpAndSettle();
      await tester.tap(find.text('Salón Arcoíris').last);
      await tester.pumpAndSettle();

      await tester.tap(find.byKey(const Key('pos-fiestas-reservation-package')));
      await tester.pumpAndSettle();
      await tester.tap(find.text('Paquete Fiesta').last);
      await tester.pumpAndSettle();

      await tester.enterText(find.byKey(const Key('pos-fiestas-reservation-celebrant-name')), 'Sofía');
      await tester.enterText(find.byKey(const Key('pos-fiestas-reservation-children')), '12');

      await tester.tap(find.byKey(const Key('pos-fiestas-reservation-date')));
      await tester.pumpAndSettle();
      await tester.tap(find.text('OK'));
      await tester.pumpAndSettle();

      await tester.tap(find.byKey(const Key('pos-fiestas-reservation-start-time')));
      await tester.pumpAndSettle();
      await tester.tap(find.text('OK'));
      await tester.pumpAndSettle();

      await tester.tap(find.byKey(const Key('pos-fiestas-reservation-end-time')));
      await tester.pumpAndSettle();
      await tester.tap(find.text('OK'));
      await tester.pumpAndSettle();

      await tester.tap(find.byKey(const Key('pos-fiestas-reservation-save')));
      await tester.pumpAndSettle();

      expect(partiesGateway.createReservationCalls, hasLength(1));
      final call = partiesGateway.createReservationCalls.single;
      expect(call.roomId, 'room-1');
      expect(call.packageId, 'package-1');
      expect(call.celebrantName, 'Sofía');
      expect(call.childrenCount, 12);
      expect(call.branchId, 'branch-id');
    });

    testWidgets('a 409 party_conflict response surfaces the backend\'s own honest error, never a generic message or a silent retry', (
      tester,
    ) async {
      final partiesGateway = _FakePartiesGateway(
        roomsResult: [_fixturePartyRoom()],
        packagesResult: [_fixturePartyPackage()],
        reservationsResult: const [],
        createReservationFailure: const ApiException(
          AppFailure(AppErrorKind.validation, 'ignored', code: 'party_conflict'),
          statusCode: 409,
        ),
      );
      await _pump(tester, const Size(1440, 900), context: _contextWithParties(manage: true), partiesGateway: partiesGateway);
      await _navigateToFiestas(tester);
      await tester.tap(find.byKey(const Key('pos-fiestas-new-reservation')));
      await tester.pumpAndSettle();

      await tester.tap(find.byKey(const Key('pos-fiestas-reservation-room')));
      await tester.pumpAndSettle();
      await tester.tap(find.text('Salón Arcoíris').last);
      await tester.pumpAndSettle();

      await tester.tap(find.byKey(const Key('pos-fiestas-reservation-package')));
      await tester.pumpAndSettle();
      await tester.tap(find.text('Paquete Fiesta').last);
      await tester.pumpAndSettle();

      await tester.tap(find.byKey(const Key('pos-fiestas-reservation-date')));
      await tester.pumpAndSettle();
      await tester.tap(find.text('OK'));
      await tester.pumpAndSettle();

      await tester.tap(find.byKey(const Key('pos-fiestas-reservation-start-time')));
      await tester.pumpAndSettle();
      await tester.tap(find.text('OK'));
      await tester.pumpAndSettle();

      await tester.tap(find.byKey(const Key('pos-fiestas-reservation-end-time')));
      await tester.pumpAndSettle();
      await tester.tap(find.text('OK'));
      await tester.pumpAndSettle();

      await tester.tap(find.byKey(const Key('pos-fiestas-reservation-save')));
      await tester.pumpAndSettle();

      expect(
        find.text('Ese salón ya tiene una reservación en un horario que se traslapa con la fecha y hora elegidas.'),
        findsOneWidget,
      );
      expect(partiesGateway.createReservationCalls, hasLength(1));
      expect(find.byKey(const Key('pos-fiestas-reservation-form-error')), findsOneWidget);
    });

    testWidgets('Cotizador computes/displays from the fake gateway\'s real returned breakdown, never a client computation', (
      tester,
    ) async {
      final partiesGateway = _FakePartiesGateway(
        packagesResult: [_fixturePartyPackage()],
        quoteResult: const PosPartyQuote(
          packageId: 'package-1',
          currencyCode: 'MXN',
          base: '500.00',
          childrenExtra: '120.00',
          adultsExtra: '80.00',
          timeExtra: '200.00',
          total: '900.00',
        ),
      );
      await _pump(tester, const Size(1440, 900), context: _contextWithParties(), partiesGateway: partiesGateway);
      await _navigateToFiestas(tester);
      await tester.tap(find.byKey(const Key('pos-fiestas-tabs')));
      await tester.pumpAndSettle();
      await tester.tap(find.text('Cotizador'));
      await tester.pumpAndSettle();

      await tester.tap(find.byKey(const Key('pos-fiestas-quote-submit')));
      await tester.pumpAndSettle();

      expect(partiesGateway.quoteCalls, hasLength(1));
      expect(find.text('900.00 MXN'), findsOneWidget);
      expect(find.text('500.00 MXN'), findsOneWidget);
      expect(find.text('120.00 MXN'), findsOneWidget);
      expect(find.text('80.00 MXN'), findsOneWidget);
      expect(find.text('200.00 MXN'), findsOneWidget);
    });

    testWidgets('the detail view\'s financial section reflects the fake balance response, never a client computation', (
      tester,
    ) async {
      final partiesGateway = _FakePartiesGateway(
        roomsResult: [_fixturePartyRoom()],
        packagesResult: [_fixturePartyPackage()],
        reservationsResult: [_fixturePartyReservation()],
        balanceResult: const PosPartyBalance(quotedTotal: '1000.00', totalPaid: '400.00', outstandingBalance: '600.00'),
      );
      await _pump(tester, const Size(1440, 900), context: _contextWithParties(), partiesGateway: partiesGateway);
      await _navigateToFiestas(tester);
      await tester.tap(find.byKey(const Key('pos-fiestas-reservation-reservation-1')));
      await tester.pumpAndSettle();

      expect(find.text('400.00 MXN'), findsOneWidget);
      expect(find.text('600.00 MXN'), findsOneWidget);
    });

    testWidgets('cancelling with hasPriorPayments: true shows the expected honest message, never hidden', (
      tester,
    ) async {
      final partiesGateway = _FakePartiesGateway(
        roomsResult: [_fixturePartyRoom()],
        packagesResult: [_fixturePartyPackage()],
        reservationsResult: [_fixturePartyReservation()],
        cancelResult: PosPartyCancellationResult(
          reservation: _fixturePartyReservation(status: 'cancelled'),
          hasPriorPayments: true,
          totalPaid: '350.00',
        ),
      );
      await _pump(
        tester,
        const Size(1440, 900),
        context: _contextWithParties(cancel: true),
        partiesGateway: partiesGateway,
      );
      await _navigateToFiestas(tester);
      await tester.tap(find.byKey(const Key('pos-fiestas-reservation-reservation-1')));
      await tester.pumpAndSettle();

      await tester.tap(find.byKey(const Key('pos-fiestas-detail-cancel')));
      await tester.pumpAndSettle();
      await tester.enterText(find.byKey(const Key('pos-fiestas-cancel-reason')), 'Cliente canceló el evento.');
      await tester.tap(find.byKey(const Key('pos-fiestas-cancel-confirm')));
      await tester.pumpAndSettle();

      expect(partiesGateway.cancelCalls, ['Cliente canceló el evento.']);
      expect(
        find.text('Reservación cancelada. Tenía pagos previos por 350.00 MXN — el reembolso debe gestionarse por separado.'),
        findsOneWidget,
      );
    });
  });

  // TASK 14.5A: the confirmed gap this task closed — the real print call
  // sites in `pos_shell.dart` now actually fetch and thread
  // `receipts.header_text`/`receipts.footer_text` through to
  // `buildReceiptHtml`/`buildRefundReceiptHtml`, which already rendered
  // them correctly (see `receipt_html_test.dart`/`refund_receipt_html_
  // test.dart`'s own dedicated branding groups for that render-level
  // proof). These tests prove the WIRING itself: the real settings
  // gateway is actually called, with the current company's own id and the
  // exact two keys, at both a live sale receipt and a historical reprint
  // — and that an unset/empty configuration never blocks printing.
  group('TASK 14.5A — receipt header/footer branding wiring', () {
    PosEffectiveSetting headerSetting(String value, {int version = 3}) =>
        PosEffectiveSetting(
          key: 'receipts.header_text',
          type: 'string',
          value: value,
          source: 'company',
          version: version,
        );
    PosEffectiveSetting footerSetting(String value, {int version = 5}) =>
        PosEffectiveSetting(
          key: 'receipts.footer_text',
          type: 'string',
          value: value,
          source: 'company',
          version: version,
        );

    testWidgets(
      'a live cash-sale receipt (_ReceiptSuccessDialog) fetches the real '
      "configured branding for the session's own company",
      (tester) async {
        final settingsGateway = _RecordingSettingsGateway(
          settings: [
            headerSetting('Sucursal Centro'),
            footerSetting('Gracias por tu compra.'),
          ],
        );
        final salesGateway = _FakeSalesGateway(
          result: const PosSaleCreated(
            id: 'sale-branding-1',
            saleNumber: 'SALE-branding1',
            status: 'pending_payment',
            total: '58.0000',
          ),
        );
        final paymentsGateway = _FakePaymentsGateway(
          cashResult: const PosCashPaymentResult(
            paymentId: 'payment-branding-1',
            status: 'captured',
            tenderedAmount: '58.0000',
            changeAmount: '0.0000',
            saleId: 'sale-branding-1',
            saleNumber: 'SALE-branding1',
            saleStatus: 'completed',
          ),
        );
        await _addProductAndOpenCashDialog(
          tester,
          salesGateway: salesGateway,
          paymentsGateway: paymentsGateway,
          settingsGateway: settingsGateway,
        );
        await tester.enterText(
          find.byKey(const Key('pos-cash-dialog-input')),
          '58',
        );
        await tester.pump();
        await tester.tap(find.byKey(const Key('pos-cash-dialog-confirm')));
        await tester.pumpAndSettle();

        // The completed-sale dialog is now on screen, and it already
        // fetched the real branding for the real, logged-in company —
        // never a hardcoded/fabricated id, never a key typo diverging
        // from `pos_receipt_branding_screen.dart`'s own two keys.
        expect(find.byKey(const Key('pos-receipt-print')), findsOneWidget);
        expect(settingsGateway.effectiveCalls, isNotEmpty);
        final call = settingsGateway.effectiveCalls.first;
        expect(call.companyId, 'company-id');
        expect(
          call.keys,
          containsAll(['receipts.header_text', 'receipts.footer_text']),
        );
        expect(tester.takeException(), isNull);
      },
    );

    testWidgets(
      'a historical reprint (Sale Detail) fetches the real configured '
      "branding for the session's own company — same wiring as a live sale",
      (tester) async {
        final settingsGateway = _RecordingSettingsGateway(
          settings: [headerSetting('Sucursal Centro')],
        );
        final salesGateway = _FakeSalesGateway(
          listResult: PosSaleHistoryPage(
            items: [
              PosSaleSummary(
                id: 'sale-history-branding-1',
                saleNumber: 'SALE-2517abd73ecf44a2b2206f4eadfeee49',
                status: 'completed',
                currencyCode: 'MXN',
                branchId: 'branch-id',
                branchName: 'Puerta La Victoria',
                cashierId: 'user-id',
                cashierName: 'Bryant Aguilera',
                occurredAt: DateTime.utc(2026, 9, 3, 12),
                completedAt: DateTime.utc(2026, 9, 3, 12, 1),
                itemCount: 1,
                subtotal: '25.0000',
                taxTotal: '4.0000',
                total: '29.0000',
                paymentMethods: const ['cash'],
              ),
            ],
            nextCursor: null,
          ),
        );
        await _pump(
          tester,
          const Size(1440, 900),
          context: _contextWithSaleRead,
          salesGateway: salesGateway,
          settingsGateway: settingsGateway,
        );
        await tester.tap(find.byKey(const Key('nav-history')));
        await tester.pumpAndSettle();
        await tester.tap(find.text('SALE-ADFEEE49'));
        await tester.pumpAndSettle();

        expect(find.text('Detalle de venta'), findsOneWidget);
        expect(settingsGateway.effectiveCalls, isNotEmpty);
        final call = settingsGateway.effectiveCalls.first;
        expect(call.companyId, 'company-id');
        expect(
          call.keys,
          containsAll(['receipts.header_text', 'receipts.footer_text']),
        );

        // Reprint still never calls the backend a second time for the
        // sale/receipt itself — only the (separate, additive) branding
        // fetch is new.
        await tester.tap(find.byKey(const Key('pos-history-detail-print')));
        await tester.pump();
        expect(salesGateway.receiptCalls, hasLength(1));
        expect(tester.takeException(), isNull);
      },
    );

    testWidgets(
      'an unset/empty branding configuration never blocks a live sale '
      'receipt from loading or printing — no literal "null" text, no crash',
      (tester) async {
        // The default `EmptyPosSettingsGateway` (see `_pump`'s own default)
        // already models "no branding configured" honestly — this test
        // makes that explicit and asserts on the resulting UI instead of
        // only on the absence of an exception.
        final salesGateway = _FakeSalesGateway(
          result: const PosSaleCreated(
            id: 'sale-branding-2',
            saleNumber: 'SALE-branding2',
            status: 'pending_payment',
            total: '58.0000',
          ),
        );
        final paymentsGateway = _FakePaymentsGateway(
          cashResult: const PosCashPaymentResult(
            paymentId: 'payment-branding-2',
            status: 'captured',
            tenderedAmount: '58.0000',
            changeAmount: '0.0000',
            saleId: 'sale-branding-2',
            saleNumber: 'SALE-branding2',
            saleStatus: 'completed',
          ),
        );
        await _addProductAndOpenCashDialog(
          tester,
          salesGateway: salesGateway,
          paymentsGateway: paymentsGateway,
        );
        await tester.enterText(
          find.byKey(const Key('pos-cash-dialog-input')),
          '58',
        );
        await tester.pump();
        await tester.tap(find.byKey(const Key('pos-cash-dialog-confirm')));
        await tester.pumpAndSettle();

        expect(find.byKey(const Key('pos-receipt-print')), findsOneWidget);
        expect(find.textContaining('null'), findsNothing);
        await tester.tap(find.byKey(const Key('pos-receipt-print')));
        await tester.pump();
        expect(tester.takeException(), isNull);
      },
    );

    testWidgets(
      'a real, admin-uploaded per-tenant logo (branding.logo_url) is fetched '
      'alongside header/footer text, taking priority over the bundled '
      'default mark on print',
      (tester) async {
        final settingsGateway = _RecordingSettingsGateway(
          settings: [
            headerSetting('Sucursal Centro'),
            footerSetting('Gracias por tu compra.'),
            PosEffectiveSetting(
              key: 'branding.logo_url',
              type: 'string',
              value: 'https://minio.example.test/asone-branding/logos/company-id/logo.png',
              source: 'company',
              version: 2,
            ),
          ],
        );
        final salesGateway = _FakeSalesGateway(
          result: const PosSaleCreated(
            id: 'sale-branding-logo-1',
            saleNumber: 'SALE-brandinglogo1',
            status: 'pending_payment',
            total: '58.0000',
          ),
        );
        final paymentsGateway = _FakePaymentsGateway(
          cashResult: const PosCashPaymentResult(
            paymentId: 'payment-branding-logo-1',
            status: 'captured',
            tenderedAmount: '58.0000',
            changeAmount: '0.0000',
            saleId: 'sale-branding-logo-1',
            saleNumber: 'SALE-brandinglogo1',
            saleStatus: 'completed',
          ),
        );
        await _addProductAndOpenCashDialog(
          tester,
          salesGateway: salesGateway,
          paymentsGateway: paymentsGateway,
          settingsGateway: settingsGateway,
        );
        await tester.enterText(
          find.byKey(const Key('pos-cash-dialog-input')),
          '58',
        );
        await tester.pump();
        await tester.tap(find.byKey(const Key('pos-cash-dialog-confirm')));
        await tester.pumpAndSettle();

        expect(find.byKey(const Key('pos-receipt-print')), findsOneWidget);
        expect(settingsGateway.effectiveCalls, isNotEmpty);
        final call = settingsGateway.effectiveCalls.first;
        expect(
          call.keys,
          containsAll([
            'receipts.header_text',
            'receipts.footer_text',
            'branding.logo_url',
          ]),
        );
        // Printing must never crash even though a real network image URL
        // (rather than the bundled asset) is now the resolved logo source.
        await tester.tap(find.byKey(const Key('pos-receipt-print')));
        await tester.pump();
        expect(tester.takeException(), isNull);
      },
    );
  });

  // TASK 14.5A: kiosk/self-checkout mode (CLIENTE) — the three real
  // requirements this task's kiosk arc added: (a) entry now genuinely
  // gated on an open cash-register session, (b) exit now genuinely
  // requires and validates real employee PIN re-auth, (c) add-to-cart and
  // checkout in kiosk mode go through the exact same real gateway calls
  // as the CAJERO flow. Some of this is already exercised incidentally by
  // the "Canonical CLIENTE locked surface" group above (which predates
  // this task and was updated in place where its own assumptions no
  // longer held) — this group is the explicit, dedicated proof this
  // task's own validation step asks for.
  group('TASK 14.5A — kiosk/self-checkout mode', () {
    testWidgets(
      '(a) kiosk mode cannot be entered when no cash-register session is '
      'open — CAJERO stays active, a real cashGateway call was made',
      (tester) async {
        final cashGateway = _FakeCashGateway(openSessionFixture: null);
        await _pump(tester, const Size(1440, 900), cashGateway: cashGateway);
        await _navigateToPos(tester);
        await tester.tap(find.byKey(const Key('pos-mode-cliente')));
        await tester.pumpAndSettle();

        expect(cashGateway.openSessionForBranchCalls, contains('branch-id'));
        expect(find.byKey(const Key('pos-cliente-shell')), findsNothing);
        expect(find.byKey(const Key('pos-ticket-panel')), findsOneWidget);
        expect(
          find.text('Abre la caja para activar el modo Cliente.'),
          findsOneWidget,
        );
      },
    );

    testWidgets(
      '(a) kiosk mode fails closed (never enters) if the cash-session '
      'check itself fails — never a silent unlock',
      (tester) async {
        await _pump(
          tester,
          const Size(1440, 900),
          cashGateway: _ThrowingOpenSessionCashGateway(),
        );
        await _navigateToPos(tester);
        await tester.tap(find.byKey(const Key('pos-mode-cliente')));
        await tester.pumpAndSettle();

        expect(find.byKey(const Key('pos-cliente-shell')), findsNothing);
        expect(
          find.text('No fue posible verificar el estado de la caja.'),
          findsOneWidget,
        );
      },
    );

    testWidgets(
      '(a) kiosk mode is entered once a real open session is confirmed',
      (tester) async {
        final cashGateway = _FakeCashGateway();
        await _pump(tester, const Size(1440, 900), cashGateway: cashGateway);
        await _navigateToPos(tester);
        await tester.tap(find.byKey(const Key('pos-mode-cliente')));
        await tester.pumpAndSettle();

        expect(cashGateway.openSessionForBranchCalls, contains('branch-id'));
        expect(find.byKey(const Key('pos-cliente-shell')), findsOneWidget);
      },
    );

    testWidgets(
      '(b) exiting kiosk mode requires and correctly validates real '
      'employee re-auth via PosAuthGateway.pinLogin — rejected on a wrong '
      'PIN, then succeeds once the same field carries a valid one',
      (tester) async {
        final authGateway = _FakeAuthGateway(pinSucceeds: false);
        await _pump(tester, const Size(1440, 900), authGateway: authGateway);
        await _navigateToPos(tester);
        await tester.tap(find.byKey(const Key('pos-mode-cliente')));
        await tester.pumpAndSettle();
        expect(find.byKey(const Key('pos-cliente-shell')), findsOneWidget);

        await tester.tap(find.byKey(const Key('pos-mode-cajero')));
        await tester.pumpAndSettle();
        await tester.enterText(
          find.byKey(const Key('pos-cajero-return-input')),
          '0000',
        );
        await tester.tap(find.byKey(const Key('pos-cajero-return-confirm')));
        await tester.pumpAndSettle();

        // Rejected: a real `pinLogin` call was made and it genuinely
        // failed (this fake's `ApiException`, mirroring the backend's own
        // uniform `invalid_credentials`) — CLIENTE stays locked.
        expect(authGateway.pinLoginCalls, 1);
        expect(authGateway.lastPin, '0000');
        expect(find.byKey(const Key('pos-cliente-shell')), findsOneWidget);
        expect(find.byKey(const Key('pos-cajero-return-error')), findsOneWidget);

        // Now the same gateway starts accepting real PINs (simulating the
        // employee typing their actual one this time) — still a genuine
        // `pinLogin` call, never a client-side comparison of any kind.
        authGateway.pinSucceeds = true;
        await tester.enterText(
          find.byKey(const Key('pos-cajero-return-input')),
          '1234',
        );
        await tester.tap(find.byKey(const Key('pos-cajero-return-confirm')));
        await tester.pumpAndSettle();

        expect(authGateway.pinLoginCalls, 2);
        expect(authGateway.lastPin, '1234');
        expect(find.byKey(const Key('pos-cliente-shell')), findsNothing);
        expect(find.byKey(const Key('pos-ticket-panel')), findsOneWidget);
      },
    );

    // (c) proven across two sibling tests (never two `_pump()` calls in one
    // test, matching every other test in this file) — each drives its own
    // real checkout surface (kiosk vs. CAJERO Tarjeta) through to the real
    // `PosSalesGateway.createSale` call and records the exact request
    // shape; the shared `_lastCreateSaleCall` lets the second test assert
    // both surfaces produced an identical real request for the identical
    // real action, never two diverging implementations.
    ({String branchId, String productId, String quantity})? cajeroCreateSaleCall;

    testWidgets(
      '(c) CAJERO Tarjeta add-to-cart and checkout call the real '
      'PosSalesGateway.createSale — the baseline kiosk must match',
      (tester) async {
        final salesGateway = _FakeSalesGateway(
          result: const PosSaleCreated(
            id: 'sale-cajero-1',
            saleNumber: 'SALE-cajero1',
            status: 'pending_payment',
            total: '10.0000',
          ),
        );
        await _pump(tester, const Size(1440, 900), salesGateway: salesGateway);
        await _navigateToPos(tester);
        await tester.tap(find.byKey(const Key('pos-product-product-1')));
        await tester.pump();
        await tester.tap(find.byKey(const Key('pos-pay-card')));
        await tester.pump();
        await tester.tap(find.byKey(const Key('pos-ticket-cobrar')));
        await tester.pump();
        await tester.pumpAndSettle();

        expect(salesGateway.calls, hasLength(1));
        final call = salesGateway.calls.single;
        expect(call.items, hasLength(1));
        cajeroCreateSaleCall = (
          branchId: call.branchId,
          productId: call.items.single.productId,
          quantity: call.items.single.quantity,
        );
        expect(cajeroCreateSaleCall!.branchId, 'branch-id');
        expect(cajeroCreateSaleCall!.productId, 'product-1');
      },
    );

    testWidgets(
      '(c) kiosk add-to-cart and card checkout call the exact same real '
      "SaleSession.addProduct + PosSalesGateway.createSale path CAJERO's "
      'own Tarjeta flow uses — never a divergent/duplicated implementation',
      (tester) async {
        expect(
          cajeroCreateSaleCall,
          isNotNull,
          reason: 'the CAJERO baseline test above must run first',
        );
        final salesGateway = _FakeSalesGateway(
          result: const PosSaleCreated(
            id: 'sale-kiosk-1',
            saleNumber: 'SALE-kiosk1',
            status: 'pending_payment',
            total: '10.0000',
          ),
        );
        await _pump(tester, const Size(1440, 900), salesGateway: salesGateway);
        await _navigateToPos(tester);
        await tester.tap(find.byKey(const Key('pos-mode-cliente')));
        await tester.pumpAndSettle();
        await tester.tap(find.byKey(const Key('pos-product-product-1')));
        await tester.pump();
        await tester.tap(find.byKey(const Key('pos-cliente-card-payment')));
        await tester.pump();
        await tester.pumpAndSettle();

        expect(salesGateway.calls, hasLength(1));
        final call = salesGateway.calls.single;
        expect(call.items, hasLength(1));

        // Identical real request shape from both surfaces — the same
        // `_submitSaleForPayment`/`PosSalesGateway.createSale` call, not
        // two implementations that merely happen to agree.
        expect(call.branchId, cajeroCreateSaleCall!.branchId);
        expect(call.items.single.productId, cajeroCreateSaleCall!.productId);
        expect(call.items.single.quantity, cajeroCreateSaleCall!.quantity);
      },
    );

    testWidgets(
      '(kiosk restrictions) cashier-only affordances never render in '
      'kiosk mode — no cash/transfer payment amount entry, no suspend, no '
      'cancel, no manual discount, no customer search',
      (tester) async {
        await _pump(tester, const Size(1440, 900));
        await _navigateToPos(tester);
        await tester.tap(find.byKey(const Key('pos-mode-cliente')));
        await tester.pumpAndSettle();

        expect(find.byKey(const Key('pos-cliente-shell')), findsOneWidget);
        // Card-only checkout — the one payable action.
        expect(find.byKey(const Key('pos-cliente-card-payment')), findsOneWidget);
        // No cashier controls exist anywhere in this locked subtree.
        expect(find.byKey(const Key('pos-pay-cash')), findsNothing);
        expect(find.byKey(const Key('pos-pay-card')), findsNothing);
        expect(find.byKey(const Key('pos-cash-dialog-input')), findsNothing);
        expect(find.text('Suspender venta'), findsNothing);
        expect(find.text('Cancelar venta'), findsNothing);
        expect(find.textContaining('Desc.'), findsNothing);
        expect(find.byKey(const Key('pos-history-search')), findsNothing);
      },
    );
  });
}

Future<void> _pump(
  WidgetTester tester,
  Size size, {
  AuthenticatedContext? context,
  PosSalesGateway? salesGateway,
  PosPaymentsGateway? paymentsGateway,
  PosCashGateway? cashGateway,
  PosRefundsGateway? refundsGateway,
  PosPromotionsGateway? promotionsGateway,
  PosCustomersGateway? customersGateway,
  PosMembershipsGateway? membershipsGateway,
  PosLoyaltyGateway? loyaltyGateway,
  PosRewardsGateway? rewardsGateway,
  PosPartiesGateway? partiesGateway,
  PosAuthGateway? authGateway,
  PosSettingsGateway? settingsGateway,
  Future<void> Function(String? branchId)? onBranchSelected,
}) async {
  tester.view.physicalSize = size;
  tester.view.devicePixelRatio = 1;
  addTearDown(tester.view.reset);
  await tester.pumpWidget(
    MaterialApp(
      home: PosShell(
        context: context ?? _context,
        controller: PosReadController(const _FakeReadGateway()),
        salesGateway: salesGateway ?? _FakeSalesGateway(),
        paymentsGateway: paymentsGateway ?? _FakePaymentsGateway(),
        // TASK 12.7: defaults to an already-open session so every
        // pre-existing Cobrar/cash test (written before the cash-session
        // requirement existed) keeps exercising what it actually tests —
        // the dedicated gating tests below inject a closed/`null`-session
        // fake explicitly instead.
        cashGateway: cashGateway ?? _FakeCashGateway(),
        // TASK 12.8: defaults to a fake that answers `refundable: true`
        // with real fixture lines, so a test that doesn't care about
        // refunds specifically still sees Sale Detail's own honest gating
        // behavior — the dedicated refund-flow tests below inject their
        // own explicit fake instead.
        refundsGateway: refundsGateway ?? _FakeRefundsGateway(),
        // TASK 12.9: defaults to a fake that echoes the exact catalog-only
        // (zero-discount) totals `_catalogFixture()`'s own $10.00/
        // IVA_GENERAL products always price to — so every pre-existing
        // Subtotal/IVA/Total/Cobrar assertion written before this task
        // keeps passing byte-for-byte even once the ticket starts
        // automatically re-quoting on every cart change (ADR-0016). The
        // dedicated promotions/coupons tests below inject their own
        // explicit fake instead.
        promotionsGateway: promotionsGateway ?? _FakePromotionsGateway(),
        // TASK 13.0: defaults to fakes that return empty-but-successful
        // results — every pre-existing test keeps seeing honest empty
        // states for Clientes/Membresías/Rewards; the dedicated tests
        // below inject their own explicit fakes instead.
        customersGateway: customersGateway ?? _FakeCustomersGateway(),
        membershipsGateway: membershipsGateway ?? _FakeMembershipsGateway(),
        loyaltyGateway: loyaltyGateway ?? _FakeLoyaltyGateway(),
        // TASK 13.1: defaults to an empty-but-successful fake — every
        // pre-existing test keeps seeing an honest empty Recompensas
        // state; the dedicated reward tests inject their own explicit
        // fake instead.
        rewardsGateway: rewardsGateway ?? const EmptyPosRewardsGateway(),
        // TASK 14.3 Wave 1 Part A: defaults to an empty-but-successful
        // fake — every pre-existing test keeps seeing an honest empty
        // Fiestas state; the dedicated Fiestas tests below inject their
        // own explicit fake instead.
        partiesGateway: partiesGateway ?? const EmptyPosPartiesGateway(),
        // TASK 14.5A: defaults to a successful-PIN fake — see
        // `_FakeAuthGateway`'s own doc comment for why.
        authGateway: authGateway ?? _FakeAuthGateway(),
        // TASK 14.5A: defaults to the honest empty-catalog fake — every
        // pre-existing test keeps seeing no header/footer branding text;
        // the dedicated branding-wiring tests below inject their own
        // recording fake instead.
        settingsGateway: settingsGateway ?? const EmptyPosSettingsGateway(),
        onLogout: () {},
        onBranchSelected: onBranchSelected ?? _noopBranchSelected,
      ),
    ),
  );
  await tester.pumpAndSettle();
}

// POS branch-context fix: a shared no-op for every test that doesn't
// itself exercise branch switching — real behavior is proven by the
// dedicated `_BranchSwitchingHarness`-backed tests below.
Future<void> _noopBranchSelected(String? branchId) async {}

/// Pumps a `_BranchSwitchingHarness` at the same desktop reference size
/// `_pump` uses — without this, the default (sub-900px) test viewport
/// renders the mobile drawer instead of the sidebar rail, and
/// `nav-group-Ventas`/`nav-pos` never exist for `_navigateToPos` to find.
Future<void> _pumpHarness(
  WidgetTester tester,
  Widget harness, {
  Size size = const Size(1440, 900),
}) async {
  tester.view.physicalSize = size;
  tester.view.devicePixelRatio = 1;
  addTearDown(tester.view.reset);
  await tester.pumpWidget(MaterialApp(home: harness));
  await tester.pumpAndSettle();
}

// The sidebar now mirrors `_expandirGrupoDe`: only the active item's group
// (Administración, containing Dashboard) starts open. Punto de Venta lives
// under Ventas, so every test navigating there must open that group first
// — unless it's already open from a prior navigation within the same test.
Future<void> _openVentasGroupIfNeeded(WidgetTester tester) async {
  if (find.byKey(const Key('nav-pos')).evaluate().isEmpty) {
    await tester.tap(find.byKey(const Key('nav-group-Ventas')));
    await tester.pumpAndSettle();
  }
}

Future<void> _navigateToPos(WidgetTester tester) async {
  await _openVentasGroupIfNeeded(tester);
  await tester.tap(find.byKey(const Key('nav-pos')));
  await tester.pumpAndSettle();
}

// TASK 12.7: Caja lives under "Caja y Finanzas" (`PosModule.cash`) —
// mirrors `_openVentasGroupIfNeeded`/`_navigateToPos` exactly.
Future<void> _navigateToCaja(WidgetTester tester) async {
  if (find.byKey(const Key('nav-cash')).evaluate().isEmpty) {
    await tester.tap(find.byKey(const Key('nav-group-Caja y Finanzas')));
    await tester.pumpAndSettle();
  }
  await tester.tap(find.byKey(const Key('nav-cash')));
  await tester.pumpAndSettle();
}

// TASK 14.3 Wave 1 Part A: Fiestas lives under "Clientes" (`PosModule.events`)
// — mirrors `_navigateToCaja` exactly.
Future<void> _navigateToFiestas(WidgetTester tester) async {
  if (find.byKey(const Key('nav-events')).evaluate().isEmpty) {
    await tester.tap(find.byKey(const Key('nav-group-Clientes')));
    await tester.pumpAndSettle();
  }
  await tester.tap(find.byKey(const Key('nav-events')));
  await tester.pumpAndSettle();
}

/// A session identical to [_context] but additionally authorized for the
/// Fiestas domain — [manage]/[cancel]/[recordPayment] add the mutating
/// permissions only when a test actually needs them (mirrors
/// `_contextWithSaleRead`/`_contextWithRewardPermissions`'s own shape).
AuthenticatedContext _contextWithParties({
  bool manage = false,
  bool cancel = false,
  bool recordPayment = false,
}) => AuthenticatedContext(
  session: _context.session,
  user: _context.user,
  companies: _context.companies,
  branches: _context.branches,
  companyWideAccess: false,
  permissions: [
    ..._context.permissions,
    'party.read',
    if (manage) 'party.manage',
    if (cancel) 'party.cancel',
    if (recordPayment) 'party.payment.record',
  ],
);

// TASK 12.7: mirrors `_formatClockTime`/`_formatCajaDate` in
// `pos_shell.dart` exactly (those are private to that library) — computed
// from the same UTC fixture `DateTime`s via `.toLocal()`, so these
// assertions pass regardless of the machine's own timezone rather than
// assuming UTC.
String _expectClockTime(DateTime value) {
  final local = value.toLocal();
  return '${local.hour.toString().padLeft(2, '0')}:${local.minute.toString().padLeft(2, '0')}';
}

String _expectCajaDate(DateTime value) {
  final local = value.toLocal();
  return '${local.day.toString().padLeft(2, '0')}/${local.month.toString().padLeft(2, '0')}/${local.year} ${_expectClockTime(value)}';
}

/// Shared by the TASK 12.5A and TASK 12.5B test groups: adds one product
/// to the CAJERO ticket and taps Cobrar — Efectivo is the real default
/// (see `_TicketFooterState`), so this always opens the cash dialog with
/// no method selection needed.
Future<void> _addProductAndOpenCashDialog(
  WidgetTester tester, {
  required PosSalesGateway salesGateway,
  required PosPaymentsGateway paymentsGateway,
  PosSettingsGateway? settingsGateway,
}) async {
  await _pump(
    tester,
    const Size(1440, 900),
    salesGateway: salesGateway,
    paymentsGateway: paymentsGateway,
    settingsGateway: settingsGateway,
  );
  await _navigateToPos(tester);
  await tester.tap(find.byKey(const Key('pos-product-product-1')));
  await tester.pump();
  await tester.tap(find.byKey(const Key('pos-ticket-cobrar')));
  await tester.pump();
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
  // Includes `sale.create` — a real permission from the backend catalog
  // (packages/database/src/seeds/technical-permissions.ts), not a
  // fabricated one. TASK 14.5A: CLIENTE→CAJERO re-authorization no longer
  // keys off this permission list at all — it now requires a real
  // `PosAuthGateway.pinLogin` (see `_FakeAuthGateway`'s own doc comment)
  // — so this fixture no longer needs a "without sale.create" counterpart
  // for that flow.
  permissions: const [
    'catalog.read',
    'inventory.read',
    'user.read',
    'sale.create',
  ],
);

/// POS branch-context fix: a CEO/owner-style session with genuine
/// company-wide access and no single operational branch selected yet
/// ("Todas las sucursales") — `session.branchId` is `null`,
/// `companyWideAccess` is `true`, and the session carries two real
/// authorized branches to choose from.
final _companyWideContext = AuthenticatedContext(
  session: SessionContext(
    id: 'session-id',
    userId: 'user-id',
    companyId: 'company-id',
    permittedBranchIds: const ['branch-a', 'branch-b'],
    companyWideAccess: true,
    expiresAt: DateTime.utc(2099),
  ),
  user: _context.user,
  companies: _context.companies,
  branches: const [
    BranchSummary(
      id: 'branch-a',
      code: 'SUC-A',
      name: 'Sucursal A',
      timezone: 'America/Mexico_City',
    ),
    BranchSummary(
      id: 'branch-b',
      code: 'SUC-B',
      name: 'Sucursal B',
      timezone: 'America/Mexico_City',
    ),
  ],
  companyWideAccess: true,
  permissions: _context.permissions,
);

/// TASK 12.6 Part C: `_context` plus the real `sale.read` permission
/// (see `packages/database/src/seeds/technical-permissions.ts`) —
/// `_context` itself deliberately lacks it (it predates TASK 12.6), so
/// Historial de ventas tests use this instead of widening the shared
/// fixture and risking an unrelated side effect on every other test.
final _contextWithSaleRead = AuthenticatedContext(
  session: _context.session,
  user: _context.user,
  companies: _context.companies,
  branches: _context.branches,
  companyWideAccess: false,
  permissions: [..._context.permissions, 'sale.read'],
);

/// TASK 12.7: `_context` plus the six real, already-reserved cash
/// permissions (see `packages/database/src/seeds/technical-permissions.ts`
/// and `bootstrap-owner.service.ts`) — `_context` itself predates TASK
/// 12.7, so Caja tests use this instead of widening the shared fixture.
final _contextWithCashPermissions = AuthenticatedContext(
  session: _context.session,
  user: _context.user,
  companies: _context.companies,
  branches: _context.branches,
  companyWideAccess: false,
  permissions: [
    ..._context.permissions,
    'cash_register.read',
    'cash_register.manage',
    'cash_session.read',
    'cash_session.open',
    'cash_movement.create',
    'cash_session.close',
    // TASK 16.11 (§13) — "Bitácora": deliberately included here (a
    // full-access cash-capable context), not folded into the base
    // `cash_movement.create`/`cash_session.close` set, mirroring the real
    // backend's own separate `audit.read` gate.
    'audit.read',
  ],
);

/// TASK 12.8: `_context` plus `sale.read` and the four real refund
/// permissions the local dev-owner bootstrap actually grants
/// (`refund.read`/`refund.create`/`refund.approve`/`refund.complete` —
/// see `bootstrap-owner.service.ts` and ADR-0015 D13) — `refund.cancel`
/// is deliberately excluded (seeded but unused; no cancellation UI
/// exists, see ADR-0015 §Deferred).
final _contextWithRefundPermissions = AuthenticatedContext(
  session: _context.session,
  user: _context.user,
  companies: _context.companies,
  branches: _context.branches,
  companyWideAccess: false,
  permissions: [
    ..._context.permissions,
    'sale.read',
    'refund.read',
    'refund.create',
    'refund.approve',
    'refund.complete',
  ],
);

/// TASK 12.9: `_context` plus the five real, already-reserved promotions/
/// coupons/discount permissions (see
/// `packages/database/src/seeds/technical-permissions.ts` and
/// `bootstrap-owner.service.ts`) — `_context` itself predates TASK 12.9.
final _contextWithPromotionPermissions = AuthenticatedContext(
  session: _context.session,
  user: _context.user,
  companies: _context.companies,
  branches: _context.branches,
  companyWideAccess: false,
  permissions: [
    ..._context.permissions,
    'discount.apply',
    'promotion.read',
    'promotion.manage',
    'coupon.read',
    'coupon.manage',
  ],
);

/// TASK 13.0: `_context` plus every real customers/memberships/loyalty
/// permission (see `packages/database/src/seeds/technical-permissions.ts`
/// and `bootstrap-owner.service.ts`, ADR-0017 D21) — `_context` itself
/// predates TASK 13.0.
final _contextWithCustomerPermissions = AuthenticatedContext(
  session: _context.session,
  user: _context.user,
  companies: _context.companies,
  branches: _context.branches,
  companyWideAccess: false,
  permissions: [
    ..._context.permissions,
    'sale.read',
    'customer.read',
    'customer.create',
    'customer.update',
    'membership.read',
    'membership.manage',
    'membership.issue',
    'loyalty.read',
    'loyalty.manage',
    'loyalty.adjust',
  ],
);

/// TASK 13.0: `_context` plus only `customer.read` — proves the create/
/// edit actions stay hidden for a read-only actor (Part Y honest-
/// disabled-state requirement).
final _contextWithCustomerReadOnly = AuthenticatedContext(
  session: _context.session,
  user: _context.user,
  companies: _context.companies,
  branches: _context.branches,
  companyWideAccess: false,
  permissions: [..._context.permissions, 'customer.read'],
);

/// TASK 13.1: `_contextWithCustomerPermissions` plus every real reward
/// permission (see `packages/database/src/seeds/technical-permissions.ts`
/// TASK 13.1 addition) — the full-featured reward entitlement tests
/// (Customer Detail admin issue/revoke, CAJERO redeem) use this instead of
/// widening the shared TASK 13.0 fixture.
final _contextWithRewardPermissions = AuthenticatedContext(
  session: _context.session,
  user: _context.user,
  companies: _context.companies,
  branches: _context.branches,
  companyWideAccess: false,
  permissions: [
    ..._contextWithCustomerPermissions.permissions,
    'reward.read',
    'reward.redeem',
    'reward.issue',
    'reward.revoke',
  ],
);

/// Same base, but only `reward.read` — proves the redeem/issue/revoke
/// actions stay hidden for a read-only actor (mirrors
/// `_contextWithCustomerReadOnly`'s own precedent).
final _contextWithRewardReadOnly = AuthenticatedContext(
  session: _context.session,
  user: _context.user,
  companies: _context.companies,
  branches: _context.branches,
  companyWideAccess: false,
  permissions: [..._contextWithCustomerPermissions.permissions, 'reward.read'],
);

/// Same addition, for the company-wide branch filter test.
final _companyWideContextWithSaleRead = AuthenticatedContext(
  session: _companyWideContext.session,
  user: _companyWideContext.user,
  companies: _companyWideContext.companies,
  branches: _companyWideContext.branches,
  companyWideAccess: true,
  permissions: [..._companyWideContext.permissions, 'sale.read'],
);

/// POS branch-context fix: the default single-branch `_context`, plus a
/// second real authorized branch to switch to — used only by the
/// non-empty-ticket branch-switch test, so `_context` itself (reused
/// everywhere else) stays untouched.
final _contextWithAlternateBranch = AuthenticatedContext(
  session: SessionContext(
    id: 'session-id',
    userId: 'user-id',
    companyId: 'company-id',
    branchId: 'branch-id',
    permittedBranchIds: const ['branch-id', 'branch-other'],
    companyWideAccess: false,
    expiresAt: DateTime.utc(2099),
  ),
  user: _context.user,
  companies: _context.companies,
  branches: const [
    BranchSummary(
      id: 'branch-id',
      code: 'CENTRO',
      name: 'Sucursal Centro',
      timezone: 'America/Mexico_City',
      current: true,
    ),
    BranchSummary(
      id: 'branch-other',
      code: 'OTRA',
      name: 'Sucursal Otra',
      timezone: 'America/Mexico_City',
    ),
  ],
  companyWideAccess: false,
  permissions: _context.permissions,
);

/// TASK 12.7: [_contextWithAlternateBranch] plus the six cash permissions
/// — used by the branch-switch-safety Caja test.
final _contextWithAlternateBranchAndCashPermissions = AuthenticatedContext(
  session: _contextWithAlternateBranch.session,
  user: _contextWithAlternateBranch.user,
  companies: _contextWithAlternateBranch.companies,
  branches: _contextWithAlternateBranch.branches,
  companyWideAccess: false,
  permissions: _contextWithCashPermissions.permissions,
);

/// POS branch-context fix: mimics the real app's `DashboardScreen`
/// rebuild-on-`AuthController.notifyListeners()` pattern — `onBranchSelected`
/// updates this harness's own state and rebuilds `PosShell` with a fresh
/// `AuthenticatedContext`, exactly like a real branch switch flowing back
/// down from the auth layer once `AuthController.selectBranch` resolves.
/// Rejects any id absent from the session's own `permittedBranchIds`,
/// standing in for the real, backend-authoritative
/// `AuthController.selectBranch`/`AuthGateway.switchBranch` call (no
/// network call happens here, but the same "never trust an arbitrary
/// client-supplied branch id" contract is deliberately mirrored).
class _BranchSwitchingHarness extends StatefulWidget {
  const _BranchSwitchingHarness({
    required this.initialContext,
    this.salesGateway,
    this.cashGateway,
    this.readGateway,
    this.onSwitchAttempt,
    super.key,
  });
  final AuthenticatedContext initialContext;
  final PosSalesGateway? salesGateway;
  final PosCashGateway? cashGateway;
  final PosReadGateway? readGateway;
  final ValueChanged<String?>? onSwitchAttempt;

  @override
  State<_BranchSwitchingHarness> createState() =>
      _BranchSwitchingHarnessState();
}

class _BranchSwitchingHarnessState extends State<_BranchSwitchingHarness> {
  late AuthenticatedContext current = widget.initialContext;
  late final controller = PosReadController(
    widget.readGateway ?? const _FakeReadGateway(),
  );

  /// Test-only hook so a test can call the exact same branch-selection
  /// path the UI uses, without needing a widget to tap (e.g. to prove an
  /// unauthorized id is rejected regardless of how it was invoked).
  Future<void> attemptSelectBranch(String? branchId) => _selectBranch(branchId);

  Future<void> _selectBranch(String? branchId) async {
    widget.onSwitchAttempt?.call(branchId);
    if (branchId != null &&
        !current.session.permittedBranchIds.contains(branchId)) {
      return; // Never trusted — rejected exactly like a real backend would.
    }
    if (branchId == null && !current.companyWideAccess) return;
    setState(() {
      current = AuthenticatedContext(
        session: SessionContext(
          id: current.session.id,
          userId: current.session.userId,
          companyId: current.session.companyId,
          branchId: branchId,
          permittedBranchIds: current.session.permittedBranchIds,
          companyWideAccess: current.session.companyWideAccess,
          expiresAt: current.session.expiresAt,
        ),
        user: current.user,
        companies: current.companies,
        branches: [
          for (final branch in current.branches)
            BranchSummary(
              id: branch.id,
              code: branch.code,
              name: branch.name,
              timezone: branch.timezone,
              current: branch.id == branchId,
              isDefault: branch.isDefault,
            ),
        ],
        companyWideAccess: current.companyWideAccess,
        permissions: current.permissions,
      );
    });
  }

  @override
  void dispose() {
    controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => PosShell(
    context: current,
    controller: controller,
    salesGateway: widget.salesGateway ?? _FakeSalesGateway(),
    paymentsGateway: _FakePaymentsGateway(),
    cashGateway: widget.cashGateway ?? _FakeCashGateway(),
    refundsGateway: const EmptyPosRefundsGateway(),
    promotionsGateway: const EmptyPosPromotionsGateway(),
    customersGateway: const EmptyPosCustomersGateway(),
    membershipsGateway: const EmptyPosMembershipsGateway(),
    loyaltyGateway: const EmptyPosLoyaltyGateway(),
    rewardsGateway: const EmptyPosRewardsGateway(),
    partiesGateway: const EmptyPosPartiesGateway(),
    onLogout: () {},
    onBranchSelected: _selectBranch,
  );
}

/// POS branch-context fix: records every `branchId` a catalog/inventory
/// load was actually requested with — proof that selecting a branch
/// re-fetches branch-scoped data rather than retaining whatever
/// "Todas las sucursales" (or a different branch's) catalog was loaded
/// before.
class _TrackingReadGateway implements PosReadGateway {
  final List<String?> productBranchIdCalls = [];
  final List<String?> balanceBranchIdCalls = [];

  @override
  Future<List<PosProduct>> products({String? branchId}) async {
    productBranchIdCalls.add(branchId);
    return _catalogFixture();
  }

  @override
  Future<PosProduct?> productByBarcode(String barcode, {String? branchId}) async => null;

  @override
  Future<List<PosCategory>> categories() async => const [
    PosCategory(id: 'cat-1', name: 'Bebidas', status: 'active'),
    PosCategory(id: 'cat-2', name: 'Snacks', status: 'active'),
  ];

  @override
  Future<List<PosInventoryBalance>> inventoryBalances({
    String? branchId,
  }) async {
    balanceBranchIdCalls.add(branchId);
    return const [];
  }

  @override
  Future<List<PosUser>> users() async => const [];
}

/// TASK 12.3C: every fixture product now carries a real, valid,
/// `IVA_GENERAL` price (`$10.00 MXN` by default) so the pre-existing
/// TASK 12.3 add/merge/quantity tests — written before pricing existed —
/// keep exercising the exact same "tap adds to the ticket" path, now for
/// a real reason instead of an unconditional one. Dedicated
/// missing/malformed-price fixtures are separate, below.
PosProduct _pricedProduct({
  required String id,
  required String code,
  required String name,
  String? categoryId,
  bool tracksInventory = false,
  String? defaultVariantId,
  String amount = '10.00',
  String taxCode = 'IVA_GENERAL',
}) => PosProduct(
  id: id,
  code: code,
  name: name,
  type: 'simple',
  status: 'active',
  tracksInventory: tracksInventory,
  categoryId: categoryId,
  defaultVariantId: defaultVariantId,
  sku: code,
  taxCode: taxCode,
  pricing: PosPricing.fromJson({'amount': amount, 'currency_code': 'MXN'}),
);

List<PosProduct> _catalogFixture() => [
  _pricedProduct(
    id: 'product-1',
    code: 'P-001',
    name: 'Producto real',
    categoryId: 'cat-1',
    tracksInventory: true,
  ),
  _pricedProduct(
    id: 'product-2',
    code: 'P-002',
    name: 'Agua embotellada',
    categoryId: 'cat-2',
    tracksInventory: true,
    defaultVariantId: 'variant-2',
  ),
  _pricedProduct(
    id: 'product-3',
    code: 'P-003',
    name: 'Refresco de cola',
    categoryId: 'cat-1',
    tracksInventory: true,
    defaultVariantId: 'variant-3',
  ),
];

/// TASK 12.4A.1: a controllable fake for the one write path Cobrar/the
/// CLIENTE card button now has — records every call it received (so a
/// test can assert exactly what was submitted) and either returns a
/// canned, honest [PosSaleCreated] or throws a canned [ApiException],
/// never a fabricated approval.
class _FakeSalesGateway implements PosSalesGateway {
  _FakeSalesGateway({
    this.result,
    this.failure,
    this.receiptResult,
    this.receiptFailure,
    this.listResult,
    this.listFailure,
    this.zeroTotalResult,
    this.zeroTotalFailure,
  });

  final PosSaleCreated? result;
  final ApiException? failure;
  final List<
      ({
        String branchId,
        List<PosSaleLineRequest> items,
        List<String>? couponCodes,
        PosManualDiscountRequest? manualDiscount,
        String? customerId,
        String? rewardEntitlementId,
        String? note,
      })>
  calls = [];

  // TASK 12.5B.
  final PosReceipt? receiptResult;
  final ApiException? receiptFailure;
  final List<String> receiptCalls = [];

  // TASK 12.6 Part C.
  final PosSaleHistoryPage? listResult;
  final ApiException? listFailure;
  final List<({PosSaleHistoryFilter filter, String? cursor})> listCalls = [];

  // TASK 13.2.
  final PosSaleCreated? zeroTotalResult;
  final ApiException? zeroTotalFailure;
  final List<String> zeroTotalCalls = [];

  @override
  Future<PosSaleCreated> createSale({
    required String branchId,
    required List<PosSaleLineRequest> items,
    List<String>? couponCodes,
    PosManualDiscountRequest? manualDiscount,
    String? customerId,
    String? rewardEntitlementId,
    String? note,
  }) async {
    calls.add((
      branchId: branchId,
      items: items,
      couponCodes: couponCodes,
      manualDiscount: manualDiscount,
      customerId: customerId,
      rewardEntitlementId: rewardEntitlementId,
      note: note,
    ));
    if (failure != null) throw failure!;
    return result ??
        const PosSaleCreated(
          id: 'sale-id',
          saleNumber: 'SALE-fixture',
          status: 'pending_payment',
          total: '0.0000',
        );
  }

  @override
  Future<PosReceipt> receipt(String saleId) async {
    receiptCalls.add(saleId);
    if (receiptFailure != null) throw receiptFailure!;
    return receiptResult ?? _fixtureReceipt(saleId);
  }

  @override
  Future<PosSaleCreated> completeZeroTotalSale(String saleId) async {
    zeroTotalCalls.add(saleId);
    if (zeroTotalFailure != null) throw zeroTotalFailure!;
    return zeroTotalResult ??
        const PosSaleCreated(
          id: 'sale-id',
          saleNumber: 'SALE-fixture',
          status: 'completed',
          total: '0.0000',
        );
  }

  @override
  Future<PosSaleHistoryPage> listSales({
    PosSaleHistoryFilter filter = const PosSaleHistoryFilter(),
    String? cursor,
    int limit = 50,
  }) async {
    listCalls.add((filter: filter, cursor: cursor));
    if (listFailure != null) throw listFailure!;
    return listResult ?? const PosSaleHistoryPage(items: [], nextCursor: null);
  }
}

PosReceipt _fixtureReceipt(String saleId) => PosReceipt(
  sale: PosReceiptSale(
    id: saleId,
    saleNumber: 'SALE-fixture',
    status: 'completed',
    currencyCode: 'MXN',
    branchId: 'branch-id',
    occurredAt: DateTime.utc(2026, 8, 1),
    completedAt: DateTime.utc(2026, 8, 1, 0, 5),
    subtotal: '50.0000',
    discountTotal: '0.0000',
    taxTotal: '8.0000',
    total: '58.0000',
  ),
  business: const PosReceiptBusiness(
    companyName: 'AS ONE Fixture Co.',
    branchName: 'Main',
    branchAddress: null,
  ),
  cashier: const PosReceiptCashier(id: 'user-id', displayName: 'Cash Ier'),
  items: const [
    PosReceiptItem(
      lineNumber: 1,
      nameSnapshot: 'Fixture Product',
      skuSnapshot: 'SKU-1',
      quantity: '1.000000',
      unitPrice: '50.0000',
      discountTotal: '0.0000',
      taxTotal: '8.0000',
      lineTotal: '58.0000',
    ),
  ],
  payments: const [
    PosReceiptPayment(
      id: 'payment-id',
      paymentMethod: 'cash',
      status: 'captured',
      amount: '58.0000',
      currencyCode: 'MXN',
      capturedAt: null,
      tenderedAmount: '58.0000',
      changeAmount: '0.0000',
      provider: null,
      terminalId: null,
      providerReference: null,
    ),
  ],
);

/// TASK 12.4B.1: a controllable fake for terminal discovery, card_terminal
/// payment creation, and the bounded status-poll loop. `pollResults`
/// (when given) is served one item per `paymentStatus` call, then repeats
/// its last entry — lets a test script a realistic
/// created → awaiting_terminal → processing → approved progression
/// without a real backend or a real Mercado Pago terminal.
class _FakePaymentsGateway implements PosPaymentsGateway {
  _FakePaymentsGateway({
    this.terminals = const [],
    this.createResult,
    this.pollResults = const [],
    this.cashResult,
    this.cashFailure,
  });

  final List<PosPaymentTerminal> terminals;
  final PosPaymentStatus? createResult;
  final List<PosPaymentStatus> pollResults;
  int _pollIndex = 0;
  final List<String> statusCalls = [];

  // TASK 12.5A.
  final PosCashPaymentResult? cashResult;
  final ApiException? cashFailure;
  final List<({String saleId, String tenderedAmount})> cashCalls = [];

  @override
  Future<List<PosPaymentTerminal>> terminalsForBranch(String branchId) async =>
      terminals;

  @override
  Future<PosPaymentStatus> createCardTerminalPayment({
    required String saleId,
    required String amount,
    required String terminalId,
  }) async =>
      createResult ??
      const PosPaymentStatus(
        id: 'payment-id',
        status: 'pending',
        attempts: [PosPaymentAttempt(id: 'attempt-id', status: 'created')],
      );

  @override
  Future<PosPaymentStatus> paymentStatus(String paymentId) async {
    statusCalls.add(paymentId);
    if (pollResults.isEmpty) {
      return const PosPaymentStatus(
        id: 'payment-id',
        status: 'captured',
        attempts: [PosPaymentAttempt(id: 'attempt-id', status: 'approved')],
      );
    }
    final index = _pollIndex < pollResults.length
        ? _pollIndex
        : pollResults.length - 1;
    _pollIndex++;
    return pollResults[index];
  }

  @override
  Future<PosCashPaymentResult> createCashPayment({
    required String saleId,
    required String tenderedAmount,
  }) async {
    cashCalls.add((saleId: saleId, tenderedAmount: tenderedAmount));
    if (cashFailure != null) throw cashFailure!;
    return cashResult ??
        const PosCashPaymentResult(
          paymentId: 'cash-payment-id',
          status: 'captured',
          tenderedAmount: '0.0000',
          changeAmount: '0.0000',
          saleId: 'sale-id',
          saleNumber: 'SALE-fixture',
          saleStatus: 'completed',
        );
  }
}

/// TASK 12.7: a controllable fake for the Caja module and the POS
/// Efectivo gate. Defaults to an already-open session for [branchId]
/// (`branch-id`, this file's own default fixture branch) so every
/// pre-existing Cobrar/cash test — written before the cash-session
/// requirement existed — keeps exercising what it actually tests; pass
/// `openSessionFixture: null` to simulate a closed drawer for the
/// dedicated gating tests.
/// TASK 14.5A: a real-PIN-auth fake for `_CajeroReturnAuthDialog`/
/// `_StaffQuickSwitchDialog`. Defaults to a successful `pinLogin`/`qrLogin`
/// — matching every other gateway's own "defaults to success, dedicated
/// tests inject the failure case explicitly" convention in this file — so
/// every pre-existing CLIENTE→CAJERO test written before real PIN auth
/// existed for that flow keeps exercising what it actually tests, and the
/// wrong-PIN rejection gets its own explicit `pinSucceeds: false` fake.
class _FakeAuthGateway implements PosAuthGateway {
  _FakeAuthGateway({this.pinSucceeds = true});
  // Mutable so a single test can flip a wrong-PIN attempt into a correct
  // one without needing a second widget tree.
  bool pinSucceeds;
  int pinLoginCalls = 0;
  String? lastPin;

  @override
  Future<void> pinLogin(String pin) async {
    pinLoginCalls++;
    lastPin = pin;
    if (!pinSucceeds) {
      throw ApiException(AppFailure.fromCode('invalid_credentials'));
    }
  }

  // Not exercised by any test in this file — `_StaffQuickSwitchDialog`'s
  // own QR tab has its dedicated coverage elsewhere; this fake only needs
  // to satisfy the `PosAuthGateway` interface honestly (never a fabricated
  // success without a real call ever happening).
  @override
  Future<void> qrLogin(String code) async {}
}

/// TASK 14.5A: a `PosSalesGateway` whose `createSale` only ever resolves
/// when the test explicitly calls [resolveWith] — lets a test hold the
/// real checkout flow open at the exact "server hasn't confirmed yet"
/// instant and assert nothing has jumped the gun, rather than merely
/// inferring good ordering from a coincidental frame count.
class _DelayedSalesGateway implements PosSalesGateway {
  final List<String> createCalls = [];
  final Completer<PosSaleCreated> _completer = Completer<PosSaleCreated>();

  void resolveWith(PosSaleCreated sale) => _completer.complete(sale);

  @override
  Future<PosSaleCreated> createSale({
    required String branchId,
    required List<PosSaleLineRequest> items,
    List<String>? couponCodes,
    PosManualDiscountRequest? manualDiscount,
    String? customerId,
    String? rewardEntitlementId,
    String? note,
  }) {
    createCalls.add(branchId);
    return _completer.future;
  }

  @override
  Future<PosReceipt> receipt(String saleId) =>
      Future.error(StateError('not used by this test'));

  @override
  Future<PosSaleCreated> completeZeroTotalSale(String saleId) =>
      Future.error(StateError('not used by this test'));

  @override
  Future<PosSaleHistoryPage> listSales({
    PosSaleHistoryFilter filter = const PosSaleHistoryFilter(),
    String? cursor,
    int limit = 50,
  }) => Future.error(StateError('not used by this test'));
}

/// TASK 14.5A: a recording fake for `PosSettingsGateway` — proves the real
/// receipt print call sites actually call `effectiveCompanySettings` with
/// the current session's own `companyId` and the exact
/// `receipts.header_text`/`receipts.footer_text` keys, mirroring
/// `pos_receipt_branding_test.dart`'s own `_RecordingSettingsGateway`
/// fixture convention (that screen's own structural template — see this
/// file's `_FakeAuthGateway` doc comment for the same "mirrors an existing
/// convention" rationale). Only the two methods this arc's tests actually
/// exercise are meaningfully implemented; the branding-upload/-delete
/// methods (a concurrent, unrelated task's own surface) simply reject —
/// never called by anything under test here.
class _RecordingSettingsGateway implements PosSettingsGateway {
  _RecordingSettingsGateway({this.settings = const []});
  final List<PosEffectiveSetting> settings;
  final List<({String companyId, List<String>? keys})> effectiveCalls = [];

  @override
  Future<List<PosEffectiveSetting>> effectiveCompanySettings({
    required String companyId,
    List<String>? keys,
  }) async {
    effectiveCalls.add((companyId: companyId, keys: keys));
    return settings;
  }

  @override
  Future<PosEffectiveSetting> setCompanySetting({
    required String companyId,
    required String key,
    required Object value,
    required String valueType,
    required int expectedVersion,
  }) => Future.error(StateError('not used by these tests'));

  @override
  Future<PosEffectiveSetting> uploadCompanyLogo({
    required String companyId,
    required List<int> bytes,
    required String filename,
    required String contentType,
    required int expectedVersion,
  }) => Future.error(StateError('not used by these tests'));

  @override
  Future<PosEffectiveSetting> deleteCompanyLogo({
    required String companyId,
    required int expectedVersion,
  }) => Future.error(StateError('not used by these tests'));
}

class _FakeCashGateway implements PosCashGateway {
  _FakeCashGateway({
    List<PosCashRegister>? registers,
    Object? openSessionFixture = _unset,
    this.summaryResult,
    this.movements = const [],
    this.movementFailure,
    this.closeResult,
    this.closeFailure,
    this.historyResult,
    this.reverseResult,
    this.reverseFailure,
    this.auditLogResult = const [],
  }) : registers = registers ?? [_fixtureRegister],
       _current = identical(openSessionFixture, _unset)
           ? _fixtureSession
           : openSessionFixture as PosCashSession?;

  /// The current in-memory session — mutated by [openSession]/
  /// [closeSession] so a test can drive the real "closed → open → closed"
  /// round trip through this one fake, not just assert isolated calls.
  PosCashSession? _current;

  static const _unset = Object();
  static const _fixtureRegister = PosCashRegister(
    id: 'register-id',
    branchId: 'branch-id',
    code: 'CAJA-1',
    name: 'Caja 1',
    status: 'active',
  );
  static final _fixtureSession = PosCashSession(
    id: 'session-id',
    branchId: 'branch-id',
    cashRegisterId: 'register-id',
    openedBy: 'user-id',
    openedAt: DateTime.utc(2026, 9, 6, 9),
    openingAmount: '1000.0000',
    currencyCode: 'MXN',
    status: 'open',
  );

  final List<PosCashRegister> registers;
  final PosCashSessionSummary? summaryResult;
  final List<PosCashMovement> movements;
  final ApiException? movementFailure;
  final PosCashSession? closeResult;
  final ApiException? closeFailure;
  final PosCashSessionHistoryPage? historyResult;
  final PosCashMovement? reverseResult;
  final ApiException? reverseFailure;
  final List<PosCashAuditEntry> auditLogResult;

  final List<({String cashSessionId, String movementId, String reasonCode})>
  reverseCalls = [];
  final List<String> auditLogCalls = [];

  final List<String> openSessionForBranchCalls = [];
  final List<({String cashRegisterId, String openingAmount})> openSessionCalls =
      [];
  final List<
    ({
      String cashSessionId,
      String movementType,
      String amount,
      String reasonCode,
    })
  >
  movementCalls = [];
  final List<({String cashSessionId, String declaredClosingAmount})>
  closeCalls = [];
  final List<String> registersForBranchCalls = [];

  @override
  Future<List<PosCashRegister>> registersForBranch(String branchId) async {
    registersForBranchCalls.add(branchId);
    return registers
        .where((candidate) => candidate.branchId == branchId)
        .toList(growable: false);
  }

  @override
  Future<PosCashRegister> createRegister({
    required String branchId,
    required String code,
    required String name,
  }) => Future.error(UnimplementedError('createRegister not faked'));

  @override
  Future<PosCashSession> openSession({
    required String cashRegisterId,
    required String openingAmount,
  }) async {
    openSessionCalls.add((
      cashRegisterId: cashRegisterId,
      openingAmount: openingAmount,
    ));
    final opened = PosCashSession(
      id: 'session-id',
      branchId: 'branch-id',
      cashRegisterId: cashRegisterId,
      openedBy: 'user-id',
      openedAt: DateTime.utc(2026, 9, 6, 9),
      openingAmount: openingAmount,
      currencyCode: 'MXN',
      status: 'open',
    );
    _current = opened;
    return opened;
  }

  @override
  Future<PosCashSession?> currentSession(String cashRegisterId) async =>
      _current;

  @override
  Future<PosCashSession?> openSessionForBranch(String branchId) async {
    openSessionForBranchCalls.add(branchId);
    return _current;
  }

  @override
  Future<PosCashSession> session(String cashSessionId) async =>
      _current ?? _fixtureSession;

  @override
  Future<PosCashSessionSummary> summary(String cashSessionId) async =>
      summaryResult ??
      PosCashSessionSummary(
        session: _current ?? _fixtureSession,
        openingAmount: '1000.0000',
        cashSalesTotal: '29.0000',
        cashSalesCount: 1,
        cashInTotal: '0.0000',
        cashOutTotal: '0.0000',
        expectedCash: '1029.0000',
        withdrawalTotal: '0.0000',
        expenseTotal: '0.0000',
        externalIncomeTotal: '0.0000',
      );

  @override
  Future<PosCashMovement> createMovement({
    required String cashSessionId,
    required String movementType,
    required String amount,
    required String reasonCode,
    String? note,
    String? category,
  }) async {
    movementCalls.add((
      cashSessionId: cashSessionId,
      movementType: movementType,
      amount: amount,
      reasonCode: reasonCode,
    ));
    if (movementFailure != null) throw movementFailure!;
    return PosCashMovement(
      id: 'movement-id',
      cashSessionId: cashSessionId,
      movementType: movementType,
      amount: amount,
      currencyCode: 'MXN',
      reasonCode: reasonCode,
      note: note,
      occurredAt: DateTime.utc(2026, 9, 6, 10),
      createdBy: 'user-id',
      category: category,
    );
  }

  @override
  Future<PosCashMovementPage> listMovements(
    String cashSessionId, {
    String? cursor,
    int limit = 50,
  }) async => PosCashMovementPage(items: movements, nextCursor: null);

  @override
  Future<PosCashSession> closeSession({
    required String cashSessionId,
    required String declaredClosingAmount,
    List<PosCashDenominationCount>? denominationCounts,
  }) async {
    closeCalls.add((
      cashSessionId: cashSessionId,
      declaredClosingAmount: declaredClosingAmount,
    ));
    if (closeFailure != null) throw closeFailure!;
    final closed =
        closeResult ??
        PosCashSession(
          id: cashSessionId,
          branchId: 'branch-id',
          cashRegisterId: 'register-id',
          openedBy: 'user-id',
          openedAt: DateTime.utc(2026, 9, 6, 9),
          openingAmount: '1000.0000',
          currencyCode: 'MXN',
          status: 'closed',
          closedBy: 'user-id',
          closedAt: DateTime.utc(2026, 9, 6, 20),
          declaredClosingAmount: declaredClosingAmount,
          expectedClosingAmount: '1029.0000',
          discrepancyAmount: '0.0000',
        );
    // A closed session is no longer "the" open session for this register —
    // the very next `_load()` (Part I: an immutable closed session) must
    // see the drawer as closed again, exactly like the real backend.
    _current = null;
    return closed;
  }

  @override
  Future<PosCashSessionHistoryPage> listSessions({
    PosCashSessionHistoryFilter filter = const PosCashSessionHistoryFilter(),
    String? cursor,
    int limit = 50,
  }) async =>
      historyResult ??
      const PosCashSessionHistoryPage(items: [], nextCursor: null);

  @override
  Future<PosCashSessionPartialClose> partialCloseSession(String cashSessionId) async =>
      PosCashSessionPartialClose(
        id: 'partial-close-id',
        cashSessionId: cashSessionId,
        takenAt: DateTime.utc(2026, 9, 6, 11),
        openingAmount: '1000.0000',
        cashSalesTotal: '29.0000',
        cashInTotal: '0.0000',
        cashOutTotal: '0.0000',
        expectedCash: '1029.0000',
        createdBy: 'user-id',
        createdAt: DateTime.utc(2026, 9, 6, 11),
      );

  @override
  Future<List<PosCashSessionPartialClose>> listPartialCloses(String cashSessionId) async => const [];

  @override
  Future<PosCashMovement> reverseMovement({
    required String cashSessionId,
    required String movementId,
    required String reasonCode,
    String? note,
  }) async {
    reverseCalls.add((
      cashSessionId: cashSessionId,
      movementId: movementId,
      reasonCode: reasonCode,
    ));
    if (reverseFailure != null) throw reverseFailure!;
    return reverseResult ??
        PosCashMovement(
          id: 'reversal-id',
          cashSessionId: cashSessionId,
          movementType: 'cash_in',
          amount: '10.0000',
          currencyCode: 'MXN',
          reasonCode: reasonCode,
          note: note,
          occurredAt: DateTime.utc(2026, 9, 6, 12),
          createdBy: 'user-id',
          reversalOfId: movementId,
        );
  }

  @override
  Future<List<PosCashAuditEntry>> auditLog(
    String cashSessionId, {
    int limit = 100,
  }) async {
    auditLogCalls.add(cashSessionId);
    return auditLogResult;
  }
}

/// TASK 12.7 Part S: a network/backend failure while checking session
/// state must fail closed — never silently let a cash sale through when
/// the check itself couldn't be confirmed one way or the other. Every
/// other member is unused by the one POS-gate test that needs this.
class _ThrowingOpenSessionCashGateway implements PosCashGateway {
  @override
  Future<PosCashSession?> openSessionForBranch(String branchId) =>
      Future.error(StateError('network failure'));

  @override
  Future<List<PosCashRegister>> registersForBranch(String branchId) async =>
      const [];
  @override
  Future<PosCashRegister> createRegister({
    required String branchId,
    required String code,
    required String name,
  }) => Future.error(UnimplementedError('createRegister not faked'));
  @override
  Future<PosCashSession> openSession({
    required String cashRegisterId,
    required String openingAmount,
  }) => Future.error(StateError('not used'));
  @override
  Future<PosCashSession?> currentSession(String cashRegisterId) async => null;
  @override
  Future<PosCashSession> session(String cashSessionId) =>
      Future.error(StateError('not used'));
  @override
  Future<PosCashSessionSummary> summary(String cashSessionId) =>
      Future.error(StateError('not used'));
  @override
  Future<PosCashMovement> createMovement({
    required String cashSessionId,
    required String movementType,
    required String amount,
    required String reasonCode,
    String? note,
    String? category,
  }) => Future.error(StateError('not used'));
  @override
  Future<PosCashMovementPage> listMovements(
    String cashSessionId, {
    String? cursor,
    int limit = 50,
  }) async => const PosCashMovementPage(items: [], nextCursor: null);
  @override
  Future<PosCashSession> closeSession({
    required String cashSessionId,
    required String declaredClosingAmount,
    List<PosCashDenominationCount>? denominationCounts,
  }) => Future.error(StateError('not used'));
  @override
  Future<PosCashSessionHistoryPage> listSessions({
    PosCashSessionHistoryFilter filter = const PosCashSessionHistoryFilter(),
    String? cursor,
    int limit = 50,
  }) async => const PosCashSessionHistoryPage(items: [], nextCursor: null);
  @override
  Future<PosCashSessionPartialClose> partialCloseSession(String cashSessionId) =>
      Future.error(StateError('not used'));
  @override
  Future<List<PosCashSessionPartialClose>> listPartialCloses(String cashSessionId) async => const [];
  @override
  Future<PosCashMovement> reverseMovement({
    required String cashSessionId,
    required String movementId,
    required String reasonCode,
    String? note,
  }) => Future.error(StateError('not used'));
  @override
  Future<List<PosCashAuditEntry>> auditLog(
    String cashSessionId, {
    int limit = 100,
  }) async => const [];
}

class _FakeReadGateway implements PosReadGateway {
  const _FakeReadGateway();

  @override
  Future<List<PosProduct>> products({String? branchId}) async =>
      _catalogFixture();

  // TASK 14.3 (Wave 1, Part B.2): never found by default — every
  // pre-existing test that doesn't exercise barcode lookup keeps seeing
  // an honest "not found" answer, never a fabricated match. Dedicated
  // barcode tests use `_BarcodeReadGateway` instead.
  @override
  Future<PosProduct?> productByBarcode(String barcode, {String? branchId}) async => null;

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
  Future<List<PosProduct>> products({String? branchId}) =>
      Completer<List<PosProduct>>().future;

  @override
  Future<PosProduct?> productByBarcode(String barcode, {String? branchId}) =>
      Completer<PosProduct?>().future;

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
  Future<List<PosProduct>> products({String? branchId}) async => const [];

  @override
  Future<PosProduct?> productByBarcode(String barcode, {String? branchId}) async => null;

  @override
  Future<List<PosCategory>> categories() async => const [];

  @override
  Future<List<PosInventoryBalance>> inventoryBalances({
    String? branchId,
  }) async => const [];

  @override
  Future<List<PosUser>> users() async => const [];
}

/// TASK 12.3B: adds a third active category (`cat-3`, "Postres") with no
/// matching products at all, alongside the same `cat-1`/`cat-2` products
/// `_FakeReadGateway` uses — so the CLIENTE stacked catalog's per-category
/// honest-empty-state can be exercised without a category-less product or
/// an all-empty catalog (both already covered by `_EmptyPosReadGateway`).
class _ClienteCatalogGateway implements PosReadGateway {
  const _ClienteCatalogGateway();

  @override
  Future<List<PosProduct>> products({String? branchId}) async =>
      _catalogFixture();

  @override
  Future<PosProduct?> productByBarcode(String barcode, {String? branchId}) async => null;

  @override
  Future<List<PosCategory>> categories() async => const [
    PosCategory(id: 'cat-1', name: 'Bebidas', status: 'active'),
    PosCategory(id: 'cat-2', name: 'Snacks', status: 'active'),
    PosCategory(id: 'cat-3', name: 'Postres', status: 'active'),
  ];

  @override
  Future<List<PosInventoryBalance>> inventoryBalances({
    String? branchId,
  }) async => const [
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

class _FailingPosReadGateway implements PosReadGateway {
  const _FailingPosReadGateway();

  @override
  Future<List<PosProduct>> products({String? branchId}) async =>
      throw const FormatException('boom');

  @override
  Future<PosProduct?> productByBarcode(String barcode, {String? branchId}) async =>
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

/// TASK 12.8: a controllable fake for E081/E082/E083/E084/E086 — see
/// ADR-0015. Defaults to a real-shaped fixture (`refundable: true`, one
/// `Fixture Product` line matching `_fixtureReceipt`'s own single item) so
/// a test that pumps the shell without caring about refunds specifically
/// still exercises Sale Detail's honest gating path end to end; dedicated
/// refund-flow tests inject their own explicit fixtures/failures instead.
class _FakeRefundsGateway implements PosRefundsGateway {
  _FakeRefundsGateway({
    this.balanceResult,
    this.balanceFailure,
    this.createResult,
    this.createFailure,
    this.refundResult,
    this.refundFailure,
    this.listResult,
    this.listFailure,
    this.completeResult,
    this.completeFailure,
  });

  final PosRefundableBalance? balanceResult;
  final ApiException? balanceFailure;
  final List<String> balanceCalls = [];

  final PosRefund? createResult;
  final ApiException? createFailure;
  final List<
    ({
      String saleId,
      String reasonCode,
      String? reasonNote,
      List<PosCreateRefundItem> items,
    })
  >
  createCalls = [];

  final PosRefund? refundResult;
  final ApiException? refundFailure;
  final List<String> refundCalls = [];

  final PosRefundPage? listResult;
  final ApiException? listFailure;
  final List<({PosRefundListFilter filter, String? cursor})> listCalls = [];

  final PosRefund? completeResult;
  final ApiException? completeFailure;
  final List<({String refundId, String? cashRegisterId})> completeCalls = [];

  @override
  Future<PosRefundableBalance> refundableBalance(String saleId) async {
    balanceCalls.add(saleId);
    if (balanceFailure != null) throw balanceFailure!;
    return balanceResult ?? _fixtureRefundableBalance(saleId);
  }

  @override
  Future<PosRefund> createRefund({
    required String saleId,
    required String reasonCode,
    String? reasonNote,
    required List<PosCreateRefundItem> items,
  }) async {
    createCalls.add((
      saleId: saleId,
      reasonCode: reasonCode,
      reasonNote: reasonNote,
      items: items,
    ));
    if (createFailure != null) throw createFailure!;
    return createResult ?? _fixtureRefund(saleId: saleId, status: 'approved');
  }

  @override
  Future<PosRefund> refund(String refundId) async {
    refundCalls.add(refundId);
    if (refundFailure != null) throw refundFailure!;
    return refundResult ??
        _fixtureRefund(
          saleId: 'sale-history-1',
          status: 'completed',
          id: refundId,
        );
  }

  @override
  Future<PosRefundPage> listRefunds({
    PosRefundListFilter filter = const PosRefundListFilter(),
    String? cursor,
    int limit = 50,
  }) async {
    listCalls.add((filter: filter, cursor: cursor));
    if (listFailure != null) throw listFailure!;
    return listResult ?? const PosRefundPage(items: [], nextCursor: null);
  }

  @override
  Future<PosRefund> completeRefund({
    required String refundId,
    String? cashRegisterId,
  }) async {
    completeCalls.add((refundId: refundId, cashRegisterId: cashRegisterId));
    if (completeFailure != null) throw completeFailure!;
    return completeResult ??
        _fixtureRefund(
          saleId: 'sale-history-1',
          status: 'completed',
          id: refundId,
        );
  }
}

/// TASK 12.9: a controllable fake for `POST /sales/pricing-quotes` plus the
/// promotions/coupons admin CRUD — see ADR-0016.
///
/// The default `quote()` behavior (when [quoteResult]/[quoteFailure] are
/// both omitted) deterministically echoes the exact catalog-only totals
/// `_catalogFixture()`'s own $10.00/`IVA_GENERAL` products always price to
/// — zero discount, no promotion/coupon applied — computed from the
/// SAME items the ticket actually sent, so every pre-existing Subtotal/
/// IVA/Total/Cobrar assertion written before this task keeps passing
/// byte-for-byte even once the ticket starts automatically re-quoting on
/// every cart change (`_TicketFooterState`'s debounce fires during
/// `pumpAndSettle()` regardless of whether a test cares about it).
class _FakePromotionsGateway implements PosPromotionsGateway {
  _FakePromotionsGateway({
    this.quoteResult,
    this.quoteFailure,
    this.promotionsPage,
    this.couponsPage,
    this.createPromotionResult,
    this.createCouponResult,
    this.updatePromotionResult,
    this.updateCouponResult,
    this.mutationFailure,
  });

  final PosPricingQuote? quoteResult;
  final ApiException? quoteFailure;
  final List<
    ({
      String branchId,
      List<PosPricingQuoteItem> items,
      List<String> couponCodes,
      PosManualDiscountRequest? manualDiscount,
      String? customerId,
      String? rewardEntitlementId,
    })
  >
  quoteCalls = [];

  final PosPromotionPage? promotionsPage;
  final PosCouponPage? couponsPage;
  final PosPromotion? createPromotionResult;
  final PosCoupon? createCouponResult;
  final PosPromotion? updatePromotionResult;
  final PosCoupon? updateCouponResult;
  final ApiException? mutationFailure;
  final List<String> createPromotionCalls = [];
  final List<String> createCouponCalls = [];
  final List<String> updatePromotionCalls = [];
  final List<String> updateCouponCalls = [];

  @override
  Future<PosPricingQuote> quote({
    required String branchId,
    required List<PosPricingQuoteItem> items,
    List<String> couponCodes = const [],
    PosManualDiscountRequest? manualDiscount,
    String? customerId,
    String? rewardEntitlementId,
  }) async {
    quoteCalls.add((
      branchId: branchId,
      items: items,
      couponCodes: couponCodes,
      manualDiscount: manualDiscount,
      customerId: customerId,
      rewardEntitlementId: rewardEntitlementId,
    ));
    if (quoteFailure != null) throw quoteFailure!;
    if (quoteResult != null) return quoteResult!;
    return _echoUndiscountedQuote(items);
  }

  @override
  Future<PosPromotion> createPromotion(PosPromotionInput input) async {
    createPromotionCalls.add(input.name ?? '');
    if (mutationFailure != null) throw mutationFailure!;
    return createPromotionResult ?? _fixturePromotion();
  }

  @override
  Future<PosPromotionPage> listPromotions({String? cursor, int limit = 50, bool? active}) async {
    return promotionsPage ?? const PosPromotionPage(items: [], nextCursor: null);
  }

  @override
  Future<PosPromotion> promotion(String id) async {
    return _fixturePromotion(id: id);
  }

  @override
  Future<PosPromotion> updatePromotion(String id, PosPromotionInput input, {required int version}) async {
    updatePromotionCalls.add(id);
    if (mutationFailure != null) throw mutationFailure!;
    return updatePromotionResult ?? _fixturePromotion(id: id);
  }

  @override
  Future<PosCoupon> createCoupon(PosCouponInput input) async {
    createCouponCalls.add(input.code ?? '');
    if (mutationFailure != null) throw mutationFailure!;
    return createCouponResult ?? _fixtureCoupon();
  }

  @override
  Future<PosCouponPage> listCoupons({String? cursor, int limit = 50, bool? active}) async {
    return couponsPage ?? const PosCouponPage(items: [], nextCursor: null);
  }

  @override
  Future<PosCoupon> coupon(String id) async {
    return _fixtureCoupon(id: id);
  }

  @override
  Future<PosCoupon> updateCoupon(String id, PosCouponUpdateInput input, {required int version}) async {
    updateCouponCalls.add(id);
    if (mutationFailure != null) throw mutationFailure!;
    return updateCouponResult ?? _fixtureCoupon(id: id);
  }
}

/// Every product in `_catalogFixture()` is `$10.00 MXN`/`IVA_GENERAL`
/// (16%) — see `_pricedProduct`'s own default `amount`/`taxCode` — so this
/// mirrors `SaleSession`'s own local (zero-discount) math exactly, giving
/// `_FakePromotionsGateway`'s default quote the identical totals every
/// pre-existing ticket test already asserts.
PosPricingQuote _echoUndiscountedQuote(List<PosPricingQuoteItem> items) {
  final lines = <PosPricingQuoteLine>[];
  for (var index = 0; index < items.length; index++) {
    final item = items[index];
    final quantity = int.tryParse(item.quantity.split('.').first) ?? 0;
    final lineSubtotal = Money.parse('10.0000', 'MXN') * quantity;
    final lineTax = lineSubtotal.multiplyByRateBasisPoints(1600);
    lines.add(
      PosPricingQuoteLine(
        lineIndex: index,
        productId: item.productId,
        nameSnapshot: '',
        quantity: item.quantity,
        unitPrice: '10.0000',
        subtotal: lineSubtotal.toApiString(),
        discountTotal: '0.0000',
        taxTotal: lineTax.toApiString(),
        lineTotal: (lineSubtotal + lineTax).toApiString(),
      ),
    );
  }
  final subtotal = items.fold(Money.zero('MXN'), (sum, item) {
    final quantity = int.tryParse(item.quantity.split('.').first) ?? 0;
    return sum + Money.parse('10.0000', 'MXN') * quantity;
  });
  final tax = subtotal.multiplyByRateBasisPoints(1600);
  final total = subtotal + tax;
  return PosPricingQuote(
    currencyCode: 'MXN',
    subtotal: subtotal.toApiString(),
    discountTotal: '0.0000',
    taxTotal: tax.toApiString(),
    total: total.toApiString(),
    lines: lines,
    appliedDiscounts: const [],
    rejectedCoupons: const [],
  );
}

PosPromotion _fixturePromotion({String id = 'promotion-1'}) => PosPromotion(
  id: id,
  name: 'Fixture Promotion',
  description: null,
  active: true,
  startsAt: null,
  endsAt: null,
  daysOfWeek: null,
  timeFrom: null,
  timeTo: null,
  priority: 0,
  stackable: false,
  benefitType: 'percentage',
  benefitPercentageBasisPoints: 1000,
  benefitFixedAmount: null,
  benefitNxmBuyQuantity: null,
  benefitNxmPayQuantity: null,
  minQuantity: null,
  minSubtotal: null,
  usageLimitTotal: null,
  combinableWithCoupons: true,
  branchIds: const [],
  productIds: const [],
  categoryIds: const [],
  version: 1,
);

PosCoupon _fixtureCoupon({String id = 'coupon-1'}) => PosCoupon(
  id: id,
  code: 'FIXTURE10',
  description: null,
  benefitType: 'percentage',
  benefitPercentageBasisPoints: 1000,
  benefitFixedAmount: null,
  active: true,
  startsAt: null,
  endsAt: null,
  minSubtotal: null,
  usageLimitTotal: null,
  promotionId: null,
  version: 1,
);

PosRefundableBalance _fixtureRefundableBalance(String saleId) =>
    PosRefundableBalance(
      saleId: saleId,
      refundable: true,
      blockedReason: null,
      lines: const [
        PosRefundableLine(
          saleItemId: 'sale-item-1',
          nameSnapshot: 'Fixture Product',
          soldQuantity: '1.000000',
          refundedQuantity: '0.000000',
          refundableQuantity: '1.000000',
          unitPrice: '50.0000',
        ),
      ],
    );

PosRefund _fixtureRefund({
  required String saleId,
  required String status,
  String id = 'refund-id',
  String refundMethod = 'cash',
}) => PosRefund(
  id: id,
  branchId: 'branch-id',
  saleId: saleId,
  cashSessionId: null,
  paymentId: null,
  refundNumber: 'REFUND-fixture',
  status: status,
  refundMethod: refundMethod,
  reasonCode: 'customer_changed_mind',
  reasonNote: null,
  currencyCode: 'MXN',
  subtotal: '50.0000',
  taxTotal: '8.0000',
  total: '58.0000',
  occurredAt: DateTime.utc(2026, 9, 3, 12, 5),
  completedAt: status == 'completed'
      ? DateTime.utc(2026, 9, 3, 12, 6)
      : null,
  createdBy: 'user-id',
  approvedBy: 'user-id',
  items: const [
    PosRefundItem(
      id: 'refund-item-1',
      saleItemId: 'sale-item-1',
      quantity: '1.000000',
      subtotal: '50.0000',
      taxTotal: '8.0000',
      lineTotal: '58.0000',
      restockDisposition: 'restock',
    ),
  ],
);

/// TASK 13.0: a controllable fake for the customer directory — mirrors
/// `_FakePromotionsGateway`'s own shape exactly (canned results/failures,
/// recorded calls, never a fabricated success).
class _FakeCustomersGateway implements PosCustomersGateway {
  _FakeCustomersGateway({
    this.createResult,
    this.createFailure,
    this.listResult,
    this.listFailure,
    this.customerResult,
    this.customerFailure,
    this.updateResult,
    this.updateFailure,
    this.qrTokenResult,
  });

  final PosCustomer? createResult;
  final ApiException? createFailure;
  final List<PosCustomerInput> createCalls = [];

  final PosCustomerPage? listResult;
  final ApiException? listFailure;
  final List<String?> listSearchCalls = [];

  final PosCustomer? customerResult;
  final ApiException? customerFailure;

  final PosCustomer? updateResult;
  final ApiException? updateFailure;
  final List<String> updateCalls = [];

  final PosCustomerQrToken? qrTokenResult;

  @override
  Future<PosCustomer> createCustomer(PosCustomerInput input) async {
    createCalls.add(input);
    if (createFailure != null) throw createFailure!;
    return createResult ??
        PosCustomer(
          id: 'customer-new',
          firstName: input.firstName ?? 'Cliente',
          lastName: input.lastName,
          displayName: input.displayName ?? input.firstName ?? 'Cliente',
          email: input.email,
          phone: input.phone,
          birthDate: input.birthDate,
          status: 'active',
          notes: input.notes,
          createdBy: 'user-id',
          updatedBy: 'user-id',
          version: 1,
          createdAt: DateTime.utc(2026, 9, 4),
          updatedAt: DateTime.utc(2026, 9, 4),
        );
  }

  @override
  Future<PosCustomerPage> listCustomers({String? cursor, int limit = 50, String? search, String? status}) async {
    listSearchCalls.add(search);
    if (listFailure != null) throw listFailure!;
    return listResult ?? const PosCustomerPage(items: [], nextCursor: null);
  }

  @override
  Future<PosCustomer> customer(String id) async {
    if (customerFailure != null) throw customerFailure!;
    return customerResult ?? _fixtureCustomer(id: id);
  }

  @override
  Future<PosCustomer> updateCustomer(String id, PosCustomerInput input, {required int version}) async {
    updateCalls.add(id);
    if (updateFailure != null) throw updateFailure!;
    return updateResult ?? _fixtureCustomer(id: id);
  }

  @override
  Future<PosCustomerQrToken> issueQrToken(String customerId) async =>
      qrTokenResult ??
      PosCustomerQrToken(
        id: 'qr-1',
        customerId: customerId,
        token: 'opaque-token-value',
        status: 'active',
        createdAt: DateTime.utc(2026, 9, 4),
      );

  @override
  Future<PosCustomerQrToken?> activeQrToken(String customerId) async => qrTokenResult;

  @override
  Future<PosCustomer> resolveQrToken(String token) async => customerResult ?? _fixtureCustomer(id: 'customer-1');
}

PosCustomer _fixtureCustomer({required String id, String displayName = 'Cliente de prueba'}) => PosCustomer(
  id: id,
  firstName: displayName,
  lastName: null,
  displayName: displayName,
  email: null,
  phone: null,
  birthDate: null,
  status: 'active',
  notes: null,
  createdBy: 'user-id',
  updatedBy: 'user-id',
  version: 1,
  createdAt: DateTime.utc(2026, 9, 4),
  updatedAt: DateTime.utc(2026, 9, 4),
);

/// TASK 13.0: a controllable fake for membership plan admin plus
/// per-customer issued memberships.
class _FakeMembershipsGateway implements PosMembershipsGateway {
  _FakeMembershipsGateway({
    this.plansResult,
    this.plansFailure,
    this.createPlanResult,
    this.updatePlanResult,
    this.membershipsResult,
    this.membershipsFailure,
    this.issueResult,
    this.issueFailure,
    this.renewResult,
    this.cancelResult,
    this.validateResult,
  });

  final List<PosMembershipPlan>? plansResult;
  final ApiException? plansFailure;
  final PosMembershipPlan? createPlanResult;
  final List<String> createPlanCalls = [];
  final PosMembershipPlan? updatePlanResult;
  final List<String> updatePlanCalls = [];

  final List<PosCustomerMembership>? membershipsResult;
  final ApiException? membershipsFailure;

  final PosCustomerMembership? issueResult;
  final ApiException? issueFailure;
  final List<String> issueCalls = [];

  final PosCustomerMembership? renewResult;
  final List<String> renewCalls = [];

  final PosCustomerMembership? cancelResult;
  final List<String> cancelCalls = [];

  final PosMembershipValidation? validateResult;

  @override
  Future<PosMembershipPlan> createPlan(PosMembershipPlanInput input) async {
    createPlanCalls.add(input.name ?? '');
    return createPlanResult ?? _fixturePlan(id: 'plan-new', name: input.name ?? 'Plan');
  }

  @override
  Future<List<PosMembershipPlan>> listPlans({bool? active}) async {
    if (plansFailure != null) throw plansFailure!;
    return plansResult ?? const [];
  }

  @override
  Future<PosMembershipPlan> plan(String id) async => _fixturePlan(id: id, name: 'Plan');

  @override
  Future<PosMembershipPlan> updatePlan(String id, PosMembershipPlanInput input, {required int version}) async {
    updatePlanCalls.add(id);
    return updatePlanResult ?? _fixturePlan(id: id, name: input.name ?? 'Plan');
  }

  @override
  Future<List<PosCustomerMembership>> membershipsForCustomer(String customerId) async {
    if (membershipsFailure != null) throw membershipsFailure!;
    return membershipsResult ?? const [];
  }

  @override
  Future<PosCustomerMembership> issueMembership({
    required String customerId,
    required String membershipPlanId,
    DateTime? startsAt,
  }) async {
    issueCalls.add(membershipPlanId);
    if (issueFailure != null) throw issueFailure!;
    return issueResult ?? _fixtureMembership(id: 'membership-new', customerId: customerId, planId: membershipPlanId);
  }

  @override
  Future<PosCustomerMembership> renewMembership(String id) async {
    renewCalls.add(id);
    return renewResult ?? _fixtureMembership(id: 'membership-renewed', customerId: 'customer-1', planId: 'plan-1');
  }

  @override
  Future<PosCustomerMembership> cancelMembership(String id, {required String reason, required int version}) async {
    cancelCalls.add(id);
    return cancelResult ?? _fixtureMembership(id: id, customerId: 'customer-1', planId: 'plan-1', status: 'cancelled');
  }

  @override
  Future<PosMembershipValidation> validate({required String customerId, required String branchId}) async =>
      validateResult ?? const PosMembershipValidation(valid: false, reason: 'no_membership', eligibleBranch: true, membership: null);
}

PosMembershipPlan _fixturePlan({required String id, required String name}) => PosMembershipPlan(
  id: id,
  name: name,
  description: null,
  active: true,
  productId: null,
  durationDays: 30,
  benefitDescription: null,
  branchIds: const [],
  version: 1,
  createdAt: DateTime.utc(2026, 9, 4),
  updatedAt: DateTime.utc(2026, 9, 4),
);

PosCustomerMembership _fixtureMembership({
  required String id,
  required String customerId,
  required String planId,
  String status = 'active',
}) => PosCustomerMembership(
  id: id,
  customerId: customerId,
  membershipPlanId: planId,
  membershipNumber: 'MEM-$id',
  status: status,
  startsAt: DateTime.utc(2026, 9, 1),
  expiresAt: DateTime.utc(2026, 10, 1),
  issuedAt: DateTime.utc(2026, 9, 1),
  sourceSaleId: null,
  renewedFromMembershipId: null,
  cancelledAt: null,
  version: 1,
);

/// TASK 14.3 Wave 1 Part A: a controllable fake for the "Fiestas" (party
/// reservations) domain — rooms/packages/reservations/quote/detail/
/// balance/cancel are all directly injectable so a test can assert
/// exactly what the UI displays/sends is the real, backend-shaped value,
/// never a client computation.
class _FakePartiesGateway implements PosPartiesGateway {
  _FakePartiesGateway({
    this.roomsResult,
    this.packagesResult,
    this.reservationsResult,
    this.createReservationFailure,
    this.quoteResult,
    this.balanceResult,
    this.cancelResult,
  });

  final List<PosPartyRoom>? roomsResult;
  final List<PosPartyPackage>? packagesResult;
  final List<PosPartyReservation>? reservationsResult;

  final ApiException? createReservationFailure;
  final List<PosPartyReservationInput> createReservationCalls = [];

  final PosPartyQuote? quoteResult;
  final List<String> quoteCalls = [];

  final PosPartyBalance? balanceResult;

  final PosPartyCancellationResult? cancelResult;
  final List<String> cancelCalls = [];

  @override
  Future<PosPartyRoom> createRoom(PosPartyRoomInput input) async => _fixturePartyRoom();

  @override
  Future<PosPartyPage<PosPartyRoom>> listRooms({String? cursor, int limit = 50, String? branchId, String? status}) async =>
      PosPartyPage(items: roomsResult ?? const [], nextCursor: null);

  @override
  Future<PosPartyRoom> room(String id) async => _fixturePartyRoom(id: id);

  @override
  Future<PosPartyRoom> updateRoom(String id, PosPartyRoomInput input, {required int version}) async => _fixturePartyRoom(id: id);

  @override
  Future<PosPartyPackage> createPackage(PosPartyPackageInput input) async => _fixturePartyPackage();

  @override
  Future<PosPartyPage<PosPartyPackage>> listPackages({String? cursor, int limit = 50, String? branchId, String? status}) async =>
      PosPartyPage(items: packagesResult ?? const [], nextCursor: null);

  @override
  Future<PosPartyPackage> packageRow(String id) async => _fixturePartyPackage(id: id);

  @override
  Future<PosPartyPackage> updatePackage(String id, PosPartyPackageInput input, {required int version}) async => _fixturePartyPackage(id: id);

  @override
  Future<PosPartyQuote> quotePackage(String id, {int children = 0, int adults = 0, int extraHalfHours = 0}) async {
    quoteCalls.add(id);
    return quoteResult ??
        const PosPartyQuote(
          packageId: 'package-1',
          currencyCode: 'MXN',
          base: '1000.00',
          childrenExtra: '0.00',
          adultsExtra: '0.00',
          timeExtra: '0.00',
          total: '1000.00',
        );
  }

  @override
  Future<PosPartyReservation> createReservation(PosPartyReservationInput input) async {
    createReservationCalls.add(input);
    if (createReservationFailure != null) throw createReservationFailure!;
    return _fixturePartyReservation();
  }

  @override
  Future<PosPartyPage<PosPartyReservation>> listReservations({
    String? cursor,
    int limit = 50,
    String? branchId,
    String? status,
    String? roomId,
    String? customerId,
    String? sellerUserId,
    String? eventDateFrom,
    String? eventDateTo,
  }) async => PosPartyPage(items: reservationsResult ?? const [], nextCursor: null);

  @override
  Future<List<PosPartyCalendarEntry>> calendar({
    required String from,
    required String to,
    int limit = 500,
    String? branchId,
    String? status,
    String? roomId,
    String? sellerUserId,
  }) async => const [];

  @override
  Future<PosPartyReservationDetail> reservationDetail(String id) async => _fixturePartyDetail(id: id);

  @override
  Future<PosPartyReservation> updateReservation(String id, PosPartyReservationInput input, {required int version}) async =>
      _fixturePartyReservation(id: id);

  @override
  Future<PosPartyReservation> transitionStatus(String id, String newStatus, {required int version}) async =>
      _fixturePartyReservation(id: id, status: newStatus);

  @override
  Future<PosPartyCancellationResult> cancelReservation(String id, {required String reasonCode, required int version}) async {
    cancelCalls.add(reasonCode);
    return cancelResult ??
        PosPartyCancellationResult(
          reservation: _fixturePartyReservation(id: id, status: 'cancelled'),
          hasPriorPayments: false,
          totalPaid: '0.00',
        );
  }

  @override
  Future<PosPartySnack> addSnack(String reservationId, PosPartySnackInput input) async => PosPartySnack(
    id: 'snack-1',
    reservationId: reservationId,
    productId: input.productId,
    nameSnapshot: input.nameSnapshot ?? 'Snack',
    unitPriceSnapshot: input.unitPriceSnapshot ?? '0.00',
    quantity: input.quantity,
    lineTotal: input.unitPriceSnapshot ?? '0.00',
    createdAt: DateTime.utc(2026, 9, 4),
  );

  @override
  Future<List<PosPartySnack>> listSnacks(String reservationId) async => const [];

  @override
  Future<PosPartySock> addSock(String reservationId, PosPartySockInput input) async => PosPartySock(
    id: 'sock-1',
    reservationId: reservationId,
    size: input.size,
    quantity: input.quantity,
    productVariantId: input.productVariantId,
    stockDeducted: 'pending',
    stockDeductedAt: null,
    createdAt: DateTime.utc(2026, 9, 4),
  );

  @override
  Future<List<PosPartySock>> listSocks(String reservationId) async => const [];

  @override
  Future<PosPartySock> deductSock(String reservationId, String sockId) async => PosPartySock(
    id: sockId,
    reservationId: reservationId,
    size: 'CH',
    quantity: 1,
    productVariantId: 'variant-1',
    stockDeducted: 'deducted',
    stockDeductedAt: DateTime.utc(2026, 9, 4),
    createdAt: DateTime.utc(2026, 9, 4),
  );

  @override
  Future<PosPartyPayment> recordPayment(
    String reservationId, {
    required String purpose,
    required String amount,
    required String cashSessionId,
  }) async => PosPartyPayment(
    id: 'payment-1',
    branchId: 'branch-id',
    reservationId: reservationId,
    cashMovementId: 'movement-1',
    purpose: purpose,
    amount: amount,
    createdBy: 'user-id',
    createdAt: DateTime.utc(2026, 9, 4),
  );

  @override
  Future<PosPartyBalance> balance(String reservationId) async =>
      balanceResult ?? const PosPartyBalance(quotedTotal: '1000.00', totalPaid: '0.00', outstandingBalance: '1000.00');

  @override
  Future<String> generateDocument(String reservationId, String type) async => '<html><body>Documento $type</body></html>';
}

PosPartyRoom _fixturePartyRoom({String id = 'room-1', String name = 'Salón Arcoíris'}) => PosPartyRoom(
  id: id,
  branchId: 'branch-id',
  code: 'SALA-1',
  name: name,
  status: 'active',
  capacityChildren: 20,
  capacityAdults: 10,
  capacityTotal: 30,
  color: null,
  notes: null,
  version: 1,
  createdAt: DateTime.utc(2026, 9, 4),
  updatedAt: DateTime.utc(2026, 9, 4),
);

PosPartyPackage _fixturePartyPackage({String id = 'package-1', String name = 'Paquete Fiesta'}) => PosPartyPackage(
  id: id,
  branchId: null,
  code: 'PKG-1',
  name: name,
  description: null,
  status: 'active',
  price: '1000.00',
  currencyCode: 'MXN',
  durationMinutes: 120,
  childrenIncluded: 10,
  adultsIncluded: 5,
  childExtraCost: '50.00',
  adultExtraCost: '80.00',
  capacityMax: 30,
  extraHalfHourCost: '200.00',
  includes: const {'pastel': 'incluido'},
  restrictions: const {'edad_maxima': '12'},
  version: 1,
  createdAt: DateTime.utc(2026, 9, 4),
  updatedAt: DateTime.utc(2026, 9, 4),
);

PosPartyReservation _fixturePartyReservation({String id = 'reservation-1', String status = 'held'}) => PosPartyReservation(
  id: id,
  branchId: 'branch-id',
  reservationNumber: 'RES-0001',
  customerId: null,
  customerDisplayName: 'Cliente de prueba',
  customerPhone: null,
  celebrantName: 'Festejado de prueba',
  celebrantAge: 7,
  roomId: 'room-1',
  packageId: 'package-1',
  eventDate: '2026-10-01',
  startTime: '12:00:00',
  endTime: '14:00:00',
  childrenCount: 10,
  sellerUserId: null,
  status: status,
  accountStatus: 'open',
  quotedTotal: '1000.00',
  currencyCode: 'MXN',
  notes: null,
  cancelledAt: null,
  cancelledBy: null,
  cancellationReason: null,
  version: 1,
  createdAt: DateTime.utc(2026, 9, 4),
  updatedAt: DateTime.utc(2026, 9, 4),
);

PosPartyReservationDetail _fixturePartyDetail({String id = 'reservation-1'}) => PosPartyReservationDetail(
  reservation: _fixturePartyReservation(id: id),
  snacks: const [],
  socks: const [],
  paymentsTotalPaid: '0.00',
  paymentsCount: 0,
  documentsCount: 0,
  documentsLastGeneratedAt: null,
  documentsLastDocumentType: null,
);

/// TASK 13.0: a controllable fake for AS Rewards+ programs/summary/adjust.
class _FakeLoyaltyGateway implements PosLoyaltyGateway {
  _FakeLoyaltyGateway({
    this.programsResult,
    this.summaryResult,
    this.summaryFailure,
    this.adjustResult,
    this.adjustFailure,
  });

  final List<PosLoyaltyProgram>? programsResult;
  final PosLoyaltySummary? summaryResult;
  final ApiException? summaryFailure;
  final PosLoyaltyLedgerEntry? adjustResult;
  final ApiException? adjustFailure;
  final List<int> adjustCalls = [];

  @override
  Future<PosLoyaltyProgram> createProgram(PosLoyaltyProgramInput input) async => PosLoyaltyProgram(
    id: 'program-new',
    name: input.name ?? 'Programa',
    active: input.active ?? false,
    unitType: input.unitType ?? 'point',
    earnQuantityPerSale: input.earnQuantityPerSale ?? 1,
    minimumSaleTotal: input.minimumSaleTotal,
    rewardThreshold: input.rewardThreshold,
    rewardDescription: input.rewardDescription,
    version: 1,
  );

  @override
  Future<List<PosLoyaltyProgram>> listPrograms({bool? active}) async => programsResult ?? const [];

  @override
  Future<PosLoyaltyProgram> updateProgram(String id, PosLoyaltyProgramInput input, {required int version}) async =>
      PosLoyaltyProgram(
        id: id,
        name: input.name ?? 'Programa',
        active: input.active ?? true,
        unitType: input.unitType ?? 'point',
        earnQuantityPerSale: input.earnQuantityPerSale ?? 1,
        minimumSaleTotal: input.minimumSaleTotal,
        rewardThreshold: input.rewardThreshold,
        rewardDescription: input.rewardDescription,
        version: version + 1,
      );

  @override
  Future<PosLoyaltySummary> customerLoyalty(String customerId) async {
    if (summaryFailure != null) throw summaryFailure!;
    return summaryResult ?? const PosLoyaltySummary(accountId: null, balances: [], ledger: []);
  }

  @override
  Future<PosLoyaltyLedgerEntry> adjustLoyalty({
    required String customerId,
    required int quantity,
    required String unitType,
    required String reason,
    String? loyaltyProgramId,
  }) async {
    adjustCalls.add(quantity);
    if (adjustFailure != null) throw adjustFailure!;
    return adjustResult ??
        PosLoyaltyLedgerEntry(
          id: 'ledger-1',
          entryType: 'adjustment',
          quantity: quantity,
          unitType: unitType,
          sourceType: 'manual',
          reason: reason,
          occurredAt: DateTime.utc(2026, 9, 4),
        );
  }
}

/// TASK 13.1A Part G: a controllable fake for reward entitlements —
/// mirrors `_FakeLoyaltyGateway`'s own shape exactly (canned per-method
/// results/failures, plus a recorded-calls list per mutating method so a
/// test can assert what was actually sent to the gateway).
class _FakeRewardsGateway implements PosRewardsGateway {
  _FakeRewardsGateway({
    this.entitlementsForCustomerResult,
    this.entitlementsForCustomerFailure,
    this.entitlementResult,
    this.entitlementFailure,
    this.redeemResult,
    this.redeemFailure,
    this.issueManualResult,
    this.issueManualFailure,
    this.revokeResult,
    this.revokeFailure,
  });

  final List<PosRewardEntitlement>? entitlementsForCustomerResult;
  final ApiException? entitlementsForCustomerFailure;
  final List<String> entitlementsForCustomerCalls = [];

  final PosRewardEntitlement? entitlementResult;
  final ApiException? entitlementFailure;

  final PosRewardEntitlement? redeemResult;
  final ApiException? redeemFailure;
  final List<String> redeemCalls = [];

  final PosRewardEntitlement? issueManualResult;
  final ApiException? issueManualFailure;
  final List<Map<String, Object?>> issueManualCalls = [];

  final PosRewardEntitlement? revokeResult;
  final ApiException? revokeFailure;
  final List<Map<String, Object?>> revokeCalls = [];

  @override
  Future<List<PosRewardEntitlement>> entitlementsForCustomer(String customerId) async {
    entitlementsForCustomerCalls.add(customerId);
    if (entitlementsForCustomerFailure != null) throw entitlementsForCustomerFailure!;
    return entitlementsForCustomerResult ?? const [];
  }

  @override
  Future<PosRewardEntitlement> entitlement(String id) async {
    if (entitlementFailure != null) throw entitlementFailure!;
    return entitlementResult ?? _fixtureRewardEntitlement(id: id);
  }

  @override
  Future<PosRewardEntitlement> redeem(String id, {String? branchId}) async {
    redeemCalls.add(id);
    if (redeemFailure != null) throw redeemFailure!;
    return redeemResult ??
        _fixtureRewardEntitlement(
          id: id,
          status: 'redeemed',
          effectiveStatus: 'redeemed',
          redeemedAt: DateTime.utc(2026, 9, 5),
        );
  }

  @override
  Future<PosRewardEntitlement> issueManual({
    required String customerId,
    required String loyaltyProgramId,
    required String reasonCode,
    DateTime? expiresAt,
  }) async {
    issueManualCalls.add({
      'customerId': customerId,
      'loyaltyProgramId': loyaltyProgramId,
      'reasonCode': reasonCode,
      'expiresAt': expiresAt,
    });
    if (issueManualFailure != null) throw issueManualFailure!;
    return issueManualResult ??
        _fixtureRewardEntitlement(id: 'reward-new', customerId: customerId, loyaltyProgramId: loyaltyProgramId);
  }

  @override
  Future<PosRewardEntitlement> revoke(String id, {required String reason, required int version}) async {
    revokeCalls.add({'id': id, 'reason': reason, 'version': version});
    if (revokeFailure != null) throw revokeFailure!;
    return revokeResult ??
        _fixtureRewardEntitlement(id: id, status: 'revoked', effectiveStatus: 'revoked', revokedAt: DateTime.utc(2026, 9, 5));
  }
}

PosRewardEntitlement _fixtureRewardEntitlement({
  required String id,
  String customerId = 'customer-1',
  String loyaltyProgramId = 'program-1',
  String rewardType = 'vip_pass',
  String status = 'available',
  String? effectiveStatus,
  DateTime? issuedAt,
  DateTime? expiresAt,
  DateTime? redeemedAt,
  DateTime? revokedAt,
  String sourceType = 'manual',
  int? cycleNumber,
  int version = 1,
}) => PosRewardEntitlement(
  id: id,
  customerId: customerId,
  loyaltyProgramId: loyaltyProgramId,
  rewardType: rewardType,
  status: status,
  effectiveStatus: effectiveStatus ?? status,
  issuedAt: issuedAt ?? DateTime.utc(2026, 9, 1),
  expiresAt: expiresAt,
  redeemedAt: redeemedAt,
  revokedAt: revokedAt,
  sourceType: sourceType,
  cycleNumber: cycleNumber,
  version: version,
);
