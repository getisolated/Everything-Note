import {
  Component, OnDestroy, OnChanges, Input, SimpleChanges,
  ElementRef, ViewChild, inject, ChangeDetectionStrategy, signal, computed, effect, untracked
} from '@angular/core';


// CodeMirror
import { EditorView, keymap, lineNumbers, drawSelection, dropCursor, highlightActiveLine } from '@codemirror/view';
import { Compartment, EditorState, Extension, Prec } from '@codemirror/state';
import {
  defaultKeymap, history, historyKeymap, indentWithTab,
} from '@codemirror/commands';
import { searchKeymap, search, openSearchPanel, closeSearchPanel } from '@codemirror/search';
import { closeBrackets, closeBracketsKeymap } from '@codemirror/autocomplete';
import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
import { languages } from '@codemirror/language-data';
import { bracketMatching, syntaxTree } from '@codemirror/language';

import { editorHighlight } from '../../shared/codemirror/editor-highlight';
import { linkStatusFacet, markdownDecorationPlugin, markdownDecorationTheme } from '../../shared/codemirror/markdown-decorations';
import { noteTimestamps, noteTimestampsTheme, setTimestampBlocks } from '../../shared/codemirror/note-timestamps';
import { draftBlocks, toggleDraft } from '../../shared/codemirror/draft-blocks';
import { ContextMenuComponent, ContextMenuEntry } from '../../shared/context-menu/context-menu.component';
import { OutlineHeading, extractHeadings, findActiveHeading } from '../../shared/codemirror/outline';
import { linkNavigation } from '../../shared/codemirror/link-navigation';
import { noteLinkCompletion } from '../../shared/codemirror/note-link-completion';
import { ElectronBridgeService } from '../../core/services/electron-bridge.service';
import { LinkStatus, createLinkResolver, linkStatus } from '../../core/utils/note-paths.util';
import { EditorViewMode, PreviewScrollRequest } from '../../core/models/editor.model';
import { MarkdownPreviewComponent } from '../preview/markdown-preview.component';
import { FoldersService } from '../../core/services/folders.service';
import { OVERLAY_NOTE_TAG } from '../../core/models/settings.model';
import { slashCommandExtensions } from '../../shared/codemirror/slash-commands';
import { TableAction, applyTableAction, describeTableAtCursor, formatTableAtCursor, tableExtensions } from '../../shared/codemirror/table-extension';
import { NotesService } from '../../core/services/notes.service';
import { LinkRenameService } from '../../core/services/link-rename.service';
import { SettingsService } from '../../core/services/settings.service';
import { FormattingBarService } from '../../core/services/formatting-bar.service';
import { ThemeService } from '../../core/services/theme.service';
import { TabsService } from '../../core/services/tabs.service';
import { acceleratorToCodeMirrorKey } from '../../core/utils/accelerator.util';
import { Note, OVERLAY_NOTES_TAB_ID } from '../../core/models/note.model';

/** Delay before the preview follows the text being typed. */
const PREVIEW_REFRESH_MS = 150;

