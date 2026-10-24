import { describe, it, expect } from 'vitest';
import { externallyChangedContent } from '../src/app/core/utils/external-change.util';

describe('externallyChangedContent', () => {
  it('reloads a note changed elsewhere while the editor holds no edit', () => {
    expect(externallyChangedContent('old', 'new', 'old', false)).toBe('new');
  });

  it('keeps the editor when nothing changed or it already shows the stored text', () => {
    expect(externallyChangedContent('same', 'same', 'same', false)).toBeNull();
    expect(externallyChangedContent('old', 'typed', 'typed', false)).toBeNull();
  });

  it('never overwrites unsaved edits', () => {
    expect(externallyChangedContent('old', 'new', 'old + typing', true)).toBeNull();
  });

  it('ignores a note that is gone', () => {
    expect(externallyChangedContent('old', undefined, 'old', false)).toBeNull();
  });
});
