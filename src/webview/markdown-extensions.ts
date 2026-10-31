import remarkDefinitionList from 'remark-definition-list';
import type { MilkdownPlugin } from '@milkdown/kit/ctx';
import { InitReady, remarkPluginsCtx } from '@milkdown/kit/core';
import { $nodeSchema, $remark, $view } from '@milkdown/kit/utils';
import type { RemarkPlugin } from '@milkdown/kit/transformer';
import { mermaidDiagramPlugins } from './mermaid-view';

interface AstNode {
  type: string;
  [key: string]: unknown;
}

function isAstNode(value: unknown): value is AstNode {
  return typeof value === 'object' && value !== null &&
    'type' in value && typeof value.type === 'string';
}

function getChildren(node: AstNode): AstNode[] | undefined {
  if (!Array.isArray(node.children)) {
    return undefined;
  }
  return node.children.filter(isAstNode);
}

function textValue(node: AstNode): string {
  return typeof node.value === 'string' ? node.value : '';
}

function plainHtmlText(value: string): string {
  return value
    .replace(/<[^>]*>/g, '')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, '\'')
    .trim();
}

function convertAlert(node: AstNode): AstNode {
  const children = getChildren(node);
  if (node.type !== 'blockquote' || !children?.length || children[0].type !== 'paragraph') {
    return node;
  }

  const paragraph = children[0];
  const inlineChildren = getChildren(paragraph);
  const firstText = inlineChildren?.[0];
  if (!firstText || firstText.type !== 'text') {
    return node;
  }

  const match = /^\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\](?:[ \t]*\r?\n[ \t]*|[ \t]*)/i.exec(textValue(firstText));
  if (!match) {
    return node;
  }

  const alertType = match[1].toLowerCase();
  const remainder = textValue(firstText).slice(match[0].length);
  if (remainder) {
    firstText.value = remainder;
  } else {
    inlineChildren.splice(0, 1);
  }
  paragraph.children = inlineChildren;
  if (inlineChildren.length === 0) {
    children.splice(0, 1);
  }

  return { type: 'markdownviewAlert', kind: alertType, children };
}

function isDetailsTag(node: AstNode): boolean {
  return node.type === 'html' && /^<details\b[^>]*>/i.test(textValue(node).trim());
}

function convertDetails(children: AstNode[]): AstNode[] {
  const result: AstNode[] = [];

  for (let index = 0; index < children.length; index += 1) {
    const opening = children[index];
    if (!isDetailsTag(opening)) {
      result.push(opening);
      continue;
    }

    const firstHtml = textValue(opening);
    const openTag = /^<details\b([^>]*)>/i.exec(firstHtml.trim());
    const summaryMatch = /<summary\b[^>]*>([\s\S]*?)<\/summary\s*>/i.exec(firstHtml);
    const summary = summaryMatch ? plainHtmlText(summaryMatch[1]) : 'Details';
    const content: AstNode[] = [];
    let depth = 1;
    let closed = false;

    for (let cursor = index; cursor < children.length; cursor += 1) {
      const current = children[cursor];
      const html = current.type === 'html' ? textValue(current) : '';
      if (cursor > index) {
        depth += [...html.matchAll(/<details\b[^>]*>/gi)].length;
      }
      depth -= [...html.matchAll(/<\/details\s*>/gi)].length;

      if (cursor > index && depth > 0 &&
        !(current.type === 'html' && /<summary\b/i.test(html))) {
        content.push(transformNode(current));
      }
      if (depth <= 0) {
        index = cursor;
        closed = true;
        break;
      }
    }

    if (!closed) {
      result.push(opening);
      continue;
    }

    result.push({
      type: 'markdownviewDetails',
      open: openTag !== null && /\sopen(?:\s|=|$)/i.test(openTag[1]),
      children: [
        { type: 'markdownviewDetailsSummary', children: [{ type: 'text', value: summary }] },
        ...convertDetails(content.map(convertAlert)),
      ],
    });
  }

  return result;
}

