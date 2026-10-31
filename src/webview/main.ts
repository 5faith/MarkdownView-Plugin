import { EditorView } from '@codemirror/view';
import { Crepe } from '@milkdown/crepe';
import type { Ctx } from '@milkdown/kit/ctx';
import { commandsCtx, editorViewCtx, parserCtx } from '@milkdown/kit/core';
import type { Node as ProseMirrorNode } from '@milkdown/kit/prose/model';
import { TextSelection } from '@milkdown/kit/prose/state';
import {
  createCodeBlockCommand,
  headingSchema,
  insertHrCommand,
  insertImageCommand,
  paragraphSchema,
  setBlockTypeCommand,
  toggleEmphasisCommand,
  toggleInlineCodeCommand,
  toggleStrongCommand,
  toggleLinkCommand,
  wrapInBlockquoteCommand,
  wrapInBulletListCommand,
  wrapInOrderedListCommand,
} from '@milkdown/kit/preset/commonmark';
import {
  insertTableCommand,
  toggleStrikethroughCommand,
} from '@milkdown/kit/preset/gfm';
import { callCommand, insert, replaceAll } from '@milkdown/kit/utils';
import { containerPlugin } from '@xz-summer/milkdown-container';
import { markdownSyntaxPlugins } from './markdown-extensions';
import { configureMermaid } from './mermaid-view';
import { splitSafeMarkdownBlocks } from './markdown-blocks';
import '@milkdown/crepe/theme/common/style.css';
import '@xz-summer/milkdown-container/style.css';
import './style.css';
import type { EditorMode, HostMessage, ThemeKind, WebviewMessage } from '../shared/protocol';

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
let mode: EditorMode = 'readonly';
let changeTimer: number | undefined;
let editorTask: Promise<void> = Promise.resolve();
let sourceEntryMarkdown: string | undefined;
let sourceTransitionId = 0;
let isApplyingSourceMarkdown = false;

function requireElement(selector: string): HTMLElement {
  const element = document.querySelector<HTMLElement>(selector);
  if (!element) {
    throw new Error(`MarkdownView element was not found: ${selector}`);
  }
  return element;
}

const modeButtons = [...document.querySelectorAll<HTMLButtonElement>('#mode-toolbar [data-mode]')];
if (modeButtons.length !== 3) {
  throw new Error('MarkdownView requires read-only, edit, and source mode controls.');
}
const editToolbar = requireElement('#edit-toolbar');
const sourceEditorElement = document.querySelector<HTMLTextAreaElement>('#source-editor');
if (!sourceEditorElement) {
  throw new Error('MarkdownView source editor was not found.');
}
const sourceEditor: HTMLTextAreaElement = sourceEditorElement;
const listFormat = document.querySelector<HTMLSelectElement>('#list-format');
const inputDialog = document.querySelector<HTMLDialogElement>('#toolbar-input-dialog');
const inputDialogLabel = document.querySelector<HTMLLabelElement>('#toolbar-input-label');
const inputDialogField = document.querySelector<HTMLInputElement>('#toolbar-input');
const outlineList = requireElement('#outline-list');
const outlinePanel = requireElement('#outline-panel');
const sourceTransitionLoading = requireElement('#source-transition-loading');
const sourceTransitionStatus = requireElement('#source-transition-status');
const outlineResizerElement = document.querySelector<HTMLButtonElement>('#outline-resizer');
if (!outlineResizerElement) {
  throw new Error('MarkdownView outline resizer was not found.');
}
const outlineResizer: HTMLButtonElement = outlineResizerElement;
const blockInsertMenu = requireElement('#block-insert-menu');
let blockInsertPosition: number | undefined;

function getOutlineResizeBounds(): { min: number; max: number } {
  const rem = Number.parseFloat(getComputedStyle(document.documentElement).fontSize);
  return {
    min: Math.min(12 * rem, window.innerWidth * 0.3),
    max: Math.min(28 * rem, window.innerWidth * 0.45),
  };
}

function setOutlineWidth(width: number): void {
  const { min, max } = getOutlineResizeBounds();
  const nextWidth = Math.round(Math.max(min, Math.min(width, max)));
  document.documentElement.style.setProperty('--outline-width', `${nextWidth}px`);
  outlineResizer.setAttribute('aria-valuemin', String(Math.round(min)));
  outlineResizer.setAttribute('aria-valuemax', String(Math.round(max)));
  outlineResizer.setAttribute('aria-valuenow', String(nextWidth));
}

