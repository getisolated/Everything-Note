import { promises as fs, realpathSync } from 'fs';
import * as path from 'path';
import { BrowserWindow, UtilityProcess, dialog, utilityProcess } from 'electron/main';
import { shell } from 'electron/common';
import { CollectionRow, collectionOps } from './database';
import { isMarkdownFile, resolveInside } from './collections-scan';
import { CollectionKind, WorkerRequest, WorkerResponse } from './collections-protocol';

/** A file to show in an editor tab: its collection and its path relative to it (the file name for a file collection). */
export interface CollectionFileRef {
  root: string;
  path: string;
}

/** A crashed worker is restarted, but not in a loop. */
const WORKER_RESTART_DELAY_MS = 2000;
const FORBIDDEN_IN_NAME = /[<>:"/\\|?*\u0000-\u001f]/;

let worker: UtilityProcess | null = null;
let getWindow: () => BrowserWindow | null = () => null;
let excludes: string[] = [];
let searchCounter = 0;

function post(message: WorkerRequest): void {
  worker?.postMessage(message);
}

function forward(message: WorkerResponse): void {
  getWindow()?.webContents.send('collections:event', message);
}

function startWorker(): void {
  worker = utilityProcess.fork(path.join(__dirname, 'collections-worker.js'), [], { serviceName: 'Everything Note collections' });
  worker.on('message', (message: WorkerResponse) => forward(message));
  worker.on('exit', () => {
    worker = null;
    setTimeout(startWorker, WORKER_RESTART_DELAY_MS);
  });

  post({ type: 'setExcludes', excludes });
  for (const row of collectionOps.getAll()) {
    post({ type: 'watch', root: row.path, kind: row.kind });
  }
}

/** Starts the worker once the window shows: the collections load in the background, after the core notes. */
export function initCollections(windowGetter: () => BrowserWindow | null, initialExcludes: string[]): void {
  getWindow = windowGetter;
  excludes = initialExcludes;
  startWorker();
}

export function stopCollections(): void {
  if (worker) {
    worker.removeAllListeners('exit');
    worker.kill();
    worker = null;
  }
}

export function setCollectionExcludes(next: string[]): void {
  excludes = next;
  post({ type: 'setExcludes', excludes });
}

/**
 * Canonical form of a path: absolute, long names (not the 8.3 `JOHNDO~1` form, which the file watcher cannot handle)
 * and the case of the disk. Left as resolved when it does not exist (yet).
 */
function canonicalPath(candidate: string): string {
  const absolute = path.resolve(candidate);

  try {
    return realpathSync.native(absolute);
  } catch {
    return absolute;
  }
}

/** Key of a collection: its canonical path; the same folder opened twice (other case) is the same collection. */
function findCollection(candidate: string): CollectionRow | undefined {
  const lower = canonicalPath(candidate).toLowerCase();
  return collectionOps.getAll().find(row => row.path.toLowerCase() === lower);
}

function requireCollection(root: unknown): CollectionRow {
  const row = typeof root === 'string' ? collectionOps.get(root) : undefined;

  if (!row) {
    throw new Error('Unknown collection');
  }
  return row;
}

/** Absolute path of a file / folder of a registered collection; anything outside of it is refused. */
function resolveRef(root: unknown, relative: unknown): { row: CollectionRow; absolute: string } {
  const row = requireCollection(root);

  if (row.kind === 'file') {
    if (relative !== path.basename(row.path)) {
      throw new Error('Path outside of the collection');
    }
    return { row, absolute: row.path };
  }

  const absolute = typeof relative === 'string' ? resolveInside(row.path, relative) : null;

  if (!absolute) {
    throw new Error('Path outside of the collection');
  }
  return { row, absolute };
}

function toRelative(row: CollectionRow, absolute: string): string {
  return path.relative(row.path, absolute).split(path.sep).join('/');
}

function checkName(name: unknown): string {
  const trimmed = typeof name === 'string' ? name.trim() : '';

  if (!trimmed || FORBIDDEN_IN_NAME.test(trimmed) || trimmed === '.' || trimmed === '..') {
    throw new Error('Invalid name');
  }
  return trimmed;
}

export function listCollections(): CollectionRow[] {
  return collectionOps.getAll();
}

/** Opens a folder or a markdown file of the disk as a collection (already opened: returned as is). */
export async function addCollection(candidate: string): Promise<CollectionRow | null> {
  const existing = findCollection(candidate);

  if (existing) {
    return existing;
  }

  const absolute = canonicalPath(candidate);
  const stats = await fs.stat(absolute).catch(() => null);
  let kind: CollectionKind;

  if (stats?.isDirectory()) {
    kind = 'folder';
  } else if (stats?.isFile() && isMarkdownFile(absolute)) {
    kind = 'file';
  } else {
    return null;
  }

  const row = collectionOps.add(absolute, kind, path.basename(absolute));

  if (row) {
    post({ type: 'watch', root: row.path, kind: row.kind });
  }
  return row ?? null;
}

/** Asks for folders (or markdown files) to open as collections. */
export async function pickCollections(window: BrowserWindow | null, kind: CollectionKind): Promise<CollectionRow[]> {
  const options: Electron.OpenDialogOptions = kind === 'folder'
    ? { title: 'Open Folder as Collection', properties: ['openDirectory', 'multiSelections'] }
    : { title: 'Open Markdown File', properties: ['openFile', 'multiSelections'], filters: [{ name: 'Markdown', extensions: ['md'] }] };
  const { canceled, filePaths } = window ? await dialog.showOpenDialog(window, options) : await dialog.showOpenDialog(options);

  if (canceled) {
    return [];
  }

  const rows = await Promise.all(filePaths.map(filePath => addCollection(filePath)));
  return rows.filter((row): row is CollectionRow => row !== null);
}

export function removeCollection(root: unknown): void {
  const row = requireCollection(root);
  collectionOps.remove(row.path);
  post({ type: 'unwatch', root: row.path });
}

export function renameCollection(root: unknown, displayName: unknown): CollectionRow | undefined {
  const row = requireCollection(root);
  const name = typeof displayName === 'string' && displayName.trim() ? displayName.trim().slice(0, 100) : path.basename(row.path);
  return collectionOps.rename(row.path, name);
}

/** The folder was moved on disk: the collection follows it (asked from the "missing folder" state). */
export async function relocateCollection(window: BrowserWindow | null, root: unknown): Promise<CollectionRow | null> {
  const row = requireCollection(root);
  const [picked] = await pickPaths(window, row.kind);

  if (!picked || findCollection(picked)) {
    return null;
  }

  post({ type: 'unwatch', root: row.path });
  const moved = collectionOps.relocate(row.path, canonicalPath(picked));

  if (moved) {
    post({ type: 'watch', root: moved.path, kind: moved.kind });
  }
  return moved ?? null;
}

async function pickPaths(window: BrowserWindow | null, kind: CollectionKind): Promise<string[]> {
  const options: Electron.OpenDialogOptions = kind === 'folder'
    ? { properties: ['openDirectory'] }
    : { properties: ['openFile'], filters: [{ name: 'Markdown', extensions: ['md'] }] };
  const { canceled, filePaths } = window ? await dialog.showOpenDialog(window, options) : await dialog.showOpenDialog(options);
  return canceled ? [] : filePaths;
}

export async function readCollectionFile(root: unknown, relative: unknown): Promise<string> {
  const { absolute } = resolveRef(root, relative);
  return fs.readFile(absolute, 'utf-8');
}

export async function writeCollectionFile(root: unknown, relative: unknown, content: unknown): Promise<void> {
  const { absolute } = resolveRef(root, relative);

  if (typeof content !== 'string' || !isMarkdownFile(absolute)) {
    throw new Error('Only markdown files can be written');
  }
  await fs.writeFile(absolute, content, 'utf-8');
}

/** Creates an empty markdown file in a folder of the collection (`folder` relative, '' for the root). Returns its path. */
export async function createCollectionFile(root: unknown, folder: unknown, name: unknown): Promise<string> {
  const row = requireCollection(root);

  if (row.kind !== 'folder') {
    throw new Error('Files can only be created in a folder collection');
  }

  const fileName = checkName(name);
  const withExtension = isMarkdownFile(fileName) ? fileName : `${fileName}.md`;
  const directory = folder === '' ? row.path : resolveRef(root, folder).absolute;
  const absolute = path.join(directory, withExtension);

  // `wx`: never overwrite an existing file
  await fs.writeFile(absolute, '', { encoding: 'utf-8', flag: 'wx' });
  return toRelative(row, absolute);
}

/** Renames a file or folder in place (same parent folder). Returns the new relative path. */
export async function renameCollectionPath(root: unknown, relative: unknown, newName: unknown): Promise<string> {
  const { row, absolute } = resolveRef(root, relative);

  if (row.kind === 'file') {
    throw new Error('Rename the file from its folder collection');
  }

  const stats = await fs.stat(absolute);
  let name = checkName(newName);

  if (stats.isFile() && !isMarkdownFile(name)) {
    name = `${name}.md`;
  }

  const target = path.join(path.dirname(absolute), name);
  await assertMissing(target);
  await fs.rename(absolute, target);
  return toRelative(row, target);
}

/** Moves a file or folder into another folder of the same collection (`folder` '' = the root). */
export async function moveCollectionPath(root: unknown, relative: unknown, folder: unknown): Promise<string> {
  const { row, absolute } = resolveRef(root, relative);
  const directory = folder === '' ? row.path : resolveRef(root, folder).absolute;
  const target = path.join(directory, path.basename(absolute));

  if (target === absolute || (target + path.sep).startsWith(absolute + path.sep)) {
    throw new Error('Cannot move a folder into itself');
  }

  await assertMissing(target);
  await fs.rename(absolute, target);
  return toRelative(row, target);
}

async function assertMissing(target: string): Promise<void> {
  const exists = await fs.stat(target).then(() => true, () => false);

  if (exists) {
    throw new Error('A file or folder with this name already exists');
  }
}

/** Sends the file or folder to the Windows recycle bin: a deletion on disk can be undone. */
export async function trashCollectionPath(root: unknown, relative: unknown): Promise<void> {
  const { absolute } = resolveRef(root, relative);
  await shell.trashItem(absolute);
}

export function revealCollectionPath(root: unknown, relative: unknown): void {
  const row = requireCollection(root);
  const absolute = relative === '' || relative === undefined ? row.path : resolveRef(root, relative).absolute;
  shell.showItemInFolder(absolute);
}

export function rescanCollection(root: unknown): void {
  post({ type: 'rescan', root: requireCollection(root).path });
}

/** Starts a search in the files of every collection; results come as `collections:event` messages with this id. */
export function searchCollections(query: unknown): number {
  const requestId = ++searchCounter;

  if (typeof query === 'string' && query.trim()) {
    post({ type: 'search', requestId, query: query.trim() });
  }
  return requestId;
}

export function requestCollectionGraph(root: unknown): void {
  post({ type: 'graph', root: requireCollection(root).path });
}

export function cancelCollectionSearch(requestId: unknown): void {
  if (typeof requestId === 'number') {
    post({ type: 'cancelSearch', requestId });
  }
}

/**
 * Paths given by Windows (file association, second launch) or dropped on the window: folders and markdown files become
 * collections, and the files are returned to be opened (a file inside an opened folder opens from that folder).
 */
export async function openPaths(paths: string[]): Promise<CollectionFileRef[]> {
  const toOpen: CollectionFileRef[] = [];

  for (const candidate of paths) {
    const absolute = canonicalPath(candidate);
    const container = collectionOps.getAll().find(row => row.kind === 'folder' && resolveInside(row.path, path.relative(row.path, absolute)) === absolute);

    if (container && isMarkdownFile(absolute)) {
      toOpen.push({ root: container.path, path: toRelative(container, absolute) });
      continue;
    }

    const row = await addCollection(absolute);

    if (row?.kind === 'file') {
      toOpen.push({ root: row.path, path: path.basename(row.path) });
    }
  }

  return toOpen;
}
