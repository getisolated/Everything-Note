import { describe, it, expect } from 'vitest';
import { APP_SHORTCUTS } from '../src/app/core/models/app-shortcuts.model';
import { DEFAULT_SETTINGS } from '../src/app/core/models/settings.model';
import { translate } from '../src/app/core/i18n/translate';
import { Translator } from '../src/app/core/i18n/translate';
import { SETTING_DEFINITIONS, definitionsForPlatform, filterSettings, groupByCategory, settingOptions, settingTitle } from '../src/app/features/settings/settings-definitions';

const en: Translator = (key, params) => translate('en', key, params);
const fr: Translator = (key, params) => translate('fr', key, params);

describe('filterSettings', () => {
  it('returns everything for an empty query', () => {
    expect(filterSettings(SETTING_DEFINITIONS, '   ', en)).toEqual(SETTING_DEFINITIONS);
  });

  it('matches title, description and category, case-insensitively', () => {
    expect(filterSettings(SETTING_DEFINITIONS, 'WIDTH', en).map(d => d.key)).toEqual(['overlayWidth', 'shortcut:layout.toggle']);
    expect(filterSettings(SETTING_DEFINITIONS, 'tray', en).map(d => d.key)).toContain('launchAtStartup');
    expect(filterSettings(SETTING_DEFINITIONS, 'global shortcut', en).map(d => d.key)).toEqual(['globalShortcut', 'shortcutMode']);
  });

  it('requires every word to match', () => {
    expect(filterSettings(SETTING_DEFINITIONS, 'overlay startup', en)).toEqual([]);
  });

  it('filters on the translated texts', () => {
    expect(filterSettings(SETTING_DEFINITIONS, 'largeur', fr).map(d => d.key)).toContain('overlayWidth');
    expect(filterSettings(SETTING_DEFINITIONS, 'largeur', en)).toEqual([]);
    expect(filterSettings(SETTING_DEFINITIONS, 'raccourci global', fr).map(d => d.key)).toEqual(expect.arrayContaining(['globalShortcut', 'shortcutMode']));
  });
});

describe('groupByCategory', () => {
  it('groups by category in declaration order', () => {
    const sections = groupByCategory(SETTING_DEFINITIONS, en);
    expect(sections.map(s => s.category)).toEqual(['General', 'Appearance', 'Editor', 'Formatting Bar', 'Collections', 'Global Shortcut', 'Quick Note Overlay', 'AI (MCP)', 'Keyboard Shortcuts']);
    expect(sections[6]?.settings.map(d => d.key)).toEqual(['overlayWidth', 'overlayHeight', 'enterToSend']);
  });

  it('groups on the translated category names', () => {
    expect(groupByCategory(SETTING_DEFINITIONS, fr).slice(0, 2).map(s => s.category)).toEqual(['Général', 'Apparence']);
  });

  it('returns no section for no setting', () => {
    expect(groupByCategory([], en)).toEqual([]);
  });
});

describe('SETTING_DEFINITIONS', () => {
  it('starts with the language setting, whose options are never translated', () => {
    const language = SETTING_DEFINITIONS[0];
    expect(language?.key).toBe('language');
    expect(language?.categoryKey).toBe('settings.category.general');
    expect(settingOptions(language!, fr)).toEqual([{ value: 'en', label: 'English' }, { value: 'fr', label: 'Français' }]);
  });

  it('translates titles, with parameters for the numbered shortcuts', () => {
    const goto = SETTING_DEFINITIONS.find(d => d.shortcutId === 'tab.goto.3');
    expect(settingTitle(goto!, en)).toBe('Go To Tab 3');
    expect(settingTitle(goto!, fr)).toBe("Aller à l'onglet 3");
  });

  it('only references existing settings, each once', () => {
    const keys = SETTING_DEFINITIONS.map(d => d.key);
    expect(new Set(keys).size).toBe(keys.length);
    SETTING_DEFINITIONS.filter(d => !d.shortcutId && !d.panel).forEach(d => expect(d.key in DEFAULT_SETTINGS).toBe(true));
  });

  it('groups the MCP server settings, the token and the client setup being shown only', () => {
    const mcp = groupByCategory(SETTING_DEFINITIONS, en).find(s => s.categoryKey === 'settings.category.mcp');
    expect(mcp?.settings.map(d => d.key)).toEqual(['mcpEnabled', 'mcpPort', 'mcpToken', 'mcpConnection']);
    expect(mcp?.settings.filter(d => d.fixed).map(d => d.key)).toEqual(['mcpToken', 'mcpConnection']);
    expect(filterSettings(SETTING_DEFINITIONS, 'claude', en).map(d => d.key)).toEqual(['mcpEnabled', 'mcpConnection']);
  });

  it('shows the menu bar icon setting on macOS only', () => {
    const keysOn = (platform: 'mac' | 'windows') => definitionsForPlatform(SETTING_DEFINITIONS, platform).map(d => d.key);
    expect(keysOn('mac')).toContain('showMenuBarIcon');
    expect(keysOn('windows')).not.toContain('showMenuBarIcon');
    expect(keysOn('windows')).toEqual(SETTING_DEFINITIONS.filter(d => d.key !== 'showMenuBarIcon').map(d => d.key));
  });

  it('lists every rebindable shortcut', () => {
    const ids = SETTING_DEFINITIONS.filter(d => d.shortcutId).map(d => d.shortcutId);
    expect(ids).toEqual(APP_SHORTCUTS.map(s => s.id));
  });
});
