/// TASK 16.15 — "which cash register is this cashier operating right now?"
/// Pure, UI-independent resolution logic ([resolvePosRegisterScope]) plus
/// the one small switcher widget ([PosRegisterSwitcherBar]) built over it.
/// Extracted into its own file, rather than living inline inside
/// `pos_shell.dart`'s `_PosSaleState`, specifically so it is unit/widget
/// testable without needing to drive the entire POS shell (`pos_shell.dart`
/// prefixes almost everything with `_`, making it library-private and
/// untestable from `apps/one/test`).
///
/// Never enforcement — the backend independently re-verifies cash-register
/// scope on every mutating request (see `SessionContext.
/// permittedRegisterIds`'s own doc comment); this only decides UX:
/// auto-select silently vs. ask the cashier to pick.
///
/// The one real caller is `_PosSaleState` in `pos_shell.dart`, which:
///   1. Loads `PosCashGateway.registersForBranch(branchId)` (and, only when
///      unrestricted, `openSessionForBranch(branchId)` to learn whether
///      exactly one register is currently open) whenever the branch
///      changes.
///   2. Calls [resolvePosRegisterScope] with that data plus the session's
///      own `permittedRegisterIds`.
///   3. When [PosRegisterScopeResolution.autoSelectedRegisterId] is
///      non-null, silently calls `SaleSession.setCashRegister` with it —
///      never shows [PosRegisterSwitcherBar] in that case.
///   4. When [PosRegisterScopeResolution.showSwitcher] is `true`, renders
///      [PosRegisterSwitcherBar] so the cashier can explicitly pick.
library;

import 'package:flutter/material.dart';

import 'pos_cash_gateway.dart';
import 'pos_tokens.dart';

/// The outcome of resolving "which register(s) can this cashier use right
/// now, and do they need to be asked?".
@immutable
class PosRegisterScopeResolution {
  const PosRegisterScopeResolution({
    required this.eligibleRegisters,
    required this.showSwitcher,
    required this.autoSelectedRegisterId,
  });

  /// The registers this cashier could legitimately pick from right now —
  /// already filtered by `permittedRegisterIds` when that was non-null.
  final List<PosCashRegister> eligibleRegisters;

  /// `true` only when the cashier must make an explicit choice — never
  /// `true` for a single-register tenant or a single-permitted-register
  /// cashier. TASK 16.15's own explicit constraint: "nothing here is
  /// allowed to force a 'select your register' step on a cashier who only
  /// has one permitted register."
  final bool showSwitcher;

  /// Non-null exactly when this resolves to one clear register without
  /// asking the cashier — either because `permittedRegisterIds` narrowed
  /// them to exactly one, or (when unrestricted) the branch happens to
  /// have exactly one currently open register (the backend's own
  /// best-effort single-open-register fallback, mirrored here so the
  /// Flutter POS flow can send `cash_register_id` explicitly instead of
  /// relying on that fallback — see `sales.routes.ts`'s own doc comment on
  /// `CreateSaleInput.cashRegisterId`).
  final String? autoSelectedRegisterId;
}

