import { app, BrowserWindow, ipcMain, nativeTheme } from 'electron/main';
import { shell } from 'electron/common';
import * as path from 'path';
import { initDatabase, closeDatabase, noteOps, folderOps, FolderDeleteMode } from './database';
import { registerGlobalShortcut, unregisterGlobalShortcuts } from './global-shortcut';
import { applyOverlaySize, broadcastToWindows, hideOverlay, prepareOverlay, showOverlay, toggleOverlay } from './overlay';
import { loadRenderer } from './renderer-loader';
import { getSettings, loadSettings, updateSettings } from './settings';
import { sanitizeSettings, SettingsPatch } from './settings-schema';
import { applyLaunchAtStartup, launchedHidden } from './startup';
import { createTray, destroyTray } from './tray';
import { applyUpdate, getUpdateInfo, onAutoUpdateChanged, startUpdater, stopUpdater } from './updater';
import {
  CollectionFileRef, addCollection, cancelCollectionSearch, createCollectionFile, initCollections, listCollections,
  moveCollectionPath, openPaths, pickCollections, readCollectionFile, relocateCollection, removeCollection,
  renameCollection, renameCollectionPath, rescanCollection, revealCollectionPath, searchCollections,
  setCollectionExcludes, stopCollections, trashCollectionPath, writeCollectionFile,
} from './collections';
import { promises as fs } from 'fs';

const isDev = process.env['NODE_ENV'] === 'development';
let mainWindow: BrowserWindow | null = null;
// Closing the window only hides it to the tray; a real quit comes from the tray menu (or the OS)
let isQuitting = false;

/** Window color shown before the renderer paints: matches the theme so a light theme does not flash dark. */
function windowBackgroundColor(): string {
  const { theme } = getSettings();
  const isDark = theme === 'system' ? nativeTheme.shouldUseDarkColors : theme === 'dark';
  return isDark ? '#1e1e1e' : '#ffffff';
}

