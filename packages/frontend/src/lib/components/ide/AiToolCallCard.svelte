<script lang="ts">
  import { Check, ChevronDown, ChevronRight, Loader2, Wrench, X } from 'lucide-svelte';
  import type { AiAgentToolCall } from '@opentales/sdk';
  import { aiAgent } from '$lib/stores/aiAgent.svelte';
  import { cn } from '$lib/utils';

  interface Props {
    call: AiAgentToolCall;
  }

  let { call }: Props = $props();

  let expanded = $state(false);
  let busy = $state(false);

  const isMutation = $derived(
    /^(create|update|delete)/.test(call.toolName) || call.status === 'pending-approval'
  );
  const isPending = $derived(call.status === 'pending-approval');

  function statusLabel(): string {
    switch (call.status) {
      case 'pending-approval':
        return 'Awaiting approval';
      case 'approved':
        return 'Approved';
      case 'rejected':
        return 'Rejected';
      case 'executed':
        return 'Done';
      case 'error':
        return 'Error';
    }
  }

  function statusTone(): string {
    switch (call.status) {
      case 'pending-approval':
        return 'border-amber-500/40 bg-amber-500/10 text-amber-300';
      case 'approved':
      case 'executed':
        return 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300';
      case 'rejected':
        return 'border-muted-foreground/40 bg-muted/40 text-muted-foreground';
      case 'error':
        return 'border-destructive/40 bg-destructive/10 text-destructive-foreground';
    }
  }

  // Summarise key details from tool input so users can see, e.g., chapter
  // ranges or grep queries without expanding the JSON blob every time.
  function summarise(): string {
    const input = (call.input ?? {}) as Record<string, unknown>;
    const parts: string[] = [];
    if (typeof input.chapterId === 'string') parts.push(`chapter:${shorten(input.chapterId)}`);
    if (typeof input.docId === 'string') parts.push(`doc:${shorten(input.docId)}`);
    if (typeof input.characterId === 'string')
      parts.push(`character:${shorten(input.characterId)}`);
    if (typeof input.locationId === 'string')
      parts.push(`location:${shorten(input.locationId)}`);
    if (typeof input.query === 'string') parts.push(`q:"${truncate(input.query, 32)}"`);
    if (input.full === true) parts.push('full');
    if (typeof input.startLine === 'number' || typeof input.endLine === 'number') {
      parts.push(`L${input.startLine ?? '?'}–${input.endLine ?? '?'}`);
    } else if (typeof input.offset === 'number' || typeof input.length === 'number') {
      parts.push(`offset:${input.offset ?? 0}+${input.length ?? '?'}`);
    } else if (call.toolName === 'readChapter') {
      parts.push('summary');
    }
    return parts.join(' · ');
  }

  function shorten(id: string): string {
    return id.length > 8 ? `…${id.slice(-6)}` : id;
  }

  function truncate(text: string, max: number): string {
    return text.length > max ? `${text.slice(0, max - 1)}…` : text;
  }

  async function onApprove(approved: boolean) {
    if (busy) return;
    busy = true;
    await aiAgent.approveToolCall(call.id, approved);
    busy = false;
  }

  const summary = $derived(summarise());
  const inputJson = $derived(JSON.stringify(call.input ?? {}, null, 2));
  const outputJson = $derived(
    call.output === null || call.output === undefined
      ? ''
      : typeof call.output === 'string'
        ? call.output
        : JSON.stringify(call.output, null, 2)
  );
</script>

<div
  class={cn(
    'rounded-md border bg-card/60 text-xs',
    isPending ? 'border-amber-500/40' : 'border-border'
  )}
>
  <button
    type="button"
    onclick={() => (expanded = !expanded)}
    class="flex w-full items-center gap-2 px-2.5 py-1.5 text-left"
  >
    {#if expanded}
      <ChevronDown class="size-3.5 shrink-0 text-muted-foreground" />
    {:else}
      <ChevronRight class="size-3.5 shrink-0 text-muted-foreground" />
    {/if}
    <Wrench
      class={cn(
        'size-3.5 shrink-0',
        isMutation ? 'text-amber-300' : 'text-muted-foreground'
      )}
    />
    <span class="font-mono text-[11px] text-foreground">{call.toolName}</span>
    {#if summary}
      <span class="truncate text-[10px] text-muted-foreground">{summary}</span>
    {/if}
    <span
      class={cn(
        'ml-auto shrink-0 rounded border px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-wider',
        statusTone()
      )}
    >
      {statusLabel()}
    </span>
  </button>

  {#if expanded}
    <div class="space-y-2 border-t border-border px-2.5 py-2">
      <div>
        <div class="mb-1 text-[9px] font-semibold uppercase tracking-wider text-muted-foreground">
          Input
        </div>
        <pre
          class="overflow-x-auto rounded border border-border bg-background/60 px-2 py-1.5 font-mono text-[10px] leading-snug text-foreground/80"
        >{inputJson}</pre>
      </div>
      {#if outputJson}
        <div>
          <div
            class="mb-1 text-[9px] font-semibold uppercase tracking-wider text-muted-foreground"
          >
            Result
          </div>
          <pre
            class="max-h-48 overflow-auto rounded border border-border bg-background/60 px-2 py-1.5 font-mono text-[10px] leading-snug text-foreground/80"
          >{outputJson}</pre>
        </div>
      {/if}
      {#if call.error}
        <div
          class="rounded border border-destructive/30 bg-destructive/10 px-2 py-1.5 text-[10px] text-destructive-foreground"
        >
          {call.error}
        </div>
      {/if}
    </div>
  {/if}

  {#if isPending}
    <div class="flex items-center gap-1.5 border-t border-amber-500/30 bg-amber-500/5 px-2.5 py-1.5">
      <span class="text-[10px] text-amber-200/90">
        The agent wants to run a mutation. Approve to apply, reject to skip.
      </span>
      <button
        type="button"
        disabled={busy}
        onclick={() => onApprove(false)}
        class="ml-auto inline-flex items-center gap-1 rounded border border-border bg-background/60 px-2 py-1 text-[10px] text-muted-foreground hover:bg-muted disabled:opacity-50"
      >
        {#if busy}
          <Loader2 class="size-3 animate-spin" />
        {:else}
          <X class="size-3" />
        {/if}
        Reject
      </button>
      <button
        type="button"
        disabled={busy}
        onclick={() => onApprove(true)}
        class="inline-flex items-center gap-1 rounded bg-amber-500 px-2 py-1 text-[10px] font-medium text-background hover:bg-amber-400 disabled:opacity-50"
      >
        {#if busy}
          <Loader2 class="size-3 animate-spin" />
        {:else}
          <Check class="size-3" />
        {/if}
        Approve
      </button>
    </div>
  {/if}
</div>
