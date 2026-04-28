<script lang="ts">
  import { Check, Loader2, MapPin, MessageSquarePlus, Sparkles, X } from 'lucide-svelte';
  import type { SubmissionCommentAnchor, SubmissionDetail } from '@opentales/sdk';
  import { ai } from '$lib/stores/ai.svelte';
  import { manuscript } from '$lib/stores/manuscript.svelte';
  import { cn } from '$lib/utils';
  import MonacoDiffViewer from './MonacoDiffViewer.svelte';

  interface Props {
    submissionId: string;
  }

  let { submissionId }: Props = $props();

  let detail = $state<SubmissionDetail | null>(null);
  let loading = $state(true);
  let actioning = $state(false);
  let commentBody = $state('');
  let commentBusy = $state(false);
  let pendingAnchor = $state<SubmissionCommentAnchor | null>(null);
  let pinAnchor = $state(false);
  let reviewRunning = $state(false);

  $effect(() => {
    void load(submissionId);
  });

  async function load(id: string) {
    loading = true;
    const cached = manuscript.submissionDetails[id];
    if (cached) detail = cached;
    const fresh = await manuscript.loadSubmission(id);
    if (fresh) detail = fresh;
    loading = false;
  }

  function canDecide(): boolean {
    const role = manuscript.currentUserRole;
    return role === 'OWNER' || role === 'ADMIN' || role === 'EDITOR';
  }

  async function merge() {
    if (!detail || actioning) return;
    actioning = true;
    const next = await manuscript.mergeSubmission(detail.id);
    if (next) detail = next;
    actioning = false;
  }

  async function decline() {
    if (!detail || actioning) return;
    actioning = true;
    const next = await manuscript.declineSubmission(detail.id);
    if (next) detail = next;
    actioning = false;
  }

  async function runContinuityReview() {
    if (!detail || !manuscript.projectId || reviewRunning) return;
    reviewRunning = true;
    await ai.runContinuityReview(manuscript.projectId, detail.id);
    // Refresh submission to pick up the new AI_REVIEW_POSTED activity
    const fresh = await manuscript.loadSubmission(detail.id);
    if (fresh) detail = fresh;
    reviewRunning = false;
  }

  async function postComment(e: Event) {
    e.preventDefault();
    if (!detail) return;
    const body = commentBody.trim();
    if (!body || commentBusy) return;
    commentBusy = true;
    const anchor = pendingAnchor ?? undefined;
    const next = await manuscript.commentOnSubmission(detail.id, body, anchor);
    if (next) detail = next;
    commentBody = '';
    if (!pinAnchor) pendingAnchor = null;
    commentBusy = false;
  }

  function formatActivity(type: SubmissionDetail['activities'][number]['type']): string {
    switch (type) {
      case 'submission-opened':
        return 'opened this submission';
      case 'submission-merged':
        return 'merged this submission';
      case 'submission-declined':
        return 'declined this submission';
      case 'comment-added':
        return '';
      case 'ai-review-posted':
        return 'posted an AI review';
    }
  }

  type AnchoredActivity = {
    activity: SubmissionDetail['activities'][number];
    body: string;
    anchor: SubmissionCommentAnchor;
  };

  function readAnchor(content: unknown): SubmissionCommentAnchor | null {
    if (!content || typeof content !== 'object') return null;
    const a = (content as { anchor?: unknown }).anchor;
    if (!a || typeof a !== 'object') return null;
    const anchor = a as Partial<SubmissionCommentAnchor>;
    if (
      typeof anchor.lineStart !== 'number' ||
      typeof anchor.lineEnd !== 'number' ||
      (anchor.side !== 'base' && anchor.side !== 'head')
    ) {
      return null;
    }
    return {
      lineStart: anchor.lineStart,
      lineEnd: anchor.lineEnd,
      side: anchor.side
    };
  }

  let anchoredComments = $derived.by(() => {
    if (!detail) return [] as AnchoredActivity[];
    const out: AnchoredActivity[] = [];
    for (const a of detail.activities) {
      if (a.type !== 'comment-added' || !a.content) continue;
      const body = (a.content as { body?: unknown }).body;
      const anchor = readAnchor(a.content);
      if (typeof body === 'string' && anchor) {
        out.push({ activity: a, body, anchor });
      }
    }
    out.sort(
      (l, r) =>
        (l.anchor.side === 'base' ? 0 : 1) - (r.anchor.side === 'base' ? 0 : 1) ||
        l.anchor.lineStart - r.anchor.lineStart
    );
    return out;
  });

  let timelineActivities = $derived(
    detail
      ? detail.activities.filter((a) => {
          if (a.type !== 'comment-added' || !a.content) return true;
          return readAnchor(a.content) === null;
        })
      : []
  );

  function describeAnchor(a: SubmissionCommentAnchor): string {
    const span = a.lineStart === a.lineEnd ? `L${a.lineStart}` : `L${a.lineStart}–${a.lineEnd}`;
    return `${a.side === 'base' ? 'Base' : 'Proposed'} · ${span}`;
  }
