import { Injectable } from '@angular/core';
import { CollectionFileRef, CollectionKind, CollectionsEvent } from '../models/collection.model';

/** Raw row of the `collections` table (snake_case from SQLite). */
export interface CollectionRow {
  path: string;
  kind: CollectionKind;
  display_name: string;
  sort_order: number;
}

interface CollectionsApi {
  listCollections: () => Promise<CollectionRow[]>;
  pickCollections: (kind: CollectionKind) => Promise<CollectionRow[]>;
  openCollectionPaths: (paths: string[]) => Promise<CollectionFileRef[]>;
  removeCollection: (root: string) => Promise<boolean>;
  renameCollection: (root: string, name: string) => Promise<CollectionRow | null>;
  relocateCollection: (root: string) => Promise<CollectionRow | null>;
  rescanCollection: (root: string) => Promise<boolean>;
  readCollectionFile: (root: string, path: string) => Promise<string>;
  writeCollectionFile: (root: string, path: string, content: string) => Promise<boolean>;
  createCollectionFile: (root: string, folder: string, name: string) => Promise<string>;
  renameCollectionPath: (root: string, path: string, name: string) => Promise<string>;
  moveCollectionPath: (root: string, path: string, folder: string) => Promise<string>;
  trashCollectionPath: (root: string, path: string) => Promise<boolean>;
  revealCollectionPath: (root: string, path: string) => Promise<boolean>;
  searchCollections: (query: string) => Promise<number>;
  cancelCollectionSearch: (requestId: number) => Promise<boolean>;
  getPathForFile: (file: File) => string;
  onCollectionsEvent: (callback: (event: CollectionsEvent) => void) => () => void;
  onCollectionsOpen: (callback: (refs: CollectionFileRef[]) => void) => () => void;
}

/** Access to the collections of the main process (disk folders / files). Outside Electron everything is empty. */
@Injectable({ providedIn: 'root' })
export class CollectionsBridgeService {
  private readonly api = ((window as unknown as Record<string, unknown>)['electronAPI'] as CollectionsApi | undefined) ?? null;

  list(): Promise<CollectionRow[]> { return this.api?.listCollections() ?? Promise.resolve([]); }
  pick(kind: CollectionKind): Promise<CollectionRow[]> { return this.api?.pickCollections(kind) ?? Promise.resolve([]); }
  openPaths(paths: string[]): Promise<CollectionFileRef[]> { return this.api?.openCollectionPaths(paths) ?? Promise.resolve([]); }
  remove(root: string): Promise<boolean> { return this.api?.removeCollection(root) ?? Promise.resolve(false); }
  rename(root: string, name: string): Promise<CollectionRow | null> { return this.api?.renameCollection(root, name) ?? Promise.resolve(null); }
  relocate(root: string): Promise<CollectionRow | null> { return this.api?.relocateCollection(root) ?? Promise.resolve(null); }
  rescan(root: string): Promise<boolean> { return this.api?.rescanCollection(root) ?? Promise.resolve(false); }
  read(ref: CollectionFileRef): Promise<string> { return this.api?.readCollectionFile(ref.root, ref.path) ?? Promise.resolve(''); }
  write(ref: CollectionFileRef, content: string): Promise<boolean> { return this.api?.writeCollectionFile(ref.root, ref.path, content) ?? Promise.resolve(false); }
  createFile(root: string, folder: string, name: string): Promise<string> { return this.api?.createCollectionFile(root, folder, name) ?? Promise.reject(new Error('Not in Electron')); }
  renamePath(ref: CollectionFileRef, name: string): Promise<string> { return this.api?.renameCollectionPath(ref.root, ref.path, name) ?? Promise.reject(new Error('Not in Electron')); }
  movePath(ref: CollectionFileRef, folder: string): Promise<string> { return this.api?.moveCollectionPath(ref.root, ref.path, folder) ?? Promise.reject(new Error('Not in Electron')); }
  trash(ref: CollectionFileRef): Promise<boolean> { return this.api?.trashCollectionPath(ref.root, ref.path) ?? Promise.resolve(false); }
  reveal(ref: CollectionFileRef): Promise<boolean> { return this.api?.revealCollectionPath(ref.root, ref.path) ?? Promise.resolve(false); }
  search(query: string): Promise<number> { return this.api?.searchCollections(query) ?? Promise.resolve(0); }
  cancelSearch(requestId: number): Promise<boolean> { return this.api?.cancelCollectionSearch(requestId) ?? Promise.resolve(false); }
  pathForFile(file: File): string | null { return this.api?.getPathForFile(file) || null; }
  onEvent(callback: (event: CollectionsEvent) => void): () => void { return this.api?.onCollectionsEvent(callback) ?? (() => undefined); }
  onOpen(callback: (refs: CollectionFileRef[]) => void): () => void { return this.api?.onCollectionsOpen(callback) ?? (() => undefined); }
}
