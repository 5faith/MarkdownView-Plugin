import { $nodeSchema, $view } from '@milkdown/kit/utils';
import type { ViewMutationRecord } from '@milkdown/kit/prose/view';
import type { EditorMode, ThemeKind } from '../shared/protocol';
import { translateUsecaseDiagram } from './usecase-diagram';

let diagramId = 0;
let mermaidTheme: ThemeKind = 'light';
let mermaidMode: EditorMode = 'readonly';
let mermaidLoad: Promise<typeof import('mermaid').default> | undefined;
let mermaidInitializedTheme: ThemeKind | undefined;
const mermaidModeListeners = new Set<(mode: EditorMode) => void>();

declare global {
  interface Window {
    MarkdownViewMermaid?: typeof import('mermaid').default;
  }
}

const DIAGRAM_CACHE_LIMIT = 60;
const DIAGRAM_VIEWPORT_MARGIN = 200;
const EDIT_RENDER_DEBOUNCE_MS = 800;
const EXTERNAL_RENDER_DEBOUNCE_MS = 250;

interface DiagramRenderRequest {
  source: string;
  theme: ThemeKind;
  cancelled: boolean;
  apply: (svg: string) => void;
  fail: (error: unknown) => void;
}

const diagramSvgCache = new Map<string, string>();
const diagramRenderQueue: DiagramRenderRequest[] = [];
let diagramRenderDraining = false;
const diagramVisibilityChecks = new Set<() => void>();
let diagramVisibilityPassScheduled = false;
let diagramScrollListenerInstalled = false;

function cacheDiagramSvg(cacheKey: string, svg: string): void {
  diagramSvgCache.delete(cacheKey);
  diagramSvgCache.set(cacheKey, svg);
  if (diagramSvgCache.size > DIAGRAM_CACHE_LIMIT) {
    const oldest = diagramSvgCache.keys().next();
    if (!oldest.done) {
      diagramSvgCache.delete(oldest.value);
    }
  }
}

function scheduleDiagramVisibilityPass(): void {
  if (diagramVisibilityPassScheduled) {
    return;
  }
  diagramVisibilityPassScheduled = true;
  window.requestAnimationFrame(() => {
    diagramVisibilityPassScheduled = false;
    for (const check of [...diagramVisibilityChecks]) {
      check();
    }
  });
}

function ensureDiagramScrollListener(): void {
  if (diagramScrollListenerInstalled) {
    return;
  }
  diagramScrollListenerInstalled = true;
  document.addEventListener('scroll', scheduleDiagramVisibilityPass, { passive: true, capture: true });
  window.addEventListener('resize', scheduleDiagramVisibilityPass, { passive: true });
}

function drainDiagramRenders(): void {
  if (diagramRenderDraining) {
    return;
  }
  diagramRenderDraining = true;
  const step = (): void => {
    const request = diagramRenderQueue.shift();
    if (!request) {
      diagramRenderDraining = false;
      return;
    }
    if (request.cancelled) {
      window.requestAnimationFrame(step);
      return;
    }
    const cacheKey = `${request.theme}:${request.source}`;
    const cached = diagramSvgCache.get(cacheKey);
    if (cached !== undefined) {
      cacheDiagramSvg(cacheKey, cached);
      request.apply(cached);
      window.requestAnimationFrame(step);
      return;
    }
    const renderStartedAt = performance.now();
    void loadMermaid().then((mermaid) => {
      if (mermaidInitializedTheme !== request.theme) {
        mermaid.initialize({
          startOnLoad: false,
          securityLevel: 'strict',
          theme: request.theme === 'dark' ? 'dark' : 'default',
          flowchart: { htmlLabels: false },
        });
        mermaidInitializedTheme = request.theme;
      }
      return mermaid.render(
        `markdownview-diagram-${++diagramId}`,
        translateUsecaseDiagram(request.source) ?? request.source,
      );
    }).then(({ svg }) => {
      cacheDiagramSvg(cacheKey, svg);
      if (!request.cancelled) {
        console.debug(
          `[MarkdownView] Mermaid rendered: ${request.source.length} chars, ` +
          `${(performance.now() - renderStartedAt).toFixed(1)} ms`,
        );
        request.apply(svg);
      }
    }).catch((error: unknown) => {
      if (!request.cancelled) {
        request.fail(error);
      }
    }).finally(() => {
      window.requestAnimationFrame(step);
    });
  };
  window.requestAnimationFrame(step);
}

function enqueueDiagramRender(
  source: string,
  apply: (svg: string) => void,
  fail: (error: unknown) => void,
): { cancel(): void } {
  const cacheKey = `${mermaidTheme}:${source}`;
  const cached = diagramSvgCache.get(cacheKey);
  if (cached !== undefined) {
    cacheDiagramSvg(cacheKey, cached);
    apply(cached);
    return { cancel(): void {} };
  }
  const request: DiagramRenderRequest = { source, theme: mermaidTheme, cancelled: false, apply, fail };
  diagramRenderQueue.push(request);
  drainDiagramRenders();
  return {
    cancel(): void {
      request.cancelled = true;
    },
  };
}

