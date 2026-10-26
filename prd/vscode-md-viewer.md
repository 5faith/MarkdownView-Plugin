# MarkdownView 项目总结 & VS Code Markdown 查看插件移植方案

> 用途：把 MarkdownView（Tauri 桌面端）的编辑器内核与样式，移植成一个 VS Code 只读 Markdown 查看插件。
> 日期：2026-10-26

## 1. 项目概况

MarkdownView 是一个 Typora 风格的桌面 Markdown 编辑器：

- **技术栈**：Tauri 2（Rust）+ Vue 3 `<script setup>` + Pinia + Milkdown Crepe 7.22 + CodeMirror 6 + marked。
- **编辑体验**：所见即所得（Crepe）、源码模式（textarea）、阅读模式、打字机模式、大纲、多标签、文件树、拖放、多窗口。
- **内容能力**：GFM（表格 / 任务列表 / 删除线）、代码块高亮（CM6）、图片粘贴落盘、`:::details` 折叠容器、LaTeX（Crepe 默认特性）。
- **样式**：`prd/style.md`（Drake 契约）为唯一标准；明暗双主题；全站 rem 缩放。
- **导出**：markdown → marked → 隐藏 iframe 打印为 PDF。
- **便携**：数据目录默认在 exe 旁 `data/`，可由 `data-dir.txt` 覆盖，不可写时回退系统目录。

其中**对 VS Code 插件有价值的只有四块**：Crepe 的初始化与防回环同步、样式体系（骨架 + 主题变量）、图片路径处理、`: ::details` 容器。文件树 / 标签栏 / 菜单 / 多窗口 / 状态栏都属于桌面壳，移植时全部丢弃。

## 2. 与移植相关的目录

| 路径 | 作用 |
| --- | --- |
| `src/composables/useMilkdown.ts` | Crepe 生命周期、双向同步、只读、打字机、图片钩子 |
| `src/shared/editor.ts` | `currentEditor` 单例 + `runFormat` 统一格式命令入口（可编辑时才需要） |
| `src/shared/cmTheme.ts` | 代码块高亮（明暗两套 CM6 HighlightStyle） |
| `src/styles/global.scss` | 与主题无关的骨架 + `--crepe-*` 变量映射 + 排版尺度 |
| `src/styles/themes/{light,dark}.scss` | 主题变量层（`light` 用 `:root`，`dark` 用 `html[data-theme='dark']`） |
| `src/utils/localImage.ts` | 图片路径解析 + 显示 URL 转换（`toDisplayUrl` 是唯一入口） |
| `src/utils/imageStore.ts` | 粘贴/插入图片落盘（只读插件不需要） |
| `src/composables/useExportPdf.ts` | PDF 导出的样式内联逻辑（可参考，webview 里不能直接 print） |

## 3. 四条核心链路

### 3.1 编辑器同步（防回环）

```ts
let lastSynced = store.content

// 编辑器 → 外部
crepe.on((l) => l.markdownUpdated((_ctx, md) => {
  if (md === lastSynced) return
  lastSynced = md
  store.setContent(md)
}))

// 外部 → 编辑器
watch(() => store.content, (md) => {
  if (md === lastSynced) return
  lastSynced = md
  crepe.editor.action(replaceAll(md))
})
```

两条路径都必须更新 `lastSynced`，漏一处就会回环或丢字。**只读插件只需要第二条**，并且可以直接省掉 `lastSynced`（文档变更 → `replaceAll` 即可，没有回写）。

### 3.2 格式命令统一入口

`runFormat(kind)` 同时实现所见即所得（Crepe 命令）与源码模式（改 textarea 文本 + 前缀 toggle）。工具栏、菜单、快捷键都只调它。**只读插件不需要整个文件**，但 `editor.ts` 里的几个技巧值得记住：

- 链接 mark 设 `inclusive: false`，在链接首尾输入的文字不会被吸进链接。
- 空选区插入链接时直接插入带 mark 的「链接文本」，`toggleMark` 在空选区只写 stored mark，界面无变化。
- 列表互转要连同每个 item 的 `listType` attr 一起改，否则会被 `MILKDOWN_KEEP_LIST_ORDER` 改回去。

