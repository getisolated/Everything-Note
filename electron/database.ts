import Database from 'better-sqlite3';
import * as path from 'path';
import { app } from 'electron/main';

export interface NoteRow {
  id: number;
  title: string;
  content: string;
  tags: string; // JSON array string
  folder_id: number | null;
  sort_order: number | null;
  created_at: string;
  updated_at: string;
}

export interface FolderRow {
  id: number;
  name: string;
  parent_id: number | null;
  is_default: number; // 0 | 1 (SQLite has no boolean)
  sort_order: number | null;
  created_at: string;
}

export type FolderDeleteMode = 'moveToRoot' | 'deleteAll';

/** A folder or a file of the disk opened in the app; the path (absolute, normalized) is its key. */
export interface CollectionRow {
  path: string;
  kind: 'folder' | 'file';
  display_name: string;
  sort_order: number;
  created_at: string;
}

export const MAX_FOLDER_NAME_LENGTH = 100;
const DEFAULT_FOLDER_NAME = 'Inbox';

let db: Database.Database;

// Cached prepared statements (initialized after DB open)
let stmts: {
  getAll: Database.Statement;
  getById: Database.Statement;
  create: Database.Statement;
  delete: Database.Statement;
  search: Database.Statement;
  getByTag: Database.Statement;
  getAllTags: Database.Statement;
  getFolders: Database.Statement;
  getFolderById: Database.Statement;
  getDefaultFolder: Database.Statement;
  subtreeIds: Database.Statement;
};

export function initDatabase(): void {
  const dbPath = path.join(app.getPath('userData'), 'evnote.db');
  db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  db.exec(`
    CREATE TABLE IF NOT EXISTS notes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL DEFAULT '',
      content TEXT NOT NULL DEFAULT '',
      tags TEXT NOT NULL DEFAULT '[]',
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );

    CREATE VIRTUAL TABLE IF NOT EXISTS notes_fts USING fts5(
      title,
      content,
      content=notes,
      content_rowid=id
    );

    CREATE TRIGGER IF NOT EXISTS notes_ai AFTER INSERT ON notes BEGIN
      INSERT INTO notes_fts(rowid, title, content) VALUES (new.id, new.title, new.content);
    END;

    CREATE TRIGGER IF NOT EXISTS notes_ad AFTER DELETE ON notes BEGIN
      INSERT INTO notes_fts(notes_fts, rowid, title, content) VALUES('delete', old.id, old.title, old.content);
    END;

    CREATE TRIGGER IF NOT EXISTS notes_au AFTER UPDATE ON notes BEGIN
      INSERT INTO notes_fts(notes_fts, rowid, title, content) VALUES('delete', old.id, old.title, old.content);
      INSERT INTO notes_fts(rowid, title, content) VALUES (new.id, new.title, new.content);
    END;

    CREATE TABLE IF NOT EXISTS folders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      parent_id INTEGER REFERENCES folders(id) ON DELETE CASCADE,
      is_default INTEGER NOT NULL DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now'))
    );
  `);

  migrateNotesFolderColumn();
  createCollectionsTable();

  // Cache prepared statements after schema is ready
  stmts = {
    getAll: db.prepare('SELECT * FROM notes ORDER BY updated_at DESC'),
    getById: db.prepare('SELECT * FROM notes WHERE id = ?'),
    create: db.prepare('INSERT INTO notes (title, content, tags, folder_id) VALUES (?, ?, ?, ?)'),
    delete: db.prepare('DELETE FROM notes WHERE id = ?'),
    search: db.prepare(`
      SELECT notes.* FROM notes
      JOIN notes_fts ON notes.id = notes_fts.rowid
      WHERE notes_fts MATCH ?
      ORDER BY rank
    `),
    getByTag: db.prepare("SELECT * FROM notes WHERE tags LIKE ? ESCAPE '\\' ORDER BY updated_at DESC"),
    getAllTags: db.prepare('SELECT tags FROM notes'),
    getFolders: db.prepare('SELECT * FROM folders ORDER BY id'),
    getFolderById: db.prepare('SELECT * FROM folders WHERE id = ?'),
    getDefaultFolder: db.prepare('SELECT * FROM folders WHERE is_default = 1 LIMIT 1'),
    // The folder itself and everything below it (the UNION also protects against a parent cycle)
    subtreeIds: db.prepare(`
      WITH RECURSIVE subtree(id) AS (
        SELECT id FROM folders WHERE id = ?
        UNION
        SELECT f.id FROM folders f JOIN subtree s ON f.parent_id = s.id
      )
      SELECT id FROM subtree
    `),
  };

  ensureDefaultFolder();
}

