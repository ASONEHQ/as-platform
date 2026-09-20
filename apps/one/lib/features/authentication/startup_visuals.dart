import 'dart:async';

import 'package:flutter/material.dart';

import '../../design_system/tokens/as_tokens.dart';
import '../../design_system/tokens/as_typography.dart';

/// Shared visual chrome for the startup/login flow (splash, the first-run
/// wizard preview, and the sign-in card), ported from the canonical
/// `AS POS V1.html`'s `#pos-splash` / `#aspos-wizard` /
/// `#modal-login.gate-activo` states — TASK 12.2F.
///
/// These are intentionally NOT folded into `AsTheme`/`AsColors` (the app's
/// own design system): V1 hardcodes this exact gradient/palette for the
/// startup gate regardless of its own light/dark theme, so mixing the two
/// token sets would drift the moment `AsTheme` changes for unrelated
/// reasons. Every value below is a direct, documented port of a literal
/// from the HTML — nothing here is invented.
abstract final class StartupColors {
  // `radial-gradient(ellipse at 50% 45%, #003efd 0%, #0027a0 45%, #000444 100%)`
  // — shared by `#pos-splash`, `#aspos-wizard`, and `#modal-login.gate-activo`.
  static const gradientStart = Color(0xFF003EFD);
  static const gradientMid = Color(0xFF0027A0);
  static const gradientEnd = Color(0xFF000444);

  // Card content tokens — byte-identical to V1's `:root` light-mode
  // `--bg`/`--bg2`/`--txt*`/`--border`/`--purple*`/`--blue`/`--amber`.
  static const cardSurface = Color(0xFFFFFFFF); // --bg2
  static const fieldFill = Color(0xFFF4F6FB); // --bg
  static const text = Color(0xFF1A1535); // --txt
  static const textSecondary = Color(0xFF5A5880); // --txt2
  static const textMuted = Color(0xFF9896B0); // --txt3
  static const border = Color(0xFFE2E1F0); // --border
  static const purple = Color(0xFF1677FF); // --purple
  static const purpleDeep = Color(0xFF0D47F7); // --purple2
  static const purpleTint = Color(0xFFF2F4F7); // --purple3
  static const blue = Color(0xFF29ABE2); // --blue
  static const amber = Color(0xFFB45309); // --amber (gate/notice toasts)
  static const red = Color(0xFFB91C1C); // --red

  // `.ai-fab`'s own hardcoded gradient — distinct from the POS shell
  // topbar's token-based action→blue gradient (TASK 12.2E).
  static const aiFabStart = Color(0xFF6B3FA0);
  static const aiFabEnd = Color(0xFF29ABE2);
}

/// Scales its child on hover and/or press — matching V1's own literal
/// interaction transforms (`.ai-fab:hover{transform:scale(1.08)}`,
/// `.modal-close:active{transform:scale(.88)}`) rather than inventing new
/// ones. Fast (120ms, `AsMotion.fast`, matching V1's generic `.12s`
/// transitions), interruptible (`AnimatedScale` retargets mid-flight),
/// and skipped entirely under reduced motion.
class _InteractiveScale extends StatefulWidget {
  const _InteractiveScale({
    required this.child,
    this.hoverScale = 1.0,
    this.pressScale = 1.0,
  });
  final Widget child;
  final double hoverScale;
  final double pressScale;

  @override
  State<_InteractiveScale> createState() => _InteractiveScaleState();
}

class _InteractiveScaleState extends State<_InteractiveScale> {
  bool _hovered = false;
  bool _pressed = false;

  @override
  Widget build(BuildContext context) {
    final scale = _pressed
        ? widget.pressScale
        : _hovered
        ? widget.hoverScale
        : 1.0;
    return MouseRegion(
      onEnter: (_) => setState(() => _hovered = true),
      onExit: (_) => setState(() => _hovered = false),
      child: Listener(
        onPointerDown: (_) => setState(() => _pressed = true),
        onPointerUp: (_) => setState(() => _pressed = false),
        onPointerCancel: (_) => setState(() => _pressed = false),
        child: AnimatedScale(
          scale: scale,
          duration: AsMotion.resolve(context, AsMotion.fast),
          curve: Curves.easeOut,
          child: widget.child,
        ),
      ),
    );
  }
}

