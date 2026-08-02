import 'package:flutter/material.dart';

import '../tokens/as_tokens.dart';

abstract final class AsTheme {
  static ThemeData light() {
    const scheme = ColorScheme.light(
      primary: AsColors.primary,
      onPrimary: Colors.white,
      primaryContainer: AsColors.primaryLight,
      onPrimaryContainer: AsColors.primaryDark,
      secondary: AsColors.primaryDark,
      onSecondary: Colors.white,
      error: AsColors.error,
      surface: AsColors.surface,
      onSurface: AsColors.textPrimary,
      outline: AsColors.border,
    );
    final baseText = Typography.material2021(
      platform: TargetPlatform.macOS,
    ).black;
    final text = baseText.copyWith(
      displayLarge: baseText.displayLarge?.copyWith(
        fontWeight: FontWeight.w700,
        letterSpacing: -1.8,
      ),
      headlineLarge: baseText.headlineLarge?.copyWith(
        fontWeight: FontWeight.w700,
        letterSpacing: -0.8,
      ),
      titleLarge: baseText.titleLarge?.copyWith(fontWeight: FontWeight.w700),
      bodyLarge: baseText.bodyLarge?.copyWith(height: 1.5),
      bodyMedium: baseText.bodyMedium?.copyWith(
        height: 1.45,
        color: AsColors.textSecondary,
      ),
      labelLarge: baseText.labelLarge?.copyWith(fontWeight: FontWeight.w700),
    );
    final border = OutlineInputBorder(
      borderRadius: BorderRadius.circular(AsRadius.medium),
      borderSide: const BorderSide(color: AsColors.border),
    );
    return ThemeData(
      useMaterial3: true,
      colorScheme: scheme,
      scaffoldBackgroundColor: AsColors.background,
      textTheme: text,
      focusColor: AsColors.primaryLight,
      hoverColor: AsColors.primaryLight.withValues(alpha: 0.45),
      appBarTheme: const AppBarTheme(
        backgroundColor: AsColors.surface,
        elevation: 0,
      ),
      cardTheme: CardThemeData(
        color: AsColors.surface,
        elevation: 0,
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(AsRadius.large),
        ),
      ),
      inputDecorationTheme: InputDecorationTheme(
        filled: true,
        fillColor: AsColors.surface,
        border: border,
        enabledBorder: border,
        focusedBorder: border.copyWith(
          borderSide: const BorderSide(color: AsColors.primary, width: 2),
        ),
        contentPadding: const EdgeInsets.symmetric(
          horizontal: AsSpacing.x4,
          vertical: AsSpacing.x4,
        ),
      ),
      filledButtonTheme: FilledButtonThemeData(
        style: FilledButton.styleFrom(
          minimumSize: const Size(48, 48),
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(AsRadius.medium),
          ),
        ),
      ),
      outlinedButtonTheme: OutlinedButtonThemeData(
        style: OutlinedButton.styleFrom(
          minimumSize: const Size(48, 48),
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(AsRadius.medium),
          ),
        ),
      ),
      dialogTheme: DialogThemeData(
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(AsRadius.extraLarge),
        ),
      ),
      snackBarTheme: const SnackBarThemeData(
        behavior: SnackBarBehavior.floating,
      ),
      dividerTheme: const DividerThemeData(color: AsColors.border),
      progressIndicatorTheme: const ProgressIndicatorThemeData(
        color: AsColors.primary,
      ),
    );
  }
}
