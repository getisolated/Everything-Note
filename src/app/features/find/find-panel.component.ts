import { ChangeDetectionStrategy, Component, ElementRef, computed, effect, inject, viewChild } from '@angular/core';
import { FindService } from '../../core/services/find.service';
import { MAX_FIND_MATCHES } from '../../shared/codemirror/find-matches';
import { FindOptions } from '../../core/models/find.model';

/** Find / replace panel of the right column (in place of the outline while open), like Word's navigation pane. */
@Component({
  selector: 'app-find-panel',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    role: 'search',
    '[class.read-only]': '!find.canReplace()',
    '(keydown)': 'onKeydown($event)',
  },
  template: `
    <div class="find-fields">
      <div class="find-row">
        @if (find.canReplace()) {
          <button
            type="button"
            class="icon-btn expander"
            [class.expanded]="find.replaceVisible()"
            [attr.aria-expanded]="find.replaceVisible()"
            [title]="find.replaceVisible() ? 'Hide Replace' : 'Show Replace'"
            (click)="find.toggleReplace()"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m9 18 6-6-6-6"/></svg>
          </button>
        }
        <div class="field" [class.invalid]="find.invalidRegexp()">
          <input
            #searchInput
            type="text"
            placeholder="Find"
            aria-label="Find"
            spellcheck="false"
            autocomplete="off"
            [value]="find.options().search"
            (input)="setText('search', $event)"
          />
          <div class="toggles">
            <button type="button" class="icon-btn toggle" title="Match Case (Alt+C)" [class.on]="find.options().caseSensitive" [attr.aria-pressed]="find.options().caseSensitive" (click)="toggle('caseSensitive')">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M2 17 6.5 6 11 17M3.6 13.5h5.8"/><path d="M19 17v-5.5a2.5 2.5 0 0 0-5 0M19 14.5a2.5 2.5 0 1 1-5 0 2.5 2.5 0 0 1 5 0"/></svg>
            </button>
            <button type="button" class="icon-btn toggle" title="Match Whole Word (Alt+W)" [class.on]="find.options().wholeWord" [attr.aria-pressed]="find.options().wholeWord" (click)="toggle('wholeWord')">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 19h18M3 15v2M21 15v2"/><path d="M10 13v-3a2 2 0 0 0-4 0M10 12a2 2 0 1 1-4 0 2 2 0 0 1 4 0M13 6v7M13 11a2 2 0 1 0 4 0 2 2 0 0 0-4 0"/></svg>
            </button>
            <button type="button" class="icon-btn toggle" title="Use Regular Expression (Alt+R)" [class.on]="find.options().regexp" [attr.aria-pressed]="find.options().regexp" (click)="toggle('regexp')">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M17 3v10M12.67 5.5l8.66 5M12.67 10.5l8.66-5"/><circle cx="6" cy="18" r="2.2" fill="currentColor" stroke="none"/></svg>
            </button>
          </div>
        </div>
      </div>

      @if (find.replaceVisible()) {
        <div class="find-row">
          <span class="expander-spacer" aria-hidden="true"></span>
          <div class="field">
            <input
              type="text"
              placeholder="Replace"
              aria-label="Replace"
              spellcheck="false"
              autocomplete="off"
              data-role="replace"
              [value]="find.options().replace"
              (input)="setText('replace', $event)"
            />
          </div>
        </div>
      }
    </div>

    <div class="find-toolbar">
      <span class="count" [class.empty]="noResults()" aria-live="polite">{{ countLabel() }}</span>
      <div class="actions">
        <button type="button" class="icon-btn" title="Previous Match (Shift+Enter)" [disabled]="!hasMatches()" (click)="find.previous()">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 19V5M5 12l7-7 7 7"/></svg>
        </button>
        <button type="button" class="icon-btn" title="Next Match (Enter)" [disabled]="!hasMatches()" (click)="find.next()">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 5v14M19 12l-7 7-7-7"/></svg>
        </button>
        @if (find.replaceVisible()) {
          <span class="divider" aria-hidden="true"></span>
          <button type="button" class="icon-btn" title="Replace (Enter in the replace field)" [disabled]="!hasMatches()" (click)="find.replace()">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M14 4a2 2 0 0 1 2-2M16 10a2 2 0 0 1-2-2M20 2a2 2 0 0 1 2 2M22 8a2 2 0 0 1-2 2M3 7l3 3 3-3M6 10V5a3 3 0 0 1 3-3h1"/><rect x="2" y="14" width="8" height="8" rx="2"/></svg>
          </button>
          <button type="button" class="icon-btn" title="Replace All (Ctrl+Alt+Enter)" [disabled]="!hasMatches()" (click)="find.replaceAll()">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M14 14a2 2 0 0 1 2 2v4a2 2 0 0 1-2 2M14 4a2 2 0 0 1 2-2M16 10a2 2 0 0 1-2-2M20 14a2 2 0 0 1 2 2v4a2 2 0 0 1-2 2M20 2a2 2 0 0 1 2 2M22 8a2 2 0 0 1-2 2M3 7l3 3 3-3M6 10V5a3 3 0 0 1 3-3h1"/><rect x="2" y="14" width="8" height="8" rx="2"/></svg>
          </button>
        }
        <span class="divider" aria-hidden="true"></span>
        <button type="button" class="icon-btn" title="Close (Escape)" (click)="find.close(true)">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18M6 6l12 12"/></svg>
        </button>
      </div>
    </div>

    @if (hasMatches()) {
      <div class="results" role="list" #results>
        @for (match of find.matches(); track match.from; let i = $index) {
          <button
            type="button"
            class="result"
            role="listitem"
            [class.current]="i === find.currentIndex()"
            [attr.data-index]="i"
            (click)="find.goTo(i)"
          >
            <span class="result-line">{{ match.line }}</span>
            <span class="result-text">{{ match.before }}<mark>{{ match.text }}</mark>{{ match.after }}</span>
          </button>
        }
      </div>
    }
  `,
  styleUrls: ['./find-panel.component.scss'],
})
export class FindPanelComponent {
  protected readonly find = inject(FindService);

