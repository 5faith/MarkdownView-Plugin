import { EditorView } from '@codemirror/view';
import { Crepe } from '@milkdown/crepe';
import type { Ctx } from '@milkdown/kit/ctx';
import { commandsCtx, editorViewCtx, parserCtx } from '@milkdown/kit/core';
import type { Node as ProseMirrorNode } from '@milkdown/kit/prose/model';
import { TextSelection } from '@milkdown/kit/prose/state';
import type { EditorView as ProseMirrorEditorView } from '@milkdown/kit/prose/view';
import {
  createCodeBlockCommand,
  emphasisSchema,
  headingSchema,
  inlineCodeSchema,
  insertHrCommand,
  insertImageCommand,
  linkSchema,
  paragraphSchema,
  setBlockTypeCommand,
  strongSchema,
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
  strikethroughSchema,
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
let hostUsesCrLf = false;
let theme: ThemeKind = 'light';
let fontSize = 14;
let mode: EditorMode = 'readonly';
let changeTimer: number | undefined;
let editorTask: Promise<void> = Promise.resolve();
let sourceEntryMarkdown: string | undefined;
let sourceTransitionId = 0;
let isApplyingSourceMarkdown = false;

/**
 * Normalize CRLF/CR line endings to LF before markdown enters Milkdown.
 * ProseMirror keeps "\r" as regular characters inside code blocks while
 * CodeMirror folds "\r\n" into a single line break, so mixed endings break
 * the 1:1 offset mapping of the code block NodeView and corrupt edits.
 */
function normalizeMarkdownEol(markdown: string): string {
  return markdown.replace(/\r\n?/g, '\n');
}

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
  hideLinkImageToolbar();
  hideSelectionToolbar();
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

function requestValue(
  label: string,
  value = '',
  required = true,
  validate?: (input: string) => string | null,
): Promise<string | null> {
  if (!inputDialog || !inputDialogLabel || !inputDialogField) {
    throw new Error('MarkdownView toolbar input dialog is unavailable.');
  }
  const baseLabel = label;
  inputDialogLabel.textContent = label;
  inputDialogField.value = value;
  inputDialogField.required = required;
  const onSubmit = (event: Event) => {
    const submitter = event instanceof SubmitEvent ? event.submitter : null;
    if (!validate || !(submitter instanceof HTMLButtonElement) || submitter.value !== 'confirm') {
      return;
    }
    const error = validate(inputDialogField.value);
    if (error) {
      event.preventDefault();
      inputDialogLabel.textContent = `${baseLabel}（${error}）`;
    }
  };
  return new Promise((resolve) => {
    inputDialog.addEventListener('close', () => {
      inputDialog.removeEventListener('submit', onSubmit);
      resolve(inputDialog.returnValue === 'confirm' ? inputDialogField.value : null);
    }, { once: true });
    inputDialog.addEventListener('submit', onSubmit);
    inputDialog.showModal();
    inputDialogField.focus();
  });
}

/**
 * Validate a link href for editing. Allows relative paths (including anchors)
 * and mailto; http(s) URLs must not point at loopback, private or reserved
 * hosts; every other scheme (javascript:, file:, data:, …) is rejected.
 */
function validateLinkHref(input: string): string | null {
  const value = input.trim();
  if (!value) {
    return '地址不能为空';
  }
  if (value.startsWith('//')) {
    return validateHttpUrl(`http:${value}`) ? null : '不允许访问本地或保留地址';
  }
  if (value.startsWith('mailto:')) {
    return null;
  }
  if (/^https?:\/\//i.test(value)) {
    return validateHttpUrl(value) ? null : '仅允许指向公网地址的 http/https 链接';
  }
  if (/^[a-z][a-z0-9+.-]*:/i.test(value)) {
    return '仅允许 http/https/mailto 或相对路径';
  }
  return null;
}

/** Validate an image src. Same rules as links, plus data:image/* URLs. */
function validateImageSrc(input: string): string | null {
  const value = input.trim();
  if (!value) {
    return '地址不能为空';
  }
  if (value.startsWith('//')) {
    return validateHttpUrl(`http:${value}`) ? null : '不允许访问本地或保留地址';
  }
  if (/^data:image\//i.test(value)) {
    return null;
  }
  if (/^https?:\/\//i.test(value)) {
    return validateHttpUrl(value) ? null : '仅允许指向公网地址的 http/https 图片';
  }
  if (/^[a-z][a-z0-9+.-]*:/i.test(value)) {
    return '仅允许 http/https、data:image 或相对路径';
  }
  return null;
}

function validateHttpUrl(value: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return false;
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return false;
  }
  return !isForbiddenHost(parsed.hostname);
}

