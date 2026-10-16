import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';

import {
  DropPlacement,
  FolderTreeNode,
  FolderTreeRow,
  FOLDER_RECOMMENDED_MAX_DEPTH,
  SidebarDialogState,
  SidebarDragItem,
  TreeNote,
} from '../../core/models/folder.model';
import { OVERLAY_NOTE_TAG } from '../../core/models/settings.model';
import { FoldersService } from '../../core/services/folders.service';
import { NotesService } from '../../core/services/notes.service';
import { PaletteService } from '../../core/services/palette.service';
import { SettingsService } from '../../core/services/settings.service';
import { SidebarStateService } from '../../core/services/sidebar-state.service';
import { TabsService } from '../../core/services/tabs.service';
import { UpdateService } from '../../core/services/update.service';
import {
  buildFolderTree,
  canMoveFolder,
  compareNotes,
  flattenVisibleTree,
  folderDepth,
  insertSibling,
  resolveFolderRowDrop,
  resolveNoteRowDrop,
} from '../../core/utils/folder-tree.util';
import { ContextMenuComponent, ContextMenuEntry } from '../../shared/context-menu/context-menu.component';
import { ConfirmDialogAction, ConfirmDialogComponent } from '../../shared/ui/confirm-dialog.component';
import { FocusSelectDirective } from '../../shared/ui/focus-select.directive';
import { CollectionsSectionComponent } from './collections-section.component';

const NEW_FOLDER_NAME = 'New folder';

const ICON_NEW_NOTE = 'M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8zM14 2v6h6M12 18v-6M9 15h6';
const ICON_NEW_FOLDER = 'M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2zM12 11v6M9 14h6';
const ICON_RENAME = 'M12 20h9M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4z';
const ICON_DELETE = 'M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2';

@Component({
  selector: 'app-sidebar',
  standalone: true,
  imports: [ContextMenuComponent, ConfirmDialogComponent, FocusSelectDirective, CollectionsSectionComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    '[style.width.px]': 'width()',
  },
  templateUrl: './sidebar.component.html',
  styleUrls: ['./sidebar.component.scss'],
})
export class SidebarComponent {
  private readonly notesService = inject(NotesService);
  private readonly foldersService = inject(FoldersService);
  private readonly state = inject(SidebarStateService);
  private readonly tabs = inject(TabsService);
  private readonly palette = inject(PaletteService);
  private readonly settings = inject(SettingsService);
  private readonly updates = inject(UpdateService);

  protected readonly updateInfo = this.updates.info;
  protected readonly updateLabel = this.updates.label;
  protected readonly updateBusy = this.updates.applying;

  protected readonly width = this.state.width;
  protected readonly selectedFolderId = this.state.selectedFolderId;
  protected readonly activeTag = this.state.activeTag;
  protected readonly activeNoteId = this.tabs.activeNoteId;

  // The overlay notes have their own entry, they never appear inside the tree
  private readonly treeNotes = computed<TreeNote[]>(() =>
    this.notesService.notes()
      .filter(n => !n.tags.includes(OVERLAY_NOTE_TAG))
      .map(n => ({ id: n.id, title: n.title || 'Untitled', folderId: n.folderId, sortOrder: n.sortOrder }))
  );

  private readonly tree = computed<FolderTreeNode[]>(() =>
    buildFolderTree(this.foldersService.folders(), this.treeNotes())
  );

  protected readonly rows = computed<FolderTreeRow[]>(() =>
    flattenVisibleTree(this.tree(), this.state.expandedIds())
  );

  /** Notes without folder (or whose folder vanished): listed after the folders, at the root level. */
  protected readonly rootNotes = computed<TreeNote[]>(() => {
    const folderIds = new Set(this.foldersService.folders().map(f => f.id));

    return this.treeNotes()
      .filter(n => n.folderId === null || !folderIds.has(n.folderId))
      .sort(compareNotes);
  });

  protected readonly totalNotes = computed(() => this.treeNotes().length);
  protected readonly overlayNotesCount = computed(() => this.notesService.overlayNotes().length);

  protected readonly tags = computed<string[]>(() => {
    const all = new Set<string>();

    for (const note of this.notesService.notes()) {
      note.tags.filter(tag => tag !== OVERLAY_NOTE_TAG).forEach(tag => all.add(tag));
    }

    return [...all].sort((a, b) => a.localeCompare(b));
  });

