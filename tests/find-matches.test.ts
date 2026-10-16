import { describe, it, expect } from 'vitest';
import { EditorSelection, EditorState } from '@codemirror/state';
import { SearchQuery } from '@codemirror/search';
import {
  buildMatchPreview, collectMatches, currentMatchIndex, matchIndexFrom,
} from '../src/app/shared/codemirror/find-matches';

const state = (doc: string): EditorState => EditorState.create({ doc });

describe('collectMatches', () => {
  it('lists every match in order with its line', () => {
    const matches = collectMatches(state('chat\nun chat, deux chats'), new SearchQuery({ search: 'chat' }));
    expect(matches.map(match => [match.from, match.line])).toEqual([[0, 1], [8, 2], [19, 2]]);
  });

  it('follows the case, whole word and regexp options', () => {
    const doc = state('Chat chat chats');
    expect(collectMatches(doc, new SearchQuery({ search: 'chat', caseSensitive: true }))).toHaveLength(2);
    expect(collectMatches(doc, new SearchQuery({ search: 'chat', wholeWord: true }))).toHaveLength(2);
    expect(collectMatches(doc, new SearchQuery({ search: 'chats?$', regexp: true }))).toHaveLength(1);
  });

  it('matches nothing for an empty query or an invalid regexp', () => {
    expect(collectMatches(state('abc'), new SearchQuery({ search: '' }))).toEqual([]);
    expect(collectMatches(state('abc'), new SearchQuery({ search: '(', regexp: true }))).toEqual([]);
  });

  it('stops at the limit', () => {
    expect(collectMatches(state('a a a a'), new SearchQuery({ search: 'a' }), 3)).toHaveLength(3);
  });
});

describe('buildMatchPreview', () => {
  it('keeps the line around a short match', () => {
    expect(buildMatchPreview('un chat noir', 3, 7)).toEqual({ before: 'un ', text: 'chat', after: ' noir' });
  });

  it('cuts long lines with an ellipsis', () => {
    const line = `${'x'.repeat(50)}MOT${'y'.repeat(100)}`;
    const preview = buildMatchPreview(line, 50, 53);
    expect(preview.text).toBe('MOT');
    expect(preview.before.startsWith('…')).toBe(true);
    expect(preview.after.endsWith('…')).toBe(true);
  });
});

describe('currentMatchIndex / matchIndexFrom', () => {
  const matches = collectMatches(state('a b a b a'), new SearchQuery({ search: 'a' }));

  it('finds the match covered by the selection, -1 otherwise', () => {
    expect(currentMatchIndex(matches, EditorSelection.create([EditorSelection.range(4, 5)]))).toBe(1);
    expect(currentMatchIndex(matches, EditorSelection.create([EditorSelection.cursor(4)]))).toBe(-1);
  });

  it('picks the first match from a position, wrapping around', () => {
    expect(matchIndexFrom(matches, 1)).toBe(1);
    expect(matchIndexFrom(matches, 9)).toBe(0);
    expect(matchIndexFrom([], 0)).toBe(-1);
  });
});