function isForbiddenHost(hostname: string): boolean {
  let host = hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (host.startsWith('::ffff:')) {
    host = host.slice(7);
  }
  if (host === '::1' || host === '::' || host === '0:0:0:0:0:0:0:1') {
    return true;
  }
  if (host.startsWith('fc') || host.startsWith('fd')) {
    return true; // IPv6 unique local addresses (fc00::/7)
  }
  return /^(localhost|.*\.localhost|.*\.local|localhost$|0\.0\.0\.0|127\.\d{1,3}\.\d{1,3}\.\d{1,3}|10\.\d{1,3}\.\d{1,3}\.\d{1,3}|192\.168\.\d{1,3}\.\d{1,3}|169\.254\.\d{1,3}\.\d{1,3}|172\.(1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3})$/.test(host);
}

type LinkImageToolbarTarget =
  | { kind: 'link'; element: HTMLAnchorElement }
  | { kind: 'image'; element: HTMLElement };

let linkImageToolbar: HTMLElement | null = null;
let linkImageToolbarTarget: LinkImageToolbarTarget | null = null;
let linkImageToolbarNode: { pos: number; node: ProseMirrorNode } | null = null;

const SVG_ICONS = {
  link: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>',
  image: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="M21 15l-5-5L5 21"/></svg>',
  pencil: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z"/></svg>',
  trash: '<svg viewBox="0 0 24 24" aria-hidden="true"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/></svg>',
};

function createIconButton(className: string, title: string, icon: string): HTMLButtonElement {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = className;
  button.title = title;
  button.setAttribute('aria-label', title);
  button.innerHTML = icon;
  return button;
}

function ensureLinkImageToolbar(): HTMLElement {
  if (linkImageToolbar) {
    return linkImageToolbar;
  }
  const bar = document.createElement('div');
  bar.id = 'link-image-toolbar';
  bar.hidden = true;

  const kindIcon = document.createElement('span');
  kindIcon.className = 'link-image-toolbar-icon';
  kindIcon.innerHTML = SVG_ICONS.link;

  const urlLabel = document.createElement('span');
  urlLabel.className = 'link-image-toolbar-url';

  const editButton = createIconButton('link-image-toolbar-edit', '修改地址', SVG_ICONS.pencil);
  editButton.addEventListener('click', () => {
    void handleLinkImageToolbarEdit();
  });

  const removeButton = createIconButton('link-image-toolbar-remove', '移除', SVG_ICONS.trash);
  removeButton.addEventListener('click', () => {
    handleLinkImageToolbarRemove();
  });

  bar.append(kindIcon, urlLabel, editButton, removeButton);
  bar.addEventListener('pointerdown', (event) => {
    // Clicking the bar must not steal the caret away from the editor.
    if (event.target instanceof Element && event.target.closest('button')) {
      event.preventDefault();
    }
  });
  document.body.appendChild(bar);

  document.addEventListener('pointerdown', (event) => {
    if (!bar.hidden && event.target instanceof Node && !bar.contains(event.target)) {
      hideLinkImageToolbar();
    }
  }, true);
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && (!bar.hidden || (selectionToolbar && !selectionToolbar.hidden))) {
      hideLinkImageToolbar();
      hideSelectionToolbar();
    }
  });
  window.addEventListener('scroll', () => {
    if (!bar.hidden) {
      hideLinkImageToolbar();
    }
    if (selectionToolbar && !selectionToolbar.hidden) {
      hideSelectionToolbar();
    }
  }, true);

  linkImageToolbar = bar;
  return bar;
}

function hideLinkImageToolbar(): void {
  linkImageToolbarTarget = null;
  linkImageToolbarNode = null;
  if (linkImageToolbar && !linkImageToolbar.hidden) {
    linkImageToolbar.hidden = true;
  }
}

