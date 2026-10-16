import { EditorState, Extension, Facet, Prec, StateEffect, StateField, Transaction } from '@codemirror/state';
import { EditorView, ViewPlugin, ViewUpdate, keymap } from '@codemirror/view';
import { BlockRange, timestampBlocks } from './note-timestamps';

/** What the quick notes document asks the app to do with one of its notes. */
export interface QuickNoteHandlers {
  save: (id: number, text: string) => void;
  remove: (id: number) => void;
  copy: (text: string) => void;
  /** An edit ended (saved or cancelled): the document can follow the notes again. */
  editEnded: () => void;
}

const handlersFacet = Facet.define<QuickNoteHandlers, QuickNoteHandlers | null>({ combine: values => values[0] ?? null });

interface Editing {
  id: number;
  /** Text of the note when the edit started: what Escape restores. */
  original: string;
}

const startEditing = StateEffect.define<Editing>();
const stopEditing = StateEffect.define<null>();

const editingField = StateField.define<Editing | null>({
  create: () => null,
  update(value, transaction) {
    for (const effect of transaction.effects) {
      if (effect.is(startEditing)) {
        value = effect.value;
      } else if (effect.is(stopEditing)) {
        value = null;
      }
    }
    return value;
  },
});

/** Id of the note being edited, null while the document is only read. */
export function editingQuickNote(state: EditorState): number | null {
  return state.field(editingField, false)?.id ?? null;
}

function editedRange(state: EditorState): BlockRange | undefined {
  const id = editingQuickNote(state);
  return id === null ? undefined : timestampBlocks(state).find(range => range.id === id);
}

/** True when every change of the transaction stays inside the block being edited. */
export function changesStayInBlock(transaction: Transaction, range: BlockRange): boolean {
  let inside = true;
  transaction.changes.iterChangedRanges((fromA, toA) => {
    inside &&= fromA >= range.from && toA <= range.to;
  });
  return inside;
}

/** Only the block being edited accepts changes; the document refresh dispatches with `filter: false`. */
const editGuard = EditorState.changeFilter.of(transaction => {
  const range = editedRange(transaction.startState);
  return range !== undefined && changesStayInBlock(transaction, range);
});

function blockText(state: EditorState, range: BlockRange): string {
  return state.sliceDoc(range.from, range.to);
}

function edit(view: EditorView, range: BlockRange): void {
  // Another note was being edited: it is saved first, like when leaving the editor
  if (editingQuickNote(view.state) !== null) {
    commit(view);
  }

  view.dispatch({
    effects: startEditing.of({ id: range.id, original: blockText(view.state, range) }),
    selection: { anchor: range.to },
  });
  view.focus();
}

/** Saves the edited note; emptied, it is restored instead (deleting is an explicit action). */
function commit(view: EditorView): boolean {
  const editing = view.state.field(editingField, false);
  const range = editedRange(view.state);

  if (!editing || !range) {
    return false;
  }

  const text = blockText(view.state, range).trim();

  if (!text) {
    return cancel(view);
  }

  view.dispatch({ effects: stopEditing.of(null) });

  const handlers = view.state.facet(handlersFacet);
  if (text !== editing.original.trim()) {
    handlers?.save(editing.id, text);
  }
  handlers?.editEnded();
  return true;
}

function cancel(view: EditorView): boolean {
  const editing = view.state.field(editingField, false);
  const range = editedRange(view.state);

  if (!editing || !range) {
    return false;
  }

  view.dispatch({ changes: { from: range.from, to: range.to, insert: editing.original }, effects: stopEditing.of(null) });
  view.state.facet(handlersFacet)?.editEnded();
  return true;
}

const ICONS = {
  copy: '<rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>',
  edit: '<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/>',
  remove: '<path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/>',
  save: '<path d="M20 6 9 17l-5-5"/>',
  cancel: '<path d="M18 6 6 18M6 6l12 12"/>',
};

interface ToolbarButton {
  icon: keyof typeof ICONS;
  title: string;
  run: (view: EditorView, range: BlockRange) => void;
  danger?: boolean;
}

const READ_BUTTONS: ToolbarButton[] = [
  { icon: 'copy', title: 'Copy', run: (view, range) => view.state.facet(handlersFacet)?.copy(blockText(view.state, range)) },
  { icon: 'edit', title: 'Edit', run: edit },
  { icon: 'remove', title: 'Delete', danger: true, run: (view, range) => view.state.facet(handlersFacet)?.remove(range.id) },
];

const EDIT_BUTTONS: ToolbarButton[] = [
  { icon: 'save', title: 'Save (Ctrl+Enter)', run: view => commit(view) },
  { icon: 'cancel', title: 'Cancel (Escape)', run: view => cancel(view) },
];