setOutlineWidth(outlinePanel.getBoundingClientRect().width);
window.addEventListener('resize', () => {
  setOutlineWidth(outlinePanel.getBoundingClientRect().width);
});

let outlineResizeStartX: number | undefined;
let outlineResizeStartWidth = 0;

outlineResizer.addEventListener('pointerdown', (event) => {
  if (event.button !== 0) {
    return;
  }
  event.preventDefault();
  outlineResizeStartX = event.clientX;
  outlineResizeStartWidth = outlinePanel.getBoundingClientRect().width;
  document.body.dataset.resizingOutline = 'true';
  outlineResizer.setPointerCapture(event.pointerId);
});

outlineResizer.addEventListener('pointermove', (event) => {
  if (outlineResizeStartX === undefined) {
    return;
  }
  setOutlineWidth(outlineResizeStartWidth + event.clientX - outlineResizeStartX);
});

function stopOutlineResize(): void {
  outlineResizeStartX = undefined;
  delete document.body.dataset.resizingOutline;
}

outlineResizer.addEventListener('pointerup', stopOutlineResize);
outlineResizer.addEventListener('pointercancel', stopOutlineResize);
outlineResizer.addEventListener('keydown', (event) => {
  const currentWidth = outlinePanel.getBoundingClientRect().width;
  if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
    event.preventDefault();
    setOutlineWidth(currentWidth + (event.key === 'ArrowRight' ? 16 : -16));
  } else if (event.key === 'Home') {
    event.preventDefault();
    setOutlineWidth(0);
  } else if (event.key === 'End') {
    event.preventDefault();
    setOutlineWidth(Number.MAX_SAFE_INTEGER);
  }
});

function updateModeControls(): void {
  configureMermaid(theme, mode);
  modeButtons.forEach((button) => {
    button.setAttribute('aria-pressed', String(button.dataset.mode === mode));
  });
  root.dataset.editable = String(mode === 'edit');
  root.hidden = mode === 'source';
  sourceEditor.hidden = mode !== 'source';
  sourceEditor.readOnly = mode === 'readonly';
  editToolbar.dataset.visible = String(mode === 'edit');
  crepe?.setReadonly(mode !== 'edit');
}

function focusEditorWithoutScrolling(): void {
  crepe?.editor.action((ctx) => {
    ctx.get(editorViewCtx).dom.focus({ preventScroll: true });
  });
}

function setSourceTransitionLoading(loading: boolean): number {
  sourceTransitionId += 1;
  sourceTransitionLoading.hidden = !loading;
  sourceTransitionLoading.removeAttribute('data-error');
  sourceTransitionStatus.textContent = '正在加载 Markdown 内容…';
  modeButtons.forEach((button) => {
    button.disabled = loading;
  });
  root.setAttribute('aria-busy', String(loading));
  return sourceTransitionId;
}

function showSourceTransitionError(error: unknown, transitionId: number): void {
  if (transitionId !== sourceTransitionId) {
    return;
  }
  const detail = error instanceof Error ? error.message : String(error);
  console.error('MarkdownView could not restore the rich editor from source mode.', error);
  sourceTransitionLoading.dataset.error = 'true';
  sourceTransitionStatus.textContent = `无法加载 Markdown 内容：${detail}`;
  modeButtons.forEach((button) => {
    button.disabled = false;
  });
  root.setAttribute('aria-busy', 'false');
}

function finishSourceTransitionLoading(transitionId: number): void {
  window.requestAnimationFrame(() => {
    if (transitionId === sourceTransitionId) {
      setSourceTransitionLoading(false);
    }
  });
}

function flushPendingChange(): void {
  window.clearTimeout(changeTimer);
  if (mode !== 'readonly' && latestMarkdown !== lastAppliedMarkdown) {
    vscode.postMessage({ type: 'change', markdown: latestMarkdown });
    lastAppliedMarkdown = latestMarkdown;
  }
}

