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

type AlertKind = 'note' | 'tip' | 'important' | 'warning' | 'caution';

const ALERT_TITLES: Record<AlertKind, string> = {
  note: 'Note',
  tip: 'Tip',
  important: 'Important',
  warning: 'Warning',
  caution: 'Caution',
};

const SVG_NS = 'http://www.w3.org/2000/svg';

/** 图标用线条绘制，深浅主题都吃 currentColor（移植自桌面版 MarkdownView） */
const ALERT_ICONS: Record<AlertKind, Array<[string, Record<string, string>]>> = {
  note: [
    ['circle', { cx: '8', cy: '8', r: '6.2' }],
    ['path', { d: 'M8 7.2v4M8 4.8v.02' }],
  ],
  tip: [
    ['path', { d: 'M6.1 11.2c-.5-.9-1.6-1.8-1.6-3.6a3.5 3.5 0 017 0c0 1.8-1.1 2.7-1.6 3.6z' }],
    ['path', { d: 'M6.2 13.2h3.6' }],
  ],
  important: [
    ['rect', { x: '1.9', y: '2.4', width: '12.2', height: '11.2', rx: '2.4' }],
    ['path', { d: 'M8 5.4v3.4M8 11.3v.02' }],
  ],
  warning: [
    ['path', { d: 'M8 2.3 14.5 13.5H1.5z' }],
    ['path', { d: 'M8 6.4v3M8 11.6v.02' }],
  ],
  caution: [
    ['path', { d: 'M5.3 2h5.4L14 5.3v5.4L10.7 14H5.3L2 10.7V5.3z' }],
    ['path', { d: 'M8 5.4v3.4M8 11.3v.02' }],
  ],
};

/** 必须用 createElementNS 建 SVG，ProseMirror 的 createElement 只会生成 HTML 未知元素 */
function alertIcon(kind: AlertKind): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 16 16');
  svg.setAttribute('width', '16');
  svg.setAttribute('height', '16');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '1.4');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.setAttribute('aria-hidden', 'true');
  for (const [tag, attrs] of ALERT_ICONS[kind]) {
    const el = document.createElementNS(SVG_NS, tag);
    for (const [key, value] of Object.entries(attrs)) {
      el.setAttribute(key, value);
    }
    svg.appendChild(el);
  }
  return svg;
}

const markdownviewAlertSchema = $nodeSchema('markdownview_alert', () => ({
  group: 'block',
  content: 'block*',
  defining: true,
  attrs: { kind: { default: 'note' } },
  toDOM: (node) => {
    const kind = node.attrs.kind as AlertKind;
    const known = kind in ALERT_TITLES ? kind : 'note';
    return [
      'blockquote',
      {
        class: `markdownview-alert markdownview-alert-${known}`,
        'data-alert-kind': known,
      },
      ['p', { class: 'markdownview-alert-title' }, alertIcon(known), ['span', {}, ALERT_TITLES[known]]],
      ['div', { class: 'markdownview-alert-body' }, 0],
    ];
  },
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
        if (!latestNode || latestNode.type.name !== 'markdownview_details') {
          return;
        }
        if (latestNode.attrs.open === dom.open) {
          return;
        }
        view.dispatch(view.state.tr.setNodeMarkup(position, undefined, {
          ...latestNode.attrs,
          open: dom.open,
        }));
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
      // 点击 <summary> 翻转的 open 属性由上面的 toggle 处理器写回节点 attr，
      // 不能让 ProseMirror 的 DOMObserver 把它当成内容变化重新解析，
      // 否则展开/收起会被再次翻转（桌面版已验证的防护）。
      ignoreMutation(mutation) {
        return mutation.type === 'attributes' && mutation.attributeName === 'open';
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
