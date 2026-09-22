import '../../core/errors/app_error.dart';

class SessionContext {
  const SessionContext({
    required this.id,
    required this.userId,
    required this.companyId,
    required this.permittedBranchIds,
    required this.companyWideAccess,
    required this.expiresAt,
    this.branchId,
    this.permittedRegisterIds,
  });

  final String id;
  final String userId;
  final String companyId;
  final String? branchId;
  final List<String> permittedBranchIds;
  final bool companyWideAccess;
  final DateTime expiresAt;
  // TASK 16.15 — a convenience UX snapshot only, exactly like
  // `permittedBranchIds`: never the enforcement source (the backend
  // re-resolves its own register scope fresh on every request). `null`
  // means unrestricted — the cashier may use any register in their
  // permitted branches (the default/backward-compatible case for every
  // existing cashier/manager/owner). A non-null list narrows them to
  // exactly those register ids. Used only to decide, client-side, whether
  // to show a register switcher or auto-route a single-register cashier —
  // see `PosRegisterScope` in `pos_register_scope.dart`.
  final List<String>? permittedRegisterIds;
}

class UserSummary {
  const UserSummary({
    required this.id,
    required this.displayName,
    required this.email,
  });
  final String id;
  final String displayName;
  final String email;
}

class CompanySummary {
  const CompanySummary({
    required this.id,
    required this.name,
    this.current = false,
    this.switchPermitted = true,
    this.currencyCode,
  });
  final String id;
  final String name;
  final bool current;
  final bool switchPermitted;

  /// The tenant's own ISO-4217 currency (`GET /context/companies`
  /// `currency_code`); `null` when the backend did not send it.
  final String? currencyCode;
}

class BranchSummary {
  const BranchSummary({
    required this.id,
    required this.code,
    required this.name,
    required this.timezone,
    this.current = false,
    this.isDefault = false,
  });
  final String id;
  final String code;
  final String name;
  final String timezone;
  final bool current;
  final bool isDefault;
}

class SessionCredentials {
  const SessionCredentials({
    required this.accessToken,
    required this.csrfToken,
    required this.session,
  });
  final String accessToken;
  final String csrfToken;
  final SessionContext session;
}

class AuthenticatedContext {
  const AuthenticatedContext({
    required this.session,
    required this.user,
    required this.companies,
    required this.branches,
    required this.companyWideAccess,
    required this.permissions,
  });
  final SessionContext session;
  final UserSummary user;
  final List<CompanySummary> companies;
  final List<BranchSummary> branches;
  final bool companyWideAccess;
  final List<String> permissions;

  CompanySummary? get currentCompany =>
      companies.where((value) => value.current).firstOrNull;
  BranchSummary? get currentBranch =>
      branches.where((value) => value.current).firstOrNull;

  /// The tenant's currency. 'MXN' is only the legacy fallback for a backend
  /// that did not send `currency_code`.
  String get companyCurrencyCode => currentCompany?.currencyCode ?? 'MXN';
}

sealed class LoginOutcome {
  const LoginOutcome();
}

class LoginAuthenticated extends LoginOutcome {
  const LoginAuthenticated(this.credentials);
  final SessionCredentials credentials;
}

class LoginCompanySelection extends LoginOutcome {
  const LoginCompanySelection({
    required this.challengeToken,
    required this.expiresAt,
    required this.companies,
  });
  final String challengeToken;
  final DateTime expiresAt;
  final List<CompanySummary> companies;
}

class BrowserBootstrap {
  const BrowserBootstrap({required this.csrfToken, required this.expiresAt});
  final String csrfToken;
  final DateTime expiresAt;
}

class AuthViewState {
  const AuthViewState({
    required this.phase,
    this.failure,
    this.context,
    this.selectionCompanies = const [],
    this.selectionBranches = const [],
  });
  final AuthPhase phase;
  final AppFailure? failure;
  final AuthenticatedContext? context;
  final List<CompanySummary> selectionCompanies;
  final List<BranchSummary> selectionBranches;
}

enum AuthPhase {
  bootstrapping,
  unauthenticated,
  authenticating,
  companySelectionRequired,
  selectingCompany,
  branchSelectionRequired,
  selectingBranch,
  authenticated,
  refreshing,
  expired,
  revoked,
  unavailable,
  failure,
}

extension FirstOrNull<T> on Iterable<T> {
  T? get firstOrNull {
    final iterator = this.iterator;
    return iterator.moveNext() ? iterator.current : null;
  }
}
