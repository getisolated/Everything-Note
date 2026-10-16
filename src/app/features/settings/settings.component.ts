import { ChangeDetectionStrategy, Component, ElementRef, ViewChild, computed, effect, inject, signal } from '@angular/core';
import { SettingsService } from '../../core/services/settings.service';
import { APP_SHORTCUTS, findShortcutConflict } from '../../core/models/app-shortcuts.model';
import { DEFAULT_SETTINGS, SettingsPatch } from '../../core/models/settings.model';
import { formatAccelerator, keyEventToAccelerator } from '../../core/utils/accelerator.util';
import { CheckboxComponent } from '../../shared/ui/checkbox.component';
import { SelectComponent } from '../../shared/ui/select.component';
import { SETTING_DEFINITIONS, SettingDefinition, filterSettings, groupByCategory } from './settings-definitions';

@Component({
  selector: 'app-settings',
  standalone: true,
  imports: [CheckboxComponent, SelectComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (isOpen()) {
      <div class="backdrop" (mousedown)="close()">
        <div class="modal" role="dialog" aria-label="Settings" (mousedown)="$event.stopPropagation()">
          <div class="header">
            <div class="title-row">
              <span class="title">Settings</span>
              <button class="icon-btn" (click)="close()" title="Close (Esc)">✕</button>
            </div>
            <div class="search">
              <input
                #search
                type="text"
                placeholder="Search settings"
                spellcheck="false"
                [value]="query()"
                (input)="query.set(search.value)"
              />
              <span class="count">{{ countLabel() }}</span>
            </div>
          </div>

          <div class="body">
            <nav class="toc">
              @for (section of sections(); track section.category) {
                <button
                  class="toc-item"
                  [class.active]="section.category === activeCategory()"
                  (click)="scrollToCategory(section.category)"
                >{{ section.category }}</button>
              }
            </nav>

            <div class="list" #list (scroll)="onListScroll()">
              @for (section of sections(); track section.category) {
                <section [attr.data-category]="section.category">
                  <h2>{{ section.category }}</h2>
                  @for (def of section.settings; track def.key) {
                    <div class="setting" [class.modified]="isModified(def)">
                      <div class="setting-title">
                        <span class="category">{{ section.category }}: </span><b>{{ def.title }}</b>
                        @if (isModified(def)) {
                          <button class="reset" (click)="reset(def)" title="Reset to default">↺</button>
                        }
                      </div>

                      @switch (def.control) {
                        @case ('checkbox') {
                          <app-checkbox [checked]="valueOf(def) === true" (checkedChange)="onCheckboxChange(def, $event)">
                            <span class="description">{{ def.description }}</span>
                          </app-checkbox>
                        }
                        @case ('number') {
                          <div class="description">{{ def.description }}</div>
                          <input
                            class="control"
                            type="number"
                            [min]="def.min ?? null"
                            [max]="def.max ?? null"
                            [step]="def.step ?? 1"
                            [value]="valueOf(def)"
                            (change)="onNumberChange(def, $event)"
                          />
                        }
                        @case ('list') {
                          <div class="description">{{ def.description }}</div>
                          <input
                            class="control list"
                            type="text"
                            spellcheck="false"
                            [value]="listValueOf(def)"
                            (change)="onListChange(def, $event)"
                          />
                        }
                        @case ('select') {
                          <div class="description">{{ def.description }}</div>
                          <app-select [value]="stringValueOf(def)" [options]="def.options ?? []" (valueChange)="onSelectChange(def, $event)" />
                        }
                        @case ('shortcut') {
                          <div class="description">{{ def.description }}</div>
                          <button
                            class="control shortcut"
                            data-shortcut-recorder
                            [class.recording]="recording() === def.key"
                            (click)="startRecording(def)"
                            (keydown)="onShortcutKeydown(def, $event)"
                            (blur)="recording.set(null)"
                          >{{ recording() === def.key ? 'Press the new shortcut… (Esc to cancel)' : shortcutLabel(def) }}</button>
                          @if (shortcutError()?.key === def.key) {
                            <div class="error">{{ shortcutError()?.message }}</div>
                          }
                        }
                      }
                    </div>
                  }
                </section>
              } @empty {
                <div class="empty">No settings found.</div>
              }
            </div>
          </div>
        </div>
      </div>
    }
  `,
  styleUrls: ['./settings.component.scss'],
})
export class SettingsComponent {
  private settingsService = inject(SettingsService);

  @ViewChild('search') searchRef?: ElementRef<HTMLInputElement>;
  @ViewChild('list') listRef?: ElementRef<HTMLElement>;

  readonly isOpen = this.settingsService.isOpen;
  readonly settings = this.settingsService.settings;
  readonly query = signal('');
  /** Key of the shortcut setting waiting for a key combination. */
  readonly recording = signal<string | null>(null);
  readonly shortcutError = signal<{ key: string; message: string } | null>(null);
  readonly sections = computed(() => groupByCategory(filterSettings(SETTING_DEFINITIONS, this.query())));
  private readonly scrolledCategory = signal<string | null>(null);
  // Falls back to the first visible section when the scrolled one has been filtered out
  readonly activeCategory = computed(() => {
    const categories = this.sections().map(s => s.category);
    const scrolled = this.scrolledCategory();
    return scrolled && categories.includes(scrolled) ? scrolled : categories[0] ?? null;
  });
  readonly countLabel = computed(() => {
    if (!this.query().trim()) return '';
    const count = this.sections().reduce((total, s) => total + s.settings.length, 0);
    return `${count} setting${count === 1 ? '' : 's'} found`;
  });

  constructor() {
    effect(() => {
      if (!this.isOpen()) return;
      // Fresh state on every opening, search focused like VS Code
      this.query.set('');
      this.scrolledCategory.set(null);
      this.shortcutError.set(null);
      setTimeout(() => this.searchRef?.nativeElement.focus());
    });
  }

  close(): void { this.settingsService.close(); }

  valueOf(def: SettingDefinition): unknown {
    return (this.settings() as unknown as Record<string, unknown>)[def.key];
  }

  stringValueOf(def: SettingDefinition): string {
    return String(this.valueOf(def));
  }

  /** A list setting is edited as comma-separated text. */
  listValueOf(def: SettingDefinition): string {
    const value = this.valueOf(def);
    return Array.isArray(value) ? value.join(', ') : '';
  }

  shortcutLabel(def: SettingDefinition): string {
    const accelerator = def.shortcutId ? this.settingsService.appShortcuts()[def.shortcutId] : this.settings().globalShortcut;
    return formatAccelerator(accelerator ?? '');
  }

  isModified(def: SettingDefinition): boolean {
    if (def.shortcutId) {
      return def.shortcutId in this.settings().appShortcuts;
    }
    const value = this.valueOf(def);
    const defaultValue = (DEFAULT_SETTINGS as unknown as Record<string, unknown>)[def.key];
    // Lists are compared by content: a saved copy is never the same array as the default one
    if (Array.isArray(value) && Array.isArray(defaultValue)) {
      return value.join('\n') !== defaultValue.join('\n');
    }
    return value !== defaultValue;
  }

  async reset(def: SettingDefinition): Promise<void> {
    if (def.shortcutId) {
      await this.setAppShortcut(def.shortcutId, null);
      return;
    }
    await this.save(def, (DEFAULT_SETTINGS as unknown as Record<string, unknown>)[def.key]);
  }

  scrollToCategory(category: string): void {
    const section = this.listRef?.nativeElement.querySelector(`[data-category="${CSS.escape(category)}"]`);
    section?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    this.scrolledCategory.set(category);
  }

  onListScroll(): void {
    const list = this.listRef?.nativeElement;
    if (!list) return;
    // Active section = last one whose top has reached the top of the list
    let current: string | null = null;
    for (const section of Array.from(list.querySelectorAll<HTMLElement>('section'))) {
      if (section.offsetTop - list.offsetTop <= list.scrollTop + 8) current = section.dataset['category'] ?? null;
    }
    this.scrolledCategory.set(current);
  }

  async onCheckboxChange(def: SettingDefinition, checked: boolean): Promise<void> {
    await this.save(def, checked);
  }

  async onNumberChange(def: SettingDefinition, event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const value = Number(input.value);
    if (input.value !== '' && Number.isFinite(value)) await this.save(def, value);
    // Re-sync with the value actually applied (the main process clamps to its bounds)
    input.value = String(this.valueOf(def));
  }

  async onListChange(def: SettingDefinition, event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    await this.save(def, input.value.split(',').map(item => item.trim()).filter(Boolean));
    // Re-sync with the list actually applied (the main process drops invalid names and duplicates)
    input.value = this.listValueOf(def);
  }

  async onSelectChange(def: SettingDefinition, value: string): Promise<void> {
    await this.save(def, value);
  }

  startRecording(def: SettingDefinition): void {
    this.shortcutError.set(null);
    this.recording.set(def.key);
  }

  async onShortcutKeydown(def: SettingDefinition, event: KeyboardEvent): Promise<void> {
    if (this.recording() !== def.key) return;
    event.preventDefault();
    event.stopPropagation();

    if (event.key === 'Escape') {
      this.recording.set(null);
      return;
    }

    const accelerator = keyEventToAccelerator(event);
    if (!accelerator) return;
    this.recording.set(null);

    if (def.shortcutId) {
      const conflict = findShortcutConflict(def.shortcutId, accelerator, this.settingsService.appShortcuts());
      if (conflict) {
        this.shortcutError.set({ key: def.key, message: `${formatAccelerator(accelerator)} is already used by "${conflict.label}".` });
        return;
      }
      await this.setAppShortcut(def.shortcutId, accelerator);
      return;
    }

    const result = await this.settingsService.update({ globalShortcut: accelerator });
    if (result && !result.ok) {
      this.shortcutError.set({ key: def.key, message: `${formatAccelerator(accelerator)} is unavailable (already used by another application?).` });
    }
  }

  /** Stores an override, or drops it (null / same as the default) so the default keeps applying. */
  private async setAppShortcut(id: string, accelerator: string | null): Promise<void> {
    const overrides = { ...this.settings().appShortcuts };
    const defaultAccelerator = APP_SHORTCUTS.find(shortcut => shortcut.id === id)?.defaultAccelerator;
    if (accelerator === null || accelerator === defaultAccelerator) {
      delete overrides[id];
    } else {
      overrides[id] = accelerator;
    }
    await this.settingsService.update({ appShortcuts: overrides });
  }

  private async save(def: SettingDefinition, value: unknown): Promise<void> {
    // The main process validates every value (type, bounds) before applying it
    await this.settingsService.update({ [def.key]: value } as SettingsPatch);
  }
}
