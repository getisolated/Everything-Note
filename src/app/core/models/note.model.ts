export interface Note {
  id: number;
  title: string;
  content: string;
  tags: string[];
  /** `null`: the note lives at the root of the tree. */
  folderId: number | null;
  /** Manual position among the notes of the same folder; `null` until the user reorders. */
  sortOrder: number | null;
  /** `#rrggbb` chosen in the sidebar, `null` for none. */
  color: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface NotePreview {
  id: number;
  title: string;
  tags: string[];
  folderId: number | null;
  updatedAt: string;
  preview: string;
}

export interface Tab {
  noteId: number;
  title: string;
  isDirty: boolean;
  isPinned: boolean;
}

export type PaletteMode = 'command' | 'search' | 'tag';

export interface PaletteCommand {
  id: string;
  label: string;
  description?: string;
  shortcut?: string;
  category: 'note' | 'action' | 'settings';
  action: () => void;
}

export interface PaletteResult {
  type: 'command' | 'note' | 'tag';
  command?: PaletteCommand;
  note?: NotePreview;
  tag?: string;
}

/** Pseudo note id of the read-only tab that concatenates every note sent from the quick-note overlay. */
export const OVERLAY_NOTES_TAB_ID = -1;
