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
import { searchKeymap, search } from '@codemirror/search';
import { closeBrackets, closeBracketsKeymap } from '@codemirror/autocomplete';
import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
import { languages } from '@codemirror/language-data';
import { bracketMatching, syntaxTree } from '@codemirror/language';

import { editorHighlight } from '../../shared/codemirror/editor-highlight';
import { linkStatusFacet, markdownDecorationPlugin, markdownDecorationTheme } from '../../shared/codemirror/markdown-decorations';
import { noteTimestamps, noteTimestampsTheme, setTimestampBlocks, timestampBlocks } from '../../shared/codemirror/note-timestamps';
import { QuickNoteHandlers, editingQuickNote, quickNotesEditing } from '../../shared/codemirror/quick-notes-editing';
import { draftBlocks, toggleDraft } from '../../shared/codemirror/draft-blocks';
import { ContextMenuComponent, ContextMenuEntry } from '../../shared/context-menu/context-menu.component';
import { OutlineHeading, extractHeadings, findActiveHeading } from '../../shared/codemirror/outline';
import { cursorResync } from '../../shared/codemirror/cursor-resync';
import { linkNavigation } from '../../shared/codemirror/link-navigation';
import { noteLinkCompletion } from '../../shared/codemirror/note-link-completion';
import { DesktopBridgeService } from '../../core/services/desktop-bridge.service';
import { LinkStatus, createLinkResolver, linkStatus } from '../../core/utils/note-paths.util';
import { externallyChangedContent } from '../../core/utils/external-change.util';
import { EditorViewMode, PreviewScrollRequest } from '../../core/models/editor.model';
import { MarkdownPreviewComponent } from '../preview/markdown-preview.component';
import { TranslationKey } from '../../core/i18n/translations';
import { noteExportMenu, NoteExportService } from '../../core/services/note-export.service';
import { FoldersService } from '../../core/services/folders.service';
import { AppSettings, QUICK_NOTE_TAG } from '../../core/models/settings.model';
import { slashCommandExtensions } from '../../shared/codemirror/slash-commands';
import { insertLink } from '../../shared/codemirror/formatting-commands';
import { hiddenScrollbar } from '../../shared/codemirror/hidden-scrollbar';
import { TableAction, applyTableAction, describeTableAtCursor, formatTableAtCursor, tableExtensions } from '../../shared/codemirror/table-extension';
import { NotesService } from '../../core/services/notes.service';
import { LinkRenameService } from '../../core/services/link-rename.service';
import { SettingsService } from '../../core/services/settings.service';
import { FormattingBarService } from '../../core/services/formatting-bar.service';
import { ThemeService } from '../../core/services/theme.service';
import { TabsService } from '../../core/services/tabs.service';
import { acceleratorToCodeMirrorKey } from '../../core/utils/accelerator.util';
import { Note, QUICK_NOTES_TAB_ID, QUICK_NOTES_TITLE } from '../../core/models/note.model';
import { CollectionFileRef } from '../../core/models/collection.model';
import { CollectionsService } from '../../core/services/collections.service';
import { FileDocsService } from '../../core/services/file-docs.service';
import {
  CollectionIndex, CollectionTarget, baseName, collectionLinkStatus, folderPage, indexCollection, resolveRelativeLink, resolveRelativePath,
} from '../../core/utils/collection.util';
import { convertFileSrc } from '@tauri-apps/api/core';
import { inDesktop } from '../../core/services/desktop-api';
import { ImageResolver } from '../../shared/markdown/markdown-renderer';
import { fileBreadcrumbs, noteBreadcrumbs } from '../../core/utils/breadcrumbs.util';
import { noteDisplayTitle } from '../../core/utils/note-title.util';

/** Protocol of the main process serving the images of the collections (crate `desktop`, file_protocol.rs). */
const COLLECTION_FILE_SCHEME = 'collection-file';
import { FindService } from '../../core/services/find.service';
import { FindPanelComponent } from '../find/find-panel.component';
import { I18nService } from '../../core/i18n/i18n.service';
import { translatorFacet } from '../../shared/codemirror/translator';

/** CodeMirror's search needs a panel to keep its matches highlighted: an empty, hidden one (the find panel is the UI). */
function hiddenSearchPanel(): HTMLElement {
  const dom = document.createElement('div');
  dom.hidden = true;
  return dom;
}