### 3.3 图片

约定：**markdown 里永远存相对路径**（`assets/screenshot.png`），只有显示时才转 URL。

- Tauri：`convertFileSrc` → `asset.localhost`。
- 相对/绝对路径解析、`%20`/括号转义、URL 判断都在 `localImage.ts`。
- 粘贴/插入图片经 `saveImageFile` 落盘到 md 同级图片目录（默认 `assets/`，可配置），重名加时间戳。

VS Code 里把 `convertFileSrc` 换成 `webview.asWebviewUri` 即可，其余路径逻辑可原样复用。

### 3.4 样式体系

三层，移植时原样搬运：

1. **尺度**：`html { font-size: var(--text-size) }`（默认 14px）。除 1px 边框外全部 rem，改字号只改 `--text-size`。
2. **骨架**：`global.scss` 定义 `.milkdown` 下各节点的排版，并把 `--crepe-*` 映射到自己的主题变量。
3. **主题**：`light.scss` / `dark.scss` 只放颜色变量，切换靠 `data-theme`，组件里禁止写 `[data-theme='dark']` 分支。

正文宽度：`--prose-width: clamp(55.714rem, 72vw, 85.714rem)`（约 780px → 72vw → 1200px）。

## 4. Tauri 能力 → VS Code 对照

| MarkdownView（Tauri） | VS Code 插件 |
| --- | --- |
| `WebviewWindow` / `App.vue` | `WebviewPanel` 或 `CustomReadonlyEditorProvider` |
| `plugin-fs` 读写盘 | `TextDocument.getText()` / `workspace.fs` |
| `plugin-fs` watch | `workspace.onDidChangeTextDocument` + `createFileSystemWatcher` |
| `plugin-dialog` | `window.showOpenDialog` |
| `convertFileSrc`（asset 协议） | `webview.asWebviewUri` |
| 主题设置 + `data-theme` | `window.activeColorTheme` + `onDidChangeActiveColorTheme` |
| 设置弹窗（字体/字号/图片目录） | `contributes.configuration` |
| `window` 键盘监听 | 只读查看器不需要；需要时用 webview 内监听或 `keybindings` |
| 文件树 / 标签 / 状态栏 / 菜单 / 多窗口 / 单实例 / 拖放 | 由 VS Code 提供，删除 |
| iframe `print()` 导 PDF | webview 不支持打印（见 §7） |
| `lastSynced` 双向同步 | 只保留「文档 → 编辑器」单向 |

## 5. 最小可用插件设计

### 5.1 形态

用 **`CustomReadonlyEditorProvider`**：注册一个只读 custom editor，`.md` 通过「打开方式 / Reopen With」进入，不抢默认编辑器。

```json
"contributes": {
  "customEditors": [{
    "viewType": "markdownView.editor",
    "displayName": "MarkdownView",
    "selector": [{ "filenamePattern": "*.md" }],
    "priority": "option"
  }],
  "commands": [{ "command": "markdownView.open", "title": "MarkdownView: 打开预览" }],
  "configuration": {
    "markdownView.fontSize": { "type": "number", "default": 14 },
    "markdownView.codeTheme": { "type": "string", "enum": ["auto", "light", "dark"], "default": "auto" }
  }
}
```

想省事也可以先用 `window.createWebviewPanel` + 一个命令做原型，确认渲染没问题再换成 custom editor（多约 40 行样板代码）。

### 5.2 目录

```
markdown-view-vscode/
├─ package.json
├─ src/
│  ├─ extension.ts        # activate：注册 provider / 命令
│  ├─ provider.ts         # CustomReadonlyEditorProvider
│  ├─ html.ts             # CSP + nonce + asWebviewUri 注入
│  ├─ images.ts           # extractImageSrcs 的复用 + 路径 → webview URI
│  └─ webview/
│     ├─ main.ts          # Crepe 初始化、消息协议、主题重建
│     ├─ cmTheme.ts       # 从本项目拷贝
│     └─ styles/          # global.scss + themes/*.scss（原样拷贝）
├─ vite.config.ts         # 两次构建：host CJS / webview IIFE
└─ dist/
```