function logMarkdownUpdate(
  strategy: 'incremental' | 'chunked' | 'full',
  markdown: string,
  parseMs: number,
  applyMs: number,
): void {
  console.debug(
    `[MarkdownView] source restore (${strategy}): ${markdown.length} chars, ` +
    `parse ${parseMs.toFixed(1)} ms, apply ${applyMs.toFixed(1)} ms`,
  );
}

function tryApplySingleBlockUpdate(previousMarkdown: string, nextMarkdown: string): boolean {
  if (!crepe) {
    return false;
  }
  const previousBlocks = splitSafeMarkdownBlocks(previousMarkdown);
  const nextBlocks = splitSafeMarkdownBlocks(nextMarkdown);
  if (!previousBlocks || !nextBlocks || previousBlocks.length !== nextBlocks.length) {
    return false;
  }

  const changedIndices = previousBlocks.flatMap((block, index) =>
    block.markdown === nextBlocks[index].markdown ? [] : [index],
  );
  if (changedIndices.length !== 1) {
    return false;
  }
  const changedIndex = changedIndices[0];
  const previousBlock = previousBlocks[changedIndex];
  const nextBlock = nextBlocks[changedIndex];
  if (previousBlock.kind !== nextBlock.kind ||
    (nextBlock.kind !== 'paragraph' && nextBlock.kind !== 'heading')) {
    return false;
  }

  const wasApplyingSourceMarkdown = isApplyingSourceMarkdown;
  isApplyingSourceMarkdown = true;
  try {
    return crepe.editor.action((ctx) => {
      const view = ctx.get(editorViewCtx);
      const existingNodes = view.state.doc.content.content;
      if (existingNodes.length !== previousBlocks.length) {
        return false;
      }

      for (const [index, block] of previousBlocks.entries()) {
        const node = existingNodes[index];
        const expectedType = block.kind === 'heading' ? 'heading' : 'paragraph';
        if (block.kind === 'fence') {
          if (node.type.name !== 'code_block' && node.type.name !== 'mermaid_diagram') {
            return false;
          }
        } else if (node.type.name !== expectedType) {
          return false;
        }
      }

      const parseStartedAt = performance.now();
      const parsed = ctx.get(parserCtx)(nextBlock.markdown);
      const parseFinishedAt = performance.now();
      const oldNode = existingNodes[changedIndex];
      if (!parsed || parsed.childCount !== 1 ||
        parsed.firstChild?.type.name !== oldNode.type.name) {
        return false;
      }

      let from = 0;
      for (let index = 0; index < changedIndex; index += 1) {
        from += existingNodes[index].nodeSize;
      }
      view.dispatch(view.state.tr.replaceWith(from, from + oldNode.nodeSize, parsed.content));
      logMarkdownUpdate('incremental', nextMarkdown, parseFinishedAt - parseStartedAt, performance.now() - parseFinishedAt);
      return true;
    });
  } finally {
    isApplyingSourceMarkdown = wasApplyingSourceMarkdown;
  }
}

async function applyMarkdownInChunks(markdown: string, transitionId: number): Promise<boolean> {
  if (!crepe) {
    return false;
  }
  const blocks = splitSafeMarkdownBlocks(markdown);
  if (!blocks || blocks.length < 2) {
    return false;
  }

  let parseMs = 0;
  let applyMs = 0;
  let committed = false;
  isApplyingSourceMarkdown = true;
  try {
    for (let index = 0; index < blocks.length;) {
      if (transitionId !== sourceTransitionId || mode === 'source' || !crepe) {
        return false;
      }

      const end = Math.min(index + 3, blocks.length);
      const parsedBatch: ProseMirrorNode[] = [];
      for (let blockIndex = index; blockIndex < end; blockIndex += 1) {
        const parseStartedAt = performance.now();
        const parsed = crepe.editor.action((ctx) => ctx.get(parserCtx)(blocks[blockIndex].markdown));
        parseMs += performance.now() - parseStartedAt;
        if (!parsed || parsed.childCount !== 1 || !parsed.firstChild) {
          return false;
        }
        parsedBatch.push(parsed.firstChild);
      }

      const applyStartedAt = performance.now();
      crepe.editor.action((ctx) => {
        const view = ctx.get(editorViewCtx);
        const from = committed ? view.state.doc.content.size : 0;
        const to = committed ? from : view.state.doc.content.size;
        view.dispatch(view.state.tr.replaceWith(from, to, parsedBatch));
      });
      applyMs += performance.now() - applyStartedAt;
      committed = true;
      index = end;
      sourceTransitionStatus.textContent = `正在加载 Markdown 内容（${index}/${blocks.length}）…`;
      if (index < blocks.length) {
        await new Promise<void>((resolve) => window.requestAnimationFrame(() => resolve()));
      }
    }
  } finally {
    isApplyingSourceMarkdown = false;
  }

  if (transitionId !== sourceTransitionId || mode === 'source') {
    return false;
  }
  lastAppliedMarkdown = markdown;
  window.requestAnimationFrame(updateOutline);
  logMarkdownUpdate('chunked', markdown, parseMs, applyMs);
  return true;
}

