// TASK 16.15 — widget-level coverage for `PosRegisterSwitcherBar` itself
// (the pure resolution logic it's built over is covered in
// `pos_register_scope_test.dart`).
import 'package:as_one/features/pos/pos_cash_gateway.dart';
import 'package:as_one/features/pos/pos_register_scope.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

const _registerA = PosCashRegister(id: 'reg-a', branchId: 'branch-1', code: 'CAJA-A', name: 'Caja A', status: 'active');
const _registerB = PosCashRegister(id: 'reg-b', branchId: 'branch-1', code: 'CAJA-B', name: 'Caja B', status: 'active');

void main() {
  testWidgets('renders every eligible register as a choice and reports the real selected id', (tester) async {
    String? selected;
    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: PosRegisterSwitcherBar(
            registers: const [_registerA, _registerB],
            selectedRegisterId: 'reg-a',
            onSelected: (id) => selected = id,
          ),
        ),
      ),
    );
    expect(find.byKey(const Key('pos-register-switcher-bar')), findsOneWidget);
    expect(find.byKey(const Key('pos-register-switcher-dropdown')), findsOneWidget);

    await tester.tap(find.byKey(const Key('pos-register-switcher-dropdown')));
    await tester.pumpAndSettle();
    expect(find.byKey(const Key('pos-register-switcher-option-reg-a')), findsWidgets);
    expect(find.byKey(const Key('pos-register-switcher-option-reg-b')), findsWidgets);

    // `warnIfMissed: false` — the same real `DropdownMenuItem` key renders
    // twice while the menu is open (the closed field's own current
    // selection, plus the overlay's copy); `.last` reliably targets the
    // overlay one, but its hit-test box can be reported as partly
    // obscured by the overlay's own animation/barrier layers, which is
    // cosmetic here, not a real tap failure (`selected` below proves the
    // tap landed).
    await tester.tap(find.byKey(const Key('pos-register-switcher-option-reg-b')).last, warnIfMissed: false);
    await tester.pumpAndSettle();
    expect(selected, 'reg-b');
  });

  testWidgets('a null selected id shows the honest hint text, never a fabricated default', (tester) async {
    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: PosRegisterSwitcherBar(
            registers: const [_registerA, _registerB],
            selectedRegisterId: null,
            onSelected: (_) {},
          ),
        ),
      ),
    );
    expect(find.text('Selecciona tu caja'), findsOneWidget);
  });
}
