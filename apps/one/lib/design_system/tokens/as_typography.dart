import 'package:flutter/material.dart';

/// Centralized type scale (TASK 12.2G). Every value is sourced directly
/// from a literal rule in the canonical `AS POS V1.html` — cited per
/// style below — not invented. Family is always Questrial, V1's own
/// document-wide font (`html,*{font-family:'Questrial',sans-serif}`,
/// bundled at `assets/fonts/Questrial-Regular.ttf`; see `pubspec.yaml`).
///
/// Call sites should prefer these constants over ad hoc
/// `TextStyle(fontSize: ..., fontWeight: ...)` literals so the scale has
/// one source of truth instead of being scattered across widgets.
abstract final class AsTypography {
  static const family = 'Questrial';

  /// `#aspos-wizard` heading (`¡Bienvenido a AS+ POS!`):
  /// `font-size:26px;font-weight:800`.
  static const heading = TextStyle(
    fontFamily: family,
    fontSize: 26,
    fontWeight: FontWeight.w800,
  );

  /// `.modal-title` (`Iniciar sesión`): `font-size:17px;font-weight:700`.
  static const title = TextStyle(
    fontFamily: family,
    fontSize: 17,
    fontWeight: FontWeight.w700,
  );

  /// The "AS+ PUNTO DE VENTA+" wordmark:
  /// `font-size:15px;font-weight:800;letter-spacing:.3px`.
  static const wordmark = TextStyle(
    fontFamily: family,
    fontSize: 15,
    fontWeight: FontWeight.w800,
    letterSpacing: .3,
  );

  /// `.btn.primary` label (e.g. wizard's "Comenzar", inline
  /// `font-size:15px`), bolded for on-gradient legibility.
  static const buttonLabel = TextStyle(
    fontFamily: family,
    fontSize: 15,
    fontWeight: FontWeight.w700,
  );

  /// Body copy / subtitle text: `font-size:13px`
  /// (`#login-subtitulo`, tab-pane descriptive copy).
  static const body = TextStyle(fontFamily: family, fontSize: 13);

  /// `input,select,textarea{font-size:14px}` — field/typed text.
  static const field = TextStyle(fontFamily: family, fontSize: 14);

  /// `.pin-key{font-size:18px;font-weight:700}` — the PIN keypad's digits.
  static const keypadKey = TextStyle(
    fontFamily: family,
    fontSize: 18,
    fontWeight: FontWeight.w700,
  );

  /// `label{font-size:12px;font-weight:600;color:var(--txt2)}` — field
  /// labels and tab-bar labels.
  static const label = TextStyle(
    fontFamily: family,
    fontSize: 12,
    fontWeight: FontWeight.w600,
  );

  /// Helper/hint text under fields: `font-size:11px`.
  static const hint = TextStyle(fontFamily: family, fontSize: 11);

  /// Tiny uppercase caption text (tagline, muted "POS" suffix):
  /// `font-size:10px`.
  static const caption = TextStyle(fontFamily: family, fontSize: 10);
}
