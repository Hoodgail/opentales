<script lang="ts">
  import { Inbox, Plus, RefreshCw } from 'lucide-svelte';
  import { onMount } from 'svelte';
  import type { SubmissionStatus, SubmissionSummary } from '@opentales/sdk';
  import { manuscript } from '$lib/stores/manuscript.svelte';
  import { cn } from '$lib/utils';
  import PanelHeader from './PanelHeader.svelte';

  type Filter = 'open' | 'merged' | 'declined' | 'all';

  let filter = $state<Filter>('open');
  let composeOpen = $state(false);
  let composeKind = $state<'chapter-edit' | 'new-chapter'>('chapter-edit');
  let composeChapterId = $state<string | null>(null);
  let composeTitle = $state('');
  let composeMessage = $state('');
  let composeBody = $state('');
  let composeProposedTitle = $state('');

  onMount(() => {
    void manuscript.loadSubmissions();
  });

  function filtered(): SubmissionSummary[] {
    if (filter === 'all') return manuscript.submissions;
    return manuscript.submissions.filter((s) => s.status === filter);
  }

  function statusDot(status: SubmissionStatus): string {
    if (status === 'open') return 'bg-amber-400';
    if (status === 'merged') return 'bg-emerald-500';
    return 'bg-muted-foreground';
  }

  function relTime(iso: string): string {
    const d = new Date(iso).getTime();
    const diff = Date.now() - d;
    const m = Math.floor(diff / 60000);
    if (m < 1) return 'just now';
    if (m < 60) return `${m}m`;
    const h = Math.floor(m / 60);
    if (h < 24) return `${h}h`;
    return `${Math.floor(h / 24)}d`;
  }

  function openSubmission(id: string) {
    const s = manuscript.submissions.find((x) => x.id === id);
    void manuscript.openTab({
      id: `submission-${id}`,
      type: 'submission',
      refId: id,
      title: s ? `Draft: ${s.title}` : 'Draft'
    });
  }

  async function startCompose(kind: 'chapter-edit' | 'new-chapter') {
    composeKind = kind;
    composeOpen = true;
    composeTitle = '';
    composeMessage = '';
    composeProposedTitle = '';
    if (kind === 'chapter-edit') {
      const first = manuscript.chapters[0];
      composeChapterId = first?.id ?? null;
      composeBody = first?.content ?? '';
    } else {
      composeChapterId = null;
      composeBody = '# New chapter\n\n';
    }
  }

  async function submitDraft(e: Event) {
    e.preventDefault();
    const title = composeTitle.trim();
    if (!title) return;
    if (composeKind === 'chapter-edit' && !composeChapterId) return;
    if (composeKind === 'new-chapter' && !composeProposedTitle.trim()) return;
    await manuscript.submitDraft({
      kind: composeKind,
      title,
      message: composeMessage || undefined,
      chapterId: composeKind === 'chapter-edit' ? composeChapterId! : undefined,
      proposedTitle: composeKind === 'new-chapter' ? composeProposedTitle.trim() : undefined,
      body: composeBody
    });
    composeOpen = false;
  }

  function authorLabel(s: SubmissionSummary): string {
    return s.author.name ?? s.author.username;
  }
</script>