function loadMermaid(): Promise<typeof import('mermaid').default> {
  if (window.MarkdownViewMermaid) {
    return Promise.resolve(window.MarkdownViewMermaid);
  }
  if (mermaidLoad) {
    return mermaidLoad;
  }

  mermaidLoad = new Promise((resolve, reject) => {
    const mermaidUri = document.querySelector<HTMLElement>('#editor')?.dataset.mermaidUri;
    if (!mermaidUri) {
      reject(new Error('The Mermaid runtime URI was not provided by the extension host.'));
      return;
    }

    const script = document.createElement('script');
    script.src = mermaidUri;
    script.nonce = document.querySelector<HTMLScriptElement>('script[nonce]')?.nonce ?? '';
    script.onload = () => {
      if (window.MarkdownViewMermaid) {
        resolve(window.MarkdownViewMermaid);
      } else {
        reject(new Error('The Mermaid runtime loaded without registering its API.'));
      }
    };
    script.onerror = () => reject(new Error('The Mermaid runtime script could not be loaded.'));
    document.head.append(script);
  });
  return mermaidLoad;
}

const mermaidDiagramSchema = $nodeSchema('mermaid_diagram', () => ({
  group: 'block',
  content: 'text*',
  code: true,
  defining: true,
  isolating: true,
  parseDOM: [{ tag: 'pre[data-mermaid]' }],
  toDOM: () => ['pre', { 'data-mermaid': 'true' }, ['code', 0]],
  parseMarkdown: {
    match: (node) => node.type === 'markdownviewMermaid',
    runner: (state, node, type) => {
      state.openNode(type);
      state.addText(typeof node.value === 'string' ? node.value : '');
      state.closeNode();
    },
  },
  toMarkdown: {
    match: (node) => node.type.name === 'mermaid_diagram',
    runner: (state, node) => {
      state.addNode('code', undefined, node.textContent, { lang: 'mermaid' });
    },
  },
}));

