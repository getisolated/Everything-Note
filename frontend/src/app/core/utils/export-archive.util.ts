import { Folder, SidebarDragItem } from '../models/folder.model';
import { collectSubtreeIds } from './folder-tree.util';

/** What an archive export needs to know about a note. */
export interface ArchivableNote {
  id: number;
  title: string;
  folderId: number | null;
}

/** A note of an archive and its path inside it: folders then title, `/`-separated, without extension (added by the main process). */
export interface ArchiveEntry<N extends ArchivableNote> {
  note: N;
  path: string;
}

/**
 * The notes of `folderId` and its sub-folders, in the same folder tree. Paths start below the folder, or with its name
 * when `includeFolder` (a folder among a selection).
 */
export function folderArchiveEntries<N extends ArchivableNote>(
  folderId: number,
  folders: readonly Folder[],
  notes: readonly N[],
  title: (note: N) => string,
  includeFolder = false,
): ArchiveEntry<N>[] {
  const inSubtree = new Set(collectSubtreeIds([...folders], folderId));
  const byId = new Map(folders.map(folder => [folder.id, folder]));
  const stop = includeFolder ? byId.get(folderId)?.parentId ?? null : folderId;

  /** Folder names from the exported folder down to `id`. */
  const segments = (id: number): string[] => {
    const names: string[] = [];

    for (let current = byId.get(id); current && current.id !== stop; current = current.parentId === null ? undefined : byId.get(current.parentId)) {
      names.unshift(current.name);
    }

    return names;
  };

  return notes
    .filter(note => note.folderId !== null && inSubtree.has(note.folderId))
    .map(note => ({ note, path: [...segments(note.folderId as number), title(note)].join('/') }));
}

/**
 * The notes of a sidebar selection: selected notes at the root of the archive, selected folders as sub-folders with their
 * whole subtree. `items` are the top-level ones (`topLevelItems`): nothing is covered by another selected folder.
 */
export function selectionArchiveEntries<N extends ArchivableNote>(
  items: readonly SidebarDragItem[],
  folders: readonly Folder[],
  notes: readonly N[],
  title: (note: N) => string,
): ArchiveEntry<N>[] {
  const notesById = new Map(notes.map(note => [note.id, note]));

  return items.flatMap(item => {
    if (item.kind === 'folder') {
      return folderArchiveEntries(item.id, folders, notes, title, true);
    }

    const note = notesById.get(item.id);
    return note ? [{ note, path: title(note) }] : [];
  });
}
