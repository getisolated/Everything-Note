import { Injectable, computed, inject, signal } from '@angular/core';
import { Folder, FolderDeleteMode } from '../models/folder.model';
import { ElectronBridgeService } from './electron-bridge.service';

@Injectable({ providedIn: 'root' })
export class FoldersService {
  private bridge = inject(ElectronBridgeService);
  private readonly _folders = signal<Folder[]>([]);

  readonly folders = this._folders.asReadonly();

  /** Receives the notes created on the fly; it always exists once the folders are loaded. */
  readonly defaultFolder = computed<Folder | null>(() => this._folders().find(f => f.isDefault) ?? null);

  async loadAll(): Promise<void> {
    this._folders.set(await this.bridge.getAllFolders());
  }

  getById(id: number): Folder | null {
    return this._folders().find(f => f.id === id) ?? null;
  }

  async create(name: string, parentId: number | null): Promise<Folder | null> {
    const folder = await this.bridge.createFolder(name, parentId);

    if (folder) {
      this._folders.update(list => [...list, folder]);
    }

    return folder;
  }

  async rename(id: number, name: string): Promise<Folder | null> {
    const updated = await this.bridge.renameFolder(id, name);

    if (updated) {
      this._folders.update(list => list.map(f => (f.id === id ? updated : f)));
    }

    return updated;
  }

  async move(id: number, parentId: number | null): Promise<Folder | null> {
    const updated = await this.bridge.moveFolder(id, parentId);

    if (updated) {
      this._folders.update(list => list.map(f => (f.id === id ? updated : f)));
    }

    return updated;
  }

  /** Moves the folder under `parentId` and numbers the children of that parent as `orderedIds`. */
  async place(id: number, parentId: number | null, orderedIds: number[]): Promise<Folder | null> {
    const placed = await this.bridge.placeFolder(id, parentId, orderedIds);

    if (placed) {
      this._folders.update(list => list.map(f => {
        const index = orderedIds.indexOf(f.id);

        if (f.id === id) {
          return { ...f, parentId: placed.parentId, sortOrder: index + 1 };
        }

        return index === -1 || f.parentId !== parentId ? f : { ...f, sortOrder: index + 1 };
      }));
    }

    return placed;
  }

  /**
   * Deletes the folder with its sub-folders. The notes are affected too (moved to the root or deleted),
   * so the caller must reload them. Returns the ids of the deleted notes, `null` when refused.
   */
  async delete(id: number, mode: FolderDeleteMode): Promise<number[] | null> {
    const deletedNoteIds = await this.bridge.deleteFolder(id, mode);

    if (deletedNoteIds !== null) {
      await this.loadAll();
    }

    return deletedNoteIds;
  }

  /** Deletes the content of the folder (notes, sub-folders), keeping it. Returns the ids of the deleted notes. */
  async empty(id: number): Promise<number[] | null> {
    const deletedNoteIds = await this.bridge.emptyFolder(id);

    if (deletedNoteIds !== null) {
      await this.loadAll();
    }

    return deletedNoteIds;
  }

  /** `null` removes the color. */
  async setColor(ids: number[], color: string | null): Promise<void> {
    await this.bridge.setFoldersColor(ids, color);
    const colored = new Set(ids);
    this._folders.update(list => list.map(f => (colored.has(f.id) ? { ...f, color } : f)));
  }
}