function createWindow(showOnReady = true): void {
  mainWindow = new BrowserWindow({
    show: false,
    width: 1280,
    height: 800,
    minWidth: 600,
    minHeight: 400,
    frame: false,
    backgroundColor: windowBackgroundColor(),
    titleBarStyle: 'hidden',
    icon: path.join(__dirname, '../assets/logo.ico'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  loadRenderer(mainWindow);
  if (isDev) {
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  }

  if (showOnReady) {
    mainWindow.once('ready-to-show', () => mainWindow?.show());
  }

  // Markdown files given at launch (double-click in the Explorer) open once the app is loaded
  mainWindow.webContents.once('did-finish-load', () => { void openFromArguments(process.argv); });

  mainWindow.on('close', (event) => {
    if (!isQuitting) {
      event.preventDefault();
      mainWindow?.hide();
    }
  });
  // Windows logoff/shutdown: let the window really close instead of blocking the session end
  mainWindow.on('session-end', () => { isQuitting = true; });
  mainWindow.on('closed', () => { mainWindow = null; });
}

function showMainWindow(): void {
  if (!mainWindow) {
    createWindow();
    return;
  }
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
}

function openSettings(): void {
  showMainWindow();
  mainWindow?.webContents.send('settings:open');
}

function quitApp(): void {
  isQuitting = true;
  app.quit();
}

function onGlobalShortcut(): void {
  if (getSettings().shortcutMode === 'overlay') {
    toggleOverlay();
  } else {
    hideOverlay();
    showMainWindow();
  }
}

/** Markdown files passed on the command line (file association): opened as collections, in editor tabs. */
async function openFromArguments(argv: string[]): Promise<void> {
  const candidates = argv.slice(1).filter(arg => /\.md$/i.test(arg));
  const existing = await Promise.all(candidates.map(arg => fs.stat(arg).then(stats => (stats.isFile() ? arg : null), () => null)));
  const files = existing.filter((arg): arg is string => arg !== null);

  if (files.length > 0) {
    sendOpenFiles(await openPaths(files));
  }
}

function sendOpenFiles(refs: CollectionFileRef[]): void {
  if (refs.length > 0) {
    mainWindow?.webContents.send('collections:open', refs);
  }
}

// A second launch (start menu, login item, a .md double-clicked...) just brings the running instance forward
const isPrimaryInstance = app.requestSingleInstanceLock();
if (!isPrimaryInstance) {
  app.quit();
} else {
  app.on('second-instance', (_event, argv) => {
    showMainWindow();
    void openFromArguments(argv);
  });
}

app.whenReady().then(() => {
  // app.quit() is asynchronous: the duplicate instance must not create its windows/tray meanwhile
  if (!isPrimaryInstance) return;
  initDatabase();
  const settings = loadSettings();
  createWindow(!launchedHidden());
  void prepareOverlay();
  createTray({ openApp: showMainWindow, quickNote: showOverlay, openSettings, quit: quitApp });
  applyLaunchAtStartup(settings.launchAtStartup);
  if (!registerGlobalShortcut(settings.globalShortcut, onGlobalShortcut)) {
    console.error(`[Shortcut] Unable to register ${settings.globalShortcut}`);
  }
  startUpdater();
  // In the background, once the window exists: the core notes never wait for the disk scans
  initCollections(() => mainWindow, settings.collectionsExclude);
  app.on('activate', () => {
    if (!mainWindow) createWindow();
  });
});

// Never quit on window close: the app lives in the tray
app.on('window-all-closed', () => { /* keep running */ });

app.on('before-quit', () => {
  isQuitting = true;
  closeDatabase();
});

app.on('will-quit', () => {
  stopUpdater();
  stopCollections();
  unregisterGlobalShortcuts();
  destroyTray();
});

// Wraps an IPC handler with try-catch to prevent unhandled exceptions
function safeHandle(channel: string, handler: (...args: any[]) => any): void {
  ipcMain.handle(channel, async (...args) => {
    try {
      return await handler(...args);
    } catch (err) {
      console.error(`[IPC] Error in ${channel}:`, err);
      throw err;
    }
  });
}

// ── Window controls ──────────────────────────────────────────────────────────
safeHandle('window:minimize', () => mainWindow?.minimize());
safeHandle('window:maximize', () => {
  if (mainWindow?.isMaximized()) mainWindow.unmaximize();
  else mainWindow?.maximize();
});
safeHandle('window:close', () => mainWindow?.close());
safeHandle('window:isMaximized', () => mainWindow?.isMaximized() ?? false);

// ── Notes CRUD ───────────────────────────────────────────────────────────────
safeHandle('notes:getAll', () => noteOps.getAll());
safeHandle('notes:getById', (_e, id: number) => noteOps.getById(id) ?? null);
safeHandle('notes:create', (e, title: string, content: string, tags?: string[], folderId?: number | null) => {
  const note = noteOps.create(
    title,
    content,
    Array.isArray(tags) ? tags.filter(t => typeof t === 'string') : [],
    typeof folderId === 'number' ? folderId : null,
  );
  // Lets the other window (overlay <-> main app) refresh its list
  broadcastToWindows('notes:changed', undefined, e.sender);
  return note;
});
safeHandle('notes:update', (_e, id: number, data: { title?: string; content?: string; tags?: string }) =>
  noteOps.update(id, data) ?? null
);
safeHandle('notes:move', (_e, id: number, folderId: number | null) =>
  noteOps.moveToFolder(id, typeof folderId === 'number' ? folderId : null) ?? null
);
safeHandle('notes:place', (_e, id: number, folderId: number | null, orderedIds: number[]) =>
  noteOps.place(id, typeof folderId === 'number' ? folderId : null, parseIds(orderedIds)) ?? null
);
safeHandle('notes:delete', (_e, id: number) => { noteOps.delete(id); return true; });
safeHandle('notes:search', (_e, query: string) => noteOps.search(query));
safeHandle('notes:byTag', (_e, tag: string) => noteOps.getByTag(tag));
safeHandle('notes:allTags', () => noteOps.getAllTags());

// ── Folders ──────────────────────────────────────────────────────────────────
function parseParentId(value: unknown): number | null {
  return typeof value === 'number' ? value : null;
}

function parseIds(value: unknown): number[] {
  return Array.isArray(value) ? value.filter((id): id is number => typeof id === 'number') : [];
}

safeHandle('folders:getAll', () => folderOps.getAll());
safeHandle('folders:create', (_e, name: string, parentId?: number | null) =>
  folderOps.create(name, parseParentId(parentId)) ?? null
);
safeHandle('folders:rename', (_e, id: number, name: string) => folderOps.rename(id, name) ?? null);
safeHandle('folders:move', (_e, id: number, parentId: number | null) =>
  folderOps.move(id, parseParentId(parentId)) ?? null
);
safeHandle('folders:place', (_e, id: number, parentId: number | null, orderedIds: number[]) =>
  folderOps.place(id, parseParentId(parentId), parseIds(orderedIds)) ?? null
);
safeHandle('folders:delete', (e, id: number, mode: FolderDeleteMode) => {
  // Anything but an explicit "deleteAll" keeps the notes: the safe choice if the payload is malformed
  const deletedNoteIds = folderOps.delete(id, mode === 'deleteAll' ? 'deleteAll' : 'moveToRoot');
  broadcastToWindows('notes:changed', undefined, e.sender);
  return deletedNoteIds;
});

// ── Collections (folders / markdown files of the disk) ──────────────────────
safeHandle('collections:list', () => listCollections());
safeHandle('collections:pick', (e, kind: unknown) =>
  pickCollections(BrowserWindow.fromWebContents(e.sender), kind === 'file' ? 'file' : 'folder')
);
safeHandle('collections:openPaths', async (_e, paths: unknown) => {
  const valid = Array.isArray(paths) ? paths.filter((p): p is string => typeof p === 'string') : [];
  return openPaths(valid);
});
safeHandle('collections:add', (_e, candidate: unknown) => (typeof candidate === 'string' ? addCollection(candidate) : null));
safeHandle('collections:remove', (_e, root: unknown) => { removeCollection(root); return true; });
safeHandle('collections:rename', (_e, root: unknown, name: unknown) => renameCollection(root, name) ?? null);
safeHandle('collections:relocate', (e, root: unknown) => relocateCollection(BrowserWindow.fromWebContents(e.sender), root));
safeHandle('collections:rescan', (_e, root: unknown) => { rescanCollection(root); return true; });
safeHandle('collections:read', (_e, root: unknown, relative: unknown) => readCollectionFile(root, relative));
safeHandle('collections:write', async (_e, root: unknown, relative: unknown, content: unknown) => {
  await writeCollectionFile(root, relative, content);
  return true;
});
safeHandle('collections:createFile', (_e, root: unknown, folder: unknown, name: unknown) => createCollectionFile(root, folder, name));
safeHandle('collections:renamePath', (_e, root: unknown, relative: unknown, name: unknown) => renameCollectionPath(root, relative, name));
safeHandle('collections:movePath', (_e, root: unknown, relative: unknown, folder: unknown) => moveCollectionPath(root, relative, folder));
safeHandle('collections:trash', async (_e, root: unknown, relative: unknown) => {
  await trashCollectionPath(root, relative);
  return true;
});
safeHandle('collections:reveal', (_e, root: unknown, relative: unknown) => { revealCollectionPath(root, relative); return true; });
safeHandle('collections:search', (_e, query: unknown) => searchCollections(query));
safeHandle('collections:cancelSearch', (_e, requestId: unknown) => { cancelCollectionSearch(requestId); return true; });

// ── Settings & overlay ───────────────────────────────────────────────────────
safeHandle('settings:get', () => getSettings());
safeHandle('settings:set', (e, patch: SettingsPatch) => {
  const before = getSettings();
  // The position is owned by the main process: never take it from the renderer
  const candidate = sanitizeSettings({ ...before, ...patch, overlayPosition: before.overlayPosition }, before);

  if (candidate.globalShortcut !== before.globalShortcut &&
      !registerGlobalShortcut(candidate.globalShortcut, onGlobalShortcut)) {
    return { ok: false, error: 'shortcut-unavailable', settings: before };
  }

  const next = updateSettings(candidate);
  applyOverlaySize(before, next);
  if (next.launchAtStartup !== before.launchAtStartup) {
    applyLaunchAtStartup(next.launchAtStartup);
  }
  if (next.autoUpdate !== before.autoUpdate) {
    onAutoUpdateChanged();
  }
  if (next.collectionsExclude.join('\n') !== before.collectionsExclude.join('\n')) {
    setCollectionExcludes(next.collectionsExclude);
  }
  broadcastToWindows('settings:changed', getSettings(), e.sender);
  return { ok: true, settings: getSettings() };
});
safeHandle('overlay:hide', () => hideOverlay());

// ── Updates ──────────────────────────────────────────────────────────────────
safeHandle('update:getInfo', () => getUpdateInfo());
safeHandle('update:apply', () => applyUpdate());

// ── Shell ─────────────────────────────────────────────────────────────────────
safeHandle('shell:openExternal', (_e, url: string) => {
  if (typeof url !== 'string' || !(url.startsWith('http://') || url.startsWith('https://'))) {
    throw new Error('Only http:// and https:// URLs are allowed');
  }
  return shell.openExternal(url);
});
