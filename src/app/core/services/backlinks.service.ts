import { Injectable, computed, effect, inject, signal } from '@angular/core';
import { OVERLAY_NOTES_TAB_ID } from '../models/note.model';
import { OVERLAY_NOTE_TAG } from '../models/settings.model';
import { Backlink, buildNoteGraph, findBacklinks, NoteGraph } from '../utils/note-links.util';
import { createLinkResolver } from '../utils/note-paths.util';
import { FoldersService } from './folders.service';
import { NotesService } from './notes.service';
import { SidebarStateService } from './sidebar-state.service';
import { TabsService } from './tabs.service';
import { CollectionsService } from './collections.service';
import { FileDocsService } from './file-docs.service';
import { baseName } from '../utils/collection.util';

/** Links between notes (`note://id`): who points at the active note, and the whole graph. */
@Injectable({ providedIn: 'root' })
export class BacklinksService {
  private notes = inject(NotesService);
  private folders = inject(FoldersService);
  private tabs = inject(TabsService);
  private sidebarState = inject(SidebarStateService);

  private readonly _hideOrphans = signal(false);
  private readonly lastActiveId = signal<number | null>(null);
  private readonly collections = inject(CollectionsService);
  private readonly fileDocs = inject(FileDocsService);

  readonly hideOrphans = this._hideOrphans.asReadonly();

  /** The active note, or the last one that was while on the home page: the graph stays centred on it. */
  readonly referenceNoteId = computed<number | null>(() => {
    const id = this.tabs.activeNoteId() ?? this.lastActiveId();
    return id !== null && this.notes.notes().some(n => n.id === id) ? id : null;
  });

  constructor() {
    effect(() => {
      const activeId = this.tabs.activeNoteId();

      if (activeId !== null && activeId !== OVERLAY_NOTES_TAB_ID) {
        this.lastActiveId.set(activeId);
      }
    });
  }

  /** Overlay notes live together in their own document: they are neither linked nor drawn. */
  private readonly linkableNotes = computed(() =>
    this.notes.notes().filter(n => !n.tags.includes(OVERLAY_NOTE_TAG))
  );

  /** Resolves `[label](Folder/Note title)` links; follows the renames and moves. */
  private readonly resolver = computed(() => createLinkResolver(this.linkableNotes(), this.folders.folders()));

  /** Notes linking to the active one; follows the active tab and the edits. */
  readonly backlinks = computed<Backlink[]>(() => {
    const activeId = this.tabs.activeNoteId();
    return activeId === null || activeId === OVERLAY_NOTES_TAB_ID ? [] : findBacklinks(this.linkableNotes(), activeId, this.resolver());
  });

  /** Graph of the folder selected in the sidebar (everything when none is), or of the selected collection. */
  readonly graph = computed<NoteGraph>(() => {
    const root = this.collections.selectedRoot();

    if (root !== null) {
      return this.collectionGraph(root);
    }

    return buildNoteGraph(this.linkableNotes(), {
      folderId: this.sidebarState.selectedFolderId(),
      focusId: this.referenceNoteId(),
      hideOrphans: this._hideOrphans(),
      resolve: this.resolver(),
    });
  });

  /** The files of the collection take their session ids (FileDocsService): the graph view opens them like notes. */
  private collectionGraph(root: string): NoteGraph {
    const graph = this.collections.selectedGraph();

    if (!graph) {
      return { nodes: [], links: [] };
    }

    const idOf = (path: string): number => this.fileDocs.idFor({ root, path });
    const nodes = graph.nodes
      .filter(node => !this._hideOrphans() || node.degree > 0)
      .map(node => ({ id: idOf(node.path), title: baseName(node.path), degree: node.degree, missing: node.missing }));
    const shown = new Set(nodes.map(node => node.id));
    const links = graph.links
      .map(link => ({ source: idOf(link.source), target: idOf(link.target) }))
      .filter(link => shown.has(link.source) && shown.has(link.target));

    return { nodes, links };
  }

  toggleHideOrphans(): void {
    this._hideOrphans.update(hidden => !hidden);
  }
}