<div class="flex h-full flex-col">
  <PanelHeader title="Drafts inbox" />
  <div class="flex items-center gap-1 border-b border-border px-3 py-2 text-xs">
    {#each ['open', 'merged', 'declined', 'all'] as f (f)}
      <button
        type="button"
        onclick={() => (filter = f as Filter)}
        class={cn(
          'rounded-md px-2 py-1 text-[10px] uppercase tracking-wider',
          filter === f
            ? 'bg-accent text-accent-foreground'
            : 'text-muted-foreground hover:bg-muted'
        )}
      >
        {f}
      </button>
    {/each}
    <button
      type="button"
      onclick={() => void manuscript.loadSubmissions(true)}
      title="Refresh"
      class="ml-auto rounded-md p-1 text-muted-foreground hover:bg-muted"
    >
      <RefreshCw class="size-3.5" />
    </button>
  </div>

  <div class="flex flex-col gap-1 border-b border-border px-3 py-2 text-xs">
    {#if !composeOpen}
      <div class="flex gap-1.5">
        <button
          type="button"
          onclick={() => void startCompose('chapter-edit')}
          class="flex-1 rounded-md border border-border px-2 py-1 text-[11px] hover:bg-muted"
        >
          <Plus class="mr-1 inline size-3" /> Edit a chapter
        </button>
        <button
          type="button"
          onclick={() => void startCompose('new-chapter')}
          class="flex-1 rounded-md border border-border px-2 py-1 text-[11px] hover:bg-muted"
        >
          <Plus class="mr-1 inline size-3" /> New chapter
        </button>
      </div>
    {:else}
      <form onsubmit={submitDraft} class="space-y-2">
        <div class="text-[10px] uppercase tracking-wider text-muted-foreground">
          {composeKind === 'chapter-edit' ? 'Edit a chapter' : 'New chapter'}
        </div>
        {#if composeKind === 'chapter-edit'}
          <select
            bind:value={composeChapterId}
            class="w-full rounded border border-border bg-background px-2 py-1 text-xs"
          >
            {#each manuscript.chapters as chapter (chapter.id)}
              <option value={chapter.id}
                >{chapter.number === 0 ? 'Prologue' : `Ch. ${chapter.number}`}: {chapter.title}</option
              >
            {/each}
          </select>
        {:else}
          <input
            bind:value={composeProposedTitle}
            placeholder="Chapter title"
            class="w-full rounded border border-border bg-background px-2 py-1 text-xs"
          />
        {/if}
        <input
          bind:value={composeTitle}
          placeholder="Submission title"
          class="w-full rounded border border-border bg-background px-2 py-1 text-xs"
        />
        <textarea
          bind:value={composeMessage}
          placeholder="Optional message…"
          rows={2}
          class="w-full resize-none rounded border border-border bg-background px-2 py-1 text-xs"
        ></textarea>
        <textarea
          bind:value={composeBody}
          placeholder="Proposed body…"
          rows={6}
          class="w-full resize-y rounded border border-border bg-background px-2 py-1 font-mono text-[11px] leading-relaxed"
        ></textarea>
        <div class="flex justify-end gap-1.5">
          <button
            type="button"
            onclick={() => (composeOpen = false)}
            class="rounded-md border border-border px-2 py-1 text-[11px] text-muted-foreground hover:bg-muted"
          >
            Cancel
          </button>
          <button
            type="submit"
            class="rounded-md bg-accent px-2 py-1 text-[11px] text-accent-foreground hover:opacity-90"
          >
            Submit draft
          </button>
        </div>
      </form>
    {/if}
  </div>

  <div class="flex-1 overflow-y-auto">
    {#if manuscript.submissions.length === 0 && !manuscript.submissionsLoading}
      <div class="flex h-full flex-col items-center justify-center gap-2 text-xs text-muted-foreground">
        <Inbox class="size-8 opacity-40" />
        <p>No submissions yet.</p>
      </div>
    {:else}
      <ul class="divide-y divide-border">
        {#each filtered() as s (s.id)}
          <li>
            <button
              type="button"
              onclick={() => openSubmission(s.id)}
              class="flex w-full flex-col gap-1 px-3 py-2 text-left text-xs hover:bg-muted/50"
            >
              <div class="flex items-center gap-2">
                <span class={cn('size-1.5 rounded-full', statusDot(s.status))}></span>
                <span class="truncate font-medium text-foreground">{s.title}</span>
                <span class="ml-auto shrink-0 text-[10px] text-muted-foreground">
                  {relTime(s.createdAt)}
                </span>
              </div>
              <div class="flex items-center gap-1.5 text-[10px] text-muted-foreground">
                <span class="font-medium">{authorLabel(s)}</span>
                <span>·</span>
                <span class="uppercase tracking-wider">{s.kind === 'chapter-edit' ? 'edit' : 'new'}</span>
                {#if s.chapterTitle}
                  <span>·</span>
                  <span class="truncate">{s.chapterTitle}</span>
                {/if}
              </div>
            </button>
          </li>
        {/each}
      </ul>
    {/if}
  </div>
</div>
