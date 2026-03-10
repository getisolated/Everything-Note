import {
  Component, inject, ElementRef, ViewChild,
  ChangeDetectionStrategy, HostListener, signal
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { TabsService } from '../../core/services/tabs.service';
import { ElectronBridgeService } from '../../core/services/electron-bridge.service';
import { PaletteService } from '../../core/services/palette.service';
import { LayoutService } from '../../core/services/layout.service';
import { ContextMenuComponent, ContextMenuEntry } from '../../shared/context-menu/context-menu.component';

@Component({
  selector: 'app-tabs-bar',
  standalone: true,
  imports: [CommonModule, ContextMenuComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="tabs-bar" (dblclick)="onTitleBarDblClick()">
      <!-- Home button -->
      <button
        class="home-btn"
        [class.active]="activeIndex() === -1"
        (click)="goHome()"
        (dblclick)="$event.stopPropagation()"
        title="Home"
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>
          <polyline points="9 22 9 12 15 12 15 22"/>
        </svg>
      </button>

      <!-- Window drag region -->
      <div class="drag-region"></div>

      <!-- Tabs -->
      <div class="tabs-container" #tabsContainer>
        @for (tab of tabs(); track tab.noteId; let i = $index) {
          <div
            class="tab"
            [class.active]="i === activeIndex()"
            [class.dirty]="tab.isDirty"
            [class.pinned]="tab.isPinned"
            [class.drag-over-left]="dragOverIndex() === i && dragSide() === 'left'"
            [class.drag-over-right]="dragOverIndex() === i && dragSide() === 'right'"
            [class.dragging]="dragIndex() === i"
            (click)="selectTab(i)"
            (dblclick)="$event.stopPropagation()"
            (mousedown)="onTabMouseDown($event)"
            (auxclick)="onAuxClick($event, i)"
            (contextmenu)="onTabContextMenu($event, i)"
            [title]="tab.title || 'Untitled'"
            draggable="true"
            (dragstart)="onDragStart($event, i)"
            (dragover)="onDragOver($event, i)"
            (dragleave)="onDragLeave()"
            (drop)="onDrop($event, i)"
            (dragend)="onDragEnd()"
          >
            @if (tab.isPinned) {
              <svg class="pin-icon" width="11" height="11" viewBox="0 0 24 24" fill="currentColor" stroke="none">
                <path d="M16 2L7.5 10.5 2 12l3 3-5 7 7-5 3 3 1.5-5.5L20 6l-2-2z"/>
              </svg>
            }
            <span class="tab-title">{{ tab.title || 'Untitled' }}</span>
            @if (tab.isDirty) {
              <span class="dirty-dot" title="Unsaved changes"></span>
            }
            @if (!tab.isPinned) {
              <button
                class="tab-close"
                (click)="closeTab($event, i)"
                tabindex="-1"
                title="Close (Ctrl+W)"
              >×</button>
            }
          </div>
        }
      </div>

      <!-- Search icon -->
      <button class="search-icon-btn" (click)="openSearch()" (dblclick)="$event.stopPropagation()" title="Search notes (Ctrl+Shift+F)">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/>
        </svg>
      </button>

      <!-- Wide mode toggle -->
      <button
        class="search-icon-btn"
        (click)="toggleWideMode()"
        (dblclick)="$event.stopPropagation()"
        [title]="wideMode() ? 'Centered layout (Alt+Z)' : 'Full width layout (Alt+Z)'"
      >
        @if (wideMode()) {
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <polyline points="4 14 10 14 10 20"/>
            <polyline points="20 10 14 10 14 4"/>
            <line x1="14" y1="10" x2="21" y2="3"/>
            <line x1="3" y1="21" x2="10" y2="14"/>
          </svg>
        } @else {
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <polyline points="15 3 21 3 21 9"/>
            <polyline points="9 21 3 21 3 15"/>
            <line x1="21" y1="3" x2="14" y2="10"/>
            <line x1="3" y1="21" x2="10" y2="14"/>
          </svg>
        }
      </button>

      <!-- Window controls -->
      <div class="window-controls">
        <button class="wc-btn minimize" (click)="minimize()" title="Minimize">
          <svg width="10" height="1" viewBox="0 0 10 1"><rect width="10" height="1" fill="currentColor"/></svg>
        </button>
        <button class="wc-btn maximize" (click)="toggleMaximize()" title="Maximize">
          <svg width="10" height="10" viewBox="0 0 10 10"><rect x="0.5" y="0.5" width="9" height="9" fill="none" stroke="currentColor"/></svg>
        </button>
        <button class="wc-btn close" (click)="closeWindow()" title="Close">
          <svg width="10" height="10" viewBox="0 0 10 10">
            <line x1="0" y1="0" x2="10" y2="10" stroke="currentColor" stroke-width="1.2"/>
            <line x1="10" y1="0" x2="0" y2="10" stroke="currentColor" stroke-width="1.2"/>
          </svg>
        </button>
      </div>
    </div>

    @if (ctxMenu()) {
      <app-context-menu
        [items]="ctxMenu()!.items"
        [x]="ctxMenu()!.x"
        [y]="ctxMenu()!.y"
        (action)="onCtxAction($event)"
        (closed)="ctxMenu.set(null)"
      />
    }
  `,
  styleUrls: ['./tabs-bar.component.scss'],
})
export class TabsBarComponent {
  private tabs$ = inject(TabsService);
  private electron = inject(ElectronBridgeService);
  private palette = inject(PaletteService);
  private layout = inject(LayoutService);

  @ViewChild('tabsContainer') tabsContainer!: ElementRef<HTMLElement>;

  readonly wideMode = this.layout.wideMode;

  readonly tabs = this.tabs$.tabs;
  readonly activeIndex = this.tabs$.activeIndex;

  // ── Drag state ─────────────────────────────────────────────────────────────
  readonly dragIndex = signal<number | null>(null);
  readonly dragOverIndex = signal<number | null>(null);
  readonly dragSide = signal<'left' | 'right' | null>(null);

  // ── Context menu state ─────────────────────────────────────────────────────
  readonly ctxMenu = signal<{ items: ContextMenuEntry[]; x: number; y: number; tabIndex: number } | null>(null);

  // ── Navigation ─────────────────────────────────────────────────────────────

  goHome(): void { this.tabs$.goHome(); }
  openSearch(): void { this.palette.open('search'); }
  selectTab(index: number): void { this.tabs$.setActiveIndex(index); }
  toggleWideMode(): void { this.layout.toggle(); }

  closeTab(event: MouseEvent, index: number): void {
    event.stopPropagation();
    this.tabs$.closeTab(index);
  }

  onTabMouseDown(event: MouseEvent): void {
    if (event.button === 1) event.preventDefault();
  }

  onAuxClick(event: MouseEvent, index: number): void {
    if (event.button === 1) this.tabs$.closeTab(index);
  }

  @HostListener('wheel', ['$event'])
  onWheel(event: WheelEvent): void {
    const el = this.tabsContainer?.nativeElement;
    if (el) {
      el.scrollLeft += event.deltaY;
      event.preventDefault();
    }
  }

  minimize(): void { this.electron.minimize(); }
  async toggleMaximize(): Promise<void> { await this.electron.maximize(); }
  closeWindow(): void { this.electron.close(); }
  async onTitleBarDblClick(): Promise<void> { await this.electron.maximize(); }

  // ── Drag and drop ──────────────────────────────────────────────────────────

  onDragStart(event: DragEvent, index: number): void {
    this.dragIndex.set(index);
    if (event.dataTransfer) {
      event.dataTransfer.effectAllowed = 'move';
      event.dataTransfer.setData('text/plain', String(index));
    }
  }

  onDragOver(event: DragEvent, index: number): void {
    if (this.dragIndex() === null) return;
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';

    // Determine which side of the tab we're hovering
    const target = (event.currentTarget as HTMLElement);
    const rect = target.getBoundingClientRect();
    const midX = rect.left + rect.width / 2;
    this.dragSide.set(event.clientX < midX ? 'left' : 'right');
    this.dragOverIndex.set(index);
  }

  onDragLeave(): void {
    this.dragOverIndex.set(null);
    this.dragSide.set(null);
  }

  onDrop(event: DragEvent, toIndex: number): void {
    event.preventDefault();
    const fromIndex = this.dragIndex();
    if (fromIndex === null || fromIndex === toIndex) {
      this.resetDragState();
      return;
    }

    // If dropping on the right side, we want to insert after
    const side = this.dragSide();
    let targetIndex = toIndex;
    if (side === 'right' && fromIndex < toIndex) targetIndex = toIndex;
    else if (side === 'right' && fromIndex > toIndex) targetIndex = toIndex + 1;
    else if (side === 'left' && fromIndex > toIndex) targetIndex = toIndex;
    else if (side === 'left' && fromIndex < toIndex) targetIndex = toIndex - 1;

    this.tabs$.moveTab(fromIndex, Math.max(0, Math.min(targetIndex, this.tabs().length - 1)));
    this.resetDragState();
  }

  onDragEnd(): void {
    this.resetDragState();
  }

  private resetDragState(): void {
    this.dragIndex.set(null);
    this.dragOverIndex.set(null);
    this.dragSide.set(null);
  }

  // ── Context menu ───────────────────────────────────────────────────────────

  onTabContextMenu(event: MouseEvent, index: number): void {
    event.preventDefault();
    event.stopPropagation();

    const tab = this.tabs()[index];
    const pinLabel = tab.isPinned ? 'Unpin Tab' : 'Pin Tab';
    // SVG paths (24x24 viewBox)
    const pinIcon = 'M16 2L7.5 10.5 2 12l3 3-5 7 7-5 3 3 1.5-5.5L20 6l-2-2z';
    const closeIcon = 'M18 6L6 18M6 6l12 12';

    const items: ContextMenuEntry[] = [
      { id: 'pin', label: pinLabel, icon: pinIcon, shortcut: 'Alt+P' },
      { divider: true },
      { id: 'close', label: 'Close Tab', icon: closeIcon, shortcut: 'Ctrl+W', disabled: tab.isPinned },
    ];

    this.ctxMenu.set({ items, x: event.clientX, y: event.clientY, tabIndex: index });
  }

  onCtxAction(actionId: string): void {
    const menu = this.ctxMenu();
    if (!menu) return;
    const index = menu.tabIndex;

    switch (actionId) {
      case 'pin':
        this.tabs$.togglePin(index);
        break;
      case 'close':
        this.tabs$.closeTab(index);
        break;
    }
    this.ctxMenu.set(null);
  }
}
