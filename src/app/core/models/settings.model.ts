import { FormattingBarMode, FormattingBarPosition, FormattingBarStyle } from './formatting-bar.model';

export type ShortcutMode = 'overlay' | 'app';

export type ThemePreference = 'dark' | 'light' | 'system';

/** Theme actually applied once 'system' is resolved against the OS color scheme. */
export type ResolvedTheme = 'dark' | 'light';

export interface AppSettings {
  globalShortcut: string;
  shortcutMode: ShortcutMode;
  overlayWidth: number;
  overlayHeight: number;
  /** true: Enter sends (Shift+Enter = new line). false: Enter = new line (Ctrl+Enter sends). */
  enterToSend: boolean;
  launchAtStartup: boolean;
  /** 'system' follows the OS color scheme. */
  theme: ThemePreference;
  /** true: updates download in the background and install when the app quits. false: the user is asked first. */
  autoUpdate: boolean;
  /** In-app shortcuts changed by the user, by shortcut id (see APP_SHORTCUTS); absent = default. */
  appShortcuts: Record<string, string>;
  /** false: the formatting bar is hidden for good (Alt+T flips it). */
  formattingBarEnabled: boolean;
  formattingBarMode: FormattingBarMode;
  formattingBarStyle: FormattingBarStyle;
  formattingBarPosition: FormattingBarPosition;
  /** Line numbers in the left gutter of the editor. */
  showLineNumbers: boolean;
  /** true: long lines wrap at the editor edge. false: they scroll horizontally. */
  wordWrap: boolean;
  /** true: the note always ends with an empty line, added automatically. */
  trailingLine: boolean;
  /** true: the h1/h2/h3 outline is shown on the right of the open note. */
  showOutline: boolean;
}

export type SettingsPatch = Partial<AppSettings>;

export interface SettingsUpdateResult {
  ok: boolean;
  error?: 'shortcut-unavailable';
  settings: AppSettings;
}

export const DEFAULT_SETTINGS: AppSettings = {
  globalShortcut: 'CommandOrControl+Alt+N',
  shortcutMode: 'overlay',
  overlayWidth: 250,
  overlayHeight: 350,
  enterToSend: true,
  launchAtStartup: false,
  theme: 'dark',
  autoUpdate: false,
  appShortcuts: {},
  formattingBarEnabled: true,
  formattingBarMode: 'full',
  formattingBarStyle: 'pinned',
  formattingBarPosition: 'top',
  showLineNumbers: true,
  wordWrap: true,
  trailingLine: false,
  showOutline: true,
};

/** Tag of the notes sent from the quick-note overlay (formerly `overlay`, migrated by the main process). */
export const QUICK_NOTE_TAG = 'quick-note';