/// The deep-blue radial backdrop behind the splash, wizard, and login gate.
class StartupBackground extends StatelessWidget {
  const StartupBackground({required this.child, super.key});
  final Widget child;

  @override
  Widget build(BuildContext context) => DecoratedBox(
    decoration: const BoxDecoration(
      gradient: RadialGradient(
        center: Alignment(0, -0.1),
        radius: 1.15,
        colors: [
          StartupColors.gradientStart,
          StartupColors.gradientMid,
          StartupColors.gradientEnd,
        ],
        stops: [0, .45, 1],
      ),
    ),
    child: child,
  );
}

/// `.modal{animation:slideUp .25s ease}`
/// (`from{transform:translateY(30px);opacity:0}to{transform:none;opacity:1}`)
/// — the one-shot entrance V1 gives every modal card, including the login
/// gate and the wizard. Plays once on mount; skipped under reduced motion.
class StartupCardEntrance extends StatefulWidget {
  const StartupCardEntrance({required this.child, super.key});
  final Widget child;

  @override
  State<StartupCardEntrance> createState() => _StartupCardEntranceState();
}

class _StartupCardEntranceState extends State<StartupCardEntrance>
    with SingleTickerProviderStateMixin {
  late final AnimationController controller = AnimationController(
    vsync: this,
    duration: AsMotion.modalEntrance,
  );

  @override
  void initState() {
    super.initState();
    controller.forward();
  }

  @override
  void dispose() {
    controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    // Reduced motion: render the final state directly, no transition.
    if (MediaQuery.maybeOf(context)?.disableAnimations ?? false) {
      return widget.child;
    }
    final curved = CurvedAnimation(parent: controller, curve: Curves.ease);
    return FadeTransition(
      opacity: curved,
      child: SlideTransition(
        position: Tween(
          begin: const Offset(0, .08),
          end: Offset.zero,
        ).animate(curved),
        child: widget.child,
      ),
    );
  }
}

/// The official ACCESS GO logo (TASK 16.12) — canonical source:
/// `C:\Users\InMagic\Downloads\logo accessgo\accessgo.png` (400×219 PNG,
/// RGBA, transparent background), copied verbatim at full resolution into
/// `assets/branding/access_go_logo.png`. Not redrawn as text anywhere.
///
/// This replaces the previous square "AS+" app-icon mark (295×296,
/// `as_logo_mark.png`, still on disk but no longer referenced by this
/// widget — TASK 16.9's own thermal-receipt logo handling is unrelated
/// and untouched). The supplied asset is a wide horizontal wordmark, not
/// a square icon, so [size] is now always interpreted as a HEIGHT with
/// the width scaling naturally (`BoxFit.contain`) — never force-cropped
/// into a square via `BoxFit.cover`, which would slice off most of the
/// "access go" wordmark. [rounded]/[shadow] are kept as accepted
/// parameters for every existing call site's source compatibility, but
/// are now no-ops: a rounded-square drop-shadow treatment was designed
/// for the old solid-icon mark and would render as an ugly box around a
/// mostly-transparent wordmark image, not a design the official asset
/// supports.
///
/// [white] (TASK 16.12A) swaps in `access_go_logo_white.png` — the same
/// artwork with every visible pixel recolored pure white, generated
/// deterministically from the official source (see
/// `generate_white_logo.py`'s trail in the TASK 16.12A commit) — for use
/// on the strong blue/dark splash background, where the normal blue/cyan
/// mark loses contrast. Every other surface (light backgrounds: login,
/// sidebar, topbar) keeps the normal mark. `filterQuality: high` avoids
/// the soft/blurry look a lower quality filter gives this asset when
/// downscaled from its native 400×219 to the small on-screen sizes chrome
/// needs.
class StartupLogoMark extends StatelessWidget {
  const StartupLogoMark({
    this.size = 72,
    this.rounded = true,
    this.shadow = true,
    this.white = false,
    super.key,
  });
  final double size;
  final bool rounded;
  final bool shadow;
  final bool white;

  @override
  Widget build(BuildContext context) => Image.asset(
    white
        ? 'assets/branding/access_go_logo_white.png'
        : 'assets/branding/access_go_logo.png',
    height: size,
    fit: BoxFit.contain,
    filterQuality: FilterQuality.high,
    semanticLabel: 'ACCESS GO',
  );
}

