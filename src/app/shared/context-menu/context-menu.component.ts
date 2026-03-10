import {
  Component, Input, Output, EventEmitter, HostListener,
  ChangeDetectionStrategy, signal, ElementRef, inject, OnInit, OnDestroy
} from '@angular/core';
import { CommonModule } from '@angular/common';

export interface ContextMenuItem {
  id: string;
  label: string;
  icon?: string;       // SVG path string (24x24 viewBox)
  shortcut?: string;
  disabled?: boolean;
  danger?: boolean;
  children?: ContextMenuItem[];
}

export interface ContextMenuDivider {
  divider: true;
}

export type ContextMenuEntry = ContextMenuItem | ContextMenuDivider;

export function isDivider(entry: ContextMenuEntry): entry is ContextMenuDivider {
  return 'divider' in entry;
}

@Component({
  selector: 'app-context-menu',
  standalone: true,
  imports: [CommonModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div
      class="ctx-backdrop"
      (click)="closed.emit()"
      (contextmenu)="$event.preventDefault(); closed.emit()"
    ></div>
    <div
      class="ctx-menu"
      [style.left.px]="posX()"
      [style.top.px]="posY()"
      role="menu"
    >
      @for (entry of items; track $index) {
        @if (isDivider(entry)) {
          <div class="ctx-divider"></div>
        } @else {
          <button
            class="ctx-item"
            [class.danger]="entry.danger"
            [class.disabled]="entry.disabled"
            [class.has-children]="entry.children?.length"
            role="menuitem"
            (click)="onItemClick($event, entry)"
            (mouseenter)="onItemEnter($index)"
            (mouseleave)="onItemLeave()"
          >
            @if (entry.icon) {
              <svg class="ctx-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path [attr.d]="entry.icon"/>
              </svg>
            } @else {
              <span class="ctx-icon-spacer"></span>
            }
            <span class="ctx-label">{{ entry.label }}</span>
            @if (entry.shortcut) {
              <kbd class="ctx-shortcut">{{ entry.shortcut }}</kbd>
            }
            @if (entry.children?.length) {
              <svg class="ctx-chevron" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <polyline points="9 18 15 12 9 6"/>
              </svg>
            }

            @if (entry.children?.length && activeSubmenu() === $index) {
              <div class="ctx-submenu" role="menu">
                @for (child of entry.children; track child.id) {
                  <button
                    class="ctx-item"
                    [class.danger]="child.danger"
                    [class.disabled]="child.disabled"
                    role="menuitem"
                    (click)="onItemClick($event, child)"
                  >
                    @if (child.icon) {
                      <svg class="ctx-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                        <path [attr.d]="child.icon"/>
                      </svg>
                    } @else {
                      <span class="ctx-icon-spacer"></span>
                    }
                    <span class="ctx-label">{{ child.label }}</span>
                    @if (child.shortcut) {
                      <kbd class="ctx-shortcut">{{ child.shortcut }}</kbd>
                    }
                  </button>
                }
              </div>
            }
          </button>
        }
      }
    </div>
  `,
  styleUrls: ['./context-menu.component.scss'],
})
export class ContextMenuComponent implements OnInit, OnDestroy {
  @Input() items: ContextMenuEntry[] = [];
  @Input() x = 0;
  @Input() y = 0;
  @Output() closed = new EventEmitter<void>();
  @Output() action = new EventEmitter<string>();

  private el = inject(ElementRef);
  private submenuTimeout: ReturnType<typeof setTimeout> | null = null;

  readonly posX = signal(0);
  readonly posY = signal(0);
  readonly activeSubmenu = signal<number | null>(null);

  readonly isDivider = isDivider;

  ngOnInit(): void {
    // Clamp position so menu stays within viewport
    requestAnimationFrame(() => {
      const menu = this.el.nativeElement.querySelector('.ctx-menu') as HTMLElement;
      if (!menu) return;
      const rect = menu.getBoundingClientRect();
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      this.posX.set(this.x + rect.width > vw ? Math.max(0, vw - rect.width - 4) : this.x);
      this.posY.set(this.y + rect.height > vh ? Math.max(0, vh - rect.height - 4) : this.y);
    });
    this.posX.set(this.x);
    this.posY.set(this.y);
  }

  @HostListener('document:keydown.escape')
  onEscape(): void {
    this.closed.emit();
  }

  onItemClick(event: MouseEvent, item: ContextMenuItem): void {
    event.stopPropagation();
    if (item.disabled) return;
    if (item.children?.length) return; // parent items don't fire
    this.action.emit(item.id);
    this.closed.emit();
  }

  onItemEnter(index: number): void {
    if (this.submenuTimeout) { clearTimeout(this.submenuTimeout); this.submenuTimeout = null; }
    this.activeSubmenu.set(index);
  }

  onItemLeave(): void {
    if (this.submenuTimeout) clearTimeout(this.submenuTimeout);
    this.submenuTimeout = setTimeout(() => this.activeSubmenu.set(null), 150);
  }

  ngOnDestroy(): void {
    if (this.submenuTimeout) clearTimeout(this.submenuTimeout);
  }
}
