import { describe, it, expect } from 'vitest';
import { hexToHsv, hsvToHex, normalizeHex } from '../src/app/core/utils/color.util';
import { normalizeColor } from '../electron/database';

describe('normalizeHex', () => {
  it('accepts short and long forms, with or without #', () => {
    expect(normalizeHex('#ABC')).toBe('#aabbcc');
    expect(normalizeHex('12ab9F')).toBe('#12ab9f');
    expect(normalizeHex('  #123456 ')).toBe('#123456');
  });

  it('rejects anything else', () => {
    ['', '#12', '#12345g', 'red', '#1234567'].forEach(value => expect(normalizeHex(value)).toBeNull());
  });
});

describe('hexToHsv / hsvToHex', () => {
  it('converts primary colors', () => {
    expect(hexToHsv('#ff0000')).toEqual({ h: 0, s: 1, v: 1 });
    expect(hexToHsv('#00ff00').h).toBe(120);
    expect(hexToHsv('#000000')).toEqual({ h: 0, s: 0, v: 0 });
  });

  it('round-trips', () => {
    ['#3a7bd5', '#ffffff', '#808080', '#d13a4c', '#0b7a5a'].forEach(hex => expect(hsvToHex(hexToHsv(hex))).toBe(hex));
  });
});

describe('normalizeColor (main process)', () => {
  it('keeps a #rrggbb color in lower case and refuses the rest', () => {
    expect(normalizeColor('#AABBCC')).toBe('#aabbcc');
    expect(normalizeColor('#abc')).toBeNull();
    expect(normalizeColor(null)).toBeNull();
    expect(normalizeColor('red; drop table')).toBeNull();
  });
});
