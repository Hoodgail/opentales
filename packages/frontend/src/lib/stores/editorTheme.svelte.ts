import { browser } from '$app/environment';

export type EditorThemeId = 'amber' | 'parchment' | 'graphite' | 'midnight';

export interface EditorThemeDef {
  id: EditorThemeId;
  label: string;
  description: string;
  monacoTheme: string;
  background: string;
  foreground: string;
}

// Each theme registers a Monaco theme name; the actual definition is
// installed lazily by MonacoMarkdownEditor on first use.
export const editorThemes: EditorThemeDef[] = [
  {
    id: 'amber',
    label: 'Amber (default)',
    description: 'Warm dark theme — the OpenTales house style.',
    monacoTheme: 'manuscript-dark',
    background: '#1a1a1a',
    foreground: '#d6c9a3'
  },
  {
    id: 'parchment',
    label: 'Parchment',
    description: 'Sepia-on-cream — easy on the eyes for long sessions.',
    monacoTheme: 'manuscript-parchment',
    background: '#f4ead4',
    foreground: '#3a2e1a'
  },
  {
    id: 'graphite',
    label: 'Graphite',
    description: 'Cool, muted greys — quietly professional.',
    monacoTheme: 'manuscript-graphite',
    background: '#1f2225',
    foreground: '#cfd3d8'
  },
  {
    id: 'midnight',
    label: 'Midnight',
    description: 'Deep blues with high contrast — for the night shift.',
    monacoTheme: 'manuscript-midnight',
    background: '#0d1226',
    foreground: '#cfd6ff'
  }
];

const STORAGE_KEY = 'opentales.editorTheme.v1';

function isThemeId(value: unknown): value is EditorThemeId {
  return (
    value === 'amber' ||
    value === 'parchment' ||
    value === 'graphite' ||
    value === 'midnight'
  );
}

function loadStored(): EditorThemeId {
  if (!browser) return 'amber';
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw && isThemeId(raw)) return raw;
  } catch {
    /* ignore */
  }
  return 'amber';
}

function createEditorThemeStore() {
  let current = $state<EditorThemeId>(loadStored());

  function persist(value: EditorThemeId) {
    if (!browser) return;
    try {
      window.localStorage.setItem(STORAGE_KEY, value);
    } catch {
      /* ignore */
    }
  }

  function setTheme(value: EditorThemeId) {
    current = value;
    persist(value);
  }

  return {
    get current() {
      return current;
    },
    get themes() {
      return editorThemes;
    },
    setTheme
  };
}

export const editorTheme = createEditorThemeStore();
