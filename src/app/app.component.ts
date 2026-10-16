import {
  Component, OnInit, OnDestroy, ViewChild, computed, inject, ChangeDetectionStrategy
} from '@angular/core';

import { TabsBarComponent } from './features/tabs/tabs-bar.component';
import { EditorComponent } from './features/editor/editor.component';
import { PaletteComponent } from './features/palette/palette.component';
import { HomeComponent } from './features/home/home.component';
import { SettingsComponent } from './features/settings/settings.component';
import { FormattingBarComponent } from './features/formatting-bar/formatting-bar.component';
import { BacklinksPanelComponent } from './features/backlinks/backlinks-panel.component';
import { SidebarComponent } from './features/sidebar/sidebar.component';
import { NotesService } from './core/services/notes.service';
import { TabsService } from './core/services/tabs.service';
import { PaletteService } from './core/services/palette.service';
import { ShortcutsService } from './core/services/shortcuts.service';
import { ElectronBridgeService } from './core/services/electron-bridge.service';
import { LayoutService } from './core/services/layout.service';
import { SettingsService } from './core/services/settings.service';
import { FoldersService } from './core/services/folders.service';
import { SidebarStateService } from './core/services/sidebar-state.service';
import { UpdateService } from './core/services/update.service';
import { FormattingBarService } from './core/services/formatting-bar.service';
import { FileDocsService } from './core/services/file-docs.service';
import { CollectionsService } from './core/services/collections.service';
import { CollectionsBridgeService } from './core/services/collections-bridge.service';
import { ThemeService } from './core/services/theme.service';
import { ConfirmDialogAction, ConfirmDialogComponent } from './shared/ui/confirm-dialog.component';
import { OVERLAY_NOTES_TAB_ID } from './core/models/note.model';
import { GETTING_STARTED_FOLDER_NAME } from './core/models/folder.model';
import { SAMPLE_NOTES } from './core/data/sample-notes';
import { findSampleNotesToGather } from './core/utils/sample-notes.util';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [TabsBarComponent, EditorComponent, PaletteComponent, HomeComponent, SettingsComponent, SidebarComponent, FormattingBarComponent, BacklinksPanelComponent, ConfirmDialogComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    '(document:dragover)': 'onFilesDragOver($event)',
    '(document:drop)': 'onFilesDrop($event)',
  },
  template: `
    <div class="app-shell">
      <app-tabs-bar />
      <div class="app-body">
        @if (sidebarVisible()) {
          <app-sidebar />
        }
        <div class="app-main">
          <!-- Placed above or below the editor by its own CSS order -->
          @if (formattingBarShown()) {
            <app-formatting-bar />
          }
          <div class="app-content" [class.wide]="wideMode()">
            <!-- Always keep both in DOM to avoid editor teardown on home navigation -->
            <app-home [style.display]="activeNoteId() !== null ? 'none' : 'flex'" />
            <app-editor
              #editor
              [noteId]="activeNoteId()"
              [style.display]="activeNoteId() === null ? 'none' : 'flex'"
            />
          </div>
          @if (backlinksShown()) {
            <app-backlinks-panel />
          }
        </div>
      </div>
      <app-palette />
      <app-settings />
      @if (updateDialog(); as dialog) {
        <app-confirm-dialog
          [title]="dialog.title"
          [message]="dialog.message"
          [actions]="dialog.actions"
          cancelLabel="Later"
          (chosen)="onUpdateChoice($event)"
        />
      }
    </div>
  `,
  styles: [`
    :host { display: contents; }
    .app-shell {
      display: flex;
      flex-direction: column;
      height: 100vh;
      overflow: hidden;
      background: var(--evn-bg);
    }
    .app-body {
      display: flex;
      flex: 1;
      overflow: hidden;
      min-height: 0;
    }
    .app-main {
      display: flex;
      flex-direction: column;
      flex: 1;
      overflow: hidden;
      min-height: 0;
      min-width: 0;
    }
    .app-content {
      display: flex;
      flex: 1;
      overflow: hidden;
      min-height: 0;
      min-width: 0;
    }
    .app-content.wide ::ng-deep .cm-content {
      max-width: 100% !important;
    }
    .app-content.wide ::ng-deep .home-inner {
      max-width: 100%;
    }
  `],
})
export class AppComponent implements OnInit, OnDestroy {
  @ViewChild('editor') editorRef!: EditorComponent;

