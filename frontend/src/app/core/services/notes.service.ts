import { Injectable, signal, computed, inject } from '@angular/core';
import { Note, NotePreview } from '../models/note.model';
import { QUICK_NOTE_TAG } from '../models/settings.model';
import { joinBlocks, TimestampedBlock } from '../../shared/codemirror/note-timestamps';
import { extractNoteTitle } from '../utils/note-title.util';
import { formatNoteTimestamp } from '../utils/note-timestamp.util';
import { I18nService } from '../i18n/i18n.service';
import { DesktopBridgeService } from './desktop-bridge.service';
import { FoldersService } from './folders.service';

const PREVIEW_MAX_LENGTH = 120;

function toPreview(n: Note): NotePreview {
  return {
    id: n.id,
    title: n.title,
    tags: n.tags,
    folderId: n.folderId,
    updatedAt: n.updatedAt,
    preview: n.content.split('\n').slice(1).join(' ').slice(0, PREVIEW_MAX_LENGTH).trim(),
  };
}

@Injectable({ providedIn: 'root' })
export class NotesService {
  private bridge = inject(DesktopBridgeService);
  private folders = inject(FoldersService);
  private readonly i18n = inject(I18nService);
  private readonly _notes = signal<Note[]>([]);

  readonly notes = this._notes.asReadonly();

  readonly notePreviews = computed<NotePreview[]>(() =>
    this._notes().map(toPreview)
  );

  /** Notes sent from the quick-note overlay, oldest first. */
  readonly quickNotes = computed<Note[]>(() =>
    this._notes()
      .filter(n => n.tags.includes(QUICK_NOTE_TAG))
      .sort((a, b) => a.id - b.id)
  );

  /** Quick notes as the blocks of one document (trimmed text + timestamp label), oldest first. */
  readonly quickNoteBlocks = computed<TimestampedBlock[]>(() =>
    this.quickNotes().map(n => ({ id: n.id, text: n.content.trim(), label: formatNoteTimestamp(n.createdAt, this.i18n.language()) }))
  );

  /** All quick notes as one document: one blank line between two notes. */
  readonly quickNotesDocument = computed<string>(() => joinBlocks(this.quickNoteBlocks()));

  async loadAll(): Promise<void> {
    const notes = await this.bridge.getAllNotes();
    this._notes.set(notes);
  }

  async getById(id: number): Promise<Note | null> {
    const cached = this._notes().find(n => n.id === id);
    if (cached) return cached;
    return this.bridge.getNoteById(id);
  }

  /** Creates an empty note in `folderId`; notes created on the fly (no folder given) go to the default folder. */
  async create(folderId?: number | null): Promise<Note> {
    const targetFolderId = folderId === undefined ? (this.folders.defaultFolder()?.id ?? null) : folderId;
    const note = await this.bridge.createNote('', '', [], targetFolderId);
    this._notes.update(list => [note, ...list]);
    return note;
  }

  /**
   * Turns a quick note into a normal note: the quick-note tag goes (the other tags stay), the title is derived
   * from the content like on save, and a note without folder is filed in the default folder.
   * Returns the converted note, or `null` when `id` is not a quick note.
   */
  async convertQuickNote(id: number): Promise<Note | null> {
    const note = this._notes().find(n => n.id === id);
    if (!note || !note.tags.includes(QUICK_NOTE_TAG)) return null;

    const updated = await this.update(id, {
      tags: note.tags.filter(tag => tag !== QUICK_NOTE_TAG),
      title: this.extractTitle(note.content),
    });
    if (!updated) return null;

    const inbox = this.folders.defaultFolder();
    if (updated.folderId === null && inbox) {
      await this.moveToFolder(id, inbox.id);
    }
    return this._notes().find(n => n.id === id) ?? updated;
  }

  /** Moves the note to a folder (`null` = root) without counting as an edit. */
  async moveToFolder(id: number, folderId: number | null): Promise<void> {
    const moved = await this.bridge.moveNote(id, folderId);
    if (moved) {
      this._notes.update(list => list.map(n => n.id === id ? { ...n, folderId: moved.folderId, sortOrder: moved.sortOrder } : n));
    }
  }

  /** Moves the note into `folderId` and numbers the notes of that folder as `orderedIds`. */
  async place(id: number, folderId: number | null, orderedIds: number[]): Promise<void> {
    const placed = await this.bridge.placeNote(id, folderId, orderedIds);

    if (placed) {
      this._notes.update(list => list.map(n => {
        const index = orderedIds.indexOf(n.id);

        if (n.id === id) {
          return { ...n, folderId: placed.folderId, sortOrder: index + 1 };
        }

        return index === -1 || n.folderId !== folderId ? n : { ...n, sortOrder: index + 1 };
      }));
    }
  }

  async update(id: number, data: { title?: string; content?: string; tags?: string[] }): Promise<Note | null> {
    const updated = await this.bridge.updateNote(id, data);
    if (updated) {
      this._notes.update(list => list.map(n => n.id === id ? updated : n));
    }
    return updated;
  }

  async delete(id: number): Promise<void> {
    await this.bridge.deleteNote(id);
    this._notes.update(list => list.filter(n => n.id !== id));
  }

  /** `null` removes the color. */
  async setColor(ids: number[], color: string | null): Promise<void> {
    await this.bridge.setNotesColor(ids, color);
    const colored = new Set(ids);
    this._notes.update(list => list.map(n => (colored.has(n.id) ? { ...n, color } : n)));
  }

  /** Deletes the note when it has no content (cache is up to date: the editor flushes its saves first). */
  async deleteIfEmpty(id: number): Promise<boolean> {
    const note = this._notes().find(n => n.id === id);
    if (!note || note.content.trim() !== '') return false;
    await this.delete(id);
    return true;
  }

  async search(query: string): Promise<NotePreview[]> {
    if (!query.trim()) return this.notePreviews();
    const results = await this.bridge.searchNotes(query);
    return results.map(toPreview);
  }

  async getByTag(tag: string): Promise<NotePreview[]> {
    const results = await this.bridge.getNotesByTag(tag);
    return results.map(toPreview);
  }

  async getAllTags(): Promise<string[]> {
    return this.bridge.getAllTags();
  }

  extractTitle(content: string): string {
    return extractNoteTitle(content);
  }
}
