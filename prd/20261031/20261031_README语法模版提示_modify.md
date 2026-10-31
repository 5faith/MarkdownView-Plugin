# 修改记录：README 语法模版提示

## 2026-10-31 — README 增加语法模版入口

- README「使用方式」章节新增一条：语法模版见 [examples/local-test.md](./examples/local-test.md)，覆盖插件支持的全部扩展语法与 Mermaid 图表写法，可直接复制为写作模版。
- 采用仓库内相对链接 `./examples/local-test.md`，与 README 中 [PUBLISH.md](./PUBLISH.md) 等相对链接风格一致；在 GitHub 上即解析为 `blob/vscode/examples/local-test.md`。
- 插入位置：「使用方式」列表中「Text Editor 切回」之后、「本地调试」之前，保持指引类条目聚拢。

## 验证

- `git diff --check`
