import { Injectable, inject } from '@angular/core';
import { I18nService } from '../i18n/i18n.service';
import { Translator } from '../i18n/translate';
import { noteDisplayTitle } from '../utils/note-title.util';
import { Note, QUICK_NOTES_TAB_ID } from '../models/note.model';
import { SidebarDragItem } from '../models/folder.model';
import { buildHtmlDocument } from '../../shared/markdown/export-html';
import { ArchiveEntry, folderArchiveEntries, selectionArchiveEntries } from '../utils/export-archive.util';
import { DesktopBridgeService } from './desktop-bridge.service';
import { FoldersService } from './folders.service';
import { NotesService } from './notes.service';
import { ContextMenuItem } from '../../shared/context-menu/context-menu.component';

const ICON_COPY = 'M8 4H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2M16 4h2a2 2 0 0 1 2 2v4M21 14H11M15 10l-4 4 4 4';
const ICON_EXPORT = 'M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3';

/** Format of the files of an archive export. */
export type ArchiveFormat = 'md' | 'pdf';

/** Context-menu entry of a note, the same in the tabs, the editor and the sidebar: its actions open in a submenu. */
export function noteExportMenu(t: Translator): ContextMenuItem {
  return {
    id: 'export',
    label: t('editor.export.exportAs'),
    icon: ICON_EXPORT,
    children: [
      { id: 'export:copy', label: t('editor.export.copyContent'), icon: ICON_COPY },
      { id: 'export:md', label: t('editor.export.markdown'), icon: ICON_EXPORT },
      { id: 'export:html', label: t('editor.export.html'), icon: ICON_EXPORT },
      { id: 'export:pdf', label: t('editor.export.pdf'), icon: ICON_EXPORT },
    ],
  };
}

/** Context-menu entries of a folder: its notes as a ZIP of `.md` files, or of PDF files. */
export function folderExportMenu(t: Translator): ContextMenuItem[] {
  return [
    { id: 'export:zip', label: t('editor.export.zip'), icon: ICON_EXPORT },
    { id: 'export:pdf-zip', label: t('editor.export.pdfZip'), icon: ICON_EXPORT },
  ];
}

/** Context-menu entry of a sidebar selection (several notes and / or folders): one archive of all of them. */
export function selectionExportMenu(t: Translator): ContextMenuItem {
  return {
    id: 'export',
    label: t('editor.export.export'),
    icon: ICON_EXPORT,
    children: [
      { id: 'export:zip', label: t('editor.export.selectionMarkdown'), icon: ICON_EXPORT },
      { id: 'export:pdf-zip', label: t('editor.export.selectionPdf'), icon: ICON_EXPORT },
    ],
  };
}

/** Copy / export of notes. Links are kept as written: in an export they may lead nowhere, that is up to the user. */
@Injectable({ providedIn: 'root' })
export class NoteExportService {
  private readonly notes = inject(NotesService);
  private readonly folders = inject(FoldersService);
  private readonly bridge = inject(DesktopBridgeService);
  private readonly i18n = inject(I18nService);

  /** The quick notes document is made of other notes: it has no content of its own to export. */
  canExport(noteId: number | null): boolean {
    return noteId !== null && noteId !== QUICK_NOTES_TAB_ID && this.notes.notes().some(note => note.id === noteId);
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
      case 'export:pdf':
        await this.exportPdf(noteId);
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
      await this.bridge.saveExport('md', this.titleOf(note), note.content);
    }
  }

  /** A standalone page rendered like the preview (code colored, mermaid diagrams drawn). */
  async exportHtml(noteId: number): Promise<void> {
    const note = await this.notes.getById(noteId);

    if (note) {
      await this.bridge.saveExport('html', this.titleOf(note), await this.renderPage(note, false));
    }
  }

  /** The same page as `exportHtml`, printed to A4 pages by the system web view (main process). */
  async exportPdf(noteId: number): Promise<void> {
    const note = await this.notes.getById(noteId);

    if (note) {
      await this.bridge.saveExport('pdf', this.titleOf(note), await this.renderPage(note, true));
    }
  }

  /** A ZIP of the notes of the folder and its sub-folders, as `.md` or PDF files in the same folder tree. */
  async exportFolder(folderId: number, format: ArchiveFormat = 'md'): Promise<void> {
    const folder = this.folders.getById(folderId);

    if (folder) {
      const entries = folderArchiveEntries(folderId, this.folders.folders(), this.notes.notes(), note => this.titleOf(note));
      await this.saveArchive(format, folder.name, entries);
    }
  }

  /**
   * A ZIP of a sidebar selection (top-level items): the notes at the root of the archive, the folders with their
   * subtree. Named after the first folder of the selection, or its first note.
   */
  async exportSelection(items: readonly SidebarDragItem[], format: ArchiveFormat): Promise<void> {
    const entries = selectionArchiveEntries(items, this.folders.folders(), this.notes.notes(), note => this.titleOf(note));
    const firstFolder = items.find(item => item.kind === 'folder');
    const name = (firstFolder && this.folders.getById(firstFolder.id)?.name) ?? entries[0]?.path ?? this.i18n.t('common.untitled');

    await this.saveArchive(format, name, entries);
  }

  private async saveArchive(format: ArchiveFormat, name: string, entries: ArchiveEntry<Note>[]): Promise<void> {
    if (format === 'md') {
      await this.bridge.saveExport('zip', name, entries.map(({ note, path }) => ({ path, content: note.content })));
      return;
    }

    // One page after the other: mermaid renders a diagram at a time
    const pages: { path: string; content: string }[] = [];

    for (const { note, path } of entries) {
      pages.push({ path, content: await this.renderPage(note, true) });
    }

    await this.bridge.saveExport('pdf-zip', name, pages);
  }

  private titleOf(note: Pick<Note, 'title'>): string {
    return noteDisplayTitle(note.title, this.i18n.t);
  }

  /** The note as a standalone page, rendered like the preview; with the print stylesheet for a PDF. */
  private async renderPage(note: Note, print: boolean): Promise<string> {
    // Loaded on demand, like the preview: markdown-it, DOMPurify and mermaid stay out of the startup bundle
    const [{ createMarkdownRenderer, renderMarkdown }, { highlightCodeBlocks, renderMermaidBlocks }] = await Promise.all([
      import('../../shared/markdown/markdown-renderer'),
      import('../../shared/markdown/preview-enhancers'),
    ]);
    const container = document.createElement('div');
    container.innerHTML = renderMarkdown(createMarkdownRenderer({ linkStatus: () => 'note', t: this.i18n.t }), note.content);

    // Mermaid only draws diagrams attached to the document: the page is built off screen
    container.style.cssText = 'position: fixed; top: 0; left: -10000px; width: 860px; visibility: hidden; pointer-events: none;';
    document.body.append(container);

    try {
      await highlightCodeBlocks(container);
      await renderMermaidBlocks(container, false);
      return buildHtmlDocument(this.titleOf(note), container.innerHTML, this.i18n.language(), { print });
    } finally {
      container.remove();
    }
  }
}
