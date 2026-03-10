import {
  Component, inject, OnInit, signal, computed, ChangeDetectionStrategy
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { NotesService } from '../../core/services/notes.service';
import { TabsService } from '../../core/services/tabs.service';
import { PaletteService } from '../../core/services/palette.service';
import { NotePreview } from '../../core/models/note.model';
import { ContextMenuComponent, ContextMenuEntry } from '../../shared/context-menu/context-menu.component';

@Component({
  selector: 'app-home',
  standalone: true,
  imports: [CommonModule, ContextMenuComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="home">
      <div class="home-inner">
      <div class="home-header">
        <div class="home-brand">
          <svg class="brand-logo" width="28" height="28" viewBox="0 0 1000 1000" preserveAspectRatio="xMidYMid meet">
            <g transform="translate(0,1000) scale(0.1,-0.1)" fill="currentColor" stroke="none">
              <path d="M4605 7590 l-380 -5 -3 -537 -2 -538 -1400 0 -1400 0 2 -405 3 -406 1267 1 c779 0 1269 -3 1272 -9 4 -5 6 -254 6 -553 l1 -543 -1276 -3 -1275 -2 0 -520 0 -520 1400 -2 1400 -3 3 -570 2 -570 383 -5 c210 -3 387 -3 392 -2 16 6 14 5189 -2 5193 -7 2 -184 2 -393 -1z"/>
              <path d="M6660 7581 c0 -7 38 -68 83 -135 46 -66 248 -364 449 -661 200 -297 512 -758 693 -1025 181 -267 407 -601 502 -742 96 -142 176 -258 179 -258 2 0 4 637 4 1415 l0 1415 -955 2 c-799 3 -955 1 -955 -11z"/>
              <path d="M6650 3784 c0 -760 2 -1383 4 -1385 2 -2 433 -3 956 -1 753 2 951 5 947 15 -2 6 -256 374 -562 817 -307 443 -597 861 -645 930 -333 482 -684 987 -691 995 -5 5 -9 -573 -9 -1371z"/>
            </g>
          </svg>
          <h1 class="home-title">Everything Note</h1>
        </div>
        <div class="home-actions">
          <button class="search-btn" (click)="openSearch()" title="Search (Ctrl+Shift+F)">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/>
            </svg>
            Search
          </button>
          <button class="new-btn" (click)="createNote()" title="New note (Ctrl+N)">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
            </svg>
            New note
          </button>
        </div>
      </div>

      @if (allTags().length > 0) {
        <div class="tag-filters">
          <button
            class="tag-filter"
            [class.active]="activeTag() === null"
            (click)="setActiveTag(null)"
          >All</button>
          @for (tag of allTags(); track tag) {
            <button
              class="tag-filter"
              [class.active]="activeTag() === tag"
              (click)="setActiveTag(tag)"
            >#{{ tag }}</button>
          }
        </div>
      }

      <div class="notes-list">
        @if (filteredNotes().length === 0) {
          <div class="empty-state">
            <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1">
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
              <polyline points="14 2 14 8 20 8"/>
            </svg>
            <p>No notes yet. Press <kbd>Ctrl+N</kbd> to create one.</p>
          </div>
        }
        @for (note of filteredNotes(); track note.id) {
          <div
            class="note-row"
            (click)="openNote(note)"
            (contextmenu)="onNoteContextMenu($event, note)"
            tabindex="0"
            (keydown.enter)="openNote(note)"
          >
            <div class="note-main">
              <span class="note-title">{{ note.title || 'Untitled' }}</span>
              @if (note.tags.length > 0) {
                <div class="note-tags">
                  @for (tag of note.tags.slice(0, 3); track tag) {
                    <span class="tag-bubble">{{ tag }}</span>
                  }
                  @if (note.tags.length > 3) {
                    <span class="tag-bubble overflow">+{{ note.tags.length - 3 }}</span>
                  }
                </div>
              }
            </div>
            <span class="note-date" [title]="note.updatedAt">{{ formatDate(note.updatedAt) }}</span>
          </div>
        }
      </div>
      </div>
    </div>

    @if (ctxMenu()) {
      <app-context-menu
        [items]="ctxMenu()!.items"
        [x]="ctxMenu()!.x"
        [y]="ctxMenu()!.y"
        (action)="onCtxAction($event)"
        (closed)="ctxMenu.set(null)"
      />
    }
  `,
  styleUrls: ['./home.component.scss'],
})
export class HomeComponent implements OnInit {
  private notesService = inject(NotesService);
  private tabsService = inject(TabsService);
  private paletteService = inject(PaletteService);

  readonly allTags = signal<string[]>([]);
  readonly activeTag = signal<string | null>(null);

  readonly filteredNotes = computed<NotePreview[]>(() => {
    const tag = this.activeTag();
    const previews = this.notesService.notePreviews();
    if (!tag) return previews;
    return previews.filter(n => n.tags.includes(tag));
  });

  // ── Context menu ───────────────────────────────────────────────────────────
  readonly ctxMenu = signal<{ items: ContextMenuEntry[]; x: number; y: number; noteId: number } | null>(null);

  async ngOnInit(): Promise<void> {
    const tags = await this.notesService.getAllTags();
    this.allTags.set(tags);
  }

  openNote(note: NotePreview): void {
    this.tabsService.openNote(note.id, note.title || 'Untitled');
  }

  openSearch(): void {
    this.paletteService.open('search');
  }

  async createNote(): Promise<void> {
    const note = await this.notesService.create();
    this.tabsService.openNote(note.id, 'Untitled');
  }

  setActiveTag(tag: string | null): void {
    this.activeTag.set(tag);
  }

  onNoteContextMenu(event: MouseEvent, note: NotePreview): void {
    event.preventDefault();
    event.stopPropagation();

    const deleteIcon = 'M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2';

    const items: ContextMenuEntry[] = [
      { id: 'delete', label: 'Delete Note', icon: deleteIcon, danger: true },
    ];

    this.ctxMenu.set({ items, x: event.clientX, y: event.clientY, noteId: note.id });
  }

  async onCtxAction(actionId: string): Promise<void> {
    const menu = this.ctxMenu();
    if (!menu) return;

    if (actionId === 'delete') {
      this.tabsService.closeByNoteId(menu.noteId);
      await this.notesService.delete(menu.noteId);
    }
    this.ctxMenu.set(null);
  }

  formatDate(isoDate: string): string {
    if (!isoDate) return '';
    const d = new Date(isoDate);
    if (isNaN(d.getTime())) return '';
    const now = new Date();
    const isToday =
      d.getDate() === now.getDate() &&
      d.getMonth() === now.getMonth() &&
      d.getFullYear() === now.getFullYear();
    if (isToday) {
      return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    }
    return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
  }
}
