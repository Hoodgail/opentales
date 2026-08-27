<script lang="ts">
  import {
    Check,
    ChevronDown,
    ChevronLeft,
    ChevronRight,
    CornerDownRight,
    Filter,
    Lightbulb,
    LoaderCircle,
    MessageSquare,
    NotebookPen,
    RotateCcw,
    Send,
    X,
    XCircle
  } from 'lucide-svelte';
  import { tick } from 'svelte';
  import type { WritingAnnotationKind, WritingAnnotationStatus, WritingAnnotationThread } from '@opentales/sdk';
  import type { EditorTextSelection } from '$lib/editor-annotations';
  import { cn } from '$lib/utils';

  interface Props {
    threads: WritingAnnotationThread[];
    selectedId: string | null;
    selection: EditorTextSelection | null;
    currentVersionId: string | null;
    loading?: boolean;
    busy?: boolean;
    error?: string | null;
    onClose: () => void;
    onSelect: (id: string | null) => void;
    onNavigate: (thread: WritingAnnotationThread) => void;
    onCreate: (kind: WritingAnnotationKind, body: string, suggestedReplacement: string | null) => Promise<WritingAnnotationThread | null>;
    onReply: (thread: WritingAnnotationThread, body: string) => Promise<WritingAnnotationThread | null>;
    onResolve: (thread: WritingAnnotationThread) => Promise<WritingAnnotationThread | null>;
    onReopen: (thread: WritingAnnotationThread) => Promise<WritingAnnotationThread | null>;
    onAccept: (thread: WritingAnnotationThread) => Promise<WritingAnnotationThread | null>;
    onReject: (thread: WritingAnnotationThread) => Promise<WritingAnnotationThread | null>;
  }

  let {
    threads,
    selectedId,
    selection,
    currentVersionId,
    loading = false,
    busy = false,
    error = null,
    onClose,
    onSelect,
    onNavigate,
    onCreate,
    onReply,
    onResolve,
    onReopen,
    onAccept,
    onReject
  }: Props = $props();

  let statusFilter = $state<WritingAnnotationStatus | 'all'>('open');
  let kindFilter = $state<WritingAnnotationKind | 'all'>('all');
  let createKind = $state<WritingAnnotationKind>('comment');
  let createBody = $state('');
  let replacement = $state('');
  let replyBody = $state('');
  let creating = $state(false);
  let acceptTarget = $state<WritingAnnotationThread | null>(null);
  let confirmDialog: HTMLDivElement | undefined = $state();
  let acceptInvoker: HTMLElement | null = null;

  const visible = $derived(threads.filter((thread) =>
    (statusFilter === 'all' || thread.status === statusFilter)
    && (kindFilter === 'all' || thread.kind === kindFilter)
  ));
  const selected = $derived(threads.find((thread) => thread.id === selectedId) ?? null);
  const selectedIndex = $derived(selected ? visible.findIndex((thread) => thread.id === selected.id) : -1);

  function iconFor(kind: WritingAnnotationKind) {
    return kind === 'suggestion' ? Lightbulb : kind === 'note' ? NotebookPen : MessageSquare;
  }

  async function submitCreate() {
    if (!selection || !createBody.trim()) return;
    const result = await onCreate(createKind, createBody.trim(), createKind === 'suggestion' ? replacement : null);
    if (!result) return;
    createBody = '';
    replacement = '';
    creating = false;
  }

  async function submitReply() {
    if (!selected || !replyBody.trim()) return;
    const result = await onReply(selected, replyBody.trim());
    if (result) replyBody = '';
  }

  function selectThread(thread: WritingAnnotationThread) {
    onSelect(thread.id);
    onNavigate(thread);
  }

  function step(direction: -1 | 1) {
    if (!visible.length) return;
    const next = selectedIndex < 0
      ? (direction > 0 ? 0 : visible.length - 1)
      : (selectedIndex + direction + visible.length) % visible.length;
    selectThread(visible[next]);
  }

  function openAccept(thread: WritingAnnotationThread, event: MouseEvent) {
    acceptTarget = thread;
    acceptInvoker = event.currentTarget instanceof HTMLElement ? event.currentTarget : null;
    void tick().then(() => confirmDialog?.querySelector<HTMLElement>('button')?.focus());
  }

  function closeAccept() {
    acceptTarget = null;
    const target = acceptInvoker;
    acceptInvoker = null;
    void tick().then(() => target?.isConnected && target.focus());
  }

  function confirmationKeydown(event: KeyboardEvent) {
    if (event.key === 'Escape') { event.preventDefault(); closeAccept(); return; }
    if (event.key !== 'Tab' || !confirmDialog) return;
    const buttons = [...confirmDialog.querySelectorAll<HTMLButtonElement>('button:not([disabled])')];
    const first = buttons[0];
    const last = buttons[buttons.length - 1];
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  }

  async function confirmAccept() {
    if (!acceptTarget) return;
    const result = await onAccept(acceptTarget);
    if (result) closeAccept();
  }

  function formatDate(value: string): string {
    return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value));
  }
