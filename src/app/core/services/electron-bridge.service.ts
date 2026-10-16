import { Injectable } from '@angular/core';
import { Folder, FolderDeleteMode } from '../models/folder.model';
import { Note } from '../models/note.model';
import { OverlayBackdrop } from '../models/overlay-backdrop.model';
import { UpdateInfo, UpdateProgress } from '../models/update.model';
import { AppSettings, SettingsPatch, SettingsUpdateResult } from '../models/settings.model';

/** Raw row shape returned by the Electron main process (snake_case from SQLite). */
interface NoteRow {
  id: number;
  title: string;
  content: string;
  tags: string | string[];
  folder_id?: number | null;
  folderId?: number | null;
  sort_order?: number | null;
  created_at?: string;
  createdAt?: string;
  updated_at?: string;
  updatedAt?: string;
}

interface FolderRow {
  id: number;
  name: string;
  parent_id: number | null;
  is_default: number;
  sort_order: number | null;
  created_at: string;
}

interface ElectronAPI {
  minimize: () => Promise<void>;
  maximize: () => Promise<void>;
  close: () => Promise<void>;
  isMaximized: () => Promise<boolean>;
  getAllNotes: () => Promise<NoteRow[]>;
  getNoteById: (id: number) => Promise<NoteRow | null>;
  createNote: (title: string, content: string, tags?: string[], folderId?: number | null) => Promise<NoteRow>;
  moveNote: (id: number, folderId: number | null) => Promise<NoteRow | null>;
  placeNote: (id: number, folderId: number | null, orderedIds: number[]) => Promise<NoteRow | null>;
  placeFolder: (id: number, parentId: number | null, orderedIds: number[]) => Promise<FolderRow | null>;
  getAllFolders: () => Promise<FolderRow[]>;
  createFolder: (name: string, parentId?: number | null) => Promise<FolderRow | null>;
  renameFolder: (id: number, name: string) => Promise<FolderRow | null>;
  moveFolder: (id: number, parentId: number | null) => Promise<FolderRow | null>;
  deleteFolder: (id: number, mode: FolderDeleteMode) => Promise<number[] | null>;
  updateNote: (id: number, data: { title?: string; content?: string; tags?: string }) => Promise<NoteRow | null>;
  deleteNote: (id: number) => Promise<boolean>;
  searchNotes: (query: string) => Promise<NoteRow[]>;
  getNotesByTag: (tag: string) => Promise<NoteRow[]>;
  getAllTags: () => Promise<string[]>;
  openExternal: (url: string) => Promise<void>;
  saveExport: (kind: 'md' | 'html' | 'zip', suggestedName: string, payload: unknown) => Promise<string | null>;
  getSettings: () => Promise<AppSettings>;
  setSettings: (patch: SettingsPatch) => Promise<SettingsUpdateResult>;
  getUpdateInfo: () => Promise<UpdateInfo | null>;
  applyUpdate: () => Promise<void>;
  hideOverlay: () => Promise<void>;
  onOverlayShown: (callback: () => void) => () => void;
  onOverlayBackdrop: (callback: (backdrop: OverlayBackdrop | null) => void) => () => void;
  onNotesChanged: (callback: () => void) => () => void;
  onSettingsChanged: (callback: (settings: AppSettings) => void) => () => void;
  onOpenSettings: (callback: () => void) => () => void;
  onUpdateAvailable: (callback: (info: UpdateInfo) => void) => () => void;
  onUpdateProgress: (callback: (progress: UpdateProgress) => void) => () => void;
  onUpdateDownloaded: (callback: (info: UpdateInfo) => void) => () => void;
  onUpdateDownloadFailed: (callback: (error: string) => void) => () => void;
}

function mapRow(row: NoteRow): Note {
  return {
    id: row.id,
    title: row.title,
    content: row.content,
    tags: typeof row.tags === 'string' ? JSON.parse(row.tags) : (row.tags ?? []),
    folderId: row.folder_id ?? row.folderId ?? null,
    sortOrder: row.sort_order ?? null,
    createdAt: row.created_at ?? row.createdAt ?? '',
    updatedAt: row.updated_at ?? row.updatedAt ?? '',
  };
}

function mapFolderRow(row: FolderRow): Folder {
  return {
    id: row.id,
    name: row.name,
    parentId: row.parent_id,
    createdAt: row.created_at,
    isDefault: row.is_default === 1,
    sortOrder: row.sort_order ?? null,
  };
}

@Injectable({ providedIn: 'root' })
export class ElectronBridgeService {
  private readonly isElectron = !!((window as unknown as Record<string, unknown>)['electronAPI']);
  private readonly api: ElectronAPI | null =
    ((window as unknown as Record<string, unknown>)['electronAPI'] as ElectronAPI | undefined) ?? null;

  get inElectron(): boolean { return this.isElectron; }

  // Window
  minimize(): Promise<void> { return this.api?.minimize() ?? Promise.resolve(); }
  maximize(): Promise<void> { return this.api?.maximize() ?? Promise.resolve(); }
  close(): Promise<void> { return this.api?.close() ?? Promise.resolve(); }
  isMaximized(): Promise<boolean> { return this.api?.isMaximized() ?? Promise.resolve(false); }

  openExternal(url: string): Promise<void> { return this.api?.openExternal(url) ?? Promise.resolve(); }

  /** Asks where to save the export, then writes it: the written path, `null` when cancelled (or outside Electron). */
  saveExport(kind: 'md' | 'html' | 'zip', suggestedName: string, payload: string | { path: string; content: string }[]): Promise<string | null> {
    return this.api?.saveExport(kind, suggestedName, payload) ?? Promise.resolve(null);
  }

