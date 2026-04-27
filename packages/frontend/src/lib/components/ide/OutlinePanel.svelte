<script lang="ts">
  import { manuscript } from '$lib/stores/manuscript.svelte';
  import { pacingSeries, readingTime } from '$lib/data/pacing';
  import { cn } from '$lib/utils';
  import PanelHeader from './PanelHeader.svelte';

  const summary = $derived(
    manuscript.structure.outline.split('\n').find((l) => l.trim() && !l.startsWith('#')) ??
      manuscript.structure.outline
  );

  const series = $derived(pacingSeries(manuscript.chapters));
  const totalWords = $derived(series.reduce((s, d) => s + d.wordCount, 0));
  const totalReading = $derived(readingTime(totalWords));
  const peak = $derived(series.reduce((m, d) => Math.max(m, d.wordCount), 0));
</script>

<div class="flex h-full flex-col">
  <PanelHeader title="Outline" />

  <div class="flex-1 overflow-y-auto p-3">
    {#if series.length > 0}
      <div class="mb-3 rounded-md border border-border bg-card p-3">
        <div class="flex items-baseline justify-between">
          <div class="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            Pacing
          </div>
          <div class="font-mono text-[11px] text-muted-foreground">
            {totalWords.toLocaleString()} w · {totalReading.label}
          </div>
        </div>
        <div class="mt-2 flex h-12 items-end gap-px">
          {#each series as datum (datum.chapterId)}
            {@const heightPct = peak > 0 ? Math.max(4, (datum.wordCount / peak) * 100) : 0}
            <button
              type="button"
              title={`Ch${datum.number}: ${datum.title} — ${datum.wordCount} words · ${readingTime(datum.wordCount).label}`}
              onclick={() =>
                void manuscript.openTab({
                  id: `tab-${datum.chapterId}`,
                  type: 'chapter',
                  refId: datum.chapterId,
                  title: datum.title
                })}
              class="flex-1 rounded-sm bg-accent/40 transition-colors hover:bg-accent"
              style:height={heightPct + '%'}
              aria-label={`Chapter ${datum.number}: ${datum.title}`}
            ></button>
          {/each}
        </div>
        <div class="mt-1 flex justify-between font-mono text-[9px] text-muted-foreground/70">
          <span>Ch{series[0].number}</span>
          <span>Ch{series[series.length - 1].number}</span>
        </div>
      </div>
    {/if}

    <button
      type="button"
      onclick={() =>
        void manuscript.openTab({
          id: 'tab-outline',
          type: 'outline',
          refId: 'outline',
          title: 'Outline'
        })}
      class={cn(
        'mb-3 w-full rounded-md border p-3 text-left transition-colors',
        manuscript.activeTabId === 'tab-outline'
          ? 'border-accent/60 bg-muted'
          : 'border-border bg-card hover:border-accent/40'
      )}
    >
      <div class="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
        Master Outline
      </div>
      <div class="mt-1 line-clamp-3 text-xs leading-relaxed text-foreground/80">
        {summary}
      </div>
    </button>

    <div class="space-y-3">
      {#each manuscript.acts as act, actIdx (act.id)}
        {@const actChapters = act.chapterIds
          .map((id) => manuscript.chapters.find((c) => c.id === id))
          .filter((c): c is NonNullable<typeof c> => Boolean(c))}
        <div class="relative">
          <div class="mb-2 flex items-center gap-2">
            <div
              class="flex size-5 items-center justify-center rounded-sm bg-accent font-mono text-[10px] font-bold text-accent-foreground"
            >
              {actIdx + 1}
            </div>
            <h3 class="text-[10px] font-semibold uppercase tracking-wider text-foreground">
              {act.title}
            </h3>
          </div>

          <div class="ml-2 space-y-1.5 border-l border-border pl-3">
            {#if actChapters.length === 0}
              <div class="text-[11px] italic text-muted-foreground">No chapters outlined</div>
            {/if}
            {#each actChapters as ch (ch.id)}
              <button
                type="button"
                onclick={() =>
                  void manuscript.openTab({
                    id: `tab-${ch.id}`,
                    type: 'chapter',
                    refId: ch.id,
                    title: ch.title
                  })}
                class="group relative -ml-3 block w-full rounded-r border-l-2 border-transparent bg-card/60 py-1.5 pl-3 pr-2 text-left transition-colors hover:border-accent hover:bg-muted/50"
              >
                <div class="flex items-center gap-2">
                  <span class="font-mono text-[10px] text-muted-foreground">
                    {ch.number === 0 ? 'Pr' : `Ch${ch.number.toString().padStart(2, '0')}`}
                  </span>
                  <span class="truncate text-xs font-medium text-foreground">{ch.title}</span>
                  <span class="ml-auto shrink-0 font-mono text-[9px] text-muted-foreground/70">
                    {readingTime(ch.wordCount).label}
                  </span>
                </div>
                <p
                  class="mt-0.5 line-clamp-2 text-[11px] leading-relaxed text-muted-foreground"
                >
                  {ch.summary}
                </p>
              </button>
            {/each}
          </div>
        </div>
      {/each}
    </div>
  </div>
</div>
