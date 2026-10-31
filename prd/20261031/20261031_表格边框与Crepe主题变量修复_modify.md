# 修改记录：表格边框与 Crepe 主题变量修复

## 2026-10-31 — 映射 Crepe 主题变量并加强表格边框

- 定位根因：产物 CSS 中共 28 个 `--crepe-color-*`/`--crepe-font-*`/`--crepe-shadow-*`/`--crepe-base-font-size` 变量被引用但从未定义，表格单元格的 `color-mix` 边框因此整体失效。
- 在 `src/webview/style.css` 的 `:root` 中将该组变量统一映射到 VS Code 主题变量（编辑器前景/背景、控件、侧边栏、焦点边框、git 增删配色等），明暗主题自适应；`--crepe-base-font-size` 跟随字号设置。
- 表格单元格边框加强为编辑器前景色 40% 透明度，表头增加 6% 前景色底色，明暗主题下均清晰可辨。
- 未引入 Crepe 官方 `crepe.css`/`crepe-dark.css` 配色，避免米色系配色覆盖 VS Code 画布。

## 验证

- `pnpm run check`
- `pnpm run package`
- `git diff --check`
