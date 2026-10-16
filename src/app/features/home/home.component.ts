import {
  Component, inject, signal, computed, ChangeDetectionStrategy
} from '@angular/core';

import { FoldersService } from '../../core/services/folders.service';
import { CollectionsService } from '../../core/services/collections.service';
import { SidebarStateService } from '../../core/services/sidebar-state.service';
import { NotesService } from '../../core/services/notes.service';
import { TabsService } from '../../core/services/tabs.service';
import { HomeView, LayoutService } from '../../core/services/layout.service';
import { SettingsService } from '../../core/services/settings.service';
import { NotePreview } from '../../core/models/note.model';
import { parseNoteDate } from '../../core/utils/note-timestamp.util';
import { OVERLAY_NOTE_TAG } from '../../core/models/settings.model';
import { GraphViewComponent } from '../graph/graph-view.component';
import { ContextMenuComponent, ContextMenuEntry } from '../../shared/context-menu/context-menu.component';

@Component({
  selector: 'app-home',
  standalone: true,
  imports: [ContextMenuComponent, GraphViewComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="home" [class.graph-mode]="view() === 'graph'">
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
          <h1 class="home-title">{{ title() }}</h1>
        </div>
        <div class="view-switch" role="group" aria-label="Home view">
          <button type="button" class="view-btn" [class.active]="view() === 'graph'" (click)="setView('graph')">Graph</button>
          <button type="button" class="view-btn" [class.active]="view() === 'list'" (click)="setView('list')">List</button>
        </div>
      </div>

      @if (view() === 'graph') {
        <app-graph-view />
      } @else {
      <div class="notes-list">
        @if (filteredNotes().length === 0) {
          <div class="empty-state">
            <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1">
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
              <polyline points="14 2 14 8 20 8"/>
            </svg>
            <p>No notes here. Press <kbd>{{ shortcutLabel('note.new') }}</kbd> to create one.</p>
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
      }
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
export class HomeComponent {
  private notesService = inject(NotesService);
  private settingsService = inject(SettingsService);
  private tabsService = inject(TabsService);
  private foldersService = inject(FoldersService);
  private sidebarState = inject(SidebarStateService);
  private readonly collections = inject(CollectionsService);
  private layout = inject(LayoutService);

  readonly view = this.layout.homeView;

  /** The folder (and the tag) selected in the sidebar drive what is listed here. */
  readonly title = computed(() => {
    const collection = this.collections.selectedState();

    if (collection) {
      return collection.label;
    }

    const folderId = this.sidebarState.selectedFolderId();
    const tag = this.sidebarState.activeTag();
    const base = folderId === null ? 'All notes' : (this.foldersService.getById(folderId)?.name ?? 'All notes');

    return tag ? `${base} · #${tag}` : base;
  });

  readonly filteredNotes = computed<NotePreview[]>(() => {
    const tag = this.sidebarState.activeTag();
    const folderId = this.sidebarState.selectedFolderId();
    const previews = this.notesService.notePreviews();
    // Overlay notes are not listed one by one: they live together in the "Overlay notes" document
    return previews.filter(n =>
      !n.tags.includes(OVERLAY_NOTE_TAG)
      && (folderId === null || n.folderId === folderId)
      && (!tag || n.tags.includes(tag))
    );
  });

  // ── Context menu ───────────────────────────────────────────────────────────
  readonly ctxMenu = signal<{ items: ContextMenuEntry[]; x: number; y: number; noteId: number } | null>(null);

  setView(view: HomeView): void {
    this.layout.setHomeView(view);
  }

  openNote(note: NotePreview): void {
    this.tabsService.openNote(note.id, note.title || 'Untitled');
  }

  protected shortcutLabel(id: string): string {
    return this.settingsService.shortcutLabel(id);
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
    const d = parseNoteDate(isoDate);
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