/// V1's bottom-center pill toast (`#toast-el`) — a custom overlay rather
/// than Flutter's default `SnackBar`, since this screen renders before the
/// app shell exists and must match the HTML's own toast, not Material's.
abstract final class StartupToast {
  static OverlayEntry? _current;

  static void show(
    BuildContext context,
    String message, {
    Color color = StartupColors.text,
  }) {
    _current?.remove();
    final overlay = Overlay.of(context);
    late final OverlayEntry entry;
    entry = OverlayEntry(
      builder: (context) => _StartupToastView(
        message: message,
        color: color,
        onDone: () => entry.remove(),
      ),
    );
    _current = entry;
    overlay.insert(entry);
  }
}

class _StartupToastView extends StatefulWidget {
  const _StartupToastView({
    required this.message,
    required this.color,
    required this.onDone,
  });
  final String message;
  final Color color;
  final VoidCallback onDone;

  @override
  State<_StartupToastView> createState() => _StartupToastViewState();
}

class _StartupToastViewState extends State<_StartupToastView>
    with SingleTickerProviderStateMixin {
  late final AnimationController controller = AnimationController(
    vsync: this,
    duration: const Duration(milliseconds: 300),
  );
  Timer? _hideTimer;

  @override
  void initState() {
    super.initState();
    controller.forward();
    _hideTimer = Timer(const Duration(milliseconds: 2800), () async {
      if (!mounted) return;
      await controller.reverse();
      widget.onDone();
    });
  }

  @override
  void dispose() {
    _hideTimer?.cancel();
    controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => Positioned(
    left: 0,
    right: 0,
    bottom: 16,
    child: IgnorePointer(
      child: Center(
        child: SlideTransition(
          position: Tween(begin: const Offset(0, 1.6), end: Offset.zero)
              .animate(
                CurvedAnimation(parent: controller, curve: Curves.easeOutCubic),
              ),
          child: FadeTransition(
            opacity: controller,
            child: Container(
              margin: const EdgeInsets.symmetric(horizontal: 24),
              padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 11),
              decoration: BoxDecoration(
                color: widget.color,
                borderRadius: BorderRadius.circular(12),
                boxShadow: const [
                  BoxShadow(
                    color: Color(0x40000000),
                    blurRadius: 20,
                    offset: Offset(0, 4),
                  ),
                ],
              ),
              child: Text(
                widget.message,
                textAlign: TextAlign.center,
                style: AsTypography.body.copyWith(
                  color: Colors.white,
                  fontWeight: FontWeight.w600,
                ),
              ),
            ),
          ),
        ),
      ),
    ),
  );
}

/// The bottom-left AI assistant FAB (`.ai-fab`) shown over the
/// splash/wizard/login gate. Inert — no chat surface exists in this app;
/// tapping it surfaces the same deferred notice as the topbar's AI button
/// (TASK 12.2E) rather than inventing a chat experience here. Label
/// matches the topbar's own "Asistente IA" wording (TASK 16.12) — never
/// a second, differently-worded product-name reference.
class StartupAiBadge extends StatelessWidget {
  const StartupAiBadge({super.key});

  @override
  Widget build(BuildContext context) => Tooltip(
    message: 'Asistente IA',
    // `.ai-fab:hover{transform:scale(1.08)}` — literal V1 hover transform.
    child: _InteractiveScale(
      hoverScale: 1.08,
      child: Material(
        color: Colors.transparent,
        shape: const CircleBorder(),
        child: InkWell(
          key: const Key('startup-ai-fab'),
          customBorder: const CircleBorder(),
          onTap: () => StartupToast.show(
            context,
            'El asistente estará disponible cuando el punto de venta esté conectado.',
          ),
          child: Container(
            width: 58,
            height: 58,
            decoration: const BoxDecoration(
              shape: BoxShape.circle,
              gradient: LinearGradient(
                begin: Alignment.topLeft,
                end: Alignment.bottomRight,
                colors: [StartupColors.aiFabStart, StartupColors.aiFabEnd],
              ),
              boxShadow: [
                BoxShadow(
                  color: Color(0x996B3FA0),
                  blurRadius: 20,
                  offset: Offset(0, 6),
                ),
              ],
            ),
            child: const Icon(
              Icons.smart_toy_outlined,
              color: Colors.white,
              size: 26,
            ),
          ),
        ),
      ),
    ),
  );
}

