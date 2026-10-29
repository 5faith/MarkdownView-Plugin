# MarkdownView 项目综合需求

## 1. 项目目标

为 VS Code 提供精简的 Markdown 查看与所见即所得编辑插件。使用 Milkdown Crepe 呈现单一 Markdown 画布，文件内容仍由 VS Code 文本文档管理和保存。

插件以可选自定义编辑器方式提供，不接管 `.md` 默认打开行为；用户可以在 VS Code 的“打开方式 / Reopen With”中选择 MarkdownView，亦可继续使用默认文本编辑器查看源码。

## 2. 技术框架

- 扩展宿主：VS Code Extension API、TypeScript。
- 编辑器集成：`CustomTextEditorProvider`，以 VS Code `TextDocument` 作为唯一持久化来源。
- 编辑与渲染：Milkdown Crepe，运行在启用脚本的 VS Code Webview 中。
- 文档同步：Webview 通过消息上报 Markdown，宿主使用 `WorkspaceEdit` 更新文档；VS Code 负责保存、脏状态和撤销/重做。
- 构建：esbuild 分别构建扩展宿主和 Webview；`@vscode/vsce` 生成 VSIX。
- 包管理：使用固定版本 pnpm 及 pnpm 锁文件；VSIX 打包跳过依赖扫描，运行依赖由 esbuild 打包。

## 3. 功能需求

### 3.1 Markdown 编辑与查看

1. 为 `.md` 和 `.markdown` 提供可选的 MarkdownView 自定义编辑器，不替代 VS Code 默认文本编辑器。
2. 支持常见 Markdown 内容：标题、段落、强调、列表、引用、链接、图片、代码块、表格、任务列表、删除线，以及 `:::details` 容器。
3. 默认以只读模式打开，避免浏览文档时误改。
4. 编辑器右上角提供只读锁形按钮和编辑铅笔按钮，显示当前模式；点击后即时切换模式。
5. 进入编辑模式后将焦点交给 Milkdown 编辑视图，支持直接输入和鼠标选择正文文本；鼠标在可编辑文本上显示文本光标。
6. 只读时阻止编辑及宿主文档写入；切换模式期间已排队的编辑消息不得绕过只读保护。
7. 编辑内容通过 `WorkspaceEdit` 同步到 `TextDocument`，沿用 VS Code 保存、撤销和重做行为。
8. 同一文档从其他编辑入口发生变化时，画布同步最新内容，避免相同内容重复回写或丢失修改。

### 3.2 大纲与导航

1. 编辑画布左侧显示当前 Markdown 标题大纲，按标题级别缩进。
2. 点击大纲标题后滚动至对应标题。
3. 标题新增、修改、删除、外部文档更新及编辑器重建后，大纲保持同步。
4. 文档没有标题时显示明确的空状态。

### 3.3 外观与资源

1. 跟随 VS Code 明暗主题，并提供字号设置。
2. 主题、字号及编辑光标颜色使用 VS Code 主题变量。
3. 支持相对路径图片：宿主解析图片路径并转换为 Webview URI，Markdown 文本中的原路径保持不变。
4. 外部链接由 VS Code 打开；相对 Markdown 链接使用 VS Code 打开；页内锚点在当前画布定位。
5. 大纲和编辑画布适配窄窗口。

## 4. 安全与文档同步

- VS Code `TextDocument` 是唯一持久化文档来源，Webview 不直接访问磁盘或写文件。
- Webview HTML 使用 nonce 脚本 CSP；资源限制在扩展、工作区和必要文档目录内。
- 本地图片由宿主通过 `webview.asWebviewUri` 转换，不放开整个文件系统。
- 宿主校验 Webview 消息类型和字段；只读状态下不接受画布内容写入。
- 宿主与 Webview 比较内容，避免同步回环；主题变更如需重建编辑器，应保留文档内容和模式。

## 5. 开发、启动与测试文档

根目录 README 应以中文说明项目定位、项目结构、依赖安装、检查、编译、监听构建、启动、MarkdownView 使用方式和 VSIX 打包。

- 使用 `pnpm install` 安装依赖。
- 使用 `pnpm run check` 检查类型，`pnpm run compile` 编译，`pnpm run watch` 监听构建。
- 使用 `pnpm run dev` 编译打包、安装至项目隔离的 VS Code 测试配置，并打开 `examples/local-test.md`。
- MarkdownView 通过“Reopen With / 打开方式”选取；需要源码断点调试时使用 VS Code F5。
- 使用 `pnpm run package` 打包 VSIX；测试样例、PRD 和开发配置不进入用户 VSIX。
- 本地测试步骤覆盖常见 Markdown、大纲跳转、只读/编辑切换、文本选择、输入同步、保存、撤销/重做、主题与字号。

## 6. 依赖管理与安全

1. pnpm 是项目唯一依赖管理器，固定项目 pnpm 版本并维护唯一锁文件。
2. 构建需要的原生安装脚本采用精确版本白名单，不全局放开安装脚本。
3. 保留经过验证的传递依赖安全覆盖，运行依赖审计。
4. npm 到 pnpm 的迁移后，README、VS Code 启动任务和项目 Copilot 指引中的命令保持一致。

## 7. 不纳入当前范围

- 文件树、标签栏、多窗口、独立文件管理、独立源码/预览分栏。
- 桌面端源码模式、打字机模式、自定义格式工具栏。
- PDF 导出、打印、Mermaid、脚注及额外 Markdown 方言。
- 插件自动接管 `.md` 默认打开行为。

## 8. 综合验收标准

- MarkdownView 可从 VS Code 打开方式中选择，默认文本编辑器仍可使用。
- 首次打开为只读；右上角模式按钮可即时切换；编辑状态下可输入、选择文本且显示文本光标。
- 编辑画布和 VS Code 文本文档双向同步；保存、脏状态、撤销和重做正常。
- 左侧大纲列出标题、按级别显示，点击可定位，文档变化后更新；无标题时显示空状态。
- 图片、链接、锚点、`:::details`、主题和字号按需求工作。
- pnpm 安装、类型检查、构建、VSIX 打包和依赖审计可通过。
- Webview 的 CSP 和本地资源边界有效。
