import {
  Component, OnDestroy, OnChanges, Input, SimpleChanges,
  ElementRef, ViewChild, inject, ChangeDetectionStrategy, NgZone, signal
} from '@angular/core';
import { CommonModule } from '@angular/common';

// CodeMirror
import { EditorView, keymap, drawSelection, dropCursor, highlightActiveLine } from '@codemirror/view';
import { EditorState, Extension } from '@codemirror/state';
import {
  defaultKeymap, history, historyKeymap, indentWithTab,
} from '@codemirror/commands';
import { searchKeymap, search, openSearchPanel, closeSearchPanel } from '@codemirror/search';
import { closeBrackets, closeBracketsKeymap } from '@codemirror/autocomplete';
import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
import { languages } from '@codemirror/language-data';
import { bracketMatching, syntaxTree } from '@codemirror/language';

import { vscodeDarkModern } from '../../shared/codemirror/vscode-dark-modern';
import { markdownDecorationPlugin, markdownDecorationTheme } from '../../shared/codemirror/markdown-decorations';
import { NotesService } from '../../core/services/notes.service';
import { TabsService } from '../../core/services/tabs.service';
import { Note } from '../../core/models/note.model';

@Component({
  selector: 'app-editor',
  standalone: true,
  imports: [CommonModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="editor-wrapper">
      @if (activeNote()) {
        <div class="editor-host" #editorHost></div>
      } @else {
        <div class="editor-empty">
          <div class="empty-content">
            <div class="empty-icon">
              <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1">
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
                <polyline points="14 2 14 8 20 8"/>
                <line x1="16" y1="13" x2="8" y2="13"/>
                <line x1="16" y1="17" x2="8" y2="17"/>
                <polyline points="10 9 9 9 8 9"/>
              </svg>
            </div>
            <p class="empty-title">No note open</p>
            <p class="empty-hint">
              Press <kbd>Ctrl+N</kbd> to create a new note<br>
              or <kbd>F1</kbd> to search existing notes
            </p>
          </div>
        </div>
      }
    </div>
  `,
  styleUrls: ['./editor.component.scss'],
})
export class EditorComponent implements OnDestroy, OnChanges {
  @Input() noteId: number | null = null;
  @ViewChild('editorHost') editorHost!: ElementRef<HTMLElement>;

  private notes = inject(NotesService);
  private tabs = inject(TabsService);
  private zone = inject(NgZone);

  readonly activeNote = signal<Note | null>(null);

  private editorView: EditorView | null = null;
  private saveDebounce: ReturnType<typeof setTimeout> | null = null;
  private isUpdatingFromModel = false;
  private loadGeneration = 0;

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['noteId']) {
      this.loadNote(this.noteId);
    }
  }

  ngOnDestroy(): void {
    this.editorView?.destroy();
    if (this.saveDebounce) clearTimeout(this.saveDebounce);
  }

  private async loadNote(id: number | null): Promise<void> {
    const generation = ++this.loadGeneration;

    // Always flush pending save before switching notes
    await this.flushPendingSave();

    // Abort if a newer load was started while flushing
    if (generation !== this.loadGeneration) return;

    if (id === null) {
      this.activeNote.set(null);
      this.destroyEditor();
      return;
    }

    try {
      const note = await this.notes.getById(id);
      // Abort if a newer load was started while fetching
      if (generation !== this.loadGeneration) return;
      this.activeNote.set(note);
      // Wait for DOM to update
      setTimeout(() => {
        if (generation !== this.loadGeneration) return;
        this.initEditor(note?.content ?? '');
      }, 0);
    } catch (err) {
      console.error('[Editor] Failed to load note:', err);
    }
  }

  private async flushPendingSave(): Promise<void> {
    if (this.saveDebounce) {
      clearTimeout(this.saveDebounce);
      this.saveDebounce = null;
      const cur = this.activeNote();
      if (cur && this.editorView) {
        await this.saveNote(cur.id, this.editorView.state.doc.toString());
      }
    }
  }

  private destroyEditor(): void {
    this.editorView?.destroy();
    this.editorView = null;
  }

  private initEditor(content: string): void {
    this.destroyEditor();
    if (!this.editorHost?.nativeElement) return;

    const updateListener = EditorView.updateListener.of(update => {
      if (update.docChanged && !this.isUpdatingFromModel) {
        const content = update.state.doc.toString();
        const note = this.activeNote();
        if (!note) return;

        // Extract title from first line
        const title = this.notes.extractTitle(content);
        this.tabs.updateTitle(note.id, title || 'Untitled');
        this.tabs.markDirty(note.id, true);

        // Debounce auto-save (1s)
        if (this.saveDebounce) clearTimeout(this.saveDebounce);
        this.saveDebounce = setTimeout(() => {
          this.zone.run(() => this.saveNote(note.id, content));
        }, 1000);
      }
    });

    const evnoteTheme = EditorView.theme({
      '&': {
        height: '100%',
        background: '#1e1e1e',
        color: '#cccccc',
        fontSize: '14px',
        fontFamily: 'Consolas, "Courier New", monospace',
      },
      '.cm-content': {
        padding: '32px 48px',
        minHeight: '100%',
        caretColor: '#aeafad',
        maxWidth: '780px',
        margin: '0 auto',
      },
      '.cm-scroller': {
        fontFamily: 'Consolas, "Courier New", monospace',
        lineHeight: '1.65',
        overflow: 'auto',
      },
      '.cm-line': {
        padding: '0',
      },
      '&.cm-focused .cm-cursor': {
        borderLeftColor: '#aeafad',
      },
      '&.cm-focused .cm-selectionBackground, .cm-selectionBackground': {
        background: '#264f78',
      },
      '.cm-activeLine': {
        background: 'rgba(255,255,255,0.02)',
      },
      '.cm-gutters': { display: 'none' },
      '.cm-search': {
        background: '#2d2d2d',
        border: '1px solid #454545',
        borderRadius: '4px',
      },
    }, { dark: true });

    // Returns true if cursor is inside a fenced code block
    function isInCodeBlock(view: EditorView): boolean {
      const pos = view.state.selection.main.head;
      let node = syntaxTree(view.state).resolveInner(pos, -1);
      while (node.parent) {
        if (node.name === 'FencedCode' || node.name === 'InlineCode') return true;
        node = node.parent;
      }
      return false;
    }

    const extensions: Extension[] = [
      history(),
      closeBrackets(),
      markdown({
        base: markdownLanguage,
        codeLanguages: languages,
      }),
      vscodeDarkModern,
      evnoteTheme,
      markdownDecorationTheme,
      markdownDecorationPlugin,
      drawSelection(),
      dropCursor(),
      highlightActiveLine(),
      bracketMatching(),
      search({ top: false }),
      keymap.of([
        ...closeBracketsKeymap,
        ...defaultKeymap,
        ...historyKeymap,
        ...searchKeymap,
        indentWithTab,
        // Enter between matching pairs inside code blocks: expand to indented block
        {
          key: 'Enter',
          run(view) {
            if (!isInCodeBlock(view)) return false;
            const sel = view.state.selection.main;
            if (!sel.empty) return false;
            const { from } = sel;
            const before = view.state.sliceDoc(from - 1, from);
            const after = view.state.sliceDoc(from, from + 1);
            const pairs: Record<string, string> = { '{': '}', '(': ')', '[': ']' };
            if (!pairs[before] || pairs[before] !== after) return false;
            const line = view.state.doc.lineAt(from);
            const indent = line.text.match(/^(\s*)/)?.[1] ?? '';
            const innerIndent = indent + '  ';
            view.dispatch({
              changes: { from, to: from, insert: `\n${innerIndent}\n${indent}` },
              selection: { anchor: from + innerIndent.length + 1 },
            });
            return true;
          }
        },
        // Bold: Ctrl+B
        {
          key: 'Ctrl-b',
          run(view) {
            const sel = view.state.selection.main;
            const selected = view.state.sliceDoc(sel.from, sel.to);
            view.dispatch({
              changes: { from: sel.from, to: sel.to, insert: `**${selected}**` },
              selection: { anchor: sel.from + 2, head: sel.to + 2 },
            });
            return true;
          }
        },
        // Italic: Ctrl+I
        {
          key: 'Ctrl-i',
          run(view) {
            const sel = view.state.selection.main;
            const selected = view.state.sliceDoc(sel.from, sel.to);
            view.dispatch({
              changes: { from: sel.from, to: sel.to, insert: `*${selected}*` },
              selection: { anchor: sel.from + 1, head: sel.to + 1 },
            });
            return true;
          }
        },
        // Insert link: Ctrl+K
        {
          key: 'Ctrl-k',
          run(view) {
            const sel = view.state.selection.main;
            const selected = view.state.sliceDoc(sel.from, sel.to);
            const insert = selected ? `[${selected}](url)` : '[text](url)';
            view.dispatch({
              changes: { from: sel.from, to: sel.to, insert },
              selection: { anchor: sel.from + insert.length - 4, head: sel.from + insert.length - 1 },
            });
            return true;
          }
        },
        // Save: Ctrl+S
        {
          key: 'Ctrl-s',
          run: (view) => {
            const note = this.activeNote();
            if (!note) return true;
            if (this.saveDebounce) clearTimeout(this.saveDebounce);
            this.zone.run(() => this.saveNote(note.id, view.state.doc.toString()));
            return true;
          }
        },
      ]),
      updateListener,
      EditorView.lineWrapping,
    ];

    const state = EditorState.create({ doc: content, extensions });
    this.editorView = new EditorView({
      state,
      parent: this.editorHost.nativeElement,
    });

    // Focus the editor
    setTimeout(() => this.editorView?.focus(), 50);
  }

  private async saveNote(id: number, content: string): Promise<void> {
    try {
      const title = this.notes.extractTitle(content);
      await this.notes.update(id, { content, title });
      this.tabs.markDirty(id, false);
      this.tabs.updateTitle(id, title || 'Untitled');
      this.activeNote.update(n => n ? { ...n, title, content } : n);
    } catch (err) {
      console.error('[Editor] Failed to save note:', err);
    }
  }

  openSearch(): void {
    if (this.editorView) {
      openSearchPanel(this.editorView);
    }
  }

  closeSearch(): void {
    if (this.editorView) {
      closeSearchPanel(this.editorView);
    }
  }

  focusEditor(): void {
    this.editorView?.focus();
  }
}
