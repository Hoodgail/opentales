<script lang="ts">
  import {
    Archive,
    ArrowRight,
    Camera,
    FileDiff,
    GitBranch,
    History,
    LoaderCircle,
    Plus,
    RotateCcw,
    Trash2,
    X
  } from 'lucide-svelte';
  import { tick } from 'svelte';
  import type {
    Chapter,
    CreateNamedSnapshotInput,
    NamedSnapshot,
    NamedSnapshotComparison,
    NamedSnapshotScope
  } from '@opentales/sdk';
  import { cn } from '$lib/utils';
  import { snapshotTarget } from '$lib/revision-ui';

  interface Props {
    snapshots: NamedSnapshot[];
    selected: NamedSnapshot | null;
    comparison: NamedSnapshotComparison | null;
    chapters: Chapter[];
    loading?: boolean;
    busy?: boolean;
    error?: string | null;
    onSelect: (snapshot: NamedSnapshot) => unknown | Promise<unknown>;
    onCreate: (input: Omit<CreateNamedSnapshotInput, 'idempotencyKey'>) => unknown | Promise<unknown>;
    onCompare: (leftSnapshotId: string, rightSnapshotId: string | null) => unknown | Promise<unknown>;
    onRestore: (snapshot: NamedSnapshot) => unknown | Promise<unknown>;
    onBranch: (snapshot: NamedSnapshot, name: string) => unknown | Promise<unknown>;
    onDelete: (snapshot: NamedSnapshot) => unknown | Promise<unknown>;
  }

  let {
    snapshots,
    selected,
    comparison,
    chapters,
    loading = false,
    busy = false,
    error = null,
    onSelect,
    onCreate,
    onCompare,
    onRestore,
    onBranch,
    onDelete
  }: Props = $props();

  const scopes: Array<{ value: NamedSnapshotScope | 'all'; label: string }> = [
    { value: 'all', label: 'All scopes' },
    { value: 'project', label: 'Whole project' },
    { value: 'chapter', label: 'Chapter' },
    { value: 'scene', label: 'Scene' },
    { value: 'project-doc', label: 'Planning document' },
    { value: 'writing', label: 'Writing' },
    { value: 'build-checkpoint', label: 'Build checkpoint' },
    { value: 'build-compilation', label: 'Build compilation' }
  ];
  let scopeFilter = $state<NamedSnapshotScope | 'all'>('all');
  let createOpen = $state(false);
  let createScope = $state<NamedSnapshotScope>('project');
  let label = $state('');
  let snapshotMessage = $state('');
  let chapterId = $state('');
  let sceneId = $state('');
  let advancedId = $state('');
  let buildRunId = $state('');
  let rightSnapshotId = $state('current');
  let action = $state<'restore' | 'branch' | 'delete' | null>(null);
  let branchName = $state('');
  let dialog: HTMLDivElement | undefined = $state();
  let dialogInvoker: HTMLElement | null = null;

  $effect(() => {
    selected?.id;
    rightSnapshotId = 'current';
  });

  const visible = $derived(scopeFilter === 'all' ? snapshots : snapshots.filter((snapshot) => snapshot.scope === scopeFilter));
  const selectedChapter = $derived(chapters.find((chapter) => chapter.id === chapterId) ?? null);
  const otherSnapshots = $derived(snapshots.filter((snapshot) => snapshot.id !== selected?.id));

  function resetCreate() {
    label = '';
    snapshotMessage = '';
    createScope = 'project';
    chapterId = '';
    sceneId = '';
    advancedId = '';
    buildRunId = '';
  }

  function createInput(): Omit<CreateNamedSnapshotInput, 'idempotencyKey'> | null {
    if (!label.trim()) return null;
    const base = { label: label.trim(), message: snapshotMessage.trim() || null, scope: createScope };
    if (createScope === 'chapter') return chapterId ? { ...base, chapterId } : null;
    if (createScope === 'scene') return chapterId && sceneId ? { ...base, chapterId, sceneId } : null;
    if (createScope === 'project-doc') return advancedId.trim() ? { ...base, projectDocId: advancedId.trim() } : null;
    if (createScope === 'writing') return advancedId.trim() ? { ...base, writingId: advancedId.trim() } : null;
    if (createScope === 'build-checkpoint') return buildRunId.trim() && advancedId.trim() ? { ...base, buildRunId: buildRunId.trim(), checkpointId: advancedId.trim() } : null;
    if (createScope === 'build-compilation') return buildRunId.trim() && advancedId.trim() ? { ...base, buildRunId: buildRunId.trim(), compilationId: advancedId.trim() } : null;
    return base;
  }

  async function submitCreate() {
    const input = createInput();
    if (!input) return;
    await onCreate(input);
    createOpen = false;
    resetCreate();
  }

  function openAction(next: Exclude<typeof action, null>, event: MouseEvent) {
    action = next;
    branchName = selected ? `revision/${selected.label.toLocaleLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'snapshot'}` : '';
    dialogInvoker = event.currentTarget instanceof HTMLElement ? event.currentTarget : null;
    void tick().then(() => dialog?.querySelector<HTMLElement>('input, button')?.focus());
  }

  function closeAction() {
    action = null;
    const target = dialogInvoker;
    dialogInvoker = null;
    void tick().then(() => target?.isConnected && target.focus());
  }

  function dialogKeydown(event: KeyboardEvent) {
    if (event.key === 'Escape') {
      event.preventDefault();
      closeAction();
      return;
    }
    if (event.key !== 'Tab' || !dialog) return;
    const focusable = [...dialog.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled])')];
    if (!focusable.length) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  }

  async function confirmAction() {
    if (!selected || !action) return;
    const current = action;
    const result = current === 'restore'
      ? await onRestore(selected)
      : current === 'branch'
        ? await onBranch(selected, branchName)
        : await onDelete(selected);
    if (result !== null && result !== false) closeAction();
  }

  function formatDate(value: string): string {
    return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value));
  }
