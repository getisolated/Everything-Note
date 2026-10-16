/**
 * Collections worker: runs in an Electron utilityProcess so that scanning, watching and searching folders on disk
 * never blocks the main process nor the window. Talks with the main process through `process.parentPort`.
 */
import { FSWatcher, promises as fs, realpathSync, watch } from 'fs';
import * as path from 'path';
import { CollectionNode, DEFAULT_COLLECTION_EXCLUDES, buildCollectionGraph, findInText, isMarkdownFile, scanFolder } from './collections-scan';
import { CollectionKind, WorkerRequest, WorkerResponse } from './collections-protocol';

interface Watched {
  root: string;
  kind: CollectionKind;
  files: string[];
  treeSignature: string;
  watcher: FSWatcher | null;
  timer: ReturnType<typeof setTimeout> | null;
  changed: Set<string>;
}

/** Bursts of file events (a git checkout, a save) are handled once. */
const RESCAN_DELAY_MS = 250;
const MAX_MATCHES_PER_FILE = 5;
const MAX_SEARCH_RESULTS = 300;
/** Beyond this many files, a graph would be unreadable (and long to build): only the first ones are drawn. */
const MAX_GRAPH_FILES = 2000;

const port = process.parentPort;
const watched = new Map<string, Watched>();
let excludes: readonly string[] = DEFAULT_COLLECTION_EXCLUDES;
/** Id of the search in progress: a newer search makes the older one stop. */
let currentSearch = 0;

function send(message: WorkerResponse): void {
  port.postMessage(message);
}

async function scan(entry: Watched): Promise<void> {
  try {
    let tree: CollectionNode[];
    let files: string[];
    let truncated = false;

    if (entry.kind === 'file') {
      await fs.access(entry.root);
      const name = path.basename(entry.root);
      tree = [{ name, path: name, kind: 'file' }];
      files = [name];
    } else {
      ({ tree, files, truncated } = await scanFolder(entry.root, excludes));
    }

    entry.files = files;
    const signature = JSON.stringify(tree);

    if (signature !== entry.treeSignature) {
      entry.treeSignature = signature;
      send({ type: 'tree', root: entry.root, tree, truncated });
    }
  } catch (error) {
    entry.treeSignature = '';
    send({ type: 'error', root: entry.root, message: error instanceof Error ? error.message : String(error) });
  }
}

function scheduleRescan(entry: Watched, filename: string | null): void {
  if (filename) {
    const relative = entry.kind === 'file' ? path.basename(entry.root) : filename.split(path.sep).join('/');

    if (isMarkdownFile(relative)) {
      entry.changed.add(relative);
    }
  }

  if (entry.timer) {
    clearTimeout(entry.timer);
  }

  entry.timer = setTimeout(() => {
    entry.timer = null;
    const paths = [...entry.changed];
    entry.changed.clear();
    void scan(entry).then(() => {
      if (paths.length > 0) {
        send({ type: 'changed', root: entry.root, paths });
      }
    });
  }, RESCAN_DELAY_MS);
}

function startWatching(root: string, kind: CollectionKind): void {
  stopWatching(root);
  const entry: Watched = { root, kind, files: [], treeSignature: '', watcher: null, timer: null, changed: new Set() };
  watched.set(root, entry);

  try {
    // Recursive watching is native on Windows (ReadDirectoryChangesW): one handle per collection
    // Long path form: libuv aborts the whole process on a short 8.3 name (C:\Users\JOHNDO~1)
    entry.watcher = watch(realpathSync.native(root), { recursive: kind === 'folder' }, (_event, filename) => scheduleRescan(entry, filename ? String(filename) : null));
    entry.watcher.on('error', () => scheduleRescan(entry, null));
  } catch {
    // Missing path: the scan reports the error, the collection shows it
  }

  void scan(entry);
}

function stopWatching(root: string): void {
  const entry = watched.get(root);

  if (entry) {
    entry.watcher?.close();
    if (entry.timer) {
      clearTimeout(entry.timer);
    }
    watched.delete(root);
  }
}

/** Reads the markdown files of every collection, the matching lines arriving in batches (one per file). */
async function search(requestId: number, query: string): Promise<void> {
  currentSearch = requestId;
  let total = 0;

  for (const entry of watched.values()) {
    for (const file of entry.files) {
      if (currentSearch !== requestId || total >= MAX_SEARCH_RESULTS) {
        break;
      }

      const absolute = entry.kind === 'file' ? entry.root : path.join(entry.root, file);
      let content: string;

      try {
        content = await fs.readFile(absolute, 'utf-8');
      } catch {
        continue;
      }

      const nameMatches = file.toLowerCase().includes(query.toLowerCase());
      const matches = findInText(content, query, MAX_MATCHES_PER_FILE);

      if (matches.length > 0 || nameMatches) {
        total += Math.max(1, matches.length);
        send({ type: 'searchResults', requestId, root: entry.root, path: file, matches, done: false });
      }
    }
  }

  if (currentSearch === requestId) {
    send({ type: 'searchResults', requestId, root: '', path: '', matches: [], done: true });
  }
}

/** Reads the files of the collection to find their links to each other. */
async function sendGraph(root: string): Promise<void> {
  const entry = watched.get(root);

  if (!entry) {
    return;
  }

  const files: { path: string; content: string }[] = [];

  for (const file of entry.files.slice(0, MAX_GRAPH_FILES)) {
    const absolute = entry.kind === 'file' ? entry.root : path.join(entry.root, file);
    const content = await fs.readFile(absolute, 'utf-8').catch(() => '');
    files.push({ path: file, content });
  }

  send({ type: 'graph', root, graph: buildCollectionGraph(files) });
}

port.on('message', ({ data }: { data: WorkerRequest }) => {
  switch (data.type) {
    case 'watch':
      startWatching(data.root, data.kind);
      break;
    case 'unwatch':
      stopWatching(data.root);
      break;
    case 'setExcludes':
      excludes = data.excludes;
      watched.forEach(entry => { entry.treeSignature = ''; void scan(entry); });
      break;
    case 'rescan': {
      const entry = watched.get(data.root);
      if (entry) {
        void scan(entry);
      }
      break;
    }
    case 'search':
      void search(data.requestId, data.query);
      break;
    case 'graph':
      void sendGraph(data.root);
      break;
    case 'cancelSearch':
      if (currentSearch === data.requestId) {
        currentSearch = 0;
      }
      break;
  }
});