/// Resolves [PosRegisterScopeResolution] from:
///   * [permittedRegisterIds] — `SessionContext.permittedRegisterIds`.
///     `null` means unrestricted; a non-null list narrows the cashier to
///     exactly those register ids.
///   * [branchRegisters] — every active register in the current branch
///     (`PosCashGateway.registersForBranch`).
///   * [singleOpenRegisterId] — the `cashRegisterId` of the branch's one
///     currently open cash session, ONLY when there is exactly one (the
///     caller is responsible for passing `null` here whenever there are
///     zero or more-than-one open sessions, or whenever
///     [permittedRegisterIds] is non-null — this value is only ever
///     consulted in the unrestricted case).
///
/// Rules (TASK 16.15's own explicit spec):
///   * `permittedRegisterIds` non-null with exactly one entry (that also
///     resolves to a real branch register) → auto-select it silently, no
///     switcher — "never showing a selector UI at all."
///   * `permittedRegisterIds` non-null with more than one entry → show the
///     switcher, scoped to exactly those registers.
///   * `permittedRegisterIds` null (unrestricted) and [singleOpenRegisterId]
///     is non-null → auto-select it silently, no switcher — "the branch
///     only has one open register" case.
///   * `permittedRegisterIds` null and [singleOpenRegisterId] is null
///     (zero or multiple open registers) → never force a picker; resolves
///     to no auto-selection and no switcher. `POST /sales` is sent without
///     an explicit `cash_register_id` in this case, exactly like every
///     sale before TASK 16.15 — a real, honest "ambiguous, don't guess"
///     outcome, never a fabricated choice.
PosRegisterScopeResolution resolvePosRegisterScope({
  required List<String>? permittedRegisterIds,
  required List<PosCashRegister> branchRegisters,
  String? singleOpenRegisterId,
}) {
  if (permittedRegisterIds != null) {
    final eligible = branchRegisters
        .where((register) => permittedRegisterIds.contains(register.id))
        .toList(growable: false);
    if (eligible.length <= 1) {
      return PosRegisterScopeResolution(
        eligibleRegisters: eligible,
        showSwitcher: false,
        autoSelectedRegisterId: eligible.isEmpty ? null : eligible.single.id,
      );
    }
    return PosRegisterScopeResolution(
      eligibleRegisters: eligible,
      showSwitcher: true,
      autoSelectedRegisterId: null,
    );
  }
  // Unrestricted: never force a picker — see this function's own doc
  // comment on the "zero or multiple open registers" outcome.
  return PosRegisterScopeResolution(
    eligibleRegisters: branchRegisters,
    showSwitcher: false,
    autoSelectedRegisterId: singleOpenRegisterId,
  );
}

/// A compact, dismissable-by-design (only ever rendered when
/// [PosRegisterScopeResolution.showSwitcher] is `true`) bar letting a
/// multi-register-permitted cashier pick which physical register they're
/// operating. Deliberately tiny — this is a convenience selector, not a
/// blocking gate; [selectedRegisterId] may be `null` (no explicit pick
/// yet), in which case sales are simply sent without a `cash_register_id`
/// until the cashier picks one.
class PosRegisterSwitcherBar extends StatelessWidget {
  const PosRegisterSwitcherBar({
    required this.registers,
    required this.selectedRegisterId,
    required this.onSelected,
    super.key,
  });

  final List<PosCashRegister> registers;
  final String? selectedRegisterId;
  final ValueChanged<String> onSelected;

  @override
  Widget build(BuildContext context) {
    final palette = PosPalette.of(context);
    final selected = registers.where((r) => r.id == selectedRegisterId).firstOrNull;
    return Container(
      key: const Key('pos-register-switcher-bar'),
      width: double.infinity,
      padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 8),
      decoration: BoxDecoration(
        color: palette.actionTint,
        border: Border(bottom: BorderSide(color: palette.border)),
      ),
      child: Row(
        children: [
          Icon(Icons.point_of_sale_outlined, size: 16, color: palette.action),
          const SizedBox(width: 8),
          Text(
            'Caja:',
            style: TextStyle(color: palette.textSecondary, fontSize: 12, fontWeight: FontWeight.w600),
          ),
          const SizedBox(width: 8),
          Expanded(
            child: DropdownButtonHideUnderline(
              child: DropdownButton<String>(
                key: const Key('pos-register-switcher-dropdown'),
                isDense: true,
                isExpanded: true,
                value: selected?.id,
                hint: Text(
                  'Selecciona tu caja',
                  style: TextStyle(color: palette.textMuted, fontSize: 12),
                ),
                items: [
                  for (final register in registers)
                    DropdownMenuItem(
                      value: register.id,
                      key: Key('pos-register-switcher-option-${register.id}'),
                      child: Text(
                        '${register.name} (${register.code})',
                        style: TextStyle(color: palette.text, fontSize: 12),
                      ),
                    ),
                ],
                onChanged: (value) {
                  if (value != null) onSelected(value);
                },
              ),
            ),
          ),
        ],
      ),
    );
  }
}

extension _FirstOrNull<T> on Iterable<T> {
  T? get firstOrNull {
    final iterator = this.iterator;
    return iterator.moveNext() ? iterator.current : null;
  }
}