</script>

<section class="flex min-h-0 flex-1 flex-col bg-background" aria-label="Revision snapshots">
  <header class="flex min-h-12 shrink-0 flex-wrap items-center gap-3 border-b border-border bg-sidebar px-3 py-2 sm:px-5">
    <div class="flex min-w-0 items-center gap-2"><History class="size-4 shrink-0 text-accent" /><div><h1 class="text-sm font-semibold text-foreground">Revisions & snapshots</h1><p class="font-mono text-[9px] text-muted-foreground">Named, immutable recovery points with prose + semantic diffs</p></div></div>
    <button type="button" onclick={() => (createOpen = !createOpen)} aria-expanded={createOpen} class="ml-auto inline-flex h-8 items-center gap-1 rounded bg-accent px-3 text-[10px] font-medium text-accent-foreground outline-none focus-visible:ring-2 focus-visible:ring-accent"><Plus class="size-3" />New snapshot</button>
  </header>

  {#if error}<div class="border-b border-destructive/30 bg-destructive/8 px-4 py-2 text-[11px] text-destructive-foreground" role="alert">{error}</div>{/if}

  {#if createOpen}
    <form aria-label="Create named snapshot" class="grid shrink-0 gap-3 border-b border-border bg-card/40 p-3 sm:grid-cols-2 lg:grid-cols-4" onsubmit={(event) => { event.preventDefault(); void submitCreate(); }}>
      <label><span class="mb-1 block text-[9px] uppercase tracking-wide text-muted-foreground">Label</span><input bind:value={label} required maxlength="160" spellcheck="true" class="h-9 w-full rounded border border-border bg-input/60 px-2 text-xs text-foreground outline-none focus-visible:border-accent focus-visible:ring-2 focus-visible:ring-accent/30" placeholder="Before developmental pass" /></label>
      <label><span class="mb-1 block text-[9px] uppercase tracking-wide text-muted-foreground">Scope</span><select bind:value={createScope} onchange={() => { chapterId = ''; sceneId = ''; advancedId = ''; buildRunId = ''; }} class="h-9 w-full rounded border border-border bg-input/60 px-2 text-xs text-foreground">{#each scopes.filter((item) => item.value !== 'all') as item}<option value={item.value}>{item.label}</option>{/each}</select></label>
      {#if createScope === 'chapter' || createScope === 'scene'}
        <label><span class="mb-1 block text-[9px] uppercase tracking-wide text-muted-foreground">Chapter</span><select bind:value={chapterId} required class="h-9 w-full rounded border border-border bg-input/60 px-2 text-xs text-foreground"><option value="">Choose chapter</option>{#each chapters as chapter (chapter.id)}<option value={chapter.id}>{chapter.number}. {chapter.title}</option>{/each}</select></label>
      {/if}
      {#if createScope === 'scene'}
        <label><span class="mb-1 block text-[9px] uppercase tracking-wide text-muted-foreground">Scene</span><select bind:value={sceneId} required class="h-9 w-full rounded border border-border bg-input/60 px-2 text-xs text-foreground"><option value="">Choose scene</option>{#each selectedChapter?.scenes ?? [] as scene (scene.id)}<option value={scene.id}>{scene.order + 1}. {scene.title}</option>{/each}</select></label>
      {:else if createScope === 'project-doc' || createScope === 'writing'}
        <label><span class="mb-1 block text-[9px] uppercase tracking-wide text-muted-foreground">{createScope === 'project-doc' ? 'Document ID' : 'Writing ID'}</span><input bind:value={advancedId} required class="h-9 w-full rounded border border-border bg-input/60 px-2 font-mono text-[10px] text-foreground" /></label>
      {:else if createScope === 'build-checkpoint' || createScope === 'build-compilation'}
        <label><span class="mb-1 block text-[9px] uppercase tracking-wide text-muted-foreground">Build run ID</span><input bind:value={buildRunId} required class="h-9 w-full rounded border border-border bg-input/60 px-2 font-mono text-[10px] text-foreground" /></label>
        <label><span class="mb-1 block text-[9px] uppercase tracking-wide text-muted-foreground">{createScope === 'build-checkpoint' ? 'Checkpoint ID' : 'Compilation ID'}</span><input bind:value={advancedId} required class="h-9 w-full rounded border border-border bg-input/60 px-2 font-mono text-[10px] text-foreground" /></label>
      {/if}
      <label class="sm:col-span-2 lg:col-span-4"><span class="mb-1 block text-[9px] uppercase tracking-wide text-muted-foreground">Message <span class="normal-case">(optional)</span></span><textarea bind:value={snapshotMessage} rows="2" maxlength="2000" spellcheck="true" class="w-full resize-y rounded border border-border bg-input/60 px-2 py-2 text-xs leading-relaxed text-foreground outline-none focus-visible:border-accent focus-visible:ring-2 focus-visible:ring-accent/30" placeholder="What changed, and why preserve this point?"></textarea></label>
      <div class="flex items-center gap-2 sm:col-span-2 lg:col-span-4"><button type="submit" disabled={busy || !createInput()} class="inline-flex h-8 items-center gap-1 rounded bg-accent px-3 text-[10px] font-medium text-accent-foreground disabled:opacity-50">{#if busy}<LoaderCircle class="size-3 motion-safe:animate-spin" />{/if}Create immutable snapshot</button><button type="button" onclick={() => { createOpen = false; resetCreate(); }} class="h-8 rounded border border-border px-3 text-[10px] text-muted-foreground">Cancel</button></div>
    </form>
  {/if}

  <div class="grid min-h-0 flex-1 lg:grid-cols-[19rem_minmax(0,1fr)]">
    <aside class="flex min-h-56 flex-col border-b border-border bg-sidebar lg:min-h-0 lg:border-b-0 lg:border-r" aria-label="Named snapshots">
      <div class="border-b border-border p-2"><label><span class="sr-only">Filter snapshot scope</span><select bind:value={scopeFilter} class="h-8 w-full rounded border border-border bg-input/50 px-2 text-[10px] text-foreground">{#each scopes as scope}<option value={scope.value}>{scope.label}</option>{/each}</select></label></div>
      <div class="min-h-0 flex-1 overflow-y-auto p-1">
        {#if loading && snapshots.length === 0}<div class="flex items-center gap-2 p-4 text-[11px] text-muted-foreground"><LoaderCircle class="size-3.5 motion-safe:animate-spin" />Loading snapshots…</div>
        {:else if visible.length === 0}<div class="p-5 text-center"><Camera class="mx-auto size-6 text-muted-foreground/40" /><p class="mt-2 text-xs text-foreground">No snapshots in this scope.</p><p class="mt-1 text-[10px] leading-relaxed text-muted-foreground">Capture a named recovery point before a major revision.</p></div>
        {:else}{#each visible as snapshot (snapshot.id)}<button type="button" onclick={() => void onSelect(snapshot)} aria-current={selected?.id === snapshot.id ? 'true' : undefined} class={cn('mb-1 w-full rounded border px-3 py-2 text-left outline-none focus-visible:ring-2 focus-visible:ring-accent', selected?.id === snapshot.id ? 'border-accent/50 bg-accent/10' : 'border-transparent hover:border-border hover:bg-muted/30')}><span class="block truncate text-[11px] font-medium text-foreground">{snapshot.label}</span><span class="mt-1 block truncate font-mono text-[9px] uppercase text-muted-foreground">{snapshot.scope} · {snapshot.heads.length} heads</span><span class="mt-1 block text-[9px] text-muted-foreground">{formatDate(snapshot.createdAt)}</span></button>{/each}{/if}
      </div>
    </aside>

    <main class="min-h-0 overflow-y-auto">
      {#if !selected}<div class="mx-auto flex max-w-lg flex-col items-center px-6 py-24 text-center"><FileDiff class="size-8 text-muted-foreground/40" /><h2 class="mt-3 text-sm font-semibold text-foreground">Choose a snapshot to inspect</h2><p class="mt-1 text-xs leading-relaxed text-muted-foreground">Compare exact writing heads and structured project state without changing the working manuscript.</p></div>
      {:else}
        <div class="border-b border-border px-4 py-4 sm:px-6"><div class="flex flex-wrap items-start gap-3"><div class="min-w-0 flex-1"><p class="font-mono text-[9px] uppercase tracking-wide text-accent">{snapshotTarget(selected)}</p><h2 class="mt-1 text-lg font-semibold text-foreground">{selected.label}</h2>{#if selected.message}<p class="mt-1 max-w-3xl text-xs leading-relaxed text-muted-foreground">{selected.message}</p>{/if}<p class="mt-2 font-mono text-[9px] text-muted-foreground">{selected.contentHash.slice(0, 12)} · {selected.sizeBytes.toLocaleString()} bytes · {formatDate(selected.createdAt)}</p></div><div class="flex flex-wrap gap-1"><button type="button" onclick={(event) => openAction('branch', event)} class="inline-flex h-8 items-center gap-1 rounded border border-border px-2 text-[10px] text-foreground hover:border-accent/60"><GitBranch class="size-3" />Branch</button><button type="button" onclick={(event) => openAction('restore', event)} class="inline-flex h-8 items-center gap-1 rounded border border-amber-500/40 px-2 text-[10px] text-amber-200 hover:border-amber-400"><RotateCcw class="size-3" />Restore</button><button type="button" aria-label="Delete snapshot" onclick={(event) => openAction('delete', event)} class="inline-flex size-8 items-center justify-center rounded border border-border text-muted-foreground hover:border-destructive/50 hover:text-destructive-foreground"><Trash2 class="size-3" /></button></div></div></div>

        <div class="border-b border-border bg-sidebar/40 px-4 py-2 sm:px-6"><label class="flex flex-wrap items-center gap-2 text-[10px] text-muted-foreground"><span>Compare</span><strong class="text-foreground">{selected.label}</strong><ArrowRight class="size-3" /><select bind:value={rightSnapshotId} onchange={() => void onCompare(selected!.id, rightSnapshotId === 'current' ? null : rightSnapshotId)} class="h-8 min-w-48 rounded border border-border bg-input/60 px-2 text-[10px] text-foreground"><option value="current">Current working copy</option>{#each otherSnapshots as snapshot (snapshot.id)}<option value={snapshot.id}>{snapshot.label}</option>{/each}</select></label></div>

        {#if loading}<div class="flex items-center gap-2 p-6 text-xs text-muted-foreground"><LoaderCircle class="size-4 motion-safe:animate-spin" />Computing exact diff…</div>
        {:else if comparison}
          <div class="space-y-8 p-4 sm:p-6">
            <section aria-labelledby="prose-diff-heading"><div class="flex items-center justify-between gap-3"><h3 id="prose-diff-heading" class="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">Prose changes</h3><span class="font-mono text-[9px] text-muted-foreground">{comparison.prose.length} writings</span></div>{#if comparison.prose.length === 0}<p class="mt-3 rounded border border-border bg-card p-4 text-xs text-muted-foreground">No prose changed.</p>{:else}<div class="mt-3 space-y-4">{#each comparison.prose as diff (diff.writingId)}<article class="overflow-hidden rounded border border-border bg-card"><header class="flex flex-wrap items-center gap-2 border-b border-border px-3 py-2"><span class="text-xs font-medium text-foreground">{diff.entityType} · {diff.entityId}</span><span class={cn('ml-auto font-mono text-[9px]', diff.wordDelta > 0 ? 'text-emerald-300' : diff.wordDelta < 0 ? 'text-red-300' : 'text-muted-foreground')}>{diff.leftWordCount.toLocaleString()} → {diff.rightWordCount.toLocaleString()} words ({diff.wordDelta > 0 ? '+' : ''}{diff.wordDelta})</span></header><div class="max-h-96 overflow-auto font-mono text-[10px] leading-relaxed">{#each diff.changes as change, changeIndex (`${change.kind}-${change.leftStart}-${change.rightStart}-${changeIndex}`)}{#each change.lines as line, lineIndex (`${changeIndex}-${lineIndex}`)}<div class={cn('grid grid-cols-[3rem_3rem_1rem_minmax(0,1fr)] border-b border-border/35 px-2 py-0.5', change.kind === 'added' && 'bg-emerald-500/10 text-emerald-100', change.kind === 'removed' && 'bg-red-500/10 text-red-100', change.kind === 'equal' && 'text-muted-foreground')}><span class="text-right opacity-60">{change.kind !== 'added' ? change.leftStart + lineIndex + 1 : ''}</span><span class="text-right opacity-60">{change.kind !== 'removed' ? change.rightStart + lineIndex + 1 : ''}</span><span class="text-center">{change.kind === 'added' ? '+' : change.kind === 'removed' ? '−' : ' '}</span><span class="whitespace-pre-wrap break-words">{line || ' '}</span></div>{/each}{/each}</div></article>{/each}</div>{/if}</section>
            <section aria-labelledby="semantic-diff-heading"><div class="flex items-center justify-between gap-3"><h3 id="semantic-diff-heading" class="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">Semantic changes</h3><span class="font-mono text-[9px] text-muted-foreground">{comparison.semantic.length} paths</span></div>{#if comparison.semantic.length === 0}<p class="mt-3 rounded border border-border bg-card p-4 text-xs text-muted-foreground">No structured state changed.</p>{:else}<div class="mt-3 space-y-2">{#each comparison.semantic as change (change.path)}<article class="rounded border border-border bg-card p-3"><h4 class="font-mono text-[10px] text-accent">{change.path}</h4><div class="mt-2 grid gap-2 sm:grid-cols-2"><div class="rounded bg-red-500/8 p-2"><span class="text-[9px] uppercase text-red-300">Before</span><pre class="mt-1 whitespace-pre-wrap break-words font-mono text-[9px] text-foreground/75">{JSON.stringify(change.before, null, 2)}</pre></div><div class="rounded bg-emerald-500/8 p-2"><span class="text-[9px] uppercase text-emerald-300">After</span><pre class="mt-1 whitespace-pre-wrap break-words font-mono text-[9px] text-foreground/75">{JSON.stringify(change.after, null, 2)}</pre></div></div></article>{/each}</div>{/if}</section>
          </div>
        {:else}<div class="p-6 text-xs text-muted-foreground">Choose a comparison target to compute a diff.</div>{/if}
      {/if}
    </main>
  </div>
</section>

{#if action && selected}
  <div class="fixed inset-0 z-[80] flex items-center justify-center bg-black/70 p-4" role="presentation">
    <div bind:this={dialog} tabindex="-1" role="alertdialog" aria-modal="true" aria-labelledby="snapshot-action-title" aria-describedby="snapshot-action-description" onkeydown={dialogKeydown} class="w-full max-w-md rounded border border-border bg-card p-5 shadow-2xl">
      <div class="flex items-start gap-3"><div class="flex size-9 shrink-0 items-center justify-center rounded bg-accent/10">{#if action === 'restore'}<RotateCcw class="size-4 text-amber-300" />{:else if action === 'branch'}<GitBranch class="size-4 text-accent" />{:else}<Trash2 class="size-4 text-destructive-foreground" />{/if}</div><div class="min-w-0 flex-1"><h2 id="snapshot-action-title" class="text-sm font-semibold text-foreground">{action === 'restore' ? 'Restore this snapshot?' : action === 'branch' ? 'Create branches from snapshot?' : 'Delete this snapshot?'}</h2><p id="snapshot-action-description" class="mt-1 text-xs leading-relaxed text-muted-foreground">{action === 'restore' ? 'This creates new writing versions from the captured heads. It never rewrites version history, and stale working heads will stop the restore.' : action === 'branch' ? 'Each captured writing becomes a named branch. The current working copy is unchanged.' : 'The snapshot is removed from normal history. Existing writing versions remain intact.'}</p></div><button type="button" onclick={closeAction} aria-label="Close confirmation" class="flex size-8 items-center justify-center rounded text-muted-foreground hover:bg-muted"><X class="size-4" /></button></div>
      {#if action === 'branch'}<label class="mt-4 block"><span class="mb-1 block text-[10px] uppercase tracking-wide text-muted-foreground">Branch name</span><input bind:value={branchName} required spellcheck="false" class="h-9 w-full rounded border border-border bg-input/60 px-2 font-mono text-xs text-foreground outline-none focus-visible:border-accent focus-visible:ring-2 focus-visible:ring-accent/30" /></label>{/if}
      <div class="mt-5 flex justify-end gap-2"><button type="button" onclick={closeAction} class="h-8 rounded border border-border px-3 text-[10px] text-foreground">Cancel</button><button type="button" onclick={() => void confirmAction()} disabled={busy || (action === 'branch' && !branchName.trim())} class={cn('h-8 rounded px-3 text-[10px] font-medium disabled:opacity-50', action === 'delete' ? 'bg-destructive text-destructive-foreground' : action === 'restore' ? 'bg-amber-500 text-black' : 'bg-accent text-accent-foreground')}>{busy ? 'Working…' : action === 'restore' ? 'Confirm restore' : action === 'branch' ? 'Create branches' : 'Delete snapshot'}</button></div>
    </div>
  </div>
{/if}
