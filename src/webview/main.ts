import { EditorView } from '@codemirror/view';
import { Crepe } from '@milkdown/crepe';
import { editorViewCtx } from '@milkdown/kit/core';
import { replaceAll } from '@milkdown/kit/utils';
import { containerPlugin } from '@xz-summer/milkdown-container';
import { configureMermaid, markdownSyntaxPlugins } from './markdown-extensions';
import '@milkdown/crepe/theme/common/style.css';
import '@xz-summer/milkdown-container/style.css';
import './style.css';
import type { HostMessage, ThemeKind, WebviewMessage } from '../shared/protocol';

declare function acquireVsCodeApi(): {
  postMessage(message: WebviewMessage): void;
};

const vscode = acquireVsCodeApi();
const editorRoot = document.querySelector<HTMLElement>('#editor');
if (!editorRoot) {
  throw new Error('MarkdownView editor root element was not found.');
}
const root: HTMLElement = editorRoot;

let crepe: Crepe | undefined;
let latestMarkdown = '';
let latestImages: Record<string, string> = {};
let lastAppliedMarkdown: string | undefined;
let theme: ThemeKind = 'light';
let fontSize = 14;
let editable = false;
let changeTimer: number | undefined;
let editorTask: Promise<void> = Promise.resolve();
function requireButton(selector: string): HTMLButtonElement {
  const button = document.querySelector<HTMLButtonElement>(selector);
  if (!button) {
    throw new Error(`MarkdownView mode control was not found: ${selector}`);
  }
  return button;
}

function requireElement(selector: string): HTMLElement {
  const element = document.querySelector<HTMLElement>(selector);
  if (!element) {
    throw new Error(`MarkdownView element was not found: ${selector}`);
  }
  return element;
}

const readonlyButton = requireButton('#readonly-mode');
const editButton = requireButton('#edit-mode');
const outlineList = requireElement('#outline-list');

function updateModeControls(): void {
  readonlyButton.setAttribute('aria-pressed', String(!editable));
  editButton.setAttribute('aria-pressed', String(editable));
  root.dataset.editable = String(editable);
  crepe?.setReadonly(!editable);
}

readonlyButton.addEventListener('click', () => {
  editable = false;
  updateModeControls();
  vscode.postMessage({ type: 'setMode', editable: false });
});
editButton.addEventListener('click', () => {
  editable = true;
  updateModeControls();
  crepe?.editor.action((ctx) => {
    ctx.get(editorViewCtx).focus();
  });
  vscode.postMessage({ type: 'setMode', editable: true });
});

updateModeControls();

function postChange(markdown: string): void {
  if (markdown === lastAppliedMarkdown) {
    return;
  }
  window.requestAnimationFrame(updateOutline);
  window.clearTimeout(changeTimer);
  changeTimer = window.setTimeout(() => {
    if (markdown === lastAppliedMarkdown) {
      return;
    }
    vscode.postMessage({ type: 'change', markdown });
  }, 120);
}

