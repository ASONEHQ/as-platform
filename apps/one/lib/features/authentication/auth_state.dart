import 'package:flutter/foundation.dart';

enum AuthPhase {
  unauthenticated,
  authenticating,
  companySelectionRequired,
  branchSelectionRequired,
  authenticated,
  refreshing,
  expired,
  revoked,
  unavailable,
  failure,
}

class AuthStatus {
  const AuthStatus(this.phase, {this.message});
  const AuthStatus.unauthenticated() : this(AuthPhase.unauthenticated);
  const AuthStatus.authenticated() : this(AuthPhase.authenticated);
  final AuthPhase phase;
  final String? message;
}

class AuthController extends ChangeNotifier {
  AuthController(this._status);
  AuthStatus _status;
  AuthStatus get status => _status;
  void transition(AuthStatus next) {
    if (_status.phase == next.phase && _status.message == next.message) return;
    _status = next;
    notifyListeners();
  }
}

abstract interface class AuthGateway {
  Future<void> login({required String identifier, required String password});
  Future<void> completeCompanySelection({
    required String challengeToken,
    required String companyId,
    String? branchId,
  });
  Future<void> switchCompany(String companyId, {String? branchId});
  Future<void> switchBranch(String? branchId);
  Future<void> refresh();
  Future<void> logout();
  Future<void> currentSession();
}