  private notesService = inject(NotesService);
  private tabsService = inject(TabsService);
  private paletteService = inject(PaletteService);
  private shortcutsService = inject(ShortcutsService);
  private bridge = inject(ElectronBridgeService);
  private layoutService = inject(LayoutService);
  private settingsService = inject(SettingsService);
  private foldersService = inject(FoldersService);
  private sidebarState = inject(SidebarStateService);
  private updateService = inject(UpdateService);
  private themeService = inject(ThemeService);
  private formattingBar = inject(FormattingBarService);
  private fileDocs = inject(FileDocsService);
  private collections = inject(CollectionsService);
  private collectionsBridge = inject(CollectionsBridgeService);

  readonly activeNoteId = this.tabsService.activeNoteId;
  readonly wideMode = this.layoutService.wideMode;
  readonly sidebarVisible = this.sidebarState.visible;
  /** Only worth its room when there is a note to format (not on the home page). */
  readonly formattingBarShown = computed(() => this.formattingBar.visible() && this.activeNoteId() !== null);

  /** The read-only overlay notes document has no identity of its own to be linked to. */
  readonly backlinksShown = computed(() => {
    const id = this.activeNoteId();
    // Nor do the collection files: they are not part of the notes' links
    return id !== null && id !== OVERLAY_NOTES_TAB_ID && !this.fileDocs.isFileDoc(id);
  });

  /** Popup offering the update found by the main process; null when closed. */
  readonly updateDialog = computed<{ title: string; message: string; actions: ConfirmDialogAction[] } | null>(() => {
    const info = this.updateService.info();
    if (!info || !this.updateService.dialogOpen()) return null;
    return {
      title: `Version ${info.version} is available`,
      message: info.downloaded
        ? `Version ${info.version} is ready (you have ${info.currentVersion}). The app restarts to apply it.`
        : `You have version ${info.currentVersion}. Download and install version ${info.version}? The app restarts to apply it.`,
      actions: [{ id: 'install', label: info.downloaded ? 'Restart now' : 'Update now' }],
    };
  });

  private unregisterFns: (() => void)[] = [];
  private unsubscribeNotesChanged: () => void = () => undefined;

  async ngOnInit(): Promise<void> {
    try {
      await this.foldersService.loadAll();
      await this.notesService.loadAll();

      // Seed sample notes on first launch
      if (this.notesService.notes().length === 0) {
        await this.seedSampleNotes();
      }

      await this.gatherLegacySampleNotes();
      this.sidebarState.prune(new Set(this.foldersService.folders().map(f => f.id)));

      const noteIds = new Set(this.notesService.notes().map(n => n.id));
      this.tabsService.restoreSession(noteIds);
      // In the background: the folders of the disk never delay the notes
      this.collections.start();
    } catch (err) {
      console.error('[App] Failed to load notes:', err);
    }
    // Notes sent from the quick-note overlay show up without restarting the app
    this.unsubscribeNotesChanged = this.bridge.onNotesChanged(() => { void this.reloadNotesAndFolders(); });
    this.registerShortcuts();
  }

  /** Files dragged from the Explorer (not the sidebar's own drags): the window accepts them. */
  protected onFilesDragOver(event: DragEvent): void {
    if (event.dataTransfer?.types.includes('Files')) {
      event.preventDefault();
      event.dataTransfer.dropEffect = 'copy';
    }
  }

  /** Dropped folders and markdown files become collections; the files open in tabs. */
  protected onFilesDrop(event: DragEvent): void {
    const files = Array.from(event.dataTransfer?.files ?? []);

    if (files.length === 0) {
      return;
    }

    event.preventDefault();
    const paths = files.map(file => this.collectionsBridge.pathForFile(file)).filter((path): path is string => !!path);
    void this.collections.addPaths(paths);
  }