function showLinkImageToolbar(target: LinkImageToolbarTarget): void {
  const bar = ensureLinkImageToolbar();
  const kindIcon = bar.querySelector<HTMLElement>('.link-image-toolbar-icon');
  const urlLabel = bar.querySelector<HTMLElement>('.link-image-toolbar-url');
  const editButton = bar.querySelector<HTMLButtonElement>('.link-image-toolbar-edit');
  const removeButton = bar.querySelector<HTMLButtonElement>('.link-image-toolbar-remove');
  if (!kindIcon || !urlLabel || !editButton || !removeButton) {
    return;
  }
  linkImageToolbarTarget = target;
  linkImageToolbarNode = null;
  if (target.kind === 'link') {
    const href = target.element.getAttribute('href') ?? '';
    kindIcon.innerHTML = SVG_ICONS.link;
    urlLabel.textContent = href;
    urlLabel.title = href;
    editButton.title = '修改地址';
    removeButton.title = '移除链接';
  } else {
    const imageNode = findImageNodeFromElement(target.element);
    if (!imageNode) {
      linkImageToolbarTarget = null;
      return;
    }
    linkImageToolbarNode = imageNode;
    const rawSrc = String(imageNode.node.attrs.src ?? '');
    kindIcon.innerHTML = SVG_ICONS.image;
    urlLabel.textContent = rawSrc;
    urlLabel.title = rawSrc;
    editButton.title = '修改地址';
    removeButton.title = '删除图片';
  }
  bar.hidden = false;
  const rect = target.element.getBoundingClientRect();
  const barRect = bar.getBoundingClientRect();
  const left = Math.max(8, Math.min(rect.left, window.innerWidth - barRect.width - 8));
  const top = rect.top - barRect.height - 6 >= 8 ? rect.top - barRect.height - 6 : rect.bottom + 6;
  bar.style.left = `${Math.round(left)}px`;
  bar.style.top = `${Math.round(Math.max(8, top))}px`;
}

function openMarkdownHref(href: string): void {
  if (href.startsWith('#')) {
    scrollToAnchor(href);
    return;
  }
  vscode.postMessage({ type: 'openLink', href });
}

function findImageNodeFromElement(element: Element): { pos: number; node: ProseMirrorNode } | null {
  let result: { pos: number; node: ProseMirrorNode } | null = null;
  crepe?.editor.action((ctx) => {
    const view = ctx.get(editorViewCtx);
    result = findImageTargetInDoc(view, element);
  });
  return result;
}

function findImageTargetInDoc(
  view: ProseMirrorEditorView,
  element: Element,
): { pos: number; node: ProseMirrorNode } | null {
  const offsets = [0, element.childNodes.length];
  for (const offset of offsets) {
    let point: number;
    try {
      point = view.posAtDOM(element, offset);
    } catch {
      continue;
    }
    const $point = view.state.doc.resolve(point);
    const nodeAfter = $point.nodeAfter;
    if (nodeAfter && (nodeAfter.type.name === 'image' || nodeAfter.type.name === 'image-block')) {
      return { pos: $point.pos, node: nodeAfter };
    }
    const nodeBefore = $point.nodeBefore;
    if (nodeBefore && (nodeBefore.type.name === 'image' || nodeBefore.type.name === 'image-block')) {
      return { pos: $point.pos - nodeBefore.nodeSize, node: nodeBefore };
    }
    for (let depth = $point.depth; depth > 0; depth -= 1) {
      const node = $point.node(depth);
      if (node.type.name === 'image-block') {
        return { pos: $point.before(depth), node };
      }
    }
  }
  return null;
}

function findLinkRangeFromAnchor(
  view: ProseMirrorEditorView,
  anchor: HTMLAnchorElement,
): { from: number; to: number } | null {
  try {
    const from = view.posAtDOM(anchor, 0);
    const to = view.posAtDOM(anchor, anchor.childNodes.length);
    if (to > from) {
      return { from, to };
    }
  } catch {
    // The anchor is no longer attached to the document; nothing to update.
  }
  return null;
}

