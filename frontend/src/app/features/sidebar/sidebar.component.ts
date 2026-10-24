import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';

import {
  DropPlacement,
  Folder,
  FolderOption,
  FolderTreeNode,
  FolderTreeRow,
  FOLDER_RECOMMENDED_MAX_DEPTH,
  SidebarDialogState,
  SidebarDragItem,
  TreeNote,
} from '../../core/models/folder.model';
import { I18nService } from '../../core/i18n/i18n.service';
import { QUICK_NOTE_TAG } from '../../core/models/settings.model';
import { FoldersService } from '../../core/services/folders.service';
import { NotesService } from '../../core/services/notes.service';
import { PaletteService } from '../../core/services/palette.service';
import { SettingsService } from '../../core/services/settings.service';
import { SidebarStateService } from '../../core/services/sidebar-state.service';
import { TabsService } from '../../core/services/tabs.service';
import { UpdateService } from '../../core/services/update.service';
import { CollectionsService } from '../../core/services/collections.service';
import { PlatformService } from '../../core/services/platform.service';
import { NoteExportService, folderExportMenu, noteExportMenu, selectionExportMenu } from '../../core/services/note-export.service';
import {
  buildFolderTree,
  canMoveFolder,
  collectSubtreeIds,
  compareNotes,
  flattenVisibleTree,
  folderDepth,
  folderDisplayName,
  insertSibling,
  resolveFolderRowDrop,
  resolveNoteRowDrop,
} from '../../core/utils/folder-tree.util';
import { noteDisplayTitle } from '../../core/utils/note-title.util';
import { formatAccelerator } from '../../core/utils/accelerator.util';
import { itemKey, parseItemKey, rangeBetween, topLevelItems } from '../../core/utils/sidebar-selection.util';
import { ContextMenuComponent, ContextMenuEntry } from '../../shared/context-menu/context-menu.component';
import { ColorPickerComponent } from '../../shared/ui/color-picker.component';
import { ConfirmDialogAction, ConfirmDialogComponent } from '../../shared/ui/confirm-dialog.component';
import { FocusSelectDirective } from '../../shared/ui/focus-select.directive';
import { SectionSplitterComponent } from '../../shared/ui/section-splitter.component';
import { CollectionsSectionComponent } from './collections-section.component';
import { MoveToDialogComponent } from './move-to-dialog.component';

const ICON_NEW_NOTE = 'M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8zM14 2v6h6M12 18v-6M9 15h6';
const ICON_NEW_FOLDER = 'M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2zM12 11v6M9 14h6';
const ICON_RENAME = 'M12 20h9M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4z';
const ICON_DELETE = 'M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2';
const ICON_MOVE = 'M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2zM12 10l3 3-3 3M8 13h7';
const ICON_COLOR = 'M12 2a10 10 0 1 0 0 20 2 2 0 0 0 1.5-3.3 2 2 0 0 1 1.5-3.3H17a5 5 0 0 0 5-5C22 5.9 17.5 2 12 2zM7.5 11.5h.01M10.5 7.5h.01M15.5 8.5h.01';
const ICON_EMPTY = 'M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2zM9.5 11.5l5 5M14.5 11.5l-5 5';

