import { randomBytes } from 'node:crypto';
import * as path from 'node:path';
import * as vscode from 'vscode';
import type { EditorMode, HostMessage, ThemeKind, WebviewMessage } from './shared/protocol';

const imagePattern = /!\[[^\]]*]\(\s*(?:<([^>]+)>|([^\s)]+))(?:\s+[^)]*)?\)/g;
const remoteResourcePattern = /^(?:https?:|data:|blob:)/i;

interface EditorState {
  document: vscode.TextDocument;
  panel: vscode.WebviewPanel;
  lastKnownContent: string;
  mode: EditorMode;
  updateQueue: Promise<void>;
  disposables: vscode.Disposable[];
}

export class MarkdownViewProvider implements vscode.CustomTextEditorProvider {
  static readonly viewType = 'markdownView.editor';

  private readonly editors = new Set<EditorState>();

  constructor(private readonly context: vscode.ExtensionContext) {}

  async resolveCustomTextEditor(
    document: vscode.TextDocument,
    panel: vscode.WebviewPanel,
  ): Promise<void> {
    const state: EditorState = {
      document,
      panel,
      lastKnownContent: document.getText(),
      mode: 'readonly',
      updateQueue: Promise.resolve(),
      disposables: [],
    };
    this.editors.add(state);
    panel.webview.options = {
      enableScripts: true,
      localResourceRoots: this.getResourceRoots(document),
    };
    panel.webview.html = this.getHtml(panel.webview);

    state.disposables.push(
      vscode.workspace.onDidChangeTextDocument((event) => {
        if (event.document.uri.toString() !== document.uri.toString()) {
          return;
        }
        this.sendDocumentUpdate(state);
      }),
      panel.webview.onDidReceiveMessage((message: unknown) => {
        if (!isWebviewMessage(message)) {
          return;
        }
        this.handleWebviewMessage(state, message);
      }),
      panel.onDidDispose(() => {
        this.editors.delete(state);
        for (const disposable of state.disposables) {
          disposable.dispose();
        }
      }),
    );
  }

  updateSettings(): void {
    const settings = { type: 'settings', ...this.getSettings() } satisfies HostMessage;
    for (const state of this.editors) {
      void state.panel.webview.postMessage(settings);
    }
  }

  private handleWebviewMessage(state: EditorState, message: WebviewMessage): void {
    switch (message.type) {
      case 'ready':
        this.postDocumentUpdate(state);
        break;
      case 'change': {
        const canEdit = state.mode !== 'readonly';
        state.updateQueue = state.updateQueue
          .then(() => this.applyWebviewChange(state, message.markdown, canEdit))
          .catch((error: unknown) => {
            const detail = error instanceof Error ? error.message : String(error);
            void vscode.window.showErrorMessage(`MarkdownView could not update the document: ${detail}`);
            this.sendDocumentUpdate(state);
          });
        break;
      }
      case 'setMode':
        state.mode = message.mode;
        void state.panel.webview.postMessage({
          type: 'mode',
          mode: state.mode,
        } satisfies HostMessage);
        break;
      case 'openLink':
        this.openLink(state, message.href);
        break;
    }
  }

  private async applyWebviewChange(state: EditorState, markdown: string, canEdit: boolean): Promise<void> {
    const { document } = state;
    if (!canEdit) {
      this.postDocumentUpdate(state);
      return;
    }
    const currentText = document.getText();
    if (markdown === currentText) {
      state.lastKnownContent = currentText;
      return;
    }

    state.lastKnownContent = markdown;
    const edit = new vscode.WorkspaceEdit();
    edit.replace(
      document.uri,
      new vscode.Range(document.positionAt(0), document.positionAt(currentText.length)),
      markdown,
    );

    const applied = await vscode.workspace.applyEdit(edit);
    if (!applied) {
      state.lastKnownContent = document.getText();
      this.postDocumentUpdate(state);
      void vscode.window.showWarningMessage('MarkdownView could not apply an edit to this document.');
    }
  }

  private sendDocumentUpdate(state: EditorState): void {
    const markdown = state.document.getText();
    if (markdown === state.lastKnownContent) {
      return;
    }

    state.lastKnownContent = markdown;
    this.postDocumentUpdate(state);
  }

