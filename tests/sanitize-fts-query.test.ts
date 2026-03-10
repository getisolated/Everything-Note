import { describe, it, expect } from 'vitest';
import { sanitizeFtsQuery } from '../electron/database';

describe('sanitizeFtsQuery', () => {
  it('wraps single word in quotes', () => {
    expect(sanitizeFtsQuery('hello')).toBe('"hello"');
  });

  it('wraps multiple words individually', () => {
    expect(sanitizeFtsQuery('hello world')).toBe('"hello" "world"');
  });

  it('escapes double quotes inside tokens', () => {
    expect(sanitizeFtsQuery('say "hi"')).toBe('"say" """hi"""');
  });

  it('trims whitespace and collapses spaces', () => {
    expect(sanitizeFtsQuery('  foo   bar  ')).toBe('"foo" "bar"');
  });

  it('returns empty string for empty input', () => {
    expect(sanitizeFtsQuery('')).toBe('');
    expect(sanitizeFtsQuery('   ')).toBe('');
  });

  it('handles special FTS5 characters safely', () => {
    // Characters like * + - are wrapped in quotes, making them literal
    expect(sanitizeFtsQuery('c++')).toBe('"c++"');
    expect(sanitizeFtsQuery('NOT OR AND')).toBe('"NOT" "OR" "AND"');
  });
});
