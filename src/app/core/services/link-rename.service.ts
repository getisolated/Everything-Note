import { Injectable, inject } from '@angular/core';
import { QUICK_NOTE_TAG } from '../models/settings.model';
import { retargetNoteLinks } from '../utils/note-links.util';
import { notePath, toPathSegment } from '../utils/note-paths.util';
import { FoldersService } from './folders.service';
import { NotesService } from './notes.service';

/** Idle time after the last title change before the links are rewritten: the title is typed letter by letter. */
const RENAME_DEBOUNCE_MS = 1500;
/** Longest stretch of work done without giving the UI a chance to run. */
const WORK_SLICE_MS = 8;

interface PendingRename {
  /** Title the links were written with: the one before the first change of the burst. */
  fromTitle: string;
  timer: ReturnType<typeof setTimeout>;
}

/** Keeps the `[label](Folder/Note title)` links valid when a note is retitled; all done in the background. */
@Injectable({ providedIn: 'root' })
export class LinkRenameService {
  private notes = inject(NotesService);
  private folders = inject(FoldersService);

  private readonly pending = new Map<number, PendingRename>();
  /** Rewrites run one after the other so two of them never write the same note at once. */
  private queue: Promise<void> = Promise.resolve();

  /** Called when the title of a note changed; the links to the previous title are fixed once the typing stops. */
  notifyTitleChanged(noteId: number, previousTitle: string): void {
    const existing = this.pending.get(noteId);

    if (existing) {
      clearTimeout(existing.timer);
    }

    const fromTitle = existing?.fromTitle ?? previousTitle;
    const timer = setTimeout(() => this.enqueue(noteId, fromTitle), RENAME_DEBOUNCE_MS);

    this.pending.set(noteId, { fromTitle, timer });
  }

  private enqueue(noteId: number, fromTitle: string): void {
    this.pending.delete(noteId);
    // A failure must not break the chain; the links stay as they were
    this.queue = this.queue
      .then(() => this.rewriteLinks(noteId, fromTitle))
      .catch(err => console.error('[LinkRename] Failed to update the links:', err));
  }

  private async rewriteLinks(noteId: number, fromTitle: string): Promise<void> {
    const renamed = this.notes.notes().find(n => n.id === noteId);

    if (!renamed || renamed.tags.includes(QUICK_NOTE_TAG)) {
      return;
    }

    const folders = this.folders.folders();
    const fromPath = notePath({ ...renamed, title: fromTitle }, folders);
    const toPath = notePath(renamed, folders);

    if (fromPath.toLowerCase() === toPath.toLowerCase()) {
      return;
    }

    // Cheap filter: a link to the old path holds the old title, as typed or percent-encoded
    const segment = toPathSegment(fromTitle).toLowerCase();
    const encodedSegment = encodeURIComponent(toPathSegment(fromTitle)).toLowerCase();
    const candidates = this.notes.notes().filter(n => {
      if (n.id === noteId || n.tags.includes(QUICK_NOTE_TAG)) {
        return false;
      }

      const lowered = n.content.toLowerCase();

      return lowered.includes(segment) || lowered.includes(encodedSegment);
    });

    let sliceStart = performance.now();

    for (const candidate of candidates) {
      // Re-read: the note may have been edited since the list was taken
      const current = this.notes.notes().find(n => n.id === candidate.id);
      const content = current ? retargetNoteLinks(current.content, fromPath, toPath) : null;

      if (content !== null) {
        await this.notes.update(candidate.id, { content });
      }

      if (performance.now() - sliceStart > WORK_SLICE_MS) {
        await new Promise<void>(resolve => setTimeout(resolve));
        sliceStart = performance.now();
      }
    }
  }
}
