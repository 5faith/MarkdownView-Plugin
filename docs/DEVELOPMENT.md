# 开发文档

面向贡献者的开发说明。产品介绍与语法展示见 [README](https://github.com/5faith/MarkdownView-Plugin/blob/vscode/README.md)，市场发布流程见 [PUBLISH.md](../PUBLISH.md)。

## 项目结构

```text
.
├── .vscode/
│   ├── launch.json       # F5 启动 Extension Development Host
│   └── tasks.json        # 启动前编译任务
├── assets/
│   └── screenshots/      # README 引用的界面截图（不进 VSIX）
├── docs/
│   └── DEVELOPMENT.md    # 本文件
├── examples/
│   ├── local-test.md     # 全语法示例与本地验证文档
│   └── assets/           # 示例引用的本地图片
├── harness/              # 浏览器验证 harness（本地回归用，不进 VSIX）
├── prd/                  # 产品需求和设计文档（按日期归档）
├── src/
│   ├── extension.ts      # 扩展激活、命令和 VS Code 事件
│   ├── provider.ts       # 自定义文本编辑器、文档同步和 Webview 安全边界
│   ├── shared/
│   │   └── protocol.ts   # 扩展宿主与 Webview 的消息类型
│   └── webview/
│       ├── main.ts               # Milkdown 初始化、编辑和消息处理
│       ├── markdown-extensions.ts # 告警、折叠内容、定义列表等扩展
│       ├── mermaid-view.ts       # Mermaid schema、NodeView、渲染队列与缓存
│       ├── mermaid-runtime.ts    # 按需加载的 Mermaid 运行时入口
│       ├── markdown-blocks.ts    # 源码恢复用的安全 Markdown 块拆分器
│       ├── usecase-diagram.ts    # usecase-beta 到 Mermaid flowchart 的兼容转换
│       └── style.css             # Webview 编辑画布样式
├── esbuild.cjs           # 扩展宿主与 Webview 的构建配置
├── package.json          # 扩展清单、依赖及 pnpm 命令
├── pnpm-lock.yaml        # pnpm 依赖锁定文件
├── pnpm-workspace.yaml   # pnpm 构建脚本白名单
├── PUBLISH.md            # VS Code 市场发布教程
├── tsconfig.json         # TypeScript 类型检查配置
└── .vscodeignore         # VSIX 打包排除规则
```

扩展宿主通过 `CustomTextEditorProvider` 使用 VS Code `TextDocument` 作为文档来源；Milkdown 运行在 Webview 中。Webview 不直接读写文件，本地图片路径由宿主转换为受限的 Webview URI。

## 开发环境

- 安装 Node.js 和 pnpm 10.33.2（可使用 Corepack：`corepack enable`）。
- 安装 VS Code 1.90 或更高版本。

在仓库根目录打开 PowerShell，安装依赖并检查、编译：

```powershell
pnpm install
pnpm run check
pnpm run compile
```

开发过程中需要自动重新构建时，运行：

```powershell
pnpm run watch
```

## 启动插件

在项目根目录的终端运行以下命令，编译并打包插件，将其安装到项目专用的 VS Code 测试配置中，然后打开测试 Markdown 文件。专用配置可避免普通 VS Code 窗口复用或其他已安装扩展的干扰：

```powershell
pnpm run dev
```

在新打开的 VS Code 窗口中，右键 Markdown 文件标签页，选择 **Reopen With... / 打开方式... → MarkdownView**，即可在 Milkdown 画布中查看 Markdown。编辑器顶部提供 **只读**、**编辑** 和 **源码** 三种模式；源码模式直接编辑 Markdown，并同步写入 VS Code 文本文档。也可以从命令面板执行 **MarkdownView: Open WYSIWYG Editor** 打开当前活动的 Markdown 文件。

`pnpm run dev` 安装的是当前源码构建出的 VSIX；源码变更后再次运行该命令即可更新测试版本。需要断点调试源码时，可在 VS Code 中按 **F5** 启动 Extension Development Host。

MarkdownView 不会取代默认文本编辑器；需要查看 Markdown 源码时，使用 **Reopen With... / 打开方式... → Text Editor** 切回文本编辑器。

## 浏览器 harness（可选）

不启动 VS Code 也可以在真实浏览器中回归 Webview 行为（复现 ProseMirror / Mermaid / 折叠块等问题、做修复前后对比）：

```powershell
node harness/server.mjs 14230
```

然后访问 `http://127.0.0.1:14230/harness/host.html`。页面会加载真实的 `dist/webview.js`（先执行 `pnpm run compile`），内置 `acquireVsCodeApi` shim 模拟宿主消息（含只读模式拒绝写回并回传旧文档的路径），测试文档覆盖折叠块、告警块、表格、Mermaid、定义列表与数学公式。`harness/` 不参与 VSIX 打包。

## 本地测试

1. 在项目根目录执行 `pnpm install`，再执行 `pnpm run check` 和 `pnpm run compile`。
2. 执行 `pnpm run dev`，在独立的 VS Code 测试配置中打开 `examples/local-test.md`。
3. 通过 **Reopen With... / 打开方式... → MarkdownView** 打开示例文件，检查标题、列表、表格、任务列表、代码块、本地与 URL 图片、`<details>` 折叠内容、5 种告警块、定义列表、行内/块级数学公式和 Mermaid 图表是否正常渲染。只读和编辑模式下视口内的 Mermaid 图表应即时渲染，滚动到其余图表时逐个显示且过程不卡顿；编辑模式默认只显示即时预览，点击图表底部"Mermaid 源码"展开源码面板，修改源码停顿后预览更新，输入过程中预览不闪烁错误，源码暂时无效时旧图保留并显示提示，再点击折叠恢复纯预览。
4. 确认左侧大纲显示文档标题，点击标题可滚动到对应位置；首次打开时画布为只读，尝试输入不会修改内容。
5. 确认左侧大纲从窗口顶部开始，顶部栏从大纲右侧延伸至窗口右边缘；大纲和正文内容从顶部栏下方并排开始。拖动大纲右边缘调整宽度，并用键盘左右方向键微调，确认顶部栏和正文位置同步变化。使用顶部 **编辑** 模式；检查格式工具栏出现，且可插入标题、行内格式、引用、四种列表、表格、代码块、折叠块、图片和链接；悬停块手柄并点击加号，确认块插入菜单出现，选择菜单项后对应内容插入且仍可继续编辑。大窗口下编辑区应占满大纲右侧的可用宽度；小于最小宽度时保留 40rem 并允许横向滚动。编辑器会自动获得焦点，可直接输入文字。拖动鼠标选择文本，确认选区背景清晰可见、选区格式工具栏出现。修改文字或列表项后，确认 VS Code 显示未保存状态；按 **Ctrl+S** 保存。
6. 切换到 **源码** 模式，确认 Markdown 以无边框画布显示；不修改内容切回 **只读** 或 **编辑**，确认切换立即完成。再修改源码并确认 VS Code 文档同步更新，切回其他模式时确认加载指示出现并在渲染完成后消失，且内容完整；点击左侧大纲标题可定位源码对应行。
7. 通过 **Reopen With... / 打开方式... → Text Editor** 查看 Markdown 源码，确认修改已写回；再切回 MarkdownView，确认内容仍在。
8. 在设置中修改 `markdownView.fontSize`，并切换 VS Code 明暗主题，确认字号和编辑器主题随设置更新。
9. 在画布编辑模式中执行撤销和重做，确认文档变更能随之恢复和重放；切换到 **只读** 模式后确认画布和源码均不能修改。

## 打包

在仓库根目录运行：

```powershell
pnpm run package
```

此命令先编译扩展宿主和 Webview，再使用 `vsce` 生成可安装的 `.vsix` 文件。依赖已由 esbuild 打包进扩展产物，因此 VSIX 打包时跳过依赖扫描。Mermaid 运行时单独打包，仅当图表滚动到可视区域时才由 Webview 加载。输出文件默认命名为 `markdownview-plugin-<版本号>.vsix`，保存在仓库根目录；该构建产物已加入 `.gitignore`。

## 发布

发布到 Visual Studio Marketplace 与 Open VSX 的完整流程（发布者与 PAT 准备、发布前检查清单、`vsce publish` 用法、常见问题）见 [PUBLISH.md](../PUBLISH.md)。
