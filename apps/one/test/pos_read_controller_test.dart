/// TASK 16.17A — unit tests for `PosReadController` itself: the exact
/// piece of state the TASK 16.17 "Sin precio" bug traced back to (a
/// load-once cache with no invalidation path — see
/// `pos_read_controller.dart`'s own header doc comment). These tests
/// exercise the controller in isolation, with no widget tree at all —
/// `pos_shell_freshness_test.dart` covers the full end-to-end UI
/// regression (the actual bug, reproduced and fixed, live in a `PosShell`).
library;

import 'dart:async';

import 'package:as_one/core/errors/app_error.dart';
import 'package:as_one/core/networking/api_client.dart';
import 'package:as_one/features/pos/pos_models.dart';
import 'package:as_one/features/pos/pos_read_controller.dart';
import 'package:as_one/features/pos/pos_read_gateway.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  group('branch/company-scoped staleness (TASK 16.17A gap fix)', () {
    test(
      'a second loadProducts call for a DIFFERENT branchId is treated as '
      'stale and refetches, even though the controller left `idle` — the '
      'exact gap that let `_loadDataFor(PosModule.pos)` (branch-scoped) and '
      '`_loadDataFor(PosModule.products)` (unscoped) silently share one '
      "cached branch's prices",
      () async {
        final gateway = _FakeReadGateway();
        gateway.productsByBranch['branch-a'] = [_product('p1', amount: '10.00')];
        gateway.productsByBranch['branch-b'] = [_product('p1', amount: '99.00')];
        final controller = PosReadController(gateway);

        await controller.loadProducts(branchId: 'branch-a');
        expect(controller.products.items.single.pricing.amount!.toDisplayString(), '10.00');
        expect(gateway.productsCallCount, 1);

        // No `refresh: true` — this is exactly what a bare re-navigation
        // does; the pre-existing idle-guard alone would have returned the
        // branch-a cache untouched.
        await controller.loadProducts(branchId: 'branch-b');
        expect(gateway.productsCallCount, 2);
        expect(controller.products.items.single.pricing.amount!.toDisplayString(), '99.00');
      },
    );

    test(
      'loadBalances is scoped by branchId the same way loadProducts is',
      () async {
        final gateway = _FakeReadGateway();
        gateway.balancesByBranch['branch-a'] = [_balance('b1', onHand: '5.000000')];
        gateway.balancesByBranch['branch-b'] = [_balance('b1', onHand: '40.000000')];
        final controller = PosReadController(gateway);

        await controller.loadBalances(branchId: 'branch-a');
        expect(controller.balances.items.single.onHand, '5.000000');
        await controller.loadBalances(branchId: 'branch-b');
        expect(controller.balances.items.single.onHand, '40.000000');
        expect(gateway.balancesCallCount, 2);
      },
    );

    test(
      'a same-branchId call after idle is a true no-op (no extra HTTP call) '
      '— staleness detection must not turn into "always refetch"',
      () async {
        final gateway = _FakeReadGateway();
        gateway.productsByBranch['branch-a'] = [_product('p1')];
        final controller = PosReadController(gateway);

        await controller.loadProducts(branchId: 'branch-a');
        await controller.loadProducts(branchId: 'branch-a');
        expect(gateway.productsCallCount, 1);
      },
    );
  });

  group('request coalescing (anti-storm)', () {
    test(
      'two concurrent loadProducts calls in flight for the same branch '
      'produce exactly one HTTP call',
      () async {
        final gateway = _FakeReadGateway();
        gateway.productsByBranch[null] = [_product('p1')];
        gateway.productsDelay = const Duration(milliseconds: 20);
        final controller = PosReadController(gateway);

        final first = controller.loadProducts();
        final second = controller.loadProducts();
        await Future.wait([first, second]);
        expect(gateway.productsCallCount, 1);
      },
    );

    test(
      'an invalidate() that arrives WHILE a load is already in flight is '
      'coalesced into exactly one rerun afterward, never dropped and never '
      'a duplicate concurrent request',
      () async {
        final gateway = _FakeReadGateway();
        gateway.productsByBranch[null] = [_product('p1', amount: '10.00')];
        // Gates the in-flight call open until this test explicitly lets it
        // resolve — deterministic, unlike racing against a real `Duration`.
        gateway.productsGate = Completer<void>();
        final controller = PosReadController(gateway);

        final firstLoad = controller.loadProducts();
        // A mutation "lands" mid-flight (mirrors a decorator's
        // `invalidateProducts()` firing while the POS screen's own initial
        // load is still resolving) and changes what the backend will
        // return on the NEXT read.
        gateway.productsByBranch[null] = [_product('p1', amount: '25.00')];
        final invalidateCall = controller.invalidateProducts();
        gateway.productsGate!.complete();
        await Future.wait([firstLoad, invalidateCall]);
        // The coalesced rerun itself is fired via `unawaited(...)` inside
        // the controller (deliberately — see `_runProductsLoad`'s own doc
        // comment: it is best-effort, never blocking the call that
        // triggered it), and is *already* in flight (its own call count
        // increment happens synchronously) by the time the line above
        // resolves — but its own `products = ready(...)` assignment still
        // needs one more microtask turn. Poll the controller's own phase
        // (not the call count, which is already 2 here) so this waits for
        // that rerun to actually finish, not merely start.
        for (var i = 0; i < 50 && controller.products.phase == PosReadPhase.loading; i++) {
          await Future<void>.delayed(Duration.zero);
        }

        // Exactly 2 calls: the original in-flight one, plus exactly one
        // coalesced rerun — never zero (dropped) and never 3+ (storm).
        expect(gateway.productsCallCount, 2);
        expect(controller.products.items.single.pricing.amount!.toDisplayString(), '25.00');
      },
    );
  });

  group('invalidate* is a no-op until the resource has actually been requested', () {
    test('invalidateProducts before any loadProducts call never hits the gateway', () async {
      final gateway = _FakeReadGateway();
      final controller = PosReadController(gateway);
      await controller.invalidateProducts();
      expect(gateway.productsCallCount, 0);
      expect(controller.products.phase, PosReadPhase.idle);
    });

    test('invalidateBalances/invalidateCategories are likewise no-ops before first use', () async {
      final gateway = _FakeReadGateway();
      final controller = PosReadController(gateway);
      await controller.invalidateBalances();
      await controller.invalidateCategories();
      expect(gateway.balancesCallCount, 0);
      expect(gateway.categoriesCallCount, 0);
    });
  });

  group('TASK 16.17 exact bug regression, at the controller level', () {
    test(
      'product created with no price (missing), then a price becomes '
      'active server-side, then invalidateProducts() — the controller '
      'reflects the new price on its very next read, no manual "Actualizar"',
      () async {
        final gateway = _FakeReadGateway();
        gateway.productsByBranch[null] = [_product('p1')]; // Sin precio
        final controller = PosReadController(gateway);

        await controller.loadProducts();
        expect(controller.products.items.single.pricing.status, PosPricingStatus.missing);

        // The admin's price-creation mutation succeeded server-side —
        // simulated here exactly like `FreshnessAwareCatalogAdminGateway
        // .createProductPrice` would: the backend's own next GET now
        // returns the real price.
        gateway.productsByBranch[null] = [_product('p1', amount: '25.00')];
        await controller.invalidateProducts();

        expect(controller.products.items.single.pricing.status, PosPricingStatus.valid);
        expect(controller.products.items.single.pricing.amount!.toDisplayString(), '25.00');
      },
    );
  });

  group('reset() — the company-switch cache-leak fix', () {
    test(
      'reset() clears every cached resource back to idle and notifies '
      'listeners, so a stale tenant\'s products/categories/balances/users '
      'can never survive into the next `AuthController.switchCompany`',
      () async {
        final gateway = _FakeReadGateway();
        gateway.productsByBranch[null] = [_product('p1')];
        gateway.balancesByBranch[null] = [_balance('b1')];
        final controller = PosReadController(gateway);
        await controller.loadProducts();
        await controller.loadBalances();
        await controller.loadCategories();
        await controller.loadUsers();
        expect(controller.products.phase, isNot(PosReadPhase.idle));

        var notified = false;
        controller.addListener(() => notified = true);
        controller.reset();

        expect(notified, isTrue);
        expect(controller.products.phase, PosReadPhase.idle);
        expect(controller.products.items, isEmpty);
        expect(controller.categories.phase, PosReadPhase.idle);
        expect(controller.balances.phase, PosReadPhase.idle);
        expect(controller.users.phase, PosReadPhase.idle);

        // And the very next read for the (new) tenant is a real, fresh
        // fetch — never served from anything reset() left behind.
        gateway.productsCallCount = 0;
        await controller.loadProducts();
        expect(gateway.productsCallCount, 1);
      },
    );
  });

  group('honest failure behavior (never fabricate data)', () {
    test(
      'a failed initial load surfaces PosReadPhase.failure with the real '
      'error message, never an empty-but-labeled-ready state',
      () async {
        final gateway = _FakeReadGateway();
        gateway.productsError = const ApiException(
          AppFailure(AppErrorKind.unavailable, 'El servicio no está disponible.', code: 'api_unavailable'),
        );
        final controller = PosReadController(gateway);
        await controller.loadProducts();
        expect(controller.products.phase, PosReadPhase.failure);
        expect(controller.products.message, 'El servicio no está disponible.');
        expect(controller.products.items, isEmpty);
      },
    );

    test(
      'a failed invalidate()/revalidate() after a previously-successful '
      'load surfaces failure honestly — never silently keeps showing the '
      'old (now unverified) data relabeled as fresh, and never fabricates '
      'a new price/stock value',
      () async {
        final gateway = _FakeReadGateway();
        gateway.productsByBranch[null] = [_product('p1', amount: '10.00')];
        final controller = PosReadController(gateway);
        await controller.loadProducts();
        expect(controller.products.phase, PosReadPhase.ready);

        gateway.productsError = const ApiException(
          AppFailure(AppErrorKind.unavailable, 'El servicio no está disponible.', code: 'api_unavailable'),
        );
        await controller.invalidateProducts();

        expect(controller.products.phase, PosReadPhase.failure);
        // Critically: not the stale '10.00' relabeled as still-valid, and
        // not a fabricated different amount — the failure state carries no
        // item list to accidentally read a price from at all.
        expect(controller.products.items, isEmpty);
      },
    );

    test(
      'a failed mutation must never even reach invalidate — proven here by '
      'confirming invalidate is purely additive and does not itself throw '
      'or corrupt state when the resource was never requested',
      () async {
        final gateway = _FakeReadGateway();
        gateway.productsError = const ApiException(
          AppFailure(AppErrorKind.unavailable, 'unused', code: 'api_unavailable'),
        );
        final controller = PosReadController(gateway);
        // No loadProducts() call ever happened (mirrors a failed mutation
        // whose decorator never even fires `unawaited(invalidateProducts())`
        // because the inner call threw first) — invalidate must stay a
        // silent no-op, never surface the gateway's error into unrelated
        // state.
        await controller.invalidateProducts();
        expect(controller.products.phase, PosReadPhase.idle);
      },
    );
  });

  group('PosReadControllerScope', () {
    testWidgets('reaches the controller instance it was constructed with', (tester) async {
      final controller = PosReadController(_FakeReadGateway());
      late PosReadController resolved;
      await tester.pumpWidget(
        PosReadControllerScope(
          controller: controller,
          child: Builder(
            builder: (context) {
              resolved = PosReadControllerScope.of(context);
              return const SizedBox.shrink();
            },
          ),
        ),
      );
      expect(resolved, same(controller));
    });
  });
}

