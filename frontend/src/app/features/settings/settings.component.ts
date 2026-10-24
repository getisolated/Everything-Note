import { ChangeDetectionStrategy, Component, ElementRef, ViewChild, computed, effect, inject, signal } from '@angular/core';
import { I18nService } from '../../core/i18n/i18n.service';
import { SettingsService } from '../../core/services/settings.service';
import { APP_SHORTCUTS, defaultAcceleratorFor, findShortcutConflict, shortcutLabel } from '../../core/models/app-shortcuts.model';
import { DEFAULT_SETTINGS, SettingsPatch } from '../../core/models/settings.model';
import { appVersion } from '../../core/services/desktop-api';
import { Translator } from '../../core/i18n/translate';
import { PlatformService } from '../../core/services/platform.service';
import { formatAccelerator, isReservedAccelerator, keyEventToAccelerator, physicalKeyOf } from '../../core/utils/accelerator.util';
import { CheckboxComponent } from '../../shared/ui/checkbox.component';
import { SelectComponent } from '../../shared/ui/select.component';
import { DaftrLogotypeComponent } from '../../shared/ui/brand.component';
import { McpSettingsComponent } from './mcp-settings.component';
import {
  SETTING_DEFINITIONS, SettingDefinition, definitionsForPlatform, filterSettings, groupByCategory, settingDescription, settingOptions, settingTitle,
} from './settings-definitions';

