<script lang="ts">
  import {
    AlertTriangle,
    CheckCircle2,
    CirclePause,
    GitBranch,
    LoaderCircle,
    Plus,
    RefreshCw,
    XCircle
  } from 'lucide-svelte';
  import type { BuildRun } from '@opentales/sdk';
  import { compactNumber } from '$lib/story-ide-model';
  import { cn } from '$lib/utils';
  import HeaderButton from './HeaderButton.svelte';
  import PanelHeader from './PanelHeader.svelte';

  interface Props {
    runs: BuildRun[];
    selectedId?: string | null;
    loading?: boolean;
    error?: string | null;
    onNew: () => void;
    onOpen: (run: BuildRun) => void;
    onRefresh: () => void;
  }

  let { runs, selectedId = null, loading = false, error = null, onNew, onOpen, onRefresh }: Props = $props();

  const ordered = $derived([...runs].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)));

  function statusIcon(status: BuildRun['status']) {
    if (status === 'completed') return CheckCircle2;
    if (status === 'failed') return AlertTriangle;
    if (status === 'cancelled') return XCircle;
    if (status === 'paused') return CirclePause;
    return LoaderCircle;
  }

  function statusColor(status: BuildRun['status']): string {
    if (status === 'completed') return 'text-emerald-400';
    if (status === 'failed') return 'text-destructive';
    if (status === 'cancelled' || status === 'paused') return 'text-muted-foreground';
    return 'text-accent';
  }
</script>

<div class="flex h-full flex-col">
  <PanelHeader title="Novel Builds">
    {#snippet actions()}
      <HeaderButton icon={RefreshCw} label="Refresh builds" onclick={onRefresh} />
      <HeaderButton icon={Plus} label="New Novel Build" onclick={onNew} />
    {/snippet}
  </PanelHeader>

  <div class="border-b border-border px-3 py-2">
    <p class="text-[10px] leading-relaxed text-muted-foreground">Durable story compiler runs. Every build writes to its own branch.</p>
  </div>

  <div class="min-h-0 flex-1 overflow-y-auto">
    {#if loading && runs.length === 0}
      <div class="flex items-center gap-2 p-4 text-[11px] text-muted-foreground"><LoaderCircle class="size-3.5 motion-safe:animate-spin" />Loading build history…</div>
    {:else if error && runs.length === 0}
      <div class="p-4"><div class="border-l-2 border-destructive bg-destructive/8 px-3 py-2 text-[11px] leading-relaxed text-destructive-foreground">{error}</div><button type="button" onclick={onRefresh} class="mt-3 inline-flex items-center gap-1 rounded border border-border px-2 py-1 text-[10px] text-foreground outline-none hover:border-accent/50 focus-visible:ring-2 focus-visible:ring-accent"><RefreshCw class="size-3" />Try again</button></div>
    {:else if runs.length === 0}
      <div class="flex flex-col items-center px-5 py-12 text-center"><GitBranch class="size-7 text-muted-foreground/40" /><p class="mt-3 text-xs text-foreground">No compiler runs yet.</p><p class="mt-1 text-[11px] leading-relaxed text-muted-foreground">Start from a brainstorm, declare the target and authority, then inspect every task.</p><button type="button" onclick={onNew} class="mt-4 inline-flex h-8 items-center gap-1 rounded bg-accent px-3 text-[10px] font-medium text-accent-foreground outline-none focus-visible:ring-2 focus-visible:ring-accent"><Plus class="size-3" />New Novel Build</button></div>
    {:else}
      <div class="divide-y divide-border/55">
        {#each ordered as run (run.id)}
          {@const Icon = statusIcon(run.status)}
          <button type="button" onclick={() => onOpen(run)} class={cn('w-full px-3 py-3 text-left outline-none transition-colors hover:bg-muted/35 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent', selectedId === run.id && 'bg-accent/6')}>
            <div class="flex items-start gap-2"><Icon class={cn('mt-0.5 size-3.5 shrink-0', statusColor(run.status), !['completed','failed','paused','cancelled'].includes(run.status) && 'motion-safe:animate-spin')} /><div class="min-w-0 flex-1"><h3 class="line-clamp-2 text-xs font-medium leading-snug text-foreground">{run.objective}</h3><p class="mt-1 font-mono text-[9px] uppercase tracking-wide text-muted-foreground">{run.currentPhase} · {run.status}</p></div><span class="font-mono text-[10px] text-accent">{run.progress.percent}%</span></div>
            <div class="mt-2 h-1 overflow-hidden rounded-full bg-muted"><span class={cn('block h-full', run.status === 'failed' ? 'bg-destructive' : 'bg-accent')} style:width={`${run.progress.percent}%`}></span></div>
            <div class="mt-2 flex items-center justify-between font-mono text-[9px] text-muted-foreground"><span>{run.progress.done}/{run.progress.total} tasks</span><span>{compactNumber(run.tokensUsed)} tokens · ${(run.costMicrosUsed / 1_000_000).toFixed(2)} USD</span></div>
          </button>
        {/each}
      </div>
    {/if}
  </div>

  {#if error && runs.length > 0}<div class="border-t border-destructive/30 bg-destructive/8 px-3 py-2 text-[10px] text-destructive-foreground" role="status">{error}</div>{/if}
</div>
