import { APP_SHORTCUTS } from '../../core/models/app-shortcuts.model';

export type SettingControl = 'checkbox' | 'number' | 'select' | 'shortcut';

export interface SettingDefinition {
  /** AppSettings key, or `shortcut:<id>` for a rebindable in-app shortcut. */
  key: string;
  /** Set for in-app shortcuts: the APP_SHORTCUTS id this entry rebinds. */
  shortcutId?: string;
  category: string;
  title: string;
  description: string;
  control: SettingControl;
  min?: number;
  max?: number;
  step?: number;
  options?: { value: string; label: string }[];
}

export interface SettingsSection {
  category: string;
  settings: SettingDefinition[];
}

/** Single source of truth for the settings editor: adding a setting = adding an entry here. */
const APP_SHORTCUT_DEFINITIONS: SettingDefinition[] = APP_SHORTCUTS.map(shortcut => ({
  key: `shortcut:${shortcut.id}`,
  shortcutId: shortcut.id,
  category: 'Keyboard Shortcuts',
  title: shortcut.label,
  description: 'Click, then press the new key combination.',
  control: 'shortcut' as const,
}));

export const SETTING_DEFINITIONS: SettingDefinition[] = [
  {
    key: 'launchAtStartup',
    category: 'General',
    title: 'Launch At Startup',
    description: 'Start Everything Note silently in the system tray when you log in to Windows.',
    control: 'checkbox',
  },
  {
    key: 'autoUpdate',
    category: 'General',
    title: 'Automatic Updates',
    description: 'Download new versions in the background and install them when the app closes. When unchecked, you are asked before anything is downloaded.',
    control: 'checkbox',
  },
  {
    key: 'theme',
    category: 'Appearance',
    title: 'Theme',
    description: 'Color theme of the app. System follows the Windows light/dark setting.',
    control: 'select',
    options: [
      { value: 'dark', label: 'Dark' },
      { value: 'light', label: 'Light' },
      { value: 'system', label: 'System' },
    ],
  },
  {
    key: 'showLineNumbers',
    category: 'Editor',
    title: 'Line Numbers',
    description: 'Show the line numbers on the left of the editor.',
    control: 'checkbox',
  },
  {
    key: 'wordWrap',
    category: 'Editor',
    title: 'Word Wrap',
    description: 'Wrap long lines at the edge of the editor. When unchecked, they scroll horizontally.',
    control: 'checkbox',
  },
  {
    key: 'trailingLine',
    category: 'Editor',
    title: 'Trailing Line',
    description: 'Always keep an empty line at the end of a note, added automatically.',
    control: 'checkbox',
  },
  {
    key: 'showOutline',
    category: 'Editor',
    title: 'Outline',
    description: 'Show the h1, h2 and h3 headings of the note on the right of the editor, to jump to a chapter.',
    control: 'checkbox',
  },
  {
    key: 'openInPreview',
    category: 'Editor',
    title: 'Open Notes In Preview',
    description: 'Open a note rendered like on GitHub (read-only) instead of its markdown source. The buttons at the top right of the note switch between source, side by side and preview.',
    control: 'checkbox',
  },
  {
    key: 'formattingBarEnabled',
    category: 'Formatting Bar',
    title: 'Show Formatting Bar',
    description: 'Toolbar with the main formatting actions (headings, bold, lists…). Uncheck to hide it for good; the shortcut toggles it too.',
    control: 'checkbox',
  },
  {
    key: 'formattingBarMode',
    category: 'Formatting Bar',
    title: 'Size',
    description: 'Full shows separators between groups; Compact is smaller, with tighter spacing.',
    control: 'select',
    options: [
      { value: 'full', label: 'Full' },
      { value: 'compact', label: 'Compact' },
    ],
  },
  {
    key: 'formattingBarStyle',
    category: 'Formatting Bar',
    title: 'Style',
    description: 'Pinned is attached to the window edges; Floating is detached from them, with rounded corners.',
    control: 'select',
    options: [
      { value: 'pinned', label: 'Pinned' },
      { value: 'floating', label: 'Floating' },
    ],
  },
  {
    key: 'formattingBarPosition',
    category: 'Formatting Bar',
    title: 'Position',
    description: 'Above or below the editing area.',
    control: 'select',
    options: [
      { value: 'top', label: 'Top' },
      { value: 'bottom', label: 'Bottom' },
    ],
  },
  {
    key: 'globalShortcut',
    category: 'Global Shortcut',
    title: 'Shortcut',
    description: 'System-wide shortcut that works even when the app is in the tray. Click, then press the new key combination.',
    control: 'shortcut',
  },
  {
    key: 'shortcutMode',
    category: 'Global Shortcut',
    title: 'Action',
    description: 'What the global shortcut opens.',
    control: 'select',
    options: [
      { value: 'overlay', label: 'Quick-note overlay' },
      { value: 'app', label: 'Full app' },
    ],
  },
  {
    key: 'overlayWidth',
    category: 'Quick Note Overlay',
    title: 'Width',
    description: 'Width of the overlay, in pixels.',
    control: 'number',
    min: 200,
    max: 800,
    step: 10,
  },
  {
    key: 'overlayHeight',
    category: 'Quick Note Overlay',
    title: 'Height',
    description: 'Height of the overlay, in pixels.',
    control: 'number',
    min: 200,
    max: 1200,
    step: 10,
  },
  {
    key: 'enterToSend',
    category: 'Quick Note Overlay',
    title: 'Enter To Send',
    description: 'Enter sends the note (Shift+Enter inserts a new line). When unchecked, Enter inserts a new line and Ctrl+Enter sends.',
    control: 'checkbox',
  },
  ...APP_SHORTCUT_DEFINITIONS,
];

/** Case-insensitive match on category, title, description or key; every word of the query must match. */
export function filterSettings(definitions: SettingDefinition[], query: string): SettingDefinition[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return definitions;
  return definitions.filter(def => {
    // Shortcut entries have synthetic keys (`shortcut:search.global`) that would only add false matches
    const key = def.shortcutId ? '' : def.key;
    const haystack = `${def.category} ${def.title} ${def.description} ${key}`.toLowerCase();
    return words.every(word => haystack.includes(word));
  });
}

/** Groups definitions by category, keeping the declaration order. */
export function groupByCategory(definitions: SettingDefinition[]): SettingsSection[] {
  const sections = new Map<string, SettingDefinition[]>();
  for (const def of definitions) {
    const list = sections.get(def.category) ?? [];
    list.push(def);
    sections.set(def.category, list);
  }
  return [...sections].map(([category, settings]) => ({ category, settings }));
}
