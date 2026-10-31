# VS Code 扩展发布教程

本教程说明如何将 MarkdownView 发布到 VS Code 扩展市场（Visual Studio Marketplace），并附 Open VSX 发布作为可选步骤。命令均在仓库根目录执行。

## 一、准备工作（仅首次）

### 1. 创建发布者（Publisher）

1. 访问 [Azure DevOps](https://dev.azure.com/)，注册/登录一个组织（Organization）。
2. 进入 [Marketplace 发布者管理页](https://marketplace.visualstudio.com/manage)，创建发布者。
3. 发布者 ID 必须与 `package.json` 中的 `publisher` 字段一致（本项目为 `5faith`）。

### 2. 创建个人访问令牌（PAT）

1. 在 Azure DevOps 页面右上角进入 **User settings → Personal Access Tokens**。
2. 选择 **New Token**，配置：
   - **Organization**：All accessible organizations
   - **Scopes**：Custom defined → **Marketplace → Manage**
   - 有效期按需选择（到期后需重新生成）。
3. 创建后立即复制令牌（只显示一次）。

### 3. 登录 vsce

```bash
pnpm exec vsce login 5faith
```

按提示粘贴 PAT。令牌保存在本地 keytar 中，过期后重新 `login` 即可。

## 二、发布前检查清单

- [ ] `package.json`：`publisher`、`repository`、`engines.vscode`、`license` 字段完整；`description`、`categories`、`keywords` 完善。
- [ ] **README.md**：市场详情页直接渲染该文件；所有图片必须使用**绝对 URL**（相对路径图片会导致打包报错或市场显示破图），必要时用 `--baseImagesUrl` 指定基础地址。
- [ ] 版本号：按语义化版本更新 `package.json` 的 `version`（patch / minor / major）。
- [ ] 质量检查：`pnpm run check` 与 `pnpm run package` 通过。
- [ ] （建议）补充 `icon` 字段指向 128×128 以上的 PNG 图标，市场与扩展列表会展示。

## 三、打包与本地验证

```bash
# 编译宿主与 Webview（Mermaid 运行时单独分包），生成 markdownview-plugin-<版本>.vsix
pnpm run package

# 查看包内容，确认没有把无关文件打进去
pnpm exec vsce ls

# 本地安装验证（可选）
code --install-extension markdownview-plugin-0.1.0.vsix
```

说明：本项目依赖已由 esbuild 打进产物，因此打包使用 `--no-dependencies` 跳过依赖扫描（见 `package.json` 的 `package` 脚本与 `esbuild.cjs`）。`.vsix` 产物已加入 `.gitignore`，不要提交到仓库。

## 四、发布到 Marketplace

```bash
# 补丁版本自动 bump（0.1.0 → 0.1.1）并发布
pnpm exec vsce publish patch

# 或指定级别 / 手动带令牌
pnpm exec vsce publish minor
pnpm exec vsce publish major
pnpm exec vsce publish -p <你的PAT>
```

发布后进入 [发布者管理页](https://marketplace.visualstudio.com/manage) 查看状态：

- 新发布者首次发布可能进入人工审核，显示延迟数分钟到数小时属正常现象。
- 更新版本直接重复 `publish`；撤销版本用管理页的 **Unpublish**（谨慎使用，已安装用户不会自动回滚）。
- 弃用扩展可使用 **Deprecate**，并可在 `package.json` 中配置替代扩展。

## 五、（可选）发布到 Open VSX

Open VSX 是 VSCodium、Cursor 等非官方发行版使用的镜像市场：

1. 在 [open-vsx.org](https://open-vsx.org/) 注册并创建同名命名空间 `5faith`。
2. 创建访问令牌（首页头像 → Settings → Access Tokens）。
3. 发布：

```bash
pnpm dlx ovsx publish -p <openvsx令牌>
```

## 六、常见问题

| 问题 | 处理 |
| --- | --- |
| `ERROR: Missing publisher name` | `package.json` 缺少 `publisher` 字段 |
| `Make sure to edit the README.md file...` 占位 README | README 不能是模板默认内容，需填写真实介绍 |
| README 相对路径图片报错 | 改用绝对 URL，或打包时加 `--baseImagesUrl` / `--baseContentUrl` |
| PAT 失效 / 401 | 重新生成 PAT 并 `pnpm exec vsce login` |
| `vsce` 报大量 node_modules 依赖错误 | 确认使用 `--no-dependencies`（本项目脚本已内置） |
| 版本号未变化被拒绝 | `vsce publish` 要求版本号严格递增，先 bump 再发 |

## 七、本项目命令速查

| 目的 | 命令 |
| --- | --- |
| 类型检查 | `pnpm run check` |
| 本地打包 VSIX | `pnpm run package` |
| 开发调试安装 | `pnpm run dev` |
| 发布到 Marketplace | `pnpm exec vsce publish patch` |
| 发布到 Open VSX | `pnpm dlx ovsx publish -p <令牌>` |