  protected readonly tagsExpanded = signal(true);

  // ── Inline rename / creation ───────────────────────────────────────────────
  protected readonly editingFolderId = signal<number | null>(null);

  // ── Drag & drop ────────────────────────────────────────────────────────────
  private readonly dragItem = signal<SidebarDragItem | null>(null);
  /** Folder id under the pointer while dragging, `'root'` for the empty area. */
  protected readonly dropTarget = signal<number | 'root' | null>(null);
  /** Insertion line shown on the edge of a row when the drop would position the item between two siblings. */
  protected readonly dropLine = signal<{ key: string; side: 'before' | 'after' } | null>(null);
  /** What a drop would do right now: computed on every dragover so the drop applies exactly what is shown. */
  private pendingPlacement: DropPlacement | null = null;

  // ── Context menu & dialogs ─────────────────────────────────────────────────
  protected readonly ctxMenu = signal<{
    items: ContextMenuEntry[];
    x: number;
    y: number;
    /** `null` for the empty area of the tree (the root). */
    target: SidebarDragItem | null;
  } | null>(null);

  protected readonly dialog = signal<SidebarDialogState | null>(null);

  protected readonly dialogView = computed<{ title: string; message: string; actions: ConfirmDialogAction[] } | null>(() => {
    const dialog = this.dialog();

    if (!dialog) {
      return null;
    }

    if (dialog.kind === 'deepFolder') {
      return {
        title: 'Deeply nested folder',
        message: `This folder would be more than ${FOLDER_RECOMMENDED_MAX_DEPTH} levels deep. Deep trees get hard to navigate: 3 to ${FOLDER_RECOMMENDED_MAX_DEPTH} levels are recommended.`,
        actions: [{ id: 'confirm', label: 'Create anyway' }],
      };
    }

    const folder = this.foldersService.getById(dialog.folderId);
    const node = this.findNode(dialog.folderId);
    const name = folder?.name ?? '';
    const isEmpty = (node?.noteCount ?? 0) === 0 && (node?.children.length ?? 0) === 0;

    if (isEmpty) {
      return {
        title: `Delete "${name}"?`,
        message: 'This folder is empty.',
        actions: [{ id: 'deleteAll', label: 'Delete', danger: true }],
      };
    }

    return {
      title: `Delete "${name}"?`,
      message: `It contains ${node?.noteCount ?? 0} note(s) (sub-folders included). Its sub-folders are deleted in both cases.`,
      actions: [
        { id: 'moveToRoot', label: 'Move notes to root' },
        { id: 'deleteAll', label: 'Delete everything', danger: true },
      ],
    };
  });

  // ── Toolbar ────────────────────────────────────────────────────────────────

  protected shortcutLabel(id: string): string {
    return this.settings.shortcutLabel(id);
  }

  protected openSearch(): void {
    this.palette.open('search');
  }

  protected openSettings(): void {
    this.settings.open();
  }

  protected collapseAll(): void {
    this.state.collapseAll();
  }

  protected toggleTags(): void {
    this.tagsExpanded.update(expanded => !expanded);
  }

  protected async newNote(folderId?: number): Promise<void> {
    // Without explicit target the note goes to the folder being browsed, else to the default folder
    const target = folderId ?? this.state.selectedFolderId() ?? undefined;
    const note = await this.notesService.create(target);

    if (note.folderId !== null) {
      this.state.expand(note.folderId);
    }

    this.tabs.openNote(note.id, 'Untitled');
  }

  protected async newFolder(parentId: number | null = null): Promise<void> {
    const parentDepth = parentId === null ? 0 : folderDepth(this.foldersService.folders(), parentId);

    if (parentDepth + 1 > FOLDER_RECOMMENDED_MAX_DEPTH && parentId !== null) {
      this.dialog.set({ kind: 'deepFolder', parentId });
      return;
    }

    await this.createFolder(parentId);
  }

  private async createFolder(parentId: number | null): Promise<void> {
    const folder = await this.foldersService.create(NEW_FOLDER_NAME, parentId);

    if (!folder) {
      return;
    }

    if (parentId !== null) {
      this.state.expand(parentId);
    }

    this.startRename(folder.id);
  }

  // ── Selection ──────────────────────────────────────────────────────────────

