"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.noteOps = void 0;
exports.initDatabase = initDatabase;
exports.closeDatabase = closeDatabase;
exports.sanitizeFtsQuery = sanitizeFtsQuery;
exports.escapeLike = escapeLike;
const better_sqlite3_1 = __importDefault(require("better-sqlite3"));
const path = __importStar(require("path"));
const electron_1 = require("electron");
let db;
// Cached prepared statements (initialized after DB open)
let stmts;
function initDatabase() {
    const dbPath = path.join(electron_1.app.getPath('userData'), 'evnote.db');
    db = new better_sqlite3_1.default(dbPath);
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
  `);
    // Cache prepared statements after schema is ready
    stmts = {
        getAll: db.prepare('SELECT * FROM notes ORDER BY updated_at DESC'),
        getById: db.prepare('SELECT * FROM notes WHERE id = ?'),
        create: db.prepare("INSERT INTO notes (title, content, tags) VALUES (?, ?, '[]')"),
        delete: db.prepare('DELETE FROM notes WHERE id = ?'),
        search: db.prepare(`
      SELECT notes.* FROM notes
      JOIN notes_fts ON notes.id = notes_fts.rowid
      WHERE notes_fts MATCH ?
      ORDER BY rank
    `),
        getByTag: db.prepare("SELECT * FROM notes WHERE tags LIKE ? ESCAPE '\\' ORDER BY updated_at DESC"),
        getAllTags: db.prepare('SELECT tags FROM notes'),
    };
}
function closeDatabase() {
    if (db) {
        db.close();
    }
}
/** Escapes special FTS5 characters so user input is treated as literal text. */
function sanitizeFtsQuery(query) {
    return query
        .trim()
        .split(/\s+/)
        .filter(token => token.length > 0)
        .map(token => `"${token.replace(/"/g, '""')}"`)
        .join(' ');
}
/** Escapes LIKE wildcards so user input is treated as literal text. */
function escapeLike(value) {
    return value
        .replace(/\\/g, '\\\\')
        .replace(/%/g, '\\%')
        .replace(/_/g, '\\_');
}
exports.noteOps = {
    getAll() {
        return stmts.getAll.all();
    },
    getById(id) {
        return stmts.getById.get(id);
    },
    create(title, content) {
        const result = stmts.create.run(title, content);
        return this.getById(result.lastInsertRowid);
    },
    update(id, data) {
        const fields = [];
        const values = [];
        if (data.title !== undefined) {
            fields.push('title = ?');
            values.push(data.title);
        }
        if (data.content !== undefined) {
            fields.push('content = ?');
            values.push(data.content);
        }
        if (data.tags !== undefined) {
            fields.push('tags = ?');
            values.push(data.tags);
        }
        if (fields.length === 0)
            return this.getById(id);
        fields.push("updated_at = datetime('now')");
        values.push(id);
        db.prepare(`UPDATE notes SET ${fields.join(', ')} WHERE id = ?`).run(...values);
        return this.getById(id);
    },
    delete(id) {
        stmts.delete.run(id);
    },
    search(query) {
        if (!query.trim())
            return this.getAll();
        const sanitized = sanitizeFtsQuery(query);
        if (!sanitized)
            return this.getAll();
        return stmts.search.all(sanitized + '*');
    },
    getByTag(tag) {
        const escaped = escapeLike(tag.replace(/"/g, ''));
        return stmts.getByTag.all(`%"${escaped}"%`);
    },
    getAllTags() {
        const rows = stmts.getAllTags.all();
        const tagSet = new Set();
        for (const row of rows) {
            try {
                const tags = JSON.parse(row.tags);
                tags.forEach(t => tagSet.add(t));
            }
            catch { /* skip malformed tags */ }
        }
        return Array.from(tagSet).sort();
    }
};
