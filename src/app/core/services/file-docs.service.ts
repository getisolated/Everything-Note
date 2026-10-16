import { Injectable } from '@angular/core';
import { CollectionFileRef } from '../models/collection.model';

/** Ids of the file documents start below the quick notes (-1) and the reserved range: never a real note id. */
const FIRST_FILE_DOC_ID = -100;

function refKey(ref: CollectionFileRef): string {
  return `${ref.root}\u0000${ref.path}`;
}

/**
 * Gives each collection file opened in a tab a stable (for the session) negative id, so that tabs, the editor and the
 * shortcuts keep working with one kind of id. Notes have positive ids, the quick notes -1.
 */
@Injectable({ providedIn: 'root' })
export class FileDocsService {
  private readonly ids = new Map<string, number>();
  private readonly refs = new Map<number, CollectionFileRef>();
  private nextId = FIRST_FILE_DOC_ID;

  idFor(ref: CollectionFileRef): number {
    const key = refKey(ref);
    let id = this.ids.get(key);

    if (id === undefined) {
      id = this.nextId--;
      this.ids.set(key, id);
      this.refs.set(id, ref);
    }

    return id;
  }

  refFor(id: number | null): CollectionFileRef | null {
    return id === null ? null : this.refs.get(id) ?? null;
  }

  isFileDoc(id: number | null): boolean {
    return id !== null && this.refs.has(id);
  }

  /** The file was renamed or moved on disk: same id (the tab stays), new location. */
  retarget(from: CollectionFileRef, to: CollectionFileRef): number | null {
    const id = this.ids.get(refKey(from));

    if (id === undefined) {
      return null;
    }

    this.ids.delete(refKey(from));
    this.ids.set(refKey(to), id);
    this.refs.set(id, to);
    return id;
  }

  /** Ids of the open files of a collection, or below a folder of it (`prefix` = its relative path). */
  idsUnder(root: string, prefix = ''): number[] {
    return [...this.refs.entries()]
      .filter(([, ref]) => ref.root === root && (prefix === '' || ref.path === prefix || ref.path.startsWith(`${prefix}/`)))
      .map(([id]) => id);
  }
}
