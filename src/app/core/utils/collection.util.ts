import { Collection, CollectionFileRef, CollectionNode } from '../models/collection.model';

/** Last segment of a path, whatever its separators. */
export function baseName(path: string): string {
  const segments = path.split(/[\\/]/).filter(Boolean);
  return segments[segments.length - 1] ?? path;
}

/** Parent folder of a path, whatever its separators ('' at the top). */
export function parentPath(path: string): string {
  const index = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'));
  return index === -1 ? '' : path.slice(0, index);
}

/**
 * Labels of the collections: their display name, plus a muted hint when several share it (two `docs` folders of two
 * repositories): the name of their parent folder, or their whole parent path when even that is shared.
 */
export function labelCollections(collections: readonly Collection[]): { label: string; hint: string | null }[] {
  const byName = new Map<string, Collection[]>();

  for (const collection of collections) {
    const key = collection.displayName.toLowerCase();
    byName.set(key, [...(byName.get(key) ?? []), collection]);
  }

  return collections.map(collection => {
    const homonyms = byName.get(collection.displayName.toLowerCase()) ?? [];

    if (homonyms.length < 2) {
      return { label: collection.displayName, hint: null };
    }

    const parent = baseName(parentPath(collection.path));
    const parentShared = homonyms.filter(other => baseName(parentPath(other.path)).toLowerCase() === parent.toLowerCase()).length > 1;
    return { label: collection.displayName, hint: parentShared ? parentPath(collection.path) : parent };
  });
}

/** Where a path ends up once `from` (a file or a folder) became `to`; `null` when it is not concerned. */
export function movedPath(path: string, from: string, to: string): string | null {
  if (path === from) {
    return to;
  }
  return path.startsWith(`${from}/`) ? `${to}${path.slice(from.length)}` : null;
}

/** Every file of a tree, depth first, as the palette lists them. */
export function flattenFiles(root: string, nodes: readonly CollectionNode[]): CollectionFileRef[] {
  const files: CollectionFileRef[] = [];
  const pending = [...nodes].reverse();

  while (pending.length > 0) {
    const node = pending.pop() as CollectionNode;

    if (node.kind === 'file') {
      files.push({ root, path: node.path });
    } else {
      pending.push(...[...(node.children ?? [])].reverse());
    }
  }

  return files;
}

/**
 * Target of a relative markdown link written in a collection file, as a path of the same collection; `null` for what
 * is not a local markdown file (web address, anchor) or leaves the collection.
 */
export function resolveRelativeLink(fromFile: string, target: string): string | null {
  let cleaned = target.trim().replace(/^<|>$/g, '').split('#')[0] ?? '';

  try {
    cleaned = decodeURIComponent(cleaned);
  } catch {
    // Not percent-encoded: kept as written
  }

  if (!cleaned || /^[a-z][a-z0-9+.-]*:/i.test(cleaned)) {
    return null;
  }

  const segments = cleaned.startsWith('/') ? [] : parentPath(fromFile).split('/').filter(Boolean);

  for (const segment of cleaned.split('/')) {
    if (segment === '..') {
      if (segments.length === 0) {
        return null;
      }
      segments.pop();
    } else if (segment !== '.' && segment !== '') {
      segments.push(segment);
    }
  }

  const resolved = segments.join('/');
  return /\.md$/i.test(resolved) ? resolved : `${resolved}.md`;
}
