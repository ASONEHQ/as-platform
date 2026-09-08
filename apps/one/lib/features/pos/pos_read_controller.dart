import 'package:flutter/foundation.dart';

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

class PosReadController extends ChangeNotifier {
  PosReadController(this._gateway);

  final PosReadGateway _gateway;
  PosReadState<PosProduct> products = const PosReadState(PosReadPhase.idle);
  PosReadState<PosCategory> categories = const PosReadState(
    PosReadPhase.idle,
  );
  PosReadState<PosInventoryBalance> balances = const PosReadState(
    PosReadPhase.idle,
  );
  PosReadState<PosUser> users = const PosReadState(PosReadPhase.idle);

  /// TASK 14.3 (Wave 1, Part B.2): a plain, read-only, one-off barcode
  /// lookup — never mutates [products]' own cached state, and never
  /// caught/swallowed here: [ApiException]/other errors propagate so the
  /// caller (the ticket search box) can show the exact real failure.
  Future<PosProduct?> lookupByBarcode(String barcode, {String? branchId}) =>
      _gateway.productByBarcode(barcode, branchId: branchId);

  Future<void> loadProducts({String? branchId, bool refresh = false}) async {
    if (!refresh && products.phase != PosReadPhase.idle) return;
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
  }

  Future<void> loadCategories({bool refresh = false}) async {
    if (!refresh && categories.phase != PosReadPhase.idle) return;
    categories = const PosReadState(PosReadPhase.loading);
    notifyListeners();
    try {
      final items = await _gateway.categories();
      categories = PosReadState(
        items.isEmpty ? PosReadPhase.empty : PosReadPhase.ready,
        items: items,
      );
    } on Object catch (error) {
      categories = PosReadState(
        PosReadPhase.failure,
        message: _message(error),
      );
    }
    notifyListeners();
  }

  Future<void> loadBalances({String? branchId, bool refresh = false}) async {
    if (!refresh && balances.phase != PosReadPhase.idle) return;
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
  }

  Future<void> loadUsers({bool refresh = false}) async {
    if (!refresh && users.phase != PosReadPhase.idle) return;
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
