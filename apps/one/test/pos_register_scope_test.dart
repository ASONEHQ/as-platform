// TASK 16.15 — pure unit tests for `resolvePosRegisterScope`, the register-
// switcher's own resolution logic. Extracted into `pos_register_scope.dart`
// specifically so this behavior is testable without driving the entire
// `pos_shell.dart` POS surface — see that file's own header doc comment.
import 'package:as_one/features/pos/pos_cash_gateway.dart';
import 'package:as_one/features/pos/pos_register_scope.dart';
import 'package:flutter_test/flutter_test.dart';

const _registerA = PosCashRegister(id: 'reg-a', branchId: 'branch-1', code: 'CAJA-A', name: 'Caja A', status: 'active');
const _registerB = PosCashRegister(id: 'reg-b', branchId: 'branch-1', code: 'CAJA-B', name: 'Caja B', status: 'active');
const _registerC = PosCashRegister(id: 'reg-c', branchId: 'branch-1', code: 'CAJA-C', name: 'Caja C', status: 'active');

void main() {
  group('permittedRegisterIds non-null (restricted cashier)', () {
    // TASK 16.15's own explicit constraint: "nothing here is allowed to
    // force a 'select your register' step on a cashier who only has one
    // permitted register; auto-navigate them straight to their one
    // workspace."
    test('exactly one permitted register auto-selects silently, never shows the switcher', () {
      final scope = resolvePosRegisterScope(
        permittedRegisterIds: const ['reg-a'],
        branchRegisters: const [_registerA, _registerB, _registerC],
      );
      expect(scope.showSwitcher, isFalse);
      expect(scope.autoSelectedRegisterId, 'reg-a');
      expect(scope.eligibleRegisters, [_registerA]);
    });

    test('more than one permitted register shows the switcher scoped to exactly those registers', () {
      final scope = resolvePosRegisterScope(
        permittedRegisterIds: const ['reg-a', 'reg-b'],
        branchRegisters: const [_registerA, _registerB, _registerC],
      );
      expect(scope.showSwitcher, isTrue);
      expect(scope.autoSelectedRegisterId, isNull);
      expect(scope.eligibleRegisters, [_registerA, _registerB]);
      // `reg-c` is not permitted — must never appear as a choice.
      expect(scope.eligibleRegisters.map((r) => r.id), isNot(contains('reg-c')));
    });

    test('a permitted register id that no longer resolves to a real branch register never auto-selects a ghost', () {
      final scope = resolvePosRegisterScope(
        permittedRegisterIds: const ['reg-does-not-exist'],
        branchRegisters: const [_registerA, _registerB],
      );
      expect(scope.showSwitcher, isFalse);
      expect(scope.autoSelectedRegisterId, isNull);
      expect(scope.eligibleRegisters, isEmpty);
    });
  });

  group('permittedRegisterIds null (unrestricted cashier)', () {
    test('exactly one currently open register auto-selects silently, never shows the switcher', () {
      final scope = resolvePosRegisterScope(
        permittedRegisterIds: null,
        branchRegisters: const [_registerA, _registerB],
        singleOpenRegisterId: 'reg-a',
      );
      expect(scope.showSwitcher, isFalse);
      expect(scope.autoSelectedRegisterId, 'reg-a');
    });

    // Zero or multiple open registers is genuinely ambiguous for an
    // unrestricted cashier — this must never force a picker (a real UX
    // regression for the common case), and must never guess.
    test('no single open register never forces a switcher and never auto-selects', () {
      final scope = resolvePosRegisterScope(
        permittedRegisterIds: null,
        branchRegisters: const [_registerA, _registerB, _registerC],
        singleOpenRegisterId: null,
      );
      expect(scope.showSwitcher, isFalse);
      expect(scope.autoSelectedRegisterId, isNull);
    });

    test('an unrestricted cashier sees every branch register as eligible', () {
      final scope = resolvePosRegisterScope(
        permittedRegisterIds: null,
        branchRegisters: const [_registerA, _registerB, _registerC],
      );
      expect(scope.eligibleRegisters, [_registerA, _registerB, _registerC]);
    });
  });

  // Existing single-register tenants (the overwhelmingly common case) must
  // keep working exactly as before — never see any new UI at all.
  test('a single-register branch with an unrestricted cashier and no open session shows nothing new', () {
    final scope = resolvePosRegisterScope(
      permittedRegisterIds: null,
      branchRegisters: const [_registerA],
    );
    expect(scope.showSwitcher, isFalse);
    // No auto-selection either, since no open-session signal was supplied
    // — this mirrors exactly the pre-TASK-16.15 behavior of sending no
    // `cash_register_id` at all when the caller doesn't independently know
    // one; the real single-register auto-select case is covered by
    // `singleOpenRegisterId` above, matching how `_PosSaleState` actually
    // resolves it in production (via `openSessionForBranch`).
    expect(scope.autoSelectedRegisterId, isNull);
  });
}
