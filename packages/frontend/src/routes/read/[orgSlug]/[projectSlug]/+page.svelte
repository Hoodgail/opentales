<script lang="ts">
  import type { PageData } from './$types';

  interface Props {
    data: PageData;
  }

  let { data }: Props = $props();
  const project = $derived(data.project);

  let activeChapterId = $state<string | null>(null);

  $effect(() => {
    if (!activeChapterId && project.chapters[0]) {
      activeChapterId = project.chapters[0].id;
    }
  });

  const activeChapter = $derived(
    project.chapters.find((c) => c.id === activeChapterId) ?? project.chapters[0] ?? null
  );
</script>

<svelte:head>
  <title>{project.title} — {project.orgName}</title>
  <meta name="description" content={project.description} />
  <meta property="og:title" content={project.title} />
  <meta property="og:description" content={project.description} />
  {#if project.coverUrl}<meta property="og:image" content={project.coverUrl} />{/if}
</svelte:head>

<div class="min-h-screen bg-background text-foreground">
  <header class="border-b border-border bg-sidebar">
    <div class="mx-auto flex max-w-5xl flex-col gap-6 px-6 py-10 md:flex-row md:items-end">
      {#if project.coverUrl}
        <div
          class={(project.coverOrientation === 'portrait'
            ? 'aspect-[2/3] w-40 '
            : 'aspect-[16/9] w-full max-w-md ') +
            'shrink-0 overflow-hidden rounded-md border border-border bg-muted'}
        >
          <img src={project.coverUrl} alt="" class="size-full object-cover" />
        </div>
      {/if}
      <div class="min-w-0 flex-1">
        <p class="text-xs uppercase tracking-[0.18em] text-muted-foreground">{project.orgName}</p>
        <h1 class="mt-1 text-3xl font-semibold leading-tight md:text-4xl">{project.title}</h1>
        {#if project.genre}
          <p class="mt-1 text-sm text-muted-foreground">{project.genre}</p>
        {/if}
        {#if project.description}
          <p class="mt-3 max-w-2xl text-sm leading-relaxed text-foreground/80">{project.description}</p>
        {/if}
      </div>
    </div>
  </header>

  <main class="mx-auto grid max-w-5xl gap-8 px-6 py-10 md:grid-cols-[16rem_1fr]">
    <aside>
      <h2 class="mb-3 text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
        Chapters
      </h2>
      {#if project.chapters.length === 0}
        <p class="text-sm text-muted-foreground">No chapters published yet.</p>
      {:else}
        <ol class="space-y-1 text-sm">
          {#each project.chapters as chapter (chapter.id)}
            <li>
              <button
                type="button"
                onclick={() => (activeChapterId = chapter.id)}
                class={(activeChapterId === chapter.id
                  ? 'bg-muted text-foreground '
                  : 'text-muted-foreground hover:bg-muted/50 hover:text-foreground ') +
                  'block w-full rounded-md px-3 py-2 text-left transition-colors'}
              >
                <div class="text-[10px] uppercase tracking-wider">
                  {chapter.number === 0 ? 'Prologue' : `Chapter ${chapter.number}`}
                </div>
                <div class="truncate font-medium">{chapter.title}</div>
              </button>
            </li>
          {/each}
        </ol>
      {/if}
    </aside>

    <article class="prose prose-invert max-w-none">
      {#if activeChapter}
        <header class="mb-6 border-b border-border pb-4">
          <p class="text-xs uppercase tracking-[0.18em] text-muted-foreground">
            {activeChapter.number === 0 ? 'Prologue' : `Chapter ${activeChapter.number}`}
            {#if activeChapter.publishedAt}
              · Published {new Date(activeChapter.publishedAt).toLocaleDateString()}
            {/if}
          </p>
          <h2 class="mt-1 text-2xl font-semibold">{activeChapter.title}</h2>
        </header>
        <div class="whitespace-pre-wrap font-serif text-base leading-7 text-foreground/90">{activeChapter.content}</div>
      {:else}
        <p class="text-sm text-muted-foreground">Nothing to read yet.</p>
      {/if}
    </article>
  </main>
</div>