function applyMarkdownInFull(markdown: string): void {
  if (!crepe) {
    throw new Error('The Milkdown editor is not ready.');
  }

  const startedAt = performance.now();
  const wasApplyingSourceMarkdown = isApplyingSourceMarkdown;
  isApplyingSourceMarkdown = true;
  try {
    crepe.editor.action((ctx) => {
      const parseStartedAt = performance.now();
      const parsed = ctx.get(parserCtx)(markdown);
      const parseFinishedAt = performance.now();
      if (!parsed) {
        throw new Error('Milkdown could not parse the Markdown source.');
      }
      const view = ctx.get(editorViewCtx);
      view.dispatch(view.state.tr.replaceWith(0, view.state.doc.content.size, parsed.content));
      const appliedAt = performance.now();
      logMarkdownUpdate('full', markdown, parseFinishedAt - parseStartedAt, appliedAt - parseFinishedAt);
    });
  } finally {
    isApplyingSourceMarkdown = wasApplyingSourceMarkdown;
  }
  lastAppliedMarkdown = markdown;
  window.requestAnimationFrame(updateOutline);
  console.debug(`[MarkdownView] source restore total: ${(performance.now() - startedAt).toFixed(1)} ms`);
}

async function restoreMarkdownFromSource(
  previousMarkdown: string,
  nextMarkdown: string,
  transitionId: number,
): Promise<void> {
  if (tryApplySingleBlockUpdate(previousMarkdown, nextMarkdown)) {
    lastAppliedMarkdown = nextMarkdown;
    window.requestAnimationFrame(updateOutline);
    return;
  }
  if (await applyMarkdownInChunks(nextMarkdown, transitionId)) {
    return;
  }
  if (transitionId === sourceTransitionId && mode !== 'source') {
    applyMarkdownInFull(nextMarkdown);
  }
}

function changeMode(nextMode: EditorMode): void {
  hideBlockInsertMenu();
  if (mode === nextMode) {
    return;
  }
  const previousMode = mode;
  if (mode === 'edit') {
    latestMarkdown = crepe?.getMarkdown() ?? latestMarkdown;
    postChange(latestMarkdown);
  } else if (mode === 'source') {
    latestMarkdown = sourceEditor.value;
    postChange(latestMarkdown);
  }
  flushPendingChange();

  if (nextMode === 'source') {
    sourceEditor.value = latestMarkdown;
    sourceEntryMarkdown = latestMarkdown;
  }

  const previousSourceMarkdown = sourceEntryMarkdown ?? '';
  const sourceChanged = previousMode === 'source' &&
    latestMarkdown !== previousSourceMarkdown;
  const markdownToApply = latestMarkdown;
  mode = nextMode;
  updateModeControls();

  if (sourceChanged) {
    sourceEntryMarkdown = undefined;
    const transitionId = setSourceTransitionLoading(true);
    // Let the target mode paint before synchronously parsing the Markdown into the rich editor.
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => {
        if (mode === 'source' || latestMarkdown !== markdownToApply || !crepe) {
          finishSourceTransitionLoading(transitionId);
          return;
        }
        void restoreMarkdownFromSource(previousSourceMarkdown, markdownToApply, transitionId)
          .then(() => {
            if (mode === 'edit' && transitionId === sourceTransitionId) {
              focusEditorWithoutScrolling();
            }
            finishSourceTransitionLoading(transitionId);
          })
          .catch((error: unknown) => showSourceTransitionError(error, transitionId));
      });
    });
  } else if (previousMode === 'source') {
    sourceEntryMarkdown = undefined;
    setSourceTransitionLoading(false);
  }

  if (mode === 'edit' && !sourceChanged) {
    focusEditorWithoutScrolling();
  } else if (mode === 'source') {
    sourceEditor.focus();
  }
  vscode.postMessage({ type: 'setMode', mode });
}

