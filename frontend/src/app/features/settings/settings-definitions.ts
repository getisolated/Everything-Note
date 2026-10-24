import { LANGUAGES } from '../../core/i18n/language.model';
import { TranslationParams, Translator } from '../../core/i18n/translate';
import { TranslationKey } from '../../core/i18n/translations';
import { APP_SHORTCUTS } from '../../core/models/app-shortcuts.model';
import { THEMES, ThemeKind } from '../../core/models/theme.model';
import type { Platform } from '../../core/services/platform.service';

export type SettingControl = 'checkbox' | 'number' | 'select' | 'shortcut' | 'list' | 'mcpToken' | 'mcpConnection';

/** Option of a select setting: a translated `labelKey`, or a literal `label` that is never translated (a language named in itself). */
export interface SettingOption {
  value: string;
  labelKey?: TranslationKey;
  label?: string;
}

export interface SettingDefinition {
  /** AppSettings key, or `shortcut:<id>` for a rebindable in-app shortcut. */
  key: string;
  /** Set for in-app shortcuts: the APP_SHORTCUTS id this entry rebinds. */
  shortcutId?: string;
  categoryKey: TranslationKey;
  titleKey: TranslationKey;
  titleParams?: TranslationParams;
  descriptionKey: TranslationKey;
  control: SettingControl;
  min?: number;
  max?: number;
  step?: number;
  options?: SettingOption[];
  /** Platforms where the setting applies; absent = every platform. */
  platforms?: Platform[];
  /** Shown but never reset from here: the value belongs to the main process, or the entry has no value of its own. */
  fixed?: boolean;
  /** Informational entry: its key is not an AppSettings key. */
  panel?: boolean;
}

export interface SettingsSection {
  /** Translation key of the category: stable whatever the language, it identifies the section. */
  categoryKey: TranslationKey;
  /** Translated name of the category. */
  category: string;
  settings: SettingDefinition[];
}

export function settingTitle(def: SettingDefinition, t: Translator): string {
  return t(def.titleKey, def.titleParams);
}

export function settingDescription(def: SettingDefinition, t: Translator): string {
  return t(def.descriptionKey);
}

/** Options of a select setting, translated. */
export function settingOptions(def: SettingDefinition, t: Translator): { value: string; label: string }[] {
  return (def.options ?? []).map(option => ({ value: option.value, label: option.labelKey ? t(option.labelKey) : option.label ?? option.value }));
}

function themeOptionsOfKind(kind: ThemeKind): SettingOption[] {
  return THEMES.filter(theme => theme.kind === kind).map(theme => ({ value: theme.id, labelKey: theme.labelKey }));
}

/** Single source of truth for the settings editor: adding a setting = adding an entry here. */
const APP_SHORTCUT_DEFINITIONS: SettingDefinition[] = APP_SHORTCUTS.map(shortcut => ({
  key: `shortcut:${shortcut.id}`,
  shortcutId: shortcut.id,
  categoryKey: 'settings.category.shortcuts' as const,
  titleKey: shortcut.labelKey,
  titleParams: shortcut.labelParams,
  descriptionKey: 'settings.shortcut.description' as const,
  control: 'shortcut' as const,
}));

