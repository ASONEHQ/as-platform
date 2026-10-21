/// TASK 16.6 (Productos/Catálogo legacy parity) — shared rendering logic
/// for a product's real image/icon/card-appearance, used by the POS
/// sell-screen card (`_PosProductCard`), the admin catalog grid card
/// (`_ProductCard`), and the product dialog's own live preview — one real
/// implementation, never three divergent ones, mirroring the legacy's own
/// `prodCard()` reuse pattern (`AS POS V1.html:4980-4990`, confirmed
/// genuinely functional and reused verbatim by its own live-preview
/// function `mpCardPreview()`, `AS POS V1.html:7567-7582`).
library;

import 'package:flutter/material.dart';

import 'pos_tokens.dart';

/// Mirrors the platform's bounded `productIconKeys` allowlist
/// (`apps/api/src/modules/catalog/product-catalog.types.ts`) — order
/// preserved for the icon picker grid. Each client maps these stable,
/// tenant-neutral keys to its own real icon set (this file's own mapping
/// below), never the legacy's own Tabler-Icons-specific class names
/// (`ti-ticket`, `ti-users`, ...), which Flutter cannot render directly.
const List<String> posProductIconKeys = [
  'ticket',
  'guests',
  'attraction',
  'protection',
  'apparel',
  'kitchen',
  'premium',
  'gift',
  'store',
  'bakery',
  'celebration',
  'shirt',
  'bag',
  'balloon',
  'featured',
  'award',
  'music',
  'photo',
  'snack',
  'pizza',
  'burger',
  'drink',
  'candy',
  'palette',
  'box',
];

/// Shown when a product has neither a real image nor a configured
/// [posProductIconKeys] entry — matches the icon already used everywhere
/// in this file before TASK 16.6.
const IconData posProductFallbackIcon = Icons.inventory_2_outlined;

const Map<String, IconData> _posProductIconByKey = {
  'ticket': Icons.confirmation_number_outlined,
  'guests': Icons.groups_outlined,
  'attraction': Icons.festival_outlined,
  'protection': Icons.shield_outlined,
  'apparel': Icons.checkroom_outlined,
  'kitchen': Icons.kitchen_outlined,
  'premium': Icons.diamond_outlined,
  'gift': Icons.card_giftcard_outlined,
  'store': Icons.storefront_outlined,
  'bakery': Icons.bakery_dining_outlined,
  'celebration': Icons.celebration_outlined,
  'shirt': Icons.dry_cleaning_outlined,
  'bag': Icons.shopping_bag_outlined,
  // Standard Material Icons has no literal balloon glyph — closest
  // available festive stand-in.
  'balloon': Icons.emoji_objects_outlined,
  'featured': Icons.star_outline,
  'award': Icons.emoji_events_outlined,
  'music': Icons.music_note_outlined,
  'photo': Icons.photo_camera_outlined,
  'snack': Icons.fastfood_outlined,
  'pizza': Icons.local_pizza_outlined,
  'burger': Icons.lunch_dining_outlined,
  'drink': Icons.local_cafe_outlined,
  'candy': Icons.icecream_outlined,
  'palette': Icons.palette_outlined,
  'box': Icons.inventory_2_outlined,
};

IconData posProductIconFor(String? iconKey) => _posProductIconByKey[iconKey] ?? posProductFallbackIcon;

/// Human-readable Spanish label for an icon picker grid entry.
const Map<String, String> posProductIconLabels = {
  'ticket': 'Boleto',
  'guests': 'Invitados',
  'attraction': 'Atracción',
  'protection': 'Protección',
  'apparel': 'Ropa',
  'kitchen': 'Cocina',
  'premium': 'Premium',
  'gift': 'Regalo',
  'store': 'Tienda',
  'bakery': 'Panadería',
  'celebration': 'Celebración',
  'shirt': 'Camisa',
  'bag': 'Bolsa',
  'balloon': 'Globo',
  'featured': 'Destacado',
  'award': 'Premio',
  'music': 'Música',
  'photo': 'Foto',
  'snack': 'Botana',
  'pizza': 'Pizza',
  'burger': 'Hamburguesa',
  'drink': 'Bebida',
  'candy': 'Dulce',
  'palette': 'Paleta',
  'box': 'Caja',
};

/// Parses a `#RRGGBB` hex string (the backend's own `card_color_hex`
/// format, `products_card_color_hex_ck`) into a real [Color] — `null` on
/// anything else, never a guessed/default color silently substituted.
Color? posProductColorFromHex(String? hex) {
  if (hex == null) return null;
  final match = RegExp(r'^#([0-9A-Fa-f]{6})$').firstMatch(hex);
  if (match == null) return null;
  final value = int.tryParse(match.group(1)!, radix: 16);
  if (value == null) return null;
  return Color(0xFF000000 | value);
}

/// TASK 16.6 — the `gradient` card style, mirroring the legacy's own
/// `mpColorSetModo()`/`prodCard()` (`AS POS V1.html:4980-4990, 7557-7565`):
/// a soft diagonal tint of the configured color fading into the palette's
/// own neutral surface (never a hardcoded tenant color). Returns `null` for
/// every other style (including `solid`, which TASK 17.5.4.1 renders as an
/// accent — see [posProductCardAccent] — instead of a flat fill) and for a
/// missing/invalid hex, i.e. "render the palette's own neutral surface".
Gradient? posProductCardGradient({
  required String cardStyle,
  required String? cardColorHex,
  required PosPalette palette,
}) {
  final color = posProductColorFromHex(cardColorHex);
  if (cardStyle != 'gradient' || color == null) return null;
  return LinearGradient(
    begin: Alignment.topLeft,
    end: Alignment.bottomRight,
    colors: [color.withValues(alpha: .18), palette.surface],
    stops: const [0, .65],
  );
}

