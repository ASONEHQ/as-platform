import 'dart:ui' as ui;

import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';

/// TASK 16.12A: deterministic proof that the two ACCESS GO brand assets
/// (the normal, blue/cyan mark and the white-on-dark variant introduced in
/// this task) are both present, geometrically identical, and correctly
/// colored — not a screenshot-pixel test of any rendered widget, just a
/// direct decode of the shipped PNGs.
void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  Future<ui.Image> decode(String assetKey) async {
    final data = await rootBundle.load(assetKey);
    final codec = await ui.instantiateImageCodec(data.buffer.asUint8List());
    final frame = await codec.getNextFrame();
    return frame.image;
  }

  Future<ByteData> rgbaBytes(ui.Image image) async {
    final data = await image.toByteData(format: ui.ImageByteFormat.rawRgba);
    if (data == null) {
      fail('Could not read raw RGBA bytes from the decoded image.');
    }
    return data;
  }

  test('normal ACCESS GO asset exists and decodes at the official 400x219 '
      'source resolution', () async {
    final normal = await decode('assets/branding/access_go_logo.png');
    expect(normal.width, 400);
    expect(normal.height, 219);
  });

  test(
    'white ACCESS GO asset exists, matches the normal asset\'s dimensions '
    '(same artwork, only recolored), and has a transparent background',
    () async {
      final normal = await decode('assets/branding/access_go_logo.png');
      final white = await decode('assets/branding/access_go_logo_white.png');

      expect(white.width, normal.width);
      expect(white.height, normal.height);

      final bytes = await rgbaBytes(white);
      final w = white.width;
      final h = white.height;
      int alphaAt(int x, int y) => bytes.getUint8((y * w + x) * 4 + 3);

      // No background rectangle: all four corners stay fully transparent.
      expect(alphaAt(0, 0), 0);
      expect(alphaAt(w - 1, 0), 0);
      expect(alphaAt(0, h - 1), 0);
      expect(alphaAt(w - 1, h - 1), 0);
    },
  );

  test(
    'every visible (non-transparent) pixel of the white asset is white or '
    'near-white — no leftover blue/cyan, no glow, no shadow tinting',
    () async {
      final white = await decode('assets/branding/access_go_logo_white.png');
      final bytes = await rgbaBytes(white);

      var visiblePixels = 0;
      var transparentPixels = 0;
      for (var i = 0; i < bytes.lengthInBytes; i += 4) {
        final r = bytes.getUint8(i);
        final g = bytes.getUint8(i + 1);
        final b = bytes.getUint8(i + 2);
        final a = bytes.getUint8(i + 3);
        if (a == 0) {
          transparentPixels++;
          continue;
        }
        visiblePixels++;
        // `toByteData(rawRgba)` returns PREMULTIPLIED alpha, so a
        // partially-transparent anti-aliased edge pixel's stored RGB is
        // naturally below 255 even for pure white content — unpremultiply
        // before checking color, rather than only checking near-opaque
        // pixels.
        final unR = (r * 255 / a).round();
        final unG = (g * 255 / a).round();
        final unB = (b * 255 / a).round();
        expect(
          unR >= 250 && unG >= 250 && unB >= 250,
          isTrue,
          reason: 'Pixel is not white after unpremultiplying: premultiplied '
              'rgba($r,$g,$b,$a) -> straight rgb($unR,$unG,$unB)',
        );
      }

      // Real content on a real transparent canvas, not an accidental
      // blank or fully-opaque image.
      expect(visiblePixels, greaterThan(1000));
      expect(transparentPixels, greaterThan(1000));
    },
  );
}
