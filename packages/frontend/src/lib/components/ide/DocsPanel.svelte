<script lang="ts">
  import {
    BookText,
    ChevronDown,
    ChevronRight,
    FileText,
    Lightbulb,
    Loader2,
    MessageSquare,
    Plus,
    ScrollText,
    Sparkles,
    Trash2
  } from 'lucide-svelte';
  import type { ProjectDocKind } from '@opentales/sdk';
  import { ai } from '$lib/stores/ai.svelte';
  import { manuscript } from '$lib/stores/manuscript.svelte';
  import { cn } from '$lib/utils';
  import HeaderButton from './HeaderButton.svelte';
  import PanelHeader from './PanelHeader.svelte';

  const projectId = $derived(manuscript.projectId);
  const docs = $derived(ai.docs);

  let loaded = $state(false);
  let filter = $state<ProjectDocKind | 'all'>('all');

  const kindSections: { kind: ProjectDocKind | 'all'; label: string; icon: typeof FileText }[] = [
    { kind: 'all', label: 'All', icon: FileText },
    { kind: 'instructions', label: 'Instructions', icon: Sparkles },
    { kind: 'note', label: 'Notes', icon: MessageSquare },
    { kind: 'brainstorm', label: 'Brainstorms', icon: Lightbulb },
    { kind: 'reference', label: 'Reference', icon: BookText },
    { kind: 'other', label: 'Other', icon: ScrollText }
  ];

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const kindIcons: Record<ProjectDocKind, any> = {
    instructions: Sparkles,
    note: MessageSquare,
    brainstorm: Lightbulb,
    reference: BookText,
    other: ScrollText
  };

  $effect(() => {
    const pid = projectId;
    if (pid && !loaded) {
      const kindFilter = filter === 'all' ? undefined : filter;
      void ai.loadDocs(pid, { limit: 50, kind: kindFilter });
      loaded = true;
    }
  });

  function reload() {
    if (!projectId) return;
    const kindFilter = filter === 'all' ? undefined : filter;
    void ai.loadDocs(projectId, { limit: 50, kind: kindFilter });
  }

  function setFilter(next: ProjectDocKind | 'all') {
    filter = next;
    loaded = false;
  }

  async function createNew() {
    if (!projectId) return;
    const doc = await ai.createDoc(projectId, { title: 'Untitled Doc', kind: 'note' });
    if (doc) {
      void manuscript.openTab({
        id: `tab-doc-${doc.id}`,
        type: 'doc',
        refId: doc.id,
        title: doc.title
      });
    }
  }

  async function deleteDocConfirm(docId: string, title: string) {
    if (!projectId) return;
    if (!window.confirm(`Delete "${title}"?`)) return;
    await ai.deleteDoc(projectId, docId);
    void manuscript.closeTab(`tab-doc-${docId}`);
  }

  function openDoc(doc: { id: string; title: string; kind: ProjectDocKind }) {
    void manuscript.openTab({
      id: `tab-doc-${doc.id}`,
      type: 'doc',
      refId: doc.id,
      title: doc.title
    });
  }

  const filteredDocs = $derived(
    filter === 'all' ? docs : docs.filter((d) => d.kind === filter)
  );

  const instructionDocs = $derived(docs.filter((d) => d.kind === 'instructions'));
  const otherDocs = $derived(docs.filter((d) => d.kind !== 'instructions'));
</script>