  onUpdateChoice(choice: string | null): void {
    if (choice === 'install') {
      void this.updateService.install();
    } else {
      this.updateService.closeDialog();
    }
  }

  private async reloadNotesAndFolders(): Promise<void> {
    await this.foldersService.loadAll();
    await this.notesService.loadAll();
  }

  /** The sample notes get their own folder so the user can delete them all at once. */
  private async seedSampleNotes(): Promise<void> {
    const folder = await this.foldersService.create(GETTING_STARTED_FOLDER_NAME, null);

    for (const sample of SAMPLE_NOTES) {
      await this.bridge.createNote(sample.title, sample.content, [], folder?.id ?? null);
    }

    if (folder) {
      this.sidebarState.expand(folder.id);
    }

    await this.notesService.loadAll();
  }

  /** One-off for databases seeded before the folders: puts the sample notes into "Getting started". */
  private async gatherLegacySampleNotes(): Promise<void> {
    const treeNotes = this.notesService.notes().map(n => ({
      id: n.id, title: n.title, folderId: n.folderId, sortOrder: n.sortOrder,
    }));
    const toMove = findSampleNotesToGather(this.foldersService.folders(), treeNotes, SAMPLE_NOTES.map(n => n.title));

    if (toMove.length === 0) {
      return;
    }

    const folder = await this.foldersService.create(GETTING_STARTED_FOLDER_NAME, null);

    if (!folder) {
      return;
    }

    for (const note of toMove) {
      await this.notesService.moveToFolder(note.id, folder.id);
    }
  }

  ngOnDestroy(): void {
    this.unregisterFns.forEach(fn => fn());
    this.unsubscribeNotesChanged();
  }

  private registerShortcuts(): void {
    const reg = (def: Parameters<ShortcutsService['register']>[0]) => {
      this.unregisterFns.push(this.shortcutsService.register(def));
    };

    const bind = (id: string, handler: () => void): void => {
      this.unregisterFns.push(this.shortcutsService.bindAction(id, handler));
    };

    // Prevent Ctrl+R from reloading the app
    reg({ key: 'r', ctrl: true, handler: () => { /* noop — block browser reload */ } });

    // Rebindable shortcuts: the key combination comes from the settings (see APP_SHORTCUTS)
    bind('palette.commands', () => this.paletteService.toggle('command'));
    bind('note.new', () => this.createNote());
    bind('tab.close', () => this.tabsService.closeActiveTab());
    bind('tab.next', () => this.tabsService.nextTab());
    bind('tab.prev', () => this.tabsService.prevTab());
    bind('search.global', () => this.paletteService.open('search'));
    bind('editor.find', () => { if (this.activeNoteId() !== null) this.editorRef?.openSearch(); });
    bind('settings.open', () => this.settingsService.open());
    bind('layout.toggle', () => this.layoutService.toggle());
    bind('theme.toggle', () => { void this.themeService.toggle(); });
    bind('formattingBar.toggle', () => this.formattingBar.toggle());
    bind('sidebar.toggle', () => this.sidebarState.toggleVisible());
    bind('tab.pin', () => this.tabsService.togglePinActiveTab());
    for (let i = 1; i <= 9; i++) {
      bind(`tab.goto.${i}`, () => this.tabsService.setActiveIndex(i - 1));
    }

    reg({
      key: 'Escape', preventDefault: false,
      handler: () => {
        // Escape belongs to an open drop-down first
        if (document.querySelector('[data-select-open]')) return;
        if (this.settingsService.isOpen()) this.settingsService.close();
        else if (this.paletteService.isOpen()) this.paletteService.close();
        else this.editorRef?.closeSearch();
      }
    });

  }

  private async createNote(): Promise<void> {
    const note = await this.notesService.create();
    this.tabsService.openNote(note.id, 'Untitled');
  }
}