/// TASK 17.5.4.1 — how a `solid` card style is expressed on the premium POS
/// card: the card body stays the normal surface and the configured color
/// becomes a restrained ACCENT (border, a soft tint behind the image/icon
/// area, and a faint badge tint) instead of a saturated full-card fill.
/// One helper feeds the POS card, the admin catalog card and the product
/// dialog's live preview, so they can never drift apart.
@immutable
class PosProductCardAccent {
  const PosProductCardAccent({
    required this.color,
    required this.mediaTint,
    required this.badgeTint,
  });

  /// The configured color, nudged only as far as needed to stay visible on
  /// the card surface (a pale yellow on white is darkened, a navy on a dark
  /// surface is lightened) — used for the border and the fallback icon.
  final Color color;

  /// Opaque soft tint for the image/icon area (blended over the surface).
  final Color mediaTint;

  /// Opaque, fainter tint for the category badge.
  final Color badgeTint;
}

/// `null` unless [cardStyle] is `solid` with a valid configured color.
PosProductCardAccent? posProductCardAccent({
  required String cardStyle,
  required String? cardColorHex,
  required PosPalette palette,
}) {
  if (cardStyle != 'solid') return null;
  final configured = posProductColorFromHex(cardColorHex);
  if (configured == null) return null;
  final accent = _visibleOn(configured, palette.surface);
  return PosProductCardAccent(
    color: accent,
    mediaTint: Color.alphaBlend(accent.withValues(alpha: .16), palette.surface),
    badgeTint: Color.alphaBlend(accent.withValues(alpha: .12), palette.surface),
  );
}

/// Minimum contrast between the accent and the card surface — enough for a
/// clearly visible border without demanding text-level (4.5:1) contrast.
const double _kAccentMinContrast = 2.0;

double _contrastRatio(Color a, Color b) {
  final la = a.computeLuminance();
  final lb = b.computeLuminance();
  final lighter = la > lb ? la : lb;
  final darker = la > lb ? lb : la;
  return (lighter + .05) / (darker + .05);
}

/// Moves [color]'s HSL lightness away from [surface] (darker on a light
/// surface, lighter on a dark one) until it reaches [_kAccentMinContrast],
/// keeping hue and saturation so "blue" stays blue and "yellow" stays gold.
Color _visibleOn(Color color, Color surface) {
  if (_contrastRatio(color, surface) >= _kAccentMinContrast) return color;
  final hsl = HSLColor.fromColor(color);
  final towardDark = ThemeData.estimateBrightnessForColor(surface) == Brightness.light;
  var lightness = hsl.lightness;
  var result = color;
  while (_contrastRatio(result, surface) < _kAccentMinContrast) {
    lightness += towardDark ? -.04 : .04;
    if (lightness <= 0 || lightness >= 1) break;
    result = hsl.withLightness(lightness).toColor();
  }
  return result;
}

/// Real photo, falling back to the [iconKey]-mapped icon, falling back to
/// [posProductFallbackIcon] — this is what makes a configured product
/// image actually flow through to the POS/Cafetería card wherever it is
/// used, per this task's own explicit requirement. Used by both product
/// cards AND the create/edit dialog's own live preview, so there is only
/// ever one real rendering path.
class PosProductCardVisual extends StatelessWidget {
  const PosProductCardVisual({
    required this.imageUrl,
    required this.iconKey,
    this.size = 34,
    this.color,
    super.key,
  });

  final String? imageUrl;
  final String? iconKey;
  final double size;
  final Color? color;

  @override
  Widget build(BuildContext context) {
    final url = imageUrl;
    if (url != null && url.isNotEmpty) {
      return ClipRRect(
        borderRadius: BorderRadius.circular(8),
        child: Image.network(
          url,
          width: size,
          height: size,
          fit: BoxFit.cover,
          errorBuilder: (context, error, stackTrace) =>
              Icon(posProductIconFor(iconKey), size: size, color: color),
        ),
      );
    }
    return Icon(posProductIconFor(iconKey), size: size, color: color);
  }
}

/// Formats a real [Color] back into the backend's own `#RRGGBB` format
/// (`products_card_color_hex_ck`) — the inverse of [posProductColorFromHex],
/// used when a picker swatch is tapped.
String posProductHexFromColor(Color color) {
  final rgb = color.toARGB32() & 0xFFFFFF;
  return '#${rgb.toRadixString(16).padLeft(6, '0').toUpperCase()}';
}

/// A small, curated set of preset swatches for the card-color picker —
/// never a full color-wheel picker (this codebase pulls in no extra
/// package for that), but enough real choices to cover the legacy's own
/// intent of "pick a card color."
const List<Color> posProductColorPresets = [
  Color(0xFF6B3FA0),
  Color(0xFFB91C1C),
  Color(0xFFB45309),
  Color(0xFF2E7D32),
  Color(0xFF0891B2),
  Color(0xFF1677FF),
  Color(0xFF7C3AED),
  Color(0xFFDB2777),
  Color(0xFF334155),
];

/// A small corner badge for [PosProduct.isFeatured]/legacy "Favorito"
/// parity — a filled star, shown only when the product is really marked
/// featured.
class PosProductFeaturedBadge extends StatelessWidget {
  const PosProductFeaturedBadge({this.size = 16, super.key});
  final double size;

  @override
  Widget build(BuildContext context) => Icon(Icons.star, size: size, color: PosColors.warning);
}