webview 侧**不要**搬 Vue 和 Pinia：只读场景用约 100 行纯 TS 就够，组件、store、composable 都是负担。等要做可编辑版本再考虑。

### 5.3 消息协议

host → webview：

```ts
{ type: 'update', markdown: string, images: Record<string, string>, theme: 'light' | 'dark', fontSize: number }
{ type: 'theme', theme: 'light' | 'dark' }
```

webview → host：

```ts
{ type: 'ready' }
{ type: 'openLink', href: string }
```

webview 收到 `update`：内容变了 → `replaceAll`；`theme` 变了 → 销毁重建 Crepe（代码块的 CM6 高亮主题在创建时绑定，改不了）。

### 5.4 webview 初始化

```ts
const crepe = new Crepe({
  root,
  defaultValue: markdown,
  features: {
    [Crepe.Feature.BlockEdit]: false,
    [Crepe.Feature.Toolbar]: false,
    [Crepe.Feature.Placeholder]: false,
    [Crepe.Feature.LinkTooltip]: false,
  },
  featureConfigs: {
    [Crepe.Feature.CodeMirror]: { theme: cmThemeExtension(theme) },
    [Crepe.Feature.ImageBlock]: {
      proxyDomURL: (url) => imageMap[url] ?? url,
    },
  },
})
crepe.addFeature((editor) => { editor.use(containerPlugin) })
await crepe.create()
crepe.setReadonly(true)
```

样式按本项目的顺序引入，缺一不可：

```ts
import '@milkdown/crepe/theme/common/style.css'
import '@xz-summer/milkdown-container/style.css'
import './styles/global.scss'
import './styles/themes'
```

### 5.5 图片：host 端预先解析成 webview URI

`asWebviewUri` 只能在 extension host 调用，而 `proxyDomURL` 是同步的。做法是 host 每次发送内容时附带一张映射表：

```ts
const dir = vscode.Uri.joinPath(doc.uri, '..')
const images: Record<string, string> = {}
for (const src of extractImageSrcs(text)) {
  if (/^(https?:|data:|blob:)/i.test(src)) continue
  let p = src
  try { p = decodeURIComponent(src) } catch { /* 含未转义 % */ }
  const abs = path.isAbsolute(p) ? vscode.Uri.file(p) : vscode.Uri.joinPath(dir, p)
  images[src] = panel.webview.asWebviewUri(abs).toString()
}
```

`localResourceRoots` 至少包含文档所在目录和所有 workspace 文件夹；指向工作区外的绝对路径图片会被拦，需要在配置里显式加入根目录（这是安全边界，不要为了省事放行整个磁盘）。

### 5.6 CSP 与 HTML

```ts
panel.webview.options = {
  enableScripts: true,
  localResourceRoots: [docDir, ...workspaceFolders, context.extensionUri],
}
```

```html
<meta http-equiv="Content-Security-Policy" content="
  default-src 'none';
  img-src ${webview.cspSource} https: data:;
  style-src ${webview.cspSource} 'unsafe-inline';
  font-src ${webview.cspSource};
  script-src 'nonce-${nonce}';">
```

- Milkdown / CM6 会写内联样式，`style-src` 必须允许 `'unsafe-inline'`。
- `asWebviewUri` 生成的地址带会话信息，**不能缓存或写死**，每次渲染重新生成。

### 5.7 主题与字号

```ts
const applyTheme = () => {
  const kind = vscode.window.activeColorTheme.kind
  document.documentElement.dataset.theme =
    kind === vscode.ColorThemeKind.Dark || kind === vscode.ColorThemeKind.HighContrast
      ? 'dark' : 'light'
}
```

- 监听 `window.onDidChangeActiveColorTheme`，然后把新主题发给 webview。
- 字号：`document.documentElement.style.setProperty('--text-size', `${fontSize}px`)`，同时 `rebuild` 或只改变量（正文不需要重建，只有代码高亮需要）。
- 高对比主题先映射到 dark/light，后续再补边框/焦点样式。