@Component({
  selector: 'app-editor',
  standalone: true,
  imports: [ContextMenuComponent, MarkdownPreviewComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="editor-wrapper" [attr.data-view-mode]="viewMode()">
      @if (activeNote()) {
        <div class="view-modes" role="group" aria-label="View mode">
          @for (mode of viewModes; track mode.id) {
            <button
              type="button"
              class="view-mode"
              [class.active]="viewMode() === mode.id"
              [attr.aria-pressed]="viewMode() === mode.id"
              [title]="mode.label + (mode.shortcut ? ' (' + shortcutLabel(mode.shortcut) + ')' : '')"
              (mousedown)="$event.preventDefault()"
              (click)="setViewMode(mode.id)"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" [innerHTML]="mode.icon"></svg>
            </button>
          }
        </div>
        <div class="editor-host" #editorHost></div>
        @if (viewMode() !== 'source') {
          <!-- Loaded on first use: markdown-it and DOMPurify stay out of the startup bundle -->
          @defer (on immediate) {
            <app-markdown-preview
              class="preview"
              [content]="previewContent()"
              [linkStatus]="linkStatusOf()"
              [scrollRequest]="previewScroll()"
              (linkClicked)="followLink($event)"
              (scrolledToLine)="syncEditorToLine($event)"
            />
          }
        }
        @if (settingsService.settings().showOutline && headings().length) {
          <nav class="toc" aria-label="Table of contents">
            @for (heading of headings(); track heading.from; let i = $index) {
              <button
                type="button"
                class="toc-item"
                [class.toc-h2]="heading.level === 2"
                [class.toc-h3]="heading.level === 3"
                [class.active]="i === activeHeading()"
                [title]="heading.text"
                (click)="goToHeading(heading)"
              >{{ heading.text }}</button>
            }
          </nav>
        }
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
              Press <kbd>{{ shortcutLabel('note.new') }}</kbd> to create a new note<br>
              or <kbd>{{ shortcutLabel('palette.commands') }}</kbd> to search existing notes
            </p>
          </div>
        </div>
      }
    </div>
    @if (ctxMenu(); as menu) {
      <app-context-menu
        [items]="menu.items"
        [x]="menu.x"
        [y]="menu.y"
        (action)="onCtxAction($event)"
        (closed)="ctxMenu.set(null)"
      />
    }
  `,
  styleUrls: ['./editor.component.scss'],
})
export class EditorComponent implements OnDestroy, OnChanges {
  @Input() noteId: number | null = null;
  @ViewChild('editorHost') editorHost!: ElementRef<HTMLElement>;

  private notes = inject(NotesService);
  private linkRename = inject(LinkRenameService);
  private folders = inject(FoldersService);
  private bridge = inject(ElectronBridgeService);
  private tabs = inject(TabsService);
  protected settingsService = inject(SettingsService);
  private themeService = inject(ThemeService);
  private formattingBar = inject(FormattingBarService);

  readonly activeNote = signal<Note | null>(null);
  readonly headings = signal<OutlineHeading[]>([]);
  readonly activeHeading = signal(-1);

  /** Source, preview, or both side by side. Not remembered per note: each opened note starts as the settings say. */
  protected readonly viewMode = signal<EditorViewMode>('source');
  /** Text shown by the preview; follows the editor with a short delay while the preview is shown. */
  protected readonly previewContent = signal('');
  /** Line the preview must bring to the top (editor scrolled, side by side). */
  protected readonly previewScroll = signal<PreviewScrollRequest | null>(null);
  private previewDebounce: ReturnType<typeof setTimeout> | null = null;
  /** Set while the editor scrolls because of the preview: that scroll must not be echoed back. */
  private syncingFromPreview = false;

  protected readonly viewModes: { id: EditorViewMode; label: string; shortcut: string | null; icon: string }[] = [
    { id: 'source', label: 'Source', shortcut: null, icon: '<path d="m16 18 6-6-6-6M8 6l-6 6 6 6"/>' },
    { id: 'split', label: 'Preview to the side', shortcut: 'editor.previewSide', icon: '<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M12 3v18"/>' },
    { id: 'preview', label: 'Preview', shortcut: 'editor.preview', icon: '<path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>' },
  ];

  /** Whether a link target exists, shared by the editor decorations and the preview. */
  protected readonly linkStatusOf = computed<(target: string) => LinkStatus>(() => {
    const notes = this.notes.notes();
    const resolve = createLinkResolver(notes.filter(n => !n.tags.includes(OVERLAY_NOTE_TAG)), this.folders.folders());
    const ids = new Set(notes.map(n => n.id));
    return target => linkStatus(target, resolve, id => ids.has(id));
  });
  readonly ctxMenu = signal<{ items: ContextMenuEntry[]; x: number; y: number } | null>(null);

  private editorView: EditorView | null = null;
  private readonly shortcutsCompartment = new Compartment();
  private readonly themeCompartment = new Compartment();
  private readonly lineNumbersCompartment = new Compartment();
  private readonly wrapCompartment = new Compartment();
  private readonly trailingLineCompartment = new Compartment();
  private readonly linkStatusCompartment = new Compartment();
  private saveDebounce: ReturnType<typeof setTimeout> | null = null;
  private isUpdatingFromModel = false;
  private loadGeneration = 0;

  protected shortcutLabel(id: string): string {
    return this.settingsService.shortcutLabel(id);
  }

  constructor() {
    // The overlay notes document follows new notes sent from the overlay while it is open
    effect(() => {
      const document = this.notes.overlayNotesDocument();
      untracked(() => this.refreshOverlayNotesView(document));
    });

    effect(() => {
      this.themeService.theme();
      untracked(() => {
        this.editorView?.dispatch({ effects: this.themeCompartment.reconfigure(this.buildThemeMode()) });
      });
    });

    effect(() => {
      this.settingsService.settings().showLineNumbers;
      this.settingsService.settings().wordWrap;
      this.settingsService.settings().trailingLine;
      untracked(() => {
        this.editorView?.dispatch({
          effects: [
            this.trailingLineCompartment.reconfigure(this.buildTrailingLine()),
            this.lineNumbersCompartment.reconfigure(this.buildLineNumbers()),
            this.wrapCompartment.reconfigure(this.buildWrapping()),
          ],
        });
      });
    });

    // Links turn red / back to normal as notes are created, renamed or deleted
    effect(() => {
      const status = this.linkStatusOf();
      untracked(() => {
        this.editorView?.dispatch({ effects: this.linkStatusCompartment.reconfigure(linkStatusFacet.of(status)) });
      });
    });

    effect(() => {
      this.settingsService.appShortcuts();
      untracked(() => {
        this.editorView?.dispatch({ effects: this.shortcutsCompartment.reconfigure(this.buildShortcutsKeymap()) });
      });
    });
  }

  /** Applies a view mode; the preview gets the current text at once. */
  protected setViewMode(mode: EditorViewMode): void {
    if (mode !== 'source' && this.editorView) {
      this.previewContent.set(this.editorView.state.doc.toString());
    }
    this.viewMode.set(mode);

    if (mode !== 'preview') {
      setTimeout(() => this.editorView?.focus(), 0);
    }
  }

  /** Ctrl+Shift+V: preview ↔ source. */
  togglePreview(): void {
    this.setViewMode(this.viewMode() === 'preview' ? 'source' : 'preview');
  }

  /** Ctrl+K V: preview beside the editor ↔ source. */
  togglePreviewSide(): void {
    this.setViewMode(this.viewMode() === 'split' ? 'source' : 'split');
  }

  /** The preview was scrolled: the editor follows (side by side only). */
  protected syncEditorToLine(line: number): void {
    const view = this.editorView;

    if (!view || this.viewMode() !== 'split') {
      return;
    }

    const doc = view.state.doc;
    const whole = Math.min(doc.lines, Math.max(1, Math.floor(line)));
    const block = view.lineBlockAt(doc.line(whole).from);
    const nextTop = whole < doc.lines ? view.lineBlockAt(doc.line(whole + 1).from).top : block.bottom;

    this.syncingFromPreview = true;
    view.scrollDOM.scrollTop = block.top + (line - whole) * (nextTop - block.top);
  }

  /** The editor was scrolled: the preview follows (side by side only). */
  private syncPreviewToEditor(view: EditorView): void {
    if (this.syncingFromPreview) {
      this.syncingFromPreview = false;
      return;
    }

    if (this.viewMode() !== 'split') {
      return;
    }

    const block = view.lineBlockAtHeight(view.scrollDOM.scrollTop);
    const line = view.state.doc.lineAt(block.from).number;
    const ratio = block.height > 0 ? (view.scrollDOM.scrollTop - block.top) / block.height : 0;
    this.previewScroll.set({ line: line + Math.max(0, Math.min(1, ratio)) });
  }

  /** While the preview is shown, it follows the text with a short delay (rendering the whole note on every key is wasted). */
  private schedulePreviewRefresh(view: EditorView): void {
    if (this.viewMode() === 'source') {
      return;
    }

    if (this.previewDebounce) clearTimeout(this.previewDebounce);
    this.previewDebounce = setTimeout(() => this.previewContent.set(view.state.doc.toString()), PREVIEW_REFRESH_MS);
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['noteId']) {
      this.loadNote(this.noteId);
    }
  }

  ngOnDestroy(): void {
    this.editorView?.destroy();
    if (this.saveDebounce) clearTimeout(this.saveDebounce);
    if (this.previewDebounce) clearTimeout(this.previewDebounce);
  }

  private async loadNote(id: number | null): Promise<void> {
    const generation = ++this.loadGeneration;
    const previousId = this.activeNote()?.id ?? null;

    // Always flush pending save before switching notes
    await this.flushPendingSave();

    // Abort if a newer load was started while flushing
    if (generation !== this.loadGeneration) return;

    // A note whose tab was just closed while still empty (e.g. Ctrl+N then Ctrl+W) is not worth keeping
    if (previousId !== null && previousId !== id && previousId !== OVERLAY_NOTES_TAB_ID && !this.tabs.isOpen(previousId)) {
      await this.notes.deleteIfEmpty(previousId);
    }

    if (id === null) {
      this.activeNote.set(null);
      this.destroyEditor();
      return;
    }

    try {
      const note = id === OVERLAY_NOTES_TAB_ID ? this.buildOverlayNotesDocument() : await this.notes.getById(id);
      // Abort if a newer load was started while fetching
      if (generation !== this.loadGeneration) return;
      this.activeNote.set(note);
      this.previewContent.set(note?.content ?? '');
      this.viewMode.set(this.settingsService.settings().openInPreview ? 'preview' : 'source');
      // Wait for DOM to update
      setTimeout(() => {
        if (generation !== this.loadGeneration) return;
        this.initEditor(note?.content ?? '', id === OVERLAY_NOTES_TAB_ID);
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
    this.headings.set([]);
    this.activeHeading.set(-1);
    this.formattingBar.attach(null);
  }

  private initEditor(content: string, readOnly = false): void {
    this.destroyEditor();
    if (!this.editorHost?.nativeElement) return;

    const updateListener = EditorView.updateListener.of(update => {
      if (update.docChanged || update.selectionSet) {
        this.formattingBar.refresh(update.state);
      }
      if (update.docChanged) {
        this.refreshOutline(update.view);
        this.schedulePreviewRefresh(update.view);
      }
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
          this.saveNote(note.id, content);
        }, 1000);
      }
    });

    const evnoteTheme = EditorView.theme({
      '&': {
        height: '100%',
        background: 'var(--evn-bg)',
        color: 'var(--evn-text)',
        fontSize: '14px',
        fontFamily: 'Consolas, "Courier New", monospace',
      },
      '.cm-content': {
        padding: '32px 48px',
        minHeight: '100%',
        caretColor: 'var(--evn-caret)',
        maxWidth: '780px',
      },
      '.cm-scroller': {
        justifyContent: 'center',
        fontFamily: 'Consolas, "Courier New", monospace',
        lineHeight: '1.65',
        overflow: 'auto',
      },
      '.cm-line': {
        padding: '0',
      },
      '.cm-gutters': {
        background: 'transparent',
        border: 'none',
        color: 'var(--evn-text-faint)',
        userSelect: 'none',
      },
      // Numbers hug the text, left-aligned like in VS Code: the gutter and the content are centered together
      '.cm-lineNumbers .cm-gutterElement': {
        padding: '0 0 0 8px',
        textAlign: 'left',
        // Centered on the line: the headings are taller than the text
        display: 'flex',
        alignItems: 'center',
        fontSize: '12px',
      },
      '&.cm-with-numbers .cm-content': {
        paddingLeft: '16px',
      },
      '&.cm-focused .cm-cursor': {
        borderLeftColor: 'var(--evn-caret)',
      },
      '&.cm-focused .cm-selectionBackground, .cm-selectionBackground': {
        background: 'var(--evn-selection)',
      },
      '.cm-activeLine': {
        background: 'rgba(var(--evn-hover-rgb), 0.02)',
      },
      '.cm-search': {
        background: 'var(--evn-bg-chip)',
        border: '1px solid var(--evn-border)',
        borderRadius: '4px',
      },
    });

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
      editorHighlight,
      evnoteTheme,
      // Colors follow the CSS variables; only CodeMirror's own light/dark base styles (search panel, tooltips…) need swapping
      this.themeCompartment.of(this.buildThemeMode()),
      markdownDecorationTheme,
      markdownDecorationPlugin,
      ...slashCommandExtensions,
      ...tableExtensions,
      noteLinkCompletion({
        notes: () => this.notes.notes().filter(n => !n.tags.includes(OVERLAY_NOTE_TAG)),
        folders: () => this.folders.folders(),
      }),
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
      ]),
      this.shortcutsCompartment.of(this.buildShortcutsKeymap()),
      updateListener,
      this.wrapCompartment.of(this.buildWrapping()),
      this.lineNumbersCompartment.of(this.buildLineNumbers()),
      this.trailingLineCompartment.of(this.buildTrailingLine()),
      linkNavigation(target => this.followLink(target)),
      EditorView.domEventHandlers({
        scroll: (_event, view) => {
          this.refreshActiveHeading(view);
          this.syncPreviewToEditor(view);
        },
      }),
      this.linkStatusCompartment.of(linkStatusFacet.of(this.linkStatusOf())),
      // The concatenated overlay notes cannot be mapped back to their individual notes, hence no drafts either
      ...(readOnly
        ? [EditorState.readOnly.of(true), EditorView.editable.of(false), noteTimestamps, noteTimestampsTheme]
        : [draftBlocks, this.contextMenuHandler()]),
    ];

    const state = EditorState.create({ doc: content, extensions });
    this.editorView = new EditorView({
      state,
      parent: this.editorHost.nativeElement,
    });

    this.formattingBar.attach(this.editorView, readOnly);
    this.refreshOutline(this.editorView);

    if (readOnly) {
      this.editorView.dispatch({ effects: setTimestampBlocks.of(this.notes.overlayNoteBlocks()) });
    }

    // Focus the editor
    setTimeout(() => this.editorView?.focus(), 50);
  }

  private refreshOutline(view: EditorView): void {
    const next = extractHeadings(view.state);
    const current = this.headings();
    const same = next.length === current.length
      && next.every((h, i) => h.from === current[i]!.from && h.text === current[i]!.text && h.level === current[i]!.level);
    if (!same) this.headings.set(next);
    this.refreshActiveHeading(view);
  }

  private headingTop(view: EditorView, heading: OutlineHeading): number {
    return view.lineBlockAt(heading.from).top + view.documentPadding.top;
  }

  private refreshActiveHeading(view: EditorView): void {
    const scroller = view.scrollDOM;
    const tops = this.headings().map(h => this.headingTop(view, h));
    const atBottom = scroller.scrollTop > 0 && scroller.scrollTop + scroller.clientHeight >= scroller.scrollHeight - 2;
    this.activeHeading.set(findActiveHeading(tops, scroller.scrollTop, atBottom));
  }

  protected goToHeading(heading: OutlineHeading): void {
    const view = this.editorView;
    if (!view) return;
    view.dispatch({ selection: { anchor: heading.from } });
    view.scrollDOM.scrollTo({ top: Math.max(0, this.headingTop(view, heading) - 8), behavior: 'smooth' });
    view.contentDOM.focus({ preventScroll: true });
  }

  private buildOverlayNotesDocument(): Note {
    const now = new Date().toISOString();
    return {
      id: OVERLAY_NOTES_TAB_ID, title: 'Overlay notes', content: this.notes.overlayNotesDocument(),
      tags: [], folderId: null, sortOrder: null, createdAt: now, updatedAt: now,
    };
  }

  private refreshOverlayNotesView(document: string): void {
    const view = this.editorView;
    if (!view || this.activeNote()?.id !== OVERLAY_NOTES_TAB_ID || view.state.doc.toString() === document) {
      return;
    }
    view.dispatch({
      changes: { from: 0, to: view.state.doc.length, insert: document },
      effects: setTimestampBlocks.of(this.notes.overlayNoteBlocks()),
    });
  }

  private contextMenuHandler(): Extension {
    return EditorView.domEventHandlers({
      contextmenu: (event) => {
        event.preventDefault();
        const items: ContextMenuEntry[] = [
          { id: 'draft', label: 'Toggle draft', shortcut: this.shortcutLabel('editor.draft') },
        ];
        const table = this.editorView ? describeTableAtCursor(this.editorView.state) : null;

        if (table) {
          items.push(
            { divider: true },
            { id: 'table:addRow', label: 'Insert row below' },
            { id: 'table:deleteRow', label: 'Delete row', disabled: table.row === 0 },
            { id: 'table:addColumn', label: 'Insert column right' },
            { id: 'table:deleteColumn', label: 'Delete column', disabled: table.columnCount <= 1 },
            { divider: true },
            { id: 'table:alignLeft', label: 'Align column left' },
            { id: 'table:alignCenter', label: 'Align column center' },
            { id: 'table:alignRight', label: 'Align column right' },
          );
        }

        this.ctxMenu.set({ items, x: event.clientX, y: event.clientY });
        return true;
      },
    });
  }

  protected onCtxAction(id: string): void {
    const view = this.editorView;
    if (id === 'draft' && view) {
      toggleDraft(view);
      view.focus();
    } else if (id.startsWith('table:') && view) {
      applyTableAction(view, id.slice('table:'.length) as TableAction);
    }
  }

  private buildLineNumbers(): Extension {
    return this.settingsService.settings().showLineNumbers
      ? [lineNumbers(), EditorView.editorAttributes.of({ class: 'cm-with-numbers' })]
      : [];
  }

  /** Keeps an empty line at the end of the note while the setting is on (never in the read-only overlay document). */
  private buildTrailingLine(): Extension {
    if (!this.settingsService.settings().trailingLine) return [];
    const NEWLINE = String.fromCharCode(10);
    return EditorState.transactionFilter.of(tr => {
      const length = tr.newDoc.length;
      if (!tr.docChanged || tr.startState.readOnly || tr.newDoc.sliceString(Math.max(0, length - 1)) === NEWLINE) return tr;
      return [tr, { changes: { from: length, insert: NEWLINE }, selection: tr.newSelection, sequential: true }];
    });
  }

  private buildWrapping(): Extension {
    return this.settingsService.settings().wordWrap ? EditorView.lineWrapping : [];
  }

  /** Ctrl+click on a link (or a click in the preview): a note (by `note://id` or by path) opens in a tab, a web address in the browser. */
  protected followLink(target: string): void {
    const noteUrl = /^note:\/\/(?<id>\d+)$/.exec(target.trim());
    const notes = this.notes.notes();
    let noteId: number | null = noteUrl?.groups?.['id'] ? Number(noteUrl.groups['id']) : null;

    if (noteId === null && /^https?:\/\//i.test(target.trim())) {
      void this.bridge.openExternal(target.trim());
      return;
    }

    noteId ??= createLinkResolver(notes.filter(n => !n.tags.includes(OVERLAY_NOTE_TAG)), this.folders.folders())(target);

    const note = notes.find(n => n.id === noteId);

    if (note) {
      this.tabs.openNote(note.id, note.title || 'Untitled');
    }
  }

  private buildThemeMode(): Extension {
    return EditorView.darkTheme.of(this.themeService.theme() === 'dark');
  }

  /** Formatting/save bindings use the accelerators configured in the settings (reconfigured live, see constructor). */
  private buildShortcutsKeymap(): Extension {
    const keyFor = (id: string): string => acceleratorToCodeMirrorKey(this.settingsService.appShortcuts()[id] ?? '');
    // High precedence: the search keymap already binds Ctrl+D (select next occurrence)
    return Prec.high(keymap.of([
      {
        key: keyFor('editor.draft'),
        run: (view) => toggleDraft(view),
      },
      {
        key: keyFor('editor.bold'),
        run: (view) => this.wrapSelection(view, '**', '**'),
      },
      {
        key: keyFor('editor.italic'),
        run: (view) => this.wrapSelection(view, '*', '*'),
      },
      {
        key: keyFor('editor.link'),
        run: (view) => {
          const sel = view.state.selection.main;
          const selected = view.state.sliceDoc(sel.from, sel.to);
          const insert = selected ? `[${selected}](url)` : '[text](url)';
          view.dispatch({
            changes: { from: sel.from, to: sel.to, insert },
            selection: { anchor: sel.from + insert.length - 4, head: sel.from + insert.length - 1 },
          });
          return true;
        },
      },
      {
        key: keyFor('editor.save'),
        run: (view) => {
          const note = this.activeNote();
          if (!note) return true;
          if (this.saveDebounce) clearTimeout(this.saveDebounce);
          formatTableAtCursor(view);
          this.saveNote(note.id, view.state.doc.toString());
          return true;
        },
      },
    ]));
  }

  private wrapSelection(view: EditorView, before: string, after: string): boolean {
    const sel = view.state.selection.main;
    const selected = view.state.sliceDoc(sel.from, sel.to);
    view.dispatch({
      changes: { from: sel.from, to: sel.to, insert: `${before}${selected}${after}` },
      selection: { anchor: sel.from + before.length, head: sel.to + before.length },
    });
    return true;
  }

  private async saveNote(id: number, content: string): Promise<void> {
    if (id === OVERLAY_NOTES_TAB_ID) return;
    try {
      const title = this.notes.extractTitle(content);
      const previousTitle = this.notes.notes().find(n => n.id === id)?.title;
      await this.notes.update(id, { content, title });

      if (previousTitle !== undefined && previousTitle !== title) {
        this.linkRename.notifyTitleChanged(id, previousTitle);
      }

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