async function handleLinkImageToolbarEdit(): Promise<void> {
  const target = linkImageToolbarTarget;
  if (!target) {
    return;
  }
  if (target.kind === 'link') {
    const current = target.element.getAttribute('href') ?? '';
    const href = await requestValue('链接地址', current, true, validateLinkHref);
    if (href !== null) {
      const next = href.trim();
      if (next && next !== current) {
        applyLinkHref(target.element, next);
      }
    }
  } else {
    const imageNode = linkImageToolbarNode ?? findImageNodeFromElement(target.element);
    if (!imageNode) {
      return;
    }
    const current = String(imageNode.node.attrs.src ?? '');
    const src = await requestValue('图片地址或相对路径', current, true, validateImageSrc);
    if (src !== null) {
      const next = src.trim();
      if (next && next !== current) {
        applyImageSrc(target.element, next);
      }
    }
  }
  hideLinkImageToolbar();
}

function handleLinkImageToolbarRemove(): void {
  const target = linkImageToolbarTarget;
  if (!target) {
    return;
  }
  if (target.kind === 'link') {
    const anchor = target.element;
    crepe?.editor.action((ctx) => {
      const view = ctx.get(editorViewCtx);
      const range = findLinkRangeFromAnchor(view, anchor);
      if (!range) {
        return;
      }
      view.dispatch(view.state.tr.removeMark(range.from, range.to, linkSchema.type(ctx)));
    });
  } else {
    crepe?.editor.action((ctx) => {
      const view = ctx.get(editorViewCtx);
      const imageNode = findImageTargetInDoc(view, target.element);
      if (!imageNode) {
        return;
      }
      view.dispatch(
        view.state.tr.delete(imageNode.pos, imageNode.pos + imageNode.node.nodeSize),
      );
    });
  }
  hideLinkImageToolbar();
}

function applyLinkHref(anchor: HTMLAnchorElement, href: string): void {
  crepe?.editor.action((ctx) => {
    const view = ctx.get(editorViewCtx);
    const range = findLinkRangeFromAnchor(view, anchor);
    if (!range) {
      return;
    }
    const linkType = linkSchema.type(ctx);
    const tr = view.state.tr
      .removeMark(range.from, range.to, linkType)
      .addMark(range.from, range.to, linkType.create({ href }));
    view.dispatch(tr);
  });
}

function applyImageSrc(element: HTMLElement, src: string): void {
  crepe?.editor.action((ctx) => {
    const view = ctx.get(editorViewCtx);
    const imageNode = findImageTargetInDoc(view, element);
    if (!imageNode) {
      return;
    }
    const tr = view.state.tr.setNodeMarkup(imageNode.pos, undefined, { ...imageNode.node.attrs, src });
    view.dispatch(tr);
  });
}

/**
 * Re-point image DOM sources at the latest webview URIs. The host only
 * recomputes the images map after an edit lands, while the Crepe image views
 * bind their src at render time, so relative-path sources need this nudge to
 * display right after being changed.
 */
function refreshProxiedImageSources(): void {
  crepe?.editor.action((ctx) => {
    const view = ctx.get(editorViewCtx);
    view.state.doc.descendants((node, pos) => {
      if (node.type.name !== 'image' && node.type.name !== 'image-block') {
        return;
      }
      const rawSrc = String(node.attrs.src ?? '');
      let decoded = rawSrc;
      try {
        decoded = decodeURIComponent(rawSrc);
      } catch {
        // Keep the raw source when it is not a valid escape sequence.
      }
      const mapped = latestImages[rawSrc] ?? latestImages[decoded];
      if (!mapped) {
        return;
      }
      const dom = view.nodeDOM(pos);
      const img = dom instanceof HTMLElement ? (dom.tagName === 'IMG' ? dom : dom.querySelector('img')) : null;
      if (img && img.getAttribute('src') !== mapped) {
        img.setAttribute('src', mapped);
      }
    });
  });
}

let selectionToolbar: HTMLElement | null = null;
let selectionToolbarTimer: number | undefined;

