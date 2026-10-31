# Repository Instructions

## New requirements and change records

For each new requirement, place its documents in a date directory under `prd/`:

```text
prd/YYYYMMDD/
├── YYYYMMDD_需求名称.md
└── YYYYMMDD_需求名称_modify.md
```

Use the local calendar date in `YYYYMMDD` format for the directory and both filenames. Use the same date and requirement name in the specification and its `_modify.md` record. Put the requirement specification in the first Markdown file and record its implementation changes in the `_modify.md` file. Each requirement has exactly one corresponding modification record; update that record as the requirement changes rather than creating another one.

## Project overview

VS Code custom-editor extension: WYSIWYG Markdown viewing/editing built on Milkdown Crepe 7.22.x (ProseMirror + embedded CodeMirror code blocks). Branch: `vscode`.

- `src/extension.ts` — activation/commands; `src/provider.ts` — `CustomTextEditorProvider`: document sync, image URI map, link opening, webview HTML/CSP.
- `src/shared/protocol.ts` — the single host↔webview message contract; change both sides together.
- `src/webview/` — runs in the webview: `main.ts` (editor, toolbars, popovers, sync), `markdown-extensions.ts` (remark transforms + custom schemas), `mermaid-view.ts` (Mermaid NodeView/queue/cache), `markdown-blocks.ts` (safe source restore), `usecase-diagram.ts`, `style.css`.
- `examples/local-test.md` is the manual test document; `PUBLISH.md` the marketplace guide; `.vscodeignore` excludes `src/**` (marketplace icon must stay at repo-root `assets/`).

## Commands

- `pnpm run check` — `tsc --noEmit`; always run before finishing.
- `pnpm run compile` — esbuild → `dist/extension.js`, `dist/webview.js`, `dist/mermaid.js`, `dist/webview.css`.
- `pnpm run package` — compile + `vsce package --no-dependencies`.
- `pnpm run dev` — compile + package + install the VSIX into an isolated test VS Code (`.vscode-test/`) and open `examples/local-test.md`. Merely restarting VS Code does NOT update the installed build.

## Hard-won constraints (do not break)

- **CRLF normalization**: host markdown arrives as CRLF on Windows (`core.autocrlf=true`). The webview must normalize to LF at ingest (`normalizeMarkdownEol`) and restore CRLF on outgoing `postChange` (`hostUsesCrLf`). ProseMirror keeps `\r` as content inside code blocks while CodeMirror folds `\r\n` into one line break — without this the code-block CM↔PM offset mapping drifts and edits delete the wrong characters.
- **Link/image click interception must stay on the `document` capture phase** in `main.ts`. VS Code webview host scripts race ahead of bubble-phase listeners and open links before `preventDefault`.
- **Echo-loop guards**: provider `lastKnownContent` and webview `lastAppliedMarkdown` comparisons prevent update ping-pong. The provider re-posts the images map after every applied edit; `refreshProxiedImageSources()` must re-point relative-path `<img>` src (Crepe image views bind `proxyDomURL` only at render time).
- **Do not enable Crepe `LinkTooltip`**: its confirm path drops relative hrefs, and its `ToggleLink` command key collides with preset-commonmark's (the toolbar link flow depends on the latter).
- **Mermaid**: rendering goes through the viewport-proximity queue + theme-keyed cache in `mermaid-view.ts`. IntersectionObserver is unreliable in webviews — do not reintroduce it. NodeViews that own their DOM must implement `ignoreMutation` (missing one corrupts the whole document in edit mode).
- **URL validation** for user-entered link/image addresses: relative paths and `mailto:`/`data:image/*` allowed; http/https must reject loopback/private/reserved hosts (`isForbiddenHost`); every other scheme (`javascript:` etc.) rejected.

## Verification approach

No unit tests. Verify webview behavior with a browser harness: serve the repo root over local HTTP, shim `acquireVsCodeApi` (capture `postMessage`, simulate host echo/update), load the real `dist/webview.js` with a copy of the provider HTML shell, then drive it with browser automation. In hidden panes IntersectionObserver never fires (needs a shim) and rAF may pause (polyfill with setTimeout). Finish with `pnpm run check`, `pnpm run package`, `git diff --check`, and a `pnpm run dev` manual pass.

## Known pre-existing issue

Crepe's image-block schema stores the zoom ratio in the alt slot: every markdown round-trip rewrites `![alt](src)` to `![1.00](src)` (alt text lost). Fixing it needs an image-block schema override; documented in `prd/20261031/`.
