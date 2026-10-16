import { describe, it, expect } from 'vitest';
import { inflateRawSync } from 'zlib';
import { safeFileName, zipPaths } from '../electron/export';
import { createZip } from '../electron/zip';

describe('safeFileName', () => {
  it('replaces the characters Windows forbids and trims trailing dots and spaces', () => {
    expect(safeFileName('a/b:c*d?')).toBe('a-b-c-d-');
    expect(safeFileName('  Notes du jour.  ')).toBe('Notes du jour');
  });

  it('never returns an empty or reserved name', () => {
    expect(safeFileName('   ')).toBe('Untitled');
    expect(safeFileName('...')).toBe('Untitled');
    expect(safeFileName('CON')).toBe('CON-');
  });
});

describe('zipPaths', () => {
  it('adds the extension, keeps the folders and numbers duplicates', () => {
    expect(zipPaths([
      { path: 'Projet/Idées', content: '' },
      { path: 'Projet/idées', content: '' },
      { path: 'a:b', content: '' },
    ])).toEqual(['Projet/Idées.md', 'Projet/idées (2).md', 'a-b.md']);
  });
});

describe('createZip', () => {
  it('writes entries that read back (local headers, deflate, central directory)', () => {
    const zip = createZip([
      { path: 'Dossier/Été.md', data: Buffer.from('# Été\n\nContenu') },
      { path: 'b.md', data: Buffer.from('') },
    ]);

    expect(zip.readUInt32LE(0)).toBe(0x04034b50);
    const nameLength = zip.readUInt16LE(26);
    const compressedSize = zip.readUInt32LE(18);
    expect(zip.subarray(30, 30 + nameLength).toString('utf-8')).toBe('Dossier/Été.md');
    expect(inflateRawSync(zip.subarray(30 + nameLength, 30 + nameLength + compressedSize)).toString()).toBe('# Été\n\nContenu');

    const end = zip.subarray(zip.length - 22);
    expect(end.readUInt32LE(0)).toBe(0x06054b50);
    expect(end.readUInt16LE(10)).toBe(2);
  });
});
