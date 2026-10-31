export interface SafeMarkdownBlock {
  kind: 'heading' | 'paragraph' | 'fence';
  markdown: string;
}

export function splitSafeMarkdownBlocks(markdown: string): SafeMarkdownBlock[] | undefined {
  if (!markdown.trim()) {
    return [];
  }
  // Reference links depend on document-wide definitions and cannot be parsed independently.
  if (/^\s{0,3}\[[^\]]+\]:|!?\[[^\]]+\]\[[^\]]*\]/m.test(markdown)) {
    return undefined;
  }

  const lines = markdown.replace(/\r\n?/g, '\n').split('\n');
  const blocks: SafeMarkdownBlock[] = [];
  let current: string[] = [];
  let fence: { marker: string; length: number } | undefined;

  const pushBlock = (): boolean => {
    if (current.length === 0) {
      return true;
    }

    const text = current.join('\n').trim();
    current = [];
    if (!text) {
      return true;
    }

    const blockLines = text.split('\n');
    const openingFence = /^ {0,3}(`{3,}|~{3,})/.exec(blockLines[0]);
    if (openingFence) {
      const marker = openingFence[1][0] === '`' ? '`' : '~';
      const close = new RegExp(`^ {0,3}${marker === '`' ? '`' : '~'}{${openingFence[1].length},}[ \\t]*$`);
      if (blockLines.length < 2 || !close.test(blockLines[blockLines.length - 1])) {
        return false;
      }
      blocks.push({ kind: 'fence', markdown: text });
      return true;
    }

    if (/^ {0,3}#{1,6}\s+\S/.test(text)) {
      if (blockLines.length !== 1) {
        return false;
      }
      blocks.push({ kind: 'heading', markdown: text });
      return true;
    }

    const unsupportedBlock = /^ {0,3}(?:>|[-+*]\s|\d+[.)]\s|#{1,6}(?:\s|$)|`{3,}|~{3,}|\||<|:{1,2}\s|\\\[|\$\$|(?:---+|___+|\*\*\*+)\s*$)/;
    if (blockLines.some((line) =>
      unsupportedBlock.test(line) ||
      /^ {4,}\S/.test(line) ||
      /^ {0,3}(?:=+|-+)\s*$/.test(line),
    )) {
      return false;
    }

    blocks.push({ kind: 'paragraph', markdown: text });
    return true;
  };

  for (const line of lines) {
    if (fence) {
      current.push(line);
      const close = new RegExp(`^ {0,3}${fence.marker === '`' ? '`' : '~'}{${fence.length},}[ \\t]*$`);
      if (close.test(line)) {
        fence = undefined;
      }
      continue;
    }

    const openingFence = /^ {0,3}(`{3,}|~{3,})/.exec(line);
    if (openingFence && current.length === 0) {
      fence = { marker: openingFence[1][0], length: openingFence[1].length };
      current.push(line);
      continue;
    }

    if (/^[ \t]*$/.test(line)) {
      if (!pushBlock()) {
        return undefined;
      }
      continue;
    }
    current.push(line);
  }

  if (fence || !pushBlock()) {
    return undefined;
  }
  return blocks;
}
