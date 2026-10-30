export type ThemeKind = 'light' | 'dark';
export type EditorMode = 'readonly' | 'edit' | 'source';

export type HostMessage =
  | {
      type: 'update';
      markdown: string;
      images: Record<string, string>;
      theme: ThemeKind;
      fontSize: number;
      mode: EditorMode;
    }
  | {
      type: 'settings';
      theme: ThemeKind;
      fontSize: number;
    }
  | {
      type: 'mode';
      mode: EditorMode;
    }
  | {
      type: 'anchor';
      href: string;
    };

export type WebviewMessage =
  | {
      type: 'ready';
    }
  | {
      type: 'change';
      markdown: string;
    }
  | {
      type: 'setMode';
      mode: EditorMode;
    }
  | {
      type: 'openLink';
      href: string;
    };
