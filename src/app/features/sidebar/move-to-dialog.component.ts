import { ChangeDetectionStrategy, Component, computed, input, output, signal } from '@angular/core';
import { FolderOption } from '../../core/models/folder.model';
import { FocusSelectDirective } from '../../shared/ui/focus-select.directive';

/** "Move to…" destination picker of the sidebar: the folder tree, filterable, the root first. */
@Component({
  selector: 'app-move-to-dialog',
  standalone: true,
  imports: [FocusSelectDirective],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    '(document:keydown.escape)': 'closed.emit()',
  },
  template: `
    <div class="backdrop" (click)="closed.emit()"></div>
    <div class="dialog" role="dialog" aria-modal="true" [attr.aria-label]="title()">
      <h2 class="title">{{ title() }}</h2>
      <input
        class="filter"
        appFocusSelect
        placeholder="Filter folders"
        spellcheck="false"
        [value]="query()"
        (input)="query.set($any($event.target).value)"
        (keydown.enter)="chooseFirst()"
      />
      <div class="options">
        @for (option of filtered(); track option.id) {
          <button
            type="button"
            class="option"
            [disabled]="option.disabled"
            [style.padding-left.px]="10 + (query() ? 0 : option.depth * 14)"
            (click)="chosen.emit(option.id)"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
              @if (option.id === null) {
                <rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/>
              } @else {
                <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>
              }
            </svg>
            <span class="option-label">{{ option.label }}</span>
          </button>
        } @empty {
          <div class="empty">No folder matches</div>
        }
      </div>
      <div class="actions">
        <button type="button" class="btn" (click)="closed.emit()">Cancel</button>
      </div>
    </div>
  `,
  styleUrls: ['./move-to-dialog.component.scss'],
})
export class MoveToDialogComponent {
  readonly title = input.required<string>();
  readonly options = input.required<FolderOption[]>();
  /** The destination: a folder id, `null` for the root. */
  readonly chosen = output<number | null>();
  readonly closed = output<void>();

  protected readonly query = signal('');

  protected readonly filtered = computed(() => {
    const needle = this.query().trim().toLowerCase();
    return needle ? this.options().filter(option => option.label.toLowerCase().includes(needle)) : this.options();
  });

  protected chooseFirst(): void {
    const first = this.filtered().find(option => !option.disabled);

    if (first) {
      this.chosen.emit(first.id);
    }
  }
}
