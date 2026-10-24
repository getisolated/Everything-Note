import { describe, it, expect, vi } from 'vitest';
import { Injector } from '@angular/core';
import { DesktopBridgeService } from '../src/app/core/services/desktop-bridge.service';
import { FoldersService } from '../src/app/core/services/folders.service';
import { I18nService } from '../src/app/core/i18n/i18n.service';
import { NotesService } from '../src/app/core/services/notes.service';
import { Note } from '../src/app/core/models/note.model';
import { QUICK_NOTE_TAG } from '../src/app/core/models/settings.model';

// The real services talk to Tauri and the DOM: only their tokens matter here
vi.mock('../src/app/core/services/desktop-bridge.service', () => ({ DesktopBridgeService: class {} }));
vi.mock('../src/app/core/services/folders.service', () => ({ FoldersService: class {} }));
vi.mock('../src/app/core/i18n/i18n.service', () => ({ I18nService: class {} }));

const INBOX_ID = 7;

function note(overrides: Partial<Note>): Note {
  return {
    id: 1, title: 'old', content: '', tags: [], folderId: null, sortOrder: 0, color: null,
    createdAt: '2026-01-01T10:00:00Z', updatedAt: '2026-01-01T10:00:00Z', ...overrides,
  } as Note;
}

async function setup(stored: Note[]) {
  const moves: Array<[number, number | null]> = [];
  const bridge = {
    getAllNotes: async () => stored,
    updateNote: async (id: number, data: Partial<Note>) => ({ ...stored.find(n => n.id === id)!, ...data }),
    moveNote: async (id: number, folderId: number | null) => { moves.push([id, folderId]); return { folderId, sortOrder: 1 }; },
  };
  const injector = Injector.create({
    providers: [
      { provide: DesktopBridgeService, useValue: bridge },
      { provide: FoldersService, useValue: { defaultFolder: () => ({ id: INBOX_ID }) } },
      { provide: I18nService, useValue: { language: () => 'en' } },
      { provide: NotesService, useClass: NotesService, deps: [] },
    ],
  });
  const service = injector.get(NotesService);
  await service.loadAll();
  return { service, moves };
}

describe('NotesService.convertQuickNote', () => {
  it('drops the quick-note tag only, derives the title and files the note in the default folder', async () => {
    const { service, moves } = await setup([note({ id: 1, content: '\n# Buy milk\nand eggs', tags: [QUICK_NOTE_TAG, 'shopping'] })]);
    const converted = await service.convertQuickNote(1);

    expect(converted?.tags).toEqual(['shopping']);
    expect(converted?.title).toBe('Buy milk');
    expect(converted?.id).toBe(1);
    expect(converted?.createdAt).toBe('2026-01-01T10:00:00Z');
    expect(converted?.folderId).toBe(INBOX_ID);
    expect(moves).toEqual([[1, INBOX_ID]]);
  });

  it('leaves the quick notes document', async () => {
    const { service } = await setup([note({ id: 1, content: 'a', tags: [QUICK_NOTE_TAG] }), note({ id: 2, content: 'b', tags: [QUICK_NOTE_TAG] })]);
    await service.convertQuickNote(1);
    expect(service.quickNotes().map(n => n.id)).toEqual([2]);
  });

  it('keeps an existing folder', async () => {
    const { service, moves } = await setup([note({ id: 1, content: 'a', tags: [QUICK_NOTE_TAG], folderId: 3 })]);
    expect((await service.convertQuickNote(1))?.folderId).toBe(3);
    expect(moves).toEqual([]);
  });

  it('ignores a note that is not a quick note', async () => {
    const { service } = await setup([note({ id: 1, content: 'a', tags: ['x'] })]);
    expect(await service.convertQuickNote(1)).toBeNull();
    expect(await service.convertQuickNote(99)).toBeNull();
  });
});
