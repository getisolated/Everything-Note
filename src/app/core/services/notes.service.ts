import { Injectable, signal, computed, inject } from '@angular/core';
import { Note, NotePreview } from '../models/note.model';
import { ElectronBridgeService } from './electron-bridge.service';

const PREVIEW_MAX_LENGTH = 120;

function toPreview(n: Note): NotePreview {
  return {
    id: n.id,
    title: n.title || 'Untitled',
    tags: n.tags,
    updatedAt: n.updatedAt,
    preview: n.content.split('\n').slice(1).join(' ').slice(0, PREVIEW_MAX_LENGTH).trim(),
  };
}

@Injectable({ providedIn: 'root' })
export class NotesService {
  private bridge = inject(ElectronBridgeService);
  private readonly _notes = signal<Note[]>([]);

  readonly notes = this._notes.asReadonly();

  readonly notePreviews = computed<NotePreview[]>(() =>
    this._notes().map(toPreview)
  );

  async loadAll(): Promise<void> {
    const notes = await this.bridge.getAllNotes();
    this._notes.set(notes);
  }

  async getById(id: number): Promise<Note | null> {
    const cached = this._notes().find(n => n.id === id);
    if (cached) return cached;
    return this.bridge.getNoteById(id);
  }

  async create(): Promise<Note> {
    const note = await this.bridge.createNote('', '');
    this._notes.update(list => [note, ...list]);
    return note;
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
    const firstLine = content.split('\n')[0] ?? '';
    return firstLine.replace(/^#+\s*/, '').trim() || 'Untitled';
  }
}
