import 'dart:async' show unawaited;

import 'package:flutter/widgets.dart';

import '../../core/errors/app_error.dart';
import '../../core/networking/api_client.dart';
import 'pos_models.dart';
import 'pos_read_gateway.dart';

enum PosReadPhase { idle, loading, ready, empty, failure }

class PosReadState<T> {
  const PosReadState(this.phase, {this.items = const [], this.message});

  final PosReadPhase phase;
  final List<T> items;
  final String? message;
}

/// TASK 16.17A — the single shared cache of POS-visible read state
/// (products/categories/inventory balances/users), and the SINGLE place
/// that decides when it is stale.
///
/// **The bug this closes.** TASK 16.17's live certification found that a
/// product priced moments earlier by an admin still showed "Sin precio"
/// on the POS sale grid: `loadProducts`'s own idle-guard (`if (!refresh
/// && phase != idle) return;`) meant a product/price mutation made
/// through a completely different gateway (`PosCatalogAdminGateway`, with
/// no awareness this controller even exists) left the cached list frozen
/// until *something* happened to call `refresh: true` — an accident of
/// which screen the admin happened to visit next, not a designed
/// guarantee.
///
/// **The fix, in one sentence:** every mutation that can change what this
/// controller has already cached calls one of the `invalidate*` methods
/// below (via the decorators in `pos_catalog_freshness_gateways.dart`,
/// or — for a completed sale, the one mutation that happens inside
/// `pos_shell.dart` itself — via [PosReadControllerScope]), and
/// `invalidate*` EAGERLY re-fetches and calls [notifyListeners] the
/// moment fresh data lands. Every screen that renders `products`/
/// `categories`/`balances`/`users` already does so inside `_Content`'s
/// own `AnimatedBuilder(animation: controller, ...)` (see
/// `pos_shell.dart`), so a fresh [notifyListeners] rebuilds whatever is
/// CURRENTLY on screen — no navigation, no manual "Actualizar", no
/// reload required. This is deliberately the ONLY invalidation
/// mechanism: nothing else in this app calls `loadProducts(refresh:
/// true)`/`loadBalances(refresh: true)` directly except the two places
/// that already legitimately need an unconditional reload (a real branch
/// switch, and the admin "Actualizar" button, both unchanged).
///
/// **Branch/company scoping.** [loadProducts]/[loadBalances] now track
/// the `branchId` they were last (successfully or currently) fetched
/// for. Calling either with a DIFFERENT `branchId` than that — even
/// without `refresh: true` — is treated as a genuine scope change and
/// always re-fetches: a company-wide admin screen loading with
/// `branchId: null` right after the POS screen loaded with a real
/// branch id (or vice versa) can never silently keep serving the wrong
/// scope's prices. A full identity change (a different company —
/// `AuthController.switchCompany`, which keeps this controller's own
/// widget subtree mounted, unlike a logout) is handled by [reset],
/// called from `pos_shell.dart`'s own `didUpdateWidget` the moment the
/// session's `companyId` changes.
///
/// **Failure behavior.** A failed mutation never reaches an `invalidate*`
/// call at all (the decorators only invalidate after the underlying
/// gateway call resolves successfully — see that file). A failed
/// REVALIDATION (the invalidate's own re-fetch) surfaces exactly like any
/// other failed load always has — `PosReadPhase.failure` with the real
/// error message, on the existing retry-button affordances — never a
/// silently-kept-stale value pretending to be fresh, and never a
/// fabricated price/stock number.
class PosReadController extends ChangeNotifier {
  PosReadController(this._gateway);

  final PosReadGateway _gateway;
  PosReadState<PosProduct> products = const PosReadState(PosReadPhase.idle);
  PosReadState<PosCategory> categories = const PosReadState(PosReadPhase.idle);
  PosReadState<PosInventoryBalance> balances = const PosReadState(PosReadPhase.idle);
  PosReadState<PosUser> users = const PosReadState(PosReadPhase.idle);

  // The `branchId` each resource was last loaded (or is currently being
  // loaded) for. `_productsRequested`/`_balancesRequested` distinguish
  // "never asked" (`idle`, no scope opinion yet) from "asked for `null`"
  // (a real, deliberate company-wide scope) — both start `false`/`null`.
  String? _productsScope;
  bool _productsRequested = false;
  String? _balancesScope;
  bool _balancesRequested = false;

  // In-flight coalescing: at most one real HTTP request per resource at
  // a time. A second caller (or a mutation's own invalidate) that arrives
  // while one is already running never fires a concurrent duplicate —
  // it marks `_...PendingRerun` and the in-flight request re-runs itself
  // exactly once more when it finishes, which is always fresh enough
  // (it starts strictly after every write that happened before it was
  // requested). This is what keeps a burst of mutations from ever
  // becoming a request storm.
  Future<void>? _productsLoad;
  bool _productsPendingRerun = false;
  Future<void>? _balancesLoad;
  bool _balancesPendingRerun = false;
  Future<void>? _categoriesLoad;
  bool _categoriesPendingRerun = false;
  Future<void>? _usersLoad;
  bool _usersPendingRerun = false;

