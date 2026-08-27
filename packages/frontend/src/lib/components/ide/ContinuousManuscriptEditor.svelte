<script lang="ts">
  import { BookOpenText, Braces, Eye, FileText, PencilLine, StickyNote } from 'lucide-svelte';
  import { ai } from '$lib/stores/ai.svelte';
  import { manuscript } from '$lib/stores/manuscript.svelte';
  import { storyUi } from '$lib/stores/storyUi.svelte';
  import { cn } from '$lib/utils';
  import MarkdownPreview from './MarkdownPreview.svelte';

  type Mode = 'write' | 'read' | 'source';
  let mode = $state<Mode>(storyUi.continuousMode);
  let statusFilter = $state<'all' | 'draft' | 'in-progress' | 'review' | 'final'>(storyUi.continuousStatus);
  let researchOpen = $state(false);
  let selectedResearchId = $state('');
  const researchDocs = $derived(ai.fileTree.docs.filter((doc) => doc.kind === 'reference' || doc.kind === 'note' || doc.kind === 'brainstorm'));
  const selectedResearch = $derived(researchDocs.find((doc) => doc.id === selectedResearchId) ?? researchDocs[0] ?? null);

  $effect(() => {
    if (manuscript.projectId && researchOpen) void ai.loadFileTree(manuscript.projectId);
  });

  $effect(() => {
    if (researchDocs.length === 0) {
      selectedResearchId = '';
    } else if (!researchDocs.some((doc) => doc.id === selectedResearchId)) {
      selectedResearchId = researchDocs[0].id;
    }
  });

  const ordered = $derived.by(() => {
    const seen = new Set<string>();
    const rows: Array<{
      actId: string | null;
      actTitle: string;
      chapter: (typeof manuscript.chapters)[number];
    }> = [];
    for (const act of manuscript.acts) {
      for (const id of act.chapterIds) {
        const chapter = manuscript.chapters.find((candidate) => candidate.id === id);
        if (!chapter) continue;
        seen.add(chapter.id);
        rows.push({ actId: act.id, actTitle: act.title, chapter });
      }
    }
    for (const chapter of [...manuscript.chapters].sort((a, b) => a.number - b.number)) {
      if (!seen.has(chapter.id)) rows.push({ actId: null, actTitle: 'Unfiled', chapter });
    }
    return statusFilter === 'all'
      ? rows
      : rows.filter((row) => row.chapter.status === statusFilter);
  });

  const totalWords = $derived(ordered.reduce((sum, row) => sum + row.chapter.wordCount, 0));

  function openSource(chapter: (typeof manuscript.chapters)[number]) {
    void manuscript.openTab({
      id: `tab-${chapter.id}`,
      type: 'chapter',
      refId: chapter.id,
      title: chapter.title
    });
  }

  function textareaRows(value: string): number {
    const lineCount = value.split('\n').length;
    const wrappedLineEstimate = Math.ceil(value.length / 92);
    return Math.max(8, Math.min(48, Math.max(lineCount, wrappedLineEstimate)));
  }

  function readingContent(value: string): string {
    // The continuous view already renders the canonical chapter title. Avoid
    // repeating a source-mode H1 at the top of the prose projection.
    return value.replace(/^\s*#\s+[^\n]+\n+/, '');
  }

  function updateContinuousContent(chapterId: string, original: string, next: string) {
    const heading = original.match(/^\s*#\s+[^\n]+\n+/)?.[0] ?? '';
    manuscript.updateChapterContent(chapterId, `${heading}${next}`);
  }
</script>

<section class="flex min-h-0 flex-1 flex-col bg-background" aria-label="Continuous manuscript">
  <header class="flex min-h-12 shrink-0 flex-wrap items-center gap-2 border-b border-border bg-sidebar px-3 py-2 sm:px-5">
    <div class="flex min-w-0 items-center gap-2">
      <BookOpenText class="size-4 shrink-0 text-accent" />
      <div class="min-w-0">
        <h1 class="truncate text-sm font-semibold text-foreground">Continuous manuscript</h1>
        <p class="font-mono text-[10px] text-muted-foreground">
          {ordered.length} chapters · {totalWords.toLocaleString()} words
        </p>
      </div>
    </div>

    <div class="ml-auto flex items-center gap-1">
      <label class="sr-only" for="continuous-status-filter">Chapter status</label>
      <select
        id="continuous-status-filter"
        value={statusFilter}
        onchange={(event) => {
          statusFilter = event.currentTarget.value as typeof statusFilter;
          storyUi.setContinuousStatus(statusFilter);
        }}
        class="h-8 rounded border border-border bg-input/60 px-2 text-[11px] text-foreground outline-none focus-visible:border-accent focus-visible:ring-2 focus-visible:ring-accent/30"
      >
        <option value="all">All chapters</option>
        <option value="draft">Draft</option>
        <option value="in-progress">Writing</option>
        <option value="review">Review</option>
        <option value="final">Final</option>
      </select>
      <div class="flex rounded border border-border bg-input/50 p-0.5" aria-label="Manuscript mode">
        <button
          type="button"
          aria-pressed={mode === 'write'}
          onclick={() => { mode = 'write'; storyUi.setContinuousMode('write'); }}
          class={cn(
            'inline-flex h-7 items-center gap-1 rounded-sm px-2 text-[11px] outline-none transition-colors focus-visible:ring-2 focus-visible:ring-accent',
            mode === 'write' ? 'bg-accent text-accent-foreground' : 'text-muted-foreground hover:text-foreground'
          )}
        >
          <PencilLine class="size-3" /> Write
        </button>
        <button
          type="button"
          aria-pressed={mode === 'read'}
          onclick={() => { mode = 'read'; storyUi.setContinuousMode('read'); }}
          class={cn(
            'inline-flex h-7 items-center gap-1 rounded-sm px-2 text-[11px] outline-none transition-colors focus-visible:ring-2 focus-visible:ring-accent',
            mode === 'read' ? 'bg-accent text-accent-foreground' : 'text-muted-foreground hover:text-foreground'
          )}
        >
          <Eye class="size-3" /> Read
        </button>
        <button type="button" aria-pressed={mode === 'source'} onclick={() => { mode = 'source'; storyUi.setContinuousMode('source'); }} class={cn('inline-flex h-7 items-center gap-1 rounded-sm px-2 text-[11px] outline-none transition-colors focus-visible:ring-2 focus-visible:ring-accent', mode === 'source' ? 'bg-accent text-accent-foreground' : 'text-muted-foreground hover:text-foreground')}><Braces class="size-3" /> Source</button>
      </div>
      <button type="button" aria-pressed={researchOpen} onclick={() => (researchOpen = !researchOpen)} class={cn('inline-flex h-8 items-center gap-1 rounded border border-border px-2 text-[10px] outline-none focus-visible:ring-2 focus-visible:ring-accent', researchOpen ? 'border-accent text-accent' : 'text-muted-foreground hover:text-foreground')}><StickyNote class="size-3" />Research</button>
    </div>
  </header>

  <div class="flex min-h-0 flex-1">
  <div class={cn('min-h-0 min-w-0 flex-1 overflow-y-auto scroll-smooth bg-[linear-gradient(to_right,transparent_0,transparent_calc(50%-1px),color-mix(in_oklch,var(--border)_36%,transparent)_50%,transparent_calc(50%+1px))]', researchOpen && 'hidden lg:block')}>
    {#if ordered.length === 0}
      <div class="mx-auto flex max-w-xl flex-col items-center px-6 py-24 text-center">
        <FileText class="size-8 text-muted-foreground/50" />
        <p class="mt-3 text-sm text-foreground">No chapters match this view.</p>
        <p class="mt-1 text-xs text-muted-foreground">Change the chapter-status filter to continue reading.</p>
      </div>
    {:else}
      <div class="mx-auto w-full max-w-[54rem] px-3 py-8 sm:px-8 sm:py-12">
        {#each ordered as row, index (row.chapter.id)}
          {@const newAct = index === 0 || ordered[index - 1].actId !== row.actId}
          {#if newAct}
            <div class="mb-9 mt-4 flex items-center gap-3 first:mt-0" aria-label={row.actTitle}>
              <span class="h-px flex-1 bg-border"></span>
              <span class="font-mono text-[10px] font-semibold uppercase tracking-[0.2em] text-accent">{row.actTitle}</span>
              <span class="h-px flex-1 bg-border"></span>
            </div>
          {/if}

          <article class="group relative mb-14" aria-labelledby={`continuous-title-${row.chapter.id}`}>
            <div class="mb-5 flex items-start gap-4">
              <span class="mt-1 font-mono text-[10px] text-muted-foreground">
                {row.chapter.number === 0 ? 'PRO' : row.chapter.number.toString().padStart(2, '0')}
              </span>
              <div class="min-w-0 flex-1">
                <h2 id={`continuous-title-${row.chapter.id}`} class="font-serif text-xl font-semibold tracking-tight text-foreground sm:text-2xl">
                  {row.chapter.title}
                </h2>
                {#if row.chapter.summary}
                  <p class="mt-1 text-xs italic leading-relaxed text-muted-foreground">{row.chapter.summary}</p>
                {/if}
              </div>
              <button
                type="button"
                onclick={() => openSource(row.chapter)}
                class="inline-flex h-8 shrink-0 items-center gap-1 rounded border border-border px-2 text-[10px] text-muted-foreground opacity-80 outline-none transition-colors hover:border-accent/50 hover:text-foreground focus-visible:ring-2 focus-visible:ring-accent sm:opacity-0 sm:group-hover:opacity-100 sm:group-focus-within:opacity-100"
                title="Open Markdown source"
              >
                <Braces class="size-3" /> Source
              </button>
            </div>

            {#if mode === 'write' || mode === 'source'}
              <label class="sr-only" for={`continuous-body-${row.chapter.id}`}>{row.chapter.title} manuscript</label>
              <textarea
                id={`continuous-body-${row.chapter.id}`}
                value={mode === 'source' ? row.chapter.content : readingContent(row.chapter.content)}
                rows={textareaRows(mode === 'source' ? row.chapter.content : readingContent(row.chapter.content))}
                oninput={(event) => mode === 'source' ? manuscript.updateChapterContent(row.chapter.id, event.currentTarget.value) : updateContinuousContent(row.chapter.id, row.chapter.content, event.currentTarget.value)}
                spellcheck={mode === 'write'}
                class={cn('block w-full resize-y border-0 bg-transparent px-0 text-foreground/95 outline-none placeholder:text-muted-foreground focus-visible:ring-0', mode === 'source' ? 'font-mono text-[12px] leading-relaxed' : 'font-serif text-[17px] leading-[1.85] sm:text-[18px]')}
                placeholder="Begin this chapter…"
              ></textarea>
            {:else}
              <div class="continuous-prose min-h-40 font-serif text-[17px] leading-[1.85] text-foreground/95 sm:text-[18px]">
                <MarkdownPreview content={readingContent(row.chapter.content)} />
              </div>
            {/if}

            {#if index < ordered.length - 1}
              <div class="mt-12 flex items-center justify-center gap-2 text-accent/60" aria-hidden="true">
                <span class="size-1 rotate-45 border border-current"></span>
                <span class="size-1 rotate-45 border border-current"></span>
                <span class="size-1 rotate-45 border border-current"></span>
              </div>
            {/if}
          </article>
        {/each}
      </div>
    {/if}
  </div>
  {#if researchOpen}<aside class="flex min-h-0 w-full shrink-0 flex-col border-l border-border bg-sidebar lg:w-[22rem]" aria-label="Research beside manuscript"><div class="border-b border-border p-2"><label><span class="mb-1 block text-[9px] uppercase text-muted-foreground">Research document</span><select bind:value={selectedResearchId} class="h-8 w-full rounded border border-border bg-input/50 px-2 text-[10px] text-foreground"><option value="">Choose document</option>{#each researchDocs as doc (doc.id)}<option value={doc.id}>{doc.title}</option>{/each}</select></label></div>{#if selectedResearch}<article class="min-h-0 flex-1 overflow-y-auto p-4"><h2 class="font-serif text-lg font-semibold text-foreground">{selectedResearch.title}</h2><pre class="mt-3 whitespace-pre-wrap font-serif text-[13px] leading-relaxed text-foreground/80">{selectedResearch.content}</pre></article>{:else}<div class="p-5 text-center text-[11px] text-muted-foreground">Add a note, brainstorm, or reference document to read beside the manuscript.</div>{/if}</aside>{/if}
  </div>
</section>

<style>
  :global(.continuous-prose .prose) {
    max-width: none;
    font: inherit;
    color: inherit;
  }

  @media (prefers-reduced-motion: reduce) {
    .scroll-smooth {
      scroll-behavior: auto;
    }
  }
</style>
