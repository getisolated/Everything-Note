import {
  ViewPlugin, ViewUpdate, Decoration, DecorationSet, EditorView
} from '@codemirror/view';
import { RangeSetBuilder } from '@codemirror/state';
import { syntaxTree } from '@codemirror/language';
import { CheckboxWidget } from './markdown-widgets';

// Check if cursor is within [from, to]
function cursorInRange(view: EditorView, from: number, to: number): boolean {
  for (const sel of view.state.selection.ranges) {
    if (sel.from <= to && sel.to >= from) return true;
  }
  return false;
}

interface PendingDeco {
  from: number;
  to: number;
  deco: Decoration;
}

function buildDecorations(view: EditorView): DecorationSet {
  const pending: PendingDeco[] = [];
  const doc = view.state.doc;
  const tree = syntaxTree(view.state);

  tree.iterate({
    enter(node) {
      const { from, to, name } = node;
      const inCursor = cursorInRange(view, from, to);

      switch (name) {
        // ── Headings ──────────────────────────────────────────────
        case 'ATXHeading1':
          pending.push({ from, to, deco: Decoration.mark({ class: 'cm-md-h1' }) });
          break;
        case 'ATXHeading2':
          pending.push({ from, to, deco: Decoration.mark({ class: 'cm-md-h2' }) });
          break;
        case 'ATXHeading3':
          pending.push({ from, to, deco: Decoration.mark({ class: 'cm-md-h3' }) });
          break;
        case 'ATXHeading4':
        case 'ATXHeading5':
        case 'ATXHeading6':
          pending.push({ from, to, deco: Decoration.mark({ class: 'cm-md-h4' }) });
          break;

        // ── Heading marks (hide # when cursor not on heading) ─────
        case 'HeaderMark': {
          const heading = node.node.parent;
          if (heading && !cursorInRange(view, heading.from, heading.to)) {
            const end = (to < doc.length && doc.sliceString(to, to + 1) === ' ') ? to + 1 : to;
            pending.push({ from, to: end, deco: Decoration.replace({}) });
          } else {
            pending.push({ from, to, deco: Decoration.mark({ class: 'cm-md-mark-dim' }) });
          }
          break;
        }

        // ── Bold ──────────────────────────────────────────────────
        case 'StrongEmphasis':
          pending.push({ from, to, deco: Decoration.mark({ class: 'cm-md-bold' }) });
          break;

        // ── Italic ────────────────────────────────────────────────
        case 'Emphasis':
          pending.push({ from, to, deco: Decoration.mark({ class: 'cm-md-italic' }) });
          break;

        // ── Emphasis marks (hide * or ** when cursor not in range) ─
        case 'EmphasisMark': {
          const emParent = node.node.parent;
          if (emParent && !cursorInRange(view, emParent.from, emParent.to)) {
            pending.push({ from, to, deco: Decoration.replace({}) });
          } else {
            pending.push({ from, to, deco: Decoration.mark({ class: 'cm-md-mark-dim' }) });
          }
          break;
        }

        // ── Strikethrough ─────────────────────────────────────────
        case 'Strikethrough':
          pending.push({ from, to, deco: Decoration.mark({ class: 'cm-md-strike' }) });
          break;

        // ── Strikethrough marks (hide ~~ when cursor not in range)
        case 'StrikethroughMark': {
          const stParent = node.node.parent;
          if (stParent && !cursorInRange(view, stParent.from, stParent.to)) {
            pending.push({ from, to, deco: Decoration.replace({}) });
          } else {
            pending.push({ from, to, deco: Decoration.mark({ class: 'cm-md-mark-dim' }) });
          }
          break;
        }

        // ── Inline code ───────────────────────────────────────────
        case 'InlineCode':
          pending.push({ from, to, deco: Decoration.mark({ class: 'cm-md-inline-code' }) });
          break;

        // ── Code marks (hide ` when cursor not in inline code) ────
        case 'CodeMark': {
          const cmParent = node.node.parent;
          if (cmParent && cmParent.name === 'InlineCode' && !cursorInRange(view, cmParent.from, cmParent.to)) {
            pending.push({ from, to, deco: Decoration.replace({}) });
          } else if (cmParent && cmParent.name === 'InlineCode') {
            pending.push({ from, to, deco: Decoration.mark({ class: 'cm-md-mark-dim' }) });
          }
          break;
        }

        // ── Code block ────────────────────────────────────────────
        case 'FencedCode':
          pending.push({ from, to, deco: Decoration.mark({ class: 'cm-md-code-block' }) });
          break;

        // ── Horizontal rule ───────────────────────────────────────
        case 'HorizontalRule':
          pending.push({ from, to, deco: Decoration.mark({ class: 'cm-md-hr' }) });
          break;

        // ── Blockquote ────────────────────────────────────────────
        case 'Blockquote':
          pending.push({ from, to, deco: Decoration.mark({ class: 'cm-md-blockquote' }) });
          break;

        // ── Quote marks (hide > when cursor not on the line) ──────
        case 'QuoteMark': {
          const qline = doc.lineAt(from);
          if (!cursorInRange(view, qline.from, qline.to)) {
            const end = (to < doc.length && doc.sliceString(to, to + 1) === ' ') ? to + 1 : to;
            pending.push({ from, to: end, deco: Decoration.replace({}) });
          } else {
            pending.push({ from, to, deco: Decoration.mark({ class: 'cm-md-mark-dim' }) });
          }
          break;
        }

        // ── Links ─────────────────────────────────────────────────
        case 'Link':
          pending.push({ from, to, deco: Decoration.mark({ class: 'cm-md-link' }) });
          break;
      }
    }
  });

  // ── Task list items via regex ─────────────────────────────────────────────
  const text = doc.toString();
  const taskRegex = /^(\s*(?:[-*+]\s+)?)((\[ \]|\[x\]|\( \)|\(x\)))\s/gm;
  let match: RegExpExecArray | null;

  while ((match = taskRegex.exec(text)) !== null) {
    const prefixEnd = match.index + match[1].length;
    const markerStart = prefixEnd;
    const markerEnd = markerStart + 3; // [ ] or [x] or ( ) or (x)
    const isChecked = match[3] === '[x]' || match[3] === '(x)';
    const syntax = (match[3].startsWith('[') ? '[]' : '()') as '[]' | '()';

    pending.push({
      from: markerStart,
      to: markerEnd,
      deco: Decoration.replace({
        widget: new CheckboxWidget(isChecked, markerStart, syntax)
      })
    });
  }

  // Sort by from position (required by RangeSetBuilder)
  pending.sort((a, b) => a.from - b.from || a.to - b.to);

  // Deduplicate overlapping replacements
  const builder = new RangeSetBuilder<Decoration>();
  let lastTo = -1;
  for (const { from, to, deco } of pending) {
    // Skip overlapping ranges for replace decorations
    if (deco.spec?.widget && from < lastTo) continue;
    try {
      builder.add(from, to, deco);
      if (to > lastTo) lastTo = to;
    } catch { /* skip conflicting ranges */ }
  }

  return builder.finish();
}

