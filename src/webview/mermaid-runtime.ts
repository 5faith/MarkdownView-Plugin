import mermaid from 'mermaid';

declare global {
  interface Window {
    MarkdownViewMermaid?: typeof mermaid;
  }
}

window.MarkdownViewMermaid = mermaid;
