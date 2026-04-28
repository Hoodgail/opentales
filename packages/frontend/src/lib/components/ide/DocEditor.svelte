<script lang="ts">
  import { Loader2 } from 'lucide-svelte';
  import type { ProjectDoc, ProjectDocKind } from '@opentales/sdk';
  import { ai } from '$lib/stores/ai.svelte';
  import { manuscript } from '$lib/stores/manuscript.svelte';
  import MonacoMarkdownEditor from './MonacoMarkdownEditor.svelte';

  interface Props {
    docId: string;
  }

  let { docId }: Props = $props();

  let doc = $state<ProjectDoc | null>(null);
  let loading = $state(true);
  let localContent = $state('');
  let lastDocId = $state<string | null>(null);
  let saveTimer: ReturnType<typeof setTimeout> | null = null;

  const projectId = $derived(manuscript.projectId);

  const kindOptions: { value: ProjectDocKind; label: string }[] = [
    { value: 'note', label: 'Note' },
    { value: 'brainstorm', label: 'Brainstorm' },
    { value: 'instructions', label: 'Instructions' },
    { value: 'reference', label: 'Reference' },
    { value: 'other', label: 'Other' }
  ];

  $effect(() => {
    if (docId !== lastDocId && projectId) {
      lastDocId = docId;
      loading = true;
      void loadDoc(projectId, docId);
    }
  });

  async function loadDoc(pid: string, id: string) {
    const result = await ai.getDoc(pid, id);
    if (result) {
      doc = result;
      localContent = result.content;
    }
    loading = false;
  }

  function handleChange(next: string) {
    localContent = next;
    debounceAutosave();
  }

  function debounceAutosave() {
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      if (projectId && doc) {
        void ai.updateDoc(projectId, doc.id, { content: localContent });
      }
    }, 1200);
  }

  async function updateTitle(e: Event) {
    const input = e.currentTarget as HTMLInputElement;
    const title = input.value.trim();
    if (!title || !projectId || !doc) return;
    await ai.updateDoc(projectId, doc.id, { title });
    doc.title = title;
    // Update tab title
    const tab = manuscript.tabs.find((t) => t.id === `tab-doc-${doc!.id}`);
    if (tab) tab.title = title;
  }

  async function updateKind(e: Event) {
    const select = e.currentTarget as HTMLSelectElement;
    const kind = select.value as ProjectDocKind;
    if (!projectId || !doc) return;
    await ai.updateDoc(projectId, doc.id, { kind });
    doc.kind = kind;
  }
</script>

{#if loading}
  <div class="flex h-full items-center justify-center text-xs text-muted-foreground">
    <Loader2 class="mr-2 size-3.5 animate-spin" />
    Loading…
  </div>
{:else if !doc}
  <div class="flex h-full items-center justify-center text-xs text-muted-foreground">
    Document not found
  </div>
{:else}
  <div class="flex h-full flex-col bg-background">
    <!-- Header -->
    <div
      class="flex min-h-11 shrink-0 items-center gap-3 border-b border-border bg-sidebar/40 px-4 text-xs"
    >
      <input
        type="text"
        value={doc.title}
        onblur={updateTitle}
        class="min-w-0 flex-1 bg-transparent text-foreground outline-none focus:border-b focus:border-accent"
      />
      <select
        value={doc.kind}
        onchange={updateKind}
        class="rounded-md border border-border bg-background px-2 py-1 text-[11px] text-foreground outline-none"
      >
        {#each kindOptions as opt (opt.value)}
          <option value={opt.value}>{opt.label}</option>
        {/each}
      </select>
      {#if doc.kind === 'instructions'}
        <span class="rounded bg-accent/20 px-1.5 py-0.5 text-[10px] text-accent">
          Agent prompt
        </span>
      {/if}
    </div>

    <!-- Editor -->
    <div class="min-h-0 flex-1">
      <MonacoMarkdownEditor value={localContent} onChange={handleChange} />
    </div>
  </div>
{/if}