export const markdownDecorationPlugin = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;

    constructor(view: EditorView) {
      this.decorations = buildDecorations(view);
    }

    update(update: ViewUpdate) {
      if (update.docChanged || update.selectionSet || update.viewportChanged) {
        this.decorations = buildDecorations(update.view);
      }
    }
  },
  { decorations: v => v.decorations }
);

// Theme for markdown decorations
// VS Code "Default Dark Modern" token colors
export const markdownDecorationTheme = EditorView.baseTheme({
  '.cm-md-h1': {
    fontSize: '1.6em',
    fontWeight: '700',
    lineHeight: '1.3',
    color: '#569cd6 !important',
  },
  '.cm-md-h2': {
    fontSize: '1.35em',
    fontWeight: '700',
    color: '#569cd6 !important',
  },
  '.cm-md-h3': {
    fontSize: '1.15em',
    fontWeight: '600',
    color: '#569cd6 !important',
  },
  '.cm-md-h4': {
    fontSize: '1em',
    fontWeight: '600',
    color: '#569cd6 !important',
  },
  '.cm-md-mark-hidden': {
    color: '#3e4a57 !important',
    fontSize: '0.75em',
  },
  '.cm-md-mark-dim': {
    color: '#4a5568 !important',
    opacity: '0.5',
  },
  '.cm-md-bold': {
    fontWeight: '700',
    color: '#569cd6',
  },
  '.cm-md-italic': {
    fontStyle: 'italic',
    color: '#569cd6',
  },
  '.cm-md-strike': {
    textDecoration: 'line-through',
    color: '#6a6a6a',
  },
  '.cm-md-inline-code': {
    fontFamily: 'Consolas, "Courier New", monospace',
    fontSize: '0.88em',
    background: '#2d2d2d',
    borderRadius: '3px',
    padding: '0 3px',
    color: '#ce9178',
  },
  '.cm-md-code-block': {
    fontFamily: 'Consolas, "Courier New", monospace',
    fontSize: '0.88em',
  },
  '.cm-md-hr': {
    color: '#3e3e3e',
    borderBottom: '1px solid #3e3e3e',
    display: 'block',
  },
  '.cm-md-blockquote': {
    borderLeft: '3px solid #6a9955',
    paddingLeft: '8px',
    color: '#6a9955',
    fontStyle: 'italic',
  },
  '.cm-md-link': {
    color: '#3794ff',
    textDecoration: 'underline',
  },
  '.cm-checkbox-wrap': {
    display: 'inline-flex',
    alignItems: 'center',
    verticalAlign: 'middle',
    marginRight: '4px',
  },
  '.cm-task-checkbox': {
    accentColor: '#007acc',
    width: '14px',
    height: '14px',
    cursor: 'pointer',
    margin: '0',
  },
  '.cm-bullet-todo': {
    color: '#858585',
    cursor: 'pointer',
    fontFamily: 'monospace',
    '&:hover': { color: '#cccccc' },
  },
  '.cm-bullet-done': {
    color: '#6a9955',
    cursor: 'pointer',
    fontFamily: 'monospace',
    '&:hover': { color: '#cccccc' },
  },
  '.cm-hidden-mark': {
    display: 'none',
  },
});