PosProduct _product(String id, {String? amount, String currencyCode = 'USD'}) => PosProduct(
  id: id,
  code: id.toUpperCase(),
  name: 'Producto $id',
  type: 'simple',
  status: 'active',
  tracksInventory: false,
  pricing: amount == null
      ? const PosPricing.missing()
      : PosPricing.fromJson({'amount': amount, 'currency_code': currencyCode}),
);

PosInventoryBalance _balance(String id, {String onHand = '0.000000'}) => PosInventoryBalance(
  id: id,
  branchId: 'branch-a',
  locationId: 'location-a',
  variantId: 'variant-$id',
  onHand: onHand,
  reserved: '0.000000',
  inTransit: '0.000000',
);

class _FakeReadGateway implements PosReadGateway {
  final Map<String?, List<PosProduct>> productsByBranch = {};
  final Map<String?, List<PosInventoryBalance>> balancesByBranch = {};
  List<PosCategory> categoriesResult = const [];
  List<PosUser> usersResult = const [];

  Object? productsError;
  Duration? productsDelay;
  Completer<void>? productsGate;

  int productsCallCount = 0;
  int balancesCallCount = 0;
  int categoriesCallCount = 0;
  int usersCallCount = 0;

  @override
  Future<List<PosProduct>> products({String? branchId}) async {
    productsCallCount++;
    if (productsGate != null) await productsGate!.future;
    if (productsDelay != null) await Future<void>.delayed(productsDelay!);
    final error = productsError;
    if (error != null) throw error;
    return productsByBranch[branchId] ?? const [];
  }

  @override
  Future<PosProduct?> productByBarcode(String barcode, {String? branchId}) async =>
      (productsByBranch[branchId] ?? const []).where((p) => p.code == barcode).firstOrNull;

  @override
  Future<List<PosCategory>> categories() async {
    categoriesCallCount++;
    return categoriesResult;
  }

  @override
  Future<List<PosInventoryBalance>> inventoryBalances({String? branchId}) async {
    balancesCallCount++;
    return balancesByBranch[branchId] ?? const [];
  }

  @override
  Future<List<PosUser>> users() async {
    usersCallCount++;
    return usersResult;
  }

  @override
  Future<String> businessDate({required String timezone}) async => '2026-01-01';
}
