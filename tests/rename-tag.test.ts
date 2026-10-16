import { describe, it, expect } from 'vitest';
import { renameTag } from '../electron/database';

describe('renameTag', () => {
  it('renames the tag and keeps the others in place', () => {
    expect(renameTag(['a', 'overlay', 'b'], 'overlay', 'quick-note')).toEqual(['a', 'quick-note', 'b']);
  });

  it('does not duplicate the new tag when the note already has it', () => {
    expect(renameTag(['quick-note', 'overlay'], 'overlay', 'quick-note')).toEqual(['quick-note']);
  });

  it('leaves tags without the old one untouched', () => {
    expect(renameTag(['a'], 'overlay', 'quick-note')).toEqual(['a']);
  });
});