</script>

<aside class="flex h-full min-h-0 w-full flex-col border-l border-border bg-sidebar sm:w-[22rem]" aria-label="Editor annotations">
  <header class="flex min-h-11 shrink-0 items-center gap-2 border-b border-border px-3">
    <MessageSquare class="size-3.5 text-accent" />
    <h2 class="text-xs font-semibold text-foreground">Comments & suggestions</h2>
    <span class="rounded bg-muted px-1.5 py-0.5 font-mono text-[9px] text-muted-foreground">{threads.filter((thread) => thread.status === 'open').length} open</span>
    <button type="button" onclick={onClose} aria-label="Close annotations" class="ml-auto flex size-8 items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-accent"><X class="size-4" /></button>
  </header>

  <div class="shrink-0 border-b border-border p-2">
    <div class="grid grid-cols-2 gap-1">
      <label><span class="sr-only">Filter by status</span><select bind:value={statusFilter} class="h-8 w-full rounded border border-border bg-input/50 px-2 text-[10px] text-foreground"><option value="all">All statuses</option><option value="open">Open</option><option value="resolved">Resolved</option><option value="accepted">Accepted</option><option value="rejected">Rejected</option></select></label>
      <label><span class="sr-only">Filter by kind</span><select bind:value={kindFilter} class="h-8 w-full rounded border border-border bg-input/50 px-2 text-[10px] text-foreground"><option value="all">All kinds</option><option value="comment">Comments</option><option value="note">Notes</option><option value="suggestion">Suggestions</option></select></label>
    </div>
    <div class="mt-2 flex items-center gap-1"><button type="button" onclick={() => step(-1)} disabled={!visible.length} aria-label="Previous annotation" class="flex size-8 items-center justify-center rounded border border-border text-muted-foreground disabled:opacity-40"><ChevronLeft class="size-3.5" /></button><button type="button" onclick={() => step(1)} disabled={!visible.length} aria-label="Next annotation" class="flex size-8 items-center justify-center rounded border border-border text-muted-foreground disabled:opacity-40"><ChevronRight class="size-3.5" /></button><span class="ml-1 text-[9px] text-muted-foreground"><Filter class="mr-1 inline size-3" />{visible.length} shown</span><button type="button" onclick={() => (creating = !creating)} disabled={!selection} aria-expanded={creating} class="ml-auto inline-flex h-8 items-center gap-1 rounded bg-accent px-2 text-[10px] font-medium text-accent-foreground disabled:cursor-not-allowed disabled:opacity-40"><MessageSquare class="size-3" />Add to selection</button></div>
    {#if !selection}<p class="mt-2 text-[9px] leading-relaxed text-muted-foreground">Select prose in the editor to start a comment, private note, or tracked suggestion.</p>{:else}<blockquote class="mt-2 line-clamp-3 border-l-2 border-accent/50 pl-2 font-serif text-[10px] italic leading-relaxed text-foreground/70">“{selection.quote}”</blockquote>{/if}
  </div>

  {#if creating && selection}
    <form class="shrink-0 border-b border-border bg-card/50 p-3" aria-label="New annotation" onsubmit={(event) => { event.preventDefault(); void submitCreate(); }}>
      <div class="flex rounded border border-border bg-input/50 p-0.5" aria-label="Annotation kind">{#each [['comment','Comment'],['note','Note'],['suggestion','Suggestion']] as option}<button type="button" aria-pressed={createKind === option[0]} onclick={() => (createKind = option[0] as WritingAnnotationKind)} class={cn('h-7 flex-1 rounded-sm px-1 text-[9px]', createKind === option[0] ? 'bg-accent text-accent-foreground' : 'text-muted-foreground')}>{option[1]}</button>{/each}</div>
      <label class="mt-2 block"><span class="sr-only">Annotation</span><textarea bind:value={createBody} required rows="3" maxlength="4000" spellcheck="true" class="w-full resize-y rounded border border-border bg-input/60 px-2 py-2 text-[11px] leading-relaxed text-foreground outline-none focus-visible:border-accent focus-visible:ring-2 focus-visible:ring-accent/30" placeholder={createKind === 'note' ? 'Leave a private craft note…' : createKind === 'suggestion' ? 'Explain the proposed edit…' : 'Leave a comment…'}></textarea></label>
      {#if createKind === 'suggestion'}<label class="mt-2 block"><span class="mb-1 block text-[9px] uppercase tracking-wide text-muted-foreground">Replacement text</span><textarea bind:value={replacement} required rows="3" maxlength="100000" spellcheck="true" class="w-full resize-y rounded border border-border bg-input/60 px-2 py-2 font-serif text-[12px] leading-relaxed text-foreground outline-none focus-visible:border-accent focus-visible:ring-2 focus-visible:ring-accent/30"></textarea></label>{/if}
      <div class="mt-2 flex justify-end gap-1"><button type="button" onclick={() => (creating = false)} class="h-8 rounded border border-border px-2 text-[10px] text-muted-foreground">Cancel</button><button type="submit" disabled={busy || !createBody.trim() || (createKind === 'suggestion' && !replacement.length)} class="inline-flex h-8 items-center gap-1 rounded bg-accent px-2 text-[10px] font-medium text-accent-foreground disabled:opacity-40">{#if busy}<LoaderCircle class="size-3 motion-safe:animate-spin" />{:else}<Send class="size-3" />{/if}Post</button></div>
    </form>
  {/if}

  {#if error}<div class="border-b border-destructive/30 bg-destructive/8 px-3 py-2 text-[10px] text-destructive-foreground" role="alert">{error}</div>{/if}

  <div class="grid min-h-0 flex-1 grid-rows-[minmax(8rem,0.8fr)_minmax(12rem,1.2fr)]">
    <div class="min-h-0 overflow-y-auto border-b border-border p-1">
      {#if loading && !threads.length}<div class="flex items-center gap-2 p-4 text-[10px] text-muted-foreground"><LoaderCircle class="size-3 motion-safe:animate-spin" />Loading annotations…</div>
      {:else if !visible.length}<div class="p-5 text-center"><MessageSquare class="mx-auto size-5 text-muted-foreground/30" /><p class="mt-2 text-[10px] text-muted-foreground">No annotations match these filters.</p></div>
      {:else}{#each visible as thread (thread.id)}{@const Icon = iconFor(thread.kind)}<button type="button" onclick={() => selectThread(thread)} aria-current={selectedId === thread.id ? 'true' : undefined} class={cn('mb-1 w-full rounded border px-2 py-2 text-left outline-none focus-visible:ring-2 focus-visible:ring-accent', selectedId === thread.id ? 'border-accent/50 bg-accent/10' : 'border-transparent hover:border-border hover:bg-muted/30')}><div class="flex items-center gap-1"><Icon class="size-3 text-accent" /><span class="font-mono text-[8px] uppercase tracking-wide text-muted-foreground">{thread.kind} · {thread.status}</span>{#if thread.anchorVersionId !== currentVersionId}<span class="ml-auto rounded bg-amber-500/10 px-1 text-[8px] text-amber-300">earlier version</span>{/if}</div><blockquote class="mt-1 line-clamp-2 border-l border-border pl-2 font-serif text-[10px] italic text-foreground/65">“{thread.quote}”</blockquote><p class="mt-1 line-clamp-2 text-[10px] leading-relaxed text-foreground">{thread.body}</p></button>{/each}{/if}
    </div>

    <div class="min-h-0 overflow-y-auto">
      {#if !selected}<div class="p-5 text-center text-[10px] text-muted-foreground">Choose a thread to read replies and take action.</div>
      {:else}
        <article class="p-3"><div class="flex items-start gap-2"><button type="button" onclick={() => onNavigate(selected)} class="min-w-0 flex-1 text-left"><span class="font-mono text-[8px] uppercase text-accent">{selected.kind} · characters {selected.start}–{selected.end}</span><blockquote class="mt-1 border-l-2 border-accent/40 pl-2 font-serif text-[11px] italic leading-relaxed text-foreground/70">“{selected.quote}”</blockquote></button><ChevronDown class="mt-1 size-3 text-muted-foreground" /></div><p class="mt-3 text-[11px] leading-relaxed text-foreground">{selected.body}</p><p class="mt-1 text-[8px] text-muted-foreground">{formatDate(selected.createdAt)}</p>
          {#if selected.kind === 'suggestion' && selected.suggestedReplacement !== null}<div class="mt-3 rounded border border-emerald-500/25 bg-emerald-500/8 p-2"><p class="text-[8px] uppercase tracking-wide text-emerald-300">Suggested replacement</p><p class="mt-1 whitespace-pre-wrap font-serif text-[11px] leading-relaxed text-foreground">{selected.suggestedReplacement}</p></div>{/if}
          {#if selected.replies.length}<div class="mt-3 space-y-2 border-l border-border pl-3">{#each selected.replies as reply (reply.id)}<div><div class="flex items-center gap-1 text-[8px] text-muted-foreground"><CornerDownRight class="size-3" />{formatDate(reply.createdAt)}</div><p class="mt-1 text-[10px] leading-relaxed text-foreground">{reply.body}</p></div>{/each}</div>{/if}
          <div class="mt-4 flex flex-wrap gap-1">{#if selected.status === 'open'}<button type="button" onclick={() => void onResolve(selected)} disabled={busy} class="inline-flex h-8 items-center gap-1 rounded border border-border px-2 text-[9px] text-foreground"><Check class="size-3" />Resolve</button>{:else if selected.status === 'resolved'}<button type="button" onclick={() => void onReopen(selected)} disabled={busy} class="inline-flex h-8 items-center gap-1 rounded border border-border px-2 text-[9px] text-foreground"><RotateCcw class="size-3" />Reopen</button>{/if}{#if selected.kind === 'suggestion' && selected.status === 'open'}<button type="button" onclick={(event) => openAccept(selected, event)} disabled={busy || selected.anchorVersionId !== currentVersionId} title={selected.anchorVersionId !== currentVersionId ? 'This suggestion is anchored to an earlier version. Recreate it against current prose to apply safely.' : 'Apply this replacement to the current writing head'} class="inline-flex h-8 items-center gap-1 rounded bg-emerald-500 px-2 text-[9px] font-medium text-black disabled:opacity-40"><Check class="size-3" />Accept</button><button type="button" onclick={() => void onReject(selected)} disabled={busy} class="inline-flex h-8 items-center gap-1 rounded border border-destructive/40 px-2 text-[9px] text-destructive-foreground"><XCircle class="size-3" />Reject</button>{/if}</div>
          <form class="mt-4 border-t border-border pt-3" onsubmit={(event) => { event.preventDefault(); void submitReply(); }}><label><span class="sr-only">Reply to annotation</span><textarea bind:value={replyBody} rows="2" maxlength="4000" spellcheck="true" class="w-full resize-y rounded border border-border bg-input/50 px-2 py-2 text-[10px] leading-relaxed text-foreground outline-none focus-visible:border-accent focus-visible:ring-2 focus-visible:ring-accent/30" placeholder="Reply…"></textarea></label><button type="submit" disabled={busy || !replyBody.trim()} class="mt-1 inline-flex h-8 items-center gap-1 rounded border border-border px-2 text-[9px] text-foreground disabled:opacity-40"><Send class="size-3" />Reply</button></form>
        </article>
      {/if}
    </div>
  </div>
</aside>

{#if acceptTarget}
  <div class="fixed inset-0 z-[90] flex items-center justify-center bg-black/70 p-4" role="presentation">
    <div bind:this={confirmDialog} tabindex="-1" role="alertdialog" aria-modal="true" aria-labelledby="accept-suggestion-title" aria-describedby="accept-suggestion-description" onkeydown={confirmationKeydown} class="w-full max-w-md rounded border border-border bg-card p-5 shadow-2xl"><h2 id="accept-suggestion-title" class="text-sm font-semibold text-foreground">Accept tracked suggestion?</h2><p id="accept-suggestion-description" class="mt-2 text-xs leading-relaxed text-muted-foreground">The selected range will be replaced on the current writing head as a new immutable version. If the prose changed since this thread was anchored, the server will refuse the edit.</p><div class="mt-3 rounded border border-emerald-500/25 bg-emerald-500/8 p-3"><p class="font-serif text-xs text-foreground/60 line-through">{acceptTarget.quote}</p><p class="mt-2 font-serif text-xs text-foreground">{acceptTarget.suggestedReplacement}</p></div><div class="mt-5 flex justify-end gap-2"><button type="button" onclick={closeAccept} class="h-8 rounded border border-border px-3 text-[10px] text-foreground">Cancel</button><button type="button" onclick={() => void confirmAccept()} disabled={busy} class="h-8 rounded bg-emerald-500 px-3 text-[10px] font-medium text-black disabled:opacity-50">{busy ? 'Applying…' : 'Confirm replacement'}</button></div></div>
  </div>
{/if}