  /// TASK 14.3 (Wave 1, Part B.2): a plain, read-only, one-off barcode
  /// lookup — never mutates [products]' own cached state, and never
  /// caught/swallowed here: [ApiException]/other errors propagate so the
  /// caller (the ticket search box) can show the exact real failure.
  Future<PosProduct?> lookupByBarcode(String barcode, {String? branchId}) =>
      _gateway.productByBarcode(barcode, branchId: branchId);

  Future<void> loadProducts({String? branchId, bool refresh = false}) {
    final scopeStale = _productsRequested && branchId != _productsScope;
    if (!refresh && !scopeStale && products.phase != PosReadPhase.idle) {
      return _productsLoad ?? Future<void>.value();
    }
    if (_productsLoad != null) {
      _productsPendingRerun = true;
      return _productsLoad!;
    }
    return _productsLoad = _runProductsLoad(branchId);
  }

  Future<void> _runProductsLoad(String? branchId) async {
    _productsRequested = true;
    _productsScope = branchId;
    products = const PosReadState(PosReadPhase.loading);
    notifyListeners();
    try {
      final items = await _gateway.products(branchId: branchId);
      products = PosReadState(
        items.isEmpty ? PosReadPhase.empty : PosReadPhase.ready,
        items: items,
      );
    } on Object catch (error) {
      products = PosReadState(PosReadPhase.failure, message: _message(error));
    }
    notifyListeners();
    _productsLoad = null;
    if (_productsPendingRerun) {
      _productsPendingRerun = false;
      unawaited(loadProducts(branchId: _productsScope, refresh: true));
    }
  }

  /// TASK 16.17A — call after any successful mutation that could change
  /// what a product tile shows: price create/change/end, product
  /// create/edit/activate/deactivate, a POS-visibility toggle, a product
  /// image/style change. A deliberate no-op while nothing has ever been
  /// requested yet (`idle`) — there is nothing cached to go stale, and
  /// the next real [loadProducts] call already fetches current data.
  Future<void> invalidateProducts() {
    if (!_productsRequested) return Future<void>.value();
    return loadProducts(branchId: _productsScope, refresh: true);
  }

  Future<void> loadBalances({String? branchId, bool refresh = false}) {
    final scopeStale = _balancesRequested && branchId != _balancesScope;
    if (!refresh && !scopeStale && balances.phase != PosReadPhase.idle) {
      return _balancesLoad ?? Future<void>.value();
    }
    if (_balancesLoad != null) {
      _balancesPendingRerun = true;
      return _balancesLoad!;
    }
    return _balancesLoad = _runBalancesLoad(branchId);
  }

  Future<void> _runBalancesLoad(String? branchId) async {
    _balancesRequested = true;
    _balancesScope = branchId;
    balances = const PosReadState(PosReadPhase.loading);
    notifyListeners();
    try {
      final items = await _gateway.inventoryBalances(branchId: branchId);
      balances = PosReadState(
        items.isEmpty ? PosReadPhase.empty : PosReadPhase.ready,
        items: items,
      );
    } on Object catch (error) {
      balances = PosReadState(PosReadPhase.failure, message: _message(error));
    }
    notifyListeners();
    _balancesLoad = null;
    if (_balancesPendingRerun) {
      _balancesPendingRerun = false;
      unawaited(loadBalances(branchId: _balancesScope, refresh: true));
    }
  }

  /// TASK 16.17A — call after any successful mutation that could change
  /// on-hand/reserved quantities: an inventory receipt/adjustment/
  /// transfer/count/reconciliation repair, a direct purchase or
  /// purchase-order receipt, or (see `pos_shell.dart`'s own
  /// `PosReadControllerScope` use in its three sale-completion
  /// functions) a completed sale's own server-side stock consumption.
  Future<void> invalidateBalances() {
    if (!_balancesRequested) return Future<void>.value();
    return loadBalances(branchId: _balancesScope, refresh: true);
  }

  Future<void> loadCategories({bool refresh = false}) {
    if (!refresh && categories.phase != PosReadPhase.idle) {
      return _categoriesLoad ?? Future<void>.value();
    }
    if (_categoriesLoad != null) {
      _categoriesPendingRerun = true;
      return _categoriesLoad!;
    }
    return _categoriesLoad = _runCategoriesLoad();
  }

  Future<void> _runCategoriesLoad() async {
    categories = const PosReadState(PosReadPhase.loading);
    notifyListeners();
    try {
      final items = await _gateway.categories();
      categories = PosReadState(
        items.isEmpty ? PosReadPhase.empty : PosReadPhase.ready,
        items: items,
      );
    } on Object catch (error) {
      categories = PosReadState(PosReadPhase.failure, message: _message(error));
    }
    notifyListeners();
    _categoriesLoad = null;
    if (_categoriesPendingRerun) {
      _categoriesPendingRerun = false;
      unawaited(loadCategories(refresh: true));
    }
  }

