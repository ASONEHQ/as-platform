/// TASK 16.6B — unit coverage for `AppFailure.fromCode` itself, found
/// missing while wiring `_EditProductDialog`'s own "Guardar precio" action
/// (`pos_shell.dart`): `'price_conflict'` (the real 409 the backend sends
/// when `product_prices_company_active_uq`/`_branch_active_uq` is
/// violated) was UNMAPPED in this switch, so it silently fell into the
/// generic `_` case and `AppFailure.code` came back `'unknown'` — meaning
/// `priceConflictMessage` (`pos_catalog_admin_screen.dart`), despite
/// existing since TASK 15.1 Phase 4 specifically to give this error an
/// honest, actionable message, could never actually fire. Fixed by adding
/// a real `'price_conflict'` case (see `app_error.dart`); this file proves
/// it at the unit level, since `pos_product_catalog_parity_test.dart`'s own
/// widget coverage for the same fix constructs the `ApiException` directly
/// and so never exercises `fromCode` itself.
library;

import 'package:as_one/core/errors/app_error.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  group('AppFailure.fromCode', () {
    test('price_conflict decodes to its own real code, never the generic "unknown" fallback', () {
      final failure = AppFailure.fromCode('price_conflict');
      expect(failure.code, 'price_conflict');
      expect(failure.kind, AppErrorKind.validation);
    });

    test('a genuinely unmapped code still safely falls back to "unknown" — the fix stays scoped', () {
      final failure = AppFailure.fromCode('some_code_this_app_has_never_heard_of');
      expect(failure.code, 'unknown');
      expect(failure.kind, AppErrorKind.unknown);
      expect(failure.message, 'No fue posible completar la solicitud.');
    });

    // TASK 16.19 — the exact same class of bug TASK 16.6B already found
    // and fixed once for `price_conflict`, reproduced live: a real 422
    // `capacity_exceeded` response from `POST /party-reservations` showed
    // the generic "No fue posible completar la solicitud." instead of the
    // real, already-written honest message, because these two codes had
    // no case here — `posPartyErrorMessage`'s own switch (which DOES
    // handle them) never got the real code to match against, only
    // `'unknown'`. Caught only by live browser certification against the
    // real API — every widget test for this (`pos_shell_test.dart`'s own
    // "a 422 capacity_exceeded response surfaces..." case) constructs the
    // `ApiException`/`AppFailure` directly and so never exercises
    // `fromCode` itself, exactly like this file's own header doc comment
    // already warns.
    test('capacity_exceeded decodes to its own real code, never the generic "unknown" fallback', () {
      final failure = AppFailure.fromCode('capacity_exceeded');
      expect(failure.code, 'capacity_exceeded');
      expect(failure.kind, AppErrorKind.validation);
    });

    test('package_room_not_eligible decodes to its own real code, never the generic "unknown" fallback', () {
      final failure = AppFailure.fromCode('package_room_not_eligible');
      expect(failure.code, 'package_room_not_eligible');
      expect(failure.kind, AppErrorKind.validation);
    });
  });
}