  private postDocumentUpdate(state: EditorState): void {
    const markdown = state.document.getText();
    state.lastKnownContent = markdown;
    const images = this.getImageMap(state.document, state.panel.webview, markdown);
    void state.panel.webview.postMessage({
      type: 'update',
      markdown,
      images,
      ...this.getSettings(),
      mode: state.mode,
    } satisfies HostMessage);
  }

  private getSettings(): Pick<Extract<HostMessage, { type: 'settings' }>, 'theme' | 'fontSize'> {
    const kind = vscode.window.activeColorTheme.kind;
    const theme: ThemeKind =
      kind === vscode.ColorThemeKind.Dark || kind === vscode.ColorThemeKind.HighContrast
        ? 'dark'
        : 'light';
    const configuredSize = vscode.workspace.getConfiguration('markdownView').get<number>('fontSize', 14);
    const fontSize = Number.isFinite(configuredSize) ? Math.min(32, Math.max(10, configuredSize)) : 14;
    return { theme, fontSize };
  }

  private getResourceRoots(document: vscode.TextDocument): vscode.Uri[] {
    const roots = new Map<string, vscode.Uri>();
    const addRoot = (uri: vscode.Uri): void => {
      roots.set(uri.toString(), uri);
    };

    addRoot(this.context.extensionUri);
    for (const folder of vscode.workspace.workspaceFolders ?? []) {
      addRoot(folder.uri);
    }
    if (document.uri.scheme === 'file') {
      addRoot(vscode.Uri.file(path.dirname(document.uri.fsPath)));
    }
    return [...roots.values()];
  }

  private getImageMap(
    document: vscode.TextDocument,
    webview: vscode.Webview,
    markdown: string,
  ): Record<string, string> {
    const images: Record<string, string> = {};
    imagePattern.lastIndex = 0;

    for (const match of markdown.matchAll(imagePattern)) {
      const source = match[1] ?? match[2];
      if (!source || remoteResourcePattern.test(source)) {
        continue;
      }

      const decodedSource = decodeImagePath(source);
      const imageUri = document.uri.scheme === 'file'
        ? vscode.Uri.file(
            path.isAbsolute(decodedSource)
              ? decodedSource
              : path.resolve(path.dirname(document.uri.fsPath), decodedSource),
          )
        : undefined;
      if (!imageUri) {
        continue;
      }

      const workspaceContainsImage = (vscode.workspace.workspaceFolders ?? []).some((folder) =>
        isWithinPath(folder.uri.fsPath, imageUri.fsPath),
      );
      const documentDirectory = path.dirname(document.uri.fsPath);
      const imageDirectory = path.dirname(imageUri.fsPath);
      const documentContainsImage = isWithinPath(documentDirectory, imageUri.fsPath);
      if (!workspaceContainsImage && !documentContainsImage) {
        this.addResourceRoot(webview, imageDirectory);
      }
      const displayUri = webview.asWebviewUri(imageUri).toString();
      images[source] = displayUri;
      images[decodedSource] = displayUri;
    }

    return images;
  }

  private addResourceRoot(webview: vscode.Webview, directory: string): void {
    const uri = vscode.Uri.file(directory);
    const roots = new Map(webview.options.localResourceRoots?.map((root) => [root.toString(), root]));
    roots.set(uri.toString(), uri);
    webview.options = {
      ...webview.options,
      localResourceRoots: [...roots.values()],
    };
  }

  private openLink(state: EditorState, href: string): void {
    if (href.startsWith('#')) {
      void state.panel.webview.postMessage({ type: 'anchor', href } satisfies HostMessage);
      return;
    }

    let target: vscode.Uri;
    try {
      target = vscode.Uri.parse(href);
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      void vscode.window.showErrorMessage(`MarkdownView could not open this link: ${detail}`);
      return;
    }

    if (target.scheme === 'http' || target.scheme === 'https' || target.scheme === 'mailto') {
      void vscode.env.openExternal(target).then(undefined, (error: unknown) => {
        const detail = error instanceof Error ? error.message : String(error);
        void vscode.window.showErrorMessage(`MarkdownView could not open this link: ${detail}`);
      });
      return;
    }

    if (target.scheme) {
      return;
    }

    const [pathPart, fragment] = href.split('#', 2);
    if (!pathPart) {
      return;
    }
    const decodedPath = decodeImagePath(pathPart);
    const filePath = path.isAbsolute(decodedPath)
      ? decodedPath
      : path.resolve(path.dirname(state.document.uri.fsPath), decodedPath);
    const fileUri = vscode.Uri.file(filePath);
    const targetUri = fragment === undefined ? fileUri : fileUri.with({ fragment });
    void vscode.commands.executeCommand('vscode.open', targetUri).then(undefined, (error: unknown) => {
      const detail = error instanceof Error ? error.message : String(error);
      void vscode.window.showErrorMessage(`MarkdownView could not open this link: ${detail}`);
    });
  }