  // Notes
  async getAllNotes(): Promise<Note[]> {
    if (!this.api) return [];
    const rows = await this.api.getAllNotes();
    return rows.map(mapRow);
  }

  async getNoteById(id: number): Promise<Note | null> {
    if (!this.api) return null;
    const row = await this.api.getNoteById(id);
    return row ? mapRow(row) : null;
  }

  async createNote(title: string, content: string, tags: string[] = [], folderId: number | null = null): Promise<Note> {
    if (!this.api) throw new Error('Not in Electron');
    const row = await this.api.createNote(title, content, tags, folderId);
    return mapRow(row);
  }

  async moveNote(id: number, folderId: number | null): Promise<Note | null> {
    if (!this.api) return null;
    const row = await this.api.moveNote(id, folderId);
    return row ? mapRow(row) : null;
  }

  async updateNote(id: number, data: { title?: string; content?: string; tags?: string[] }): Promise<Note | null> {
    if (!this.api) return null;
    const payload = {
      ...data,
      tags: data.tags !== undefined ? JSON.stringify(data.tags) : undefined,
    };
    const row = await this.api.updateNote(id, payload);
    return row ? mapRow(row) : null;
  }

  async deleteNote(id: number): Promise<boolean> {
    if (!this.api) return false;
    return this.api.deleteNote(id);
  }

  /** Moves the note to `folderId` at the position described by `orderedIds` (the folder content, in order). */
  async placeNote(id: number, folderId: number | null, orderedIds: number[]): Promise<Note | null> {
    if (!this.api) return null;
    const row = await this.api.placeNote(id, folderId, orderedIds);
    return row ? mapRow(row) : null;
  }

  async searchNotes(query: string): Promise<Note[]> {
    if (!this.api) return [];
    const rows = await this.api.searchNotes(query);
    return rows.map(mapRow);
  }

  async getNotesByTag(tag: string): Promise<Note[]> {
    if (!this.api) return [];
    const rows = await this.api.getNotesByTag(tag);
    return rows.map(mapRow);
  }

  async getAllTags(): Promise<string[]> {
    if (!this.api) return [];
    return this.api.getAllTags();
  }

  // Folders
  async getAllFolders(): Promise<Folder[]> {
    if (!this.api) return [];
    const rows = await this.api.getAllFolders();
    return rows.map(mapFolderRow);
  }

  async createFolder(name: string, parentId: number | null = null): Promise<Folder | null> {
    if (!this.api) return null;
    const row = await this.api.createFolder(name, parentId);
    return row ? mapFolderRow(row) : null;
  }

  async renameFolder(id: number, name: string): Promise<Folder | null> {
    if (!this.api) return null;
    const row = await this.api.renameFolder(id, name);
    return row ? mapFolderRow(row) : null;
  }

  async moveFolder(id: number, parentId: number | null): Promise<Folder | null> {
    if (!this.api) return null;
    const row = await this.api.moveFolder(id, parentId);
    return row ? mapFolderRow(row) : null;
  }

  /** Moves the folder under `parentId` at the position described by `orderedIds` (the children, in order). */
  async placeFolder(id: number, parentId: number | null, orderedIds: number[]): Promise<Folder | null> {
    if (!this.api) return null;
    const row = await this.api.placeFolder(id, parentId, orderedIds);
    return row ? mapFolderRow(row) : null;
  }

  /** Ids of the notes deleted with the folder (`null` when the deletion was refused). */
  async deleteFolder(id: number, mode: FolderDeleteMode): Promise<number[] | null> {
    if (!this.api) return null;
    return this.api.deleteFolder(id, mode);
  }

  // Settings
  async getSettings(): Promise<AppSettings | null> {
    return this.api ? this.api.getSettings() : null;
  }

  async setSettings(patch: SettingsPatch): Promise<SettingsUpdateResult | null> {
    return this.api ? this.api.setSettings(patch) : null;
  }

  // Updates
  async getUpdateInfo(): Promise<UpdateInfo | null> {
    return this.api ? this.api.getUpdateInfo() : null;
  }

  async applyUpdate(): Promise<void> {
    await this.api?.applyUpdate();
  }

  // Overlay
  hideOverlay(): Promise<void> { return this.api?.hideOverlay() ?? Promise.resolve(); }

  /** Event subscriptions return an unsubscribe function (no-op outside Electron). */
  onOverlayShown(callback: () => void): () => void {
    return this.api?.onOverlayShown(callback) ?? (() => undefined);
  }

  onOverlayBackdrop(callback: (backdrop: OverlayBackdrop | null) => void): () => void {
    return this.api?.onOverlayBackdrop(callback) ?? (() => undefined);
  }

  onNotesChanged(callback: () => void): () => void {
    return this.api?.onNotesChanged(callback) ?? (() => undefined);
  }

  onSettingsChanged(callback: (settings: AppSettings) => void): () => void {
    return this.api?.onSettingsChanged(callback) ?? (() => undefined);
  }

  onOpenSettings(callback: () => void): () => void {
    return this.api?.onOpenSettings(callback) ?? (() => undefined);
  }

  onUpdateAvailable(callback: (info: UpdateInfo) => void): () => void {
    return this.api?.onUpdateAvailable(callback) ?? (() => undefined);
  }

  onUpdateProgress(callback: (progress: UpdateProgress) => void): () => void {
    return this.api?.onUpdateProgress(callback) ?? (() => undefined);
  }

  onUpdateDownloaded(callback: (info: UpdateInfo) => void): () => void {
    return this.api?.onUpdateDownloaded(callback) ?? (() => undefined);
  }

  onUpdateDownloadFailed(callback: (error: string) => void): () => void {
    return this.api?.onUpdateDownloadFailed(callback) ?? (() => undefined);
  }
}
