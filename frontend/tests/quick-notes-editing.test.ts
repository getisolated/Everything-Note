import { describe, it, expect } from 'vitest';
import { EditorState } from '@codemirror/state';
import { joinBlocks, noteTimestamps, setTimestampBlocks } from '../src/app/shared/codemirror/note-timestamps';
import { changesStayInBlock, editingQuickNote, quickNotesEditing } from '../src/app/shared/codemirror/quick-notes-editing';

const blocks = [
  { id: 1, text: 'first', label: '09:00' },
  { id: 2, text: 'second', label: '09:05' },
];
const handlers = { save: () => undefined, remove: () => undefined, copy: () => undefined, convert: () => undefined, editEnded: () => undefined };

function quickNotesState(): EditorState {
  return EditorState.create({ doc: joinBlocks(blocks), extensions: [noteTimestamps, quickNotesEditing(handlers)] })
    .update({ effects: setTimestampBlocks.of(blocks) }).state;
}

describe('quick notes edit guard', () => {
  it('rejects any typing while no note is being edited', () => {
    const state = quickNotesState();
    expect(editingQuickNote(state)).toBeNull();
    expect(state.update({ changes: { from: 0, insert: 'x' } }).state.doc.toString()).toBe('first\n\nsecond');
  });

  it('lets the document refresh through when filtering is disabled', () => {
    const state = quickNotesState().update({ changes: { from: 0, to: 5, insert: 'new' }, filter: false }).state;
    expect(state.doc.toString()).toBe('new\n\nsecond');
  });
});

describe('changesStayInBlock', () => {
  const base = EditorState.create({ doc: 'first\n\nsecond' });
  const range = { id: 1, label: '', from: 0, to: 5 };

  it('accepts changes inside the block, ends included', () => {
    expect(changesStayInBlock(base.update({ changes: { from: 5, insert: '!' } }), range)).toBe(true);
    expect(changesStayInBlock(base.update({ changes: { from: 0, to: 5, insert: 'x' } }), range)).toBe(true);
  });

  it('rejects changes reaching outside of it', () => {
    expect(changesStayInBlock(base.update({ changes: { from: 4, to: 7 } }), range)).toBe(false);
    expect(changesStayInBlock(base.update({ changes: { from: 8, insert: 'x' } }), range)).toBe(false);
  });
});
