import { describe, it, expect } from 'vitest';
import { createMarkdownRenderer } from '../src/app/shared/markdown/markdown-renderer';
import { LinkStatus } from '../src/app/core/utils/note-paths.util';

const statuses: Record<string, LinkStatus> = { 'Folder/Here': 'note', 'Gone': 'broken', 'https://x.dev': 'external' };
const md = createMarkdownRenderer({ linkStatus: target => statuses[target] ?? 'note' });
const render = (source: string): string => md.render(source);

describe('createMarkdownRenderer', () => {
  it('tags each top-level block with its 1-based source line', () => {
    const html = render('# Title\n\nParagraph\n\n- item');
    expect(html).toContain('<h1 data-line="1">');
    expect(html).toContain('<p data-line="3">');
    expect(html).toContain('<ul data-line="5">');
  });

  it('renders GFM tables and strikethrough', () => {
    expect(render('| a | b |\n| - | - |\n| 1 | 2 |')).toContain('<table');
    expect(render('~~gone~~')).toContain('<s>gone</s>');
  });

  it('turns task items into disabled checkboxes', () => {
    const html = render('- [ ] todo\n- [x] done');
    expect(html).toContain('class="task-list-item"');
    expect(html).toContain('<input type="checkbox" class="task-list-item-checkbox" disabled> todo');
    expect(html).toContain('disabled checked> done');
  });

  it('turns GitHub alerts into titled callouts', () => {
    const html = render('> [!WARNING]\n> Careful');
    expect(html).toContain('class="markdown-alert markdown-alert-warning"');
    expect(html).toContain('<p class="markdown-alert-title">Warning</p>');
    expect(html).not.toContain('[!WARNING]');
  });

  it('flags links by status and keeps their raw target', () => {
    expect(render('[ok](Folder/Here)')).toContain('class="link-note"');
    expect(render('[x](Gone)')).toMatch(/class="link-broken".*title="Link target not found"/);
    expect(render('[web](https://x.dev)')).toContain('data-href="https://x.dev"');
  });

  it('leaves mermaid blocks as escaped source for the preview to draw', () => {
    const html = render('```mermaid\ngraph TD; A-->B<\n```');
    expect(html).toContain('<pre class="mermaid-source" data-mermaid data-line="1">graph TD; A--&gt;B&lt;\n</pre>');
  });

  it('renders footnotes', () => {
    expect(render('Text[^1]\n\n[^1]: Note')).toContain('class="footnotes"');
  });
});
