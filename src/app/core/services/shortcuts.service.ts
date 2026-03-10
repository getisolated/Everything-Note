import { Injectable, OnDestroy, NgZone, inject } from '@angular/core';

type ShortcutHandler = (event: KeyboardEvent) => void;

interface ShortcutDef {
  key: string;
  ctrl?: boolean;
  shift?: boolean;
  alt?: boolean;
  handler: ShortcutHandler;
  preventDefault?: boolean;
}

@Injectable({ providedIn: 'root' })
export class ShortcutsService implements OnDestroy {
  private zone = inject(NgZone);
  private shortcuts: ShortcutDef[] = [];
  private boundListener: (e: KeyboardEvent) => void;

  constructor() {
    this.boundListener = this.handleKeydown.bind(this);
    window.addEventListener('keydown', this.boundListener, true);
  }

  register(def: ShortcutDef): () => void {
    this.shortcuts.push(def);
    return () => {
      this.shortcuts = this.shortcuts.filter(s => s !== def);
    };
  }

  private handleKeydown(event: KeyboardEvent): void {
    for (const shortcut of this.shortcuts) {
      const keyMatch = event.key.toLowerCase() === shortcut.key.toLowerCase() ||
                       event.code.toLowerCase() === shortcut.key.toLowerCase();
      const ctrlMatch = !!shortcut.ctrl === (event.ctrlKey || event.metaKey);
      const shiftMatch = !!shortcut.shift === event.shiftKey;
      const altMatch = !!shortcut.alt === event.altKey;

      if (keyMatch && ctrlMatch && shiftMatch && altMatch) {
        if (shortcut.preventDefault !== false) event.preventDefault();
        this.zone.run(() => shortcut.handler(event));
        break;
      }
    }
  }

  ngOnDestroy(): void {
    window.removeEventListener('keydown', this.boundListener, true);
  }
}
