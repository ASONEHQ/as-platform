/// TASK 14.5 (Wave 3, Phase 8): the Flutter side of the ALREADY-REAL
/// generic per-company/per-branch settings mechanism
/// (`apps/api/src/modules/admin/settings/settings.routes.ts`) -- no
/// Flutter caller of this backend existed before this task. Deliberately
/// narrow: this gateway exposes exactly the "effective settings" read and
/// the "set one company setting" write the app currently needs (starting
/// with `pos_receipt_branding_screen.dart`'s `receipts.header_text`/
/// `receipts.footer_text`), not a full mirror of every settings route --
/// see this file's own doc comments for the branch-settings/retire
/// endpoints intentionally left unwrapped for now.
///
/// Structural template: `pos_suppliers_gateway.dart` (interface +
/// `Api...`/`Empty...` pair, `ApiClient` for transport).
library;

import '../../core/networking/api_client.dart';

/// One resolved setting exactly as `GET .../settings/effective` returns it
/// (`httpSetting` in `settings.routes.ts`) -- `value` is `String`, `bool`,
/// or (for an `integer`-typed key) an `int`; never re-typed or narrowed
/// here since this gateway is generic across every catalog key.
class PosEffectiveSetting {
  const PosEffectiveSetting({
    required this.key,
    required this.type,
    required this.value,
    required this.source,
    required this.version,
  });

  factory PosEffectiveSetting.fromJson(Map<String, Object?> json) => PosEffectiveSetting(
    key: json['key']! as String,
    type: json['type']! as String,
    value: json['value'],
    // `source` is one of 'default' | 'company' | 'branch' -- see
    // `settings.schemas.ts`'s own `settingSchema.properties.source`.
    source: json['source']! as String,
    version: (json['version']! as num).toInt(),
  );

  final String key;

  /// `string` | `boolean` | `integer` (`settings.schemas.ts`'s own
  /// `settingValueTypes`).
  final String type;
  final Object? value;

  /// `default` when the tenant never set this key (its own catalog
  /// `resolveDefault` was used); `company` when a company-level row is
  /// active; `branch` when an active branch-level override exists.
  final String source;

  /// The strong version this exact effective value carries -- send back
  /// as `If-Match: "$version"` (quoted, per `parseIfMatch` in
  /// `settings.schemas.ts`) on the next write to this same key, or the
  /// write is rejected with a 409 `version_conflict`. `1` for a
  /// never-set key (`resolveCompanySettings`'s own documented default).
  final int version;

  String? get stringValue => value is String ? value! as String : null;
  bool? get boolValue => value is bool ? value! as bool : null;
}

/// Thrown by [PosSettingsGateway.setCompanySetting] specifically for a 409
/// `version_conflict` -- see `settings.http-errors.ts`. A caller should
/// re-fetch [PosSettingsGateway.effectiveCompanySettings] and let the user
/// retry against the fresh version, never blindly overwrite.
class PosSettingVersionConflict implements Exception {
  const PosSettingVersionConflict(this.key);
  final String key;
}

abstract interface class PosSettingsGateway {
  /// `GET /api/v1/companies/{company_id}/settings/effective`
  /// (`company_settings.read`) -- [keys] restricts the response to those
  /// catalog keys (comma-joined server-side, mirroring
  /// `parseSettingKeys`); omitted returns the full approved catalog. The
  /// caller supplies `companyId` (from `AuthenticatedContext.session`)
  /// rather than this gateway assuming a session shape, matching every
  /// other `Pos*Gateway`'s own convention.
  Future<List<PosEffectiveSetting>> effectiveCompanySettings({
    required String companyId,
    List<String>? keys,
  });

  /// `PUT /api/v1/companies/{company_id}/settings/{key}`
  /// (`company_settings.update`) -- always `status: 'active'` (this
  /// gateway never wraps the "retire" write path, which the current
  /// screen has no use for: an admin who wants to clear a receipt
  /// branding text simply sets it back to `''`, a real, valid, empty
  /// string value under the `receipts.header_text`/`receipts.footer_text`
  /// catalog entries' own `boundedString(500)` rule -- never a distinct
  /// "unset" UI action). Throws [PosSettingVersionConflict] on a 409
  /// `version_conflict`; any other rejection surfaces as the normal
  /// [ApiException].
  Future<PosEffectiveSetting> setCompanySetting({
    required String companyId,
    required String key,
    required Object value,
    required String valueType,
    required int expectedVersion,
  });

  /// TASK 14.5A: `POST /api/v1/companies/{company_id}/branding/logo` --
  /// legacy parity for `AS POS V1.html`'s
  /// `cfgNegocioLogoSeleccionado()`/`aplicarBrandingNegocio()` (an
  /// operator-uploaded business logo). [bytes] are the real image file
  /// contents the caller already picked (see `pos_branding_screen.dart`);
  /// [contentType] must be one of the content types
  /// `branding.validation.ts`'s own `ALLOWED_LOGO_CONTENT_TYPES` allows
  /// (`image/png`, `image/jpeg`, `image/webp`, `image/svg+xml`) or the
  /// backend rejects it with a real 415. Same `company_settings.update`
  /// permission and `If-Match`/[PosSettingVersionConflict] contract as
  /// [setCompanySetting] -- this is still, underneath, a
  /// `branding.logo_url` company-setting write, just carried by a
  /// multipart request instead of JSON.
  Future<PosEffectiveSetting> uploadCompanyLogo({
    required String companyId,
    required List<int> bytes,
    required String filename,
    required String contentType,
    required int expectedVersion,
  });

