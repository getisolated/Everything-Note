/**
 * Content to load in the editor when the stored note changed outside of it (an AI through the MCP server), `null` to
 * keep the editor as is: nothing new since the editor last loaded or saved it, the editor already shows it, or the
 * user has unsaved edits (they win, and are saved over the change as usual).
 */
export function externallyChangedContent(
  known: string,
  stored: string | undefined,
  shown: string,
  hasUnsavedEdits: boolean,
): string | null {
  if (stored === undefined || hasUnsavedEdits || stored === known || stored === shown) {
    return null;
  }
  return stored;
}
