export interface Folder {
  id: number;
  name: string;
  /** `null` for a folder at the root of the tree. */
  parentId: number | null;
  createdAt: string;
  /** The default folder always exists: it can be neither deleted nor moved, and receives the notes created on the fly. */
  isDefault: boolean;
  /** Manual position among the siblings; `null` until the user reorders (then alphabetical, after the ordered ones). */
  sortOrder: number | null;
  /** `#rrggbb` chosen in the sidebar, `null` for none. */
  color: string | null;
}

/** What the sidebar needs to know about a note to place it in the tree. */
export interface TreeNote {
  id: number;
  title: string;
  folderId: number | null;
  sortOrder: number | null;
  color?: string | null;
}

export interface FolderTreeNode {
  folder: Folder;
  /** 0 for a root folder. */
  depth: number;
  children: FolderTreeNode[];
  /** Notes directly inside this folder. */
  notes: TreeNote[];
  /** Notes inside this folder and all its sub-folders. */
  noteCount: number;
}

export type FolderTreeRow =
  | { kind: 'folder'; depth: number; node: FolderTreeNode }
  | { kind: 'note'; depth: number; note: TreeNote };

/** What is being dragged in the sidebar. */
export interface SidebarDragItem {
  kind: 'note' | 'folder';
  id: number;
}

/** Where a dragged item lands: inside a folder (`null` = root), or at an exact position among siblings. */
export type DropPlacement =
  | { kind: 'into'; folderId: number | null }
  | { kind: 'between'; parentId: number | null; anchorId: number; side: 'before' | 'after' };

/** Confirmation the sidebar is waiting for. */
export type SidebarDialogState =
  | { kind: 'deleteFolder'; folderId: number }
  | { kind: 'deepFolder'; parentId: number }
  | { kind: 'emptyFolder'; folderId: number }
  /** Several selected items at once (already reduced to the top-level ones). */
  | { kind: 'bulkDelete'; items: SidebarDragItem[] };

/** One destination of the "Move to…" dialog. */
export interface FolderOption {
  /** `null` for the root of the tree. */
  id: number | null;
  label: string;
  depth: number;
  /** A folder cannot go into itself or one of its own sub-folders. */
  disabled: boolean;
}

/** What happens to the content of a deleted folder (its sub-folders are always deleted). */
export type FolderDeleteMode = 'moveToRoot' | 'deleteAll';

/** Beyond this depth the tree gets hard to navigate: the user is warned, not blocked. */
export const FOLDER_RECOMMENDED_MAX_DEPTH = 4;

export const DEFAULT_FOLDER_NAME = 'Inbox';

export const GETTING_STARTED_FOLDER_NAME = 'Getting started';
