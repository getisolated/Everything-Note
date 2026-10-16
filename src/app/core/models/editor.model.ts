/** How a note is shown: its markdown source, its rendering (read-only), or both side by side. */
export type EditorViewMode = 'source' | 'preview' | 'split';

/** Asks the preview to bring a source line (1-based, may be fractional) to its top; a new object for each request. */
export interface PreviewScrollRequest {
  line: number;
}