function hideBlockInsertMenu(): void {
  blockInsertMenu.hidden = true;
  blockInsertPosition = undefined;
}

function showBlockInsertMenu(anchor: DOMRect): void {
  blockInsertMenu.hidden = false;
  const menuRect = blockInsertMenu.getBoundingClientRect();
  const left = Math.max(8, Math.min(anchor.left, window.innerWidth - menuRect.width - 8));
  const top = anchor.bottom + menuRect.height + 8 <= window.innerHeight
    ? anchor.bottom + 4
    : Math.max(8, anchor.top - menuRect.height - 4);
  blockInsertMenu.style.left = `${left}px`;
  blockInsertMenu.style.top = `${top}px`;
  blockInsertMenu.querySelector<HTMLButtonElement>('[role="menuitem"]')?.focus();
}

function insertParagraphAfterPointer(event: PointerEvent): void {
  if (mode !== 'edit' || !crepe) {
    return;
  }
  const operationItem = event.target instanceof Element
    ? event.target.closest<HTMLElement>('.milkdown-block-handle .operation-item')
    : null;
  const operationItems = operationItem?.parentElement?.querySelectorAll<HTMLElement>(':scope > .operation-item');
  if (!operationItem || operationItems?.[0] !== operationItem) {
    return;
  }

  event.preventDefault();
  event.stopPropagation();
  event.stopImmediatePropagation();
  if (event.type !== 'pointerup') {
    return;
  }

  const anchor = operationItem.getBoundingClientRect();
  crepe.editor.action((ctx) => {
    const view = ctx.get(editorViewCtx);
    const editorRect = view.dom.getBoundingClientRect();
    const pointerPosition = view.posAtCoords({
      left: editorRect.left + editorRect.width / 2,
      top: event.clientY,
    })?.pos ?? view.state.selection.from;
    const position = view.state.doc.resolve(pointerPosition);
    const activeNode = position.node(1);
    const insertPosition = position.before(1) + activeNode.nodeSize;
    const transaction = view.state.tr.insert(
      insertPosition,
      paragraphSchema.type(ctx).create(),
    );
    const selection = TextSelection.near(transaction.doc.resolve(insertPosition + 1));
    view.dispatch(transaction.setSelection(selection).scrollIntoView());
    blockInsertPosition = selection.from;
    view.focus();
  });
  showBlockInsertMenu(anchor);
}

root.addEventListener('pointerdown', insertParagraphAfterPointer, true);
root.addEventListener('pointerup', insertParagraphAfterPointer, true);

blockInsertMenu.addEventListener('mousedown', (event) => {
  if (event.target instanceof Element && event.target.closest('[role="menuitem"]')) {
    event.preventDefault();
  }
});
blockInsertMenu.addEventListener('click', (event) => {
  const button = event.target instanceof Element
    ? event.target.closest<HTMLButtonElement>('[data-insert]')
    : null;
  if (!button || mode !== 'edit') {
    return;
  }

  const action = button.dataset.insert ?? '';
  const insertionPosition = blockInsertPosition;
  hideBlockInsertMenu();
  if (insertionPosition !== undefined) {
    crepe?.editor.action((ctx) => {
      const view = ctx.get(editorViewCtx);
      view.focus();
      const position = Math.min(insertionPosition, view.state.doc.content.size);
      const selection = TextSelection.near(view.state.doc.resolve(position));
      view.dispatch(view.state.tr.setSelection(selection));
    });
  }

  switch (action) {
    case 'paragraph':
      crepe?.editor.action((ctx) => {
        ctx.get(commandsCtx).call(setBlockTypeCommand.key, {
          nodeType: paragraphSchema.type(ctx),
        });
      });
      break;
    case 'heading-1':
    case 'heading-2':
    case 'heading-3':
    case 'heading-4':
    case 'heading-5':
    case 'heading-6':
      crepe?.editor.action((ctx) => {
        ctx.get(commandsCtx).call(setBlockTypeCommand.key, {
          nodeType: headingSchema.type(ctx),
          attrs: { level: Number(action.slice(-1)) },
        });
      });
      break;
    case 'quote':
      runCommand(callCommand(wrapInBlockquoteCommand.key));
      break;
    case 'bullet-list':
      runCommand(callCommand(wrapInBulletListCommand.key));
      break;
    case 'ordered-list':
      runCommand(callCommand(wrapInOrderedListCommand.key));
      break;
    case 'task-list':
      runInsertion('- [ ] 任务内容');
      break;
    case 'definition-list':
      runInsertion('术语\n: 定义内容');
      break;
    case 'divider':
      runCommand(callCommand(insertHrCommand.key));
      break;
    case 'table':
      runCommand(callCommand(insertTableCommand.key, { row: 2, col: 2 }));
      break;
    case 'code-block':
      runCommand(callCommand(createCodeBlockCommand.key));
      break;
    case 'details':
      runInsertion('<details>\n<summary>折叠内容</summary>\n\n在此输入内容。\n\n</details>');
      break;
  }
  crepe?.editor.action((ctx) => ctx.get(editorViewCtx).focus());
});

