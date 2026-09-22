/// TASK 16.17 — the Flutter side of `GET /api/v1/readiness[?branch_id=]`
/// (`branch.read`): the backend's own evaluation of what a tenant has ready
/// and what is still missing before it can sell. This file only parses the
/// contract; it never decides readiness itself.
library;

import '../../core/networking/api_client.dart';
import 'pos_readiness_presentation.dart';

/// One entry of a check's `items` (e.g. the products lacking a price).
class PosReadinessItem {
  const PosReadinessItem({required this.id, required this.label});

  factory PosReadinessItem.fromJson(Map<String, Object?> json) =>
      PosReadinessItem(id: (json['id'] ?? '').toString(), label: (json['label'] ?? '').toString());

  final String id;
  final String label;
}

class PosReadinessCheck {
  const PosReadinessCheck({
    required this.code,
    required this.scope,
    required this.required,
    required this.status,
    required this.surface,
    required this.count,
    required this.items,
  });

  factory PosReadinessCheck.fromJson(Map<String, Object?> json) {
    final rawItems = json['items'];
    return PosReadinessCheck(
      code: json['code']! as String,
      scope: (json['scope'] as String?) ?? 'company',
      required: json['required'] == true,
      status: PosReadinessStatus.parse((json['status'] as String?) ?? ''),
      surface: (json['surface'] as String?) ?? '',
      count: (json['count'] as num?)?.toInt(),
      items: rawItems is List<Object?>
          ? rawItems.whereType<Map<String, Object?>>().map(PosReadinessItem.fromJson).toList(growable: false)
          : const [],
    );
  }

  final String code;

  /// `company` | `branch`.
  final String scope;
  final bool required;
  final PosReadinessStatus status;
  final String surface;
  final int? count;
  final List<PosReadinessItem> items;
}

class PosReadinessStage {
  const PosReadinessStage({required this.key, required this.ready, required this.blockedBy});

  factory PosReadinessStage.fromJson(Map<String, Object?> json) {
    final blocked = json['blocked_by'];
    return PosReadinessStage(
      key: json['key']! as String,
      ready: json['ready'] as bool?,
      blockedBy: blocked is List<Object?> ? blocked.whereType<String>().toList(growable: false) : const [],
    );
  }

  final String key;

  /// `null` means the stage does not apply.
  final bool? ready;
  final List<String> blockedBy;
}

class PosBranchReadiness {
  const PosBranchReadiness({
    required this.branchId,
    required this.code,
    required this.name,
    required this.checks,
    required this.stages,
  });

  factory PosBranchReadiness.fromJson(Map<String, Object?> json) => PosBranchReadiness(
    branchId: json['branch_id']! as String,
    code: (json['code'] as String?) ?? '',
    name: (json['name'] as String?) ?? '',
    checks: _list(json['checks'], PosReadinessCheck.fromJson),
    stages: _list(json['stages'], PosReadinessStage.fromJson),
  );

  final String branchId;
  final String code;
  final String name;
  final List<PosReadinessCheck> checks;
  final List<PosReadinessStage> stages;

  PosReadinessStage? stage(String key) {
    for (final s in stages) {
      if (s.key == key) return s;
    }
    return null;
  }
}

class PosTenantReadiness {
  const PosTenantReadiness({
    required this.evaluatedAt,
    required this.companyId,
    required this.companyName,
    required this.currencyCode,
    required this.timezone,
    required this.administrationReady,
    required this.companyChecks,
    required this.branches,
  });

  factory PosTenantReadiness.fromJson(Map<String, Object?> json) {
    final company = json['company'];
    final c = company is Map<String, Object?> ? company : const <String, Object?>{};
    return PosTenantReadiness(
      evaluatedAt: (json['evaluated_at'] as String?) ?? '',
      companyId: (c['id'] as String?) ?? '',
      companyName: (c['name'] as String?) ?? '',
      currencyCode: (c['currency_code'] as String?) ?? '',
      timezone: (c['timezone'] as String?) ?? '',
      administrationReady: c['administration_ready'] == true,
      companyChecks: _list(c['checks'], PosReadinessCheck.fromJson),
      branches: _list(json['branches'], PosBranchReadiness.fromJson),
    );
  }

  final String evaluatedAt;
  final String companyId;
  final String companyName;
  final String currencyCode;
  final String timezone;
  final bool administrationReady;
  final List<PosReadinessCheck> companyChecks;
  final List<PosBranchReadiness> branches;
}

List<T> _list<T>(Object? raw, T Function(Map<String, Object?>) parse) => raw is List<Object?>
    ? raw.whereType<Map<String, Object?>>().map(parse).toList(growable: false)
    : <T>[];

abstract interface class PosReadinessGateway {
  /// `GET /api/v1/readiness` (`branch.read`), optionally narrowed to one
  /// branch with `?branch_id=`.
  Future<PosTenantReadiness> readiness({String? branchId});
}

class ApiPosReadinessGateway implements PosReadinessGateway {
  const ApiPosReadinessGateway(this._client);

  final ApiClient _client;

  @override
  Future<PosTenantReadiness> readiness({String? branchId}) async {
    final path = branchId == null
        ? '/api/v1/readiness'
        : '/api/v1/readiness?branch_id=${Uri.encodeQueryComponent(branchId)}';
    final envelope = await _client.getJson(path);
    final data = envelope['data'];
    if (data is! Map<String, Object?>) {
      throw const FormatException('Missing readiness data.');
    }
    return PosTenantReadiness.fromJson(data);
  }
}

class EmptyPosReadinessGateway implements PosReadinessGateway {
  const EmptyPosReadinessGateway();

  @override
  Future<PosTenantReadiness> readiness({String? branchId}) async => const PosTenantReadiness(
    evaluatedAt: '',
    companyId: '',
    companyName: '',
    currencyCode: '',
    timezone: '',
    administrationReady: false,
    companyChecks: [],
    branches: [],
  );
}
