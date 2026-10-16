import { describe, it, expect } from 'vitest';
import { APP_SHORTCUTS } from '../src/app/core/models/app-shortcuts.model';
import { DEFAULT_SETTINGS } from '../src/app/core/models/settings.model';
import { SETTING_DEFINITIONS, filterSettings, groupByCategory } from '../src/app/features/settings/settings-definitions';

describe('filterSettings', () => {
  it('returns everything for an empty query', () => {
    expect(filterSettings(SETTING_DEFINITIONS, '   ')).toEqual(SETTING_DEFINITIONS);
  });

  it('matches title, description and category, case-insensitively', () => {
    expect(filterSettings(SETTING_DEFINITIONS, 'WIDTH').map(d => d.key)).toEqual(['overlayWidth', 'shortcut:layout.toggle']);
    expect(filterSettings(SETTING_DEFINITIONS, 'tray').map(d => d.key)).toContain('launchAtStartup');
    expect(filterSettings(SETTING_DEFINITIONS, 'global shortcut').map(d => d.key)).toEqual(['globalShortcut', 'shortcutMode']);
  });

  it('requires every word to match', () => {
    expect(filterSettings(SETTING_DEFINITIONS, 'overlay startup')).toEqual([]);
  });
});

describe('groupByCategory', () => {
  it('groups by category in declaration order', () => {
    const sections = groupByCategory(SETTING_DEFINITIONS);
    expect(sections.map(s => s.category)).toEqual(['General', 'Appearance', 'Editor', 'Formatting Bar', 'Collections', 'Global Shortcut', 'Quick Note Overlay', 'Keyboard Shortcuts']);
    expect(sections[6]?.settings.map(d => d.key)).toEqual(['overlayWidth', 'overlayHeight', 'enterToSend']);
  });

  it('returns no section for no setting', () => {
    expect(groupByCategory([])).toEqual([]);
  });
});

describe('SETTING_DEFINITIONS', () => {
  it('only references existing settings, each once', () => {
    const keys = SETTING_DEFINITIONS.map(d => d.key);
    expect(new Set(keys).size).toBe(keys.length);
    SETTING_DEFINITIONS.filter(d => !d.shortcutId).forEach(d => expect(d.key in DEFAULT_SETTINGS).toBe(true));
  });

  it('lists every rebindable shortcut', () => {
    const ids = SETTING_DEFINITIONS.filter(d => d.shortcutId).map(d => d.shortcutId);
    expect(ids).toEqual(APP_SHORTCUTS.map(s => s.id));
  });
});
