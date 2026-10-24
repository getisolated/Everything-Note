import { EditorState, Extension, Facet, Prec, StateEffect, StateField, Transaction } from '@codemirror/state';
import { Decoration, DecorationSet, EditorView, ViewPlugin, ViewUpdate, WidgetType, keymap } from '@codemirror/view';
import { TranslationKey } from '../../core/i18n/translations';
import { detectPlatform } from '../../core/services/platform.service';
import { formatAccelerator } from '../../core/utils/accelerator.util';
import { translatorOf } from './translator';
import { BlockRange, noteTimestamps, timestampBlocks } from './note-timestamps';

/** What the quick notes document asks the app to do with one of its notes. */
export interface QuickNoteHandlers {
  save: (id: number, text: string) => void;
  remove: (id: number) => void;
  copy: (text: string) => void;
  /** Turns the quick note into a normal note (it leaves the quick notes document). */
  convert: (id: number) => void;
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
  convert: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/><path d="M12 18v-6"/><path d="M9 15h6"/>',
  remove: '<path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/>',
};

interface ToolbarButton {
  icon: keyof typeof ICONS;
  titleKey: TranslationKey;
  run: (view: EditorView, range: BlockRange) => void;
  danger?: boolean;
}

const READ_BUTTONS: ToolbarButton[] = [
  { icon: 'copy', titleKey: 'common.copy', run: (view, range) => view.state.facet(handlersFacet)?.copy(blockText(view.state, range)) },
  { icon: 'edit', titleKey: 'editor.quickNote.edit', run: edit },
  { icon: 'convert', titleKey: 'editor.quickNote.convert', run: (view, range) => view.state.facet(handlersFacet)?.convert(range.id) },
  { icon: 'remove', titleKey: 'common.delete', danger: true, run: (view, range) => view.state.facet(handlersFacet)?.remove(range.id) },
];

