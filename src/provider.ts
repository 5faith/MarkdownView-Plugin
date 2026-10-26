import { randomBytes } from 'node:crypto';
import * as path from 'node:path';
import * as vscode from 'vscode';
import type { HostMessage, ThemeKind, WebviewMessage } from './shared/protocol';

const imagePattern = /!\[[^\]]*]\(\s*(?:<([^>]+)>|([^\s)]+))(?:\s+[^)]*)?\)/g;
const remoteResourcePattern = /^(?:https?:|data:|blob:)/i;

interface EditorState {
  document: vscode.TextDocument;
  panel: vscode.WebviewPanel;
  lastKnownContent: string;
  editable: boolean;
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
      editable: false,
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
      case 'change':
        state.updateQueue = state.updateQueue
          .then(() => this.applyWebviewChange(state, message.markdown))
          .catch((error: unknown) => {
            const detail = error instanceof Error ? error.message : String(error);
            void vscode.window.showErrorMessage(`MarkdownView could not update the document: ${detail}`);
            this.sendDocumentUpdate(state);
          });
        break;
      case 'setMode':
        state.editable = message.editable;
        void state.panel.webview.postMessage({
          type: 'mode',
          editable: state.editable,
        } satisfies HostMessage);
        break;
      case 'openLink':
        this.openLink(state, message.href);
        break;
    }
  }

  private async applyWebviewChange(state: EditorState, markdown: string): Promise<void> {
    const { document } = state;
    if (!state.editable) {
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
      editable: state.editable,
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

    if (target.scheme === 'http' || target.scheme === 'https') {
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
    const styleUri = webview.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, 'dist', 'webview.css'));
    const csp = [
      "default-src 'none'",
      `img-src ${webview.cspSource} https: data:`,
      `style-src ${webview.cspSource} 'unsafe-inline'`,
      `font-src ${webview.cspSource}`,
      `script-src 'nonce-${nonce}'`,
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
  <aside id="outline-panel" aria-label="Document outline">
    <h2>Outline</h2>
    <nav id="outline-list" aria-label="Markdown headings"></nav>
  </aside>
  <nav id="mode-toolbar" aria-label="Markdown editor mode">
    <button id="readonly-mode" type="button" title="Read-only mode" aria-label="Read-only mode" aria-pressed="true">
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 10V7a6 6 0 0 1 12 0v3M5 10h14v11H5zM12 14v3"></path></svg>
    </button>
    <button id="edit-mode" type="button" title="Edit mode" aria-label="Edit mode" aria-pressed="false">
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 20h4l11-11a2.8 2.8 0 0 0-4-4L4 16v4zM13.5 6.5l4 4"></path></svg>
    </button>
  </nav>
  <main id="editor" aria-label="Markdown editor"></main>
  <script nonce="${nonce}" src="${escapeAttribute(scriptUri.toString())}"></script>
</body>
</html>`;
  }
}

function isWebviewMessage(value: unknown): value is WebviewMessage {
  if (typeof value !== 'object' || value === null || !('type' in value)) {
    return false;
  }

  const message = value as { type: unknown; markdown?: unknown; href?: unknown; editable?: unknown };
  switch (message.type) {
    case 'ready':
      return true;
    case 'change':
      return typeof message.markdown === 'string';
    case 'setMode':
      return typeof message.editable === 'boolean';
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
