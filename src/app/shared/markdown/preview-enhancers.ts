import { LanguageDescription } from '@codemirror/language';
import { languages } from '@codemirror/language-data';
import { classHighlighter, highlightCode } from '@lezer/highlight';
import type { Mermaid } from 'mermaid';

const HIGHLIGHTED = 'highlighted';
const MAX_CACHED_DIAGRAMS = 50;

/**
 * Colors the fenced code blocks of the preview with the same Lezer parsers as the editor (`tok-*` classes, styled
 * from the theme tokens). Languages load on demand; unknown ones stay plain.
 */
export async function highlightCodeBlocks(root: HTMLElement): Promise<void> {
  const blocks = root.querySelectorAll<HTMLElement>('pre > code[class*="language-"]');

  for (const code of Array.from(blocks)) {
    if (code.dataset[HIGHLIGHTED]) {
      continue;
    }

    const name = /language-(?<name>\S+)/.exec(code.className)?.groups?.['name'];
    const description = name ? LanguageDescription.matchLanguageName(languages, name, true) : null;

    if (!description) {
      continue;
    }

    const support = description.support ?? await description.load();
    const text = code.textContent ?? '';
    const fragment = document.createDocumentFragment();

    highlightCode(
      text,
      support.language.parser.parse(text),
      classHighlighter,
      (token, classes) => {
        const span = document.createElement('span');
        span.className = classes;
        span.textContent = token;
        fragment.appendChild(classes ? span : document.createTextNode(token));
      },
      () => fragment.appendChild(document.createTextNode('\n')),
    );

    code.replaceChildren(fragment);
    code.dataset[HIGHLIGHTED] = '1';
  }
}

let mermaidLoader: Promise<Mermaid> | null = null;
let diagramCounter = 0;
/** SVG of the diagrams already drawn, by theme and source: the preview re-renders on every edit. */
const diagramCache = new Map<string, string>();

/** mermaid is heavy (~1 MB): only loaded once a note actually holds a diagram. */
function loadMermaid(): Promise<Mermaid> {
  mermaidLoader ??= import('mermaid').then(module => module.default);
  return mermaidLoader;
}

async function drawDiagram(mermaid: Mermaid, source: string, dark: boolean): Promise<string> {
  const key = `${dark ? 'dark' : 'light'}\n${source}`;
  const cached = diagramCache.get(key);

  if (cached !== undefined) {
    return cached;
  }

  mermaid.initialize({ startOnLoad: false, securityLevel: 'strict', theme: dark ? 'dark' : 'default' });
  // Validated first: a failed render leaves error markup behind in the page
  await mermaid.parse(source);
  const { svg } = await mermaid.render(`evn-mermaid-${++diagramCounter}`, source);

  if (diagramCache.size >= MAX_CACHED_DIAGRAMS) {
    const oldest = diagramCache.keys().next().value;
    if (oldest !== undefined) {
      diagramCache.delete(oldest);
    }
  }
  diagramCache.set(key, svg);
  return svg;
}

/** Replaces the mermaid sources of the preview with their diagram, or with the syntax error. */
export async function renderMermaidBlocks(root: HTMLElement, dark: boolean): Promise<void> {
  const blocks = Array.from(root.querySelectorAll<HTMLElement>('pre[data-mermaid]'));

  if (blocks.length === 0) {
    return;
  }

  const mermaid = await loadMermaid();

  for (const block of blocks) {
    const diagram = document.createElement('div');
    diagram.className = 'mermaid-diagram';

    if (block.dataset['line']) {
      diagram.dataset['line'] = block.dataset['line'];
    }

    try {
      // mermaid's strict security level sanitizes the SVG it produces
      diagram.innerHTML = await drawDiagram(mermaid, block.textContent ?? '', dark);
    } catch (error) {
      diagram.classList.add('mermaid-error');
      diagram.textContent = `Mermaid: ${error instanceof Error ? error.message : String(error)}`;
    }

    // The preview may have been re-rendered meanwhile: only replace a block still in the page
    if (block.isConnected) {
      block.replaceWith(diagram);
    }
  }
}
