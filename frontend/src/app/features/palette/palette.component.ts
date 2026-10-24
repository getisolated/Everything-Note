import {
  Component, inject, OnDestroy, signal, computed, effect, untracked,
  ViewChild, ElementRef, ChangeDetectionStrategy
} from '@angular/core';

import { FormsModule } from '@angular/forms';
import { PaletteService } from '../../core/services/palette.service';
import { NotesService } from '../../core/services/notes.service';
import { TabsService } from '../../core/services/tabs.service';
import { SettingsService } from '../../core/services/settings.service';
import { LayoutService } from '../../core/services/layout.service';
import { CollectionsService } from '../../core/services/collections.service';
import { NoteExportService } from '../../core/services/note-export.service';
import { ThemeService } from '../../core/services/theme.service';
import { PaletteResult } from '../../core/models/note.model';
import { I18nService } from '../../core/i18n/i18n.service';
import { noteDisplayTitle } from '../../core/utils/note-title.util';
import { buildThemePickerItems } from '../../core/utils/theme.util';

@Component({
  selector: 'app-palette',
  standalone: true,
  imports: [FormsModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (isOpen()) {
      <div class="palette-backdrop" (click)="close()">
        <div class="palette-panel" (click)="$event.stopPropagation()" (keydown)="onKeydown($event)">
          <div class="palette-input-wrap">
            <svg class="palette-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/>
            </svg>
            <input
              #inputEl
              class="palette-input"
              [placeholder]="placeholder()"
              [(ngModel)]="query"
              (ngModelChange)="onQueryChange($event)"
              autocomplete="off"
              spellcheck="false"
            />
            @if (query) {
              <button class="palette-clear" (click)="clearQuery()" tabindex="-1">×</button>
            }
          </div>

          @if (results().length > 0) {
            <div class="palette-results">
              @for (result of results(); track $index; let i = $index) {
                <div
                  class="palette-item"
                  [class.selected]="i === selectedIndex()"
                  (click)="execute(result)"
                  (mouseenter)="onItemHover(i)"
                >
                  @if (result.type === 'command') {
                    <div class="item-icon">
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <polyline points="9 11 12 14 22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/>
                      </svg>
                    </div>
                    <div class="item-content">
                      <span class="item-label">{{ result.command!.label }}</span>
                      @if (result.command!.description) {
                        <span class="item-desc">{{ result.command!.description }}</span>
                      }
                    </div>
                    @if (result.command!.shortcut) {
                      <kbd class="item-shortcut">{{ result.command!.shortcut }}</kbd>
                    }
                  }

                  @if (result.type === 'note') {
                    <div class="item-icon note-icon">
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/>
                      </svg>
                    </div>
                    <div class="item-content">
                      <span class="item-label">{{ noteTitle(result.note!.title) }}</span>
                      @if (result.note!.preview) {
                        <span class="item-desc">{{ result.note!.preview }}</span>
                      }
                    </div>
                    @if (result.note!.tags.length > 0) {
                      <div class="item-tags">
                        @for (tag of result.note!.tags.slice(0, 3); track tag) {
                          <span class="tag-chip">{{ tag }}</span>
                        }
                      </div>
                    }
                  }

                  @if (result.type === 'file') {
                    <div class="item-icon file-icon">
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <path d="M2 6a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2z"/><path d="M2 10h20"/>
                      </svg>
                    </div>
                    <div class="item-content">
                      <span class="item-label">{{ result.file!.label }}</span>
                      @if (result.file!.preview) {
                        <span class="item-desc">{{ result.file!.preview }}</span>
                      }
                    </div>
                  }

                  @if (result.type === 'tag') {
                    <div class="item-icon">
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"/><line x1="7" y1="7" x2="7.01" y2="7"/>
                      </svg>
                    </div>
                    <div class="item-content">
                      <span class="item-label">#{{ result.tag }}</span>
                      <span class="item-desc">{{ i18n.t('workspace.palette.filterByTag') }}</span>
                    </div>
                  }

                  @if (result.type === 'theme') {
                    <div class="item-icon">
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                        <circle cx="13.5" cy="6.5" r=".5"/><circle cx="17.5" cy="10.5" r=".5"/><circle cx="8.5" cy="7.5" r=".5"/><circle cx="6.5" cy="12.5" r=".5"/>
                        <path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10c.93 0 1.65-.75 1.65-1.69 0-.44-.18-.84-.44-1.13-.29-.29-.44-.65-.44-1.13a1.64 1.64 0 0 1 1.67-1.67h2c3.05 0 5.56-2.5 5.56-5.55C21.97 6.01 17.46 2 12 2z"/>
                      </svg>
                    </div>
                    <div class="item-content">
                      <span class="item-label">{{ result.theme!.label }}</span>
                      <span class="item-desc">{{ result.theme!.detail }}</span>
                    </div>
                  }
                </div>
              }
            </div>
          } @else if (query && !loading()) {
            <div class="palette-empty">{{ i18n.t('workspace.palette.noResults', { query }) }}</div>
          }
        </div>
      </div>
    }
  `,
  styleUrls: ['./palette.component.scss'],
})
export class PaletteComponent implements OnDestroy {
  protected readonly i18n = inject(I18nService);
  private palette = inject(PaletteService);
  private notes = inject(NotesService);
  private tabs = inject(TabsService);
  private settings = inject(SettingsService);
  private layout = inject(LayoutService);
  private collections = inject(CollectionsService);
  /** Stops the content search of the collections still running for the previous query. */
  private cancelFileSearch: (() => void) | null = null;
  private noteExport = inject(NoteExportService);
  private themeService = inject(ThemeService);

  @ViewChild('inputEl') inputEl!: ElementRef<HTMLInputElement>;

  readonly isOpen = this.palette.isOpen;
  readonly mode = this.palette.mode;

  query = '';
  readonly selectedIndex = signal(0);
  readonly loading = signal(false);
  private _results = signal<PaletteResult[]>([]);
  readonly results = this._results.asReadonly();

  private searchDebounce: ReturnType<typeof setTimeout> | null = null;

  readonly placeholder = computed(() => {
    switch (this.mode()) {
      case 'search': return this.i18n.t('workspace.palette.placeholderSearch');
      case 'tag': return this.i18n.t('workspace.palette.placeholderTag');
      case 'theme': return this.i18n.t('workspace.palette.placeholderTheme');
      default: return this.i18n.t('workspace.palette.placeholderCommand');
    }
  });

  // A getter: the displayed shortcuts follow the user's bindings
  private get commands(): PaletteResult[] {
    return [
      {
        type: 'command',
        command: {
          id: 'new-note', label: this.i18n.t('workspace.palette.cmd.newNote'), shortcut: this.settings.shortcutLabel('note.new'),
          description: this.i18n.t('workspace.palette.cmd.newNoteDesc'), category: 'note',
          action: () => this.createNote(),
        }
      },
      {
        type: 'command',
        command: {
          id: 'global-search', label: this.i18n.t('workspace.palette.cmd.searchNotes'), shortcut: this.settings.shortcutLabel('search.global'),
          description: this.i18n.t('workspace.palette.cmd.searchNotesDesc'), category: 'note',
          action: () => { this.palette.open('search'); }
        }
      },
      {
        type: 'command',
        command: {
          id: 'quick-notes', label: this.i18n.t('workspace.palette.cmd.quickNotes'),
          description: this.i18n.t('workspace.palette.cmd.quickNotesDesc'), category: 'note',
          action: () => this.tabs.openQuickNotes(),
        }
      },
      {
        type: 'command',
        command: {
          id: 'graph-view', label: this.i18n.t('workspace.palette.cmd.graphView'),
          description: this.i18n.t('workspace.palette.cmd.graphViewDesc'), category: 'note',
          action: () => this.openGraphView(),
        }
      },
      {
        type: 'command',
        command: {
          id: 'copy-note-link', label: this.i18n.t('workspace.palette.cmd.copyNoteLink'),
          description: this.i18n.t('workspace.palette.cmd.copyNoteLinkDesc'), category: 'note',
          action: () => { void this.copyNoteLink(); },
        }
      },
      ...this.exportCommands(),
      {
        type: 'command',
        command: {
          id: 'close-tab', label: this.i18n.t('workspace.palette.cmd.closeTab'), shortcut: this.settings.shortcutLabel('tab.close'),
          description: this.i18n.t('workspace.palette.cmd.closeTabDesc'), category: 'action',
          action: () => this.tabs.closeActiveTab(),
        }
      },
      {
        type: 'command',
        command: {
          id: 'next-tab', label: this.i18n.t('workspace.palette.cmd.nextTab'), shortcut: this.settings.shortcutLabel('tab.next'),
          description: this.i18n.t('workspace.palette.cmd.nextTabDesc'), category: 'action',
          action: () => this.tabs.nextTab(),
        }
      },
      {
        type: 'command',
        command: {
          id: 'prev-tab', label: this.i18n.t('workspace.palette.cmd.prevTab'), shortcut: this.settings.shortcutLabel('tab.prev'),
          description: this.i18n.t('workspace.palette.cmd.prevTabDesc'), category: 'action',
          action: () => this.tabs.prevTab(),
        }
      },
      {
        type: 'command',
        command: {
          id: 'color-theme', label: this.i18n.t('workspace.palette.cmd.colorTheme'), shortcut: this.settings.shortcutLabel('theme.select'),
          description: this.i18n.t('workspace.palette.cmd.colorThemeDesc'), category: 'settings',
          action: () => this.palette.open('theme'),
        }
      },
      {
        type: 'command',
        command: {
          id: 'settings', label: this.i18n.t('workspace.palette.cmd.settings'), shortcut: this.settings.shortcutLabel('settings.open'),
          description: this.i18n.t('workspace.palette.cmd.settingsDesc'), category: 'settings',
          action: () => this.settings.open(),
        }
      },
    ];
  }

  constructor() {
    // React to open/close state changes via Angular effect (replaces setInterval polling)
    effect(() => {
      const open = this.isOpen();
      if (open) {
        this.query = this.palette.initialQuery();
        setTimeout(() => {
          this.inputEl?.nativeElement.focus();
          this.inputEl?.nativeElement.select();
        }, 50);
        this.onQueryChange(this.query);
      } else {
        this.query = '';
        this._results.set([]);
        this.selectedIndex.set(0);
      }
    });

    // The theme picker previews the highlighted theme; anything else (closing included) shows the saved one again
    effect(() => {
      const highlighted = this.isOpen() && this.mode() === 'theme' ? this.results()[this.selectedIndex()]?.theme : undefined;
      untracked(() => this.themeService.preview(highlighted?.id ?? null));
    });
  }

  ngOnDestroy(): void {
    if (this.searchDebounce) clearTimeout(this.searchDebounce);
    this.cancelFileSearch?.();
  }

  protected noteTitle(title: string): string { return noteDisplayTitle(title, this.i18n.t); }

  close(): void { this.palette.close(); }
  clearQuery(): void { this.query = ''; this.onQueryChange(''); }

  onQueryChange(query: string): void {
    this.selectedIndex.set(0);
    if (this.searchDebounce) clearTimeout(this.searchDebounce);
    this.searchDebounce = setTimeout(() => this.search(query), 80);
  }

  private async search(query: string): Promise<void> {
    const mode = this.mode();
    this.cancelFileSearch?.();
    this.cancelFileSearch = null;

    if (mode === 'theme') {
      this.searchThemes(query);
      return;
    }

    if (mode === 'command' && !query.trim()) {
      this._results.set(this.commands);
      return;
    }

    if (mode === 'command' && query.startsWith('#')) {
      // Tag filter
      const tags = await this.notes.getAllTags();
      const tagQuery = query.slice(1).toLowerCase();
      const tagResults: PaletteResult[] = tags
        .filter(t => t.toLowerCase().includes(tagQuery))
        .map(t => ({ type: 'tag', tag: t }));
      this._results.set(tagResults);
      return;
    }

    if (mode === 'tag') {
      const tag = query.replace(/^#/, '').trim();
      if (!tag) { this._results.set([]); return; }
      const notes = await this.notes.getByTag(tag);
      this._results.set(notes.map(n => ({ type: 'note', note: n })));
      return;
    }

    // Search / command with query
    const searchResults = await this.notes.search(query);
    const noteResults: PaletteResult[] = searchResults
      .slice(0, 8)
      .map(n => ({ type: 'note', note: n }));

    if (mode === 'command') {
      const cmdResults = this.commands.filter(r =>
        r.command!.label.toLowerCase().includes(query.toLowerCase())
      );
      this._results.set([...cmdResults, ...noteResults, ...this.fileNameResults(query)]);
    } else {
      this._results.set([...noteResults, ...this.fileNameResults(query)]);
      void this.searchFileContents(query);
    }
  }

  /** Collection files whose name matches: instant, from the trees already loaded. */
  private fileNameResults(query: string): PaletteResult[] {
    const needle = query.trim().toLowerCase();

    if (!needle) {
      return [];
    }

    return this.collections.files()
      .filter(file => file.ref.path.toLowerCase().includes(needle))
      .slice(0, 8)
      .map(file => ({ type: 'file', file: { ref: file.ref, label: file.label } }));
  }

  /** Then the lines of their content (read by the collections worker), appended as they arrive. */
  private async searchFileContents(query: string): Promise<void> {
    if (!query.trim()) {
      return;
    }

    const cancel = await this.collections.searchFiles(query, hit => {
      const shown = new Set(this._results().filter(r => r.type === 'file').map(r => `${r.file!.ref.root}\u0000${r.file!.ref.path}\u0000${r.file!.preview ?? ''}`));
      const additions: PaletteResult[] = hit.matches
        .map(match => ({ type: 'file' as const, file: { ref: hit.ref, label: `${hit.label}:${match.line}`, preview: match.text.trim() } }))
        .filter(result => !shown.has(`${result.file.ref.root}\u0000${result.file.ref.path}\u0000${result.file.preview}`));

      if (additions.length > 0 && this.query === query) {
        this._results.update(results => [...results, ...additions]);
      }
    }, () => undefined);

    this.cancelFileSearch = cancel;
  }

  private searchThemes(query: string): void {
    const settings = this.settings.settings();
    const systemThemes = { dark: settings.preferredDarkTheme, light: settings.preferredLightTheme };
    const needle = query.trim().toLowerCase();
    const items = buildThemePickerItems(systemThemes, settings.theme, this.i18n.t).filter(item => item.label.toLowerCase().includes(needle));

    this._results.set(items.map(item => ({ type: 'theme', theme: item })));

    // Opens on the current theme, like VS Code
    if (!needle) {
      this.selectedIndex.set(Math.max(0, items.findIndex(item => item.id === settings.theme)));
    }
  }

  /** In the theme picker the mouse does not move the highlight: it would preview every theme it crosses. */
  onItemHover(index: number): void {
    if (this.mode() !== 'theme') {
      this.selectedIndex.set(index);
    }
  }

  async execute(result: PaletteResult): Promise<void> {
    if (result.type === 'theme') {
      // Saved before closing: closing ends the preview, which would otherwise flash the previous theme
      await this.themeService.select(result.theme!.id);
      this.palette.close();
      return;
    }

    this.palette.close();
    await new Promise(r => setTimeout(r, 10));

    if (result.type === 'command') {
      result.command!.action();
    } else if (result.type === 'note') {
      this.tabs.openNote(result.note!.id, result.note!.title);
    } else if (result.type === 'tag') {
      this.palette.open('search', '#' + result.tag);
    } else if (result.type === 'file') {
      this.collections.open(result.file!.ref);
    }
  }

  onKeydown(event: KeyboardEvent): void {
    const total = this.results().length;
    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault();
        this.selectedIndex.update(i => (i + 1) % Math.max(1, total));
        break;
      case 'ArrowUp':
        event.preventDefault();
        this.selectedIndex.update(i => (i - 1 + Math.max(1, total)) % Math.max(1, total));
        break;
      case 'Enter': {
        event.preventDefault();
        const result = this.results()[this.selectedIndex()];
        if (result) this.execute(result);
        break;
      }
      case 'Escape':
        event.preventDefault();
        event.stopPropagation();
        this.close();
        break;
    }
  }

  /** Copy / export of the note being edited (none on the home page or the quick notes). */
  private exportCommands(): PaletteResult[] {
    const noteId = this.tabs.activeNoteId();

    if (noteId === null || !this.noteExport.canExport(noteId)) {
      return [];
    }

    const command = (id: string, key: 'copyNoteContent' | 'exportNoteMd' | 'exportNoteHtml' | 'exportNotePdf', actionId: string): PaletteResult => ({
      type: 'command',
      command: {
        id,
        label: this.i18n.t(`workspace.palette.cmd.${key}`),
        description: this.i18n.t(`workspace.palette.cmd.${key}Desc`),
        category: 'note',
        action: () => { void this.noteExport.runNoteAction(actionId, noteId); },
      },
    });

    return [
      command('copy-note-content', 'copyNoteContent', 'export:copy'),
      command('export-note-md', 'exportNoteMd', 'export:md'),
      command('export-note-html', 'exportNoteHtml', 'export:html'),
      command('export-note-pdf', 'exportNotePdf', 'export:pdf'),
    ];
  }

  private openGraphView(): void {
    this.layout.setHomeView('graph');
    this.tabs.goHome();
  }

  private async copyNoteLink(): Promise<void> {
    const noteId = this.tabs.activeNoteId();

    // Only real notes (positive ids) have a note:// link: not the quick notes, nor the collection files
    if (noteId !== null && noteId > 0) {
      await navigator.clipboard.writeText(`note://${noteId}`);
    }
  }

  private async createNote(): Promise<void> {
    const note = await this.notes.create();
    this.tabs.openNote(note.id, note.title);
  }
}
