import * as vscode from 'vscode';
import { MarkdownViewProvider } from './provider';

export function activate(context: vscode.ExtensionContext): void {
  const provider = new MarkdownViewProvider(context);
  context.subscriptions.push(
    vscode.window.registerCustomEditorProvider(
      MarkdownViewProvider.viewType,
      provider,
      { webviewOptions: { retainContextWhenHidden: true } },
    ),
    vscode.commands.registerCommand('markdownView.openEditor', async () => {
      const document = vscode.window.activeTextEditor?.document;
      if (!document) {
        await vscode.window.showInformationMessage('Open a Markdown file first.');
        return;
      }

      await vscode.commands.executeCommand(
        'vscode.openWith',
        document.uri,
        MarkdownViewProvider.viewType,
      );
    }),
    vscode.window.onDidChangeActiveColorTheme(() => provider.updateSettings()),
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (event.affectsConfiguration('markdownView.fontSize')) {
        provider.updateSettings();
      }
    }),
  );
}
