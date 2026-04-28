<script lang="ts">
  import { onDestroy } from 'svelte';
  import { browser } from '$app/environment';
  import { editorTheme, editorThemes, type EditorThemeId } from '$lib/stores/editorTheme.svelte';
  import { preferences } from '$lib/stores/preferences.svelte';
  import { viewport } from '$lib/stores/viewport.svelte';

  type Monaco = typeof import('monaco-editor');
  type DiffEditor = import('monaco-editor').editor.IStandaloneDiffEditor;
  type Model = import('monaco-editor').editor.ITextModel;

  interface Props {
    original: string;
    modified: string;
    language?: string;
  }

  let { original, modified, language = 'markdown' }: Props = $props();

  function monacoThemeFor(id: EditorThemeId): string {
    return editorThemes.find((t) => t.id === id)?.monacoTheme ?? 'manuscript-dark';
  }

  let container: HTMLDivElement | undefined = $state();
  let editor: DiffEditor | null = null;
  let monaco: Monaco | null = null;
  let originalModel: Model | null = null;
  let modifiedModel: Model | null = null;

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

      originalModel = m.editor.createModel(original, language);
      modifiedModel = m.editor.createModel(modified, language);
      editor = m.editor.createDiffEditor(container!, {
        theme: monacoThemeFor(editorTheme.current),
        readOnly: true,
        renderSideBySide: !viewport.mobile,
        originalEditable: false,
        automaticLayout: true,
        wordWrap: 'on',
        wrappingStrategy: 'advanced',
        minimap: { enabled: false },
        fontFamily: 'var(--font-mono), ui-monospace, SFMono-Regular, monospace',
        fontSize: viewport.mobile ? 14 : 13,
        lineHeight: 1.6,
        scrollBeyondLastLine: false,
        renderOverviewRuler: true,
        ignoreTrimWhitespace: false,
        diffWordWrap: 'on'
      });
      editor.setModel({ original: originalModel, modified: modifiedModel });
    })();

    return () => {
      cancelled = true;
    };
  });

  $effect(() => {
    if (!originalModel || originalModel.getValue() === original) return;
    originalModel.setValue(original);
  });

  $effect(() => {
    if (!modifiedModel || modifiedModel.getValue() === modified) return;
    modifiedModel.setValue(modified);
  });

  $effect(() => {
    if (!editor) return;
    editor.updateOptions({
      renderSideBySide: !viewport.mobile,
      fontSize: viewport.mobile ? 14 : 13,
      minimap: { enabled: preferences.showMinimap && !viewport.mobile }
    });
  });

  $effect(() => {
    const themeId = editorTheme.current;
    if (!monaco || !editor) return;
    monaco.editor.setTheme(monacoThemeFor(themeId));
  });

  onDestroy(() => {
    editor?.dispose();
    originalModel?.dispose();
    modifiedModel?.dispose();
    editor = null;
    originalModel = null;
    modifiedModel = null;
  });
</script>

<div bind:this={container} class="h-full w-full"></div>