function transformNode(node: AstNode): AstNode {
  if (node.type === 'code' &&
    typeof node.lang === 'string' &&
    node.lang.trim().toLowerCase() === 'mermaid') {
    return {
      type: 'markdownviewMermaid',
      value: textValue(node),
    };
  }

  const children = getChildren(node);
  if (children) {
    node.children = convertDetails(children.map(transformNode).map(convertAlert));
  }
  return node;
}

const markdownAstPlugin: RemarkPlugin = {
  plugin: () => (tree) => {
    if (isAstNode(tree)) {
      transformNode(tree);
    }
  },
  options: {},
};

const markdownSyntaxPlugin: MilkdownPlugin = (ctx) => async () => {
  await ctx.wait(InitReady);
  ctx.update(remarkPluginsCtx, (plugins) => [markdownAstPlugin, ...plugins]);
  return () => ctx.update(remarkPluginsCtx, (plugins) =>
    plugins.filter((plugin) => plugin !== markdownAstPlugin),
  );
};

const definitionListPlugin = $remark('remarkDefinitionList', () => remarkDefinitionList);

const markdownviewAlertSchema = $nodeSchema('markdownview_alert', () => ({
  group: 'block',
  content: 'block*',
  defining: true,
  attrs: { kind: { default: 'note' } },
  parseDOM: [{
    tag: 'blockquote.markdownview-alert',
    getAttrs: (dom) => ({
      kind: (dom as HTMLElement).dataset.alertKind ?? 'note',
    }),
  }],
  toDOM: (node) => [
    'blockquote',
    {
      class: `markdownview-alert markdownview-alert-${node.attrs.kind}`,
      'data-alert-kind': node.attrs.kind,
    },
    0,
  ],
  parseMarkdown: {
    match: (node) => node.type === 'markdownviewAlert',
    runner: (state, node, type) => {
      state.openNode(type, { kind: node.kind });
      state.next(node.children);
      state.closeNode();
    },
  },
  toMarkdown: {
    match: (node) => node.type.name === 'markdownview_alert',
    runner: (state, node) => {
      state.openNode('blockquote');
      state.openNode('paragraph');
      state.addNode('text', undefined, `[!${String(node.attrs.kind).toUpperCase()}]`);
      state.closeNode();
      node.content.forEach((child) => state.next(child));
      state.closeNode();
    },
  },
}));

const markdownviewDetailsSummarySchema = $nodeSchema('markdownview_details_summary', () => ({
  content: 'inline*',
  defining: true,
  parseDOM: [{ tag: 'summary' }],
  toDOM: () => ['summary', 0],
  parseMarkdown: {
    match: (node) => node.type === 'markdownviewDetailsSummary',
    runner: (state, node, type) => {
      state.openNode(type);
      state.next(node.children);
      state.closeNode();
    },
  },
  toMarkdown: {
    match: (node) => node.type.name === 'markdownview_details_summary',
    runner: (state, node) => {
      state.next(node.content);
    },
  },
}));

const markdownviewDetailsSchema = $nodeSchema('markdownview_details', () => ({
  group: 'block',
  content: 'markdownview_details_summary block*',
  defining: true,
  isolating: true,
  attrs: { open: { default: false } },
  parseDOM: [{
    tag: 'details',
    getAttrs: (dom) => ({ open: (dom as HTMLDetailsElement).open }),
  }],
  toDOM: (node) => [
    'details',
    node.attrs.open ? { open: '' } : {},
    0,
  ],
  parseMarkdown: {
    match: (node) => node.type === 'markdownviewDetails',
    runner: (state, node, type) => {
      state.openNode(type, { open: node.open === true });
      state.next(node.children);
      state.closeNode();
    },
  },
  toMarkdown: {
    match: (node) => node.type.name === 'markdownview_details',
    runner: (state, node) => {
      const summaryText = node.child(0).textContent
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
      state.addNode(
        'html',
        undefined,
        `<details${node.attrs.open ? ' open' : ''}>\n<summary>${summaryText}</summary>`,
      );
      node.content.forEach((child, index) => {
        if (index > 0) {
          state.next(child);
        }
      });
      state.addNode('html', undefined, '</details>');
    },
  },
}));