/** How long the view mode of a followed link waits for the note it opens (a collection file is read from the disk). */
const CARRIED_VIEW_MODE_MS = 3000;

/** Delay before the preview follows the text being typed. */
const PREVIEW_REFRESH_MS = 150;

@Component({
  selector: 'app-editor',
  standalone: true,
  imports: [ContextMenuComponent, FindPanelComponent, MarkdownPreviewComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (fileBanner(); as banner) {
      <div class="file-banner" role="alert" [class.error]="banner.kind !== 'conflict'">
        @if (banner.kind === 'conflict') {
          <span>{{ i18n.t('editor.fileBanner.conflict') }}</span>
          <button type="button" (click)="reloadFromDisk()">{{ i18n.t('editor.fileBanner.reload') }}</button>
          <button type="button" (click)="fileBanner.set(null)">{{ i18n.t('editor.fileBanner.keepMine') }}</button>
        } @else {
          <span>{{ i18n.t(banner.kind === 'unreadable' ? 'editor.fileBanner.unreadable' : 'editor.fileBanner.unsaved', { path: banner.path, error: banner.error }) }}</span>
          <button type="button" (click)="fileBanner.set(null)">{{ i18n.t('editor.fileBanner.dismiss') }}</button>
        }
      </div>
    }
    @if (breadcrumbs().length > 0) {
      <nav class="breadcrumbs" [attr.aria-label]="i18n.t('editor.breadcrumbs.label')">
        @for (segment of breadcrumbs(); track $index; let last = $last) {
          <span class="crumb" [class.current]="last" [title]="segment">{{ segment }}</span>
          @if (!last) {
            <svg class="crumb-separator" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <polyline points="9 6 15 12 9 18" />
            </svg>
          }
        }
      </nav>
    }
    <div class="editor-wrapper" [attr.data-view-mode]="viewMode()">
      @if (activeNote()) {
        <div class="view-modes" role="group" [attr.aria-label]="i18n.t('editor.viewMode.label')">
          @for (mode of viewModes; track mode.id) {
            <button
              type="button"
              class="view-mode"
              [class.active]="viewMode() === mode.id"
              [attr.aria-pressed]="viewMode() === mode.id"
              [title]="i18n.t(mode.labelKey) + (mode.shortcut ? ' (' + shortcutLabel(mode.shortcut) + ')' : '')"
              (mousedown)="$event.preventDefault()"
              (click)="setViewMode(mode.id)"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
                @switch (mode.id) {
                  @case ('source') { <path d="m16 18 6-6-6-6M8 6l-6 6 6 6" /> }
                  @case ('split') { <rect x="3" y="3" width="18" height="18" rx="2" /><path d="M12 3v18" /> }
                  @case ('preview') { <path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z" /><circle cx="12" cy="12" r="3" /> }
                }
              </svg>
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
              [resolveImage]="imageResolver()"
              [scrollRequest]="previewScroll()"
              (linkClicked)="followLink($event)"
              (scrolledToLine)="syncEditorToLine($event)"
            />
          }
        }
        <!-- Right column: the find panel takes the place of the outline while it is open -->
        @if (find.isOpen()) {
          <app-find-panel />
        } @else if (outlineShown()) {
          <nav class="toc" [attr.aria-label]="i18n.t('editor.toc.label')">
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
            <p class="empty-title">{{ i18n.t('editor.empty.title') }}</p>
            <p class="empty-hint">
              {{ i18n.t('editor.empty.press') }} <kbd>{{ shortcutLabel('note.new') }}</kbd> {{ i18n.t('editor.empty.toCreate') }}<br>
              {{ i18n.t('editor.empty.or') }} <kbd>{{ shortcutLabel('palette.commands') }}</kbd> {{ i18n.t('editor.empty.toSearch') }}
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
  private bridge = inject(DesktopBridgeService);
  private tabs = inject(TabsService);
  protected settingsService = inject(SettingsService);
  protected readonly i18n = inject(I18nService);
  private themeService = inject(ThemeService);
  private formattingBar = inject(FormattingBarService);
  private noteExport = inject(NoteExportService);
  protected readonly find = inject(FindService);
  private fileDocs = inject(FileDocsService);
  private collections = inject(CollectionsService);

  readonly activeNote = signal<Note | null>(null);
  readonly headings = signal<OutlineHeading[]>([]);
  readonly activeHeading = signal(-1);
  /** Problem with the collection file being edited: changed on disk meanwhile, or unreadable. */
  protected readonly fileBanner = signal<{ kind: 'conflict' | 'unreadable' | 'unsaved'; path: string; error: string } | null>(null);
  /** Last text written to (or read from) the disk for the open file: its own change events are not reloads. */
  private fileContentOnDisk: string | null = null;

  /** The quick notes are a list of short notes: an outline of their headings would mean nothing. */
  protected readonly outlineShown = computed(() =>
    this.settingsService.settings().showOutline && this.headings().length > 0 && this.activeNote()?.id !== QUICK_NOTES_TAB_ID
  );

  /** Source, preview, or both side by side. Not remembered per note: each opened note starts as the settings say. */
  protected readonly viewMode = signal<EditorViewMode>('source');
  private carriedViewMode: { mode: EditorViewMode; at: number } | null = null;
  /** Text shown by the preview; follows the editor with a short delay while the preview is shown. */
  protected readonly previewContent = signal('');
  /** Line the preview must bring to the top (editor scrolled, side by side). */
  protected readonly previewScroll = signal<PreviewScrollRequest | null>(null);
  private previewDebounce: ReturnType<typeof setTimeout> | null = null;
  /** Set while the editor scrolls because of the preview: that scroll must not be echoed back. */
  private syncingFromPreview = false;

  protected readonly viewModes: { id: EditorViewMode; labelKey: TranslationKey; shortcut: string | null }[] = [
    { id: 'source', labelKey: 'editor.viewMode.source', shortcut: null },
    { id: 'split', labelKey: 'editor.viewMode.split', shortcut: 'editor.previewSide' },
    { id: 'preview', labelKey: 'editor.viewMode.preview', shortcut: 'editor.preview' },
  ];

  /** Where the open note sits: the notes or its collection, the folders, then the note (setting `showBreadcrumbs`). */
  protected readonly breadcrumbs = computed<string[]>(() => {
    const note = this.activeNote();
    if (!this.settingsService.settings().showBreadcrumbs || !note || note.id === QUICK_NOTES_TAB_ID) {
      return [];
    }

    const file = this.fileDocs.refFor(note.id);
    if (file) {
      const state = this.collections.states().find(candidate => candidate.collection.path === file.root);
      return fileBreadcrumbs(state?.label ?? baseName(file.root), file.path);
    }
    return noteBreadcrumbs(this.i18n.t('common.notes'), note.folderId, this.folders.folders(), noteDisplayTitle(note.title, this.i18n.t));
  });

  /** In a collection file, relative images are read from the disk, next to the file (see the `collection-file` protocol). */
  protected readonly imageResolver = computed<ImageResolver | null>(() => {
    const file = this.fileDocs.refFor(this.activeNote()?.id ?? null);
    if (!file || !inDesktop()) {
      return null;
    }
    return src => {
      const path = resolveRelativePath(file.path, src);
      return path ? convertFileSrc(`${file.root}\n${path}`, COLLECTION_FILE_SCHEME) : null;
    };
  });

  /** Whether a link target exists, shared by the editor decorations and the preview. */
  protected readonly linkStatusOf = computed<(target: string) => LinkStatus>(() => {
    // In a collection file, links lead to the other files of the collection (as `followLink` does)
    const file = this.fileDocs.refFor(this.activeNote()?.id ?? null);
    if (file) {
      const index = this.collectionIndex(file.root);
      return target => collectionLinkStatus(file.path, target, index);
    }

    const notes = this.notes.notes();
    const resolve = createLinkResolver(notes.filter(n => !n.tags.includes(QUICK_NOTE_TAG)), this.folders.folders());
    const ids = new Set(notes.map(n => n.id));
    return target => linkStatus(target, resolve, id => ids.has(id));
  });
  readonly ctxMenu = signal<{ items: ContextMenuEntry[]; x: number; y: number } | null>(null);

  private editorView: EditorView | null = null;
  private readonly shortcutsCompartment = new Compartment();
  private readonly themeCompartment = new Compartment();
  private readonly lineNumbersCompartment = new Compartment();
  private readonly wrapCompartment = new Compartment();
  private readonly scrollbarCompartment = new Compartment();
  private readonly trailingLineCompartment = new Compartment();
  private readonly linkStatusCompartment = new Compartment();
  private saveDebounce: ReturnType<typeof setTimeout> | null = null;
  private isUpdatingFromModel = false;
  private loadGeneration = 0;

  protected shortcutLabel(id: string): string {
    return this.settingsService.shortcutLabel(id);
  }

  constructor() {
    // Full preview: the formatting bar has nothing to act on
    effect(() => this.formattingBar.setPreviewOnly(this.viewMode() === 'preview'));
    // The quick notes document follows new notes sent from the overlay while it is open
    effect(() => {
      const document = this.notes.quickNotesDocument();
      untracked(() => this.refreshQuickNotesView(document));
    });

    effect(() => {
      this.themeService.kind();
      untracked(() => {
        this.editorView?.dispatch({ effects: this.themeCompartment.reconfigure(this.buildThemeMode()) });
      });
    });

    effect(() => {
      const settings = this.settingsService.settings();
      untracked(() => {
        this.editorView?.dispatch({
          effects: [
            this.trailingLineCompartment.reconfigure(this.buildTrailingLine(settings)),
            this.lineNumbersCompartment.reconfigure(this.buildLineNumbers(settings)),
            this.wrapCompartment.reconfigure(this.buildWrapping(settings)),
            this.scrollbarCompartment.reconfigure(this.buildScrollbar(settings)),
          ],
        });
      });
    });

    // The open note was changed outside the editor (an AI through the MCP server, then `notes:changed` reloaded the list)
    effect(() => {
      const notes = this.notes.notes();
      untracked(() => this.onExternalNoteChange(notes));
    });

    // A collection file open here was changed by another program
    effect(() => {
      const change = this.collections.lastChange();
      untracked(() => { void this.onDiskChange(change); });
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
    if (previousId !== null && previousId !== id && previousId !== QUICK_NOTES_TAB_ID && !this.tabs.isOpen(previousId)) {
      await this.notes.deleteIfEmpty(previousId);
    }

    if (id === null) {
      this.activeNote.set(null);
      this.destroyEditor();
      return;
    }

    try {
      const file = this.fileDocs.refFor(id);
      this.fileBanner.set(null);
      let note: Note | null;

      if (id === QUICK_NOTES_TAB_ID) {
        note = this.buildQuickNotesDocument();
      } else if (file) {
        note = await this.buildFileDocument(id, file);
      } else {
        note = await this.notes.getById(id);
      }
      // Abort if a newer load was started while fetching
      if (generation !== this.loadGeneration) return;
      this.activeNote.set(note);
      this.previewContent.set(note?.content ?? '');
      this.viewMode.set(this.takeCarriedViewMode() ?? (this.settingsService.settings().openInPreview ? 'preview' : 'source'));
      // Wait for DOM to update
      setTimeout(() => {
        if (generation !== this.loadGeneration) return;
        this.initEditor(note?.content ?? '', id === QUICK_NOTES_TAB_ID);
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
    this.find.attach(null);
  }

  private initEditor(content: string, readOnly = false): void {
    this.destroyEditor();
    if (!this.editorHost?.nativeElement) return;

    const updateListener = EditorView.updateListener.of(update => {
      if (update.docChanged || update.selectionSet) {
        this.formattingBar.refresh(update.state);
      }
      this.find.refresh(update);
      if (update.docChanged) {
        this.refreshOutline(update.view);
        this.schedulePreviewRefresh(update.view);
      }
      if (update.docChanged && !this.isUpdatingFromModel) {
        const content = update.state.doc.toString();
        const note = this.activeNote();
        // The quick notes are saved one by one, by their own edit (see quickNoteHandlers)
        if (!note || note.id === QUICK_NOTES_TAB_ID) return;

        // A note is titled by its first line; a file keeps its file name
        if (!this.fileDocs.isFileDoc(note.id)) {
          const title = this.notes.extractTitle(content);
          this.tabs.updateTitle(note.id, title);
        }
        this.tabs.markDirty(note.id, true);

        // Debounce auto-save (1s)
        if (this.saveDebounce) clearTimeout(this.saveDebounce);
        this.saveDebounce = setTimeout(() => {
          this.saveNote(note.id, content);
        }, 1000);
      }
    });

    const daftrTheme = EditorView.theme({
      '&': {
        height: '100%',
        background: 'var(--daftr-bg)',
        color: 'var(--daftr-text)',
        fontSize: '14px',
        fontFamily: 'var(--daftr-font-mono)',
      },
      // The right padding belongs to the content so unwrapped lines keep their gap when scrolled to the end
      '.cm-content': {
        padding: '32px 48px 32px 16px',
        minHeight: '100%',
        caretColor: 'var(--daftr-caret)',
        boxSizing: 'border-box',
      },
      '.cm-scroller': {
        fontFamily: 'var(--daftr-font-mono)',
        lineHeight: '1.65',
        overflow: 'auto',
      },
      '.cm-line': {
        padding: '0',
      },
      '.cm-gutters': {
        background: 'transparent',
        border: 'none',
        color: 'var(--daftr-text-faint)',
        userSelect: 'none',
      },
      // Numbers hug the text, right-aligned like in VS Code: the gutter and the content are centered together
      '.cm-lineNumbers .cm-gutterElement': {
        padding: '0 0 0 8px',
        // Centered on the line: the headings are taller than the text
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'flex-end',
        fontSize: '12px',
      },
      '&.cm-focused .cm-cursor': {
        borderLeftColor: 'var(--daftr-caret)',
      },
      '&.cm-focused .cm-selectionBackground, .cm-selectionBackground': {
        background: 'var(--daftr-selection)',
      },
      '.cm-activeLine': {
        background: 'rgba(var(--daftr-hover-rgb), 0.02)',
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

    const settings = this.settingsService.settings();
    const extensions: Extension[] = [
      history(),
      closeBrackets(),
      markdown({
        base: markdownLanguage,
        codeLanguages: languages,
      }),
      editorHighlight,
      daftrTheme,
      // Colors follow the CSS variables; only CodeMirror's own light/dark base styles (search panel, tooltips…) need swapping
      this.themeCompartment.of(this.buildThemeMode()),
      markdownDecorationTheme,
      markdownDecorationPlugin,
      ...slashCommandExtensions,
      ...tableExtensions,
      noteLinkCompletion({
        notes: () => this.notes.notes().filter(n => !n.tags.includes(QUICK_NOTE_TAG)),
        folders: () => this.folders.folders(),
      }),
      drawSelection(),
      dropCursor(),
      highlightActiveLine(),
      bracketMatching(),
      // CodeMirror keeps the search state (query, highlights); the UI is the find panel of the right column
      search({ createPanel: () => ({ dom: hiddenSearchPanel() }) }),
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
      // Reads the language at each call: what is drawn on demand (menus, tooltips, widgets) follows it
      translatorFacet.of(this.i18n.t),
      updateListener,
      this.wrapCompartment.of(this.buildWrapping(settings)),
      this.scrollbarCompartment.of(this.buildScrollbar(settings)),
      this.lineNumbersCompartment.of(this.buildLineNumbers(settings)),
      this.trailingLineCompartment.of(this.buildTrailingLine(settings)),
      linkNavigation(target => this.followLink(target)),
      cursorResync,
      EditorView.domEventHandlers({
        scroll: (_event, view) => {
          this.refreshActiveHeading(view);
          this.syncPreviewToEditor(view);
        },
      }),
      this.linkStatusCompartment.of(linkStatusFacet.of(this.linkStatusOf())),
      // The quick notes are edited one at a time, from their hover actions: no drafts, no context menu
      ...(readOnly
        ? [noteTimestamps, noteTimestampsTheme, quickNotesEditing(this.quickNoteHandlers())]
        : [draftBlocks, this.contextMenuHandler()]),
    ];

    const state = EditorState.create({ doc: content, extensions });
    this.editorView = new EditorView({
      state,
      parent: this.editorHost.nativeElement,
    });

    this.formattingBar.attach(this.editorView, readOnly);
    this.find.attach(this.editorView, readOnly);
    this.refreshOutline(this.editorView);

    if (readOnly) {
      this.editorView.dispatch({ effects: setTimestampBlocks.of(this.notes.quickNoteBlocks()) });
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

  private buildQuickNotesDocument(): Note {
    const now = new Date().toISOString();
    return {
      id: QUICK_NOTES_TAB_ID, title: QUICK_NOTES_TITLE, content: this.notes.quickNotesDocument(),
      tags: [], folderId: null, sortOrder: null, color: null, createdAt: now, updatedAt: now,
    };
  }

  private refreshQuickNotesView(document: string): void {
    const view = this.editorView;
    // A note being edited is not overwritten: the document catches up once the edit ends
    if (!view || this.activeNote()?.id !== QUICK_NOTES_TAB_ID || editingQuickNote(view.state) !== null || view.state.doc.toString() === document) {
      return;
    }
    view.dispatch({
      changes: { from: 0, to: view.state.doc.length, insert: document },
      effects: setTimestampBlocks.of(this.notes.quickNoteBlocks()),
      // The edit guard of the quick notes only lets the edited note change
      filter: false,
    });
  }

  private quickNoteHandlers(): QuickNoteHandlers {
    return {
      save: (id, text) => { void this.notes.update(id, { content: text, title: this.notes.extractTitle(text) }); },
      remove: id => { void this.notes.delete(id); },
      copy: text => { void navigator.clipboard.writeText(text); },
      convert: id => this.convertQuickNote(id),
      editEnded: () => this.refreshQuickNotesView(this.notes.quickNotesDocument()),
    };
  }

  /** Converts a quick note and opens the resulting note in a tab. */
  private convertQuickNote(id: number): void {
    void this.notes.convertQuickNote(id).then(note => {
      if (note) {
        this.tabs.openNote(note.id, note.title);
      }
    });
  }

  /** Id of the quick note under the pointer, null outside the quick notes document. */
  private quickNoteAt(event: MouseEvent): number | null {
    const view = this.editorView;
    if (!view || this.activeNote()?.id !== QUICK_NOTES_TAB_ID) return null;
    const pos = view.posAtCoords({ x: event.clientX, y: event.clientY }, false);
    return timestampBlocks(view.state).find(range => pos >= range.from && pos <= range.to)?.id ?? null;
  }

  private contextMenuHandler(): Extension {
    return EditorView.domEventHandlers({
      contextmenu: (event) => {
        event.preventDefault();
        const t = this.i18n.t;
        const items: ContextMenuEntry[] = [
          { id: 'draft', label: t('editor.menu.toggleDraft'), shortcut: this.shortcutLabel('editor.draft') },
        ];
        const quickNoteId = this.quickNoteAt(event);

        if (quickNoteId !== null) {
          items.push({ divider: true }, { id: `quick:convert:${quickNoteId}`, label: t('editor.quickNote.convert') });
        }

        const table = this.editorView ? describeTableAtCursor(this.editorView.state) : null;

        if (table) {
          items.push(
            { divider: true },
            { id: 'table:addRow', label: t('editor.menu.table.insertRowBelow') },
            { id: 'table:deleteRow', label: t('editor.menu.table.deleteRow'), disabled: table.row === 0 },
            { id: 'table:addColumn', label: t('editor.menu.table.insertColumnRight') },
            { id: 'table:deleteColumn', label: t('editor.menu.table.deleteColumn'), disabled: table.columnCount <= 1 },
            { divider: true },
            { id: 'table:alignLeft', label: t('editor.menu.table.alignLeft') },
            { id: 'table:alignCenter', label: t('editor.menu.table.alignCenter') },
            { id: 'table:alignRight', label: t('editor.menu.table.alignRight') },
          );
        }

        if (this.noteExport.canExport(this.activeNote()?.id ?? null)) {
          items.push({ divider: true }, noteExportMenu(t));
        }

        this.ctxMenu.set({ items, x: event.clientX, y: event.clientY });
        return true;
      },
    });
  }

  protected onCtxAction(id: string): void {
    const view = this.editorView;
    const noteId = this.activeNote()?.id;

    if (id.startsWith('export:') && noteId !== undefined) {
      // What was typed in the last second is not saved yet: the export must include it
      void this.flushPendingSave().then(() => this.noteExport.runNoteAction(id, noteId));
    } else if (id.startsWith('quick:convert:')) {
      this.convertQuickNote(Number(id.slice('quick:convert:'.length)));
    } else if (id === 'draft' && view) {
      toggleDraft(view);
      view.focus();
    } else if (id.startsWith('table:') && view) {
      applyTableAction(view, id.slice('table:'.length) as TableAction);
    }
  }

  /** Never in the quick notes document: its lines are notes, not a file. */
  private buildLineNumbers(settings: AppSettings): Extension {
    return settings.showLineNumbers && this.activeNote()?.id !== QUICK_NOTES_TAB_ID
      ? [lineNumbers(), EditorView.editorAttributes.of({ class: 'cm-with-numbers' })]
      : [];
  }

  /** Keeps an empty line at the end of the note while the setting is on (never in the read-only overlay document). */
  private buildTrailingLine(settings: AppSettings): Extension {
    if (!settings.trailingLine) return [];
    const NEWLINE = String.fromCharCode(10);
    return EditorState.transactionFilter.of(tr => {
      const length = tr.newDoc.length;
      if (!tr.docChanged || tr.startState.readOnly || tr.newDoc.sliceString(Math.max(0, length - 1)) === NEWLINE) return tr;
      return [tr, { changes: { from: length, insert: NEWLINE }, selection: tr.newSelection, sequential: true }];
    });
  }

  private buildWrapping(settings: AppSettings): Extension {
    return settings.wordWrap ? EditorView.lineWrapping : [];
  }

  private buildScrollbar(settings: AppSettings): Extension {
    return settings.hideScrollbar ? hiddenScrollbar : [];
  }

  /** Ctrl+click on a link (or a click in the preview): a note (by `note://id` or by path) opens in a tab, a web address in the browser. */
  protected followLink(target: string): void {
    // In a collection file, relative links lead to the other files of the collection
    const file = this.fileDocs.refFor(this.activeNote()?.id ?? null);
    const relative = file && !/^[a-z][a-z0-9+.-]*:/i.test(target.trim()) ? resolveRelativeLink(file.path, target) : null;

    if (file && relative !== null) {
      this.carryViewMode();
      this.openCollectionTarget(file.root, relative);
      return;
    }

    const noteUrl = /^note:\/\/(?<id>\d+)$/.exec(target.trim());
    const notes = this.notes.notes();
    let noteId: number | null = noteUrl?.groups?.['id'] ? Number(noteUrl.groups['id']) : null;

    if (noteId === null && /^https?:\/\//i.test(target.trim())) {
      void this.bridge.openExternal(target.trim());
      return;
    }

    noteId ??= createLinkResolver(notes.filter(n => !n.tags.includes(QUICK_NOTE_TAG)), this.folders.folders())(target);

    const note = notes.find(n => n.id === noteId);

    if (note) {
      this.carryViewMode();
      this.tabs.openNote(note.id, note.title);
    }
  }

  /** A note opened by a link keeps the view mode of the note holding the link (source, side by side or preview). */
  private carryViewMode(): void {
    this.carriedViewMode = { mode: this.viewMode(), at: Date.now() };
  }

  /** The mode left by a link just followed, once: a stale one (the link opened nothing new) is ignored. */
  private takeCarriedViewMode(): EditorViewMode | null {
    const carried = this.carriedViewMode;
    this.carriedViewMode = null;

    return carried && Date.now() - carried.at < CARRIED_VIEW_MODE_MS ? carried.mode : null;
  }

  /** Files and folders of a loaded folder collection, `null` until its tree is read. */
  private collectionIndex(root: string): CollectionIndex | null {
    const state = this.collections.states().find(candidate => candidate.collection.path === root);
    const loaded = state?.status === 'ready' && state.collection.kind === 'folder';
    return loaded ? indexCollection(state.tree) : null;
  }

  /** A file opens in a tab; a folder opens its index.md or README.md, or is shown in the sidebar when it has none. */
  private openCollectionTarget(root: string, target: CollectionTarget): void {
    if (target.kind === 'file') {
      this.collections.open({ root, path: target.path });
      return;
    }
    const index = this.collectionIndex(root);
    const page = index ? folderPage(index, target.path) : null;

    if (page) {
      this.collections.open({ root, path: page });
    } else {
      this.collections.revealFolder(root, index?.folders.get(target.path.toLowerCase()) ?? target.path);
    }
  }

  private buildThemeMode(): Extension {
    return EditorView.darkTheme.of(this.themeService.kind() === 'dark');
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
          insertLink(view);
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
    if (id === QUICK_NOTES_TAB_ID) return;
    const file = this.fileDocs.refFor(id);

    if (file) {
      await this.saveFile(id, file, content);
      return;
    }

    try {
      const title = this.notes.extractTitle(content);
      const previousTitle = this.notes.notes().find(n => n.id === id)?.title;
      await this.notes.update(id, { content, title });

      if (previousTitle !== undefined && previousTitle !== title) {
        this.linkRename.notifyTitleChanged(id, previousTitle);
      }

      this.tabs.markDirty(id, false);
      this.tabs.updateTitle(id, title);
      this.activeNote.update(n => n ? { ...n, title, content } : n);
    } catch (err) {
      console.error('[Editor] Failed to save note:', err);
    }
  }

  /** A collection file shown as a note; unreadable (moved, deleted), it opens empty with a banner. */
  private async buildFileDocument(id: number, file: CollectionFileRef): Promise<Note> {
    let content = '';

    try {
      content = await this.collections.read(file);
      this.fileContentOnDisk = content;
    } catch {
      this.fileContentOnDisk = null;
      this.fileBanner.set({ kind: 'unreadable', path: file.path, error: '' });
    }

    return { id, title: baseName(file.path), content, tags: [], folderId: null, sortOrder: null, color: null, createdAt: '', updatedAt: '' };
  }

  private async saveFile(id: number, file: CollectionFileRef, content: string): Promise<void> {
    try {
      this.fileContentOnDisk = content;
      await this.collections.write(file, content);
      this.tabs.markDirty(id, false);
      this.activeNote.update(n => (n ? { ...n, content } : n));
    } catch (err) {
      this.fileContentOnDisk = null;
      this.fileBanner.set({ kind: 'unsaved', path: file.path, error: err instanceof Error ? err.message : String(err) });
    }
  }

  /** Reloads the open note from the stored list when it changed elsewhere and the editor holds no unsaved edit. */
  private onExternalNoteChange(notes: readonly Note[]): void {
    const open = this.activeNote();
    const view = this.editorView;

    if (!open || !view || open.id === QUICK_NOTES_TAB_ID || this.fileDocs.isFileDoc(open.id)) {
      return;
    }

    const stored = notes.find(n => n.id === open.id);
    const dirty = this.tabs.tabs().find(tab => tab.noteId === open.id)?.isDirty ?? false;
    const content = externallyChangedContent(open.content, stored?.content, view.state.doc.toString(), dirty);

    if (content === null || !stored) {
      return;
    }

    this.isUpdatingFromModel = true;
    view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: content } });
    this.isUpdatingFromModel = false;
    this.activeNote.set(stored);
    this.tabs.updateTitle(stored.id, stored.title);
  }

  /** The open file changed on disk: reloaded when it holds no unsaved edit, otherwise the user chooses. */
  private async onDiskChange(change: { root: string; paths: string[] } | null): Promise<void> {
    const note = this.activeNote();
    const file = this.fileDocs.refFor(note?.id ?? null);

    if (!change || !note || !file || change.root !== file.root || !change.paths.includes(file.path)) {
      return;
    }

    const content = await this.collections.read(file).catch(() => null);

    // Our own save, or nothing new
    if (content === null || content === this.fileContentOnDisk || content === this.editorView?.state.doc.toString()) {
      return;
    }

    const dirty = this.tabs.tabs().find(tab => tab.noteId === note.id)?.isDirty ?? false;

    if (dirty) {
      this.fileBanner.set({ kind: 'conflict', path: file.path, error: '' });
    } else {
      this.replaceContent(content);
    }
  }

  protected async reloadFromDisk(): Promise<void> {
    const file = this.fileDocs.refFor(this.activeNote()?.id ?? null);
    this.fileBanner.set(null);

    if (file) {
      if (this.saveDebounce) {
        clearTimeout(this.saveDebounce);
        this.saveDebounce = null;
      }
      this.replaceContent(await this.collections.read(file));
      this.tabs.markDirty(this.activeNote()?.id ?? 0, false);
    }
  }

  /** Puts the disk content in the editor without it counting as an edit to save. */
  private replaceContent(content: string): void {
    const view = this.editorView;

    if (!view) {
      return;
    }

    this.fileContentOnDisk = content;
    this.isUpdatingFromModel = true;
    view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: content } });
    this.isUpdatingFromModel = false;
    this.activeNote.update(n => (n ? { ...n, content } : n));
  }

  /** Ctrl+F (find only) / Ctrl+H (with replace). */
  openSearch(withReplace = false): void {
    this.find.open(withReplace);
  }

  closeSearch(): void {
    this.find.close();
  }

  focusEditor(): void {
    this.editorView?.focus();
  }
}
