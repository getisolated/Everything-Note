import { describe, it, expect } from 'vitest';
import { buildHtmlDocument } from '../src/app/shared/markdown/export-html';

describe('buildHtmlDocument', () => {
  it('wraps the body in a standalone page with an escaped title and no script', () => {
    const html = buildHtmlDocument('A <b>&</b> "B"', '<p>Hi</p>', 'en');
    expect(html.startsWith('<!doctype html>')).toBe(true);
    expect(html).toContain('<title>A &lt;b&gt;&amp;&lt;/b&gt; &quot;B&quot;</title>');
    expect(html).toContain('<article class="markdown-body"><p>Hi</p></article>');
    expect(html).toContain('<style>');
    expect(html).not.toContain('<script');
  });

  it('declares the language of the page', () => {
    expect(buildHtmlDocument('T', '<p>Salut</p>', 'fr')).toContain('<html lang="fr">');
  });

  it('adds the print stylesheet only for a PDF export', () => {
    const page = buildHtmlDocument('T', '<p>x</p>', 'en');
    const printed = buildHtmlDocument('T', '<p>x</p>', 'en', { print: true });

    expect(page).not.toContain('@page');
    expect(printed).toContain('@page { size: A4; margin: 18mm; }');
    expect(printed).toContain('print-color-adjust: exact');
    expect(printed).toContain('break-inside: avoid');
    expect(printed).not.toContain('<script');
  });
});
