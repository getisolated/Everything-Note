import { EditorSelection, EditorState } from '@codemirror/state';
import { SearchQuery } from '@codemirror/search';

/** One occurrence of the search query, with what the results list shows of its line. */
export interface FindMatch {
  from: number;
  to: number;
  /** 1-based line number. */
  line: number;
  /** Text of the line before the match (shortened, `…` when cut). */
  before: string;
  text: string;
  /** Text of the line after the match (shortened, `…` when cut). */
  after: string;
}

/** Beyond this, the list would be useless and slow to draw: the count says "1000+". */
export const MAX_FIND_MATCHES = 1000;

/** Characters of context kept around a match in the results list. */
const CONTEXT_BEFORE = 24;
const CONTEXT_AFTER = 60;

/** The part of a line shown around a match: a little before, more after, trimmed and cut with `…`. */
export function buildMatchPreview(lineText: string, from: number, to: number): Pick<FindMatch, 'before' | 'text' | 'after'> {
  const start = Math.max(0, from - CONTEXT_BEFORE);
  const end = Math.min(lineText.length, to + CONTEXT_AFTER);
  const head = start > 0 ? '…' : '';
  const tail = end < lineText.length ? '…' : '';
  const before = `${head}${lineText.slice(start, from)}`.trimStart();
  const after = `${lineText.slice(to, end)}${tail}`;
  return { before, text: lineText.slice(from, to), after };
}

/** Every match of the query in the document, in order, up to `limit`. An invalid query (empty, bad regexp) matches nothing. */
export function collectMatches(state: EditorState, query: SearchQuery, limit = MAX_FIND_MATCHES): FindMatch[] {
  if (!query.valid) {
    return [];
  }

  const matches: FindMatch[] = [];
  const cursor = query.getCursor(state);

  for (let next = cursor.next(); !next.done && matches.length < limit; next = cursor.next()) {
    const { from, to } = next.value;
    const line = state.doc.lineAt(from);
    // A regexp may run across lines: the preview stops at the end of the first one
    const lineEnd = Math.min(to, line.to);
    matches.push({ from, to, line: line.number, ...buildMatchPreview(line.text, from - line.from, lineEnd - line.from) });
  }

  return matches;
}

/** Index of the match the main selection covers exactly, -1 when the selection is not on a match. */
export function currentMatchIndex(matches: readonly FindMatch[], selection: EditorSelection): number {
  const { from, to } = selection.main;
  return matches.findIndex(match => match.from === from && match.to === to);
}

/** First match starting at or after `pos`, wrapping to the first one; -1 when there is none. */
export function matchIndexFrom(matches: readonly FindMatch[], pos: number): number {
  if (matches.length === 0) {
    return -1;
  }

  const index = matches.findIndex(match => match.from >= pos);
  return index === -1 ? 0 : index;
}
