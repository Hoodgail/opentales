<script lang="ts">
  import { Flame, RefreshCw } from 'lucide-svelte';
  import { onMount } from 'svelte';
  import { manuscript } from '$lib/stores/manuscript.svelte';
  import HeaderButton from './HeaderButton.svelte';
  import PanelHeader from './PanelHeader.svelte';

  onMount(() => {
    void manuscript.loadProjectStats();
  });

  function maxWords(): number {
    const stats = manuscript.projectStats;
    if (!stats) return 0;
    return stats.days.reduce((m, d) => Math.max(m, d.wordsAdded), 0);
  }

  function bucket(wordsAdded: number, max: number): string {
    if (wordsAdded === 0) return 'bg-muted/40';
    const ratio = max > 0 ? wordsAdded / max : 0;
    if (ratio < 0.25) return 'bg-emerald-900/40';
    if (ratio < 0.5) return 'bg-emerald-700/60';
    if (ratio < 0.75) return 'bg-emerald-500/70';
    return 'bg-emerald-400';
  }

  function shortDate(iso: string): string {
    const d = new Date(`${iso}T00:00:00Z`);
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  }
</script>

<div class="flex h-full flex-col">
  <PanelHeader title="Writing stats">
    {#snippet actions()}
      <HeaderButton
        icon={RefreshCw}
        label="Refresh stats"
        onclick={() => void manuscript.loadProjectStats()}
      />
    {/snippet}
  </PanelHeader>

  <div class="flex-1 overflow-y-auto px-3 py-3">
    {#if manuscript.projectStatsLoading && !manuscript.projectStats}
      <p class="px-1 text-xs text-muted-foreground">Loading…</p>
    {:else if !manuscript.projectStats}
      <p class="px-1 text-xs text-muted-foreground">No stats available yet.</p>
    {:else}
      {@const stats = manuscript.projectStats}
      {@const max = maxWords()}
      <div class="grid grid-cols-2 gap-2">
        <div class="rounded-md border border-border/60 bg-background/40 px-3 py-2">
          <div class="text-[10px] uppercase tracking-wider text-muted-foreground">Total words</div>
          <div class="mt-0.5 text-lg font-semibold text-foreground">
            {stats.totalWords.toLocaleString()}
          </div>
        </div>
        <div class="rounded-md border border-border/60 bg-background/40 px-3 py-2">
          <div class="text-[10px] uppercase tracking-wider text-muted-foreground">
            Last {stats.windowDays} days
          </div>
          <div class="mt-0.5 text-lg font-semibold text-foreground">
            +{stats.totalWordsAddedInWindow.toLocaleString()}
          </div>
        </div>
        <div class="rounded-md border border-border/60 bg-background/40 px-3 py-2">
          <div class="text-[10px] uppercase tracking-wider text-muted-foreground">Versions</div>
          <div class="mt-0.5 text-lg font-semibold text-foreground">
            {stats.totalVersionsInWindow.toLocaleString()}
          </div>
        </div>
        <div class="rounded-md border border-border/60 bg-background/40 px-3 py-2">
          <div class="flex items-center gap-1 text-[10px] uppercase tracking-wider text-muted-foreground">
            <Flame class="size-3 text-amber-400" /> Streak
          </div>
          <div class="mt-0.5 text-lg font-semibold text-foreground">
            {stats.currentStreakDays}d
          </div>
        </div>
      </div>

      <div class="mt-4">
        <div class="mb-2 text-[10px] uppercase tracking-wider text-muted-foreground">
          Daily activity (words added)
        </div>
        <div class="grid grid-cols-7 gap-0.5">
          {#each stats.days as day (day.date)}
            <div
              class={`h-3.5 rounded-sm ${bucket(day.wordsAdded, max)}`}
              title={`${shortDate(day.date)}: ${day.wordsAdded.toLocaleString()} words`}
            ></div>
          {/each}
        </div>
        <div class="mt-2 flex items-center justify-between text-[10px] text-muted-foreground">
          <span>{shortDate(stats.days[0]?.date ?? '')}</span>
          <span>Today</span>
        </div>
      </div>
    {/if}
  </div>
</div>