@Component({
  selector: 'app-settings',
  standalone: true,
  imports: [CheckboxComponent, SelectComponent, DaftrLogotypeComponent, McpSettingsComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (isOpen()) {
      <div class="backdrop" (mousedown)="close()">
        <div class="modal" role="dialog" [attr.aria-label]="i18n.t('settings.modal.title')" (mousedown)="$event.stopPropagation()">
          <div class="header">
            <div class="title-row">
              <span class="title">{{ i18n.t('settings.modal.title') }}</span>
              <button class="icon-btn" (click)="close()" [title]="i18n.t('settings.modal.close')">✕</button>
            </div>
            <div class="search">
              <input
                #search
                type="text"
                [placeholder]="i18n.t('settings.modal.search')"
                spellcheck="false"
                [value]="query()"
                (input)="query.set(search.value)"
              />
              <span class="count">{{ countLabel() }}</span>
            </div>
          </div>

          <div class="body">
            <nav class="toc">
              <div class="toc-items">
                @for (section of sections(); track section.categoryKey) {
                  <button
                    class="toc-item"
                    [class.active]="section.categoryKey === activeCategory()"
                    (click)="scrollToCategory(section.categoryKey)"
                  >{{ section.category }}</button>
                }
              </div>
              <div class="brand">
                <app-daftr-logotype [width]="104" />
                @if (version(); as version) {
                  <span class="version">v{{ version }}</span>
                }
              </div>
            </nav>

            <div class="list" #list (scroll)="onListScroll()">
              @for (section of sections(); track section.categoryKey) {
                <section [attr.data-category]="section.categoryKey">
                  <h2>{{ section.category }}</h2>
                  @for (def of section.settings; track def.key) {
                    <div class="setting" [class.modified]="isModified(def)">
                      <div class="setting-title">
                        <span class="category">{{ section.category }}: </span><b>{{ titleOf(def) }}</b>
                        @if (isModified(def)) {
                          <button class="reset" (click)="reset(def)" [title]="i18n.t('settings.modal.reset')">↺</button>
                        }
                      </div>

                      @switch (def.control) {
                        @case ('checkbox') {
                          <app-checkbox [checked]="valueOf(def) === true" (checkedChange)="onCheckboxChange(def, $event)">
                            <span class="description">{{ descriptionOf(def) }}</span>
                          </app-checkbox>
                        }
                        @case ('number') {
                          <div class="description">{{ descriptionOf(def) }}</div>
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
                          <div class="description">{{ descriptionOf(def) }}</div>
                          <input
                            class="control list"
                            type="text"
                            spellcheck="false"
                            [value]="listValueOf(def)"
                            (change)="onListChange(def, $event)"
                          />
                        }
                        @case ('select') {
                          <div class="description">{{ descriptionOf(def) }}</div>
                          <app-select [value]="stringValueOf(def)" [options]="optionsOf(def)" (valueChange)="onSelectChange(def, $event)" />
                        }
                        @case ('shortcut') {
                          <div class="description">{{ descriptionOf(def) }}</div>
                          <button
                            class="control shortcut"
                            data-shortcut-recorder
                            [class.recording]="recording() === def.key"
                            (click)="startRecording(def, $event)"
                            (keydown)="onShortcutKeydown(def, $event)"
                            (blur)="recording.set(null)"
                          >{{ recording() === def.key ? i18n.t('settings.modal.recording') : shortcutLabel(def) }}</button>
                          @if (shortcutError()?.key === def.key) {
                            <div class="error">{{ shortcutError()?.message }}</div>
                          }
                        }
                        @case ('mcpToken') {
                          <div class="description">{{ descriptionOf(def) }}</div>
                          <app-mcp-settings part="token" />
                        }
                        @case ('mcpConnection') {
                          <div class="description">{{ descriptionOf(def) }}</div>
                          <app-mcp-settings part="connection" />
                        }
                      }
                    </div>
                  }
                </section>
              } @empty {
                <div class="empty">{{ i18n.t('settings.modal.empty') }}</div>
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
  protected readonly i18n = inject(I18nService);
  private readonly platform = inject(PlatformService).platform;
  /** Settings that apply to this platform: the only ones shown, searched and counted. */
  private readonly definitions = definitionsForPlatform(SETTING_DEFINITIONS, this.platform);

  @ViewChild('search') searchRef?: ElementRef<HTMLInputElement>;
  @ViewChild('list') listRef?: ElementRef<HTMLElement>;

  readonly isOpen = this.settingsService.isOpen;
  readonly settings = this.settingsService.settings;
  readonly query = signal('');
  /** Key of the shortcut setting waiting for a key combination. */
  readonly recording = signal<string | null>(null);
  readonly shortcutError = signal<{ key: string; message: string } | null>(null);
  /** Version shown under the logotype; null until known, or outside the desktop app. */
  readonly version = signal<string | null>(null);
  /** Translator that also fills `{shortcut}` with the platform's send shortcut (descriptions such as enterToSend). */
  private readonly tx: Translator = (key, params) => this.i18n.t(key, { shortcut: formatAccelerator('CommandOrControl+Return', this.platform), ...params });
  readonly sections = computed(() => groupByCategory(filterSettings(this.definitions, this.query(), this.tx), this.i18n.t));
  private readonly scrolledCategory = signal<string | null>(null);
  // Falls back to the first visible section when the scrolled one has been filtered out
  readonly activeCategory = computed(() => {
    const categories = this.sections().map(s => s.categoryKey);
    const scrolled = this.scrolledCategory();
    return scrolled && categories.some(key => key === scrolled) ? scrolled : categories[0] ?? null;
  });
  readonly countLabel = computed(() => {
    if (!this.query().trim()) return '';
    const count = this.sections().reduce((total, s) => total + s.settings.length, 0);
    return this.i18n.plural('settings.modal.count', count);
  });

  constructor() {
    void appVersion().then(version => this.version.set(version));
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

  titleOf(def: SettingDefinition): string { return settingTitle(def, this.i18n.t); }

  descriptionOf(def: SettingDefinition): string { return settingDescription(def, this.tx); }

  optionsOf(def: SettingDefinition): { value: string; label: string }[] { return settingOptions(def, this.i18n.t); }

  shortcutLabel(def: SettingDefinition): string {
    const accelerator = def.shortcutId ? this.settingsService.appShortcuts()[def.shortcutId] : this.settings().globalShortcut;
    return formatAccelerator(accelerator ?? '', this.platform);
  }

  isModified(def: SettingDefinition): boolean {
    if (def.fixed) {
      return false;
    }
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

  startRecording(def: SettingDefinition, event: Event): void {
    this.shortcutError.set(null);
    this.recording.set(def.key);
    // WebKit (macOS) does not focus a clicked button: without focus, keydown never reaches the recorder
    // and Escape closes the settings. Focusing after the mousedown cannot trigger the (blur) that cancels.
    if (event.currentTarget instanceof HTMLElement) event.currentTarget.focus();
  }

  async onShortcutKeydown(def: SettingDefinition, event: KeyboardEvent): Promise<void> {
    if (this.recording() !== def.key) return;
    event.preventDefault();
    event.stopPropagation();

    if (event.key === 'Escape') {
      this.recording.set(null);
      return;
    }

    // On macOS ⌘ is recorded as CommandOrControl (⌘ in the global shortcut too) and ⌃ as Control
    const accelerator = keyEventToAccelerator(event, { platform: this.platform });
    if (!accelerator) return;
    this.recording.set(null);
    const shortcut = formatAccelerator(accelerator, this.platform);

    // Kept by the system (⌘Q, ⌘H, ⌘M, ⌘Tab, ⌘Space… on macOS): the app would never receive it
    if (isReservedAccelerator(accelerator, this.platform)) {
      this.shortcutError.set({ key: def.key, message: this.i18n.t('settings.modal.shortcutReserved', { shortcut }) });
      return;
    }

    if (def.shortcutId) {
      const conflict = findShortcutConflict(def.shortcutId, accelerator, this.settingsService.appShortcuts());
      if (conflict) {
        this.shortcutError.set({ key: def.key, message: this.i18n.t('settings.modal.shortcutConflict', { shortcut, label: shortcutLabel(conflict, this.i18n.t) }) });
        return;
      }
      await this.setAppShortcut(def.shortcutId, accelerator);
      return;
    }

    // The physical key lets macOS register the key that carries this letter in the current layout
    const result = await this.settingsService.update({ globalShortcut: accelerator, globalShortcutPhysicalKey: physicalKeyOf(event) });
    if (result && !result.ok) {
      this.shortcutError.set({ key: def.key, message: this.i18n.t('settings.modal.shortcutUnavailable', { shortcut }) });
    }
  }

  /** Stores an override, or drops it (null / same as the default) so the default keeps applying. */
  private async setAppShortcut(id: string, accelerator: string | null): Promise<void> {
    const overrides = { ...this.settings().appShortcuts };
    const definition = APP_SHORTCUTS.find(shortcut => shortcut.id === id);
    const defaultAccelerator = definition ? defaultAcceleratorFor(definition, this.platform) : undefined;
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