  /// TASK 16.17A — call after a category is created/edited/retired.
  Future<void> invalidateCategories() {
    if (categories.phase == PosReadPhase.idle) return Future<void>.value();
    return loadCategories(refresh: true);
  }

  Future<void> loadUsers({bool refresh = false}) {
    if (!refresh && users.phase != PosReadPhase.idle) {
      return _usersLoad ?? Future<void>.value();
    }
    if (_usersLoad != null) {
      _usersPendingRerun = true;
      return _usersLoad!;
    }
    return _usersLoad = _runUsersLoad();
  }

  Future<void> _runUsersLoad() async {
    users = const PosReadState(PosReadPhase.loading);
    notifyListeners();
    try {
      final items = await _gateway.users();
      users = PosReadState(
        items.isEmpty ? PosReadPhase.empty : PosReadPhase.ready,
        items: items,
      );
    } on Object catch (error) {
      users = PosReadState(PosReadPhase.failure, message: _message(error));
    }
    notifyListeners();
    _usersLoad = null;
    if (_usersPendingRerun) {
      _usersPendingRerun = false;
      unawaited(loadUsers(refresh: true));
    }
  }

  /// TASK 16.17A — a full-identity reset: every resource goes back to
  /// `idle` and forgets its last-used scope, in ONE `notifyListeners`
  /// call. Used only when the underlying identity this cache is scoped
  /// to genuinely changes while this controller's own widget subtree
  /// stays mounted — `AuthController.switchCompany`, detected by
  /// `pos_shell.dart`'s own `didUpdateWidget` the moment `widget.context.
  /// session.companyId` changes. A real branch switch within the SAME
  /// company deliberately does NOT call this — it keeps using the
  /// narrower, already-correct `loadProducts(branchId: ..., refresh:
  /// true)`/`loadBalances(...)` reload `pos_shell.dart` already performs
  /// for that case, which is enough (categories/users are company-wide,
  /// not branch-scoped, so they need no branch-triggered reset). A
  /// logout is handled even more simply and is not this method's
  /// concern: `DashboardScreen`'s own State (which owns this
  /// controller's lifetime) is unmounted and disposed by the router the
  /// moment `AuthPhase` leaves `authenticated`, and a fresh login
  /// mounts a brand-new `DashboardScreen`/`PosReadController` with no
  /// residual state at all — see `pos_read_controller_test.dart`'s own
  /// "logout disposes, a fresh login starts idle" case.
  void reset() {
    products = const PosReadState(PosReadPhase.idle);
    categories = const PosReadState(PosReadPhase.idle);
    balances = const PosReadState(PosReadPhase.idle);
    users = const PosReadState(PosReadPhase.idle);
    _productsScope = null;
    _productsRequested = false;
    _balancesScope = null;
    _balancesRequested = false;
    // Any request already in flight is deliberately left to finish on its
    // own terms (its result is simply discarded by the `idle` phase it
    // was never told about — Dart has no cooperative Future cancellation
    // — the NEXT real `load*` call performs a fresh fetch regardless of
    // what that abandoned request eventually returns, since `_...Load`
    // being non-null only ever coalesces calls for the SAME scope this
    // method just cleared).
    _productsLoad = null;
    _productsPendingRerun = false;
    _balancesLoad = null;
    _balancesPendingRerun = false;
    _categoriesLoad = null;
    _categoriesPendingRerun = false;
    _usersLoad = null;
    _usersPendingRerun = false;
    notifyListeners();
  }

  String _message(Object error) => switch (error) {
    ApiException(:final failure) => failure.message,
    FormatException() => 'La respuesta del servicio no es válida.',
    _ => const AppFailure(
      AppErrorKind.unavailable,
      'El servicio no está disponible.',
      code: 'api_unavailable',
    ).message,
  };
}

/// TASK 16.17A — reaches the shell's own single [PosReadController]
/// instance from any descendant by [BuildContext] alone, without
/// threading it through every intermediate widget's constructor. This
/// exists ONLY so `pos_shell.dart`'s three sale-completion functions
/// (`_submitSaleForPayment`/`_submitCashSaleForPayment`/
/// `_submitZeroTotalSale`, which already take `BuildContext context` as
/// their first parameter) can call `invalidateBalances()` the moment a
/// sale genuinely completes, without adding a `PosReadController`
/// parameter to every widget between `_PosSaleState` and its deepest
/// checkout button. Every actual READ of cached state continues to go
/// through the `controller`/`widget.controller` field each widget
/// already receives explicitly — this is deliberately never a second
/// read path, only a way to reach `invalidate*`.
class PosReadControllerScope extends InheritedWidget {
  const PosReadControllerScope({
    required this.controller,
    required super.child,
    super.key,
  });

  final PosReadController controller;

  static PosReadController of(BuildContext context) {
    final scope = context
        .getElementForInheritedWidgetOfExactType<PosReadControllerScope>()
        ?.widget;
    assert(scope != null, 'No PosReadControllerScope found in context.');
    return (scope! as PosReadControllerScope).controller;
  }

  @override
  bool updateShouldNotify(PosReadControllerScope oldWidget) =>
      controller != oldWidget.controller;
}
