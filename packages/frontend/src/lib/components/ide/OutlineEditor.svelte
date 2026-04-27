<script lang="ts">
  import { BookOpen, Circle } from 'lucide-svelte';
  import { manuscript } from '$lib/stores/manuscript.svelte';
  import type { ChapterStatus } from '$lib/data/manuscript-types';
  import { cn } from '$lib/utils';

  const statusColor: Record<ChapterStatus, string> = {
    draft: 'text-muted-foreground/60',
    'in-progress': 'text-accent',
    review: 'text-chart-4',
    final: 'text-emerald-400'
  };
</script>

<div class="flex h-full flex-col bg-background">
  <div
    class="flex h-10 shrink-0 items-center gap-3 border-b border-border bg-sidebar/40 px-4 text-xs text-muted-foreground"
  >
    <BookOpen class="size-3.5" />
    <span class="font-mono">Manuscript</span>
    <span class="text-muted-foreground/50">/</span>
    <span class="text-foreground">Master Outline</span>
  </div>

  <div class="flex-1 overflow-y-auto">
    <div class="mx-auto max-w-4xl px-8 py-10">
      <h1 class="mb-2 font-serif text-3xl font-semibold text-foreground">Master Outline</h1>
      <p class="mb-10 max-w-prose text-sm leading-relaxed text-muted-foreground">
        A connected view of every act, chapter, POV, and setting. Click any chapter to open it
        in the editor.
      </p>

      <div class="space-y-10">
        {#each manuscript.acts as act, actIdx (act.id)}
          {@const actChapters = act.chapterIds
            .map((id) => manuscript.chapters.find((c) => c.id === id))
            .filter((c): c is NonNullable<typeof c> => Boolean(c))}
          <section>
            <div class="mb-4 flex items-center gap-3 border-b border-border pb-2">
              <div
                class="flex size-7 items-center justify-center rounded bg-accent font-mono text-xs font-bold text-accent-foreground"
              >
                {actIdx + 1}
              </div>
              <h2 class="font-serif text-xl font-semibold text-foreground">{act.title}</h2>
              <span class="ml-auto font-mono text-xs text-muted-foreground">
                {actChapters.reduce((s, c) => s + c.wordCount, 0).toLocaleString()} words
              </span>
            </div>

            <div class="grid grid-cols-1 gap-3 md:grid-cols-2">
              {#each actChapters as ch (ch.id)}
                {@const pov = manuscript.characters.find((c) => c.id === ch.povCharacterId)}
                {@const loc = manuscript.locations.find((l) => l.id === ch.locationId)}
                <button
                  type="button"
                  onclick={() =>
                    void manuscript.openTab({
                      id: `tab-${ch.id}`,
                      type: 'chapter',
                      refId: ch.id,
                      title: ch.title
                    })}
                  class="group relative flex flex-col gap-2 overflow-hidden rounded-md border border-border bg-card p-4 text-left transition-all hover:border-accent/50 hover:bg-muted/30"
                >
                  <div class="flex items-center gap-2">
                    <Circle class={cn('size-2 fill-current', statusColor[ch.status])} />
                    <span
                      class="font-mono text-[10px] uppercase tracking-wider text-muted-foreground"
                    >
                      {ch.number === 0
                        ? 'Prologue'
                        : `Chapter ${ch.number.toString().padStart(2, '0')}`}
                    </span>
                    <span class="ml-auto font-mono text-[10px] text-muted-foreground">
                      {ch.wordCount.toLocaleString()}w
                    </span>
                  </div>
                  <h3 class="font-serif text-base font-semibold text-foreground">
                    {ch.title}
                  </h3>
                  <p class="line-clamp-3 text-xs leading-relaxed text-muted-foreground">
                    {ch.summary}
                  </p>
                  <div
                    class="mt-auto flex items-center gap-3 pt-2 text-[11px] text-muted-foreground"
                  >
                    {#if pov}
                      <span class="flex items-center gap-1.5">
                        <span class="size-1 rounded-full bg-accent"></span>
                        {pov.name}
                      </span>
                    {/if}
                    {#if loc}
                      <span class="flex items-center gap-1.5">
                        <span class="size-1 rounded-full bg-muted-foreground"></span>
                        {loc.name}
                      </span>
                    {/if}
                  </div>
                </button>
              {/each}
              {#if actChapters.length === 0}
                <div
                  class="col-span-full rounded-md border border-dashed border-border p-6 text-center text-xs text-muted-foreground"
                >
                  No chapters in this act yet.
                </div>
              {/if}
            </div>
          </section>
        {/each}
      </div>
    </div>
  </div>
</div>