const markdownviewDetailsView = $view(markdownviewDetailsSchema.node, () =>
  (node, view, getPos) => {
    let currentNode = node;
    const dom = document.createElement('details');
    dom.className = 'markdownview-details';
    dom.open = node.attrs.open;

    const handleToggle = (): void => {
      const position = getPos();
      if (typeof position !== 'number') {
        return;
      }
      window.requestAnimationFrame(() => {
        const latestNode = view.state.doc.nodeAt(position);
        if (latestNode?.type === currentNode.type && latestNode.attrs.open !== dom.open) {
          view.dispatch(view.state.tr.setNodeMarkup(position, undefined, {
            ...latestNode.attrs,
            open: dom.open,
          }));
        }
      });
    };
    dom.addEventListener('toggle', handleToggle);

    return {
      dom,
      contentDOM: dom,
      update(nextNode) {
        if (nextNode.type !== currentNode.type) {
          return false;
        }
        currentNode = nextNode;
        if (dom.open !== nextNode.attrs.open) {
          dom.open = nextNode.attrs.open;
        }
        return true;
      },
      destroy() {
        dom.removeEventListener('toggle', handleToggle);
      },
    };
  },
);

const definitionListSchema = $nodeSchema('definition_list', () => ({
  group: 'block',
  content: '(definition_term definition_description+)+',
  defining: true,
  parseDOM: [{ tag: 'dl' }],
  toDOM: () => ['dl', 0],
  parseMarkdown: {
    match: (node) => node.type === 'defList',
    runner: (state, node, type) => {
      state.openNode(type);
      state.next(node.children);
      state.closeNode();
    },
  },
  toMarkdown: {
    match: (node) => node.type.name === 'definition_list',
    runner: (state, node) => {
      state.openNode('defList');
      state.next(node.content);
      state.closeNode();
    },
  },
}));

const definitionTermSchema = $nodeSchema('definition_term', () => ({
  group: 'block',
  content: 'inline*',
  defining: true,
  parseDOM: [{ tag: 'dt' }],
  toDOM: () => ['dt', 0],
  parseMarkdown: {
    match: (node) => node.type === 'defListTerm',
    runner: (state, node, type) => {
      state.openNode(type);
      state.next(node.children);
      state.closeNode();
    },
  },
  toMarkdown: {
    match: (node) => node.type.name === 'definition_term',
    runner: (state, node) => {
      state.openNode('defListTerm');
      state.next(node.content);
      state.closeNode();
    },
  },
}));

const definitionDescriptionSchema = $nodeSchema('definition_description', () => ({
  group: 'block',
  content: 'block+',
  defining: true,
  parseDOM: [{ tag: 'dd' }],
  toDOM: () => ['dd', 0],
  parseMarkdown: {
    match: (node) => node.type === 'defListDescription',
    runner: (state, node, type) => {
      state.openNode(type);
      state.next(node.children);
      state.closeNode();
    },
  },
  toMarkdown: {
    match: (node) => node.type.name === 'definition_description',
    runner: (state, node) => {
      state.openNode('defListDescription');
      state.next(node.content);
      state.closeNode();
    },
  },
}));

export const markdownSyntaxPlugins = [
  markdownSyntaxPlugin,
  ...definitionListPlugin,
  ...markdownviewAlertSchema,
  ...markdownviewDetailsSummarySchema,
  ...markdownviewDetailsSchema,
  markdownviewDetailsView,
  ...definitionListSchema,
  ...definitionTermSchema,
  ...definitionDescriptionSchema,
  ...mermaidDiagramPlugins,
];
