import { promises as fs } from 'fs';
import * as path from 'path';
import { BrowserWindow, app, dialog } from 'electron/main';
import { createZip } from './zip';

export type ExportKind = 'md' | 'html' | 'zip';

/** A note of a folder export: its path below the exported folder (folders then title, no extension) and its text. */
export interface ExportedNote {
  path: string;
  content: string;
}

const FILTERS: Record<ExportKind, Electron.FileFilter> = {
  md: { name: 'Markdown', extensions: ['md'] },
  html: { name: 'HTML page', extensions: ['html'] },
  zip: { name: 'ZIP archive', extensions: ['zip'] },
};

const FORBIDDEN_IN_NAME = /[<>:"/\\|?*\u0000-\u001f]/g;
/** Device names Windows refuses as file names, whatever the extension. */
const RESERVED_NAMES = /^(con|prn|aux|nul|com\d|lpt\d)$/i;
const MAX_NAME_LENGTH = 120;

/** A title usable as a Windows file or folder name: forbidden characters become dashes; never empty. */
export function safeFileName(name: string, fallback = 'Untitled'): string {
  const cleaned = name.replace(FORBIDDEN_IN_NAME, '-').replace(/\s+/g, ' ').trim().replace(/[. ]+$/, '').slice(0, MAX_NAME_LENGTH).trim();

  if (!cleaned) {
    return fallback;
  }

  return RESERVED_NAMES.test(cleaned) ? `${cleaned}-` : cleaned;
}

/** Archive paths of the notes: each segment made safe, `.md` added, duplicates numbered (`Note (2).md`). */
export function zipPaths(notes: ExportedNote[]): string[] {
  const used = new Set<string>();

  return notes.map(note => {
    const segments = note.path.split('/').map(segment => safeFileName(segment));
    const base = segments.join('/');
    let candidate = `${base}.md`;

    for (let copy = 2; used.has(candidate.toLowerCase()); copy++) {
      candidate = `${base} (${copy}).md`;
    }

    used.add(candidate.toLowerCase());
    return candidate;
  });
}

function isExportedNotes(value: unknown): value is ExportedNote[] {
  return Array.isArray(value) && value.every(note =>
    typeof note === 'object' && note !== null && typeof note.path === 'string' && typeof note.content === 'string');
}

/**
 * Asks where to save, then writes the export: a text file (md / html) or a ZIP of the notes of a folder.
 * Returns the written path, `null` when the user cancelled.
 */
export async function saveExport(window: BrowserWindow | null, kind: ExportKind, suggestedName: string, payload: unknown): Promise<string | null> {
  const name = `${safeFileName(suggestedName)}.${kind}`;
  const options: Electron.SaveDialogOptions = { defaultPath: path.join(app.getPath('documents'), name), filters: [FILTERS[kind]] };
  const { canceled, filePath } = window ? await dialog.showSaveDialog(window, options) : await dialog.showSaveDialog(options);

  if (canceled || !filePath) {
    return null;
  }

  if (kind === 'zip') {
    if (!isExportedNotes(payload)) {
      throw new Error('Invalid folder export');
    }

    const paths = zipPaths(payload);
    const entries = payload.map((note, index) => ({ path: paths[index] as string, data: Buffer.from(note.content, 'utf-8') }));
    await fs.writeFile(filePath, createZip(entries));
  } else {
    if (typeof payload !== 'string') {
      throw new Error('Invalid note export');
    }

    await fs.writeFile(filePath, payload, 'utf-8');
  }

  return filePath;
}

export function isExportKind(value: unknown): value is ExportKind {
  return value === 'md' || value === 'html' || value === 'zip';
}
