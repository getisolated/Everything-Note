import { describe, it, expect } from 'vitest';
import { buildHtmlDocument } from '../src/app/shared/markdown/export-html';

describe('buildHtmlDocument', () => {
  it('wraps the body in a standalone page with an escaped title and no script', () => {
    const html = buildHtmlDocument('A <b>&</b> "B"', '<p>Hi</p>');
    expect(html.startsWith('<!doctype html>')).toBe(true);
    expect(html).toContain('<title>A &lt;b&gt;&amp;&lt;/b&gt; &quot;B&quot;</title>');
    expect(html).toContain('<article class="markdown-body"><p>Hi</p></article>');
    expect(html).toContain('<style>');
    expect(html).not.toContain('<script');
  });
});
