import { describe, it, expect } from 'vitest';
import { escapeLike } from '../electron/database';

describe('escapeLike', () => {
  it('returns plain text unchanged', () => {
    expect(escapeLike('hello')).toBe('hello');
  });

  it('escapes percent wildcard', () => {
    expect(escapeLike('100%')).toBe('100\\%');
  });

  it('escapes underscore wildcard', () => {
    expect(escapeLike('file_name')).toBe('file\\_name');
  });

  it('escapes backslash', () => {
    expect(escapeLike('path\\to')).toBe('path\\\\to');
  });

  it('escapes all special characters together', () => {
    expect(escapeLike('%_\\')).toBe('\\%\\_\\\\');
  });

  it('returns empty string for empty input', () => {
    expect(escapeLike('')).toBe('');
  });
});