  /// TASK 14.5A: `DELETE /api/v1/companies/{company_id}/branding/logo` --
  /// clears `branding.logo_url` back to unset (the catalog's own `''`
  /// default), mirroring the same "set it back to empty" clear semantics
  /// [setCompanySetting] documents for `receipts.header_text`, except this
  /// key has a distinct clear action because the value is never
  /// user-typable text. Same `If-Match`/[PosSettingVersionConflict]
  /// contract as every other write here.
  Future<PosEffectiveSetting> deleteCompanyLogo({
    required String companyId,
    required int expectedVersion,
  });
}

class ApiPosSettingsGateway implements PosSettingsGateway {
  const ApiPosSettingsGateway(this._client);

  final ApiClient _client;

  @override
  Future<List<PosEffectiveSetting>> effectiveCompanySettings({
    required String companyId,
    List<String>? keys,
  }) async {
    final query = keys == null || keys.isEmpty ? <String, String>{} : {'keys': keys.join(',')};
    final path = Uri(
      path: '/api/v1/companies/$companyId/settings/effective',
      queryParameters: query.isEmpty ? null : query,
    ).toString();
    final envelope = await _client.getJson(path);
    final data = envelope['data'];
    if (data is! Map<String, Object?>) {
      throw const FormatException('Missing settings data.');
    }
    final settings = data['settings'];
    if (settings is! List<Object?>) {
      throw const FormatException('Missing settings list.');
    }
    return settings
        .whereType<Map<String, Object?>>()
        .map(PosEffectiveSetting.fromJson)
        .toList(growable: false);
  }

  @override
  Future<PosEffectiveSetting> setCompanySetting({
    required String companyId,
    required String key,
    required Object value,
    required String valueType,
    required int expectedVersion,
  }) async {
    try {
      final envelope = await _client.putJson(
        '/api/v1/companies/$companyId/settings/$key',
        body: {'value': value, 'value_type': valueType, 'status': 'active'},
        ifMatch: '"$expectedVersion"',
      );
      final data = envelope['data'];
      if (data is! Map<String, Object?>) {
        throw const FormatException('Missing setting data.');
      }
      return PosEffectiveSetting.fromJson(data);
    } on ApiException catch (error) {
      if (error.failure.code == 'version_conflict') {
        throw PosSettingVersionConflict(key);
      }
      rethrow;
    }
  }

  @override
  Future<PosEffectiveSetting> uploadCompanyLogo({
    required String companyId,
    required List<int> bytes,
    required String filename,
    required String contentType,
    required int expectedVersion,
  }) async {
    try {
      final envelope = await _client.postMultipart(
        '/api/v1/companies/$companyId/branding/logo',
        fieldName: 'file',
        filename: filename,
        bytes: bytes,
        contentType: contentType,
        ifMatch: '"$expectedVersion"',
      );
      final data = envelope['data'];
      if (data is! Map<String, Object?>) {
        throw const FormatException('Missing setting data.');
      }
      return PosEffectiveSetting.fromJson(data);
    } on ApiException catch (error) {
      if (error.failure.code == 'version_conflict') {
        throw const PosSettingVersionConflict(_brandingLogoKey);
      }
      rethrow;
    }
  }

  @override
  Future<PosEffectiveSetting> deleteCompanyLogo({
    required String companyId,
    required int expectedVersion,
  }) async {
    try {
      final envelope = await _client.deleteJson(
        '/api/v1/companies/$companyId/branding/logo',
        ifMatch: '"$expectedVersion"',
      );
      final data = envelope['data'];
      if (data is! Map<String, Object?>) {
        throw const FormatException('Missing setting data.');
      }
      return PosEffectiveSetting.fromJson(data);
    } on ApiException catch (error) {
      if (error.failure.code == 'version_conflict') {
        throw const PosSettingVersionConflict(_brandingLogoKey);
      }
      rethrow;
    }
  }
}

const String _brandingLogoKey = 'branding.logo_url';

class EmptyPosSettingsGateway implements PosSettingsGateway {
  const EmptyPosSettingsGateway();

  @override
  Future<List<PosEffectiveSetting>> effectiveCompanySettings({
    required String companyId,
    List<String>? keys,
  }) async => const [];

  @override
  Future<PosEffectiveSetting> setCompanySetting({
    required String companyId,
    required String key,
    required Object value,
    required String valueType,
    required int expectedVersion,
  }) => Future.error(StateError('No settings gateway is configured.'));

  @override
  Future<PosEffectiveSetting> uploadCompanyLogo({
    required String companyId,
    required List<int> bytes,
    required String filename,
    required String contentType,
    required int expectedVersion,
  }) => Future.error(StateError('No settings gateway is configured.'));

  @override
  Future<PosEffectiveSetting> deleteCompanyLogo({
    required String companyId,
    required int expectedVersion,
  }) => Future.error(StateError('No settings gateway is configured.'));
}