function updateOutline(): void {
  const headings = root.querySelectorAll<HTMLElement>(
    '.ProseMirror h1, .ProseMirror h2, .ProseMirror h3, .ProseMirror h4, .ProseMirror h5, .ProseMirror h6',
  );
  const fragment = document.createDocumentFragment();
  headings.forEach((heading, index) => {
    const label = heading.textContent?.trim();
    if (!label) {
      return;
    }
    const button = document.createElement('button');
    button.className = 'outline-item';
    button.type = 'button';
    button.textContent = label;
    button.style.setProperty('--heading-level', heading.tagName.slice(1));
    button.addEventListener('click', () => {
      headings.item(index)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
    fragment.append(button);
  });
  const hasHeadings = fragment.childNodes.length > 0;
  outlineList.replaceChildren(fragment);
  if (!hasHeadings) {
    const emptyState = document.createElement('p');
    emptyState.className = 'outline-empty';
    emptyState.textContent = 'No headings';
    outlineList.append(emptyState);
  }
}

async function createEditor(): Promise<void> {
  const previousEditor = crepe;
  crepe = undefined;
  if (previousEditor) {
    await previousEditor.destroy();
  }
  root.dataset.theme = theme;
  document.documentElement.dataset.theme = theme;
  document.documentElement.style.setProperty('--text-size', `${fontSize}px`);
  configureMermaid(theme);

  const initialMarkdown = latestMarkdown;
  const nextEditor = new Crepe({
    root,
    defaultValue: initialMarkdown,
    features: {
      [Crepe.Feature.BlockEdit]: false,
      [Crepe.Feature.Toolbar]: false,
      [Crepe.Feature.Placeholder]: false,
      [Crepe.Feature.LinkTooltip]: false,
      [Crepe.Feature.TopBar]: false,
      [Crepe.Feature.AI]: false,
    },
    featureConfigs: {
      [Crepe.Feature.CodeMirror]: {
        theme: EditorView.theme(
          {
            '&': {
              backgroundColor: 'var(--vscode-editor-background)',
              color: 'var(--vscode-editor-foreground)',
            },
            '.cm-content': {
              caretColor: 'var(--vscode-editorCursor-foreground)',
            },
            '.cm-cursor, .cm-dropCursor': {
              borderLeftColor: 'var(--vscode-editorCursor-foreground)',
            },
            '.cm-gutters': {
              backgroundColor: 'var(--vscode-editorGutter-background, var(--vscode-editor-background))',
              color: 'var(--vscode-editorLineNumber-foreground)',
              border: 'none',
            },
            '.cm-activeLine, .cm-activeLineGutter': {
              backgroundColor: 'var(--vscode-editor-lineHighlightBackground, transparent)',
            },
          },
          { dark: theme === 'dark' },
        ),
      },
      [Crepe.Feature.ImageBlock]: {
        proxyDomURL: (url: string) => latestImages[url] ?? url,
      },
    },
  });
  nextEditor.addFeature((editor) => {
    editor.use([...containerPlugin, ...markdownSyntaxPlugins]);
  });
  nextEditor.on((listener) => {
    listener.markdownUpdated((_context, markdown) => postChange(markdown));
  });
  nextEditor.setReadonly(!editable);

  try {
    await nextEditor.create();
    crepe = nextEditor;
    updateModeControls();
    updateOutline();
    lastAppliedMarkdown = initialMarkdown;
    if (latestMarkdown !== initialMarkdown) {
      nextEditor.editor.action(replaceAll(latestMarkdown));
      lastAppliedMarkdown = latestMarkdown;
      window.requestAnimationFrame(updateOutline);
    }
  } catch (error) {
    root.replaceChildren();
    const message = document.createElement('p');
    message.className = 'editor-error';
    message.textContent = `MarkdownView could not initialize Milkdown: ${error instanceof Error ? error.message : String(error)}`;
    root.append(message);
  }
}

function scheduleEditorCreation(): void {
  editorTask = editorTask.then(createEditor, createEditor);
}

function applySettings(nextTheme: ThemeKind, nextFontSize: number): void {
  const themeChanged = theme !== nextTheme;
  theme = nextTheme;
  fontSize = nextFontSize;
  document.documentElement.dataset.theme = theme;
  document.documentElement.style.setProperty('--text-size', `${fontSize}px`);
  root.dataset.theme = theme;
  if (themeChanged) {
    scheduleEditorCreation();
  }
}

function applyHostUpdate(message: Extract<HostMessage, { type: 'update' }>): void {
  window.clearTimeout(changeTimer);
  latestMarkdown = message.markdown;
  latestImages = message.images;
  editable = message.editable;
  updateModeControls();
  const previousTheme = theme;
  applySettings(message.theme, message.fontSize);
  if (previousTheme !== theme) {
    return;
  }
  if (!crepe) {
    scheduleEditorCreation();
    return;
  }
  if (latestMarkdown === lastAppliedMarkdown) {
    return;
  }

  crepe.editor.action(replaceAll(latestMarkdown));
  lastAppliedMarkdown = latestMarkdown;
  window.requestAnimationFrame(updateOutline);
}

function scrollToAnchor(href: string): void {
  let anchor = href.slice(1);
  try {
    anchor = decodeURIComponent(anchor);
  } catch {
    anchor = href.slice(1);
  }
  const target = document.getElementById(anchor) ??
    [...root.querySelectorAll<HTMLElement>('h1, h2, h3, h4, h5, h6')].find(
      (heading) => heading.textContent?.trim().toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '-') === anchor.toLowerCase(),
    );
  target?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

window.addEventListener('message', (event: MessageEvent<HostMessage>) => {
  const message = event.data;
  switch (message.type) {
    case 'update':
      applyHostUpdate(message);
      break;
    case 'settings':
      applySettings(message.theme, message.fontSize);
      break;
    case 'mode':
      editable = message.editable;
      updateModeControls();
      break;
    case 'anchor':
      scrollToAnchor(message.href);
      break;
  }
});

root.addEventListener('click', (event) => {
  const target = event.target;
  if (!(target instanceof Element)) {
    return;
  }
  const link = target.closest<HTMLAnchorElement>('a[href]');
  const href = link?.getAttribute('href');
  if (!href) {
    return;
  }
  event.preventDefault();
  if (href.startsWith('#')) {
    scrollToAnchor(href);
    return;
  }
  vscode.postMessage({ type: 'openLink', href });
});

vscode.postMessage({ type: 'ready' });