### 5.8 链接与锚点

只读状态下点 `<a>` 会被 PM 拦。在 webview 根节点上挂 click 监听，向上找 `closest('a')`：

- `http(s)` → 发 `openLink` → host `vscode.env.openExternal`。
- 相对 `.md` → host `vscode.commands.executeCommand('vscode.open', uri)`。
- `#anchor` → 页面内滚动（webview 自己处理）。

## 6. 移植陷阱

1. **Crepe 实例必须是非深代理对象**：本项目用 `shallowRef`；webview 不用 Vue 就天然没这个问题，但别把 Crepe 塞进任何 `reactive`。
2. **`lastSynced` 两处都要更新**（可编辑版本）；只读版本不要回写 markdown。
3. **切主题必须重建 Crepe**：`CodeMirror` 的高亮主题在 `featureConfigs` 创建时绑定。
4. **图片路径只在显示层转换**，markdown 文本始终保留相对路径；否则文件一移动就全坏。
5. **`:::details` 需要 `containerPlugin` + 它自己的 CSS**；`marked` 不认这个语法，导出时要先替换成 `<details>`。
6. **所有尺寸用 rem**，唯一允许的 px 是 `--text-size`、1px 边框和用户拖拽产生的宽度。
7. **组件里禁止 `[data-theme='dark']` 分支**，只靠变量。
8. **`--crepe-*` 的映射在 `global.scss`**，搬样式时整段带走，否则代码块、表格、引用块会变成 Crepe 默认皮肤。
9. **不要顶层 `import` 任何 Tauri 包**（本项目约定）。移植时这些调用全部换成 VS Code API。
10. **webview 里没有 `window.print()`**；PDF 导出不能照搬本项目。

## 7. PDF / 导出的取舍

本项目用隐藏 iframe + `print()`，在 VS Code webview 里不成立。三种可选方案：

1. **导出 HTML**（推荐）：复用 `useExportPdf.ts` 的 CSS 内联逻辑，把主题变量、`@font-face`、`marked` 结果拼成独立 HTML，写到临时目录后 `vscode.env.openExternal` 用浏览器打印。
2. **扩展里跑 headless Chrome**：效果好但依赖本机 Chrome，体积和复杂度都上一个台阶。
3. **不做**：查看器先不承诺 PDF。

`marked` 渲染出的 HTML 同样要处理 `:::details` → `<details>`、图片相对路径 → `asWebviewUri`。

## 8. 建议实施顺序

1. 只读渲染纯文本（无图片、无主题切换）。
2. 图片：`extractImageSrcs` + `asWebviewUri` + `proxyDomURL`。
3. 主题同步 + 字号 + `data-theme` 重建。
4. 链接打开、代码块高亮、`:::details`。
5. 打包 `vsce`，验证 `.vsix` 在干净环境可用。
6. 可选：大纲 / 滚动同步 / 导出 HTML。

## 9. 不做的事

- 文件树、多标签、多窗口、拖放、单实例：VS Code 已经提供。
- 设置弹窗、状态栏、菜单栏：用 VS Code 设置和命令面板。
- 编辑模式、源码模式、打字机模式：查看插件不需要；真要做，再移植 `runFormat` 和 store。
- Mermaid、脚注、raw block：本项目也没有，别顺手加。

## 10. 验证清单

- [ ] `.md` 里带相对路径、绝对路径、远程 URL、`data:` 图片各一张，全部显示。
- [ ] 切换 VS Code 明暗主题，正文、代码块、表格、引用块颜色都跟着变。
- [ ] 改 `markdownView.fontSize`，正文和代码都按比例缩放。
- [ ] 打开含 `:::details` 的文件，折叠块可展开。
- [ ] 点击外链、相对 md 链接、页内锚点，行为正确。
- [ ] 打开 DevTools 看 Console，无 CSP 报错、无 404 资源。
- [ ] 仅安装 `.vsix` 的干净环境里可用。