  private getHtml(webview: vscode.Webview): string {
    const nonce = randomBytes(16).toString('base64');
    const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, 'dist', 'webview.js'));
    const mermaidUri = webview.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, 'dist', 'mermaid.js'));
    const styleUri = webview.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, 'dist', 'webview.css'));
    const csp = [
      "default-src 'none'",
      `img-src ${webview.cspSource} https: http: data:`,
      `style-src ${webview.cspSource} 'unsafe-inline'`,
      `font-src ${webview.cspSource}`,
      `script-src ${webview.cspSource} 'nonce-${nonce}'`,
      "connect-src 'none'",
    ].join('; ');
    const escapeAttribute = (value: string): string =>
      value.replace(/[&<>"']/g, (character) => {
        switch (character) {
          case '&':
            return '&amp;';
          case '<':
            return '&lt;';
          case '>':
            return '&gt;';
          case '"':
            return '&quot;';
          case '\'':
            return '&#39;';
          default:
            return character;
        }
      });

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy" content="${csp}">
  <link rel="stylesheet" href="${escapeAttribute(styleUri.toString())}">
  <title>MarkdownView</title>
</head>
<body>
  <div id="app-shell">
    <aside id="outline-panel" aria-label="Document outline">
      <h2>文档大纲</h2>
      <nav id="outline-list" aria-label="Markdown headings"></nav>
    </aside>
    <button
      id="outline-resizer"
      type="button"
      role="separator"
      aria-label="调整大纲宽度"
      aria-orientation="vertical"
      aria-valuemin="168"
      aria-valuemax="392"
      aria-valuenow="224"
      title="拖动调整大纲宽度"
    ></button>
    <div id="workspace">
      <header id="editor-header">
        <nav id="edit-toolbar" aria-label="Markdown formatting" data-visible="false">
          <button type="button" data-action="heading-1" title="标题 1" aria-label="标题 1">H1</button>
          <button type="button" data-action="heading-2" title="标题 2" aria-label="标题 2">H2</button>
          <button type="button" data-action="heading-3" title="标题 3" aria-label="标题 3">H3</button>
          <span class="toolbar-separator" aria-hidden="true"></span>
          <button type="button" data-action="bold" title="加粗" aria-label="加粗"><strong>B</strong></button>
          <button type="button" data-action="italic" title="斜体" aria-label="斜体"><em>I</em></button>
          <button type="button" data-action="strike" title="删除线" aria-label="删除线"><s>S</s></button>
          <button type="button" data-action="inline-code" title="行内代码" aria-label="行内代码">&lt;/&gt;</button>
          <span class="toolbar-separator" aria-hidden="true"></span>
          <button type="button" data-action="horizontal-rule" title="水平线" aria-label="水平线">—</button>
          <button type="button" data-action="quote" title="引用" aria-label="引用">❝</button>
          <label class="toolbar-list-control">
            <span class="visually-hidden">插入列表</span>
            <select id="list-format" aria-label="插入列表" title="列表">
              <option value="">☷</option>
              <option value="bullet">无序列表</option>
              <option value="ordered">有序列表</option>
              <option value="task">任务列表</option>
              <option value="definition">定义列表</option>
            </select>
          </label>
          <span class="toolbar-separator" aria-hidden="true"></span>
          <button type="button" data-action="table" title="表格" aria-label="表格">▦</button>
          <button type="button" data-action="code-block" title="插入代码块" aria-label="插入代码块">{ }</button>
          <button type="button" data-action="details" title="隐藏细节（折叠块）" aria-label="插入折叠块">▤</button>
          <span class="toolbar-separator" aria-hidden="true"></span>
          <button type="button" data-action="image" title="图片" aria-label="插入图片">▧</button>
          <button type="button" data-action="link" title="链接" aria-label="插入链接">🔗</button>
        </nav>
        <nav id="mode-toolbar" aria-label="Markdown editor mode">
          <button id="readonly-mode" type="button" data-mode="readonly" title="只读模式" aria-pressed="true">只读</button>
          <button id="edit-mode" type="button" data-mode="edit" title="编辑模式" aria-pressed="false">编辑</button>
          <button id="source-mode" type="button" data-mode="source" title="源码模式" aria-pressed="false">源码</button>
        </nav>
      </header>
      <div id="content-stage">
        <main id="editor" aria-label="Markdown editor" data-mermaid-uri="${escapeAttribute(mermaidUri.toString())}"></main>
        <textarea id="source-editor" aria-label="Markdown source" hidden spellcheck="false"></textarea>
        <div id="source-transition-loading" role="status" aria-live="polite" hidden>
          <span class="loading-spinner" aria-hidden="true"></span>
          <span>正在加载 Markdown 内容…</span>
        </div>
      </div>
    </div>
  </div>
  <div id="block-insert-menu" role="menu" aria-label="插入内容" hidden>
    <section>
      <h2>文本</h2>
      <button type="button" role="menuitem" data-insert="paragraph">正文</button>
      <button type="button" role="menuitem" data-insert="heading-1">标题 1</button>
      <button type="button" role="menuitem" data-insert="heading-2">标题 2</button>
      <button type="button" role="menuitem" data-insert="heading-3">标题 3</button>
      <button type="button" role="menuitem" data-insert="heading-4">标题 4</button>
      <button type="button" role="menuitem" data-insert="heading-5">标题 5</button>
      <button type="button" role="menuitem" data-insert="heading-6">标题 6</button>
    </section>
    <section>
      <h2>块</h2>
      <button type="button" role="menuitem" data-insert="quote">引用</button>
      <button type="button" role="menuitem" data-insert="bullet-list">无序列表</button>
      <button type="button" role="menuitem" data-insert="ordered-list">有序列表</button>
      <button type="button" role="menuitem" data-insert="task-list">任务列表</button>
      <button type="button" role="menuitem" data-insert="definition-list">定义列表</button>
      <button type="button" role="menuitem" data-insert="divider">水平线</button>
      <button type="button" role="menuitem" data-insert="table">表格</button>
      <button type="button" role="menuitem" data-insert="code-block">代码块</button>
      <button type="button" role="menuitem" data-insert="details">折叠块</button>
    </section>
  </div>
  <dialog id="toolbar-input-dialog">
    <form method="dialog">
      <label id="toolbar-input-label" for="toolbar-input"></label>
      <input id="toolbar-input" type="text">
      <div class="toolbar-dialog-actions">
        <button type="submit" value="cancel">取消</button>
        <button type="submit" value="confirm">确定</button>
      </div>
    </form>
  </dialog>
  <script nonce="${nonce}" src="${escapeAttribute(scriptUri.toString())}"></script>
</body>
</html>`;
  }
}

function isWebviewMessage(value: unknown): value is WebviewMessage {
  if (typeof value !== 'object' || value === null || !('type' in value)) {
    return false;
  }

  const message = value as { type: unknown; markdown?: unknown; href?: unknown; mode?: unknown };
  switch (message.type) {
    case 'ready':
      return true;
    case 'change':
      return typeof message.markdown === 'string';
    case 'setMode':
      return message.mode === 'readonly' || message.mode === 'edit' || message.mode === 'source';
    case 'openLink':
      return typeof message.href === 'string';
    default:
      return false;
  }
}

function decodeImagePath(source: string): string {
  try {
    return decodeURIComponent(source);
  } catch {
    return source;
  }
}

function isWithinPath(parentPath: string, candidatePath: string): boolean {
  const relativePath = path.relative(parentPath, candidatePath);
  return relativePath === '' || (!relativePath.startsWith(`..${path.sep}`) && relativePath !== '..' && !path.isAbsolute(relativePath));
}