function ensureSelectionToolbar(): HTMLElement {
  if (selectionToolbar) {
    return selectionToolbar;
  }
  const bar = document.createElement('div');
  bar.id = 'selection-format-toolbar';
  bar.hidden = true;

  const strongLabel = document.createElement('strong');
  strongLabel.textContent = 'B';
  const emphasisLabel = document.createElement('em');
  emphasisLabel.textContent = 'I';
  const strikeLabel = document.createElement('s');
  strikeLabel.textContent = 'S';
  const codeLabel = document.createElement('code');
  codeLabel.textContent = '<>';
  const mathLabel = document.createElement('span');
  mathLabel.textContent = 'Σ';

  const items: Array<{ action: string; title: string; label: HTMLElement; icon?: string }> = [
    { action: 'strong', title: '加粗', label: strongLabel },
    { action: 'emphasis', title: '斜体', label: emphasisLabel },
    { action: 'strike_through', title: '删除线', label: strikeLabel },
    { action: 'inlineCode', title: '行内代码', label: codeLabel },
    { action: 'math', title: '行内公式', label: mathLabel },
    { action: 'link', title: '链接', label: document.createElement('span'), icon: SVG_ICONS.link },
  ];
  for (const item of items) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'selection-format-item';
    button.dataset.action = item.action;
    button.title = item.title;
    button.setAttribute('aria-label', item.title);
    if (item.icon) {
      button.innerHTML = item.icon;
    } else {
      button.appendChild(item.label);
    }
    // Keep the editor selection alive while clicking the toolbar.
    button.addEventListener('pointerdown', (event) => event.preventDefault());
    button.addEventListener('click', () => {
      runSelectionFormatAction(item.action);
    });
    bar.appendChild(button);
  }
  document.body.appendChild(bar);

  selectionToolbar = bar;
  return bar;
}

document.addEventListener('selectionchange', () => {
  scheduleSelectionToolbarUpdate();
});
document.addEventListener('pointerdown', (event) => {
  if (
    selectionToolbar
    && !selectionToolbar.hidden
    && event.target instanceof Node
    && !selectionToolbar.contains(event.target)
  ) {
    hideSelectionToolbar();
  }
}, true);

function hideSelectionToolbar(): void {
  if (selectionToolbar && !selectionToolbar.hidden) {
    selectionToolbar.hidden = true;
  }
}

function scheduleSelectionToolbarUpdate(): void {
  window.clearTimeout(selectionToolbarTimer);
  selectionToolbarTimer = window.setTimeout(() => {
    updateSelectionToolbar();
  }, 120);
}

function runSelectionFormatAction(action: string): void {
  if (action === 'link') {
    void requestLink();
    return;
  }
  if (action === 'math') {
    runCommand((ctx) => {
      ctx.get(commandsCtx).call('ToggleLatex');
      return true;
    });
    return;
  }
  const commands: Record<string, () => void> = {
    strong: () => runCommand(callCommand(toggleStrongCommand.key)),
    emphasis: () => runCommand(callCommand(toggleEmphasisCommand.key)),
    strike_through: () => runCommand(callCommand(toggleStrikethroughCommand.key)),
    inlineCode: () => runCommand(callCommand(toggleInlineCodeCommand.key)),
  };
  commands[action]?.();
}

function updateSelectionToolbar(): void {
  if (mode !== 'edit' || (inputDialog && inputDialog.open)) {
    hideSelectionToolbar();
    return;
  }
  const domSelection = window.getSelection();
  if (!domSelection || domSelection.isCollapsed || domSelection.rangeCount === 0) {
    hideSelectionToolbar();
    return;
  }
  const range = domSelection.getRangeAt(0);
  const container = range.commonAncestorContainer instanceof Element
    ? range.commonAncestorContainer
    : range.commonAncestorContainer.parentElement;
  if (!container || !root.contains(container) || container.closest('.cm-editor, .mermaid-diagram')) {
    hideSelectionToolbar();
    return;
  }
  const measured: { rect: DOMRect | null } = { rect: null };
  crepe?.editor.action((ctx) => {
    const view = ctx.get(editorViewCtx);
    const selection = view.state.selection;
    if (selection.empty) {
      return;
    }
    measured.rect = range.getBoundingClientRect();
    applySelectionToolbarState(ctx, view, selection.from, selection.to);
  });
  const bar = ensureSelectionToolbar();
  if (!measured.rect) {
    hideSelectionToolbar();
    return;
  }
  const rect = measured.rect;
  const barRect = bar.getBoundingClientRect();
  const left = Math.max(8, Math.min(rect.left + rect.width / 2 - barRect.width / 2, window.innerWidth - barRect.width - 8));
  const top = rect.top - barRect.height - 6 >= 8 ? rect.top - barRect.height - 6 : rect.bottom + 6;
  bar.style.left = `${Math.round(left)}px`;
  bar.style.top = `${Math.round(Math.max(8, top))}px`;
  bar.hidden = false;
}

