/** Standalone stylesheet of an exported page: GitHub's light look, whatever the theme of the app. */
const EXPORT_CSS = `
body { margin: 0; background: #fff; color: #1f2328; font-family: -apple-system, 'Segoe UI', 'Noto Sans', Helvetica, Arial, sans-serif; font-size: 16px; line-height: 1.6; }
.markdown-body { max-width: 860px; margin: 0 auto; padding: 32px 40px 64px; word-wrap: break-word; }
.markdown-body > *:first-child { margin-top: 0; }
p, blockquote, ul, ol, table, pre, .markdown-alert, .mermaid-diagram { margin: 0 0 16px; }
h1, h2, h3, h4, h5, h6 { margin: 24px 0 16px; font-weight: 600; line-height: 1.25; }
h1 { font-size: 2em; padding-bottom: .3em; border-bottom: 1px solid #d1d9e0; }
h2 { font-size: 1.5em; padding-bottom: .3em; border-bottom: 1px solid #d1d9e0; }
h3 { font-size: 1.25em; } h4 { font-size: 1em; } h5 { font-size: .875em; } h6 { font-size: .85em; color: #59636e; }
a { color: #0969da; text-decoration: none; } a:hover { text-decoration: underline; }
hr { height: 4px; margin: 24px 0; padding: 0; background: #d1d9e0; border: 0; }
blockquote { padding: 0 1em; color: #59636e; border-left: .25em solid #d1d9e0; }
ul, ol { padding-left: 2em; }
.task-list-item { list-style-type: none; } .task-list-item-checkbox { margin: 0 .35em .2em -1.4em; vertical-align: middle; }
code { padding: .2em .4em; font-family: Consolas, 'SF Mono', monospace; font-size: 85%; background: rgba(129, 139, 152, .12); border-radius: 6px; }
pre { padding: 16px; overflow: auto; font-size: 85%; line-height: 1.45; background: #f6f8fa; border-radius: 6px; }
pre code { padding: 0; font-size: 100%; background: transparent; white-space: pre; }
table { display: block; width: max-content; max-width: 100%; overflow: auto; border-collapse: collapse; }
th, td { padding: 6px 13px; border: 1px solid #d1d9e0; } th { font-weight: 600; } tr:nth-child(2n) { background: #f6f8fa; }
img { max-width: 100%; }
.markdown-alert { padding: 8px 16px; border-left: .25em solid var(--alert); } .markdown-alert-title { margin-bottom: 4px; font-weight: 500; color: var(--alert); }
.markdown-alert-note { --alert: #0969da; } .markdown-alert-tip { --alert: #1a7f37; } .markdown-alert-important { --alert: #8250df; }
.markdown-alert-warning { --alert: #9a6700; } .markdown-alert-caution { --alert: #d1242f; }
.footnotes { font-size: 12px; color: #59636e; border-top: 1px solid #d1d9e0; }
.mermaid-diagram { display: flex; justify-content: center; } .mermaid-diagram svg { max-width: 100%; height: auto; }
.mermaid-error { color: #d1242f; font-family: Consolas, monospace; white-space: pre-wrap; }
.tok-keyword, .tok-controlKeyword, .tok-modifier { color: #cf222e; } .tok-string, .tok-string2 { color: #0a3069; }
.tok-number, .tok-bool, .tok-atom, .tok-constant { color: #0550ae; } .tok-comment, .tok-meta { color: #59636e; font-style: italic; }
.tok-variableName, .tok-propertyName { color: #953800; } .tok-definition, .tok-function { color: #8250df; }
.tok-typeName, .tok-className { color: #953800; } .tok-regexp, .tok-escape { color: #116329; } .tok-invalid { color: #82071e; }
.tok-heading { color: #0550ae; font-weight: 600; } .tok-link, .tok-url { color: #0969da; }
`;

function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** A self-contained HTML page (inline style, no script) around an already sanitized note body. */
export function buildHtmlDocument(title: string, bodyHtml: string): string {
  return [
    '<!doctype html>',
    '<html lang="en">',
    '<head>',
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    `<title>${escapeHtml(title)}</title>`,
    `<style>${EXPORT_CSS}</style>`,
    '</head>',
    '<body>',
    `<article class="markdown-body">${bodyHtml}</article>`,
    '</body>',
    '</html>',
    '',
  ].join('\n');
}