const mermaidDiagramView = $view(mermaidDiagramSchema.node, () => (node) => {
  let currentNode = node;
  let currentSource = node.textContent.trim();
  let currentMode = mermaidMode;
  let sourceOpen = false;
  let hasRenderedPreview = false;
  let needsRender = currentSource.length > 0;
  let renderTimer: number | undefined;
  let renderRequest: { cancel(): void } | undefined;
  let destroyed = false;

  const dom = document.createElement('section');
  dom.className = 'mermaid-diagram';
  dom.dataset.mode = currentMode;

  const placeholder = document.createElement('p');
  placeholder.className = 'markdownview-mermaid-deferred';
  placeholder.textContent = '图表将在滚动到可视区域后渲染。';

  const preview = document.createElement('div');
  preview.className = 'mermaid-diagram-preview';

  const errorStrip = document.createElement('p');
  errorStrip.className = 'mermaid-diagram-error-strip';
  errorStrip.hidden = true;

  const sourceWrap = document.createElement('div');
  sourceWrap.className = 'mermaid-diagram-source';
  sourceWrap.dataset.collapsed = 'true';
  const sourceToggle = document.createElement('button');
  sourceToggle.type = 'button';
  sourceToggle.className = 'mermaid-diagram-source-toggle';
  const sourceMarker = document.createElement('span');
  sourceMarker.className = 'mermaid-diagram-source-marker';
  const sourceLabel = document.createElement('span');
  sourceLabel.textContent = 'Mermaid 源码';
  sourceToggle.append(sourceMarker, sourceLabel);
  const sourceBody = document.createElement('div');
  sourceBody.className = 'mermaid-diagram-source-body';
  const pre = document.createElement('pre');
  const contentDOM = document.createElement('code');
  contentDOM.className = 'language-mermaid';
  pre.append(contentDOM);
  sourceBody.append(pre);
  sourceWrap.append(sourceToggle, sourceBody);

  preview.append(placeholder);
  dom.append(preview, errorStrip, sourceWrap);

  const previewVisible = (): boolean => currentMode === 'edit' || !sourceOpen;

  const syncPanel = (): void => {
    sourceWrap.dataset.collapsed = String(!sourceOpen);
    sourceMarker.textContent = sourceOpen ? '▾' : '▸';
    preview.hidden = !previewVisible();
  };

  const setSourceOpen = (open: boolean): void => {
    if (sourceOpen === open) {
      return;
    }
    sourceOpen = open;
    syncPanel();
  };

  const setRenderError = (error: unknown): void => {
    const message = error instanceof Error ? error.message : String(error);
    if (/no diagram type detected/i.test(message)) {
      errorStrip.textContent = '当前 Mermaid 版本不支持该图表类型。';
    } else if (hasRenderedPreview) {
      errorStrip.textContent = '图表源码语法有误，已保留上一次渲染结果，请修改后自动更新。';
    } else {
      errorStrip.textContent = '图表源码语法有误，请检查图表源码。';
      placeholder.textContent = '无法渲染图表预览。';
    }
    errorStrip.title = message.split('\n')[0];
    errorStrip.hidden = false;
  };

  const requestRender = (): void => {
    window.clearTimeout(renderTimer);
    renderTimer = undefined;
    needsRender = false;
    if (!currentSource) {
      hasRenderedPreview = false;
      errorStrip.hidden = true;
      placeholder.textContent = '暂无图表源码。';
      preview.replaceChildren(placeholder);
      return;
    }
    renderRequest = enqueueDiagramRender(
      currentSource,
      (svg) => {
        renderRequest = undefined;
        preview.innerHTML = svg;
        hasRenderedPreview = true;
        errorStrip.hidden = true;
      },
      (error) => {
        renderRequest = undefined;
        setRenderError(error);
      },
    );
  };

  const isNearViewport = (): boolean => {
    const rect = dom.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) {
      return false;
    }
    return rect.bottom >= -DIAGRAM_VIEWPORT_MARGIN &&
      rect.top <= window.innerHeight + DIAGRAM_VIEWPORT_MARGIN;
  };

  const checkVisibility = (): void => {
    if (destroyed || !needsRender || renderRequest) {
      return;
    }
    if (isNearViewport()) {
      requestRender();
    }
  };

  const renderDelay = (): number =>
    currentMode === 'edit' && sourceOpen ? EDIT_RENDER_DEBOUNCE_MS : EXTERNAL_RENDER_DEBOUNCE_MS;

  const scheduleRender = (): void => {
    window.clearTimeout(renderTimer);
    renderTimer = window.setTimeout(() => {
      renderTimer = undefined;
      scheduleDiagramVisibilityPass();
    }, renderDelay());
  };

  const updateMode = (nextMode: EditorMode): void => {
    if (destroyed || nextMode === currentMode) {
      return;
    }
    currentMode = nextMode;
    dom.dataset.mode = nextMode;
    if (nextMode === 'edit' && !currentSource) {
      setSourceOpen(true);
    }
    preview.hidden = !previewVisible();
    if (needsRender && !renderRequest) {
      scheduleDiagramVisibilityPass();
    }
  };

  const removeModeListener = (): void => {
    mermaidModeListeners.delete(updateMode);
  };
  mermaidModeListeners.add(updateMode);

  const showRenderedPreview = (): void => {
    if ((needsRender || !hasRenderedPreview) && !renderRequest) {
      requestRender();
    }
  };

  sourceToggle.addEventListener('click', () => {
    setSourceOpen(!sourceOpen);
    if (currentMode === 'readonly' && !sourceOpen) {
      showRenderedPreview();
    }
  });

  ensureDiagramScrollListener();
  diagramVisibilityChecks.add(checkVisibility);
  syncPanel();
  if (currentSource) {
    scheduleDiagramVisibilityPass();
    window.setTimeout(scheduleDiagramVisibilityPass, 250);
  } else {
    placeholder.textContent = '暂无图表源码。';
    if (currentMode === 'edit') {
      setSourceOpen(true);
    }
  }

  return {
    dom,
    contentDOM,
    stopEvent(event: Event): boolean {
      const target = event.target;
      return target instanceof Element && sourceToggle.contains(target);
    },
    ignoreMutation(mutation: ViewMutationRecord): boolean {
      const target = mutation.target;
      return target !== contentDOM && !contentDOM.contains(target);
    },
    update(nextNode) {
      if (nextNode.type !== currentNode.type) {
        return false;
      }
      currentNode = nextNode;
      const nextSource = nextNode.textContent.trim();
      if (nextSource === currentSource) {
        return true;
      }
      currentSource = nextSource;
      renderRequest?.cancel();
      renderRequest = undefined;
      window.clearTimeout(renderTimer);
      renderTimer = undefined;
      if (!currentSource) {
        needsRender = false;
        hasRenderedPreview = false;
        errorStrip.hidden = true;
        placeholder.textContent = '暂无图表源码。';
        preview.replaceChildren(placeholder);
        if (currentMode === 'edit') {
          setSourceOpen(true);
        }
        return true;
      }
      needsRender = true;
      scheduleRender();
      return true;
    },
    destroy() {
      destroyed = true;
      window.clearTimeout(renderTimer);
      renderRequest?.cancel();
      diagramVisibilityChecks.delete(checkVisibility);
      removeModeListener();
    },
  };
});

export const mermaidDiagramPlugins = [
  ...mermaidDiagramSchema,
  mermaidDiagramView,
];

export function configureMermaid(theme: ThemeKind, mode: EditorMode): void {
  if (mermaidTheme !== theme) {
    mermaidInitializedTheme = undefined;
  }
  mermaidTheme = theme;
  if (mermaidMode !== mode) {
    mermaidMode = mode;
    mermaidModeListeners.forEach((listener) => listener(mode));
  }
}
