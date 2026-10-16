import { describe, it, expect } from 'vitest';
import { linkStatus } from '../src/app/core/utils/note-paths.util';

const resolve = (target: string): number | null => (target === 'Folder/Here' ? 1 : null);
const exists = (id: number): boolean => id === 1;

describe('linkStatus', () => {
  it('recognises existing notes by path or by note://id', () => {
    expect(linkStatus('Folder/Here', resolve, exists)).toBe('note');
    expect(linkStatus('note://1', resolve, exists)).toBe('note');
  });

  it('flags local links pointing to nothing as broken', () => {
    expect(linkStatus('Folder/Gone', resolve, exists)).toBe('broken');
    expect(linkStatus('note://42', resolve, exists)).toBe('broken');
  });

  it('never flags external addresses nor anchors', () => {
    expect(linkStatus('https://example.com', resolve, exists)).toBe('external');
    expect(linkStatus('mailto:a@b.c', resolve, exists)).toBe('external');
    expect(linkStatus('#section', resolve, exists)).toBe('anchor');
  });
});
