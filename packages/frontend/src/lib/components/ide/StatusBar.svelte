<script lang="ts">
  import { Check, Circle, Flame, FileText, GitBranch, Target, Wifi } from 'lucide-svelte';
  import { manuscript } from '$lib/stores/manuscript.svelte';
  import { preferences } from '$lib/stores/preferences.svelte';
  import { runLint } from '$lib/lint/engine';
  import { readingTime } from '$lib/data/pacing';

  const activeTab = $derived(
    manuscript.tabs.find((t) => t.id === manuscript.activeTabId) ?? null
  );
  const activeChapter = $derived(
    activeTab?.type === 'chapter'
      ? manuscript.chapters.find((c) => c.id === activeTab.refId) ?? null
      : null
  );
  const totalWords = $derived(manuscript.chapters.reduce((s, c) => s + c.wordCount, 0));
  const totalReading = $derived(readingTime(totalWords));

  // Continuously sync today's progress with the manuscript word count.
  // The store dedupes baselines per day, so re-running this is cheap.
  $effect(() => {
    preferences.recordTotalWords(totalWords);
  });

  const diagnostics = $derived(
    runLint({ chapters: manuscript.chapters, characters: manuscript.characters })
  );
  const issueCount = $derived(diagnostics.length);

  const goal = $derived(preferences.dailyWordGoal);
  const written = $derived(preferences.getTodayProgress());
  const goalPct = $derived(goal > 0 ? Math.min(100, Math.round((written / goal) * 100)) : 0);
  const streak = $derived(preferences.streakDays());
</script>

<footer
  class="flex h-6 shrink-0 items-center justify-between border-t border-border bg-accent/90 text-[11px] text-accent-foreground"
>
  <div class="flex items-center divide-x divide-accent-foreground/10">
    <div class="flex items-center gap-1.5 px-3 py-0.5">
      <GitBranch class="size-3" />
      <span>main</span>
    </div>
    <button
      type="button"
      onclick={() => void manuscript.setActiveView('problems')}
      class="flex items-center gap-1.5 px-3 py-0.5 transition-colors hover:bg-accent-foreground/10"
      title="Open Problems panel"
    >
      <Check class="size-3" />
      <span>{issueCount} {issueCount === 1 ? 'issue' : 'issues'}</span>
    </button>
    <div class="flex items-center gap-1.5 px-3 py-0.5">
      <Circle class="size-2 fill-current" />
      <span class="font-medium">{manuscript.structure.title}</span>
    </div>
  </div>

  <div class="flex items-center divide-x divide-accent-foreground/10">
    {#if goal > 0}
      <div
        class="flex items-center gap-1.5 px-3 py-0.5"
        title={`Today: ${written.toLocaleString()} / ${goal.toLocaleString()} words${streak > 1 ? ` · ${streak}-day streak` : ''}`}
      >
        <Target class="size-3" />
        <span>{written.toLocaleString()} / {goal.toLocaleString()}</span>
        <span
          class="ml-1 inline-block h-1 w-12 overflow-hidden rounded-full bg-accent-foreground/20"
        >
          <span
            class="block h-full bg-accent-foreground"
            style:width={goalPct + '%'}
          ></span>
        </span>
        {#if streak > 1}
          <Flame class="ml-1 size-3" />
          <span>{streak}d</span>
        {/if}
      </div>
    {/if}
    {#if activeChapter}
      <div class="flex items-center gap-1.5 px-3 py-0.5">
        <FileText class="size-3" />
        <span>{activeChapter.wordCount.toLocaleString()} words</span>
      </div>
      <div class="flex items-center gap-1.5 px-3 py-0.5">
        <span class="font-mono">{readingTime(activeChapter.wordCount).label}</span>
      </div>
      <div class="flex items-center gap-1.5 px-3 py-0.5">
        <span class="font-mono">Markdown</span>
      </div>
    {/if}
    <div class="flex items-center gap-1.5 px-3 py-0.5">
      <span>Total: {totalWords.toLocaleString()} · {totalReading.label}</span>
    </div>
    <div class="flex items-center gap-1.5 px-3 py-0.5">
      <Wifi class="size-3" />
      <span>{manuscript.saving ? 'Saving...' : manuscript.error ? 'Save failed' : 'Synced'}</span>
    </div>
  </div>
</footer>
