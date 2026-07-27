import { describe, expect, it } from 'vitest';

import { ifNoneMatchMatches, parseIfMatch, parseSettingKeys } from './settings.schemas.js';

describe('settings HTTP parsers', () => {
  it.each([
    ['"1"', 1n],
    ['"2"', 2n],
    ['"999999999999999999999"', 999999999999999999999n],
  ])('parses valid If-Match %s', (header, expected) => {
    expect(parseIfMatch(header)).toBe(expected);
  });

  it.each([undefined, 'W/"1"', '*', '"1","2"', '1', '"1.5"', '"0"', '"-1"', ' "1" '])(
    'rejects invalid If-Match %s',
    (header) => {
      expect(() => parseIfMatch(header)).toThrow(
        expect.objectContaining({ code: 'validation_error', statusCode: 400 }),
      );
    },
  );

  it('uses weak comparison and lists for If-None-Match', () => {
    const current = '"settings:abc"';
    expect(ifNoneMatchMatches(current, current)).toBe(true);
    expect(ifNoneMatchMatches(`W/${current}`, current)).toBe(true);
    expect(ifNoneMatchMatches(`"other", W/${current}`, current)).toBe(true);
    expect(ifNoneMatchMatches('*', current)).toBe(true);
    expect(ifNoneMatchMatches('"other"', current)).toBe(false);
    expect(ifNoneMatchMatches(undefined, current)).toBe(false);
  });

  it('normalizes key filters and rejects ambiguous or empty values', () => {
    expect(parseSettingKeys(undefined)).toBeUndefined();
    expect(parseSettingKeys(' business.locale,ui.time_format,business.locale ')).toEqual([
      'business.locale',
      'ui.time_format',
    ]);
    expect(() => parseSettingKeys(['business.locale'])).toThrow(
      expect.objectContaining({ code: 'validation_error' }),
    );
    expect(() => parseSettingKeys('business.locale,')).toThrow(
      expect.objectContaining({ code: 'validation_error' }),
    );
    expect(() => parseSettingKeys('x'.repeat(1025))).toThrow(
      expect.objectContaining({ code: 'validation_error' }),
    );
  });
});