@Component({
  selector: 'app-sidebar',
  standalone: true,
  imports: [
    ContextMenuComponent, ConfirmDialogComponent, FocusSelectDirective, ColorPickerComponent, MoveToDialogComponent,
    CollectionsSectionComponent, SectionSplitterComponent,
  ],
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
  private readonly collections = inject(CollectionsService);
  private readonly noteExport = inject(NoteExportService);
  protected readonly i18n = inject(I18nService);
  private readonly platform = inject(PlatformService);

  /** Delete key label of the context menus: `⌘⌫` on macOS (Finder), `Del` elsewhere. */
  protected readonly deleteShortcut = this.platform.isMac ? formatAccelerator('CommandOrControl+Backspace', this.platform.platform) : 'Del';

  /**
   * ⌘⌫ deletes like Delete on macOS (MacBooks have no forward Delete key). Only on the row itself: in a rename
   * field ⌘⌫ keeps erasing the text. Always false elsewhere.
   */
  protected isMacDeleteKey(event: Event): boolean {
    return this.platform.isMac && event.target === event.currentTarget;
  }

  protected readonly updateInfo = this.updates.info;
  protected readonly updateLabel = this.updates.label;
  protected readonly updateBusy = this.updates.applying;

  protected readonly width = this.state.width;
  protected readonly selectedFolderId = this.state.selectedFolderId;
  protected readonly activeTag = this.state.activeTag;
  protected readonly activeNoteId = this.tabs.activeNoteId;
  protected readonly collectionSelected = computed(() => this.collections.selectedRoot() !== null);

  // The quick notes have their own entry, they never appear inside the tree
  private readonly treeNotes = computed<TreeNote[]>(() =>
    this.notesService.notes()
      .filter(n => !n.tags.includes(QUICK_NOTE_TAG))
      .map(n => ({ id: n.id, title: noteDisplayTitle(n.title, this.i18n.t), folderId: n.folderId, sortOrder: n.sortOrder, color: n.color }))
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
  protected readonly quickNotesCount = computed(() => this.notesService.quickNotes().length);

  protected readonly tags = computed<string[]>(() => {
    const all = new Set<string>();

    for (const note of this.notesService.notes()) {
      note.tags.filter(tag => tag !== QUICK_NOTE_TAG).forEach(tag => all.add(tag));
    }

    return [...all].sort((a, b) => a.localeCompare(b));
  });

  protected readonly tagsExpanded = signal(true);

  // ── Inline rename / creation ───────────────────────────────────────────────
  protected readonly editingFolderId = signal<number | null>(null);

  // ── Multi-selection (Ctrl+click / Shift+click) ─────────────────────────────
  /** Keys (`f<id>` / `n<id>`) of the selected rows; a single key is the plain "last clicked" row. */
  protected readonly selection = signal<ReadonlySet<string>>(new Set());
  /** Start of a Shift+click range. */
  private anchorKey: string | null = null;
  protected readonly multiSelection = computed(() => this.selection().size > 1);
  /** Every row in display order: a Shift+click range follows what is shown. */
  private readonly visibleKeys = computed(() => [
    ...this.rows().map(row => this.rowKey(row)),
    ...this.rootNotes().map(note => itemKey({ kind: 'note', id: note.id })),
  ]);

  // ── Move to… / color ───────────────────────────────────────────────────────
  protected readonly moveTargets = signal<SidebarDragItem[] | null>(null);
  protected readonly colorPicker = signal<{ x: number; y: number; targets: SidebarDragItem[]; value: string | null } | null>(null);

  /** Destinations of the "Move to…" dialog: the whole tree, minus the moved folders and what is below them. */
  protected readonly moveOptions = computed<FolderOption[]>(() => {
    const targets = this.moveTargets() ?? [];
    const folders = this.foldersService.folders();
    const blocked = new Set(targets.filter(item => item.kind === 'folder').flatMap(item => collectSubtreeIds(folders, item.id)));
    const allExpanded = new Set(folders.map(folder => folder.id));
    const folderRows = flattenVisibleTree(this.tree(), allExpanded).filter(row => row.kind === 'folder');

    return [
      { id: null, label: this.i18n.t('sidebar.moveTo.root'), depth: 0, disabled: false },
      ...folderRows.map(row => ({ id: row.node.folder.id, label: folderDisplayName(row.node.folder, this.i18n.t), depth: row.depth, disabled: blocked.has(row.node.folder.id) })),
    ];
  });

  // ── Drag & drop ────────────────────────────────────────────────────────────
  private readonly dragItem = signal<SidebarDragItem | null>(null);
  /** Everything being dragged: the dragged row, or the whole selection when it is part of it. */
  private dragGroup: SidebarDragItem[] = [];
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
    /** The items the actions apply to: the target, or the whole selection when it was right-clicked. */
    targets: SidebarDragItem[];
  } | null>(null);

  protected readonly dialog = signal<SidebarDialogState | null>(null);

  protected readonly dialogView = computed<{ title: string; message: string; actions: ConfirmDialogAction[] } | null>(() => {
    const dialog = this.dialog();
    const t = this.i18n.t;

    if (!dialog) {
      return null;
    }

    if (dialog.kind === 'emptyFolder') {
      return this.emptyFolderView(dialog.folderId);
    }

    if (dialog.kind === 'bulkDelete') {
      return this.bulkDeleteView(dialog.items);
    }

    if (dialog.kind === 'deepFolder') {
      return {
        title: t('sidebar.dialog.deepFolder.title'),
        message: t('sidebar.dialog.deepFolder.message', { max: FOLDER_RECOMMENDED_MAX_DEPTH }),
        actions: [{ id: 'confirm', label: t('sidebar.dialog.deepFolder.confirm') }],
      };
    }

    const folder = this.foldersService.getById(dialog.folderId);
    const node = this.findNode(dialog.folderId);
    const name = folder ? folderDisplayName(folder, t) : '';
    const isEmpty = (node?.noteCount ?? 0) === 0 && (node?.children.length ?? 0) === 0;

    if (isEmpty) {
      return {
        title: t('sidebar.dialog.deleteFolder.title', { name }),
        message: t('sidebar.dialog.deleteFolder.empty'),
        actions: [{ id: 'deleteAll', label: t('common.delete'), danger: true }],
      };
    }

    return {
      title: t('sidebar.dialog.deleteFolder.title', { name }),
      message: t('sidebar.dialog.deleteFolder.message', { notes: this.i18n.plural('sidebar.count.notes', node?.noteCount ?? 0) }),
      actions: [
        { id: 'moveToRoot', label: t('sidebar.dialog.moveNotesToRoot') },
        { id: 'deleteAll', label: t('sidebar.dialog.deleteEverything'), danger: true },
      ],
    };
  });

  // ── Toolbar ────────────────────────────────────────────────────────────────

  protected folderLabel(folder: Folder): string {
    return folderDisplayName(folder, this.i18n.t);
  }

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

    this.tabs.openNote(note.id, note.title);
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
    const folder = await this.foldersService.create(this.i18n.t('sidebar.folder.newName'), parentId);

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
    this.collections.select(null);
    this.state.selectFolder(null);
    this.tabs.goHome();
  }

  protected onFolderClick(node: FolderTreeNode, event?: MouseEvent): void {
    if (event && this.extendSelection(event, itemKey({ kind: 'folder', id: node.folder.id }))) {
      return;
    }

    this.collections.select(null);
    this.state.selectFolder(node.folder.id);
    this.state.toggleExpanded(node.folder.id);
    this.tabs.goHome();
  }

  protected openNote(note: TreeNote, event?: MouseEvent): void {
    if (event && this.extendSelection(event, itemKey({ kind: 'note', id: note.id }))) {
      return;
    }

    this.tabs.openNote(note.id, note.title);
  }

  // ── Multi-selection ────────────────────────────────────────────────────────

  protected isMultiSelected(key: string): boolean {
    return this.multiSelection() && this.selection().has(key);
  }

  /**
   * Ctrl+click adds / removes the row, Shift+click selects the range from the anchor: true when the click did
   * that (the row must then not open). A plain click selects the row alone.
   */
  private extendSelection(event: MouseEvent, key: string): boolean {
    if (event.ctrlKey || event.metaKey) {
      const next = new Set(this.selection());

      // The row shown as current is part of the selection being started
      const current = this.currentKey();
      if (next.size === 0 && current !== null && current !== key) {
        next.add(current);
      }

      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }

      this.selection.set(next);
      this.anchorKey = key;
      return true;
    }

    if (event.shiftKey) {
      this.selection.set(new Set(rangeBetween(this.visibleKeys(), this.anchorKey ?? this.currentKey(), key)));
      return true;
    }

    this.selection.set(new Set([key]));
    this.anchorKey = key;
    return false;
  }

  /** Row highlighted as current: the open note, or the folder being browsed. */
  private currentKey(): string | null {
    const noteId = this.activeNoteId();

    if (noteId !== null && noteId >= 0) {
      return itemKey({ kind: 'note', id: noteId });
    }

    const folderId = this.selectedFolderId();
    return folderId === null ? null : itemKey({ kind: 'folder', id: folderId });
  }

  protected clearSelection(): void {
    this.selection.set(new Set());
    this.anchorKey = null;
  }

  /** The selected items that still exist, in display order. */
  private selectedItems(): SidebarDragItem[] {
    const selection = this.selection();
    return this.visibleKeys()
      .filter(key => selection.has(key))
      .map(parseItemKey)
      .filter((item): item is SidebarDragItem => item !== null);
  }

  /** The right-clicked row and, when it belongs to the multi-selection, every selected row. */
  private contextTargets(item: SidebarDragItem): SidebarDragItem[] {
    const key = itemKey(item);

    if (this.isMultiSelected(key)) {
      return this.selectedItems();
    }

    this.selection.set(new Set([key]));
    this.anchorKey = key;
    return [item];
  }

  protected onNoteKeydown(event: Event, note: TreeNote): void {
    event.preventDefault();
    this.requestDeletion(this.isMultiSelected(itemKey({ kind: 'note', id: note.id })) ? this.selectedItems() : [{ kind: 'note', id: note.id }]);
  }

  protected openQuickNotes(): void {
    this.tabs.openQuickNotes();
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

    const target: SidebarDragItem = { kind: 'folder', id: node.folder.id };
    const targets = this.contextTargets(target);

    if (targets.length > 1) {
      this.openSelectionMenu(event, target, targets);
      return;
    }

    const t = this.i18n.t;
    const items: ContextMenuEntry[] = [
      { id: 'newNote', label: t('common.newNote'), icon: ICON_NEW_NOTE },
      { id: 'newFolder', label: t('sidebar.menu.newSubfolder'), icon: ICON_NEW_FOLDER },
    ];

    if (node.noteCount > 0) {
      items.push({ divider: true }, ...folderExportMenu(t));
    }

    items.push({ divider: true });

    // The default folder is always there: no rename, no move, no delete
    if (!node.folder.isDefault) {
      items.push(
        { id: 'rename', label: t('common.rename'), icon: ICON_RENAME, shortcut: 'F2' },
        { id: 'moveTo', label: t('sidebar.menu.moveTo'), icon: ICON_MOVE },
      );
    }

    items.push({ id: 'color', label: t('sidebar.menu.color'), icon: ICON_COLOR });

    if (node.noteCount > 0 || node.children.length > 0) {
      items.push({ divider: true }, { id: 'empty', label: t('sidebar.menu.emptyFolder'), icon: ICON_EMPTY, danger: true });
    }

    if (!node.folder.isDefault) {
      items.push({ divider: true }, { id: 'delete', label: t('sidebar.menu.deleteFolder'), icon: ICON_DELETE, danger: true });
    }

    this.ctxMenu.set({ items, x: event.clientX, y: event.clientY, target, targets });
  }

  protected onNoteContextMenu(event: MouseEvent, note: TreeNote): void {
    event.preventDefault();
    event.stopPropagation();

    const target: SidebarDragItem = { kind: 'note', id: note.id };
    const targets = this.contextTargets(target);

    if (targets.length > 1) {
      this.openSelectionMenu(event, target, targets);
      return;
    }

    const t = this.i18n.t;
    const items: ContextMenuEntry[] = [
      noteExportMenu(t),
      { divider: true },
      { id: 'moveTo', label: t('sidebar.menu.moveTo'), icon: ICON_MOVE },
      { id: 'color', label: t('sidebar.menu.color'), icon: ICON_COLOR },
      { divider: true },
      { id: 'delete', label: t('sidebar.menu.deleteNote'), icon: ICON_DELETE, danger: true },
    ];

    this.ctxMenu.set({ items, x: event.clientX, y: event.clientY, target, targets });
  }

  private openSelectionMenu(event: MouseEvent, target: SidebarDragItem, targets: SidebarDragItem[]): void {
    const t = this.i18n.t;
    const items: ContextMenuEntry[] = [
      selectionExportMenu(t),
      { divider: true },
      { id: 'moveTo', label: t('sidebar.menu.moveItems', { count: targets.length }), icon: ICON_MOVE },
      { id: 'color', label: t('sidebar.menu.color'), icon: ICON_COLOR },
      { divider: true },
      { id: 'delete', label: t('sidebar.menu.deleteItems', { count: targets.length }), icon: ICON_DELETE, danger: true, shortcut: this.deleteShortcut },
    ];

    this.ctxMenu.set({ items, x: event.clientX, y: event.clientY, target, targets });
  }

  protected onRootContextMenu(event: MouseEvent): void {
    event.preventDefault();

    const items: ContextMenuEntry[] = [
      { id: 'newNote', label: this.i18n.t('common.newNote'), icon: ICON_NEW_NOTE },
      { id: 'newFolder', label: this.i18n.t('common.newFolder'), icon: ICON_NEW_FOLDER },
    ];

    this.ctxMenu.set({ items, x: event.clientX, y: event.clientY, target: null, targets: [] });
  }

  protected async onCtxAction(actionId: string): Promise<void> {
    const menu = this.ctxMenu();

    this.ctxMenu.set(null);

    if (!menu) {
      return;
    }

    const { target, targets } = menu;
    const folderId = target?.kind === 'folder' ? target.id : null;

    if (target?.kind === 'note' && await this.noteExport.runNoteAction(actionId, target.id)) {
      return;
    }

    switch (actionId) {
      case 'export:zip':
      case 'export:pdf-zip': {
        const format = actionId === 'export:zip' ? 'md' : 'pdf';

        if (targets.length > 1) {
          await this.noteExport.exportSelection(topLevelItems(targets, this.foldersService.folders(), this.treeNotes()), format);
        } else if (folderId !== null) {
          await this.noteExport.exportFolder(folderId, format);
        }
        break;
      }
      case 'moveTo':
        this.moveTargets.set(topLevelItems(targets, this.foldersService.folders(), this.treeNotes()));
        break;
      case 'color':
        this.colorPicker.set({ x: menu.x, y: menu.y, targets, value: this.colorOf(targets[0] ?? null) });
        break;
      case 'empty':
        if (folderId !== null) {
          this.dialog.set({ kind: 'emptyFolder', folderId });
        }
        break;
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
        if (targets.length > 1) {
          this.requestDeletion(targets);
        } else if (folderId !== null) {
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
    } else if (this.isMultiSelected(itemKey({ kind: 'folder', id: node.folder.id }))) {
      this.requestDeletion(this.selectedItems());
    } else {
      this.requestFolderDeletion(node.folder.id);
    }
  }

  // ── Deletion ───────────────────────────────────────────────────────────────

  private requestFolderDeletion(folderId: number): void {
    this.dialog.set({ kind: 'deleteFolder', folderId });
  }

  /** Deletion of several items (the default folder is left out): one confirmation for all of them. */
  private requestDeletion(items: SidebarDragItem[]): void {
    const deletable = topLevelItems(items, this.foldersService.folders(), this.treeNotes())
      .filter(item => item.kind === 'note' || !this.foldersService.getById(item.id)?.isDefault);

    if (deletable.length === 1 && deletable[0]?.kind === 'folder') {
      this.requestFolderDeletion(deletable[0].id);
    } else if (deletable.length > 0) {
      this.dialog.set({ kind: 'bulkDelete', items: deletable });
    }
  }

  private emptyFolderView(folderId: number): { title: string; message: string; actions: ConfirmDialogAction[] } {
    const node = this.findNode(folderId);
    const subfolders = collectSubtreeIds(this.foldersService.folders(), folderId).length - 1;

    const t = this.i18n.t;
    const plural = this.i18n.plural;

    return {
      title: t('sidebar.dialog.emptyFolder.title', { name: node ? folderDisplayName(node.folder, t) : '' }),
      message: t('sidebar.dialog.emptyFolder.message', {
        notes: plural('sidebar.count.notes', node?.noteCount ?? 0),
        subfolders: plural('sidebar.count.subfolders', subfolders),
      }),
      actions: [{ id: 'empty', label: t('sidebar.dialog.emptyFolder.confirm'), danger: true }],
    };
  }

  private bulkDeleteView(items: SidebarDragItem[]): { title: string; message: string; actions: ConfirmDialogAction[] } {
    const folderNodes = items.filter(item => item.kind === 'folder').map(item => this.findNode(item.id));
    const notesInFolders = folderNodes.reduce((total, node) => total + (node?.noteCount ?? 0), 0);
    const selectedNotes = items.filter(item => item.kind === 'note').length;
    const t = this.i18n.t;
    const plural = this.i18n.plural;
    const title = t('sidebar.dialog.bulkDelete.title', { count: items.length });

    if (notesInFolders === 0) {
      const message = t('sidebar.dialog.bulkDelete.messageEmpty', {
        notes: plural('sidebar.count.notes', selectedNotes),
        folders: plural('sidebar.count.emptyFolders', folderNodes.length),
      });

      return { title, message, actions: [{ id: 'deleteAll', label: t('common.delete'), danger: true }] };
    }

    return {
      title,
      message: t('sidebar.dialog.bulkDelete.message', {
        selected: plural('sidebar.count.selectedNotes', selectedNotes),
        folders: plural('sidebar.count.folders', folderNodes.length),
        inFolders: plural('sidebar.count.notes', notesInFolders),
      }),
      actions: [
        { id: 'moveToRoot', label: t('sidebar.dialog.bulkDelete.moveToRoot') },
        { id: 'deleteAll', label: t('sidebar.dialog.deleteEverything'), danger: true },
      ],
    };
  }

  private async deleteItems(items: SidebarDragItem[], mode: 'moveToRoot' | 'deleteAll'): Promise<void> {
    for (const item of items.filter(entry => entry.kind === 'note')) {
      this.tabs.closeByNoteId(item.id);
      await this.notesService.delete(item.id);
    }

    for (const item of items.filter(entry => entry.kind === 'folder')) {
      const deletedNoteIds = await this.foldersService.delete(item.id, mode);
      deletedNoteIds?.forEach(id => this.tabs.closeByNoteId(id));
    }

    this.clearSelection();
    await this.notesService.loadAll();
    this.state.prune(new Set(this.foldersService.folders().map(f => f.id)));
  }

  private async emptyFolder(folderId: number): Promise<void> {
    const deletedNoteIds = await this.foldersService.empty(folderId);

    deletedNoteIds?.forEach(id => this.tabs.closeByNoteId(id));
    await this.notesService.loadAll();
    this.state.prune(new Set(this.foldersService.folders().map(f => f.id)));
  }

  // ── Move to… ───────────────────────────────────────────────────────────────

  protected async onMoveToChosen(folderId: number | null): Promise<void> {
    const items = this.moveTargets() ?? [];

    this.moveTargets.set(null);
    await this.moveItems(items, folderId);
  }

  /** Moves notes and folders into one folder (`null` = root); folders that cannot go there stay in place. */
  private async moveItems(items: SidebarDragItem[], folderId: number | null): Promise<void> {
    const folders = this.foldersService.folders();

    for (const item of items) {
      if (item.kind === 'note') {
        await this.notesService.moveToFolder(item.id, folderId);
      } else if (canMoveFolder(folders, item.id, folderId)) {
        await this.foldersService.move(item.id, folderId);
      }
    }

    if (folderId !== null) {
      this.state.expand(folderId);
    }
    this.clearSelection();
  }

  // ── Color ──────────────────────────────────────────────────────────────────

  private colorOf(item: SidebarDragItem | null): string | null {
    if (item === null) {
      return null;
    }

    if (item.kind === 'folder') {
      return this.foldersService.getById(item.id)?.color ?? null;
    }

    return this.notesService.notes().find(note => note.id === item.id)?.color ?? null;
  }

  protected async onColorPicked(color: string | null): Promise<void> {
    const targets = this.colorPicker()?.targets ?? [];
    this.colorPicker.set(null);

    const folderIds = targets.filter(item => item.kind === 'folder').map(item => item.id);
    const noteIds = targets.filter(item => item.kind === 'note').map(item => item.id);

    if (folderIds.length > 0) {
      await this.foldersService.setColor(folderIds, color);
    }
    if (noteIds.length > 0) {
      await this.notesService.setColor(noteIds, color);
    }
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

    if (dialog.kind === 'emptyFolder') {
      await this.emptyFolder(dialog.folderId);
      return;
    }

    if (dialog.kind === 'bulkDelete') {
      await this.deleteItems(dialog.items, choice === 'deleteAll' ? 'deleteAll' : 'moveToRoot');
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
    this.dragGroup = this.isMultiSelected(itemKey(item))
      ? topLevelItems(this.selectedItems(), this.foldersService.folders(), this.treeNotes())
      : [item];

    if (event.dataTransfer) {
      event.dataTransfer.effectAllowed = 'move';
      // Chromium only starts a drag when some data is set
      event.dataTransfer.setData('text/plain', `${item.kind}:${item.id}`);
    }
  }

  protected onDragEnd(): void {
    this.dragItem.set(null);
    this.dragGroup = [];
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
    const group = this.dragGroup;
    const placement = this.pendingPlacement;

    this.onDragEnd();

    if (!item || !placement) {
      return;
    }

    // A group has no single position among siblings: it goes into the folder
    if (group.length > 1) {
      await this.moveItems(group, placement.kind === 'into' ? placement.folderId : placement.parentId);
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

    if (this.dragGroup.length > 1) {
      return this.canMoveGroupInto(placement.kind === 'into' ? placement.folderId : placement.parentId);
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

  /** A group can land in a folder when none of its folders would end up inside itself, and something moves. */
  private canMoveGroupInto(folderId: number | null): boolean {
    const folders = this.foldersService.folders();
    const noteFolder = new Map(this.treeNotes().map(note => [note.id, note.folderId]));
    let somethingMoves = false;

    for (const item of this.dragGroup) {
      if (item.kind === 'folder') {
        if (folderId !== null && collectSubtreeIds(folders, item.id).includes(folderId)) {
          return false;
        }
        somethingMoves ||= canMoveFolder(folders, item.id, folderId);
      } else {
        somethingMoves ||= noteFolder.get(item.id) !== folderId;
      }
    }

    return somethingMoves;
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
