import { Injectable, inject } from '@angular/core';
import { OVERLAY_NOTES_TAB_ID } from '../models/note.model';
import { buildHtmlDocument } from '../../shared/markdown/export-html';
import { collectSubtreeIds } from '../utils/folder-tree.util';
import { ElectronBridgeService } from './electron-bridge.service';
import { FoldersService } from './folders.service';
import { NotesService } from './notes.service';
import { ContextMenuEntry } from '../../shared/context-menu/context-menu.component';

const ICON_COPY = 'M8 4H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2M16 4h2a2 2 0 0 1 2 2v4M21 14H11M15 10l-4 4 4 4';
const ICON_EXPORT = 'M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3';

/** Context-menu entries of a note, the same in the tabs, the editor and the sidebar. */
export const NOTE_EXPORT_MENU: ContextMenuEntry[] = [
  { id: 'export:copy', label: 'Copy Content', icon: ICON_COPY },
  { id: 'export:md', label: 'Export as Markdown…', icon: ICON_EXPORT },
  { id: 'export:html', label: 'Export as HTML…', icon: ICON_EXPORT },
];

export const FOLDER_EXPORT_MENU: ContextMenuEntry = { id: 'export:zip', label: 'Export as ZIP…', icon: ICON_EXPORT };

/** Copy / export of notes. Links are kept as written: in an export they may lead nowhere, that is up to the user. */
@Injectable({ providedIn: 'root' })
export class NoteExportService {
  private readonly notes = inject(NotesService);
  private readonly folders = inject(FoldersService);
  private readonly bridge = inject(ElectronBridgeService);

  /** The quick notes document is made of other notes: it has no content of its own to export. */
  canExport(noteId: number | null): boolean {
    return noteId !== null && noteId !== OVERLAY_NOTES_TAB_ID && this.notes.notes().some(note => note.id === noteId);
  }

  /** Runs a NOTE_EXPORT_MENU entry on a note; false when the id is not one of them. */
  async runNoteAction(actionId: string, noteId: number): Promise<boolean> {
    switch (actionId) {
      case 'export:copy':
        await this.copyContent(noteId);
        return true;
      case 'export:md':
        await this.exportMarkdown(noteId);
        return true;
      case 'export:html':
        await this.exportHtml(noteId);
        return true;
      default:
        return false;
    }
  }

  /** Puts the markdown of the note in the clipboard. */
  async copyContent(noteId: number): Promise<void> {
    const note = await this.notes.getById(noteId);

    if (note) {
      await navigator.clipboard.writeText(note.content);
    }
  }

  async exportMarkdown(noteId: number): Promise<void> {
    const note = await this.notes.getById(noteId);

    if (note) {
      await this.bridge.saveExport('md', note.title || 'Untitled', note.content);
    }
  }

  /** A standalone page rendered like the preview (code colored, mermaid diagrams drawn). */
  async exportHtml(noteId: number): Promise<void> {
    const note = await this.notes.getById(noteId);

    if (!note) {
      return;
    }

    // Loaded on demand, like the preview: markdown-it, DOMPurify and mermaid stay out of the startup bundle
    const [{ createMarkdownRenderer, renderMarkdown }, { highlightCodeBlocks, renderMermaidBlocks }] = await Promise.all([
      import('../../shared/markdown/markdown-renderer'),
      import('../../shared/markdown/preview-enhancers'),
    ]);
    const container = document.createElement('div');
    container.innerHTML = renderMarkdown(createMarkdownRenderer({ linkStatus: () => 'note' }), note.content);
    await highlightCodeBlocks(container);
    await renderMermaidBlocks(container, false);

    const title = note.title || 'Untitled';
    await this.bridge.saveExport('html', title, buildHtmlDocument(title, container.innerHTML));
  }

  /** A ZIP of the notes of the folder and its sub-folders, as `.md` files in the same folder tree. */
  async exportFolder(folderId: number): Promise<void> {
    const folder = this.folders.getById(folderId);

    if (!folder) {
      return;
    }

    const folders = this.folders.folders();
    const inSubtree = new Set(collectSubtreeIds(folders, folderId));
    const byId = new Map(folders.map(f => [f.id, f]));

    /** Folder names from the exported folder (excluded) down to `id`. */
    const relativeSegments = (id: number): string[] => {
      const segments: string[] = [];

      for (let current = byId.get(id); current && current.id !== folderId; current = current.parentId === null ? undefined : byId.get(current.parentId)) {
        segments.unshift(current.name);
      }

      return segments;
    };

    const exported = this.notes.notes()
      .filter(note => note.folderId !== null && inSubtree.has(note.folderId))
      .map(note => ({ path: [...relativeSegments(note.folderId as number), note.title || 'Untitled'].join('/'), content: note.content }));

    await this.bridge.saveExport('zip', folder.name, exported);
  }
}