document.addEventListener('pointerdown', (event) => {
  if (!(event.target instanceof Node) || blockInsertMenu.contains(event.target)) {
    return;
  }
  hideBlockInsertMenu();
});
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && !blockInsertMenu.hidden) {
    hideBlockInsertMenu();
    crepe?.editor.action((ctx) => ctx.get(editorViewCtx).focus());
  }
});

function runCommand(action: (ctx: Ctx) => boolean): void {
  crepe?.editor.action(action);
}

function runInsertion(markdown: string): void {
  crepe?.editor.action(insert(markdown));
}

function requestValue(label: string, value = '', required = true): Promise<string | null> {
  if (!inputDialog || !inputDialogLabel || !inputDialogField) {
    throw new Error('MarkdownView toolbar input dialog is unavailable.');
  }
  inputDialogLabel.textContent = label;
  inputDialogField.value = value;
  inputDialogField.required = required;
  return new Promise((resolve) => {
    inputDialog.addEventListener('close', () => {
      resolve(inputDialog.returnValue === 'confirm' ? inputDialogField.value : null);
    }, { once: true });
    inputDialog.showModal();
    inputDialogField.focus();
  });
}

async function requestImage(): Promise<void> {
  const src = await requestValue('图片地址或相对路径');
  if (!src?.trim()) {
    return;
  }
  const alt = await requestValue('图片说明', '', false) ?? '';
  runCommand(callCommand(insertImageCommand.key, { src: src.trim(), alt }));
}

async function requestLink(): Promise<void> {
  const href = await requestValue('链接地址');
  if (!href?.trim()) {
    return;
  }
  runCommand(callCommand(toggleLinkCommand.key, { href: href.trim() }));
}

editToolbar.addEventListener('mousedown', (event) => {
  if (event.target instanceof Element && event.target.closest('button')) {
    event.preventDefault();
  }
});
editToolbar.addEventListener('click', (event) => {
  const button = event.target instanceof Element
    ? event.target.closest<HTMLButtonElement>('button[data-action]')
    : null;
  const action = button?.dataset.action;
  switch (action) {
    case 'heading-1':
    case 'heading-2':
    case 'heading-3': {
      const level = Number(action.slice(-1));
      crepe?.editor.action((ctx) => {
        ctx.get(commandsCtx).call(setBlockTypeCommand.key, {
          nodeType: headingSchema.type(ctx),
          attrs: { level },
        });
      });
      break;
    }
    case 'bold':
      runCommand(callCommand(toggleStrongCommand.key));
      break;
    case 'italic':
      runCommand(callCommand(toggleEmphasisCommand.key));
      break;
    case 'strike':
      runCommand(callCommand(toggleStrikethroughCommand.key));
      break;
    case 'inline-code':
      runCommand(callCommand(toggleInlineCodeCommand.key));
      break;
    case 'horizontal-rule':
      runCommand(callCommand(insertHrCommand.key));
      break;
    case 'quote':
      runCommand(callCommand(wrapInBlockquoteCommand.key));
      break;
    case 'table':
      runCommand(callCommand(insertTableCommand.key, { row: 2, col: 2 }));
      break;
    case 'code-block':
      runCommand(callCommand(createCodeBlockCommand.key));
      break;
    case 'details':
      runInsertion('<details>\n<summary>折叠内容</summary>\n\n在此输入内容。\n\n</details>');
      break;
    case 'image':
      void requestImage();
      break;
    case 'link':
      void requestLink();
      break;
  }
});

