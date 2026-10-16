import { Injectable, computed, signal } from '@angular/core';
import { EditorSelection, EditorState } from '@codemirror/state';
import { EditorView, ViewUpdate } from '@codemirror/view';
import {
  SearchQuery, closeSearchPanel, findNext, findPrevious, getSearchQuery, openSearchPanel, replaceAll, replaceNext,
  searchPanelOpen, setSearchQuery,
} from '@codemirror/search';
import { FindMatch, collectMatches, currentMatchIndex, matchIndexFrom } from '../../shared/codemirror/find-matches';
import { FindOptions } from '../models/find.model';

/**
 * Find / replace in the open note. CodeMirror's search state stays the source of truth (query, highlights, open
 * panel): this service drives it and mirrors what the find panel of the right column displays.
 */
@Injectable({ providedIn: 'root' })
export class FindService {
  private view: EditorView | null = null;
  private readonly _isOpen = signal(false);
  private readonly _replaceVisible = signal(false);
  private readonly _readOnly = signal(false);
  private readonly _options = signal<FindOptions>({ search: '', replace: '', caseSensitive: false, wholeWord: false, regexp: false });
  private readonly _matches = signal<FindMatch[]>([]);
  private readonly _currentIndex = signal(-1);
  private readonly _focusRequest = signal(0);

  readonly isOpen = this._isOpen.asReadonly();
  readonly replaceVisible = computed(() => this._replaceVisible() && !this._readOnly());
  readonly canReplace = computed(() => !this._readOnly());
  readonly options = this._options.asReadonly();
  readonly matches = this._matches.asReadonly();
  readonly currentIndex = this._currentIndex.asReadonly();
  /** Incremented each time the search field must take the focus (opening, Ctrl+F while open…). */
  readonly focusRequest = this._focusRequest.asReadonly();
  readonly invalidRegexp = computed(() => {
    const options = this._options();
    return options.regexp && options.search !== '' && !new SearchQuery(options).valid;
  });

  /** Called by the editor each time it creates (or drops, with null) its CodeMirror view. */
  attach(view: EditorView | null, readOnly = false): void {
    this.view = view;
    this._readOnly.set(readOnly);

    if (view) {
      // A note opened while the panel is shown keeps searching for the same text
      if (this._isOpen()) {
        this.openPanel(view);
      }
      this.sync(view.state, true);
    } else {
      this._matches.set([]);
      this._currentIndex.set(-1);
    }
  }

  /** Called on every editor update: Escape in the editor closes CodeMirror's panel, an edit moves the matches. */
  refresh(update: ViewUpdate): void {
    const queryChanged = update.transactions.some(tr => tr.effects.some(effect => effect.is(setSearchQuery)));
    this.sync(update.state, update.docChanged || queryChanged);
  }

  /** Opens the panel (Ctrl+F: find only, Ctrl+H: with replace), searching for the selected text if any. */
  open(withReplace: boolean): void {
    const view = this.view;

    if (!view) {
      return;
    }

    this._replaceVisible.set(withReplace);
    const selection = view.state.selection.main;
    const selected = view.state.sliceDoc(selection.from, selection.to);

    // A selection spanning lines is not a search term (VS Code does the same)
    if (selected && !selected.includes('\n')) {
      this._options.update(options => ({ ...options, search: selected }));
    }

    this._isOpen.set(true);
    this.openPanel(view);
    this._focusRequest.update(count => count + 1);
  }

  /** Closes the panel; the editor gets the focus back when `focusEditor` (the panel had it). */
  close(focusEditor = false): void {
    this._isOpen.set(false);

    if (this.view) {
      closeSearchPanel(this.view);

      if (focusEditor) {
        this.view.focus();
      }
    }
  }

  toggleReplace(): void {
    this._replaceVisible.update(visible => !visible);
  }

  /** Changes the query; a new search text selects the first match after the caret, like VS Code's incremental search. */
  setOptions(patch: Partial<FindOptions>): void {
    const view = this.view;
    const searchChanged = patch.search !== undefined && patch.search !== this._options().search;
    this._options.update(options => ({ ...options, ...patch }));

    if (!view) {
      return;
    }

    view.dispatch({ effects: setSearchQuery.of(new SearchQuery(this._options())) });

    const matches = this._matches();
    const reselect = searchChanged || patch.caseSensitive !== undefined || patch.wholeWord !== undefined || patch.regexp !== undefined;

    if (reselect && matches.length > 0) {
      this.goTo(matchIndexFrom(matches, view.state.selection.main.from));
    }
  }

  next(): void {
    this.run(findNext);
  }

  previous(): void {
    this.run(findPrevious);
  }

  replace(): void {
    if (this.canReplace()) {
      this.run(replaceNext);
    }
  }

  replaceAll(): void {
    if (this.canReplace()) {
      this.run(replaceAll);
    }
  }

  /** Selects a match and scrolls to it, without taking the focus from the panel. */
  goTo(index: number): void {
    const match = this._matches()[index];

    if (this.view && match) {
      this.view.dispatch({ selection: EditorSelection.single(match.from, match.to), scrollIntoView: true });
    }
  }

  /** CodeMirror's panel first (it would set its own default query), then the query of the find panel. */
  private openPanel(view: EditorView): void {
    openSearchPanel(view);
    view.dispatch({ effects: setSearchQuery.of(new SearchQuery(this._options())) });
  }

  private run(command: (view: EditorView) => boolean): void {
    if (this.view && getSearchQuery(this.view.state).valid) {
      command(this.view);
    }
  }

  private sync(state: EditorState, recompute: boolean): void {
    // Escape in the editor (CodeMirror's keymap) closes the search: the panel follows
    if (this._isOpen() && !searchPanelOpen(state)) {
      this._isOpen.set(false);
    }

    if (recompute) {
      this._matches.set(this._isOpen() ? collectMatches(state, getSearchQuery(state)) : []);
    }

    this._currentIndex.set(currentMatchIndex(this._matches(), state.selection));
  }
}