/// The `.modal-close` 30x30 bordered circular close button.
class StartupCloseButton extends StatelessWidget {
  const StartupCloseButton({required this.onPressed, super.key});
  final VoidCallback onPressed;

  @override
  Widget build(BuildContext context) =>
      // `.modal-close:active{transform:scale(.88)}` — literal V1 press
      // transform.
      _InteractiveScale(
        pressScale: .88,
        child: Material(
          color: StartupColors.fieldFill,
          shape: const CircleBorder(
            side: BorderSide(color: StartupColors.border),
          ),
          child: InkWell(
            key: const Key('startup-login-close'),
            customBorder: const CircleBorder(),
            onTap: onPressed,
            child: const SizedBox(
              width: 30,
              height: 30,
              child: Icon(
                Icons.close,
                size: 16,
                color: StartupColors.textSecondary,
              ),
            ),
          ),
        ),
      );
}

/// `.tab-bar` / `.tab-btn` — a rounded pill segmented control.
class StartupTabBar extends StatelessWidget {
  const StartupTabBar({
    required this.labels,
    required this.icons,
    required this.selected,
    required this.onChanged,
    super.key,
  });
  final List<String> labels;
  final List<IconData> icons;
  final int selected;
  final ValueChanged<int> onChanged;

  @override
  Widget build(BuildContext context) => Container(
    padding: const EdgeInsets.all(4),
    decoration: BoxDecoration(
      color: StartupColors.fieldFill,
      borderRadius: BorderRadius.circular(12),
      border: Border.all(color: StartupColors.border),
    ),
    child: Row(
      children: [
        for (var i = 0; i < labels.length; i++)
          Expanded(
            child: _StartupTabButton(
              label: labels[i],
              icon: icons[i],
              active: i == selected,
              onTap: () => onChanged(i),
            ),
          ),
      ],
    ),
  );
}

class _StartupTabButton extends StatelessWidget {
  const _StartupTabButton({
    required this.label,
    required this.icon,
    required this.active,
    required this.onTap,
  });
  final String label;
  final IconData icon;
  final bool active;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) => Material(
    color: active ? StartupColors.cardSurface : Colors.transparent,
    elevation: active ? 1 : 0,
    shadowColor: Colors.black26,
    borderRadius: BorderRadius.circular(9),
    child: InkWell(
      borderRadius: BorderRadius.circular(9),
      onTap: onTap,
      child: Padding(
        padding: const EdgeInsets.symmetric(vertical: 8, horizontal: 8),
        child: Row(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            Icon(
              icon,
              size: 14,
              color: active ? StartupColors.text : StartupColors.textMuted,
            ),
            const SizedBox(width: 5),
            Flexible(
              child: FittedBox(
                fit: BoxFit.scaleDown,
                child: Text(
                  label,
                  style: AsTypography.label.copyWith(
                    color: active
                        ? StartupColors.text
                        : StartupColors.textMuted,
                  ),
                ),
              ),
            ),
          ],
        ),
      ),
    ),
  );
}

/// V1's global `label` + `input,select,textarea` rule: 10px radius, 1.5px
/// `--border`, `--bg` fill, purple focus ring.
class StartupField extends StatelessWidget {
  const StartupField({
    required this.label,
    this.controller,
    this.hintText,
    this.keyboardType,
    this.textCapitalization = TextCapitalization.none,
    this.obscureText = false,
    this.maxLength,
    this.suffixIcon,
    this.autofillHints,
    this.enabled = true,
    this.onSubmitted,
    this.fieldKey,
    super.key,
  });
  final String label;
  final TextEditingController? controller;
  final String? hintText;
  final TextInputType? keyboardType;
  final TextCapitalization textCapitalization;
  final bool obscureText;
  final int? maxLength;
  final Widget? suffixIcon;
  final Iterable<String>? autofillHints;
  final bool enabled;
  final ValueChanged<String>? onSubmitted;
  final Key? fieldKey;