</script>

{#if loading && !detail}
  <div class="flex h-full items-center justify-center text-xs text-muted-foreground">Loading…</div>
{:else if !detail}
  <div class="flex h-full items-center justify-center text-xs text-muted-foreground">
    Submission not found
  </div>
{:else}
  <div class="flex h-full flex-col bg-background">
    <header class="flex flex-col gap-2 border-b border-border px-4 py-3">
      <div class="flex items-start gap-3">
        <div class="min-w-0 flex-1">
          <div class="flex items-center gap-2">
            <span
              class={cn(
                'rounded-full px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider',
                detail.status === 'open'
                  ? 'bg-amber-500/20 text-amber-400'
                  : detail.status === 'merged'
                    ? 'bg-emerald-500/20 text-emerald-400'
                    : 'bg-muted text-muted-foreground'
              )}
            >
              {detail.status}
            </span>
            <span class="text-[10px] uppercase tracking-wider text-muted-foreground">
              {detail.kind === 'chapter-edit' ? 'Edit' : 'New chapter'}
            </span>
            {#if detail.chapterTitle}
              <span class="text-[10px] text-muted-foreground">· {detail.chapterTitle}</span>
            {/if}
          </div>
          <h1 class="mt-1 truncate font-serif text-lg text-foreground">{detail.title}</h1>
          <p class="text-[11px] text-muted-foreground">
            by {detail.author.name ?? detail.author.username} · {new Date(detail.createdAt).toLocaleString()}
          </p>
        </div>
        <div class="flex shrink-0 gap-1.5">
          {#if ai.settings?.enabled && detail.status === 'open'}
            <button
              type="button"
              disabled={reviewRunning}
              onclick={runContinuityReview}
              class="inline-flex items-center gap-1 rounded-md border border-accent/40 px-2.5 py-1 text-xs text-accent hover:bg-accent/10 disabled:opacity-50"
            >
              {#if reviewRunning}
                <Loader2 class="size-3.5 animate-spin" />
              {:else}
                <Sparkles class="size-3.5" />
              {/if}
              Continuity Review
            </button>
          {/if}
          {#if detail.status === 'open' && canDecide()}
            <button
              type="button"
              disabled={actioning}
              onclick={decline}
              class="inline-flex items-center gap-1 rounded-md border border-border px-2.5 py-1 text-xs text-muted-foreground hover:bg-muted disabled:opacity-50"
            >
              <X class="size-3.5" /> Decline
            </button>
            <button
              type="button"
              disabled={actioning}
              onclick={merge}
              class="inline-flex items-center gap-1 rounded-md bg-emerald-600 px-2.5 py-1 text-xs text-white hover:bg-emerald-500 disabled:opacity-50"
            >
              <Check class="size-3.5" /> Merge
            </button>
          {/if}
        </div>
      </div>
      {#if detail.message}
        <p class="text-xs text-muted-foreground">{detail.message}</p>
      {/if}

      <!-- Continuity review results -->
      {#if ai.continuityResult}
        <div class="rounded-md border border-accent/20 bg-accent/5 p-3">
          <p class="mb-1.5 text-[10px] font-medium uppercase tracking-wider text-accent">
            Continuity Review
          </p>
          <p class="text-xs text-foreground/90">{ai.continuityResult.summary}</p>
          {#if ai.continuityResult.issues.length > 0}
            <ul class="mt-2 space-y-1.5">
              {#each ai.continuityResult.issues as issue}
                <li class="rounded border border-border bg-background/40 p-2 text-[11px]">
                  <div class="flex items-center gap-1.5">
                    <span
                      class={cn(
                        'rounded px-1 py-0.5 text-[9px] uppercase font-medium',
                        issue.severity === 'error'
                          ? 'bg-destructive/20 text-destructive'
                          : issue.severity === 'warning'
                            ? 'bg-amber-500/20 text-amber-400'
                            : 'bg-muted text-muted-foreground'
                      )}
                    >
                      {issue.severity}
                    </span>
                    <span class="font-medium text-foreground">{issue.title}</span>
                  </div>
                  {#if issue.evidence}
                    <p class="mt-1 text-muted-foreground">Evidence: {issue.evidence}</p>
                  {/if}
                  {#if issue.suggestion}
                    <p class="mt-0.5 text-accent/80">Suggestion: {issue.suggestion}</p>
                  {/if}
                </li>
              {/each}
            </ul>
          {/if}
        </div>
      {/if}

      {#if ai.featureError}
        <p class="text-[11px] text-destructive">{ai.featureError}</p>
      {/if}
    </header>

    <div class="min-h-0 flex-1">
      <MonacoDiffViewer
        original={detail.baseBody}
        modified={detail.headBody}
        onSelectionChange={(s) => {
          if (s) pendingAnchor = s;
          else if (!pinAnchor) pendingAnchor = null;
        }}
      />
    </div>

    <section class="max-h-[45%] overflow-y-auto border-t border-border bg-card/30 px-4 py-3">
      {#if anchoredComments.length > 0}
        <h3 class="mb-2 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
          Inline notes
        </h3>
        <ul class="mb-3 space-y-2">
          {#each anchoredComments as item (item.activity.id)}
            <li class="rounded-md border border-border bg-background/40 px-2 py-1.5 text-xs">
              <div class="flex items-baseline gap-2">
                <MapPin class="size-3 text-muted-foreground" />
                <span class="font-mono text-[10px] text-muted-foreground">
                  {describeAnchor(item.anchor)}
                </span>
                <span class="ml-auto text-[10px] text-muted-foreground">
                  {item.activity.author?.name ?? item.activity.author?.username ?? 'system'}
                </span>
              </div>
              <p class="mt-1 whitespace-pre-wrap text-foreground/90">{item.body}</p>
            </li>
          {/each}
        </ul>
      {/if}

      <h3 class="mb-2 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
        Activity
      </h3>
      <ul class="space-y-2 text-xs">
        {#each timelineActivities as a (a.id)}
          <li class="flex gap-2">
            <span class="mt-1 size-1.5 shrink-0 rounded-full bg-muted-foreground"></span>
            <div class="min-w-0 flex-1">
              <div class="flex items-baseline gap-1.5">
                <span class="font-medium text-foreground">
                  {a.author?.name ?? a.author?.username ?? 'system'}
                </span>
                <span class="text-[10px] text-muted-foreground">{new Date(a.createdAt).toLocaleString()}</span>
              </div>
              {#if a.type === 'comment-added' && a.content && typeof (a.content as { body?: unknown }).body === 'string'}
                <p class="mt-0.5 whitespace-pre-wrap text-foreground/90">
                  {(a.content as { body: string }).body}
                </p>
              {:else}
                <p class="text-muted-foreground">{formatActivity(a.type)}</p>
              {/if}
            </div>
          </li>
        {/each}
      </ul>

      <form onsubmit={postComment} class="mt-3 space-y-1.5">
        {#if pendingAnchor}
          <div class="flex items-center gap-2 rounded-md border border-accent/40 bg-accent/10 px-2 py-1 text-[11px] text-accent">
            <MapPin class="size-3" />
            <span class="font-mono">{describeAnchor(pendingAnchor)}</span>
            <label class="ml-auto flex items-center gap-1 text-[10px] text-muted-foreground">
              <input type="checkbox" bind:checked={pinAnchor} class="accent-accent" />
              Pin
            </label>
            <button
              type="button"
              onclick={() => {
                pendingAnchor = null;
                pinAnchor = false;
              }}
              class="rounded p-0.5 text-muted-foreground hover:bg-muted"
              title="Clear anchor"
            >
              <X class="size-3" />
            </button>
          </div>
        {:else}
          <p class="text-[10px] text-muted-foreground">
            Tip — select lines in the diff to attach this comment to a specific range.
          </p>
        {/if}
        <div class="flex gap-1.5">
          <input
            bind:value={commentBody}
            placeholder={pendingAnchor ? 'Comment on selected lines…' : 'Add a comment…'}
            class="flex-1 rounded-md border border-border bg-background px-2 py-1 text-xs"
          />
          <button
            type="submit"
            disabled={commentBusy || !commentBody.trim()}
            class="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-xs text-muted-foreground hover:bg-muted disabled:opacity-50"
          >
            <MessageSquarePlus class="size-3.5" /> Post
          </button>
        </div>
      </form>
    </section>
  </div>
{/if}
