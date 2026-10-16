import { describe, it, expect } from 'vitest';
import { baseName, flattenFiles, labelCollections, movedPath, parentPath, resolveRelativeLink } from '../src/app/core/utils/collection.util';

const collection = (path: string, displayName = baseName(path)) => ({ path, kind: 'folder' as const, displayName, sortOrder: 0 });

describe('baseName / parentPath', () => {
  it('handles both separators', () => {
    expect(baseName('C:\\repos\\a\\docs')).toBe('docs');
    expect(parentPath('docs/guide/intro.md')).toBe('docs/guide');
    expect(parentPath('intro.md')).toBe('');
  });
});

describe('labelCollections', () => {
  it('adds the parent folder to homonyms only', () => {
    expect(labelCollections([collection('C:\\a\\docs'), collection('C:\\b\\docs'), collection('C:\\c\\notes')])).toEqual([
      { label: 'docs', hint: 'a' },
      { label: 'docs', hint: 'b' },
      { label: 'notes', hint: null },
    ]);
  });

  it('falls back to the whole parent path when the parents share their name too', () => {
    const [first] = labelCollections([collection('C:\\w\\repo\\docs'), collection('D:\\v\\repo\\docs')]);
    expect(first?.hint).toBe('C:\\w\\repo');
  });

  it('compares the display names, which the user may change', () => {
    expect(labelCollections([collection('C:\\a\\docs', 'Front'), collection('C:\\b\\docs', 'Back')]).map(l => l.hint)).toEqual([null, null]);
  });
});

describe('movedPath', () => {
  it('follows a renamed file or folder', () => {
    expect(movedPath('a/b.md', 'a/b.md', 'a/c.md')).toBe('a/c.md');
    expect(movedPath('a/x/y.md', 'a/x', 'z')).toBe('z/y.md');
    expect(movedPath('a/xy.md', 'a/x', 'z')).toBeNull();
  });
});

describe('flattenFiles', () => {
  it('lists the files depth first', () => {
    const tree = [
      { name: 'docs', path: 'docs', kind: 'folder' as const, children: [{ name: 'a.md', path: 'docs/a.md', kind: 'file' as const }] },
      { name: 'README.md', path: 'README.md', kind: 'file' as const },
    ];
    expect(flattenFiles('R', tree).map(file => file.path)).toEqual(['docs/a.md', 'README.md']);
  });
});

describe('resolveRelativeLink', () => {
  it('resolves relative paths against the folder of the current file', () => {
    expect(resolveRelativeLink('docs/guide/intro.md', './setup.md')).toBe('docs/guide/setup.md');
    expect(resolveRelativeLink('docs/guide/intro.md', '../api/index.md#auth')).toBe('docs/api/index.md');
    expect(resolveRelativeLink('docs/intro.md', '/README.md')).toBe('README.md');
    expect(resolveRelativeLink('docs/intro.md', 'Other%20page')).toBe('docs/Other page.md');
  });

  it('refuses web addresses, bare anchors and paths leaving the collection', () => {
    expect(resolveRelativeLink('a.md', 'https://x.dev')).toBeNull();
    expect(resolveRelativeLink('a.md', '#top')).toBeNull();
    expect(resolveRelativeLink('a.md', '../outside.md')).toBeNull();
  });
});
