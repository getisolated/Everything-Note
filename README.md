<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="assets/logotype.svg" width="320" />
    <img src="assets/logo.png" alt="Daftr" width="128" />
  </picture>
</p>

<p align="center">
  A fast, keyboard-driven note-taking app for Windows and macOS.<br />
  Markdown editor, full-text search, folders, tags, backlinks and a graph of your notes — all stored locally.
</p>

<p align="center">
  <a href="https://github.com/getisolated/Daftr/releases/latest">Download</a> ·
  <a href="#features">Features</a> ·
  <a href="#keyboard-shortcuts">Shortcuts</a> ·
  <a href="#connect-an-ai-mcp">AI (MCP)</a> ·
  <a href="#upgrading-from-everything-note">Upgrading from Everything Note</a> ·
  <a href="#development">Development</a>
</p>

<p align="center">
  <img src="assets/screenshot-2.png" alt="Daftr screenshot" width="800" />
</p>

> Daftr was previously published as **Everything Note**. Version 1.0.0 renamed the app; see [Upgrading from Everything Note](#upgrading-from-everything-note).

## Install

### Windows

1. Download `Daftr_<version>_x64-setup.exe` from the [latest release](https://github.com/getisolated/Daftr/releases/latest) (Windows 10/11, 64-bit; WebView2 is included in Windows 11).
2. Run it. The installer is signed with a self-signed certificate, so Windows SmartScreen may ask you to confirm the first time.

### macOS

1. Download `Daftr_<version>_aarch64.dmg` from the [latest release](https://github.com/getisolated/Daftr/releases/latest) (Apple Silicon, macOS 13 Ventura or later).
2. Open it and drag **Daftr** into **Applications**.
3. The macOS build is not notarized yet, so the first launch is refused (« Apple could not verify… »). Open **System Settings → Privacy & Security** and click **Open Anyway** (the button appears after that first attempt), or run `xattr -cr /Applications/Daftr.app` once in a terminal.

### Updates and data

Daftr checks for updates at startup and every hour, and offers them in a popup. Turn on **Settings → Automatic Updates** to download them in the background and install them when the app closes. On macOS the updater replaces `Daftr.app` in place, so the steps above are needed only once.

Your data stays on your machine: notes live in a SQLite database and settings in a JSON file, both under `%APPDATA%\daftr` on Windows and `~/Library/Application Support/daftr` on macOS.

## Features

- **Markdown editor** — CodeMirror 6 with live decorations: headings, bold, italic, code blocks, task lists. GFM tables render as real tables and become editable when the caret enters them (`Tab` / `Shift+Tab` between cells, `/table` to insert one, right-click to add / delete rows and columns). Spreadsheet pastes become tables.
- **Preview** — GitHub-like rendering (tables, task lists, footnotes, `> [!NOTE]` alerts, syntax-colored code, Mermaid diagrams). *Source*, *side by side* with synchronized scrolling, or *Preview*; notes can open rendered by default.
- **Full-text search** — instant search across every note (SQLite FTS5), from the command palette (`Ctrl+Shift+F`). Find & replace inside a note (`Ctrl+F` / `Ctrl+H`) with match case, whole word and regular expressions, and the list of matches.
- **Command palette** — `F1` to search notes, commands and tags.
- **Folders** — a VS Code-like tree: create, rename, delete, drag & drop notes and folders, multi-select (`Ctrl+click` / `Shift+click`), *Move To…*, *Empty*, a color per folder. New notes land in `Inbox`.
- **Tags** — organize notes with tags and filter from the sidebar.
- **Backlinks & graph** — link notes with `[label](Folder/Note title)` (autocompleted) or `note://ID`. A panel under the editor lists the notes linking to the active one; the home page draws an Obsidian-like graph of all links (zoom, pan, drag, click to open, colored by folder). `Ctrl+click` follows a link.
- **Collections** — open folders of markdown files from your disk (a repository's docs, for instance) next to your notes. Files open in tabs, save to disk, reload when changed by another program, and are found by the palette search. `.md` files open with Daftr from the Explorer or the Finder.
- **Tabs** — drag & drop reordering, pinning, session restore.
- **Formatting bar** — a Word-like toolbar reflecting the formatting under the caret. `Alt+T` toggles it; size, style and position are settings.
- **Quick-note overlay** — a global shortcut (`Ctrl+Alt+Q` by default, `⌥⌘Q` on macOS) pops a small always-on-top window anywhere on screen. Notes sent from it are gathered in a single *Quick notes* document, where each one can be copied, edited, deleted or converted into a regular note (filed in *Inbox* if it has no folder).
- **Copy & export** — copy a note as markdown, export it as Markdown, standalone HTML or PDF (A4 pages, rendered like the preview: tables, colored code, Mermaid diagrams). Export a folder, or a multi-selection of notes and folders, as a ZIP of `.md` files or of PDF files.
- **Themes** — Dark (default), Light, GitHub Light, Solarized Light, Violet Light, GitHub Dark Dimmed, or *System* following the OS. `Ctrl+K Ctrl+T` previews them live.
- **Settings** — a VS Code-like settings editor (`Ctrl+,`) with search, categories and reset to default. Every shortcut can be rebound there.
- **System tray / menu bar** — closing the window keeps Daftr running in the tray; optional launch at Windows startup. On macOS it stays in the Dock and the menu bar (`⇧⌘W` closes the window the same way), `⌘Q` quits, and *Launch at login* is optional; the menu bar icon can be turned off in Settings (Daftr keeps running in the Dock).
- **Languages** — English and French; the first launch follows the OS locale.
- **MCP server (AI access)** — an optional local [MCP](https://modelcontextprotocol.io) server lets AI assistants (Claude Code, Claude Desktop, Cursor…) list, search, read, create and edit your notes. It only listens on `127.0.0.1`, requires an access token, and cannot delete notes; notes written by an AI show up in the app at once. See [Connect an AI (MCP)](#connect-an-ai-mcp).

## Keyboard shortcuts

Every shortcut below is a default and can be rebound in **Settings → Keyboard Shortcuts**.

| Windows                              | macOS                        | Action |
| ------------------------------------ | ---------------------------- | ------ |
| `F1`                                 | `F1`                         | Command palette |
| `Ctrl+N`                             | `⌘N`                         | New note |
| `Ctrl+S`                             | `⌘S`                         | Save note |
| `Ctrl+W`                             | `⌘W`                         | Close tab |
| `Ctrl+Tab` / `Ctrl+Shift+Tab`        | `⌃⇥` / `⌃⇧⇥`                 | Next / previous tab |
| `Alt+Ctrl+1-9`                       | `⌥⌘1-9`                      | Jump to tab by index |
| `Alt+P`                              | `⌥P`                         | Pin / unpin tab |
| `Ctrl+Shift+F`                       | `⇧⌘F`                        | Search all notes |
| `Ctrl+F` / `Ctrl+H`                  | `⌘F` / `⌥⌘F`                 | Find / find & replace in the note |
| `Ctrl+B` / `Ctrl+I` / `Ctrl+Shift+K` | `⌘B` / `⌘I` / `⇧⌘K`          | Bold / italic / link |
| `Ctrl+Shift+V`                       | `⇧⌘V`                        | Toggle the preview |
| `Ctrl+K` `V` (chord)                 | `⌘K` `V` (chord)             | Toggle the side-by-side preview |
| `Ctrl+Shift+E`                       | `⇧⌘E`                        | Toggle the sidebar |
| `Alt+T`                              | `⌥T`                         | Toggle the formatting bar |
| `Alt+Z`                              | `⌥Z`                         | Toggle line wrap |
| `Alt+W`                              | `⌥W`                         | Toggle wide mode |
| `Ctrl+K` `Ctrl+T` (chord)            | `⌘K` `⌘T` (chord)            | Theme picker (live preview) |
| `Ctrl+,`                             | `⌘,`                         | Settings |
| `Ctrl+Alt+Q` (global, configurable)  | `⌥⌘Q` (global, configurable) | Toggle the quick-note overlay |

On macOS, `⌘` replaces `Ctrl` and `⌥` replaces `Alt`, with two exceptions: tabs cycle with `⌃⇥` (`⌘Tab` is the system app switcher) and find & replace is `⌥⌘F` (`⌘H` hides the app). In the search panel, *replace all* is `⌥⌘↩`.

On macOS the global shortcut is bound to the physical key position. Until it has been recorded once, Daftr assumes an AZERTY keyboard: the default `⌥⌘Q` is the key labelled Q on an AZERTY layout, which is `⌥⌘A` on a QWERTY one. Recording the shortcut again in **Settings** binds the right key for any layout.

In the overlay: `Enter` sends (`Shift+Enter` = new line) — or, if configured, `Enter` = new line and `Ctrl+Enter` (`⌘↩` on macOS) sends. `Esc` or a click outside hides it; the draft is kept.

## Connect an AI (MCP)

1. Open **Settings → AI (MCP)** and turn on **MCP Server**. Daftr generates an access token and starts the server on `http://127.0.0.1:38427/mcp` (the port can be changed there; the status line tells if it is already taken).
2. Copy the snippet for your client from the same page:
   - **Claude Code**: run the command in a terminal:
     ```bash
     claude mcp add --transport http daftr http://127.0.0.1:38427/mcp --header "Authorization: Bearer <token>"
     ```
   - **Claude Desktop** (needs Node.js): add the entry to `claude_desktop_config.json`, then restart Claude Desktop. It goes through [`mcp-remote`](https://www.npmjs.com/package/mcp-remote):
     ```json
     {
       "mcpServers": {
         "daftr": {
           "command": "npx",
           "args": ["-y", "mcp-remote", "http://127.0.0.1:38427/mcp", "--header", "Authorization:${AUTH_HEADER}"],
           "env": { "AUTH_HEADER": "Bearer <token>" }
         }
       }
     }
     ```
   - **Other clients** (Cursor…): a Streamable HTTP server at the same URL with the header `Authorization: Bearer <token>`.
3. Ask away: *"Summarize my notes tagged meeting"*, *"Add today's decisions to my Project X note"*.

Tools: `list_folders`, `list_notes`, `search_notes`, `get_note`, `list_tags`, `create_note` (into Inbox by default), `update_note`, `append_to_note`. There is no delete tool, and collections (folders of markdown files) are not exposed. **Regenerate** the token to disconnect every configured client. Daftr must be running for the AI to reach your notes.

## Upgrading from Everything Note

Install Daftr over your current version (the in-app updater offers it, or run the installer from the [latest release](https://github.com/getisolated/Daftr/releases/latest)). Nothing to do by hand:

- the installer silently removes the previous *Everything Note* installation, Electron (0.0.11 and earlier) or Tauri (0.0.12);
- on first launch, your notes, settings and collections are moved from `%APPDATA%\everything-note` to `%APPDATA%\daftr`;
- theme, open tabs, sidebar layout and other UI preferences carry over.

## Development

Daftr is an Angular frontend inside a Tauri 2 (Rust) shell, with SQLite for storage.

| Layer | Technology |
|-------|-----------|
| Frontend | Angular 22 (standalone components, signals, OnPush) |
| Editor | CodeMirror 6 with custom markdown decorations |
| Desktop | Tauri 2 (Rust, WebView2 on Windows, WKWebView on macOS), frameless window with a custom title bar on Windows, native traffic lights over the tab bar on macOS |
| Database | SQLite (rusqlite, bundled) with FTS5, WAL mode, cached prepared statements |
| Bindings | Rust → TypeScript types generated by ts-rs (`frontend/src/app/core/bindings`) |
| Build | Tauri bundler (NSIS installer on Windows, DMG on macOS), GitHub Actions CI/CD |

### Prerequisites

- Node.js 24+ and npm
- Rust stable (1.90+)
- Windows: the MSVC toolchain and WebView2 (included in Windows 11)
- macOS: Xcode Command Line Tools (`xcode-select --install`)

### Run, test, build

```bash
# Install dependencies (npm workspaces: the root holds the Tauri CLI, frontend/ the Angular app)
npm install

# Development mode (Angular dev server + Tauri window, Rust rebuilt on change)
npm run dev

# Tests: Angular (vitest) and Rust (also regenerates the TypeScript bindings)
npm test
npm run test:rust

# Release build: Angular + Rust, then the installer
# Windows: src-tauri/target/release/bundle/nsis — macOS: bundle/dmg and bundle/macos in the same folder
# The update signature needs the private key: TAURI_SIGNING_PRIVATE_KEY (path or content)
npm run build
```

### Layout

```
src-tauri/                   # Rust workspace
  crates/
    platform/                # Generic base: logging, poison-tolerant locks, canonical paths
    domain/                  # Pure rules (std only): settings validation, overlay geometry, collection links/graph/search, export names, i18n
    app/                     # Use cases (notes, folders, collections, settings, export) and their ports (traits)
    adapter-sqlite/          # SQLite store: schema, idempotent migrations, FTS5 triggers, queries
    adapter-fs/              # settings.json, collection files, Recycle Bin, ZIP export, scan/watch/search thread
    adapter-mcp/             # Local MCP server (rmcp, Streamable HTTP on 127.0.0.1, bearer token): the AI tools on notes
    adapter-print/           # PDF export: a hidden window prints the page natively (WKWebView / WebView2), the only `unsafe` code
    presentation/            # DTOs exported to TypeScript (ts-rs), IPC errors, event names
    desktop/                 # Tauri shell: IPC commands, main + overlay windows, tray, global shortcut, autostart, updater
      tauri.conf.json        # Bundle, updater endpoint and public key, NSIS hook (removes the Everything Note versions)
      tauri.macos.conf.json  # macOS overrides: DMG bundle, minimum macOS 13
      capabilities/          # Window permissions granted to the renderer

scripts/
  macos-*.swift              # Regenerate the .icns icon, the menu bar icon and the DMG background

frontend/src/app/
  core/
    i18n/                    # I18nService, pure translate(), typed en/fr dictionaries per area
    services/                # Notes, folders, tabs, backlinks, palette, shortcuts, theme, sidebar state
    models/                  # TypeScript interfaces (Note, Folder, Tab, PaletteItem, shortcuts, themes)
    utils/                   # Pure helpers (folder tree, note links, storage migration)
  features/                  # editor, preview, find, backlinks, graph, sidebar, home, tabs, palette, overlay, settings, formatting-bar
  shared/
    codemirror/              # Highlight style, markdown decorations, widgets, link navigation
    context-menu/            # Reusable context menu component
    ui/                      # Themed checkbox, select, confirm dialog, focus-select directive
```

### Releases

Every merge on `main` publishes a release (`.github/workflows/release.yml`). The version is computed from the commits since the last `vX.Y.Z` tag following [Conventional Commits](https://www.conventionalcommits.org/): `type!:` / `BREAKING CHANGE` bumps the major, `feat:` the minor, anything else the patch. A squash-merged PR counts as one commit whose title is the PR title, so **the PR title decides the bump**. The CI checks (Angular tests, `cargo fmt`, `clippy`, Rust tests, on Windows and macOS) must pass first.

Two jobs build the app: `build-windows` (NSIS installer) and `build-macos` (Apple Silicon DMG and the updater archive). Each produces its artifacts and their signatures. The `release` job then merges them into a single `latest.json` (`windows-x86_64` and `darwin-aarch64` entries) that the app queries to offer updates. If one platform fails, the whole release is blocked.

For the secrets and the update manifest, see the header comments of `.github/workflows/release.yml` and `scripts/update-manifest.mjs`.

## License

MIT
