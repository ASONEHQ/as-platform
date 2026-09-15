/// TASK 16.6 — generic image-upload content validation, extracted from
/// `apps/api/src/modules/admin/branding/branding.validation.ts` (built for
/// the tenant logo upload) so a second feature needing "confirm an
/// uploaded file is really one of a handful of image formats, within a
/// size cap" — here, product images — reuses the exact same, already-
/// proven logic rather than a hand-copied duplicate. `branding.validation
/// .ts` now re-exports from here unchanged, so its own existing callers/
/// tests are untouched.
///
/// The declared multipart `Content-Type` is client-supplied and never
/// fully trustworthy on its own, so this also sniffs the real file
/// signature (magic bytes) for the three binary formats that have one;
/// SVG is text and has no magic-byte signature, so it is validated by
/// declared type plus a cheap structural check instead (must actually
/// contain an `<svg` tag).

export const ALLOWED_IMAGE_CONTENT_TYPES = [
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/svg+xml',
] as const;

export type AllowedImageContentType = (typeof ALLOWED_IMAGE_CONTENT_TYPES)[number];

export const MAX_IMAGE_BYTES = 2 * 1024 * 1024; // 2MB — same cap the logo upload already established.

const EXTENSION_BY_CONTENT_TYPE: Readonly<Record<AllowedImageContentType, string>> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/svg+xml': 'svg',
};

export function isAllowedImageContentType(value: string): value is AllowedImageContentType {
  return (ALLOWED_IMAGE_CONTENT_TYPES as readonly string[]).includes(value.toLowerCase());
}

export function imageFileExtension(contentType: AllowedImageContentType): string {
  return EXTENSION_BY_CONTENT_TYPE[contentType];
}

/** Confirms the real file bytes match the declared, allow-listed content
 * type — returns `false` for a mismatch (e.g. a `.exe` renamed to
 * `photo.png` with a spoofed multipart `Content-Type: image/png`). */
export function matchesImageFileSignature(
  contentType: AllowedImageContentType,
  bytes: Buffer,
): boolean {
  switch (contentType) {
    case 'image/png':
      return (
        bytes.length >= 8 &&
        bytes[0] === 0x89 &&
        bytes[1] === 0x50 &&
        bytes[2] === 0x4e &&
        bytes[3] === 0x47 &&
        bytes[4] === 0x0d &&
        bytes[5] === 0x0a &&
        bytes[6] === 0x1a &&
        bytes[7] === 0x0a
      );
    case 'image/jpeg':
      return bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
    case 'image/webp':
      return (
        bytes.length >= 12 &&
        bytes.subarray(0, 4).toString('ascii') === 'RIFF' &&
        bytes.subarray(8, 12).toString('ascii') === 'WEBP'
      );
    case 'image/svg+xml': {
      const head = bytes.subarray(0, 1024).toString('utf8').toLowerCase();
      return head.includes('<svg');
    }
  }
}
