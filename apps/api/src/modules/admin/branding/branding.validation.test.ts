import { describe, expect, it } from 'vitest';

import {
  ALLOWED_LOGO_CONTENT_TYPES,
  MAX_LOGO_BYTES,
  isAllowedLogoContentType,
  logoFileExtension,
  matchesLogoFileSignature,
} from './branding.validation.js';

const pngBytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
const jpegBytes = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0]);
const webpBytes = Buffer.concat([
  Buffer.from('RIFF', 'ascii'),
  Buffer.from([0, 0, 0, 0]),
  Buffer.from('WEBP', 'ascii'),
]);
const svgBytes = Buffer.from('<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg"></svg>');

describe('isAllowedLogoContentType', () => {
  it('accepts exactly the approved image content types', () => {
    for (const type of ALLOWED_LOGO_CONTENT_TYPES) expect(isAllowedLogoContentType(type)).toBe(true);
  });

  it('rejects a disallowed content type', () => {
    expect(isAllowedLogoContentType('application/pdf')).toBe(false);
    expect(isAllowedLogoContentType('text/html')).toBe(false);
    expect(isAllowedLogoContentType('application/x-msdownload')).toBe(false);
  });
});

describe('logoFileExtension', () => {
  it('maps every allowed content type to a stable extension', () => {
    expect(logoFileExtension('image/png')).toBe('png');
    expect(logoFileExtension('image/jpeg')).toBe('jpg');
    expect(logoFileExtension('image/webp')).toBe('webp');
    expect(logoFileExtension('image/svg+xml')).toBe('svg');
  });
});

describe('matchesLogoFileSignature', () => {
  it('confirms real PNG/JPEG/WEBP/SVG bytes against their declared type', () => {
    expect(matchesLogoFileSignature('image/png', pngBytes)).toBe(true);
    expect(matchesLogoFileSignature('image/jpeg', jpegBytes)).toBe(true);
    expect(matchesLogoFileSignature('image/webp', webpBytes)).toBe(true);
    expect(matchesLogoFileSignature('image/svg+xml', svgBytes)).toBe(true);
  });

  it('rejects a spoofed content type whose bytes do not match (e.g. an executable renamed to .png)', () => {
    const notAnImage = Buffer.from('MZ\x90\x00this is actually an executable, not a png');
    expect(matchesLogoFileSignature('image/png', notAnImage)).toBe(false);
    expect(matchesLogoFileSignature('image/jpeg', notAnImage)).toBe(false);
    expect(matchesLogoFileSignature('image/webp', notAnImage)).toBe(false);
    expect(matchesLogoFileSignature('image/svg+xml', notAnImage)).toBe(false);
  });

  it('rejects cross-signature spoofing (a real PNG declared as JPEG)', () => {
    expect(matchesLogoFileSignature('image/jpeg', pngBytes)).toBe(false);
  });
});

describe('MAX_LOGO_BYTES', () => {
  it('is the 2MB cap this task specifies', () => {
    expect(MAX_LOGO_BYTES).toBe(2 * 1024 * 1024);
  });
});