  private readonly searchInput = viewChild<ElementRef<HTMLInputElement>>('searchInput');
  private readonly results = viewChild<ElementRef<HTMLElement>>('results');

  protected readonly hasMatches = computed(() => this.find.matches().length > 0);
  protected readonly noResults = computed(() => this.find.options().search !== '' && !this.hasMatches());

  protected readonly countLabel = computed(() => {
    const total = this.find.matches().length;

    if (this.find.invalidRegexp()) {
      return 'Invalid expression';
    }

    if (total === 0) {
      return this.find.options().search ? 'No results' : '';
    }

    const totalLabel = total >= MAX_FIND_MATCHES ? `${MAX_FIND_MATCHES}+` : `${total}`;
    const current = this.find.currentIndex();
    return current === -1 ? `${totalLabel} results` : `${current + 1} of ${totalLabel}`;
  });

  constructor() {
    effect(() => {
      this.find.focusRequest();
      const input = this.searchInput()?.nativeElement;
      input?.focus();
      input?.select();
    });

    // The current match stays visible in a long results list
    effect(() => {
      const index = this.find.currentIndex();
      const item = this.results()?.nativeElement.querySelector<HTMLElement>(`[data-index="${index}"]`);
      item?.scrollIntoView({ block: 'nearest' });
    });
  }

  protected setText(key: 'search' | 'replace', event: Event): void {
    const value = (event.target as HTMLInputElement).value;
    this.find.setOptions({ [key]: value });
  }

  protected toggle(key: keyof Pick<FindOptions, 'caseSensitive' | 'wholeWord' | 'regexp'>): void {
    this.find.setOptions({ [key]: !this.find.options()[key] });
  }

  protected onKeydown(event: KeyboardEvent): void {
    const inReplace = event.target instanceof HTMLElement && event.target.dataset['role'] === 'replace';

    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      this.find.close(true);
      return;
    }

    if (event.key === 'Enter') {
      event.preventDefault();
      this.runEnter(event, inReplace);
      return;
    }

    // VS Code's option toggles
    const toggles: Record<string, keyof Pick<FindOptions, 'caseSensitive' | 'wholeWord' | 'regexp'>> = { c: 'caseSensitive', w: 'wholeWord', r: 'regexp' };
    const toggleKey = toggles[event.key.toLowerCase()];

    if (event.altKey && !event.ctrlKey && toggleKey) {
      event.preventDefault();
      this.toggle(toggleKey);
    }
  }

  private runEnter(event: KeyboardEvent, inReplace: boolean): void {
    if (inReplace && event.ctrlKey && event.altKey) {
      this.find.replaceAll();
    } else if (inReplace) {
      this.find.replace();
    } else if (event.shiftKey) {
      this.find.previous();
    } else {
      this.find.next();
    }
  }
}
