import 'package:flutter/material.dart';

abstract final class PosColors {
  static const background = Color(0xFFF4F6FB);
  static const surface = Color(0xFFFFFFFF);
  static const text = Color(0xFF1A1535);
  static const textSecondary = Color(0xFF5A5880);
  static const textMuted = Color(0xFF9896B0);
  static const border = Color(0xFFE2E1F0);
  static const blue = Color(0xFF29ABE2);
  static const blueDeep = Color(0xFF1A8BBF);
  static const blueTint = Color(0xFFE8F6FC);
  static const action = Color(0xFF1677FF);
  static const actionStrong = Color(0xFF0D47F7);
  static const actionTint = Color(0xFFF2F4F7);
  static const success = Color(0xFF2E7D32);
  static const warning = Color(0xFFB45309);
  static const error = Color(0xFFB91C1C);
  static const cyan = Color(0xFF0891B2);
}

abstract final class PosDarkColors {
  static const background = Color(0xFF15131F);
  static const surface = Color(0xFF1E1B2E);
  static const text = Color(0xFFF1EFFA);
  static const textSecondary = Color(0xFFB7B3D1);
  static const textMuted = Color(0xFF7A7699);
  static const border = Color(0xFF322D4A);
  static const blue = Color(0xFF3FBBEF);
  static const blueDeep = Color(0xFF7DD3F7);
  static const blueTint = Color(0xFF16303A);
  static const action = Color(0xFF29A8FF);
  static const actionStrong = Color(0xFF6BB6FF);
  static const actionTint = Color(0xFF0F1E4D);
  static const success = Color(0xFF5FD86A);
  static const warning = Color(0xFFFBBF24);
  static const error = Color(0xFFF87171);
  static const cyan = Color(0xFF22D3EE);
}

@immutable
class PosPalette extends ThemeExtension<PosPalette> {
  const PosPalette({
    required this.background,
    required this.surface,
    required this.text,
    required this.textSecondary,
    required this.textMuted,
    required this.border,
    required this.blue,
    required this.blueDeep,
    required this.blueTint,
    required this.action,
    required this.actionStrong,
    required this.actionTint,
    required this.success,
    required this.warning,
    required this.error,
    required this.cyan,
  });

  final Color background;
  final Color surface;
  final Color text;
  final Color textSecondary;
  final Color textMuted;
  final Color border;
  final Color blue;
  final Color blueDeep;
  final Color blueTint;
  final Color action;
  final Color actionStrong;
  final Color actionTint;
  final Color success;
  final Color warning;
  final Color error;
  final Color cyan;

  static const light = PosPalette(
    background: PosColors.background,
    surface: PosColors.surface,
    text: PosColors.text,
    textSecondary: PosColors.textSecondary,
    textMuted: PosColors.textMuted,
    border: PosColors.border,
    blue: PosColors.blue,
    blueDeep: PosColors.blueDeep,
    blueTint: PosColors.blueTint,
    action: PosColors.action,
    actionStrong: PosColors.actionStrong,
    actionTint: PosColors.actionTint,
    success: PosColors.success,
    warning: PosColors.warning,
    error: PosColors.error,
    cyan: PosColors.cyan,
  );

  static const dark = PosPalette(
    background: PosDarkColors.background,
    surface: PosDarkColors.surface,
    text: PosDarkColors.text,
    textSecondary: PosDarkColors.textSecondary,
    textMuted: PosDarkColors.textMuted,
    border: PosDarkColors.border,
    blue: PosDarkColors.blue,
    blueDeep: PosDarkColors.blueDeep,
    blueTint: PosDarkColors.blueTint,
    action: PosDarkColors.action,
    actionStrong: PosDarkColors.actionStrong,
    actionTint: PosDarkColors.actionTint,
    success: PosDarkColors.success,
    warning: PosDarkColors.warning,
    error: PosDarkColors.error,
    cyan: PosDarkColors.cyan,
  );

  static PosPalette of(BuildContext context) =>
      Theme.of(context).extension<PosPalette>() ?? light;

  @override
  PosPalette copyWith() => this;

  @override
  PosPalette lerp(covariant PosPalette? other, double t) => this;
}

abstract final class PosTheme {
  static ThemeData light() => _theme(Brightness.light, PosPalette.light);
  static ThemeData dark() => _theme(Brightness.dark, PosPalette.dark);

  static ThemeData _theme(Brightness brightness, PosPalette palette) {
    final scheme = ColorScheme.fromSeed(
      seedColor: palette.action,
      brightness: brightness,
      surface: palette.surface,
      error: palette.error,
    );
    return ThemeData(
      useMaterial3: true,
      brightness: brightness,
      colorScheme: scheme,
      scaffoldBackgroundColor: palette.background,
      fontFamily: 'Questrial',
      extensions: [palette],
      textTheme: ThemeData(brightness: brightness).textTheme.apply(
        bodyColor: palette.text,
        displayColor: palette.text,
        fontFamily: 'Questrial',
      ),
      dividerColor: palette.border,
      dialogTheme: DialogThemeData(
        backgroundColor: palette.surface,
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
      ),
      inputDecorationTheme: InputDecorationTheme(
        filled: true,
        fillColor: palette.surface,
        contentPadding: const EdgeInsets.symmetric(
          horizontal: 14,
          vertical: 12,
        ),
        border: OutlineInputBorder(
          borderRadius: BorderRadius.circular(10),
          borderSide: BorderSide(color: palette.border),
        ),
        enabledBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(10),
          borderSide: BorderSide(color: palette.border),
        ),
        focusedBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(10),
          borderSide: BorderSide(color: palette.action, width: 1.5),
        ),
      ),
    );
  }
}
