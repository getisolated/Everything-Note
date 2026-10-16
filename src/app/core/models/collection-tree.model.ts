import { CollectionNode, CollectionState } from './collection.model';

/** One visible row of the collections section: a collection, or a folder / file inside one. */
export type CollectionRow =
  | { kind: 'collection'; key: string; state: CollectionState; depth: 0 }
  | { kind: 'node'; key: string; root: string; node: CollectionNode; depth: number };

/** Inline input of the collections section: renaming an entry, or naming a new file. */
export type CollectionEditing =
  | { kind: 'renameCollection'; root: string }
  | { kind: 'renamePath'; root: string; path: string }
  | { kind: 'newFile'; root: string; folder: string };
