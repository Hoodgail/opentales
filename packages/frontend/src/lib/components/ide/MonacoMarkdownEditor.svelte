<script lang="ts">
  import { onDestroy, onMount } from 'svelte';
  import { browser } from '$app/environment';
  import { preferences } from '$lib/stores/preferences.svelte';
  import { editorTheme, editorThemes, type EditorThemeId } from '$lib/stores/editorTheme.svelte';
  import { viewport } from '$lib/stores/viewport.svelte';

  type Monaco = typeof import('monaco-editor');
  type Editor = import('monaco-editor').editor.IStandaloneCodeEditor;

  interface Props {
    value: string;
    onChange: (next: string) => void;
    onSelectionChange?: (selectedText: string) => void;
    language?: string;
    compact?: boolean;
  }

  let { value, onChange, onSelectionChange, language = 'markdown', compact = false }: Props = $props();

  function monacoThemeFor(id: EditorThemeId): string {
    return editorThemes.find((t) => t.id === id)?.monacoTheme ?? 'manuscript-dark';
  }

  function registerThemes(m: Monaco) {
    m.editor.defineTheme('manuscript-dark', {
      base: 'vs-dark',
      inherit: true,
      rules: [
        { token: '', foreground: 'ededed', background: '1a1a1a' },
        { token: 'comment', foreground: '9c9c9c', fontStyle: 'italic' },
        { token: 'keyword', foreground: 'e3b878' },
        { token: 'string', foreground: 'c4b896' },
        { token: 'number', foreground: 'd4a574' },
        { token: 'keyword.md', foreground: 'e3b878', fontStyle: 'bold' },
        { token: 'string.link.md', foreground: 'e3b878' },
        { token: 'string.target.md', foreground: '9c9c9c' },
        { token: 'variable.md', foreground: 'ededed' },
        { token: 'tag.md', foreground: 'e3b878' },
        { token: 'emphasis', fontStyle: 'italic', foreground: 'd4d4d4' },
        { token: 'strong', fontStyle: 'bold', foreground: 'ffffff' }
      ],
      colors: {
        'editor.background': '#1a1a1a',
        'editor.foreground': '#ededed',
        'editor.lineHighlightBackground': '#222222',
        'editor.lineHighlightBorder': '#222222',
        'editorLineNumber.foreground': '#4a4a4a',
        'editorLineNumber.activeForeground': '#9c9c9c',
        'editorCursor.foreground': '#e3b878',
        'editor.selectionBackground': '#3a3a3a',
        'editor.inactiveSelectionBackground': '#2a2a2a',
        'editorIndentGuide.background1': '#262626',
        'editorIndentGuide.activeBackground1': '#3a3a3a',
        'editorWhitespace.foreground': '#2a2a2a',
        'scrollbarSlider.background': '#33333366',
        'scrollbarSlider.hoverBackground': '#4a4a4a99',
        'scrollbarSlider.activeBackground': '#5a5a5acc',
        'editorWidget.background': '#222222',
        'editorWidget.border': '#333333',
        'editorSuggestWidget.background': '#222222',
        'editorGutter.background': '#1a1a1a'
      }
    });

    m.editor.defineTheme('manuscript-parchment', {
      base: 'vs',
      inherit: true,
      rules: [
        { token: '', foreground: '3a2e1a', background: 'f4ead4' },
        { token: 'comment', foreground: '8a7050', fontStyle: 'italic' },
        { token: 'keyword.md', foreground: '8a4b1f', fontStyle: 'bold' },
        { token: 'string.link.md', foreground: '8a4b1f' },
        { token: 'emphasis', fontStyle: 'italic', foreground: '5a4730' },
        { token: 'strong', fontStyle: 'bold', foreground: '2a1f0a' }
      ],
      colors: {
        'editor.background': '#f4ead4',
        'editor.foreground': '#3a2e1a',
        'editor.lineHighlightBackground': '#ecdfbf',
        'editor.lineHighlightBorder': '#ecdfbf',
        'editorLineNumber.foreground': '#a89568',
        'editorLineNumber.activeForeground': '#5a4730',
        'editorCursor.foreground': '#8a4b1f',
        'editor.selectionBackground': '#e0c98a',
        'editor.inactiveSelectionBackground': '#ead9aa',
        'editorGutter.background': '#f4ead4'
      }
    });

    m.editor.defineTheme('manuscript-graphite', {
      base: 'vs-dark',
      inherit: true,
      rules: [
        { token: '', foreground: 'cfd3d8', background: '1f2225' },
        { token: 'comment', foreground: '7d848d', fontStyle: 'italic' },
        { token: 'keyword.md', foreground: 'a6c0d0', fontStyle: 'bold' },
        { token: 'string.link.md', foreground: 'a6c0d0' },
        { token: 'emphasis', fontStyle: 'italic', foreground: 'b8bfc7' },
        { token: 'strong', fontStyle: 'bold', foreground: 'ffffff' }
      ],
      colors: {
        'editor.background': '#1f2225',
        'editor.foreground': '#cfd3d8',
        'editor.lineHighlightBackground': '#262a2e',
        'editor.lineHighlightBorder': '#262a2e',
        'editorLineNumber.foreground': '#525a63',
        'editorLineNumber.activeForeground': '#a4adb6',
        'editorCursor.foreground': '#a6c0d0',
        'editor.selectionBackground': '#3a414a',
        'editorGutter.background': '#1f2225'
      }
    });

    m.editor.defineTheme('manuscript-midnight', {
      base: 'vs-dark',
      inherit: true,
      rules: [
        { token: '', foreground: 'cfd6ff', background: '0d1226' },
        { token: 'comment', foreground: '6a72a0', fontStyle: 'italic' },
        { token: 'keyword.md', foreground: 'b6c5ff', fontStyle: 'bold' },
        { token: 'string.link.md', foreground: '8aa3ff' },
        { token: 'emphasis', fontStyle: 'italic', foreground: 'b8c0e6' },
        { token: 'strong', fontStyle: 'bold', foreground: 'ffffff' }
      ],
      colors: {
        'editor.background': '#0d1226',
        'editor.foreground': '#cfd6ff',
        'editor.lineHighlightBackground': '#161c38',
        'editor.lineHighlightBorder': '#161c38',
        'editorLineNumber.foreground': '#3a4170',
        'editorLineNumber.activeForeground': '#8a9bd0',
        'editorCursor.foreground': '#b6c5ff',
        'editor.selectionBackground': '#2a3565',
        'editorGutter.background': '#0d1226'
      }
    });
  }

  let container: HTMLDivElement | undefined = $state();
  let editor = $state<Editor | null>(null);
  let monaco = $state<Monaco | null>(null);
  let disposing = false;
  let suppressNext = false;
  let focusDecorations: import('monaco-editor').editor.IEditorDecorationsCollection | null = null;

  onMount(() => {
    if (!browser) return;
    let cancelled = false;
    const initialValue = value;
    const initialLanguage = language;

    (async () => {
      // Workers — Monaco needs a getWorker function. We point it at the
      // generic editor worker which handles markdown well enough; richer
      // language support can be wired in later.
      if (!self.MonacoEnvironment) {
        const editorWorker = (
          await import('monaco-editor/esm/vs/editor/editor.worker?worker')
        ).default;
        // Using `any` cast keeps the signature loose across worker types.
        self.MonacoEnvironment = {
          getWorker(_workerId: string, _label: string) {
            return new editorWorker();
          }
        };
      }

      const m = (await import('monaco-editor/esm/vs/editor/editor.api')) as Monaco;
      if (cancelled) return;
      monaco = m;

      registerThemes(m);

      if (!container) return;

      editor = m.editor.create(container, {
        value: initialValue,
        language: initialLanguage,
        theme: monacoThemeFor(editorTheme.current),
        fontFamily: 'var(--font-mono), ui-monospace, SFMono-Regular, monospace',
        fontSize: compact ? 13 : viewport.mobile ? 16 : 14,
        lineHeight: compact ? 1.55 : 1.7,
        letterSpacing: 0,
        wordWrap: 'on',
        wrappingStrategy: 'advanced',
        wrappingIndent: 'same',
        minimap: {
          enabled: !compact && preferences.showMinimap && !viewport.mobile,
          renderCharacters: false,
          maxColumn: 80,
          scale: 1
        },
        scrollBeyondLastLine: !compact,
        scrollbar: {
          verticalScrollbarSize: viewport.mobile ? 6 : 10,
          horizontalScrollbarSize: viewport.mobile ? 6 : 10
        },
        renderLineHighlight: 'line',
        renderWhitespace: 'none',
        padding: compact
          ? { top: 10, bottom: 10 }
          : { top: viewport.mobile ? 20 : 24, bottom: viewport.mobile ? 120 : 80 },
        smoothScrolling: true,
        cursorBlinking: 'smooth',
        cursorSmoothCaretAnimation: 'on',
        cursorWidth: 2,
        guides: { indentation: false, bracketPairs: false },
        folding: true,
        glyphMargin: false,
        lineNumbers: compact || viewport.mobile ? 'off' : 'on',
        lineNumbersMinChars: compact || viewport.mobile ? 0 : 3,
        lineDecorationsWidth: compact || viewport.mobile ? 0 : 8,
        contextmenu: true,
        quickSuggestions: false,
        suggestOnTriggerCharacters: false,
        fontLigatures: true,
        bracketPairColorization: { enabled: false },
        automaticLayout: true,
        cursorSurroundingLines: preferences.typewriterMode ? 999 : 0,
        cursorSurroundingLinesStyle: 'all'
      });

      focusDecorations = editor.createDecorationsCollection([]);

      editor.onDidChangeModelContent(() => {
        if (suppressNext) {
          suppressNext = false;
          return;
        }
        if (!editor || disposing) return;
        onChange(editor.getValue());
        updateFocusDecorations();
      });

      editor.onDidChangeCursorPosition(() => updateFocusDecorations());

      // Track text selection changes and report to parent
      editor.onDidChangeCursorSelection(() => {
        if (!editor || !onSelectionChange) return;
        const selection = editor.getSelection();
        if (!selection || selection.isEmpty()) {
          onSelectionChange('');
          return;
        }
        const model = editor.getModel();
        if (!model) return;
        onSelectionChange(model.getValueInRange(selection));
      });

      updateFocusDecorations();
    })();

    return () => {
      cancelled = true;
    };
  });

  // Sync external value changes (e.g. switching chapters) into the editor.
  $effect(() => {
    if (!editor) return;
    if (editor.getValue() === value) return;
    suppressNext = true;
    editor.setValue(value);
    updateFocusDecorations();
  });

  // Apply preferences live as the user toggles them.
  $effect(() => {
    if (!editor) return;
    editor.updateOptions({
      fontSize: compact ? 13 : viewport.mobile ? 16 : 14,
      lineNumbers: compact || viewport.mobile ? 'off' : 'on',
      lineNumbersMinChars: compact || viewport.mobile ? 0 : 3,
      lineDecorationsWidth: compact || viewport.mobile ? 0 : 8,
      minimap: {
        enabled: !compact && preferences.showMinimap && !viewport.mobile,
        renderCharacters: false,
        maxColumn: 80,
        scale: 1
      },
      scrollbar: {
        verticalScrollbarSize: viewport.mobile ? 6 : 10,
        horizontalScrollbarSize: viewport.mobile ? 6 : 10
      },
      padding: compact
        ? { top: 10, bottom: 10 }
        : { top: viewport.mobile ? 20 : 24, bottom: viewport.mobile ? 120 : 80 },
      cursorSurroundingLines: preferences.typewriterMode ? 999 : 0
    });
    updateFocusDecorations();
  });

  function updateFocusDecorations() {
    if (!editor || !monaco || !focusDecorations) return;
    if (!preferences.focusMode) {
      focusDecorations.set([]);
      return;
    }
    const model = editor.getModel();
    const position = editor.getPosition();
    if (!model || !position) {
      focusDecorations.set([]);
      return;
    }

    // Walk outward from the cursor until we hit blank lines on both sides;
    // the slab between counts as the "current paragraph" and stays bright.
    const lineCount = model.getLineCount();
    let top = position.lineNumber;
    while (top > 1 && model.getLineContent(top - 1).trim() !== '') top--;
    let bottom = position.lineNumber;
    while (bottom < lineCount && model.getLineContent(bottom + 1).trim() !== '') bottom++;

    const decorations: import('monaco-editor').editor.IModelDeltaDecoration[] = [];
    if (top > 1) {
      decorations.push({
        range: new monaco.Range(1, 1, top - 1, model.getLineMaxColumn(top - 1)),
        options: { inlineClassName: 'opentales-dim' }
      });
    }
    if (bottom < lineCount) {
      decorations.push({
        range: new monaco.Range(bottom + 1, 1, lineCount, model.getLineMaxColumn(lineCount)),
        options: { inlineClassName: 'opentales-dim' }
      });
    }
    focusDecorations.set(decorations);
  }

  // Reactively switch Monaco's theme when the user picks a new one.
  $effect(() => {
    const themeId = editorTheme.current;
    if (!monaco || !editor) return;
    monaco.editor.setTheme(monacoThemeFor(themeId));
  });

  onDestroy(() => {
    disposing = true;
    editor?.dispose();
    editor = null;
  });
</script>

<div bind:this={container} class="h-full w-full"></div>

<style>
  :global(.opentales-dim) {
    opacity: 0.35;
    transition: opacity 120ms ease-out;
  }
</style>
