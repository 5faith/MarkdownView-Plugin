# 修改记录：Markdown 扩展语法支持

## 2026-10-29 — 扩展语法移植

- 为图片、HTML details、GitHub 告警、定义列表和 Mermaid 图表补齐 VS Code Webview 解析与呈现。
- 保持扩展语法和 Mermaid 源文在 Markdown 文档中的可往返保存。
- 在本地测试 Markdown 示例中提供对应验收内容。
- 修复 Milkdown 自定义节点 schema 上下文未注入的问题：注册完整 `$nodeSchema` 插件元组，确保 schema Context 在节点插件前创建。
