import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../../design_system/tokens/as_tokens.dart';
import 'money.dart';
import 'pos_tokens.dart';
import 'sale_folio.dart';

/// TASK 14.5A: the real per-sale data a post-sale success celebration is
/// allowed to show. Every field here is sourced from the backend's own
/// response to the sale-completion call that already succeeded (`sale.
/// total`/`sale.saleNumber`, the confirmed payment method, the cashier-
/// confirmed change, the already-attached customer, if any) — never a
/// placeholder/fake value. Mirrors V1's own `iniciarAnimacionPago()`
/// overlay (AS POS V1.html ~lines 5887-5892), which shows the amount
/// charged, ticket/sale number, payment method, change due, and customer
/// name if one was selected.
class PosPostSaleFeedbackData {
  const PosPostSaleFeedbackData({
    required this.saleNumber,
    required this.amount,
    required this.paymentMethodLabel,
    this.change,
    this.customerDisplayName,
  });

  final String saleNumber;
  final Money amount;
  final String paymentMethodLabel;
  final Money? change;
  final String? customerDisplayName;
}

String _money(Money value) => '\$${value.toDisplayString()}';

/// TASK 14.5A: post-sale success feedback — V1's own `cobrar()` (AS POS
/// V1.html lines 5756-5895) fires a Web Audio chord (5871-5885) and
/// `iniciarAnimacionPago()` (5893) strictly as the LAST step, after every
/// real mutation (stock/kardex, cash-session counters, `ventasHistorial.
/// unshift`, dashboard/report re-render) is already committed — never
/// before, and never on any failed precondition. This is that same rule
/// applied to the real backend-confirmed checkout paths this app already
/// has: every call site below fires this ONLY after the real
/// sale-completion call it depends on
/// (`PosSalesGateway.createSale`/`completeZeroTotalSale`, or the cash/
/// terminal payment actually settling) has already returned success —
/// see `_submitCashSaleForPayment`/`_submitZeroTotalSale`/
/// `_submitSaleForPayment`'s own call sites for exactly where.
///
/// Deliberately defensive end-to-end: [data] is already-committed real
/// data by the time this is called, and every side effect this function
/// itself performs (the system sound, the overlay animation) is wrapped
/// so a failure in either can never propagate — this is purely additive
/// feedback layered on top of an already-successful sale, never a gate on
/// it. Callers fire this with `unawaited(...)` — it must never block or
/// delay receipt generation or sale-history persistence, both of which
/// are already complete (or proceeding independently) by the time it is
/// called.
///
/// Respects the app's existing reduced-motion convention (`AsMotion.
/// resolve`, already used by e.g. the sidebar's own width animation) —
/// with reduced motion requested, the overlay still appears (so the real
/// data is still communicated) but skips the animated entrance/exit and
/// shortens to a single settle frame.
Future<void> showPosPostSaleSuccessFeedback(
  BuildContext context,
  PosPostSaleFeedbackData data, {
  bool kiosk = false,
}) async {
  try {
    // TASK 14.5A: the SDK ships no tone generator and no audio-plugin
    // dependency exists in pubspec.yaml (never added purely for cosmetic
    // feedback) — `SystemSound.play` is the dependency-free, built-in
    // equivalent of V1's Web Audio chord. Fire-and-forget: a platform
    // that can't play it (e.g. web, or a muted/unsupported device) simply
    // does nothing, never an exception the caller sees.
    unawaited(SystemSound.play(SystemSoundType.click).catchError((_) {}));
  } on Object {
    // Defensive — audio must never abort the caller.
  }
  if (!context.mounted) return;
  OverlayState? overlay;
  try {
    overlay = Overlay.maybeOf(context, rootOverlay: true);
  } on Object {
    overlay = null;
  }
  if (overlay == null) return;
  late final OverlayEntry entry;
  final removed = Completer<void>();
  try {
    entry = OverlayEntry(
      builder: (overlayContext) => _PosPostSaleFeedbackOverlay(
        data: data,
        kiosk: kiosk,
        onFinished: () {
          if (!removed.isCompleted) removed.complete();
        },
      ),
    );
    overlay.insert(entry);
  } on Object {
    return;
  }
  try {
    await removed.future;
  } on Object {
    // Defensive — never propagate.
  } finally {
    try {
      entry.remove();
    } on Object {
      // Already removed, or the overlay/tree is gone — never propagate.
    }
  }
}

class _PosPostSaleFeedbackOverlay extends StatefulWidget {
  const _PosPostSaleFeedbackOverlay({
    required this.data,
    required this.kiosk,
    required this.onFinished,
  });

  final PosPostSaleFeedbackData data;
  final bool kiosk;
  final VoidCallback onFinished;

  @override
  State<_PosPostSaleFeedbackOverlay> createState() =>
      _PosPostSaleFeedbackOverlayState();
}

