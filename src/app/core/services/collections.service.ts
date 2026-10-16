import { Injectable, computed, inject, signal } from '@angular/core';
import {
  Collection, CollectionChange, CollectionFileRef, CollectionGraph, CollectionKind, CollectionNode, CollectionSearchHit,
  CollectionState, CollectionsEvent,
} from '../models/collection.model';
import { baseName, flattenFiles, labelCollections, movedPath, parentPath } from '../utils/collection.util';
import { CollectionRow, CollectionsBridgeService } from './collections-bridge.service';
import { FileDocsService } from './file-docs.service';
import { TabsService } from './tabs.service';

type RawState = Omit<CollectionState, 'label' | 'hint'>;

interface RunningSearch {
  requestId: number;
  onHit: (hit: CollectionSearchHit) => void;
  onDone: () => void;
}

function toCollection(row: CollectionRow): Collection {
  return { path: row.path, kind: row.kind, displayName: row.display_name, sortOrder: row.sort_order };
}

/**
 * Collections: folders and markdown files of the disk, listed apart from the notes. Their trees come from the
 * collections worker in the background; their files open in editor tabs (see FileDocsService for their ids).
 */
@Injectable({ providedIn: 'root' })
export class CollectionsService {
  private readonly bridge = inject(CollectionsBridgeService);
  private readonly fileDocs = inject(FileDocsService);
  private readonly tabs = inject(TabsService);

  private readonly raw = signal<RawState[]>([]);
  private readonly _lastChange = signal<CollectionChange | null>(null);
  private readonly _selectedRoot = signal<string | null>(null);
  private readonly _graphs = signal<ReadonlyMap<string, CollectionGraph>>(new Map());
  private search: RunningSearch | null = null;
  private started = false;

  readonly states = computed<CollectionState[]>(() => {
    const raw = this.raw();
    const labels = labelCollections(raw.map(state => state.collection));
    return raw.map((state, index) => ({ ...state, label: labels[index]?.label ?? state.collection.displayName, hint: labels[index]?.hint ?? null }));
  });

  /** Collection selected in the sidebar: the home page draws its graph instead of the notes'. */
  readonly selectedRoot = this._selectedRoot.asReadonly();

  readonly selectedState = computed(() => this.states().find(state => state.collection.path === this._selectedRoot()) ?? null);

  /** Graph of the selected collection, once the worker has read its files. */
  readonly selectedGraph = computed<CollectionGraph | null>(() => {
    const root = this._selectedRoot();
    return root === null ? null : this._graphs().get(root) ?? null;
  });

  /** Files modified on disk, as last reported: the editor reloads an open one. */
  readonly lastChange = this._lastChange.asReadonly();

  /** Every file of every collection, for the palette. */
  readonly files = computed<{ ref: CollectionFileRef; label: string }[]>(() =>
    this.states().flatMap(state => flattenFiles(state.collection.path, state.tree).map(ref => ({ ref, label: `${state.label}/${ref.path}` })))
  );

  /** Listens to the worker and loads the list; never awaited: the core notes do not wait for the disk. */
  start(): void {
    if (this.started) {
      return;
    }

    this.started = true;
    this.bridge.onEvent(event => this.onEvent(event));
    this.bridge.onOpen(refs => refs.forEach(ref => this.open(ref)));
    void this.reload();
  }

  async reload(): Promise<void> {
    const rows = await this.bridge.list();
    const previous = new Map(this.raw().map(state => [state.collection.path, state]));

    this.raw.set(rows.map(row => previous.get(row.path) ?? { collection: toCollection(row), status: 'loading', tree: [], error: null, truncated: false }));
  }

  /** Selects a collection (its graph shows on the home page); null goes back to the notes. */
  select(root: string | null): void {
    this._selectedRoot.set(root);

    if (root !== null) {
      void this.bridge.requestGraph(root);
    }
  }

  async add(kind: CollectionKind): Promise<void> {
    const rows = await this.bridge.pick(kind);
    await this.reload();

    // A markdown file opened on its own is opened in the editor right away
    rows.filter(row => row.kind === 'file').forEach(row => this.open({ root: row.path, path: baseName(row.path) }));
  }

  /** Files and folders dropped on the window, or passed by Windows. */
  async addPaths(paths: string[]): Promise<void> {
    const refs = await this.bridge.openPaths(paths);
    await this.reload();
    refs.forEach(ref => this.open(ref));
  }

  async remove(root: string): Promise<void> {
    await this.bridge.remove(root);
    this.fileDocs.idsUnder(root).forEach(id => this.tabs.closeByNoteId(id));
    this.raw.update(states => states.filter(state => state.collection.path !== root));

    if (this._selectedRoot() === root) {
      this._selectedRoot.set(null);
    }
  }

