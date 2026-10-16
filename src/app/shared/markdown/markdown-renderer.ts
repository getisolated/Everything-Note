import createMarkdownIt from 'markdown-it';
import type { MarkdownIt, RendererRule, StateCore, Token } from 'markdown-it';
import footnote from 'markdown-it-footnote';
import DOMPurify from 'dompurify';
import { LinkStatus } from '../../core/utils/note-paths.util';

/** Everything the preview needs to know about the app to render a note. */
export interface MarkdownRenderContext {
  /** Whether a link target exists: local links pointing to nothing are drawn as broken. */
  linkStatus: (target: string) => LinkStatus;
}

type AlertType = 'note' | 'tip' | 'important' | 'warning' | 'caution';
const ALERT_MARKER = /^\[!(?<type>note|tip|important|warning|caution)\]\s*/i;
const TASK_MARKER = /^\[(?<state>[ xX])\]\s+/;

/** Source line (1-based) of each block, so the preview can follow the editor scroll and the other way round. */
function sourceLines(md: MarkdownIt): void {
  md.core.ruler.push('source_lines', (state: StateCore) => {
    for (const token of state.tokens) {
      if (token.map && token.nesting === 1 && token.level === 0) {
        token.attrSet('data-line', String(token.map[0] + 1));
      }
    }
  });
}

/** GitHub task lists: `- [ ]` / `- [x]` items get a (read-only) checkbox. */
function taskLists(md: MarkdownIt): void {
  md.core.ruler.push('task_lists', (state: StateCore) => {
    const tokens = state.tokens;

    for (let i = 2; i < tokens.length; i++) {
      const inline = tokens[i] as Token;
      const item = tokens[i - 2] as Token;
      const match = inline.type === 'inline' && item.type === 'list_item_open' ? TASK_MARKER.exec(inline.content) : null;

      if (!match?.groups) {
        continue;
      }

      const checked = match.groups['state'] !== ' ';
      item.attrJoin('class', 'task-list-item');
      const first = inline.children?.[0];

      if (first?.type === 'text') {
        first.content = first.content.replace(TASK_MARKER, '');
      }

      const checkbox = new state.Token('html_inline', '', 0);
      checkbox.content = `<input type="checkbox" class="task-list-item-checkbox" disabled${checked ? ' checked' : ''}> `;
      inline.children?.unshift(checkbox);
    }
  });
}

/** GitHub alerts: a quote starting with `[!NOTE]` (TIP, IMPORTANT, WARNING, CAUTION) becomes a titled callout. */
function alerts(md: MarkdownIt): void {
  md.core.ruler.push('alerts', (state: StateCore) => {
    const tokens = state.tokens;

    for (let i = 0; i < tokens.length - 2; i++) {
      const open = tokens[i] as Token;
      const inline = tokens[i + 2] as Token;
      const match = open.type === 'blockquote_open' && inline.type === 'inline' ? ALERT_MARKER.exec(inline.content) : null;
      const type = match?.groups?.['type']?.toLowerCase() as AlertType | undefined;

      if (!type) {
        continue;
      }

      open.attrJoin('class', `markdown-alert markdown-alert-${type}`);
      inline.content = inline.content.replace(ALERT_MARKER, '');
      const first = inline.children?.[0];

      if (first?.type === 'text') {
        first.content = first.content.replace(ALERT_MARKER, '');
      }

      // The marker may sit alone on its line: drop the soft break that followed it
      if (inline.children?.[0]?.content === '' && inline.children[1]?.type === 'softbreak') {
        inline.children.splice(0, 2);
      }

      const title = new state.Token('html_block', '', 0);
      title.content = `<p class="markdown-alert-title">${type[0]?.toUpperCase()}${type.slice(1)}</p>\n`;
      tokens.splice(i + 1, 0, title);
    }
  });
}

/** Links keep their raw target (the preview follows them itself) and get a class telling what they point to. */
function linkTargets(md: MarkdownIt, context: MarkdownRenderContext): void {
  const fallback: RendererRule = md.renderer.rules['link_open'] ?? ((tokens, idx, options, _env, self) => self.renderToken(tokens, idx, options));

  md.renderer.rules['link_open'] = (tokens, idx, options, env, self) => {
    const token = tokens[idx] as Token;
    const href = String(token.attrGet('href') ?? '');
    const status = context.linkStatus(href);

    token.attrSet('data-href', href);
    token.attrJoin('class', status === 'broken' ? 'link-broken' : `link-${status}`);

    if (status === 'broken') {
      token.attrSet('title', 'Link target not found');
    }

    return fallback(tokens, idx, options, env, self);
  };
}

/** Mermaid blocks are left as their source, flagged: the preview draws them once mermaid is loaded. */
function mermaidFences(md: MarkdownIt): void {
  const fallback: RendererRule = md.renderer.rules['fence'] ?? ((tokens, idx, options, _env, self) => self.renderToken(tokens, idx, options));

  md.renderer.rules['fence'] = (tokens, idx, options, env, self) => {
    const token = tokens[idx] as Token;

    if (token.info.trim().toLowerCase() !== 'mermaid') {
      return fallback(tokens, idx, options, env, self);
    }

    const line = token.map ? ` data-line="${token.map[0] + 1}"` : '';
    return `<pre class="mermaid-source" data-mermaid${line}>${md.utils.escapeHtml(token.content)}</pre>\n`;
  };
}

/** A configured markdown-it: GFM-like (tables, strikethrough, autolinks, task lists, footnotes, alerts). */
export function createMarkdownRenderer(context: MarkdownRenderContext): MarkdownIt {
  const md = createMarkdownIt({ html: true, linkify: true, breaks: false });

  md.use(footnote as unknown as (md: MarkdownIt) => void);
  md.use(sourceLines);
  md.use(taskLists);
  md.use(alerts);
  md.use(mermaidFences);
  linkTargets(md, context);

  return md;
}

/**
 * HTML of a note, sanitized: the markdown may come from anywhere (pasted, imported, a file on disk), and raw HTML
 * is allowed in it, so scripts, event handlers and `javascript:` links are stripped before it reaches the page.
 */
export function renderMarkdown(md: MarkdownIt, source: string): string {
  return DOMPurify.sanitize(md.render(source), {
    ADD_ATTR: ['data-line', 'data-href', 'data-mermaid'],
    FORBID_TAGS: ['style', 'form'],
  });
}