/** `ALTER TABLE ... ADD COLUMN` is not idempotent, hence the check. */
function addColumnIfMissing(table: string, column: string, definition: string): void {
  const columns = db.pragma(`table_info(${table})`) as { name: string }[];

  if (!columns.some(existing => existing.name === column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
}

/**
 * Adds the folder-related columns to databases created before the folders existed. Existing notes get a NULL
 * `folder_id` ("at the root"); a NULL `sort_order` means "never positioned by the user" (alphabetical order).
 */
function migrateNotesFolderColumn(): void {
  addColumnIfMissing('notes', 'folder_id', 'INTEGER REFERENCES folders(id) ON DELETE SET NULL');
  addColumnIfMissing('notes', 'sort_order', 'INTEGER');
  addColumnIfMissing('folders', 'sort_order', 'INTEGER');

  db.exec('CREATE INDEX IF NOT EXISTS idx_notes_folder_id ON notes(folder_id)');
}

/** Collections (folders / files on disk) are listed here; their content is read from the disk, never stored. */
function createCollectionsTable(): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS collections (
      path TEXT PRIMARY KEY,
      kind TEXT NOT NULL CHECK (kind IN ('folder', 'file')),
      display_name TEXT NOT NULL,
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now'))
    )
  `);
}

/** The default folder must always exist: the notes created on the fly land in it. */
function ensureDefaultFolder(): void {
  if (!stmts.getDefaultFolder.get()) {
    db.prepare('INSERT INTO folders (name, parent_id, is_default) VALUES (?, NULL, 1)').run(DEFAULT_FOLDER_NAME);
  }
}

export function closeDatabase(): void {
  if (db) {
    db.close();
  }
}

/** Escapes special FTS5 characters so user input is treated as literal text. */
export function sanitizeFtsQuery(query: string): string {
  return query
    .trim()
    .split(/\s+/)
    .filter(token => token.length > 0)
    .map(token => `"${token.replace(/"/g, '""')}"`)
    .join(' ');
}

/** Escapes LIKE wildcards so user input is treated as literal text. */
export function escapeLike(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/%/g, '\\%')
    .replace(/_/g, '\\_');
}

