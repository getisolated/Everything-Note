import { describe, it, expect } from 'vitest';
import { Folder } from '../src/app/core/models/folder.model';
import { itemKey, parseItemKey, rangeBetween, topLevelItems } from '../src/app/core/utils/sidebar-selection.util';

const folder = (id: number, parentId: number | null): Folder =>
  ({ id, name: `F${id}`, parentId, createdAt: '', isDefault: false, sortOrder: null, color: null });

const folders = [folder(1, null), folder(2, 1), folder(3, null)];
const notes = [
  { id: 10, title: 'a', folderId: 2, sortOrder: null },
  { id: 11, title: 'b', folderId: 3, sortOrder: null },
  { id: 12, title: 'c', folderId: null, sortOrder: null },
];

describe('itemKey / parseItemKey', () => {
  it('round-trips folders and notes', () => {
    expect(itemKey({ kind: 'folder', id: 4 })).toBe('f4');
    expect(parseItemKey('n12')).toEqual({ kind: 'note', id: 12 });
    expect(parseItemKey('x1')).toBeNull();
  });
});

describe('rangeBetween', () => {
  const keys = ['f1', 'f2', 'n10', 'f3', 'n12'];

  it('takes every row between the anchor and the target, in both directions', () => {
    expect(rangeBetween(keys, 'f2', 'f3')).toEqual(['f2', 'n10', 'f3']);
    expect(rangeBetween(keys, 'n12', 'n10')).toEqual(['n10', 'f3', 'n12']);
  });

  it('falls back to the target alone without a usable anchor, and to nothing for an unknown target', () => {
    expect(rangeBetween(keys, null, 'f3')).toEqual(['f3']);
    expect(rangeBetween(keys, 'gone', 'f3')).toEqual(['f3']);
    expect(rangeBetween(keys, 'f1', 'gone')).toEqual([]);
  });
});

describe('topLevelItems', () => {
  it('drops what a selected folder already carries', () => {
    const items = [
      { kind: 'folder' as const, id: 1 },
      { kind: 'folder' as const, id: 2 },
      { kind: 'note' as const, id: 10 },
      { kind: 'note' as const, id: 11 },
      { kind: 'note' as const, id: 12 },
    ];
    expect(topLevelItems(items, folders, notes)).toEqual([
      { kind: 'folder', id: 1 },
      { kind: 'note', id: 11 },
      { kind: 'note', id: 12 },
    ]);
  });

  it('keeps a note whose folder is not selected', () => {
    expect(topLevelItems([{ kind: 'folder', id: 3 }, { kind: 'note', id: 10 }], folders, notes)).toHaveLength(2);
  });
});
