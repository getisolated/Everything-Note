import { describe, it, expect } from 'vitest';
import { buildCollectionGraph, extractLinkTargets, resolveCollectionLink } from '../electron/collections-scan';

describe('extractLinkTargets', () => {
  it('finds inline links, skips images', () => {
    expect(extractLinkTargets('See [a](./a.md "title") and ![img](pic.png), [b](<with space.md>)')).toEqual(['./a.md', '<with space.md>']);
  });
});

describe('resolveCollectionLink', () => {
  it('resolves like the renderer does', () => {
    expect(resolveCollectionLink('docs/x/intro.md', '../api.md#top')).toBe('docs/api.md');
    expect(resolveCollectionLink('intro.md', 'https://x.dev')).toBeNull();
    expect(resolveCollectionLink('intro.md', '../out.md')).toBeNull();
  });
});

describe('buildCollectionGraph', () => {
  it('links the files of a collection, counts degrees and flags missing targets', () => {
    const graph = buildCollectionGraph([
      { path: 'README.md', content: '[guide](docs/Guide.md) [again](docs/guide.md) [gone](docs/gone.md) [web](https://a.b)' },
      { path: 'docs/guide.md', content: '[home](../README.md) [self](./guide.md)' },
      { path: 'docs/alone.md', content: '' },
    ]);

    expect(graph.links).toEqual([
      { source: 'README.md', target: 'docs/guide.md' },
      { source: 'README.md', target: 'docs/gone.md' },
      { source: 'docs/guide.md', target: 'README.md' },
    ]);
    expect(graph.nodes).toEqual([
      { path: 'README.md', degree: 3, missing: false },
      { path: 'docs/guide.md', degree: 2, missing: false },
      { path: 'docs/alone.md', degree: 0, missing: false },
      { path: 'docs/gone.md', degree: 1, missing: true },
    ]);
  });
});