  protected selectAllNotes(): void {
    this.state.selectFolder(null);
    this.tabs.goHome();
  }

  protected onFolderClick(node: FolderTreeNode): void {
    this.state.selectFolder(node.folder.id);
    this.state.toggleExpanded(node.folder.id);
    this.tabs.goHome();
  }

  protected openNote(note: TreeNote): void {
    this.tabs.openNote(note.id, note.title);
  }

  protected openOverlayNotes(): void {
    this.tabs.openOverlayNotes();
  }

  protected selectTag(tag: string | null): void {
    this.state.setActiveTag(tag);
    this.tabs.goHome();
  }

  protected isExpanded(folderId: number): boolean {
    return this.state.expandedIds().has(folderId);
  }

  protected rowKey(row: FolderTreeRow): string {
    return row.kind === 'folder' ? `f${row.node.folder.id}` : `n${row.note.id}`;
  }

  // ── Rename ─────────────────────────────────────────────────────────────────

  protected startRename(folderId: number): void {
    this.editingFolderId.set(folderId);
  }

  protected async commitRename(folderId: number, event: Event): Promise<void> {
    // Enter then the blur it causes both land here: only the first one counts
    if (this.editingFolderId() !== folderId) {
      return;
    }

    this.editingFolderId.set(null);

    const name = (event.target as HTMLInputElement).value.trim();
    const current = this.foldersService.getById(folderId);

    if (name && current && name !== current.name) {
      await this.foldersService.rename(folderId, name);
    }
  }

  protected cancelRename(): void {
    this.editingFolderId.set(null);
  }

  // ── Context menu ───────────────────────────────────────────────────────────

  protected onFolderContextMenu(event: MouseEvent, node: FolderTreeNode): void {
    event.preventDefault();
    event.stopPropagation();

    const items: ContextMenuEntry[] = [
      { id: 'newNote', label: 'New Note', icon: ICON_NEW_NOTE },
      { id: 'newFolder', label: 'New Subfolder', icon: ICON_NEW_FOLDER },
    ];

    // The default folder is always there: no rename, no delete
    if (!node.folder.isDefault) {
      items.push(
        { divider: true },
        { id: 'rename', label: 'Rename', icon: ICON_RENAME, shortcut: 'F2' },
        { id: 'delete', label: 'Delete Folder', icon: ICON_DELETE, danger: true },
      );
    }

    this.ctxMenu.set({ items, x: event.clientX, y: event.clientY, target: { kind: 'folder', id: node.folder.id } });
  }

  protected onNoteContextMenu(event: MouseEvent, note: TreeNote): void {
    event.preventDefault();
    event.stopPropagation();

    const items: ContextMenuEntry[] = [
      { id: 'delete', label: 'Delete Note', icon: ICON_DELETE, danger: true },
    ];

    this.ctxMenu.set({ items, x: event.clientX, y: event.clientY, target: { kind: 'note', id: note.id } });
  }

  protected onRootContextMenu(event: MouseEvent): void {
    event.preventDefault();

    const items: ContextMenuEntry[] = [
      { id: 'newNote', label: 'New Note', icon: ICON_NEW_NOTE },
      { id: 'newFolder', label: 'New Folder', icon: ICON_NEW_FOLDER },
    ];

    this.ctxMenu.set({ items, x: event.clientX, y: event.clientY, target: null });
  }

  protected async onCtxAction(actionId: string): Promise<void> {
    const menu = this.ctxMenu();

    this.ctxMenu.set(null);

    if (!menu) {
      return;
    }

    const { target } = menu;
    const folderId = target?.kind === 'folder' ? target.id : null;

    switch (actionId) {
      case 'newNote':
        await this.newNote(folderId ?? undefined);
        break;
      case 'newFolder':
        await this.newFolder(folderId);
        break;
      case 'rename':
        if (folderId !== null) {
          this.startRename(folderId);
        }
        break;
      case 'delete':
        if (folderId !== null) {
          this.requestFolderDeletion(folderId);
        } else if (target?.kind === 'note') {
          await this.deleteNote(target.id);
        }
        break;
    }
  }

  protected onFolderKeydown(event: Event, node: FolderTreeNode, key: 'F2' | 'Delete'): void {
    if (node.folder.isDefault || this.editingFolderId() !== null) {
      return;
    }

    event.preventDefault();

    if (key === 'F2') {
      this.startRename(node.folder.id);
    } else {
      this.requestFolderDeletion(node.folder.id);
    }
  }

