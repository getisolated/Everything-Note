import type { CollectionGraph, CollectionNode, FileMatch } from './collections-scan';

export type CollectionKind = 'folder' | 'file';

/** Main process → collections worker. */
export type WorkerRequest =
  | { type: 'watch'; root: string; kind: CollectionKind }
  | { type: 'unwatch'; root: string }
  | { type: 'rescan'; root: string }
  | { type: 'setExcludes'; excludes: string[] }
  | { type: 'search'; requestId: number; query: string }
  | { type: 'cancelSearch'; requestId: number }
  /** Asks the graph of the links between the files of one collection. */
  | { type: 'graph'; root: string };

/** Collections worker → main process, forwarded as is to the window (`collections:event`). */
export type WorkerResponse =
  | { type: 'tree'; root: string; tree: CollectionNode[]; truncated: boolean }
  | { type: 'error'; root: string; message: string }
  /** Markdown files modified on disk (relative paths): open editors may reload them. */
  | { type: 'changed'; root: string; paths: string[] }
  | { type: 'searchResults'; requestId: number; root: string; path: string; matches: FileMatch[]; done: boolean }
  | { type: 'graph'; root: string; graph: CollectionGraph };
