export interface AppShortcutDefinition {
  id: string;
  label: string;
  /**
   * Electron-style accelerator, as produced by `keyEventToAccelerator` (e.g. `CommandOrControl+Shift+F`).
   * A chord is two accelerators separated by `, ` (e.g. `CommandOrControl+K, CommandOrControl+T`).
   */
  defaultAccelerator: string;
}

/** Every in-app shortcut the user can rebind. Global (system-wide) shortcut lives in its own setting. */
export const APP_SHORTCUTS: AppShortcutDefinition[] = [
  { id: 'note.new', label: 'New Note', defaultAccelerator: 'CommandOrControl+N' },
  { id: 'search.global', label: 'Search Notes', defaultAccelerator: 'CommandOrControl+Shift+F' },
  { id: 'palette.commands', label: 'Command Palette', defaultAccelerator: 'F1' },
  { id: 'settings.open', label: 'Open Settings', defaultAccelerator: 'CommandOrControl+,' },
  { id: 'layout.toggle', label: 'Toggle Full Width Layout', defaultAccelerator: 'Alt+Z' },
  // Not Ctrl+B: it is Bold in the editor
  { id: 'theme.toggle', label: 'Toggle Light / Dark Theme', defaultAccelerator: 'CommandOrControl+K, CommandOrControl+T' },
  { id: 'formattingBar.toggle', label: 'Toggle Formatting Bar', defaultAccelerator: 'Alt+T' },
  { id: 'sidebar.toggle', label: 'Toggle Sidebar', defaultAccelerator: 'CommandOrControl+Shift+E' },
  { id: 'tab.close', label: 'Close Tab', defaultAccelerator: 'CommandOrControl+W' },
  { id: 'tab.next', label: 'Next Tab', defaultAccelerator: 'CommandOrControl+Tab' },
  { id: 'tab.prev', label: 'Previous Tab', defaultAccelerator: 'CommandOrControl+Shift+Tab' },
  { id: 'tab.pin', label: 'Pin / Unpin Tab', defaultAccelerator: 'Alt+P' },
  ...Array.from({ length: 9 }, (_, i) => ({
    id: `tab.goto.${i + 1}`, label: `Go To Tab ${i + 1}`, defaultAccelerator: `CommandOrControl+Alt+${i + 1}`,
  })),
  { id: 'editor.find', label: 'Find In Note', defaultAccelerator: 'CommandOrControl+F' },
  { id: 'editor.preview', label: 'Toggle Preview', defaultAccelerator: 'CommandOrControl+Shift+V' },
  // Like VS Code: Ctrl+K then V alone
  { id: 'editor.previewSide', label: 'Toggle Preview To The Side', defaultAccelerator: 'CommandOrControl+K, V' },
  { id: 'editor.save', label: 'Save Note', defaultAccelerator: 'CommandOrControl+S' },
  { id: 'editor.bold', label: 'Bold', defaultAccelerator: 'CommandOrControl+B' },
  { id: 'editor.italic', label: 'Italic', defaultAccelerator: 'CommandOrControl+I' },
  { id: 'editor.draft', label: 'Toggle Draft Block', defaultAccelerator: 'CommandOrControl+D' },
  // Not Ctrl+K: it starts the chords (theme)
  { id: 'editor.link', label: 'Insert Link', defaultAccelerator: 'CommandOrControl+Shift+K' },
];

/** Accelerator in effect for every shortcut: the user's override when there is one, the default otherwise. */
export function resolveAppShortcuts(overrides: Record<string, string>): Record<string, string> {
  const resolved: Record<string, string> = {};
  for (const shortcut of APP_SHORTCUTS) {
    resolved[shortcut.id] = overrides[shortcut.id] ?? shortcut.defaultAccelerator;
  }
  return resolved;
}

/** Same combination, or one being the first key of the other's chord (which would then never fire). */
function acceleratorsClash(first: string, second: string): boolean {
  return first === second || first.startsWith(`${second}, `) || second.startsWith(`${first}, `);
}

/** Another shortcut already using this accelerator, if any (a key combination can only trigger one action). */
export function findShortcutConflict(
  id: string,
  accelerator: string,
  resolved: Record<string, string>,
): AppShortcutDefinition | null {
  return APP_SHORTCUTS.find(other => other.id !== id && acceleratorsClash(resolved[other.id] ?? '', accelerator)) ?? null;
}