export const noteOps = {
  getAll(): NoteRow[] {
    return stmts.getAll.all() as NoteRow[];
  },

  getById(id: number): NoteRow | undefined {
    return stmts.getById.get(id) as NoteRow | undefined;
  },

  create(title: string, content: string, tags: string[] = [], folderId: number | null = null): NoteRow {
    // A folder that does not exist (anymore) must not make the note creation fail
    const validFolderId = folderId !== null && folderOps.getById(folderId) ? folderId : null;
    const result = stmts.create.run(title, content, JSON.stringify(tags), validFolderId);
    return this.getById(result.lastInsertRowid as number)!;
  },

  update(id: number, data: { title?: string; content?: string; tags?: string }): NoteRow | undefined {
    const fields: string[] = [];
    const values: (string | number)[] = [];

    if (data.title !== undefined) { fields.push('title = ?'); values.push(data.title); }
    if (data.content !== undefined) { fields.push('content = ?'); values.push(data.content); }
    if (data.tags !== undefined) { fields.push('tags = ?'); values.push(data.tags); }

    if (fields.length === 0) return this.getById(id);

    fields.push("updated_at = datetime('now')");
    values.push(id);

    db.prepare(`UPDATE notes SET ${fields.join(', ')} WHERE id = ?`).run(...values);
    return this.getById(id);
  },

  /** Moves the note without touching `updated_at`: a reorganization is not an edit. */
  moveToFolder(id: number, folderId: number | null): NoteRow | undefined {
    if (folderId !== null && !folderOps.getById(folderId)) {
      return this.getById(id);
    }

    // A note arriving in another folder loses its position there: it is listed after the positioned ones
    db.prepare('UPDATE notes SET folder_id = ?, sort_order = CASE WHEN folder_id IS ? THEN sort_order ELSE NULL END WHERE id = ?')
      .run(folderId, folderId, id);
    return this.getById(id);
  },

  /**
   * Puts the note in `folderId` at the position given by `orderedIds` (the ids of the whole folder content,
   * in display order). Only the notes really in that folder are renumbered.
   */
  place(id: number, folderId: number | null, orderedIds: number[]): NoteRow | undefined {
    const moved = this.moveToFolder(id, folderId);

    if (!moved || moved.folder_id !== folderId) {
      return moved;
    }

    const setOrder = db.prepare('UPDATE notes SET sort_order = ? WHERE id = ? AND folder_id IS ?');

    db.transaction(() => {
      orderedIds.forEach((noteId, index) => setOrder.run(index + 1, noteId, folderId));
    })();

    return this.getById(id);
  },

  delete(id: number): void {
    stmts.delete.run(id);
  },

  search(query: string): NoteRow[] {
    if (!query.trim()) return this.getAll();
    const sanitized = sanitizeFtsQuery(query);
    if (!sanitized) return this.getAll();
    return stmts.search.all(sanitized + '*') as NoteRow[];
  },

  getByTag(tag: string): NoteRow[] {
    const escaped = escapeLike(tag.replace(/"/g, ''));
    return stmts.getByTag.all(`%"${escaped}"%`) as NoteRow[];
  },

  getAllTags(): string[] {
    const rows = stmts.getAllTags.all() as { tags: string }[];
    const tagSet = new Set<string>();
    for (const row of rows) {
      try {
        const tags: string[] = JSON.parse(row.tags);
        tags.forEach(t => tagSet.add(t));
      } catch { /* skip malformed tags */ }
    }
    return Array.from(tagSet).sort();
  }
};

/** Trims the name and rejects what cannot be a folder name; `null` when invalid. */
export function normalizeFolderName(name: unknown): string | null {
  if (typeof name !== 'string') {
    return null;
  }

  const trimmed = name.trim();

  return trimmed.length > 0 && trimmed.length <= MAX_FOLDER_NAME_LENGTH ? trimmed : null;
}

function subtreeIds(folderId: number): number[] {
  return (stmts.subtreeIds.all(folderId) as { id: number }[]).map(row => row.id);
}

export const folderOps = {
  getAll(): FolderRow[] {
    return stmts.getFolders.all() as FolderRow[];
  },

  getById(id: number): FolderRow | undefined {
    return stmts.getFolderById.get(id) as FolderRow | undefined;
  },

  create(name: string, parentId: number | null): FolderRow | undefined {
    const normalized = normalizeFolderName(name);

    if (normalized === null || (parentId !== null && !this.getById(parentId))) {
      return undefined;
    }

    const result = db.prepare('INSERT INTO folders (name, parent_id) VALUES (?, ?)').run(normalized, parentId);

    return this.getById(result.lastInsertRowid as number);
  },

  rename(id: number, name: string): FolderRow | undefined {
    const normalized = normalizeFolderName(name);

    if (normalized === null || !this.getById(id)) {
      return undefined;
    }

    db.prepare('UPDATE folders SET name = ? WHERE id = ?').run(normalized, id);

    return this.getById(id);
  },

  /** Refuses (returns `undefined`) to move the default folder, or a folder into itself or its own subtree. */
  move(id: number, parentId: number | null): FolderRow | undefined {
    const folder = this.getById(id);

    if (!folder || folder.is_default === 1 || (parentId !== null && !this.getById(parentId))) {
      return undefined;
    }

    if (parentId !== null && subtreeIds(id).includes(parentId)) {
      return undefined;
    }

    db.prepare('UPDATE folders SET parent_id = ?, sort_order = CASE WHEN parent_id IS ? THEN sort_order ELSE NULL END WHERE id = ?')
      .run(parentId, parentId, id);

    return this.getById(id);
  },

  /**
   * Puts the folder under `parentId` at the position given by `orderedIds` (the ids of all the children of
   * that parent, in display order). Refused (`undefined`) when the move itself is, see `move`.
   */
  place(id: number, parentId: number | null, orderedIds: number[]): FolderRow | undefined {
    const folder = this.getById(id);

    if (!folder) {
      return undefined;
    }

    if (folder.parent_id !== parentId && !this.move(id, parentId)) {
      return undefined;
    }

    const setOrder = db.prepare('UPDATE folders SET sort_order = ? WHERE id = ? AND parent_id IS ?');

    db.transaction(() => {
      orderedIds.forEach((folderId, index) => setOrder.run(index + 1, folderId, parentId));
    })();

    return this.getById(id);
  },

  /**
   * Deletes the folder and its sub-folders. The notes inside are either moved to the root or deleted with them.
   * Everything happens in one transaction so a failure cannot leave notes pointing to deleted folders.
   * Returns the ids of the deleted notes, or `null` when refused (default folder, unknown folder).
   */
  delete(id: number, mode: FolderDeleteMode): number[] | null {
    const folder = this.getById(id);

    if (!folder || folder.is_default === 1) {
      return null;
    }

    const ids = subtreeIds(id);
    const marks = ids.map(() => '?').join(', ');

    return db.transaction((): number[] => {
      let deletedNoteIds: number[] = [];

      if (mode === 'deleteAll') {
        const rows = db.prepare(`SELECT id FROM notes WHERE folder_id IN (${marks})`).all(...ids) as { id: number }[];

        deletedNoteIds = rows.map(row => row.id);
        db.prepare(`DELETE FROM notes WHERE folder_id IN (${marks})`).run(...ids);
      } else {
        db.prepare(`UPDATE notes SET folder_id = NULL WHERE folder_id IN (${marks})`).run(...ids);
      }

      // Sub-folders go away through ON DELETE CASCADE
      db.prepare('DELETE FROM folders WHERE id = ?').run(id);

      return deletedNoteIds;
    })();
  },
};

export const collectionOps = {
  getAll(): CollectionRow[] {
    return db.prepare('SELECT * FROM collections ORDER BY sort_order, created_at').all() as CollectionRow[];
  },

  get(collectionPath: string): CollectionRow | undefined {
    return db.prepare('SELECT * FROM collections WHERE path = ?').get(collectionPath) as CollectionRow | undefined;
  },

  /** Adds the collection (last of the list); an already opened path is returned as is. */
  add(collectionPath: string, kind: 'folder' | 'file', displayName: string): CollectionRow | undefined {
    const next = (db.prepare('SELECT COALESCE(MAX(sort_order), 0) + 1 AS next FROM collections').get() as { next: number }).next;
    db.prepare('INSERT OR IGNORE INTO collections (path, kind, display_name, sort_order) VALUES (?, ?, ?, ?)').run(collectionPath, kind, displayName, next);
    return this.get(collectionPath);
  },

  remove(collectionPath: string): void {
    db.prepare('DELETE FROM collections WHERE path = ?').run(collectionPath);
  },

  rename(collectionPath: string, displayName: string): CollectionRow | undefined {
    db.prepare('UPDATE collections SET display_name = ? WHERE path = ?').run(displayName, collectionPath);
    return this.get(collectionPath);
  },

  /** A file or folder moved on disk (relocated by the user): same collection, new key. */
  relocate(from: string, to: string): CollectionRow | undefined {
    db.prepare('UPDATE collections SET path = ? WHERE path = ?').run(to, from);
    return this.get(to);
  },
};
