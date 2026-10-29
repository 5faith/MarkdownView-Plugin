# Markdown 功能点与 MD 组件总结（VS Code 插件移植参考）

> 20261029 整理。目的：为「VS Code md 文档插件（类似 md 文件查看/编辑）」提供移植参考。
> 内容全部来自本仓库现状；细节契约见 `.operator/specs/milkdown-v2.md` 与 `prd/20261019-milkdown-typora-refactor/`。

## 一、MD 功能点清单

### 1. 编辑内核（双模式）

| 模式 | 实现 | 说明 |
|---|---|---|
| WYSIWYG | **Milkdown Crepe 7.22.3**（`@milkdown/crepe` + `@milkdown/kit`） | 所见即所得，选中即格式 |
| 源码模式 | textarea（本项目）/ CM6 `@codemirror/lang-markdown` | 直接改 markdown 文本 + 前缀 toggle |
| 阅读模式 | `crepe.setReadonly(true)`，**不重建实例** | Esc 退出 |
| 打字机模式 | 光标行居中滚动（读 `getComputedStyle` 行高，不写死字号） | 开关在设置里 |

### 2. 扩展语法（GFM 超集，自写 remark/schema/NodeView）

- `<details>` 折叠块（含 `<summary>`；折叠状态写回节点 attr，否则保存丢状态）
- `> [!NOTE]` 等 **5 种告警块**（note / tip / important / warning / caution）
- `[^1]` 脚注（GFM 预设自带 schema，只补样式）
- `: 释义` 定义列表（`remark-definition-list`）
- `:smile:` 表情（`gemoji` 短代码 ↔ 行内原子节点，回写短代码）
- **Mermaid 图表**（``` 围栏 → NodeView 渲染 SVG，回写围栏）
- 原始 HTML 兜底块

### 3. 格式命令（`runFormat(kind)` 统一入口）

撤销/重做、h1–h6、加粗/斜体/删除线/行内码、链接（空选区插占位文本）、引用、无序/有序/任务列表（三合一下拉）、表格、图片插入（弹文件框）、emoji/告警/折叠/脚注/定义列表插入。
WYSIWYG 走 Crepe 命令，源码模式走文本模板（前缀 toggle）。

### 4. 图片

- 粘贴/上传 → 落盘到 md 同级 `assets/`（目录可配置），markdown 里**永远存相对路径**
- 渲染时：相对路径 → 本地绝对路径 → 显示 URL（Tauri `convertFileSrc` asset 协议；VS Code 对应 `webview.asWebviewUri`）
- 远程/内联 URL 原样显示

### 5. 周边能力

- 大纲面板（h1–h6 树，按文档序号跳转防同名串位）
- 多标签、文件树、文件监听（外部改动重读）、拖放
- 导出 PDF（`DOMSerializer` 序列化节点 `toDOM`，配色读主题变量）
- 明暗主题（CSS 变量体系 + CM6 代码高亮双套 token）

## 二、MD 组件用法（移植核心）

结构极薄，三层：

```
MilkdownEditor.vue        ← 纯壳：<div scroll><div root/></div>，onMounted 调 useMilkdown
useMilkdown.ts            ← Crepe 生命周期 + 双向同步 + 图片钩子
shared/milkdown/index.ts  ← milkdownSyntaxPlugins：扩展语法插件数组
shared/editor.ts          ← runFormat：所有格式命令唯一入口
```

关键代码流程（`src/composables/useMilkdown.ts` 的 `createEditor`）：

```ts
crepe = new Crepe({
  root,
  defaultValue: store.content,
  featureConfigs: {
    [Crepe.Feature.CodeMirror]: { theme: cmThemeExtension(theme) },  // 代码块明暗高亮
    [Crepe.Feature.ImageBlock]: {
      onUpload: (file) => saveImageFile(file, mdPath, imageDir),      // 落盘返回相对路径
      proxyDomURL: (url) => toDisplayUrl(url, mdPath),                // 相对路径→显示URL
    },
  },
})
crepe.addFeature((editor) => { editor.use(milkdownSyntaxPlugins) })  // Crepe 无自定义插件入口，借 addFeature 注入
crepe.on((l) => l.markdownUpdated((_ctx, md, prev) => {
  if (md === lastSynced) return        // ← 防回环
  lastSynced = md; store.setContent(md)
}))
await crepe.create()
crepe.setReadonly(readingMode)
```

**依赖清单**（VS Code 插件可直接复用）：`@milkdown/crepe`、`@milkdown/kit`、`mermaid`、`gemoji`、`remark-definition-list`。

## 三、移植到 VS Code 的映射

| 本项目（Tauri WebView） | VS Code 插件 |
|---|---|
| WebView 里跑 Vue + Crepe | **CustomEditor API** 的 webview 里跑 Crepe，同一套路 |
| `store.setContent` ↔ 保存按钮 | webview `postMessage` → extension host `TextDocument`/`WorkspaceEdit` 写盘 |
| `convertFileSrc`（asset 协议） | `webview.asWebviewUri(Uri.file(abs))` + `localResourceRoots` |
| 明暗主题 `data-theme` | 跟随 `vscode.window.activeColorTheme`，用 `--vscode-*` 变量做映射 |
| 文件监听重读 | `workspace.onDidChangeTextDocument` + 文档版本比对 |

## 四、踩坑清单（照抄可省几天）

1. **双向同步必须防回环**（`lastSynced` 比对两边），否则死循环或丢字。
2. **remark 自定义转换必须排在 commonmark 预设的 `remarkHtmlTransformer` 之前**（`InitReady` 后 `unshift` 进 `remarkPluginsCtx`），否则 `<details>` 等块级 HTML 被改写成纯文本。
3. 编辑器实例别放进 Vue 深层响应式（`shallowRef`），Crepe 有 `#private` 字段会抛错——VS Code 里用普通模块变量即可。
4. 改列表节点类型要同步子项 `listType` attr，否则被 commonmark 插件静默还原（ol→ul 被改回）。
5. 折叠块的 `open` 状态要经 NodeView `toggle` 事件写回节点 attr，序列化才带。
6. 代码块高亮主题走 `featureConfigs` 传入，不传则暗底上默认亮色 token 不可读。
7. 大纲跳转按文档序号（第 N 个 h1–h6），同名标题才不串位。