/** Discord-like actions over the hovered note (copy / edit / convert / delete); the edited note has its own buttons below it. */
const actionsToolbar = ViewPlugin.fromClass(class {
  private readonly dom = document.createElement('div');
  private hovered: number | null = null;
  /** Block the buttons were drawn for: redrawn only when that changes. */
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
      // The layout can't be read during an update: an exception there would disable the plugin for good
      this.view.requestMeasure({ key: this, read: () => this.render() });
    }
  }

  private render(): void {
    // No actions while a note is edited: its own buttons are the only ones
    const target = editingQuickNote(this.view.state) === null ? this.hovered : null;
    const range = target === null ? undefined : timestampBlocks(this.view.state).find(block => block.id === target);

    if (!range) {
      this.dom.hidden = true;
      this.drawn = '';
      return;
    }

    // The language is part of the key: the titles are redrawn when it changes
    const key = `${range.id}:${translatorOf(this.view.state)('common.copy')}`;
    if (key !== this.drawn) {
      this.draw(range, READ_BUTTONS);
      this.drawn = key;
    }
    this.place(range);
  }

  private draw(range: BlockRange, buttons: ToolbarButton[]): void {
    this.dom.replaceChildren(...buttons.map(button => {
      const element = document.createElement('button');
      const title = translatorOf(this.view.state)(button.titleKey);
      element.type = 'button';
      element.title = title;
      element.setAttribute('aria-label', title);
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

/** Cancel / Save buttons under the edited note, like Discord's message edit. */
class EditBarWidget extends WidgetType {
  override eq(): boolean {
    return true;
  }

  override toDOM(view: EditorView): HTMLElement {
    const bar = document.createElement('div');
    bar.className = 'cm-quick-note-edit-bar';
    // The buttons must not take the focus from the editor: leaving it would save the note
    bar.addEventListener('mousedown', event => event.preventDefault());
    const t = translatorOf(view.state);
    bar.append(
      this.button(t('common.cancel'), 'Escape', 'cm-quick-note-edit-button', () => cancel(view)),
      // Same key as the `Mod-Enter` binding: Ctrl+Enter, or ⌘↩ on macOS
      this.button(t('common.save'), formatAccelerator('CommandOrControl+Return', detectPlatform(navigator)), 'cm-quick-note-edit-button primary', () => commit(view)),
    );
    return bar;
  }

  private button(label: string, shortcut: string, className: string, run: () => void): HTMLButtonElement {
    const element = document.createElement('button');
    element.type = 'button';
    element.className = className;
    element.textContent = label;
    element.title = `${label} (${shortcut})`;
    element.addEventListener('click', run);
    return element;
  }
}

const editedLine = Decoration.line({ class: 'cm-quick-note-editing' });
const editedFirstLine = Decoration.line({ class: 'cm-quick-note-editing cm-quick-note-editing-first' });
const editedLastLine = Decoration.line({ class: 'cm-quick-note-editing cm-quick-note-editing-last' });
const editedSingleLine = Decoration.line({ class: 'cm-quick-note-editing cm-quick-note-editing-first cm-quick-note-editing-last' });
const editBar = Decoration.widget({ widget: new EditBarWidget(), block: true, side: 1 });

/** Frames the lines of the edited note and adds the edit buttons below it. */
function editDecorations(state: EditorState): DecorationSet {
  const range = editedRange(state);

  if (!range) {
    return Decoration.none;
  }

  const first = state.doc.lineAt(range.from).number;
  const last = state.doc.lineAt(range.to).number;
  const decorations = [];

  for (let number = first; number <= last; number++) {
    const line = number === first
      ? (number === last ? editedSingleLine : editedFirstLine)
      : (number === last ? editedLastLine : editedLine);
    decorations.push(line.range(state.doc.line(number).from));
  }
  decorations.push(editBar.range(range.to));
  return Decoration.set(decorations);
}

/** Left offset of the text column (see `noteTimestampsTheme`), minus the frame's border and padding. */
const FRAME_LEFT = '141px';

const quickNotesTheme = EditorView.baseTheme({
  // Doubled class: wins over the timestamp column's padding
  '.cm-line.cm-quick-note-editing.cm-quick-note-editing': {
    marginLeft: FRAME_LEFT,
    padding: '0 10px 0 8px',
    background: 'var(--daftr-bg-input)',
    borderLeft: '1px solid var(--daftr-border)',
    borderRight: '1px solid var(--daftr-border)',
  },
  '.cm-line.cm-quick-note-editing-first': {
    paddingTop: '6px',
    borderTop: '1px solid var(--daftr-border)',
    borderTopLeftRadius: '6px',
    borderTopRightRadius: '6px',
  },
  '.cm-line.cm-quick-note-editing-last': {
    paddingBottom: '6px',
    borderBottom: '1px solid var(--daftr-border)',
    borderBottomLeftRadius: '6px',
    borderBottomRightRadius: '6px',
  },
  '.cm-quick-note-edit-bar': {
    display: 'flex',
    justifyContent: 'flex-end',
    gap: '8px',
    marginLeft: FRAME_LEFT,
    padding: '6px 0 8px',
  },
  '.cm-quick-note-edit-button': {
    padding: '6px 14px',
    border: '1px solid var(--daftr-border)',
    borderRadius: '4px',
    background: 'transparent',
    color: 'var(--daftr-text)',
    fontSize: '12px',
    cursor: 'pointer',
  },
  '.cm-quick-note-edit-button:hover': {
    background: 'rgba(var(--daftr-hover-rgb), 0.08)',
  },
  '.cm-quick-note-edit-button.primary': {
    borderColor: 'var(--daftr-accent-strong)',
    background: 'var(--daftr-accent-strong)',
    color: 'var(--daftr-text-bright)',
  },
  '.cm-quick-note-edit-button.primary:hover': {
    background: 'var(--daftr-accent-hover)',
  },
  '.cm-quick-note-actions': {
    position: 'absolute',
    zIndex: '5',
    display: 'flex',
    gap: '2px',
    padding: '2px',
    background: 'var(--daftr-bg-menu)',
    border: '1px solid var(--daftr-border)',
    borderRadius: '6px',
    boxShadow: '0 2px 8px rgba(0, 0, 0, 0.25)',
  },
  // `display: flex` above would otherwise override the `hidden` attribute
  '.cm-quick-note-actions[hidden]': {
    display: 'none',
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
    color: 'var(--daftr-text-soft)',
    cursor: 'pointer',
  },
  '.cm-quick-note-action:hover': {
    background: 'rgba(var(--daftr-hover-rgb), 0.08)',
    color: 'var(--daftr-text)',
  },
  '.cm-quick-note-action.danger:hover': {
    color: 'var(--daftr-danger)',
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
    EditorView.decorations.compute([editingField, noteTimestamps], editDecorations),
    Prec.highest(keymap.of([
      { key: 'Escape', run: cancel },
      { key: 'Mod-Enter', run: commit },
    ])),
    EditorView.domEventHandlers({ blur: (_event, view) => { commit(view); } }),
    actionsToolbar,
    quickNotesTheme,
  ];
}
