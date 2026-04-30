<script lang="ts">
  import { Check, FileJson, GitCompare, LayoutGrid, X } from 'lucide-svelte';
  import { deleteAiApprovalDoc, getAiApprovalDoc } from '$lib/data/ai-approval-docs';
  import { ai } from '$lib/stores/ai.svelte';
  import { manuscript } from '$lib/stores/manuscript.svelte';
  import { cn } from '$lib/utils';
  import MonacoDiffEditor from './MonacoDiffEditor.svelte';

  interface Props {
    approvalId: string;
  }

  let { approvalId }: Props = $props();

  const doc = $derived(getAiApprovalDoc(approvalId));
  const projectId = $derived(manuscript.projectId);
  let showRaw = $state(false);

  function approve() {
    if (!projectId || !doc) return;
    const pid = projectId;
    void ai
      .approveToolCall(pid, doc.toolCall.id, true, doc.sessionId)
      .then(() => manuscript.refreshProject(pid))
      .then(() => {
        deleteAiApprovalDoc(doc.id);
        void manuscript.closeTab(`tab-ai-approval-${doc.toolCall.id}`);
      });
  }

  function reject() {
    if (!projectId || !doc) return;
    void ai.approveToolCall(projectId, doc.toolCall.id, false, doc.sessionId);
    deleteAiApprovalDoc(doc.id);
    void manuscript.closeTab(`tab-ai-approval-${doc.toolCall.id}`);
  }
</script>

{#if !doc}
  <div class="flex h-full items-center justify-center bg-background text-xs text-muted-foreground">
    Approval preview not found.
  </div>
{:else}
  <div class="flex h-full flex-col bg-background">
    <div class="flex min-h-11 shrink-0 items-center justify-between gap-3 border-b border-border bg-sidebar/40 px-4 text-xs">
      <div class="flex min-w-0 items-center gap-3">
        <GitCompare class="size-3.5 text-amber-300" />
        <span class="font-mono text-muted-foreground">AI Approval</span>
        <span class="text-muted-foreground/50">/</span>
        <span class="truncate text-foreground">{doc.targetLabel}</span>
      </div>
      <div class="flex shrink-0 items-center gap-1.5">
        <button
          type="button"
          onclick={() => (showRaw = !showRaw)}
          class={cn(
            'inline-flex items-center gap-1 rounded-md border px-2 py-1 text-[11px] transition-colors',
            showRaw
              ? 'border-accent/50 bg-accent/10 text-accent'
              : 'border-border text-muted-foreground hover:bg-muted hover:text-foreground'
          )}
        >
          <FileJson class="size-3" /> Raw
        </button>
        <button
          type="button"
          onclick={approve}
          class="inline-flex items-center gap-1 rounded-md bg-emerald-600/85 px-2.5 py-1 text-[11px] text-white hover:bg-emerald-500"
        >
          <Check class="size-3" /> Approve
        </button>
        <button
          type="button"
          onclick={reject}
          class="inline-flex items-center gap-1 rounded-md border border-border px-2.5 py-1 text-[11px] text-muted-foreground hover:bg-muted hover:text-foreground"
        >
          <X class="size-3" /> Reject
        </button>
      </div>
    </div>

    {#if showRaw}
      <pre class="max-h-44 shrink-0 overflow-auto border-b border-border bg-card p-3 text-[11px] text-foreground/80">{JSON.stringify(doc.toolCall.input, null, 2)}</pre>
    {/if}

    <div class="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto bg-background p-3">
      <div class="flex shrink-0 items-center justify-between rounded-lg border border-border bg-card/70 px-3 py-2">
        <div class="flex min-w-0 items-center gap-2">
          <LayoutGrid class="size-3.5 text-accent" />
          <div class="min-w-0">
            <p class="text-xs font-medium text-foreground">Multi-field review</p>
            <p class="text-[10px] text-muted-foreground">Each changed surface has its own diff pane.</p>
          </div>
        </div>
        <span class="rounded-full border border-border bg-background px-2 py-0.5 text-[10px] text-muted-foreground">
          {doc.panes.length} {doc.panes.length === 1 ? 'pane' : 'panes'}
        </span>
      </div>

      <div class="grid min-h-[42rem] flex-1 auto-rows-[minmax(20rem,1fr)] grid-cols-1 gap-3 xl:grid-cols-2">
        {#each doc.panes as pane (pane.id)}
          <section class="flex min-h-80 min-w-0 overflow-hidden rounded-xl border border-border bg-card shadow-sm">
            <div class="flex min-h-0 min-w-0 flex-1 flex-col">
              <header class="flex shrink-0 items-start justify-between gap-3 border-b border-border bg-sidebar/50 px-3 py-2">
                <div class="min-w-0">
                  <h3 class="truncate text-xs font-semibold text-foreground">{pane.title}</h3>
                  <p class="mt-0.5 truncate text-[10px] text-muted-foreground">{pane.description}</p>
                </div>
                <div class="flex shrink-0 overflow-hidden rounded-md border border-border bg-background text-[9px] font-semibold uppercase tracking-wider">
                  <span class="border-r border-border px-1.5 py-0.5 text-destructive/90">Old</span>
                  <span class="px-1.5 py-0.5 text-emerald-400">New</span>
                </div>
              </header>
              <div class="min-h-0 flex-1">
                <MonacoDiffEditor original={pane.original} modified={pane.modified} language={pane.language} />
              </div>
            </div>
          </section>
        {/each}
      </div>
    </div>
  </div>
{/if}
