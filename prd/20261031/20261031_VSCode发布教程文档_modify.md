# 修改记录：VS Code 发布教程文档

## 2026-10-31 — 新增根路径发布教程

- 新增根路径 `PUBLISH.md`：包含 Azure DevOps 发布者与 PAT 创建、`pnpm exec vsce login/publish` 用法、发布前检查清单（README 绝对图片地址、repository/icon/版本号）、`pnpm run package` 打包与本地 VSIX 安装验证、Marketplace 管理页操作、Open VSX 可选发布、常见问题表与本项目命令速查表。
- 教程内容与本项目实际构建对齐：esbuild 预打包 + `--no-dependencies`、Mermaid 运行时单独分包、`.vsix` 产物不入库。

## 验证

- `git diff --check`