  // ── Deletion ───────────────────────────────────────────────────────────────

  private requestFolderDeletion(folderId: number): void {
    this.dialog.set({ kind: 'deleteFolder', folderId });
  }

  private async deleteNote(noteId: number): Promise<void> {
    this.tabs.closeByNoteId(noteId);
    await this.notesService.delete(noteId);
  }

  protected openUpdate(): void {
    this.updates.openDialog();
  }

  protected async onDialogChoice(choice: string | null): Promise<void> {
    const dialog = this.dialog();

    this.dialog.set(null);

    if (!dialog || choice === null) {
      return;
    }

    if (dialog.kind === 'deepFolder') {
      await this.createFolder(dialog.parentId);
      return;
    }

    const mode = choice === 'deleteAll' ? 'deleteAll' : 'moveToRoot';
    const deletedNoteIds = await this.foldersService.delete(dialog.folderId, mode);

    if (deletedNoteIds === null) {
      return;
    }

    deletedNoteIds.forEach(id => this.tabs.closeByNoteId(id));
    await this.notesService.loadAll();
    this.state.prune(new Set(this.foldersService.folders().map(f => f.id)));
  }

  // ── Drag & drop ────────────────────────────────────────────────────────────

  protected onDragStart(event: DragEvent, item: SidebarDragItem): void {
    this.dragItem.set(item);

    if (event.dataTransfer) {
      event.dataTransfer.effectAllowed = 'move';
      // Chromium only starts a drag when some data is set
      event.dataTransfer.setData('text/plain', `${item.kind}:${item.id}`);
    }
  }

  protected onDragEnd(): void {
    this.dragItem.set(null);
    this.clearDropFeedback();
  }

  private clearDropFeedback(): void {
    this.pendingPlacement = null;
    this.dropTarget.set(null);
    this.dropLine.set(null);
  }

  /** Leaving the tree altogether: no row is a candidate anymore. */
  protected onTreeDragLeave(event: DragEvent): void {
    const tree = event.currentTarget as HTMLElement;

    if (!tree.contains(event.relatedTarget as Node | null)) {
      this.clearDropFeedback();
    }
  }

  protected onFolderDragOver(event: DragEvent, node: FolderTreeNode): void {
    const item = this.dragItem();

    if (!item) {
      return;
    }

    const hasVisibleContent = this.isExpanded(node.folder.id) && (node.children.length > 0 || node.notes.length > 0);
    const placement = resolveFolderRowDrop(item.kind, node.folder, hasVisibleContent, this.pointerRatio(event));

    this.showPlacement(event, placement, `f${node.folder.id}`);
  }

  protected onNoteDragOver(event: DragEvent, note: TreeNote): void {
    const item = this.dragItem();

    if (!item) {
      return;
    }

    const holdingFolderId = this.foldersService.getById(note.folderId ?? -1) ? note.folderId : null;
    const placement = resolveNoteRowDrop(item.kind, note, holdingFolderId, this.pointerRatio(event));

    this.showPlacement(event, placement, `n${note.id}`);
  }

  /** The empty area below the rows: dropping there moves the item to the root. */
  protected onRootDragOver(event: DragEvent): void {
    this.showPlacement(event, { kind: 'into', folderId: null }, null);
  }

  /** 0 at the top edge of the hovered row, 1 at its bottom edge. */
  private pointerRatio(event: DragEvent): number {
    const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();

    return rect.height > 0 ? (event.clientY - rect.top) / rect.height : 0.5;
  }

  /**
   * Displays the placement (highlighted folder or insertion line) and accepts the drop, or refuses it when invalid.
   * The row always claims the event: an invalid drop on a row must not fall back to the "root" zone behind it.
   */
  private showPlacement(event: DragEvent, placement: DropPlacement, rowKey: string | null): void {
    event.stopPropagation();

    if (!this.isValidPlacement(placement)) {
      this.clearDropFeedback();
      return;
    }

    event.preventDefault();

    if (event.dataTransfer) {
      event.dataTransfer.dropEffect = 'move';
    }

    this.pendingPlacement = placement;

    if (placement.kind === 'into') {
      this.dropTarget.set(placement.folderId ?? 'root');
      this.dropLine.set(null);
    } else {
      this.dropTarget.set(null);
      this.dropLine.set(rowKey === null ? null : { key: rowKey, side: placement.side });
    }
  }