class _PosPostSaleFeedbackOverlayState
    extends State<_PosPostSaleFeedbackOverlay>
    with SingleTickerProviderStateMixin {
  late final AnimationController _controller;
  Timer? _dismissTimer;
  bool _finished = false;

  // A customer-facing kiosk overlay stays up longer (no cashier standing
  // by to move things along) than the cashier's own, brisker confirmation.
  Duration get _holdDuration =>
      widget.kiosk ? const Duration(seconds: 3) : const Duration(seconds: 2);

  bool _started = false;

  @override
  void initState() {
    super.initState();
    _controller = AnimationController(
      vsync: this,
      duration: const Duration(milliseconds: 260),
    );
  }

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    // TASK 14.5A: `MediaQuery.maybeOf` (via `AsMotion.resolve`) must not be
    // read in `initState` — Flutter's own InheritedWidget-dependency rule
    // requires `didChangeDependencies`/`build` instead. Guarded to run
    // only once: `didChangeDependencies` can fire again later (e.g. a
    // theme/MediaQuery change while this overlay is still up), and this
    // entrance/dismiss sequence must never restart mid-flight.
    if (_started) return;
    _started = true;
    unawaited(_run());
  }

  Future<void> _run() async {
    // TASK 14.5A: routes both the entrance/exit transition and the hold
    // duration through the app's own existing reduced-motion convention
    // (`AsMotion.resolve` — see `_Sidebar`'s width `AnimatedContainer` for
    // its other adopter in this file) rather than inventing a second one.
    // With reduced motion requested, both resolve to `Duration.zero` — the
    // overlay still appears (the real data is still communicated) but
    // settles instantly instead of animating.
    final entranceDuration = AsMotion.resolve(
      context,
      const Duration(milliseconds: 260),
    );
    try {
      if (entranceDuration == Duration.zero) {
        _controller.value = 1;
      } else {
        await _controller.forward();
      }
    } on Object {
      // A controller failure must never strand the overlay on screen.
    }
    if (!mounted) return _finish();
    final holdDuration = AsMotion.resolve(context, _holdDuration);
    _dismissTimer = Timer(holdDuration, () async {
      if (!mounted) return _finish();
      try {
        if (entranceDuration != Duration.zero) await _controller.reverse();
      } on Object {
        // Same rationale as above.
      }
      _finish();
    });
  }

  void _finish() {
    if (_finished) return;
    _finished = true;
    widget.onFinished();
  }

  @override
  void dispose() {
    _dismissTimer?.cancel();
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final palette = PosPalette.of(context);
    final data = widget.data;
    return Positioned.fill(
      child: IgnorePointer(
        child: Align(
          alignment: Alignment.topCenter,
          child: Padding(
            padding: const EdgeInsets.only(top: 64),
            child: FadeTransition(
              opacity: _controller,
              child: ScaleTransition(
                scale: CurvedAnimation(
                  parent: _controller,
                  curve: Curves.easeOutBack,
                ).drive(Tween(begin: .85, end: 1)),
                child: Material(
                  key: const Key('pos-post-sale-feedback'),
                  color: Colors.transparent,
                  child: Container(
                    constraints: const BoxConstraints(maxWidth: 320),
                    padding: const EdgeInsets.symmetric(
                      horizontal: 22,
                      vertical: 18,
                    ),
                    decoration: BoxDecoration(
                      color: palette.surface,
                      borderRadius: BorderRadius.circular(16),
                      boxShadow: [
                        BoxShadow(
                          color: Colors.black.withValues(alpha: .18),
                          blurRadius: 24,
                          offset: const Offset(0, 8),
                        ),
                      ],
                    ),
                    child: Column(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        Container(
                          width: 48,
                          height: 48,
                          decoration: BoxDecoration(
                            color: palette.success.withValues(alpha: .15),
                            shape: BoxShape.circle,
                          ),
                          alignment: Alignment.center,
                          child: Icon(
                            Icons.check_circle,
                            color: palette.success,
                            size: 30,
                          ),
                        ),
                        const SizedBox(height: 10),
                        Text(
                          widget.kiosk
                              ? '¡Pago completado!'
                              : '¡Venta completada!',
                          key: const Key('pos-post-sale-feedback-title'),
                          style: TextStyle(
                            fontWeight: FontWeight.w800,
                            fontSize: 16,
                            color: palette.text,
                          ),
                        ),
                        const SizedBox(height: 4),
                        Text(
                          displaySaleFolio(data.saleNumber),
                          key: const Key('pos-post-sale-feedback-folio'),
                          style: TextStyle(
                            fontSize: 12,
                            color: palette.textSecondary,
                          ),
                        ),
                        const SizedBox(height: 10),
                        Text(
                          _money(data.amount),
                          key: const Key('pos-post-sale-feedback-amount'),
                          style: TextStyle(
                            fontWeight: FontWeight.w800,
                            fontSize: 26,
                            color: palette.text,
                          ),
                        ),
                        const SizedBox(height: 4),
                        Text(
                          data.paymentMethodLabel,
                          key: const Key('pos-post-sale-feedback-method'),
                          style: TextStyle(
                            fontSize: 12,
                            fontWeight: FontWeight.w700,
                            color: palette.textSecondary,
                          ),
                        ),
                        if (data.change != null &&
                            data.change!.isPositive) ...[
                          const SizedBox(height: 4),
                          Text(
                            'Cambio: ${_money(data.change!)}',
                            key: const Key('pos-post-sale-feedback-change'),
                            style: TextStyle(
                              fontSize: 12,
                              color: palette.textSecondary,
                            ),
                          ),
                        ],
                        if (data.customerDisplayName != null) ...[
                          const SizedBox(height: 4),
                          Text(
                            data.customerDisplayName!,
                            key: const Key(
                              'pos-post-sale-feedback-customer',
                            ),
                            maxLines: 1,
                            overflow: TextOverflow.ellipsis,
                            style: TextStyle(
                              fontSize: 12,
                              color: palette.textSecondary,
                            ),
                          ),
                        ],
                      ],
                    ),
                  ),
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }
}
