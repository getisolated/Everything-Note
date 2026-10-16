import {
  ViewPlugin, ViewUpdate, Decoration, DecorationSet, EditorView
} from '@codemirror/view';
import { Facet, RangeSetBuilder } from '@codemirror/state';
import { LinkStatus } from '../../core/utils/note-paths.util';
import { syntaxTree } from '@codemirror/language';
import { CheckboxWidget, EXTERNAL_URL, ExternalLinkWidget } from './markdown-widgets';

// Check if cursor is within [from, to]
function cursorInRange(view: EditorView, from: number, to: number): boolean {
  for (const sel of view.state.selection.ranges) {
    if (sel.from <= to && sel.to >= from) return true;
  }
  return false;
}

/** Tells the decorations whether a link target exists: a local link pointing to nothing is shown in red. */
export const linkStatusFacet = Facet.define<(target: string) => LinkStatus, (target: string) => LinkStatus>({
  combine: values => values[0] ?? ((): LinkStatus => 'note'),
});

const linkMark = Decoration.mark({ class: 'cm-md-link' });
const brokenLinkMark = Decoration.mark({ class: 'cm-md-link cm-md-link-broken', attributes: { title: 'Link target not found' } });

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
        case 'Link': {
          const target = node.node.getChild('URL');
          const broken = target !== null && view.state.facet(linkStatusFacet)(doc.sliceString(target.from, target.to)) === 'broken';
          pending.push({ from, to, deco: broken ? brokenLinkMark : linkMark });

          // Off the link, only its label shows: `[` and `](target)` are hidden, like the other marks
          if (!cursorInRange(view, from, to)) {
            const marks: { from: number; to: number }[] = [];

            for (let child = node.node.firstChild; child; child = child.nextSibling) {
              if (child.name === 'LinkMark') {
                marks.push({ from: child.from, to: child.to });
              }
            }

            const open = marks[0];
            const close = marks[1];

            if (open && close && open.to < close.from) {
              pending.push({ from: open.from, to: open.to, deco: Decoration.replace({}) });
              pending.push({ from: close.from, to, deco: Decoration.replace({}) });

              // An external target (not a local note) is flagged with an icon after the label
              const urlNode = node.node.getChild('URL');

              if (urlNode && EXTERNAL_URL.test(doc.sliceString(urlNode.from, urlNode.to))) {
                pending.push({ from: to, to, deco: Decoration.widget({ widget: new ExternalLinkWidget(), side: 1 }) });
              }
            }
          }

          break;
        }
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
    // Point widgets (from === to, e.g. the external link icon) never overlap anything
    if (deco.spec?.widget && from !== to && from < lastTo) continue;
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
      const linksChanged = update.startState.facet(linkStatusFacet) !== update.state.facet(linkStatusFacet);
      if (update.docChanged || update.selectionSet || update.viewportChanged || linksChanged) {
        this.decorations = buildDecorations(update.view);
      }
    }
  },
  { decorations: v => v.decorations }
);

// Theme for markdown decorations
// Colors come from the theme tokens (see styles.scss)
export const markdownDecorationTheme = EditorView.baseTheme({
  '.cm-md-h1': {
    fontSize: '1.6em',
    fontWeight: '700',
    lineHeight: '1.3',
    color: 'var(--evn-syntax-heading) !important',
  },
  '.cm-md-h2': {
    fontSize: '1.35em',
    fontWeight: '700',
    color: 'var(--evn-syntax-heading) !important',
  },
  '.cm-md-h3': {
    fontSize: '1.15em',
    fontWeight: '600',
    color: 'var(--evn-syntax-heading) !important',
  },
  '.cm-md-h4': {
    fontSize: '1em',
    fontWeight: '600',
    color: 'var(--evn-syntax-heading) !important',
  },
  '.cm-md-mark-hidden': {
    color: 'var(--evn-syntax-mark-hidden) !important',
    fontSize: '0.75em',
  },
  '.cm-md-mark-dim': {
    color: 'var(--evn-syntax-mark-dim) !important',
    opacity: '0.5',
  },
  '.cm-md-bold': {
    fontWeight: '700',
    color: 'var(--evn-syntax-bold)',
  },
  '.cm-md-italic': {
    fontStyle: 'italic',
    color: 'var(--evn-syntax-italic)',
  },
  '.cm-md-strike': {
    textDecoration: 'line-through',
    color: 'var(--evn-syntax-strike)',
  },
  '.cm-md-inline-code': {
    fontFamily: 'Consolas, "Courier New", monospace',
    fontSize: '0.88em',
    background: 'var(--evn-bg-chip)',
    borderRadius: '3px',
    padding: '0 3px',
    color: 'var(--evn-syntax-code)',
  },
  '.cm-md-code-block': {
    fontFamily: 'Consolas, "Courier New", monospace',
    fontSize: '0.88em',
  },
  '.cm-md-hr': {
    color: 'var(--evn-border-soft)',
    borderBottom: '1px solid var(--evn-border-soft)',
    display: 'block',
  },
  '.cm-md-blockquote': {
    borderLeft: '3px solid var(--evn-syntax-quote)',
    paddingLeft: '8px',
    color: 'var(--evn-syntax-quote)',
    fontStyle: 'italic',
  },
  '.cm-md-link.cm-md-link-broken, .cm-md-link.cm-md-link-broken *': {
    color: 'var(--evn-danger) !important',
  },
  '.cm-md-link': {
    color: 'var(--evn-syntax-link)',
    textDecoration: 'underline',
  },
  '.cm-external-link-icon': {
    display: 'inline-block',
    verticalAlign: 'middle',
    marginLeft: '2px',
    color: 'var(--evn-syntax-link)',
    opacity: '0.7',
    userSelect: 'none',
    pointerEvents: 'none',
  },
  '.cm-checkbox-wrap': {
    display: 'inline-flex',
    alignItems: 'center',
    verticalAlign: 'middle',
    marginRight: '4px',
  },
  '.cm-task-checkbox': {
    accentColor: 'var(--evn-accent)',
    width: '14px',
    height: '14px',
    cursor: 'pointer',
    margin: '0',
  },
  '.cm-bullet-todo': {
    color: 'var(--evn-text-dimmed)',
    cursor: 'pointer',
    fontFamily: 'monospace',
    '&:hover': { color: 'var(--evn-text)' },
  },
  '.cm-bullet-done': {
    color: 'var(--evn-syntax-comment)',
    cursor: 'pointer',
    fontFamily: 'monospace',
    '&:hover': { color: 'var(--evn-text)' },
  },
  '.cm-hidden-mark': {
    display: 'none',
  },
});
