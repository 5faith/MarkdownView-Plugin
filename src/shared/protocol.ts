export type ThemeKind = 'light' | 'dark';

export type HostMessage =
  | {
      type: 'update';
      markdown: string;
      images: Record<string, string>;
      theme: ThemeKind;
      fontSize: number;
      editable: boolean;
    }
  | {
      type: 'settings';
      theme: ThemeKind;
      fontSize: number;
    }
  | {
      type: 'mode';
      editable: boolean;
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
      editable: boolean;
    }
  | {
      type: 'openLink';
      href: string;
    };
