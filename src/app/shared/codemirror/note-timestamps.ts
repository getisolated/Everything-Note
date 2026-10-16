import { EditorState, RangeSetBuilder, StateEffect, StateField, Text } from '@codemirror/state';
import { Decoration, DecorationSet, EditorView, WidgetType } from '@codemirror/view';

export interface TimestampedBlock {
  /** Id of the note shown by the block. */
  id: number;
  /** Text of the note, as it appears in the document. */
  text: string;
  /** Already formatted timestamp. */
  label: string;
}

/** Where a block sits in the document; kept up to date through the edits. */
export interface BlockRange {
  id: number;
  label: string;
  from: number;
  to: number;
}

/** Separator between two notes in the concatenated document: one blank line. */
export const NOTE_SEPARATOR = '\n\n';

/** Builds the document text for the blocks (their offsets are what `setTimestampBlocks` decorates). */
export function joinBlocks(blocks: TimestampedBlock[]): string {
  return blocks.map(block => block.text).join(NOTE_SEPARATOR);
}

/** Offsets of each block in the text built by `joinBlocks`. */
export function blockRanges(blocks: TimestampedBlock[]): BlockRange[] {
  let offset = 0;
  return blocks.map(block => {
    const range = { id: block.id, label: block.label, from: offset, to: offset + block.text.length };
    offset = range.to + NOTE_SEPARATOR.length;
    return range;
  });
}

class TimestampWidget extends WidgetType {
  constructor(private readonly label: string) {
    super();
  }

  override eq(other: TimestampWidget): boolean {
    return other.label === this.label;
  }

  override toDOM(): HTMLElement {
    const element = document.createElement('span');
    element.className = 'cm-note-time';
    element.textContent = this.label;
    return element;
  }
}

const firstLine = Decoration.line({ class: 'cm-note-first' });
const otherLine = Decoration.line({ class: 'cm-note-rest' });

function buildDecorations(doc: Text, ranges: BlockRange[]): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>();
  for (const range of ranges) {
    const start = doc.lineAt(range.from);
    builder.add(start.from, start.from, firstLine);
    builder.add(start.from, start.from, Decoration.widget({ widget: new TimestampWidget(range.label), side: -1 }));
    for (let line = start.number + 1; line <= doc.lineAt(range.to).number; line++) {
      const from = doc.line(line).from;
      builder.add(from, from, otherLine);
    }
  }
  return builder.finish();
}

/** Dispatch together with the document change: the blocks describe the NEW document. */
export const setTimestampBlocks = StateEffect.define<TimestampedBlock[]>();

interface TimestampState {
  ranges: BlockRange[];
  decorations: DecorationSet;
}

const timestampState = StateField.define<TimestampState>({
  create: () => ({ ranges: [], decorations: Decoration.none }),
  update(value, transaction) {
    for (const effect of transaction.effects) {
      if (effect.is(setTimestampBlocks)) {
        const ranges = blockRanges(effect.value);
        return { ranges, decorations: buildDecorations(transaction.newDoc, ranges) };
      }
    }

    if (!transaction.docChanged) {
      return value;
    }

    // Text typed at either end of a block (while editing it) belongs to that block
    const ranges = value.ranges.map(range => ({
      ...range,
      from: transaction.changes.mapPos(range.from, -1),
      to: transaction.changes.mapPos(range.to, 1),
    }));
    return { ranges, decorations: buildDecorations(transaction.newDoc, ranges) };
  },
  provide: field => EditorView.decorations.from(field, value => value.decorations),
});

/** The blocks of the document, where they are now. */
export function timestampBlocks(state: EditorState): BlockRange[] {
  return state.field(timestampState, false)?.ranges ?? [];
}

/** Decorations drawn for the blocks (exposed for the tests). */
export function timestampDecorations(state: EditorState): DecorationSet {
  return state.field(timestampState, false)?.decorations ?? Decoration.none;
}

/**
 * Shows each note's timestamp, muted, to the left of its first line; wrapped and following lines keep the
 * same left indent so the notes read as an aligned column.
 */
export const noteTimestamps = timestampState;

export const noteTimestampsTheme = EditorView.baseTheme({
  '.cm-line.cm-note-first': { paddingLeft: '150px', textIndent: '-150px' },
  '.cm-line.cm-note-rest': { paddingLeft: '150px' },
  '.cm-note-time': {
    display: 'inline-block',
    width: '150px',
    textIndent: '0',
    color: 'var(--evn-syntax-timestamp)',
    // Not the text I-beam: the timestamp is not part of the text
    cursor: 'default',
    userSelect: 'none',
    fontSize: '11px',
    verticalAlign: 'baseline',
  },
});
