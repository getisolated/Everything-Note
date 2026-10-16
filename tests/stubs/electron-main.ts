// Stub d'`electron/main` : ce sous-module n'existe qu'au runtime Electron, pas sous Node (vitest).
export const app = {
  getPath: (): string => '',
};

export const dialog = {};

export class BrowserWindow {}
