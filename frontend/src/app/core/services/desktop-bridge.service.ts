import { Injectable } from '@angular/core';
import { getCurrentWindow } from '@tauri-apps/api/window';
import type { FolderDto } from '../bindings/FolderDto';
import type { McpStatusDto } from '../bindings/McpStatusDto';
import type { NoteDto } from '../bindings/NoteDto';
import { Folder, FolderDeleteMode } from '../models/folder.model';
import { Note } from '../models/note.model';
import { UpdateInfo, UpdateProgress } from '../models/update.model';
import { AppSettings, SettingsPatch, SettingsUpdateResult } from '../models/settings.model';
import { call, inDesktop, subscribe } from './desktop-api';

function mapRow(row: NoteDto): Note {
  return {
    id: row.id,
    title: row.title,
    content: row.content,
    tags: JSON.parse(row.tags) as string[],
    folderId: row.folder_id,
    sortOrder: row.sort_order,
    color: row.color,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapFolderRow(row: FolderDto): Folder {
  return {
    id: row.id,
    name: row.name,
    parentId: row.parent_id,
    createdAt: row.created_at,
    isDefault: row.is_default === 1,
    sortOrder: row.sort_order,
    color: row.color,
  };
}

/** Access to the main process (Rust, Tauri commands). Outside the desktop app everything is empty. */
@Injectable({ providedIn: 'root' })
export class DesktopBridgeService {
  private readonly available = inDesktop();

  get inDesktop(): boolean { return this.available; }

  // Window (frameless: the tab bar draws the controls)
  minimize(): Promise<void> { return this.available ? getCurrentWindow().minimize() : Promise.resolve(); }
  maximize(): Promise<void> { return this.available ? getCurrentWindow().toggleMaximize() : Promise.resolve(); }
  close(): Promise<void> { return this.available ? getCurrentWindow().close() : Promise.resolve(); }
  isMaximized(): Promise<boolean> { return this.available ? getCurrentWindow().isMaximized() : Promise.resolve(false); }

  openExternal(url: string): Promise<void> {
    return this.available ? call('shell_open_external', { url }) : Promise.resolve();
  }

  /**
   * Asks where to save the export, then writes it: the written path, `null` when cancelled (or outside the app). `pdf` and
   * `pdf-zip` take standalone HTML pages, printed to PDF by the main process.
   */
  saveExport(kind: 'md' | 'html' | 'pdf' | 'zip' | 'pdf-zip', suggestedName: string, payload: string | { path: string; content: string }[]): Promise<string | null> {
    return this.available ? call('export_save', { kind, suggestedName, payload }) : Promise.resolve(null);
  }

  // Notes
  async getAllNotes(): Promise<Note[]> {
    if (!this.available) return [];
    return (await call<NoteDto[]>('notes_get_all')).map(mapRow);
  }

  async getNoteById(id: number): Promise<Note | null> {
    if (!this.available) return null;
    const row = await call<NoteDto | null>('notes_get_by_id', { id });
    return row ? mapRow(row) : null;
  }

  async createNote(title: string, content: string, tags: string[] = [], folderId: number | null = null): Promise<Note> {
    if (!this.available) throw new Error('Not in the desktop app');
    return mapRow(await call<NoteDto>('notes_create', { title, content, tags, folderId }));
  }

  async moveNote(id: number, folderId: number | null): Promise<Note | null> {
    if (!this.available) return null;
    const row = await call<NoteDto | null>('notes_move', { id, folderId });
    return row ? mapRow(row) : null;
  }

  async updateNote(id: number, data: { title?: string; content?: string; tags?: string[] }): Promise<Note | null> {
    if (!this.available) return null;
    const changes = { ...data, tags: data.tags !== undefined ? JSON.stringify(data.tags) : undefined };
    const row = await call<NoteDto | null>('notes_update', { id, data: changes });
    return row ? mapRow(row) : null;
  }

  async deleteNote(id: number): Promise<boolean> {
    if (!this.available) return false;
    return call<boolean>('notes_delete', { id });
  }

  /** Moves the note to `folderId` at the position described by `orderedIds` (the folder content, in order). */
  async placeNote(id: number, folderId: number | null, orderedIds: number[]): Promise<Note | null> {
    if (!this.available) return null;
    const row = await call<NoteDto | null>('notes_place', { id, folderId, orderedIds });
    return row ? mapRow(row) : null;
  }

  async searchNotes(query: string): Promise<Note[]> {
    if (!this.available) return [];
    return (await call<NoteDto[]>('notes_search', { query })).map(mapRow);
  }

  async getNotesByTag(tag: string): Promise<Note[]> {
    if (!this.available) return [];
    return (await call<NoteDto[]>('notes_by_tag', { tag })).map(mapRow);
  }

  async getAllTags(): Promise<string[]> {
    if (!this.available) return [];
    return call<string[]>('notes_all_tags');
  }

  // Folders
  async getAllFolders(): Promise<Folder[]> {
    if (!this.available) return [];
    return (await call<FolderDto[]>('folders_get_all')).map(mapFolderRow);
  }

  async createFolder(name: string, parentId: number | null = null): Promise<Folder | null> {
    if (!this.available) return null;
    const row = await call<FolderDto | null>('folders_create', { name, parentId });
    return row ? mapFolderRow(row) : null;
  }

  async renameFolder(id: number, name: string): Promise<Folder | null> {
    if (!this.available) return null;
    const row = await call<FolderDto | null>('folders_rename', { id, name });
    return row ? mapFolderRow(row) : null;
  }

  async moveFolder(id: number, parentId: number | null): Promise<Folder | null> {
    if (!this.available) return null;
    const row = await call<FolderDto | null>('folders_move', { id, parentId });
    return row ? mapFolderRow(row) : null;
  }

  /** Moves the folder under `parentId` at the position described by `orderedIds` (the children, in order). */
  async placeFolder(id: number, parentId: number | null, orderedIds: number[]): Promise<Folder | null> {
    if (!this.available) return null;
    const row = await call<FolderDto | null>('folders_place', { id, parentId, orderedIds });
    return row ? mapFolderRow(row) : null;
  }

  /** Ids of the notes deleted with the folder (`null` when the deletion was refused). */
  async deleteFolder(id: number, mode: FolderDeleteMode): Promise<number[] | null> {
    if (!this.available) return null;
    return call<number[] | null>('folders_delete', { id, mode });
  }

  /** Deletes the content of the folder, keeping it. Returns the ids of the deleted notes, `null` when refused. */
  async emptyFolder(id: number): Promise<number[] | null> {
    if (!this.available) return null;
    return call<number[] | null>('folders_empty', { id });
  }

  async setFoldersColor(ids: number[], color: string | null): Promise<boolean> {
    if (!this.available) return false;
    return call<boolean>('folders_set_color', { ids, color });
  }

  async setNotesColor(ids: number[], color: string | null): Promise<boolean> {
    if (!this.available) return false;
    return call<boolean>('notes_set_color', { ids, color });
  }

  // Settings
  async getSettings(): Promise<AppSettings | null> {
    return this.available ? call<AppSettings>('settings_get') : null;
  }

  async setSettings(patch: SettingsPatch): Promise<SettingsUpdateResult | null> {
    return this.available ? call<SettingsUpdateResult>('settings_set', { patch }) : null;
  }

  // MCP server
  async getMcpStatus(): Promise<McpStatusDto | null> {
    return this.available ? call<McpStatusDto>('mcp_status') : null;
  }

  /** Replaces the MCP token (clients configured with the old one are refused); returns the settings in effect. */
  async regenerateMcpToken(): Promise<AppSettings | null> {
    return this.available ? call<AppSettings>('mcp_regenerate_token') : null;
  }

  // Updates
  async getUpdateInfo(): Promise<UpdateInfo | null> {
    return this.available ? call<UpdateInfo | null>('update_get_info') : null;
  }

  async applyUpdate(): Promise<void> {
    if (this.available) {
      await call('update_apply');
    }
  }

  // Overlay
  hideOverlay(): Promise<void> { return this.available ? call('overlay_hide') : Promise.resolve(); }

  /** Event subscriptions return an unsubscribe function (no-op outside the desktop app). */
  onOverlayShown(callback: () => void): () => void {
    return subscribe('overlay:shown', callback);
  }

  onNotesChanged(callback: () => void): () => void {
    return subscribe('notes:changed', callback);
  }

  onSettingsChanged(callback: (settings: AppSettings) => void): () => void {
    return subscribe('settings:changed', callback);
  }

  onMcpStatus(callback: (status: McpStatusDto) => void): () => void {
    return subscribe('mcp:status', callback);
  }

  onOpenSettings(callback: () => void): () => void {
    return subscribe('settings:open', callback);
  }

  onUpdateAvailable(callback: (info: UpdateInfo) => void): () => void {
    return subscribe('update:available', callback);
  }

  onUpdateProgress(callback: (progress: UpdateProgress) => void): () => void {
    return subscribe('update:progress', callback);
  }

  onUpdateDownloaded(callback: (info: UpdateInfo) => void): () => void {
    return subscribe('update:downloaded', callback);
  }

  onUpdateDownloadFailed(callback: (error: string) => void): () => void {
    return subscribe('update:download-failed', callback);
  }
}