listFormat?.addEventListener('change', () => {
  const listType = listFormat.value;
  if (listType === 'bullet') {
    runCommand(callCommand(wrapInBulletListCommand.key));
  } else if (listType === 'ordered') {
    runCommand(callCommand(wrapInOrderedListCommand.key));
  } else if (listType === 'task') {
    const selection = crepe?.editor.action((ctx) => {
      const { state } = ctx.get(editorViewCtx);
      return state.doc.textBetween(state.selection.from, state.selection.to, '\n').trim();
    });
    runInsertion((selection || '任务内容')
      .split(/\r?\n/)
      .map((line) => `- [ ] ${line}`)
      .join('\n'));
  } else if (listType === 'definition') {
    const selection = crepe?.editor.action((ctx) => {
      const { state } = ctx.get(editorViewCtx);
      return state.doc.textBetween(state.selection.from, state.selection.to, '\n').trim();
    });
    runInsertion(`${selection || '术语'}\n: 定义内容`);
  }
  listFormat.value = '';
});

modeButtons.forEach((button) => {
  const buttonMode = button.dataset.mode;
  if (buttonMode === 'readonly' || buttonMode === 'edit' || buttonMode === 'source') {
    button.addEventListener('click', () => changeMode(buttonMode));
  }
});

updateModeControls();

function postChange(markdown: string): void {
  latestMarkdown = markdown;
  window.requestAnimationFrame(updateOutline);
  if (markdown === lastAppliedMarkdown) {
    return;
  }
  window.clearTimeout(changeTimer);
  changeTimer = window.setTimeout(() => {
    if (markdown === lastAppliedMarkdown) {
      return;
    }
    vscode.postMessage({ type: 'change', markdown });
    lastAppliedMarkdown = markdown;
  }, 120);
}

function updateOutline(): void {
  const fragment = document.createDocumentFragment();
  const headings = mode === 'source'
    ? [...sourceEditor.value.matchAll(/^(#{1,6})\s+(.+?)\s*#*\s*$/gm)].map((match) => ({
        label: match[2].replace(/[*_~`[\]]/g, '').trim(),
        level: match[1].length,
        lineStart: match.index ?? 0,
      }))
    : [...root.querySelectorAll<HTMLElement>(
        '.ProseMirror h1, .ProseMirror h2, .ProseMirror h3, .ProseMirror h4, .ProseMirror h5, .ProseMirror h6',
      )].map((heading) => ({
        label: heading.textContent?.trim() ?? '',
        level: Number(heading.tagName.slice(1)),
        element: heading,
      }));
  headings.forEach((heading) => {
    if (!heading.label) return;
    const button = document.createElement('button');
    button.className = 'outline-item';
    button.type = 'button';
    button.textContent = heading.label;
    button.style.setProperty('--heading-level', String(heading.level));
    button.addEventListener('click', () => {
      if ('element' in heading) {
        heading.element.scrollIntoView({ behavior: 'smooth', block: 'start' });
      } else {
        sourceEditor.focus();
        sourceEditor.setSelectionRange(heading.lineStart, heading.lineStart);
      }
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
  configureMermaid(theme, mode);

  const initialMarkdown = latestMarkdown;
  const nextEditor = new Crepe({
    root,
    defaultValue: initialMarkdown,
    features: {
      [Crepe.Feature.BlockEdit]: true,
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
    listener.markdownUpdated((_context, markdown) => {
      if (!isApplyingSourceMarkdown) {
        postChange(markdown);
      }
    });
  });
  nextEditor.setReadonly(mode !== 'edit');

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
  mode = message.mode;
  if (sourceEditor.value !== message.markdown) {
    sourceEditor.value = message.markdown;
  }
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
      mode = message.mode;
      updateModeControls();
      if (mode === 'source') {
        sourceEditor.value = latestMarkdown;
      }
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

sourceEditor.addEventListener('input', () => {
  postChange(sourceEditor.value);
});

vscode.postMessage({ type: 'ready' });
