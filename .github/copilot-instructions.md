# Copilot Instructions

## Architecture

The extension is a TypeScript VS Code `CustomTextEditorProvider` with a Milkdown Crepe webview. The extension host owns VS Code document edits, configuration/theme events, local resource URI conversion, and link opening; the webview owns the editable canvas. The VS Code `TextDocument` is the persisted source of truth. See the MVP contract in [the viewer requirement](../prd/20261026/20261026_markdownview项目需求.md); [the original porting notes](../prd/20261026/20261026_vscode-md-viewer.md) describe the source desktop application and are background material.

## Build and validation

- `pnpm install` — install dependencies.
- `pnpm run dev` — compile, package, install into an isolated VS Code profile, and open the local Markdown sample.
- `pnpm run check` — TypeScript-check the host and webview.
- `pnpm run compile` — bundle the extension host and webview.
- `pnpm run watch` — rebuild both bundles as files change.
- `pnpm run package` — compile and produce an installable VSIX.
- Press **F5** to launch an Extension Development Host for source debugging; the launch configuration compiles first.
- VSIX packaging uses `vsce package --no-dependencies` because esbuild bundles runtime dependencies and vsce's default dependency scan invokes npm, which does not support pnpm's node_modules layout.
- For manual end-to-end checks, open `examples/local-test.md` in the Extension Development Host with **Reopen With > MarkdownView**; the README lists the edit/save/undo/theme verification steps.

There is no automated test suite or single-test command configured yet.

## Repository-specific conventions

- Keep the build split in `esbuild.cjs`: host output is CommonJS and treats `vscode` as external; the browser webview is an IIFE bundle with its styles and font assets.
- Keep host/webview message shapes in `src/shared/protocol.ts`. Validate incoming webview messages before using them.
- Apply webview Markdown changes to the matching `TextDocument` through `WorkspaceEdit`; suppress document-change echoes by comparing the latest content. Do not read or write Markdown files directly from the webview.
- Keep Markdown image paths unchanged. Convert local paths to `webview.asWebviewUri` for display, and keep `localResourceRoots` limited to extension assets, workspace/document directories, and only the image directories needed by referenced resources.
- Generate webview HTML with a nonce-based script CSP. Do not weaken the resource boundary to make a missing image or script load.
- Crepe is a plain instance, not a reactive proxy. Use `replaceAll` for host-originated content updates and recreate Crepe when the CodeMirror theme changes.
- The interface is a single Milkdown WYSIWYG canvas, not a source/preview split or desktop-app shell. Keep theme and font changes tied to VS Code settings/theme events.
- Use the Milkdown container plugin and stylesheet for `:::details`; do not add desktop-only printing/export behavior to the webview.
