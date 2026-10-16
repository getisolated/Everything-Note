import { promises as fs } from 'fs';
import * as path from 'path';

/** One entry of a collection tree; `path` is relative to the collection root, with `/` separators. */
export interface CollectionNode {
  name: string;
  path: string;
  kind: 'folder' | 'file';
  children?: CollectionNode[];
}

export interface ScanResult {
  tree: CollectionNode[];
  /** Paths of every markdown file, relative to the root (what the search goes through). */
  files: string[];
  /** The scan stopped at MAX_SCANNED_FILES or MAX_SCAN_DEPTH: the tree is incomplete. */
  truncated: boolean;
}

/** Folders never worth listing in a documentation tree (build output, dependencies, tool caches). */
export const DEFAULT_COLLECTION_EXCLUDES: readonly string[] = [
  'node_modules', 'bin', 'obj', 'build', 'dist', 'out', 'target', 'coverage', 'vendor',
  '__pycache__', 'venv', '.venv', '.git', '.angular', '.next', '.nuxt', '.vs', '.vscode', '.idea',
];

/** Beyond this, the scan stops (a whole drive opened by mistake must not freeze anything). */
export const MAX_SCANNED_FILES = 20000;
export const MAX_SCAN_DEPTH = 32;

const MARKDOWN_EXTENSION = /\.md$/i;

export function isMarkdownFile(name: string): boolean {
  return MARKDOWN_EXTENSION.test(name);
}

/** Hidden folders (`.something`) and the excluded names (case-insensitive) are skipped. */
export function isExcludedFolder(name: string, excludes: readonly string[]): boolean {
  const lower = name.toLowerCase();
  return name.startsWith('.') || excludes.some(exclude => exclude.toLowerCase() === lower);
}

function compareNodes(a: CollectionNode, b: CollectionNode): number {
  if (a.kind !== b.kind) {
    return a.kind === 'folder' ? -1 : 1;
  }
  return a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' });
}

/**
 * Markdown tree of a folder: only the `.md` files, and only the folders holding some (at any depth).
 * Iterative and asynchronous; unreadable folders are skipped rather than failing the whole scan.
 */
export async function scanFolder(root: string, excludes: readonly string[]): Promise<ScanResult> {
  const files: string[] = [];
  let truncated = false;

  const visit = async (directory: string, relative: string, depth: number): Promise<CollectionNode[]> => {
    if (depth > MAX_SCAN_DEPTH) {
      truncated = true;
      return [];
    }

    let entries: import('fs').Dirent[];
    try {
      entries = await fs.readdir(directory, { withFileTypes: true });
    } catch {
      return [];
    }

    const nodes: CollectionNode[] = [];

    for (const entry of entries) {
      if (files.length >= MAX_SCANNED_FILES) {
        truncated = true;
        break;
      }

      const childPath = relative ? `${relative}/${entry.name}` : entry.name;

      if (entry.isDirectory()) {
        if (isExcludedFolder(entry.name, excludes)) {
          continue;
        }
        const children = await visit(path.join(directory, entry.name), childPath, depth + 1);
        // A folder without markdown anywhere below it is not shown
        if (children.length > 0) {
          nodes.push({ name: entry.name, path: childPath, kind: 'folder', children });
        }
      } else if (entry.isFile() && isMarkdownFile(entry.name)) {
        files.push(childPath);
        nodes.push({ name: entry.name, path: childPath, kind: 'file' });
      }
    }

    return nodes.sort(compareNodes);
  };

  const tree = await visit(root, '', 0);
  return { tree, files, truncated };
}

/**
 * Absolute path of `relative` inside `root`, or `null` when it would leave the root (`..`, absolute paths,
 * another drive): the renderer only ever designates files through this check.
 */
export function resolveInside(root: string, relative: string): string | null {
  if (typeof relative !== 'string' || relative.includes('\0')) {
    return null;
  }

  const resolved = path.resolve(root, relative);
  const back = path.relative(root, resolved);

  if (back === '' || back.startsWith('..') || path.isAbsolute(back)) {
    return null;
  }

  return resolved;
}

/** One line of a file matching a search. */
export interface FileMatch {
  /** 1-based line number. */
  line: number;
  /** The line, cut to MAX_MATCH_LINE_LENGTH around the match. */
  text: string;
  /** Match position in `text`. */
  from: number;
  to: number;
}

const MAX_MATCH_LINE_LENGTH = 160;
const CONTEXT_BEFORE = 40;

/** Lines of `content` containing `query` (case-insensitive), up to `limit`. */
export function findInText(content: string, query: string, limit: number): FileMatch[] {
  const needle = query.toLowerCase();
  const matches: FileMatch[] = [];

  if (!needle) {
    return matches;
  }

  const lines = content.split(/\r?\n/);

  for (let index = 0; index < lines.length && matches.length < limit; index++) {
    const line = lines[index] as string;
    const column = line.toLowerCase().indexOf(needle);

    if (column === -1) {
      continue;
    }

    const start = Math.max(0, column - CONTEXT_BEFORE);
    const text = line.slice(start, start + MAX_MATCH_LINE_LENGTH);
    matches.push({ line: index + 1, text, from: column - start, to: Math.min(text.length, column - start + needle.length) });
  }

  return matches;
}
