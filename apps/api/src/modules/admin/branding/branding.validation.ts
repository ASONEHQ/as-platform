/// TASK 14.5A: content-type validation for the business-logo upload. The
/// declared multipart `Content-Type` is client-supplied and never fully
/// trustworthy on its own, so this also sniffs the real file signature
/// (magic bytes) for the three binary formats that have one; SVG is text
/// and has no magic-byte signature, so it is validated by declared type
/// plus a cheap structural check instead (must actually contain an
/// `<svg` tag).

export const ALLOWED_LOGO_CONTENT_TYPES = [
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/svg+xml',
] as const;

export type AllowedLogoContentType = (typeof ALLOWED_LOGO_CONTENT_TYPES)[number];

export const MAX_LOGO_BYTES = 2 * 1024 * 1024; // 2MB, per this task's own instructions.

const EXTENSION_BY_CONTENT_TYPE: Readonly<Record<AllowedLogoContentType, string>> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/svg+xml': 'svg',
};

export function isAllowedLogoContentType(value: string): value is AllowedLogoContentType {
  return (ALLOWED_LOGO_CONTENT_TYPES as readonly string[]).includes(value.toLowerCase());
}

export function logoFileExtension(contentType: AllowedLogoContentType): string {
  return EXTENSION_BY_CONTENT_TYPE[contentType];
}

/** Confirms the real file bytes match the declared, allow-listed content
 * type -- returns `false` for a mismatch (e.g. a `.exe` renamed to
 * `logo.png` with a spoofed multipart `Content-Type: image/png`). */
export function matchesLogoFileSignature(
  contentType: AllowedLogoContentType,
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
      // SVG is text, not binary-signed; a real document is small enough for
      // this feature (2MB cap) to decode as UTF-8 and structurally confirm
      // it actually contains an `<svg` element rather than trusting the
      // declared content-type alone.
      const head = bytes.subarray(0, 1024).toString('utf8').toLowerCase();
      return head.includes('<svg');
    }
  }
}
