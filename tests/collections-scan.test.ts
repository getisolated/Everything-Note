import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import * as path from 'path';
import {
  DEFAULT_COLLECTION_EXCLUDES, findInText, isExcludedFolder, resolveInside, scanFolder,
} from '../electron/collections-scan';

describe('scanFolder', () => {
  let root: string;

  beforeAll(() => {
    root = mkdtempSync(path.join(tmpdir(), 'evn-scan-'));
    const files: Record<string, string> = {
      'README.md': '# Readme',
      'docs/guide.md': 'guide',
      'docs/deep/more.MD': 'more',
      'docs/image.png': '',
      'src/index.ts': '',
      'node_modules/pkg/readme.md': '',
      '.github/notes.md': '',
      'empty/nothing.txt': '',
    };
    for (const [file, content] of Object.entries(files)) {
      mkdirSync(path.join(root, path.dirname(file)), { recursive: true });
      writeFileSync(path.join(root, file), content);
    }
  });

  afterAll(() => rmSync(root, { recursive: true, force: true }));

  it('keeps only markdown files, and only the folders that hold some', async () => {
    const { tree, files, truncated } = await scanFolder(root, DEFAULT_COLLECTION_EXCLUDES);
    expect(truncated).toBe(false);
    expect(files.sort()).toEqual(['README.md', 'docs/deep/more.MD', 'docs/guide.md']);
    expect(tree.map(node => node.name)).toEqual(['docs', 'README.md']);
    expect(tree[0]?.children?.map(node => node.path)).toEqual(['docs/deep', 'docs/guide.md']);
  });

  it('skips excluded and hidden folders', async () => {
    const { files } = await scanFolder(root, DEFAULT_COLLECTION_EXCLUDES);
    expect(files.some(file => file.startsWith('node_modules') || file.startsWith('.github'))).toBe(false);
  });
});

describe('isExcludedFolder', () => {
  it('matches the excluded names whatever the case, and hidden folders', () => {
    expect(isExcludedFolder('Node_Modules', ['node_modules'])).toBe(true);
    expect(isExcludedFolder('.cache', [])).toBe(true);
    expect(isExcludedFolder('docs', ['node_modules'])).toBe(false);
  });
});

describe('resolveInside', () => {
  const root = path.resolve('/collections/repo');

  it('resolves a path of the collection', () => {
    expect(resolveInside(root, 'docs/a.md')).toBe(path.join(root, 'docs', 'a.md'));
  });

  it('refuses whatever leaves the collection', () => {
    expect(resolveInside(root, '../other/a.md')).toBeNull();
    expect(resolveInside(root, 'docs/../../x.md')).toBeNull();
    expect(resolveInside(root, path.resolve('/elsewhere/a.md'))).toBeNull();
    expect(resolveInside(root, '')).toBeNull();
    expect(resolveInside(root, 'a\0.md')).toBeNull();
  });
});

describe('findInText', () => {
  it('finds the matching lines, case-insensitively, with the match position', () => {
    expect(findInText('Alpha\nthe BETA line\nbeta again', 'beta', 5)).toEqual([
      { line: 2, text: 'the BETA line', from: 4, to: 8 },
      { line: 3, text: 'beta again', from: 0, to: 4 },
    ]);
  });

  it('stops at the limit and ignores an empty query', () => {
    expect(findInText('a\na\na', 'a', 2)).toHaveLength(2);
    expect(findInText('a', '', 5)).toEqual([]);
  });

  it('cuts long lines around the match', () => {
    const [match] = findInText(`${'x'.repeat(100)}needle${'y'.repeat(300)}`, 'needle', 1);
    expect(match?.text.slice(match.from, match.to)).toBe('needle');
    expect(match?.text.length).toBeLessThanOrEqual(160);
  });
});
