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
  });

  final String id;
  final String userId;
  final String companyId;
  final String? branchId;
  final List<String> permittedBranchIds;
  final bool companyWideAccess;
  final DateTime expiresAt;
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
  });
  final String id;
  final String name;
  final bool current;
  final bool switchPermitted;
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
