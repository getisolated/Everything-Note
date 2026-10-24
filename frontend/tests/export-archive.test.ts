import { describe, it, expect } from 'vitest';
import { Folder } from '../src/app/core/models/folder.model';
import { folderArchiveEntries, selectionArchiveEntries } from '../src/app/core/utils/export-archive.util';

const folder = (id: number, name: string, parentId: number | null): Folder =>
  ({ id, name, parentId, createdAt: '', isDefault: false, sortOrder: null, color: null });

// Projet / Specs / Archive, and Perso at the root
const folders = [folder(1, 'Projet', null), folder(2, 'Specs', 1), folder(3, 'Archive', 2), folder(4, 'Perso', null)];
const notes = [
  { id: 10, title: 'Plan', folderId: 1 },
  { id: 11, title: 'API', folderId: 2 },
  { id: 12, title: 'Old', folderId: 3 },
  { id: 13, title: 'Courses', folderId: 4 },
  { id: 14, title: 'Loose', folderId: null },
];
const title = (note: { title: string }) => note.title;
const paths = (entries: { path: string }[]) => entries.map(entry => entry.path);

describe('folderArchiveEntries', () => {
  it('keeps the folder tree below the exported folder', () => {
    expect(paths(folderArchiveEntries(1, folders, notes, title))).toEqual(['Plan', 'Specs/API', 'Specs/Archive/Old']);
    expect(paths(folderArchiveEntries(2, folders, notes, title))).toEqual(['API', 'Archive/Old']);
  });

  it('starts the paths with the folder name when asked (a folder among a selection)', () => {
    expect(paths(folderArchiveEntries(2, folders, notes, title, true))).toEqual(['Specs/API', 'Specs/Archive/Old']);
  });

  it('carries each note with its path', () => {
    expect(folderArchiveEntries(4, folders, notes, title)).toEqual([{ note: notes[3], path: 'Courses' }]);
  });
});

describe('selectionArchiveEntries', () => {
  it('puts the selected notes at the root and the selected folders in their own sub-tree', () => {
    const entries = selectionArchiveEntries(
      [{ kind: 'note', id: 14 }, { kind: 'folder', id: 2 }, { kind: 'note', id: 13 }],
      folders,
      notes,
      title,
    );

    expect(paths(entries)).toEqual(['Loose', 'Specs/API', 'Specs/Archive/Old', 'Courses']);
  });

  it('skips notes that no longer exist', () => {
    expect(selectionArchiveEntries([{ kind: 'note', id: 99 }], folders, notes, title)).toEqual([]);
  });
});