/** Discord-like actions over the hovered note (copy / edit / delete), or save / cancel over the one being edited. */
const actionsToolbar = ViewPlugin.fromClass(class {
  private readonly dom = document.createElement('div');
  private hovered: number | null = null;
  /** Block the buttons were drawn for, and in which mode: redrawn only when that changes. */
  private drawn = '';

  private readonly onMove = (event: MouseEvent): void => {
    const pos = this.view.posAtCoords({ x: event.clientX, y: event.clientY }, false);
    this.hovered = timestampBlocks(this.view.state).find(range => pos >= range.from && pos <= range.to)?.id ?? null;
    this.render();
  };

  private readonly onLeave = (event: MouseEvent): void => {
    if (!this.dom.contains(event.relatedTarget as Node | null)) {
      this.hovered = null;
      this.render();
    }
  };

  private readonly onScroll = (): void => this.render();

  constructor(private readonly view: EditorView) {
    this.dom.className = 'cm-quick-note-actions';
    this.dom.setAttribute('role', 'toolbar');
    // The buttons must not take the focus (nor the selection) from the editor
    this.dom.addEventListener('mousedown', event => event.preventDefault());
    view.dom.appendChild(this.dom);
    view.contentDOM.addEventListener('mousemove', this.onMove);
    view.dom.addEventListener('mouseleave', this.onLeave);
    view.scrollDOM.addEventListener('scroll', this.onScroll);
    this.render();
  }

  update(update: ViewUpdate): void {
    if (update.docChanged || update.geometryChanged || update.transactions.some(tr => tr.effects.length > 0)) {
      this.render();
    }
  }

  private render(): void {
    const editing = editingQuickNote(this.view.state);
    const target = editing ?? this.hovered;
    const range = target === null ? undefined : timestampBlocks(this.view.state).find(block => block.id === target);

    if (!range) {
      this.dom.hidden = true;
      this.drawn = '';
      return;
    }

    const key = `${range.id}:${editing !== null}`;
    if (key !== this.drawn) {
      this.draw(range, editing !== null ? EDIT_BUTTONS : READ_BUTTONS);
      this.drawn = key;
    }
    this.place(range);
  }

  private draw(range: BlockRange, buttons: ToolbarButton[]): void {
    this.dom.replaceChildren(...buttons.map(button => {
      const element = document.createElement('button');
      element.type = 'button';
      element.title = button.title;
      element.setAttribute('aria-label', button.title);
      element.className = button.danger ? 'cm-quick-note-action danger' : 'cm-quick-note-action';
      element.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${ICONS[button.icon]}</svg>`;
      element.addEventListener('click', () => {
        const current = timestampBlocks(this.view.state).find(block => block.id === range.id);
        if (current) {
          button.run(this.view, current);
        }
      });
      return element;
    }));
  }

  /** Top right of the block's first line, inside the text column. */
  private place(range: BlockRange): void {
    const coords = this.view.coordsAtPos(range.from, 1);

    if (!coords) {
      this.dom.hidden = true;
      return;
    }

    const editorBox = this.view.dom.getBoundingClientRect();
    const contentBox = this.view.contentDOM.getBoundingClientRect();
    this.dom.hidden = false;
    this.dom.style.top = `${Math.max(0, coords.top - editorBox.top - 6)}px`;
    this.dom.style.right = `${Math.max(0, editorBox.right - contentBox.right + 8)}px`;
  }

  destroy(): void {
    this.view.contentDOM.removeEventListener('mousemove', this.onMove);
    this.view.dom.removeEventListener('mouseleave', this.onLeave);
    this.view.scrollDOM.removeEventListener('scroll', this.onScroll);
    this.dom.remove();
  }
});

const quickNotesTheme = EditorView.baseTheme({
  '.cm-quick-note-actions': {
    position: 'absolute',
    zIndex: '5',
    display: 'flex',
    gap: '2px',
    padding: '2px',
    background: 'var(--evn-bg-menu)',
    border: '1px solid var(--evn-border)',
    borderRadius: '6px',
    boxShadow: '0 2px 8px rgba(0, 0, 0, 0.25)',
  },
  '.cm-quick-note-action': {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: '26px',
    height: '24px',
    padding: '0',
    border: 'none',
    borderRadius: '4px',
    background: 'transparent',
    color: 'var(--evn-text-soft)',
    cursor: 'pointer',
  },
  '.cm-quick-note-action:hover': {
    background: 'rgba(var(--evn-hover-rgb), 0.08)',
    color: 'var(--evn-text)',
  },
  '.cm-quick-note-action.danger:hover': {
    color: 'var(--evn-danger)',
  },
});

/**
 * The quick notes document: read-only, except the note whose Edit button was clicked, which is edited in place
 * (Escape cancels, Ctrl+Enter or leaving the editor saves). Requires `noteTimestamps` for the blocks.
 */
export function quickNotesEditing(handlers: QuickNoteHandlers): Extension {
  return [
    handlersFacet.of(handlers),
    editingField,
    editGuard,
    EditorView.editable.compute([editingField], state => state.field(editingField) !== null),
    Prec.highest(keymap.of([
      { key: 'Escape', run: cancel },
      { key: 'Mod-Enter', run: commit },
    ])),
    EditorView.domEventHandlers({ blur: (_event, view) => { commit(view); } }),
    actionsToolbar,
    quickNotesTheme,
  ];
}