  async rename(root: string, displayName: string): Promise<void> {
    const row = await this.bridge.rename(root, displayName);

    if (row) {
      this.updateState(root, state => ({ ...state, collection: toCollection(row) }));
    }
  }

  /** The folder is missing (moved on disk): the user points to its new location. */
  async relocate(root: string): Promise<void> {
    const row = await this.bridge.relocate(root);

    if (row) {
      this.fileDocs.idsUnder(root).forEach(id => this.tabs.closeByNoteId(id));
      await this.reload();
    }
  }

  reveal(ref: CollectionFileRef): void {
    void this.bridge.reveal(ref);
  }

  open(ref: CollectionFileRef): void {
    this.tabs.openNote(this.fileDocs.idFor(ref), baseName(ref.path), ref);
  }

  read(ref: CollectionFileRef): Promise<string> {
    return this.bridge.read(ref);
  }

  write(ref: CollectionFileRef, content: string): Promise<boolean> {
    return this.bridge.write(ref, content);
  }

  async createFile(root: string, folder: string, name: string): Promise<void> {
    const path = await this.bridge.createFile(root, folder, name);
    this.open({ root, path });
  }

  /** Renames a file or folder; the open tabs of what it holds follow. */
  async renamePath(ref: CollectionFileRef, name: string): Promise<void> {
    const path = await this.bridge.renamePath(ref, name);
    this.retargetTabs(ref, path);
  }

  async movePath(ref: CollectionFileRef, folder: string): Promise<void> {
    const path = await this.bridge.movePath(ref, folder);
    this.retargetTabs(ref, path);
  }

  /** To the recycle bin; the open tabs of what it held are closed. */
  async trash(ref: CollectionFileRef): Promise<void> {
    await this.bridge.trash(ref);
    this.fileDocs.idsUnder(ref.root, ref.path).forEach(id => this.tabs.closeByNoteId(id));
  }

  /** Searches the files of every collection; hits arrive as the worker reads them. Returns a cancel function. */
  async searchFiles(query: string, onHit: (hit: CollectionSearchHit) => void, onDone: () => void): Promise<() => void> {
    this.cancelSearch();
    const requestId = await this.bridge.search(query);
    this.search = { requestId, onHit, onDone };
    return () => {
      if (this.search?.requestId === requestId) {
        this.cancelSearch();
      }
    };
  }

  private cancelSearch(): void {
    if (this.search) {
      void this.bridge.cancelSearch(this.search.requestId);
      this.search = null;
    }
  }

  private retargetTabs(from: CollectionFileRef, newPath: string): void {
    for (const id of this.fileDocs.idsUnder(from.root, from.path)) {
      const ref = this.fileDocs.refFor(id);
      const path = ref ? movedPath(ref.path, from.path, newPath) : null;

      if (ref && path !== null) {
        const next = { root: ref.root, path };
        this.fileDocs.retarget(ref, next);
        this.tabs.updateFile(id, next, baseName(path));
      }
    }
  }

  private updateState(root: string, update: (state: RawState) => RawState): void {
    this.raw.update(states => states.map(state => (state.collection.path === root ? update(state) : state)));
  }

  private onEvent(event: CollectionsEvent): void {
    switch (event.type) {
      case 'tree':
        this.updateState(event.root, state => ({ ...state, status: 'ready', tree: event.tree, error: null, truncated: event.truncated }));
        this.refreshGraph(event.root);
        break;
      case 'error':
        this.updateState(event.root, state => ({ ...state, status: 'error', tree: [], error: event.message }));
        break;
      case 'changed':
        this._lastChange.set({ root: event.root, paths: event.paths });
        // An edited file may have gained or lost links
        this.refreshGraph(event.root);
        break;
      case 'graph':
        this._graphs.update(graphs => new Map(graphs).set(event.root, event.graph));
        break;
      case 'searchResults':
        this.onSearchResults(event);
        break;
    }
  }

  /** Only the selected collection's graph is kept up to date: reading every file of every collection is wasted. */
  private refreshGraph(root: string): void {
    if (this._selectedRoot() === root) {
      void this.bridge.requestGraph(root);
    }
  }

  private onSearchResults(event: Extract<CollectionsEvent, { type: 'searchResults' }>): void {
    const search = this.search;

    if (!search || search.requestId !== event.requestId) {
      return;
    }

    if (event.done) {
      search.onDone();
      this.search = null;
      return;
    }

    const state = this.states().find(candidate => candidate.collection.path === event.root);
    const label = state ? `${state.label}/${event.path}` : event.path;
    search.onHit({ ref: { root: event.root, path: event.path }, label, matches: event.matches });
  }

  /** Folder of a node, as the "new file" action needs it ('' for the root). */
  folderOf(node: CollectionNode | null): string {
    if (!node) {
      return '';
    }
    return node.kind === 'folder' ? node.path : parentPath(node.path);
  }
}