  @override
  Widget build(BuildContext context) => Column(
    crossAxisAlignment: CrossAxisAlignment.start,
    children: [
      Text(
        label,
        style: AsTypography.label.copyWith(color: StartupColors.textSecondary),
      ),
      const SizedBox(height: 5),
      TextField(
        key: fieldKey,
        controller: controller,
        obscureText: obscureText,
        keyboardType: keyboardType,
        textCapitalization: textCapitalization,
        enabled: enabled,
        onSubmitted: onSubmitted,
        autofillHints: autofillHints,
        maxLength: maxLength,
        style: AsTypography.field.copyWith(color: StartupColors.text),
        decoration: InputDecoration(
          isDense: true,
          counterText: '',
          hintText: hintText,
          hintStyle: const TextStyle(color: StartupColors.textMuted),
          filled: true,
          fillColor: StartupColors.fieldFill,
          contentPadding: const EdgeInsets.symmetric(
            horizontal: 12,
            vertical: 11,
          ),
          suffixIcon: suffixIcon,
          border: const OutlineInputBorder(
            borderRadius: BorderRadius.all(Radius.circular(10)),
            borderSide: BorderSide(color: StartupColors.border, width: 1.5),
          ),
          enabledBorder: const OutlineInputBorder(
            borderRadius: BorderRadius.all(Radius.circular(10)),
            borderSide: BorderSide(color: StartupColors.border, width: 1.5),
          ),
          focusedBorder: const OutlineInputBorder(
            borderRadius: BorderRadius.all(Radius.circular(10)),
            borderSide: BorderSide(color: StartupColors.purple, width: 1.5),
          ),
        ),
      ),
    ],
  );
}

/// Password variant of [StartupField] with the eye/eye-off toggle
/// (`togglePassVis`).
class StartupPasswordField extends StatefulWidget {
  const StartupPasswordField({
    required this.label,
    this.controller,
    this.enabled = true,
    this.onSubmitted,
    this.fieldKey,
    super.key,
  });
  final String label;
  final TextEditingController? controller;
  final bool enabled;
  final ValueChanged<String>? onSubmitted;
  final Key? fieldKey;

  @override
  State<StartupPasswordField> createState() => _StartupPasswordFieldState();
}

class _StartupPasswordFieldState extends State<StartupPasswordField> {
  bool hidden = true;

  @override
  Widget build(BuildContext context) => Column(
    crossAxisAlignment: CrossAxisAlignment.start,
    children: [
      Text(
        widget.label,
        style: AsTypography.label.copyWith(color: StartupColors.textSecondary),
      ),
      const SizedBox(height: 5),
      TextField(
        key: widget.fieldKey,
        controller: widget.controller,
        obscureText: hidden,
        enabled: widget.enabled,
        onSubmitted: widget.onSubmitted,
        autofillHints: const [AutofillHints.password],
        style: AsTypography.field.copyWith(color: StartupColors.text),
        decoration: InputDecoration(
          isDense: true,
          hintText: '••••••••',
          hintStyle: const TextStyle(color: StartupColors.textMuted),
          filled: true,
          fillColor: StartupColors.fieldFill,
          contentPadding: const EdgeInsets.symmetric(
            horizontal: 12,
            vertical: 11,
          ),
          suffixIcon: IconButton(
            tooltip: hidden ? 'Mostrar contraseña' : 'Ocultar contraseña',
            onPressed: () => setState(() => hidden = !hidden),
            icon: Icon(
              hidden
                  ? Icons.visibility_outlined
                  : Icons.visibility_off_outlined,
              color: StartupColors.textMuted,
              size: 18,
            ),
          ),
          border: const OutlineInputBorder(
            borderRadius: BorderRadius.all(Radius.circular(10)),
            borderSide: BorderSide(color: StartupColors.border, width: 1.5),
          ),
          enabledBorder: const OutlineInputBorder(
            borderRadius: BorderRadius.all(Radius.circular(10)),
            borderSide: BorderSide(color: StartupColors.border, width: 1.5),
          ),
          focusedBorder: const OutlineInputBorder(
            borderRadius: BorderRadius.all(Radius.circular(10)),
            borderSide: BorderSide(color: StartupColors.purple, width: 1.5),
          ),
        ),
      ),
    ],
  );
}

/// V1's `.btn.primary` gradient (`--purple` → `--blue`) full-width button.
class StartupPrimaryButton extends StatelessWidget {
  const StartupPrimaryButton({
    required this.label,
    required this.onPressed,
    this.icon,
    this.loading = false,
    super.key,
  });
  final String label;
  final VoidCallback? onPressed;
  final IconData? icon;
  final bool loading;

