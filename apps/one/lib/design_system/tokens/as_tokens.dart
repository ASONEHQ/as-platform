import 'package:flutter/material.dart';

abstract final class AsColors {
  static const primary = Color(0xFF0B4DB8);
  static const primaryDark = Color(0xFF082B6F);
  static const primaryLight = Color(0xFFDCEAFF);
  static const background = Color(0xFFF4F7FC);
  static const surface = Colors.white;
  static const elevatedSurface = Color(0xFFF9FBFF);
  static const textPrimary = Color(0xFF101828);
  static const textSecondary = Color(0xFF526078);
  static const border = Color(0xFFD9E1EC);
  static const success = Color(0xFF137A54);
  static const warning = Color(0xFFA85A00);
  static const error = Color(0xFFB42318);
  static const info = Color(0xFF175CD3);
  static const disabled = Color(0xFF98A2B3);
  static const overlay = Color(0x9906172F);
}

abstract final class AsSpacing {
  static const x1 = 4.0;
  static const x2 = 8.0;
  static const x3 = 12.0;
  static const x4 = 16.0;
  static const x5 = 20.0;
  static const x6 = 24.0;
  static const x8 = 32.0;
  static const x10 = 40.0;
  static const x12 = 48.0;
  static const x16 = 64.0;
}

abstract final class AsRadius {
  static const small = 8.0;
  static const medium = 12.0;
  static const large = 16.0;
  static const extraLarge = 24.0;
  static const pill = 999.0;
}

/// Durations sourced directly from the canonical HTML's own CSS
/// `transition`/`animation` rules (TASK 12.2G) — cited per constant.
abstract final class AsMotion {
  /// Generic hover/press/focus transitions: `transition:.12s` (buttons,
  /// icons, inputs, sidebar items throughout the HTML).
  static const fast = Duration(milliseconds: 120);
  static const normal = Duration(milliseconds: 220);
  static const slow = Duration(milliseconds: 360);
  static const easing = Curves.easeOutCubic;

  /// `.sidebar{transition:width .18s ease}` — rail↔expanded width change.
  static const sidebarWidth = Duration(milliseconds: 180);

  /// `.sb-group-body{transition:max-height .2s ease}` — accordion
  /// group open/close.
  static const accordion = Duration(milliseconds: 200);

  /// `.tab-pane.active{animation:pgFade .15s ease}` — tab content switch.
  static const tabFade = Duration(milliseconds: 150);

  /// `.modal{animation:slideUp .25s ease}` — modal/card entrance
  /// (`from{transform:translateY(30px);opacity:0}`).
  static const modalEntrance = Duration(milliseconds: 250);

  /// Returns [duration] unless the platform/user requests reduced
  /// motion (`MediaQuery.disableAnimations`), in which case animations
  /// resolve instantly — every animated widget in this app should route
  /// its duration through this helper rather than using a raw constant.
  static Duration resolve(BuildContext context, Duration duration) =>
      MediaQuery.maybeOf(context)?.disableAnimations ?? false
      ? Duration.zero
      : duration;
}

abstract final class AsBreakpoints {
  static const mobile = 600.0;
  static const tablet = 900.0;
  static const desktop = 1200.0;
  static const wideDesktop = 1600.0;
}

abstract final class AsShadows {
  static const card = [
    BoxShadow(color: Color(0x1206172F), blurRadius: 24, offset: Offset(0, 8)),
  ];
}
