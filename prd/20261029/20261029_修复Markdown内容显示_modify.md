# 修改记录：修复 Markdown 内容显示

## 2026-10-29 — 图片、数学公式、Mermaid 和选区显示

- 为 ProseMirror 文本选区增加 VS Code 主题高亮颜色和可见回退色。
- 移除 Crepe Latex 功能的禁用项，恢复行内和块级数学公式渲染。
- 将本地测试中的图片从围栏代码示例改为真实 Markdown 图片，并保留本地资源和 URL 图片示例。
- 在 Markdown AST 转换阶段将 `mermaid` 代码围栏转换为独立节点，避免被 commonmark 普通代码块解析器优先匹配。
