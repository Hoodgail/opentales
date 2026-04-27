<script lang="ts">
  import { onDestroy } from 'svelte';
  import { browser } from '$app/environment';

  type Monaco = typeof import('monaco-editor');
  type DiffEditor = import('monaco-editor').editor.IStandaloneDiffEditor;

  interface Selection {
    side: 'base' | 'head';
    lineStart: number;
    lineEnd: number;
  }

  interface Props {
    original: string;
    modified: string;
    language?: string;
    onSelectionChange?: (selection: Selection | null) => void;
  }

  let { original, modified, language = 'markdown', onSelectionChange }: Props = $props();

  let container: HTMLDivElement | undefined = $state();
  let editor: DiffEditor | null = null;
  let monaco: Monaco | null = null;

  $effect(() => {
    if (!browser || !container) return;
    let cancelled = false;

    (async () => {
      if (!self.MonacoEnvironment) {
        const editorWorker = (
          await import('monaco-editor/esm/vs/editor/editor.worker?worker')
        ).default;
        self.MonacoEnvironment = {
          getWorker(_workerId: string, _label: string) {
            return new editorWorker();
          }
        };
      }

      const m = (await import('monaco-editor/esm/vs/editor/editor.api')) as Monaco;
      if (cancelled) return;
      monaco = m;

      // Reuse the manuscript-dark theme already registered by the markdown editor —
      // but in case this loads first, register a minimal version here.
      try {
        m.editor.defineTheme('manuscript-dark', {
          base: 'vs-dark',
          inherit: true,
          rules: [],
          colors: {
            'editor.background': '#1a1a1a',
            'diffEditor.insertedTextBackground': '#3b6e3b40',
            'diffEditor.removedTextBackground': '#7a3a3a40'
          }
        });
      } catch {
        // already defined — fine
      }

      editor = m.editor.createDiffEditor(container!, {
        theme: 'manuscript-dark',
        readOnly: true,
        renderSideBySide: true,
        automaticLayout: true,
        fontSize: 14,
        lineHeight: 1.7,
        wordWrap: 'on',
        scrollBeyondLastLine: false,
        minimap: { enabled: false }
      });

      editor.setModel({
        original: m.editor.createModel(original, language),
        modified: m.editor.createModel(modified, language)
      });

      if (onSelectionChange) {
        const wireSelection = (
          ed: import('monaco-editor').editor.ICodeEditor,
          side: 'base' | 'head'
        ) => {
          ed.onDidChangeCursorSelection((e) => {
            const sel = e.selection;
            if (!sel || sel.startLineNumber === sel.endLineNumber) {
              // Clear unless the OTHER side has an active multi-line selection.
              const other =
                side === 'base'
                  ? editor?.getModifiedEditor().getSelection()
                  : editor?.getOriginalEditor().getSelection();
              if (!other || other.startLineNumber === other.endLineNumber) {
                onSelectionChange?.(null);
              }
              return;
            }
            onSelectionChange?.({
              side,
              lineStart: sel.startLineNumber,
              lineEnd: sel.endLineNumber
            });
          });
        };
        wireSelection(editor.getOriginalEditor(), 'base');
        wireSelection(editor.getModifiedEditor(), 'head');
      }
    })();

    return () => {
      cancelled = true;
    };
  });

  $effect(() => {
    if (!editor || !monaco) return;
    const model = editor.getModel();
    if (!model) return;
    if (model.original.getValue() !== original) model.original.setValue(original);
    if (model.modified.getValue() !== modified) model.modified.setValue(modified);
  });

  onDestroy(() => {
    const model = editor?.getModel();
    if (model) {
      model.original.dispose();
      model.modified.dispose();
    }
    editor?.dispose();
    editor = null;
  });
</script>

<div bind:this={container} class="size-full"></div>