export const SETTING_DEFINITIONS: SettingDefinition[] = [
  {
    key: 'language',
    categoryKey: 'settings.category.general',
    titleKey: 'settings.language.title',
    descriptionKey: 'settings.language.description',
    control: 'select',
    options: LANGUAGES.map(language => ({ value: language.id, label: language.label })),
  },
  {
    key: 'launchAtStartup',
    categoryKey: 'settings.category.general',
    titleKey: 'settings.launchAtStartup.title',
    descriptionKey: 'settings.launchAtStartup.description',
    control: 'checkbox',
  },
  {
    key: 'showMenuBarIcon',
    categoryKey: 'settings.category.general',
    titleKey: 'settings.showMenuBarIcon.title',
    descriptionKey: 'settings.showMenuBarIcon.description',
    control: 'checkbox',
    platforms: ['mac'],
  },
  {
    key: 'autoUpdate',
    categoryKey: 'settings.category.general',
    titleKey: 'settings.autoUpdate.title',
    descriptionKey: 'settings.autoUpdate.description',
    control: 'checkbox',
  },
  {
    key: 'theme',
    categoryKey: 'settings.category.appearance',
    titleKey: 'settings.theme.title',
    descriptionKey: 'settings.theme.description',
    control: 'select',
    options: [
      ...THEMES.map(theme => ({ value: theme.id, labelKey: theme.labelKey })),
      { value: 'system', labelKey: 'settings.theme.system' },
    ],
  },
  {
    key: 'preferredDarkTheme',
    categoryKey: 'settings.category.appearance',
    titleKey: 'settings.preferredDarkTheme.title',
    descriptionKey: 'settings.preferredDarkTheme.description',
    control: 'select',
    options: themeOptionsOfKind('dark'),
  },
  {
    key: 'preferredLightTheme',
    categoryKey: 'settings.category.appearance',
    titleKey: 'settings.preferredLightTheme.title',
    descriptionKey: 'settings.preferredLightTheme.description',
    control: 'select',
    options: themeOptionsOfKind('light'),
  },
  {
    key: 'showLineNumbers',
    categoryKey: 'settings.category.editor',
    titleKey: 'settings.showLineNumbers.title',
    descriptionKey: 'settings.showLineNumbers.description',
    control: 'checkbox',
  },
  {
    key: 'wordWrap',
    categoryKey: 'settings.category.editor',
    titleKey: 'settings.wordWrap.title',
    descriptionKey: 'settings.wordWrap.description',
    control: 'checkbox',
  },
  {
    key: 'trailingLine',
    categoryKey: 'settings.category.editor',
    titleKey: 'settings.trailingLine.title',
    descriptionKey: 'settings.trailingLine.description',
    control: 'checkbox',
  },
  {
    key: 'showOutline',
    categoryKey: 'settings.category.editor',
    titleKey: 'settings.showOutline.title',
    descriptionKey: 'settings.showOutline.description',
    control: 'checkbox',
  },
  {
    key: 'showBreadcrumbs',
    categoryKey: 'settings.category.editor',
    titleKey: 'settings.showBreadcrumbs.title',
    descriptionKey: 'settings.showBreadcrumbs.description',
    control: 'checkbox',
  },
  {
    key: 'hideScrollbar',
    categoryKey: 'settings.category.editor',
    titleKey: 'settings.hideScrollbar.title',
    descriptionKey: 'settings.hideScrollbar.description',
    control: 'checkbox',
  },
  {
    key: 'openInPreview',
    categoryKey: 'settings.category.editor',
    titleKey: 'settings.openInPreview.title',
    descriptionKey: 'settings.openInPreview.description',
    control: 'checkbox',
  },
  {
    key: 'formattingBarEnabled',
    categoryKey: 'settings.category.formattingBar',
    titleKey: 'settings.formattingBarEnabled.title',
    descriptionKey: 'settings.formattingBarEnabled.description',
    control: 'checkbox',
  },
  {
    key: 'formattingBarMode',
    categoryKey: 'settings.category.formattingBar',
    titleKey: 'settings.formattingBarMode.title',
    descriptionKey: 'settings.formattingBarMode.description',
    control: 'select',
    options: [
      { value: 'full', labelKey: 'settings.option.full' },
      { value: 'compact', labelKey: 'settings.option.compact' },
    ],
  },
  {
    key: 'formattingBarStyle',
    categoryKey: 'settings.category.formattingBar',
    titleKey: 'settings.formattingBarStyle.title',
    descriptionKey: 'settings.formattingBarStyle.description',
    control: 'select',
    options: [
      { value: 'pinned', labelKey: 'settings.option.pinned' },
      { value: 'floating', labelKey: 'settings.option.floating' },
    ],
  },
  {
    key: 'formattingBarPosition',
    categoryKey: 'settings.category.formattingBar',
    titleKey: 'settings.formattingBarPosition.title',
    descriptionKey: 'settings.formattingBarPosition.description',
    control: 'select',
    options: [
      { value: 'top', labelKey: 'settings.option.top' },
      { value: 'bottom', labelKey: 'settings.option.bottom' },
      { value: 'left', labelKey: 'settings.option.left' },
      { value: 'right', labelKey: 'settings.option.right' },
    ],
  },
  {
    key: 'collectionsExclude',
    categoryKey: 'settings.category.collections',
    titleKey: 'settings.collectionsExclude.title',
    descriptionKey: 'settings.collectionsExclude.description',
    control: 'list',
  },
  {
    key: 'globalShortcut',
    categoryKey: 'settings.category.globalShortcut',
    titleKey: 'settings.globalShortcut.title',
    descriptionKey: 'settings.globalShortcut.description',
    control: 'shortcut',
  },
  {
    key: 'shortcutMode',
    categoryKey: 'settings.category.globalShortcut',
    titleKey: 'settings.shortcutMode.title',
    descriptionKey: 'settings.shortcutMode.description',
    control: 'select',
    options: [
      { value: 'overlay', labelKey: 'settings.option.overlay' },
      { value: 'app', labelKey: 'settings.option.app' },
    ],
  },
  {
    key: 'overlayWidth',
    categoryKey: 'settings.category.overlay',
    titleKey: 'settings.overlayWidth.title',
    descriptionKey: 'settings.overlayWidth.description',
    control: 'number',
    min: 200,
    max: 800,
    step: 10,
  },
  {
    key: 'overlayHeight',
    categoryKey: 'settings.category.overlay',
    titleKey: 'settings.overlayHeight.title',
    descriptionKey: 'settings.overlayHeight.description',
    control: 'number',
    min: 200,
    max: 1200,
    step: 10,
  },
  {
    key: 'enterToSend',
    categoryKey: 'settings.category.overlay',
    titleKey: 'settings.enterToSend.title',
    descriptionKey: 'settings.enterToSend.description',
    control: 'checkbox',
  },
  {
    key: 'mcpEnabled',
    categoryKey: 'settings.category.mcp',
    titleKey: 'settings.mcpEnabled.title',
    descriptionKey: 'settings.mcpEnabled.description',
    control: 'checkbox',
  },
  {
    key: 'mcpPort',
    categoryKey: 'settings.category.mcp',
    titleKey: 'settings.mcpPort.title',
    descriptionKey: 'settings.mcpPort.description',
    control: 'number',
    min: 1024,
    max: 65535,
    step: 1,
  },
  {
    key: 'mcpToken',
    categoryKey: 'settings.category.mcp',
    titleKey: 'settings.mcpToken.title',
    descriptionKey: 'settings.mcpToken.description',
    control: 'mcpToken',
    fixed: true,
  },
  {
    key: 'mcpConnection',
    categoryKey: 'settings.category.mcp',
    titleKey: 'settings.mcpConnection.title',
    descriptionKey: 'settings.mcpConnection.description',
    control: 'mcpConnection',
    fixed: true,
    panel: true,
  },
  ...APP_SHORTCUT_DEFINITIONS,
];

