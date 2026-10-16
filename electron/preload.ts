import { contextBridge, ipcRenderer } from 'electron/renderer';

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
  setNotesColor: (ids: number[], color: string | null) => ipcRenderer.invoke('notes:setColor', ids, color),
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
  emptyFolder: (id: number) => ipcRenderer.invoke('folders:empty', id),
  setFoldersColor: (ids: number[], color: string | null) => ipcRenderer.invoke('folders:setColor', ids, color),

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
