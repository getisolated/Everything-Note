import { Folder, SidebarDragItem, TreeNote } from '../models/folder.model';
import { collectSubtreeIds } from './folder-tree.util';

/** Key of a sidebar row, as used by the selection: `f<id>` for a folder, `n<id>` for a note. */
export function itemKey(item: SidebarDragItem): string {
  return `${item.kind === 'folder' ? 'f' : 'n'}${item.id}`;
}

export function parseItemKey(key: string): SidebarDragItem | null {
  const match = /^(?<kind>[fn])(?<id>\d+)$/.exec(key);

  if (!match?.groups) {
    return null;
  }

  return { kind: match.groups['kind'] === 'f' ? 'folder' : 'note', id: Number(match.groups['id']) };
}

/** Keys from `anchor` to `target` included, in display order (Shift+click); just `target` when the anchor is gone. */
export function rangeBetween(orderedKeys: readonly string[], anchor: string | null, target: string): string[] {
  const end = orderedKeys.indexOf(target);
  const start = anchor === null ? -1 : orderedKeys.indexOf(anchor);

  if (end === -1) {
    return [];
  }

  if (start === -1) {
    return [target];
  }

  return orderedKeys.slice(Math.min(start, end), Math.max(start, end) + 1);
}

/**
 * The selected items an action really applies to: a selected folder carries everything below it, so its
 * selected descendants (sub-folders, notes) are left out instead of being handled twice.
 */
export function topLevelItems(items: readonly SidebarDragItem[], folders: Folder[], notes: readonly TreeNote[]): SidebarDragItem[] {
  const covered = new Set<number>();

  for (const item of items) {
    if (item.kind === 'folder') {
      collectSubtreeIds(folders, item.id).filter(id => id !== item.id).forEach(id => covered.add(id));
    }
  }

  const selectedFolders = new Set(items.filter(item => item.kind === 'folder').map(item => item.id));
  const folderOf = new Map(notes.map(note => [note.id, note.folderId]));

  return items.filter(item => {
    if (item.kind === 'folder') {
      return !covered.has(item.id);
    }

    const folderId = folderOf.get(item.id) ?? null;
    return folderId === null || (!selectedFolders.has(folderId) && !covered.has(folderId));
  });
}
