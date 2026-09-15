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

/// TASK 16.6 — mirrors the legacy's own genuinely functional 3-mode
/// `mpColorSetModo()`/`prodCard()` background (`AS POS V1.html:4980-4990,
/// 7557-7565`): `solid` = a flat fill of the configured color; `gradient`
/// = a soft diagonal tint fading into the palette's own neutral surface
/// (never a hardcoded tenant color); `default` (or a missing/invalid hex
/// on a non-default style) = the platform's own neutral surface — unlike
/// the legacy, which hardcoded a single hex (`#6B3FA0`) as its "default"
/// color, this platform never bakes one tenant's color into shared
/// application logic. Returns a `(background, gradient)` pair — exactly
/// one is non-null when [cardStyle] is a real color mode, both `null`
/// (render the palette's own neutral surface) otherwise — so callers can
/// feed either straight into a `BoxDecoration` (`_PosProductCard`) or
/// `_PosCard`'s own `background`/`gradient` parameters without a second
/// `Decoration`-unwrapping step.
({Color? background, Gradient? gradient}) posProductCardFill({
  required String cardStyle,
  required String? cardColorHex,
  required PosPalette palette,
}) {
  final color = posProductColorFromHex(cardColorHex);
  if (cardStyle == 'solid' && color != null) {
    return (background: color, gradient: null);
  }
  if (cardStyle == 'gradient' && color != null) {
    return (
      background: null,
      gradient: LinearGradient(
        begin: Alignment.topLeft,
        end: Alignment.bottomRight,
        colors: [color.withValues(alpha: .18), palette.surface],
        stops: const [0, .65],
      ),
    );
  }
  return (background: null, gradient: null);
}

/// A readable foreground color (for the icon/text sitting on top of
/// [posProductCardDecoration]) — the palette's own accent normally, but
/// switches to white on a genuinely dark `solid` fill so the icon stays
/// legible instead of nearly invisible.
Color posProductCardForeground({
  required String cardStyle,
  required String? cardColorHex,
  required Color fallback,
}) {
  if (cardStyle != 'solid') return fallback;
  final color = posProductColorFromHex(cardColorHex);
  if (color == null) return fallback;
  return ThemeData.estimateBrightnessForColor(color) == Brightness.dark ? Colors.white : fallback;
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
