import { contextBridge, ipcRenderer, webUtils } from 'electron/renderer';

function subscribe(channel: string, callback: (payload?: any) => void): () => void {
  const listener = (_event: unknown, payload?: unknown): void => callback(payload);
  ipcRenderer.on(channel, listener);
  return () => { ipcRenderer.removeListener(channel, listener); };
}

const api = {
  // Window controls
  minimize: () => ipcRenderer.invoke('window:minimize'),
  maximize: () => ipcRenderer.invoke('window:maximize'),
  close: () => ipcRenderer.invoke('window:close'),
  isMaximized: () => ipcRenderer.invoke('window:isMaximized'),

  // Notes
  getAllNotes: () => ipcRenderer.invoke('notes:getAll'),
  getNoteById: (id: number) => ipcRenderer.invoke('notes:getById', id),
  createNote: (title: string, content: string, tags?: string[], folderId?: number | null) =>
    ipcRenderer.invoke('notes:create', title, content, tags, folderId),
  updateNote: (id: number, data: { title?: string; content?: string; tags?: string }) =>
    ipcRenderer.invoke('notes:update', id, data),
  moveNote: (id: number, folderId: number | null) => ipcRenderer.invoke('notes:move', id, folderId),
  placeNote: (id: number, folderId: number | null, orderedIds: number[]) =>
    ipcRenderer.invoke('notes:place', id, folderId, orderedIds),
  deleteNote: (id: number) => ipcRenderer.invoke('notes:delete', id),
  searchNotes: (query: string) => ipcRenderer.invoke('notes:search', query),
  getNotesByTag: (tag: string) => ipcRenderer.invoke('notes:byTag', tag),
  getAllTags: () => ipcRenderer.invoke('notes:allTags'),

  // Folders
  getAllFolders: () => ipcRenderer.invoke('folders:getAll'),
  createFolder: (name: string, parentId?: number | null) => ipcRenderer.invoke('folders:create', name, parentId),
  renameFolder: (id: number, name: string) => ipcRenderer.invoke('folders:rename', id, name),
  moveFolder: (id: number, parentId: number | null) => ipcRenderer.invoke('folders:move', id, parentId),
  placeFolder: (id: number, parentId: number | null, orderedIds: number[]) =>
    ipcRenderer.invoke('folders:place', id, parentId, orderedIds),
  deleteFolder: (id: number, mode: 'moveToRoot' | 'deleteAll') => ipcRenderer.invoke('folders:delete', id, mode),

  // Collections (folders / markdown files of the disk)
  listCollections: () => ipcRenderer.invoke('collections:list'),
  pickCollections: (kind: 'folder' | 'file') => ipcRenderer.invoke('collections:pick', kind),
  openCollectionPaths: (paths: string[]) => ipcRenderer.invoke('collections:openPaths', paths),
  removeCollection: (root: string) => ipcRenderer.invoke('collections:remove', root),
  renameCollection: (root: string, name: string) => ipcRenderer.invoke('collections:rename', root, name),
  relocateCollection: (root: string) => ipcRenderer.invoke('collections:relocate', root),
  rescanCollection: (root: string) => ipcRenderer.invoke('collections:rescan', root),
  readCollectionFile: (root: string, path: string) => ipcRenderer.invoke('collections:read', root, path),
  writeCollectionFile: (root: string, path: string, content: string) => ipcRenderer.invoke('collections:write', root, path, content),
  createCollectionFile: (root: string, folder: string, name: string) => ipcRenderer.invoke('collections:createFile', root, folder, name),
  renameCollectionPath: (root: string, path: string, name: string) => ipcRenderer.invoke('collections:renamePath', root, path, name),
  moveCollectionPath: (root: string, path: string, folder: string) => ipcRenderer.invoke('collections:movePath', root, path, folder),
  trashCollectionPath: (root: string, path: string) => ipcRenderer.invoke('collections:trash', root, path),
  revealCollectionPath: (root: string, path: string) => ipcRenderer.invoke('collections:reveal', root, path),
  searchCollections: (query: string) => ipcRenderer.invoke('collections:search', query),
  cancelCollectionSearch: (requestId: number) => ipcRenderer.invoke('collections:cancelSearch', requestId),
  requestCollectionGraph: (root: string) => ipcRenderer.invoke('collections:graph', root),
  /** Disk path of a file dropped on the window (File.path no longer exists in Electron). */
  getPathForFile: (file: File) => webUtils.getPathForFile(file),
  onCollectionsEvent: (callback: (event: unknown) => void) => subscribe('collections:event', callback),
  onCollectionsOpen: (callback: (refs: unknown) => void) => subscribe('collections:open', callback),

  // Settings
  getSettings: () => ipcRenderer.invoke('settings:get'),
  setSettings: (patch: Record<string, unknown>) => ipcRenderer.invoke('settings:set', patch),

  // Updates
  getUpdateInfo: () => ipcRenderer.invoke('update:getInfo'),
  applyUpdate: () => ipcRenderer.invoke('update:apply'),

  // Overlay
  hideOverlay: () => ipcRenderer.invoke('overlay:hide'),

  // Events pushed by the main process; each returns an unsubscribe function
  onOverlayShown: (callback: () => void) => subscribe('overlay:shown', callback),
  onOverlayBackdrop: (callback: (backdrop: unknown) => void) => subscribe('overlay:backdrop', callback),
  onNotesChanged: (callback: () => void) => subscribe('notes:changed', callback),
  onSettingsChanged: (callback: (settings: unknown) => void) => subscribe('settings:changed', callback),
  onUpdateAvailable: (callback: (info: unknown) => void) => subscribe('update:available', callback),
  onUpdateProgress: (callback: (progress: unknown) => void) => subscribe('update:progress', callback),
  onUpdateDownloaded: (callback: (info: unknown) => void) => subscribe('update:downloaded', callback),
  onUpdateDownloadFailed: (callback: (error: unknown) => void) => subscribe('update:download-failed', callback),
  onOpenSettings: (callback: () => void) => subscribe('settings:open', callback),

  // Shell
  openExternal: (url: string) => ipcRenderer.invoke('shell:openExternal', url),
};

contextBridge.exposeInMainWorld('electronAPI', api);
