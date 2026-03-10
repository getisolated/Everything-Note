import {
  Component, inject, OnDestroy, signal, computed, effect,
  ViewChild, ElementRef, ChangeDetectionStrategy
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { PaletteService } from '../../core/services/palette.service';
import { NotesService } from '../../core/services/notes.service';
import { TabsService } from '../../core/services/tabs.service';
import { PaletteResult } from '../../core/models/note.model';

@Component({
  selector: 'app-palette',
  standalone: true,
  imports: [CommonModule, FormsModule],
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
                  (mouseenter)="selectedIndex.set(i)"
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
                      <span class="item-label">{{ result.note!.title }}</span>
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

                  @if (result.type === 'tag') {
                    <div class="item-icon">
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"/><line x1="7" y1="7" x2="7.01" y2="7"/>
                      </svg>
                    </div>
                    <div class="item-content">
                      <span class="item-label">#{{ result.tag }}</span>
                      <span class="item-desc">Filter by tag</span>
                    </div>
                  }
                </div>
              }
            </div>
          } @else if (query && !loading()) {
            <div class="palette-empty">No results for "{{ query }}"</div>
          }
        </div>
      </div>
    }
  `,
  styleUrls: ['./palette.component.scss'],
})
export class PaletteComponent implements OnDestroy {
  private palette = inject(PaletteService);
  private notes = inject(NotesService);
  private tabs = inject(TabsService);

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
      case 'search': return 'Search all notes... (or #tag to filter)';
      case 'tag': return 'Filter by tag...';
      default: return 'Type a command or note name...';
    }
  });

  private readonly commands: PaletteResult[] = [
    {
      type: 'command',
      command: {
        id: 'new-note', label: 'New Note', shortcut: 'Ctrl+N',
        description: 'Create a new empty note', category: 'note',
        action: () => this.createNote(),
      }
    },
    {
      type: 'command',
      command: {
        id: 'global-search', label: 'Search Notes', shortcut: 'Ctrl+Shift+F',
        description: 'Search across all notes', category: 'note',
        action: () => { this.palette.open('search'); }
      }
    },
    {
      type: 'command',
      command: {
        id: 'close-tab', label: 'Close Tab', shortcut: 'Ctrl+W',
        description: 'Close the current tab', category: 'action',
        action: () => this.tabs.closeActiveTab(),
      }
    },
    {
      type: 'command',
      command: {
        id: 'next-tab', label: 'Next Tab', shortcut: 'Ctrl+Tab',
        description: 'Switch to next tab', category: 'action',
        action: () => this.tabs.nextTab(),
      }
    },
    {
      type: 'command',
      command: {
        id: 'prev-tab', label: 'Previous Tab', shortcut: 'Ctrl+Shift+Tab',
        description: 'Switch to previous tab', category: 'action',
        action: () => this.tabs.prevTab(),
      }
    },
  ];

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
  }

  ngOnDestroy(): void {
    if (this.searchDebounce) clearTimeout(this.searchDebounce);
  }

  close(): void { this.palette.close(); }
  clearQuery(): void { this.query = ''; this.onQueryChange(''); }

  onQueryChange(query: string): void {
    this.selectedIndex.set(0);
    if (this.searchDebounce) clearTimeout(this.searchDebounce);
    this.searchDebounce = setTimeout(() => this.search(query), 80);
  }

  private async search(query: string): Promise<void> {
    const mode = this.mode();

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
      this._results.set([...cmdResults, ...noteResults]);
    } else {
      this._results.set(noteResults);
    }
  }

  async execute(result: PaletteResult): Promise<void> {
    this.palette.close();
    await new Promise(r => setTimeout(r, 10));

    if (result.type === 'command') {
      result.command!.action();
    } else if (result.type === 'note') {
      this.tabs.openNote(result.note!.id, result.note!.title);
    } else if (result.type === 'tag') {
      this.palette.open('search', '#' + result.tag);
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

  private async createNote(): Promise<void> {
    const note = await this.notes.create();
    this.tabs.openNote(note.id, note.title || 'Untitled');
  }
}