<div class="flex h-full flex-col">
  <PanelHeader title="Docs & Notes">
    {#snippet actions()}
      <HeaderButton icon={Plus} label="New doc" onclick={createNew} />
    {/snippet}
  </PanelHeader>

  <!-- Kind filter -->
  <div class="flex gap-0.5 overflow-x-auto border-b border-border px-2 py-1 [scrollbar-width:none]">
    {#each kindSections as sec (sec.kind)}
      <button
        type="button"
        onclick={() => setFilter(sec.kind)}
        class={cn(
          'shrink-0 rounded px-2 py-1 text-[10px] transition-colors',
          filter === sec.kind
            ? 'bg-accent text-accent-foreground'
            : 'text-muted-foreground hover:bg-muted hover:text-foreground'
        )}
      >
        {sec.label}
      </button>
    {/each}
  </div>

  <div class="flex-1 overflow-y-auto py-1">
    {#if ai.docsLoading}
      <div class="flex items-center gap-2 p-4 text-[11px] text-muted-foreground">
        <Loader2 class="size-3.5 animate-spin" />
        Loading docs…
      </div>
    {:else if filteredDocs.length === 0}
      <div class="p-4 text-center text-[11px] text-muted-foreground">
        <p class="mb-3">No docs yet.</p>
        <button
          type="button"
          onclick={createNew}
          class="inline-flex items-center gap-1.5 rounded-md border border-dashed border-border px-3 py-1.5 text-foreground/80 hover:border-accent/60 hover:text-foreground"
        >
          <Plus class="size-3.5" />
          New Doc
        </button>
      </div>
    {:else}
      <!-- Instruction docs (special highlight) -->
      {#if filter === 'all' && instructionDocs.length > 0}
        <div class="mb-1 px-2 py-1">
          <p class="text-[10px] uppercase tracking-wide text-accent/80">
            Agent Instructions
          </p>
          <p class="text-[10px] text-muted-foreground">
            Injected into the AI agent's system prompt.
          </p>
        </div>
        {#each instructionDocs as doc (doc.id)}
          {@const isActive = manuscript.activeTabId === `tab-doc-${doc.id}`}
          <div
            role="button"
            tabindex="0"
            onclick={() => openDoc(doc)}
            onkeydown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openDoc(doc); } }}
            class={cn(
              'group flex w-full cursor-pointer items-center gap-2 px-2 py-1.5 text-left text-xs transition-colors',
              isActive
                ? 'bg-accent/10 text-foreground'
                : 'text-foreground/75 hover:bg-muted/50 hover:text-foreground'
            )}
          >
            <Sparkles class="size-3.5 shrink-0 text-accent/70" />
            <span class="flex-1 truncate">{doc.title}</span>
            <button
              type="button"
              onclick={(e) => { e.stopPropagation(); deleteDocConfirm(doc.id, doc.title); }}
              class="hidden text-muted-foreground hover:text-destructive group-hover:block"
              title="Delete"
            >
              <Trash2 class="size-3" />
            </button>
          </div>
        {/each}
        {#if otherDocs.length > 0}
          <div class="my-1 border-t border-border/50"></div>
        {/if}
      {/if}

      <!-- Other docs -->
      {#each filter === 'all' ? otherDocs : filteredDocs.filter(d => filter !== 'all' || d.kind !== 'instructions') as doc (doc.id)}
        {@const isActive = manuscript.activeTabId === `tab-doc-${doc.id}`}
        {@const Icon = kindIcons[doc.kind] ?? FileText}
        <div
          role="button"
          tabindex="0"
          onclick={() => openDoc(doc)}
          onkeydown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openDoc(doc); } }}
          class={cn(
            'group flex w-full cursor-pointer items-center gap-2 px-2 py-1.5 text-left text-xs transition-colors',
            isActive
              ? 'bg-muted text-foreground'
              : 'text-foreground/75 hover:bg-muted/50 hover:text-foreground'
          )}
        >
          <Icon class="size-3.5 shrink-0 text-muted-foreground" />
          <div class="min-w-0 flex-1">
            <span class="block truncate">{doc.title}</span>
            <span class="block text-[10px] text-muted-foreground">
              {doc.kind} · {doc.wordCount.toLocaleString()} words
            </span>
          </div>
          <button
            type="button"
            onclick={(e) => { e.stopPropagation(); deleteDocConfirm(doc.id, doc.title); }}
            class="hidden text-muted-foreground hover:text-destructive group-hover:block"
            title="Delete"
          >
            <Trash2 class="size-3" />
          </button>
        </div>
      {/each}
    {/if}

    {#if ai.docsError}
      <p class="px-3 py-2 text-[11px] text-destructive">{ai.docsError}</p>
    {/if}
  </div>

  <div
    class="border-t border-border bg-sidebar/60 px-3 py-2 text-[10px] uppercase tracking-wide text-muted-foreground"
  >
    <div class="flex items-center justify-between">
      <span>Docs</span>
      <span class="font-mono">{ai.docsTotal}</span>
    </div>
  </div>
</div>
