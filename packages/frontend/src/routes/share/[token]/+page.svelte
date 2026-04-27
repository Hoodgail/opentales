<script lang="ts">
  import { MessageSquare } from 'lucide-svelte';
  import { OpenTalesClient, type BetaShareView } from '@opentales/sdk';
  import type { PageData } from './$types';

  interface Props {
    data: PageData;
  }

  let { data }: Props = $props();
  let viewOverride = $state<BetaShareView | null>(null);
  let view = $derived<BetaShareView>(viewOverride ?? data.view);
  let activeChapterId = $state<string | null>(null);

  const api = new OpenTalesClient({
    baseUrl: import.meta.env.VITE_API_URL ?? 'http://localhost:4000'
  });

  let visitorName = $state('');
  let commentBody = $state('');
  let posting = $state(false);
  let postError = $state<string | null>(null);

  $effect(() => {
    if (!activeChapterId && view.chapters[0]) {
      activeChapterId = view.chapters[0].id;
    }
  });

  let activeChapter = $derived(
    view.chapters.find((c) => c.id === activeChapterId) ?? view.chapters[0] ?? null
  );

  let chapterComments = $derived.by(() => {
    if (!activeChapter) return [];
    return view.comments.filter((c) => c.chapterId === activeChapter.id);
  });

  let generalComments = $derived(view.comments.filter((c) => c.chapterId === null));

  async function postComment(e: Event) {
    e.preventDefault();
    if (!view.allowComments || posting) return;
    const name = visitorName.trim();
    const body = commentBody.trim();
    if (!name || !body) return;
    posting = true;
    postError = null;
    try {
      viewOverride = await api.postBetaShareComment(data.token, {
        visitorName: name,
        body,
        chapterId: activeChapter?.id ?? null
      });
      commentBody = '';
    } catch (err) {
      postError = err instanceof Error ? err.message : 'Failed to post comment';
    } finally {
      posting = false;
    }
  }
</script>

<svelte:head>
  <title>{view.projectTitle} — beta read</title>
  <meta name="robots" content="noindex" />
</svelte:head>

<div class="min-h-screen bg-background text-foreground">
  <header class="border-b border-border bg-sidebar">
    <div class="mx-auto flex max-w-5xl flex-col gap-2 px-6 py-8">
      <p class="text-xs uppercase tracking-[0.18em] text-muted-foreground">
        Beta read{view.shareLabel ? ` · ${view.shareLabel}` : ''}
      </p>
      <h1 class="text-3xl font-semibold leading-tight md:text-4xl">{view.projectTitle}</h1>
      {#if view.projectDescription}
        <p class="max-w-2xl text-sm leading-relaxed text-foreground/80">{view.projectDescription}</p>
      {/if}
      {#if view.expiresAt}
        <p class="text-[11px] text-muted-foreground">
          This link expires on {new Date(view.expiresAt).toLocaleDateString()}.
        </p>
      {/if}
    </div>
  </header>

  <main class="mx-auto grid max-w-5xl gap-8 px-6 py-8 md:grid-cols-[16rem_1fr]">
    <aside>
      <h2 class="mb-3 text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
        Chapters
      </h2>
      {#if view.chapters.length === 0}
        <p class="text-sm text-muted-foreground">Nothing shared yet.</p>
      {:else}
        <ol class="space-y-1 text-sm">
          {#each view.chapters as chapter (chapter.id)}
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

    <article class="space-y-8">
      {#if activeChapter}
        <header class="border-b border-border pb-4">
          <p class="text-xs uppercase tracking-[0.18em] text-muted-foreground">
            {activeChapter.number === 0 ? 'Prologue' : `Chapter ${activeChapter.number}`}
          </p>
          <h2 class="mt-1 text-2xl font-semibold">{activeChapter.title}</h2>
        </header>
        <div
          class="whitespace-pre-wrap font-serif text-base leading-7 text-foreground/90"
        >{activeChapter.content}</div>
      {:else}
        <p class="text-sm text-muted-foreground">Nothing shared in this link yet.</p>
      {/if}

      {#if chapterComments.length > 0}
        <section class="rounded-md border border-border bg-card/30 p-4">
          <h3 class="mb-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Comments on this chapter
          </h3>
          <ul class="space-y-3 text-sm">
            {#each chapterComments as c (c.id)}
              <li>
                <div class="flex items-baseline gap-2">
                  <span class="font-medium text-foreground">{c.visitorName}</span>
                  <span class="text-[10px] text-muted-foreground">
                    {new Date(c.createdAt).toLocaleString()}
                  </span>
                </div>
                <p class="mt-0.5 whitespace-pre-wrap text-foreground/90">{c.body}</p>
              </li>
            {/each}
          </ul>
        </section>
      {/if}

      {#if view.allowComments}
        <section class="rounded-md border border-border bg-card/30 p-4">
          <h3 class="mb-3 inline-flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            <MessageSquare class="size-3" /> Leave feedback
          </h3>
          <form onsubmit={postComment} class="space-y-2 text-sm">
            <input
              type="text"
              bind:value={visitorName}
              placeholder="Your name"
              required
              class="w-full rounded-md border border-border bg-background px-2 py-1.5 outline-none focus:border-accent"
            />
            <textarea
              bind:value={commentBody}
              placeholder={activeChapter
                ? `Thoughts on "${activeChapter.title}"…`
                : 'Your feedback…'}
              rows="3"
              required
              class="w-full rounded-md border border-border bg-background px-2 py-1.5 outline-none focus:border-accent"
            ></textarea>
            {#if postError}
              <p class="text-xs text-destructive">{postError}</p>
            {/if}
            <button
              type="submit"
              disabled={posting || !visitorName.trim() || !commentBody.trim()}
              class="rounded-md bg-accent px-3 py-1.5 text-xs font-medium text-accent-foreground hover:bg-accent/90 disabled:opacity-60"
            >
              {posting ? 'Posting…' : 'Post comment'}
            </button>
          </form>
        </section>
      {/if}

      {#if generalComments.length > 0}
        <section class="rounded-md border border-border bg-card/30 p-4">
          <h3 class="mb-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            General feedback
          </h3>
          <ul class="space-y-3 text-sm">
            {#each generalComments as c (c.id)}
              <li>
                <div class="flex items-baseline gap-2">
                  <span class="font-medium text-foreground">{c.visitorName}</span>
                  <span class="text-[10px] text-muted-foreground">
                    {new Date(c.createdAt).toLocaleString()}
                  </span>
                </div>
                <p class="mt-0.5 whitespace-pre-wrap text-foreground/90">{c.body}</p>
              </li>
            {/each}
          </ul>
        </section>
      {/if}
    </article>
  </main>
</div>