  @override
  Widget build(BuildContext context) => Material(
    color: Colors.transparent,
    borderRadius: BorderRadius.circular(10),
    child: Ink(
      decoration: BoxDecoration(
        borderRadius: BorderRadius.circular(10),
        gradient: const LinearGradient(
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
          colors: [StartupColors.purple, StartupColors.blue],
        ),
      ),
      child: InkWell(
        borderRadius: BorderRadius.circular(10),
        onTap: onPressed,
        child: Padding(
          padding: const EdgeInsets.symmetric(vertical: 13),
          child: Row(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              if (loading)
                const SizedBox(
                  width: 16,
                  height: 16,
                  child: CircularProgressIndicator(
                    strokeWidth: 2,
                    color: Colors.white,
                  ),
                )
              else
                Icon(icon ?? Icons.login, size: 18, color: Colors.white),
              const SizedBox(width: 8),
              Text(
                label,
                style: AsTypography.buttonLabel.copyWith(color: Colors.white),
              ),
            ],
          ),
        ),
      ),
    ),
  );
}

/// `#pin-dots` — 4 dots that fill as digits are entered.
class StartupPinDots extends StatelessWidget {
  const StartupPinDots({required this.filled, super.key});
  final int filled;

  @override
  Widget build(BuildContext context) => Row(
    mainAxisAlignment: MainAxisAlignment.center,
    children: [
      for (var i = 0; i < 4; i++)
        Padding(
          padding: const EdgeInsets.symmetric(horizontal: 5),
          child: Container(
            width: 14,
            height: 14,
            decoration: BoxDecoration(
              shape: BoxShape.circle,
              color: i < filled
                  ? StartupColors.purple
                  : StartupColors.fieldFill,
              border: Border.all(
                color: i < filled ? StartupColors.purple : StartupColors.border,
                width: 2,
              ),
            ),
          ),
        ),
    ],
  );
}

/// `#pin-teclado` — the 3-column on-screen numeric keypad.
class StartupPinKeypad extends StatelessWidget {
  const StartupPinKeypad({
    required this.onDigit,
    required this.onBackspace,
    required this.onOk,
    super.key,
  });
  final ValueChanged<String> onDigit;
  final VoidCallback onBackspace;
  final VoidCallback onOk;

  @override
  Widget build(BuildContext context) => ConstrainedBox(
    constraints: const BoxConstraints(maxWidth: 220),
    child: GridView.count(
      crossAxisCount: 3,
      shrinkWrap: true,
      physics: const NeverScrollableScrollPhysics(),
      mainAxisSpacing: 8,
      crossAxisSpacing: 8,
      childAspectRatio: 1.4,
      children: [
        for (final d in ['1', '2', '3', '4', '5', '6', '7', '8', '9'])
          _PinKey(label: d, onTap: () => onDigit(d)),
        _PinKey(icon: Icons.backspace_outlined, onTap: onBackspace),
        _PinKey(label: '0', onTap: () => onDigit('0')),
        _PinKey(icon: Icons.check, onTap: onOk, primary: true),
      ],
    ),
  );
}

class _PinKey extends StatelessWidget {
  const _PinKey({
    this.label,
    this.icon,
    required this.onTap,
    this.primary = false,
  });
  final String? label;
  final IconData? icon;
  final VoidCallback onTap;
  final bool primary;

  @override
  Widget build(BuildContext context) => Material(
    color: primary ? StartupColors.purple : StartupColors.cardSurface,
    borderRadius: BorderRadius.circular(10),
    child: InkWell(
      borderRadius: BorderRadius.circular(10),
      onTap: onTap,
      child: Center(
        child: label != null
            ? Text(
                label!,
                style: AsTypography.keypadKey.copyWith(
                  color: primary ? Colors.white : StartupColors.text,
                ),
              )
            : Icon(
                icon,
                size: 18,
                color: primary ? Colors.white : StartupColors.textSecondary,
              ),
      ),
    ),
  );
}

/// `.qr-frame` — the bordered square placeholder for the (unimplemented)
/// QR scanner.
class StartupQrFrame extends StatelessWidget {
  const StartupQrFrame({super.key});

  @override
  Widget build(BuildContext context) => Container(
    width: 140,
    height: 140,
    alignment: Alignment.center,
    decoration: BoxDecoration(
      border: Border.all(color: StartupColors.purple, width: 3),
      borderRadius: BorderRadius.circular(14),
      color: StartupColors.fieldFill,
    ),
    child: const Icon(
      Icons.qr_code_2,
      size: 60,
      color: StartupColors.textMuted,
    ),
  );
}
