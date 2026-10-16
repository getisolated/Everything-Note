import { describe, it, expect } from 'vitest';
import { DEFAULT_SETTINGS, sanitizeSettings } from '../electron/settings-schema';

describe('sanitizeSettings', () => {
  it('returns defaults for garbage input', () => {
    expect(sanitizeSettings(null)).toEqual(DEFAULT_SETTINGS);
    expect(sanitizeSettings('nope')).toEqual(DEFAULT_SETTINGS);
  });

  it('keeps valid values', () => {
    const result = sanitizeSettings({
      globalShortcut: 'Ctrl+Shift+K', shortcutMode: 'app', overlayWidth: 320, overlayHeight: 640, enterToSend: false,
    });
    expect(result).toMatchObject({
      globalShortcut: 'Ctrl+Shift+K', shortcutMode: 'app', overlayWidth: 320, overlayHeight: 640, enterToSend: false,
    });
  });

  it('keeps valid formatting bar preferences and falls back to the current ones otherwise', () => {
    const valid = { formattingBarEnabled: false, formattingBarMode: 'compact', formattingBarStyle: 'floating', formattingBarPosition: 'bottom' };
    expect(sanitizeSettings(valid)).toMatchObject(valid);
    expect(sanitizeSettings({ formattingBarEnabled: 'no', formattingBarMode: 'huge', formattingBarStyle: 1, formattingBarPosition: 'left' })).toMatchObject({
      formattingBarEnabled: true, formattingBarMode: 'full', formattingBarStyle: 'pinned', formattingBarPosition: 'top',
    });
  });

  it('keeps valid editor preferences and falls back to the current ones otherwise', () => {
    expect(sanitizeSettings({ showOutline: false })).toMatchObject({ showOutline: false });
    expect(sanitizeSettings({ showOutline: 'no' })).toMatchObject({ showOutline: true });
    expect(sanitizeSettings({ openInPreview: true })).toMatchObject({ openInPreview: true });
    expect(sanitizeSettings({ openInPreview: 'yes' })).toMatchObject({ openInPreview: false });
    expect(sanitizeSettings({ showLineNumbers: false, wordWrap: false })).toMatchObject({ showLineNumbers: false, wordWrap: false });
    expect(sanitizeSettings({ showLineNumbers: 'no', wordWrap: 0 })).toMatchObject({ showLineNumbers: true, wordWrap: true });
  });

  it('keeps a valid theme and falls back to the current one otherwise', () => {
    expect(sanitizeSettings({ theme: 'light' }).theme).toBe('light');
    expect(sanitizeSettings({ theme: 'system' }).theme).toBe('system');
    expect(sanitizeSettings({ theme: 'solarized' }).theme).toBe('dark');
    expect(sanitizeSettings({ theme: 42 }, { ...DEFAULT_SETTINGS, theme: 'light' }).theme).toBe('light');
  });

  it('clamps the overlay size to its bounds', () => {
    expect(sanitizeSettings({ overlayWidth: 10, overlayHeight: 99999 })).toMatchObject({ overlayWidth: 200, overlayHeight: 1200 });
  });

  it('rejects non-finite or non-numeric sizes', () => {
    expect(sanitizeSettings({ overlayWidth: NaN, overlayHeight: '500' })).toMatchObject({ overlayWidth: 250, overlayHeight: 350 });
  });

  it('keeps valid app shortcut overrides and drops malformed ones', () => {
    const result = sanitizeSettings({
      appShortcuts: { 'note.new': 'CommandOrControl+Alt+M', 'Bad Id!': 'Ctrl+X', 'tab.close': '', 'tab.pin': 42 },
    });
    expect(result.appShortcuts).toEqual({ 'note.new': 'CommandOrControl+Alt+M' });
  });

  it('falls back to the current app shortcuts when the value is not an object', () => {
    const base = { ...DEFAULT_SETTINGS, appShortcuts: { 'note.new': 'Alt+M' } };
    expect(sanitizeSettings({ appShortcuts: 'nope' }, base).appShortcuts).toEqual({ 'note.new': 'Alt+M' });
    expect(sanitizeSettings({ appShortcuts: ['x'] }, base).appShortcuts).toEqual({ 'note.new': 'Alt+M' });
  });

  it('rejects an unknown shortcut mode and an empty shortcut', () => {
    expect(sanitizeSettings({ shortcutMode: 'weird', globalShortcut: '  ' }))
      .toMatchObject({ shortcutMode: 'overlay', globalShortcut: DEFAULT_SETTINGS.globalShortcut });
  });

  it('falls back to the current values rather than the defaults', () => {
    const base = { ...DEFAULT_SETTINGS, overlayWidth: 400 };
    expect(sanitizeSettings({ overlayWidth: 'x' }, base).overlayWidth).toBe(400);
  });

  it('sanitizes the saved position', () => {
    expect(sanitizeSettings({ overlayPosition: { x: 10.4, y: 20.6 } }).overlayPosition).toEqual({ x: 10, y: 21 });
    expect(sanitizeSettings({ overlayPosition: { x: 'a', y: 2 } }).overlayPosition).toBeNull();
  });
});