function applySelectionToolbarState(
  ctx: Ctx,
  view: ProseMirrorEditorView,
  from: number,
  to: number,
): void {
  const bar = selectionToolbar;
  if (!bar) {
    return;
  }
  const setState = (action: string, active: boolean) => {
    const button = bar.querySelector<HTMLButtonElement>(`[data-action="${action}"]`);
    if (button) {
      button.classList.toggle('active', active);
    }
  };
  setState('strong', view.state.doc.rangeHasMark(from, to, strongSchema.type(ctx)));
  setState('emphasis', view.state.doc.rangeHasMark(from, to, emphasisSchema.type(ctx)));
  setState('strike_through', view.state.doc.rangeHasMark(from, to, strikethroughSchema.type(ctx)));
  setState('inlineCode', view.state.doc.rangeHasMark(from, to, inlineCodeSchema.type(ctx)));
  setState('link', view.state.doc.rangeHasMark(from, to, linkSchema.type(ctx)));
  let hasMath = false;
  view.state.doc.nodesBetween(from, to, (node) => {
    if (node.type.name === 'math_inline') {
      hasMath = true;
    }
  });
  setState('math', hasMath);
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
    // Keep the document's original CRLF endings: the webview normalizes to LF
    // internally, so restore them before writing back to VS Code.
    const outgoing = hostUsesCrLf ? markdown.replace(/\n/g, '\r\n') : markdown;
    vscode.postMessage({ type: 'change', markdown: outgoing });
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
  hostUsesCrLf = message.markdown.includes('\r\n');
  const markdown = normalizeMarkdownEol(message.markdown);
  window.clearTimeout(changeTimer);
  latestMarkdown = markdown;
  latestImages = message.images;
  mode = message.mode;
  hideLinkImageToolbar();
  hideSelectionToolbar();
  if (sourceEditor.value !== markdown) {
    sourceEditor.value = markdown;
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
    refreshProxiedImageSources();
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

// Link/image click interception runs on document capture so it wins over the
// VS Code webview host scripts and ProseMirror handlers: in edit mode a plain
// click opens the address popover, Ctrl/Cmd+Click opens the address, and in
// readonly mode clicks follow the link.
document.addEventListener('click', (event) => {
  const target = event.target;
  if (!(target instanceof Element) || !root.contains(target)) {
    return;
  }
  const editPointer = mode === 'edit' && !event.ctrlKey && !event.metaKey;
  const imageElement = target.closest<HTMLElement>('.milkdown-image-block')
    ?? (target.closest('img') instanceof HTMLElement ? target.closest('img') : null);
  const link = target.closest<HTMLAnchorElement>('a[href]');
  if (!link && !imageElement) {
    return;
  }
  event.preventDefault();
  event.stopPropagation();
  if (link && editPointer) {
    showLinkImageToolbar({ kind: 'link', element: link });
    return;
  }
  if (link) {
    openMarkdownHref(link.getAttribute('href') ?? '');
    return;
  }
  if (editPointer && imageElement) {
    showLinkImageToolbar({ kind: 'image', element: imageElement });
    return;
  }
  if (imageElement) {
    const imageNode = findImageNodeFromElement(imageElement);
    const src = imageNode ? String(imageNode.node.attrs.src ?? '') : '';
    if (src) {
      openMarkdownHref(src);
    }
  }
}, true);

root.addEventListener('click', () => {
  hideLinkImageToolbar();
});

sourceEditor.addEventListener('input', () => {
  postChange(sourceEditor.value);
});

vscode.postMessage({ type: 'ready' });