/** Definitions that apply to `platform` (those without `platforms` apply everywhere). */
export function definitionsForPlatform(definitions: SettingDefinition[], platform: Platform): SettingDefinition[] {
  return definitions.filter(def => !def.platforms || def.platforms.includes(platform));
}

/** Case-insensitive match on the translated category, title, description or key; every word of the query must match. */
export function filterSettings(definitions: SettingDefinition[], query: string, t: Translator): SettingDefinition[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return definitions;
  return definitions.filter(def => {
    // Shortcut entries have synthetic keys (`shortcut:search.global`) that would only add false matches
    const key = def.shortcutId ? '' : def.key;
    const haystack = `${t(def.categoryKey)} ${settingTitle(def, t)} ${settingDescription(def, t)} ${key}`.toLowerCase();
    return words.every(word => haystack.includes(word));
  });
}

/** Groups definitions by category, keeping the declaration order. */
export function groupByCategory(definitions: SettingDefinition[], t: Translator): SettingsSection[] {
  const sections = new Map<TranslationKey, SettingDefinition[]>();
  for (const def of definitions) {
    const list = sections.get(def.categoryKey) ?? [];
    list.push(def);
    sections.set(def.categoryKey, list);
  }
  return [...sections].map(([categoryKey, settings]) => ({ categoryKey, category: t(categoryKey), settings }));
}
