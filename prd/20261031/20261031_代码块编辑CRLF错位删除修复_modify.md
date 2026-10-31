# 修改记录：代码块编辑 CRLF 错位删除修复

## 2026-10-31 — Webview 行尾归一化修复偏移映射

- `src/webview/main.ts`：
  - 新增 `hostUsesCrLf` 状态与 `normalizeMarkdownEol()`（`\r\n`/`\r` → `\n`），并注释说明根因（PM 保留 `\r` 字符而 CM 折叠 `\r\n`，破坏 Crepe CodeMirrorBlock 的 1:1 偏移映射）。
  - `applyHostUpdate`：入口处记录文档是否 CRLF 并归一化后再赋给 `latestMarkdown` / `sourceEditor.value`。
  - `postChange`：回写宿主前按 `hostUsesCrLf` 将 `\n` 还原为 `\r\n`（仅出站转换，内部状态保持 LF）。
- 浏览器 harness 验证（真实 dist 产物 + acquireVsCodeApi shim + 宿主回环模拟 + IntersectionObserver 垫片）：
  - 修复前复现：CRLF 文档代码块内 `fmt.Println("Hello, 世界")` 被拆为 `Hello,` 与 `  世界")` 两行、空行未删除、回写损坏。
  - 修复后：同一操作序列下 `Hello, 世界` 完整、空行删除准确（首次退格删自动缩进、第二次删换行，行为正确）；回写 markdown 与编辑器内容一致且保持 CRLF；整篇回写与原文件对比仅存在 milkdown 既有的列表标记 `-`→`*` 规范化差异。
  - LF 文档回归：删除精确落在光标处（无漂移），回写保持 LF。
- `pnpm run check` 通过；`pnpm run package` 通过（114 文件，2.87 MB）；`git diff --check` 通过。

## 验证

- `pnpm run check`
- `pnpm run package`
- `git diff --check`
- harness 交互回归（CRLF/LF 两类文档 × 点击/Enter/退格序列 × 宿主回环）
