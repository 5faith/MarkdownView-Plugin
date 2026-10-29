# 修改记录：Webview 按需分包

## 2026-10-29 — 减少 Webview 初始脚本体积

- Mermaid 构建为独立压缩运行时脚本，仅含 Mermaid 图表的文档才会加载。
- 主 Webview bundle 启用压缩，保持单个 nonce 脚本入口，避免大量运行时 chunk 请求。
- 通过受限的 Webview URI 加载 Mermaid 运行时，沿用 nonce CSP 和本地资源边界。
