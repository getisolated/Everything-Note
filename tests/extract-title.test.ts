import { describe, it, expect } from 'vitest';

// extractTitle is a pure function on NotesService — extract the logic for direct testing
function extractTitle(content: string): string {
  const firstLine = content.split('\n')[0] ?? '';
  return firstLine.replace(/^#+\s*/, '').trim() || 'Untitled';
}

describe('extractTitle', () => {
  it('extracts plain text from first line', () => {
    expect(extractTitle('My Note\nSome content')).toBe('My Note');
  });

  it('strips markdown heading syntax', () => {
    expect(extractTitle('# My Heading')).toBe('My Heading');
    expect(extractTitle('## Sub Heading')).toBe('Sub Heading');
    expect(extractTitle('### Deep Heading')).toBe('Deep Heading');
  });

  it('strips multiple hash marks', () => {
    expect(extractTitle('###### H6 Title')).toBe('H6 Title');
  });

  it('returns "Untitled" for empty content', () => {
    expect(extractTitle('')).toBe('Untitled');
    expect(extractTitle('\n\n')).toBe('Untitled');
  });

  it('returns "Untitled" for heading with no text', () => {
    expect(extractTitle('# ')).toBe('Untitled');
    expect(extractTitle('##')).toBe('Untitled');
  });

  it('trims whitespace around title', () => {
    expect(extractTitle('#  Spaced  ')).toBe('Spaced');
  });

  it('treats indented hash as plain text (not a heading)', () => {
    expect(extractTitle('  # Not a heading')).toBe('# Not a heading');
  });

  it('uses only the first line', () => {
    expect(extractTitle('Line 1\n# Line 2')).toBe('Line 1');
  });
});