  protected lineSide(rowKey: string): 'before' | 'after' | null {
    const line = this.dropLine();

    return line?.key === rowKey ? line.side : null;
  }

  protected async onDrop(event: DragEvent): Promise<void> {
    event.preventDefault();
    event.stopPropagation();

    const item = this.dragItem();
    const placement = this.pendingPlacement;

    this.onDragEnd();

    if (!item || !placement) {
      return;
    }

    if (placement.kind === 'into') {
      await this.dropInto(item, placement.folderId);
    } else {
      await this.dropBetween(item, placement);
    }
  }

  private async dropInto(item: SidebarDragItem, folderId: number | null): Promise<void> {
    if (item.kind === 'note') {
      await this.notesService.moveToFolder(item.id, folderId);
    } else {
      await this.foldersService.move(item.id, folderId);
    }

    if (folderId !== null) {
      this.state.expand(folderId);
    }
  }

  private async dropBetween(item: SidebarDragItem, placement: Extract<DropPlacement, { kind: 'between' }>): Promise<void> {
    const { parentId, anchorId, side } = placement;

    if (item.kind === 'note') {
      const orderedIds = insertSibling(this.noteSiblingIds(parentId), item.id, anchorId, side);

      await this.notesService.place(item.id, parentId, orderedIds);
    } else {
      const siblings = this.folderSiblingIds(parentId);
      // The default folder stays first: nothing can be placed above it
      const firstIsDefault = siblings.length > 0 && !!this.foldersService.getById(siblings[0] as number)?.isDefault;
      const orderedIds = insertSibling(siblings, item.id, anchorId, side, firstIsDefault ? 1 : 0);

      await this.foldersService.place(item.id, parentId, orderedIds);
    }

    if (parentId !== null) {
      this.state.expand(parentId);
    }
  }

  private folderSiblingIds(parentId: number | null): number[] {
    const siblings = parentId === null ? this.tree() : (this.findNode(parentId)?.children ?? []);

    return siblings.map(node => node.folder.id);
  }

  private noteSiblingIds(folderId: number | null): number[] {
    const notes = folderId === null ? this.rootNotes() : (this.findNode(folderId)?.notes ?? []);

    return notes.map(note => note.id);
  }

  private isValidPlacement(placement: DropPlacement): boolean {
    const item = this.dragItem();

    if (!item) {
      return false;
    }

    if (placement.kind === 'between') {
      // Dropping an item next to itself changes nothing
      if (placement.anchorId === item.id) {
        return false;
      }

      if (item.kind === 'note') {
        return true;
      }

      const folders = this.foldersService.folders();
      const current = folders.find(f => f.id === item.id);

      // Same parent: just a reorder. Another parent: the usual move rules apply
      return current?.parentId === placement.parentId || canMoveFolder(folders, item.id, placement.parentId);
    }

    if (item.kind === 'folder') {
      return canMoveFolder(this.foldersService.folders(), item.id, placement.folderId);
    }

    const note = this.treeNotes().find(n => n.id === item.id);

    return !!note && note.folderId !== placement.folderId;
  }

  // ── Resize ─────────────────────────────────────────────────────────────────

  protected onResizeStart(event: PointerEvent): void {
    (event.target as HTMLElement).setPointerCapture(event.pointerId);
  }

  protected onResizeMove(event: PointerEvent): void {
    const handle = event.target as HTMLElement;

    if (!handle.hasPointerCapture(event.pointerId)) {
      return;
    }

    // The sidebar is glued to the left edge of the window: the pointer position is the width
    this.state.setWidth(event.clientX, false);
  }

  protected onResizeEnd(event: PointerEvent): void {
    const handle = event.target as HTMLElement;

    if (handle.hasPointerCapture(event.pointerId)) {
      handle.releasePointerCapture(event.pointerId);
      this.state.setWidth(this.state.width());
    }
  }

  private findNode(folderId: number): FolderTreeNode | null {
    const stack = [...this.tree()];

    while (stack.length > 0) {
      const node = stack.pop() as FolderTreeNode;

      if (node.folder.id === folderId) {
        return node;
      }

      stack.push(...node.children);
    }

    return null;
  }
}
