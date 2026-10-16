export type CollectionKind = 'folder' | 'file';

/** A folder or a markdown file of the disk opened in the app; `path` (absolute) is its key. */
export interface Collection {
  path: string;
  kind: CollectionKind;
  /** Name shown in the sidebar, editable; defaults to the folder / file name. */
  displayName: string;
  sortOrder: number;
}

/** One entry of a collection tree; `path` is relative to the collection root, with `/` separators. */
export interface CollectionNode {
  name: string;
  path: string;
  kind: 'folder' | 'file';
  children?: CollectionNode[];
}

/** A file of a collection: its root and its path relative to it (the file name for a file collection). */
export interface CollectionFileRef {
  root: string;
  path: string;
}

export type CollectionStatus = 'loading' | 'ready' | 'error';

/** A collection as the sidebar shows it: loaded in the background, possibly missing from the disk. */
export interface CollectionState {
  collection: Collection;
  status: CollectionStatus;
  tree: CollectionNode[];
  /** Why the collection could not be read (folder moved or deleted…). */
  error: string | null;
  /** The scan stopped at its limit: the tree is incomplete. */
  truncated: boolean;
  /** Name shown, with the parent folder added when two collections have the same display name. */
  label: string;
  /** Distinguishing hint shown after the label, muted (`null` when the label is unique). */
  hint: string | null;
}

export interface CollectionMatch {
  line: number;
  text: string;
  from: number;
  to: number;
}

/** A file of a collection matching a search (by name or content). */
export interface CollectionSearchHit {
  ref: CollectionFileRef;
  /** Name of the collection, then the path inside it. */
  label: string;
  matches: CollectionMatch[];
}

/** Messages of the collections worker, forwarded by the main process. */
export type CollectionsEvent =
  | { type: 'tree'; root: string; tree: CollectionNode[]; truncated: boolean }
  | { type: 'error'; root: string; message: string }
  | { type: 'changed'; root: string; paths: string[] }
  | { type: 'searchResults'; requestId: number; root: string; path: string; matches: CollectionMatch[]; done: boolean };

/** Files modified on disk, as last reported (a new object each time). */
export interface CollectionChange {
  root: string;
  paths: string[];
}
