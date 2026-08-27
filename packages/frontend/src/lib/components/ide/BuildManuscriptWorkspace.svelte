<script lang="ts">
  import {
    AlertTriangle,
    BookOpenText,
    Braces,
    Check,
    ChevronRight,
    Columns3,
    FileDiff,
    GitMerge,
    LoaderCircle,
    PencilLine,
    RefreshCw,
    Save,
    ShieldCheck
  } from 'lucide-svelte';
  import type {
    BuildComparison,
    BuildCompilation,
    BuildManuscriptUnit,
    BuildReview,
    BuildReviewUnit,
    BuildRun,
    JsonValue,
    PatchBuildManuscriptUnitInput
  } from '@opentales/sdk';
  import { tick } from 'svelte';
  import { storyUi } from '$lib/stores/storyUi.svelte';
  import { cn } from '$lib/utils';
  import MarkdownPreview from './MarkdownPreview.svelte';

  type Surface = 'manuscript' | 'comparison' | 'review';
  type EditorMode = 'read' | 'write' | 'source';

  interface Props {
    run: BuildRun;
    units: BuildManuscriptUnit[];
    compilation: BuildCompilation | null;
    comparison: BuildComparison | null;
    reviews: BuildReview[];
    busy?: boolean;
    error?: string | null;
    onPatchUnit: (unit: BuildManuscriptUnit, input: Omit<PatchBuildManuscriptUnitInput, 'idempotencyKey' | 'expectedBuildRevision' | 'expectedUnitRevision' | 'expectedHeadVersionId'>) => Promise<BuildManuscriptUnit | null>;
    onCompile: (checkpointId?: string | null) => Promise<BuildCompilation | null>;
    onCompare: () => Promise<BuildComparison | null>;
    onCreateReview: (input: { compilationId: string; checkpointId?: string | null; title: string; message?: string }) => Promise<BuildReview | null>;
    onApprove: (review: BuildReview) => Promise<BuildReview | null>;
    onMerge: (review: BuildReview) => Promise<BuildReview | null>;
    onReject: (review: BuildReview, reason: string) => Promise<BuildReview | null>;
  }

  let {
    run,
    units,
    compilation,
    comparison,
    reviews,
    busy = false,
    error = null,
    onPatchUnit,
    onCompile,
    onCompare,
    onCreateReview,
    onApprove,
    onMerge,
    onReject
  }: Props = $props();

  let surface = $state<Surface>('manuscript');
  let mode = $state<EditorMode>('read');
  let selectedUnitId = $state<string | null>(null);
  let selectedDiffId = $state<string | null>(null);
  let titleDraft = $state('');
  let bodyDraft = $state('');
  let statusDraft = $state<BuildManuscriptUnit['status']>('drafting');
  let tensionDraft = $state('');
  let metadataDraft = $state('{}');
  let draftKey = $state('');
  let editError = $state<string | null>(null);
  let reviewTitle = $state('Manuscript branch review');
  let reviewMessage = $state('');
  let selectedReviewUnitId = $state<string | null>(null);
  let reviewDecision = $state<'approve' | 'merge' | 'reject' | null>(null);
  let rejectReason = $state('');
  let handledBuildRequest = $state(0);
  let reviewDialog: HTMLElement | undefined = $state();
  let reviewReturnFocus: HTMLElement | null = null;

  const activeUnits = $derived.by(() => {
    const current = units.filter((unit) => unit.status !== 'invalidated' && !unit.invalidatedAt);
    const chapters = current
      .filter((unit) => unit.kind === 'chapter')
      .sort((a, b) => (a.chapterNumber ?? a.order) - (b.chapterNumber ?? b.order) || a.order - b.order || a.title.localeCompare(b.title));
    const scenes = current.filter((unit) => unit.kind === 'scene');
    const ordered: BuildManuscriptUnit[] = [];
    for (const chapter of chapters) {
      ordered.push(chapter);
      ordered.push(...scenes.filter((scene) => scene.parentUnitId === chapter.id).sort((a, b) => a.order - b.order || a.title.localeCompare(b.title)));
    }
    ordered.push(...scenes.filter((scene) => !scene.parentUnitId || !current.some((unit) => unit.id === scene.parentUnitId)).sort((a, b) => a.order - b.order || a.title.localeCompare(b.title)));
    return ordered;
  });
  const childUnitIds = $derived(new Set(activeUnits.map((unit) => unit.parentUnitId).filter((id): id is string => Boolean(id))));
  const compiledIds = $derived(new Set(compilation?.units.map((unit) => unit.unitId) ?? []));
  const readingUnits = $derived.by(() => {
    const eligible = compiledIds.size ? activeUnits.filter((unit) => compiledIds.has(unit.id)) : activeUnits;
    return eligible.filter((unit) => unit.kind === 'scene' || (unit.kind === 'chapter' && !childUnitIds.has(unit.id)));
  });
  const selectedUnit = $derived(activeUnits.find((unit) => unit.id === selectedUnitId) ?? activeUnits.find((unit) => unit.kind === 'scene') ?? activeUnits[0] ?? null);
  const selectedDiff = $derived(comparison?.prose.find((item) => item.unitId === selectedDiffId) ?? comparison?.prose.find((item) => item.changed) ?? comparison?.prose[0] ?? null);
  const latestReview = $derived([...reviews].sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0] ?? null);
  const selectedReviewUnit = $derived(
    latestReview?.units.find((unit) => unit.id === selectedReviewUnitId)
      ?? latestReview?.units[0]
      ?? null
  );
  const selectedReviewDiff = $derived(
    selectedReviewUnit ? comparison?.prose.find((item) => item.unitId === selectedReviewUnit.unitId) ?? null : null
  );

  function reviewSnapshot(unit: BuildReviewUnit): Record<string, JsonValue> {
    const value = unit.reviewedUnitSnapshot;
    return value && typeof value === 'object' && !Array.isArray(value)
      ? value as Record<string, JsonValue>
      : {};
  }

  function reviewUnitTitle(unit: BuildReviewUnit): string {
    const title = reviewSnapshot(unit).title;
    return typeof title === 'string' && title.trim() ? title : units.find((candidate) => candidate.id === unit.unitId)?.title ?? unit.unitId;
  }

  function countWords(value: string): number {
    const trimmed = value.trim();
    return trimmed ? trimmed.split(/\s+/u).length : 0;
  }

  $effect(() => {
    if (!selectedUnit) return;
    const nextKey = `${selectedUnit.id}:${selectedUnit.revision}:${selectedUnit.headVersionId}`;
    if (nextKey === draftKey) return;
    draftKey = nextKey;
    selectedUnitId = selectedUnit.id;
    titleDraft = selectedUnit.title;
    bodyDraft = selectedUnit.body;
    statusDraft = selectedUnit.status;
    tensionDraft = selectedUnit.tension?.toString() ?? '';
    metadataDraft = JSON.stringify(selectedUnit.metadata, null, 2);
    editError = null;
  });

  $effect(() => {
    const request = storyUi.buildSurfaceRequest;
    if (!request || request.nonce === handledBuildRequest) return;
    handledBuildRequest = request.nonce;
    surface = request.surface;
    if (!request.unitId) return;
    const requestedUnitId = request.unitId;
    selectedUnitId = requestedUnitId;
    mode = 'source';
    void tick().then(() => {
      const editor = Array.from(document.querySelectorAll<HTMLTextAreaElement>('textarea[data-build-unit-editor]'))
        .find((candidate) => candidate.dataset.buildUnitEditor === requestedUnitId);
      if (!editor) return;
      editor.focus();
      if (request.start !== undefined) editor.setSelectionRange(request.start, request.end ?? request.start);
    });
  });

  async function saveUnit() {
    if (!selectedUnit) return;
    editError = null;
    try {
      const metadata = JSON.parse(metadataDraft) as JsonValue;
      await onPatchUnit(selectedUnit, {
        title: titleDraft.trim() || selectedUnit.title,
        body: bodyDraft,
        status: statusDraft,
        tension: tensionDraft.trim() ? Number(tensionDraft) : null,
        metadata,
        message: 'Writer edited build manuscript unit'
      });
    } catch (caught) {
      editError = caught instanceof Error ? caught.message : 'Build unit metadata must be valid JSON.';
    }
  }

  async function createReview() {
    if (!compilation) return;
    await onCreateReview({
      compilationId: compilation.id,
      checkpointId: compilation.checkpointId,
      title: reviewTitle.trim() || 'Manuscript branch review',
      message: reviewMessage.trim() || undefined
    });
  }

  async function commitReviewDecision() {
    if (!latestReview || !reviewDecision) return;
    const decision = reviewDecision;
    if (decision === 'approve') await onApprove(latestReview);
    else if (decision === 'merge') await onMerge(latestReview);
    else await onReject(latestReview, rejectReason);
    closeReviewDecision();
  }

  function openReviewDecision(decision: 'approve' | 'merge' | 'reject', event: MouseEvent) {
    reviewReturnFocus = event.currentTarget instanceof HTMLElement ? event.currentTarget : null;
    reviewDecision = decision;
    void tick().then(() => reviewDialog?.focus());
  }

  function closeReviewDecision() {
    reviewDecision = null;
    rejectReason = '';
    const target = reviewReturnFocus;
    reviewReturnFocus = null;
    void tick().then(() => target?.isConnected && target.focus());
  }

  function handleReviewDialogKeydown(event: KeyboardEvent) {
    if (event.key === 'Escape') {
      event.preventDefault();
      closeReviewDecision();
      return;
    }
    if (event.key !== 'Tab' || !reviewDialog) return;
    const focusable = [...reviewDialog.querySelectorAll<HTMLElement>('button:not([disabled]), textarea:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])')];
    if (!focusable.length) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  }

  function moveSurface(event: KeyboardEvent, index: number) {
    let next = index;
    if (event.key === 'ArrowRight') next = (index + 1) % surfaces.length;
    else if (event.key === 'ArrowLeft') next = (index - 1 + surfaces.length) % surfaces.length;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = surfaces.length - 1;
    else return;
    event.preventDefault();
    surface = surfaces[next].id;
    requestAnimationFrame(() => document.getElementById(`build-manuscript-tab-${surface}`)?.focus());
  }

  const surfaces: Array<{ id: Surface; label: string; icon: typeof BookOpenText }> = [
    { id: 'manuscript', label: 'Branch manuscript', icon: BookOpenText },
    { id: 'comparison', label: 'Main ↔ build', icon: FileDiff },
    { id: 'review', label: 'Review & merge', icon: ShieldCheck }
  ];
</script>

<section class="flex min-h-0 flex-1 flex-col bg-background" aria-label="Build manuscript">
  <header class="flex min-h-11 shrink-0 items-center gap-2 overflow-x-auto border-b border-border bg-sidebar px-2 [scrollbar-width:none]">
    <div class="flex rounded border border-border bg-input/40 p-0.5" role="tablist" aria-label="Build manuscript surfaces">
      {#each surfaces as item, index (item.id)}
        <button type="button" role="tab" id={`build-manuscript-tab-${item.id}`} aria-controls={`build-manuscript-panel-${item.id}`} aria-selected={surface === item.id} tabindex={surface === item.id ? 0 : -1} onclick={() => (surface = item.id)} onkeydown={(event) => moveSurface(event, index)} class={cn('inline-flex h-8 shrink-0 items-center gap-1.5 rounded-sm px-2 text-[10px] outline-none focus-visible:ring-2 focus-visible:ring-accent', surface === item.id ? 'bg-accent text-accent-foreground' : 'text-muted-foreground hover:text-foreground')}><item.icon class="size-3" />{item.label}</button>
      {/each}
    </div>
    <span class="ml-auto shrink-0 font-mono text-[9px] uppercase text-muted-foreground">{run.branchName}</span>
  </header>

  {#if error}<div class="flex items-center gap-2 border-b border-destructive/30 bg-destructive/8 px-3 py-2 text-[10px] text-destructive-foreground" role="alert"><AlertTriangle class="size-3.5" />{error}</div>{/if}

  {#if surface === 'manuscript'}
    <div id="build-manuscript-panel-manuscript" role="tabpanel" aria-labelledby="build-manuscript-tab-manuscript" class="flex min-h-0 flex-1 flex-col lg:flex-row">
      <aside class="max-h-48 shrink-0 overflow-y-auto border-b border-border bg-sidebar/45 lg:max-h-none lg:w-64 lg:border-b-0 lg:border-r" aria-label="Build manuscript units">
        {#if activeUnits.length === 0}
          <div class="px-4 py-10 text-center text-[11px] leading-relaxed text-muted-foreground">No branch manuscript units exist yet. Planning remains inspectable while the drafter has not emitted prose.</div>
        {:else}
          <div class="divide-y divide-border/50">
            {#each activeUnits as unit (unit.id)}
              <button type="button" onclick={() => (selectedUnitId = unit.id)} class={cn('grid w-full grid-cols-[1fr_auto] gap-2 py-2 pr-3 text-left outline-none hover:bg-muted/35 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent', unit.kind === 'scene' ? 'pl-7' : 'pl-3', selectedUnit?.id === unit.id && 'bg-accent/7')}>
                <span class="min-w-0"><span class="block truncate text-[11px] font-medium text-foreground">{unit.title}</span><span class="block truncate font-mono text-[9px] uppercase text-muted-foreground">{unit.kind} · {unit.key}</span></span>
                <span class="text-right font-mono text-[9px] text-muted-foreground">{unit.wordCount}<br />{unit.status}</span>
              </button>
            {/each}
          </div>
        {/if}
      </aside>

      <div class="flex min-h-0 min-w-0 flex-1 flex-col">
        <div class="flex shrink-0 flex-wrap items-center gap-2 border-b border-border px-3 py-2">
          <div class="flex rounded border border-border bg-input/40 p-0.5" aria-label="Branch editor mode">
            {#each [{id:'read',label:'Read',icon:BookOpenText},{id:'write',label:'Write',icon:PencilLine},{id:'source',label:'Source',icon:Braces}] as item (item.id)}
              <button type="button" aria-pressed={mode === item.id} onclick={() => (mode = item.id as EditorMode)} class={cn('inline-flex h-7 items-center gap-1 rounded-sm px-2 text-[10px] outline-none focus-visible:ring-2 focus-visible:ring-accent', mode === item.id ? 'bg-accent text-accent-foreground' : 'text-muted-foreground hover:text-foreground')}><item.icon class="size-3" />{item.label}</button>
            {/each}
          </div>
          <button type="button" onclick={() => void onCompile(run.latestCheckpoint?.id)} disabled={busy || activeUnits.length === 0} class="ml-auto inline-flex h-8 items-center gap-1 rounded border border-border px-2 text-[10px] text-foreground outline-none hover:border-accent/50 disabled:opacity-40 focus-visible:ring-2 focus-visible:ring-accent">{#if busy}<LoaderCircle class="size-3 animate-spin" />{:else}<Columns3 class="size-3" />{/if}Compile snapshot</button>
        </div>

        {#if selectedUnit && mode !== 'read'}
          <div class="grid shrink-0 gap-2 border-b border-border bg-sidebar/25 p-3 sm:grid-cols-[1fr_8rem_7rem]">
            <label><span class="mb-1 block text-[9px] uppercase text-muted-foreground">Title</span><input bind:value={titleDraft} class="h-8 w-full rounded border border-border bg-input/50 px-2 text-[11px] text-foreground outline-none focus-visible:border-accent" /></label>
            <label><span class="mb-1 block text-[9px] uppercase text-muted-foreground">Status</span><select bind:value={statusDraft} class="h-8 w-full rounded border border-border bg-input/50 px-2 text-[10px] text-foreground"><option value="planned">planned</option><option value="drafting">drafting</option><option value="review">review</option><option value="accepted">accepted</option></select></label>
            <label><span class="mb-1 block text-[9px] uppercase text-muted-foreground">Tension (0–1)</span><input bind:value={tensionDraft} type="number" min="0" max="1" step="0.05" class="h-8 w-full rounded border border-border bg-input/50 px-2 font-mono text-[10px] text-foreground" /></label>
          </div>
        {/if}

        <div class="min-h-0 flex-1 overflow-y-auto">
          {#if activeUnits.length === 0}
            <div class="flex min-h-64 items-center justify-center p-8 text-center text-xs text-muted-foreground">The build branch is empty.</div>
          {:else if mode === 'read'}
            <div class="mx-auto max-w-[52rem] px-4 py-8 sm:px-8">
              {#each readingUnits as unit (unit.id)}
                <article class="mb-12" aria-labelledby={`build-unit-${unit.id}`}>
                  <div class="mb-4 flex items-baseline gap-2"><span class="font-mono text-[9px] uppercase text-accent">{unit.kind} {unit.chapterNumber ?? unit.order + 1}</span><h2 id={`build-unit-${unit.id}`} class="font-serif text-xl font-semibold text-foreground">{unit.title}</h2></div>
                  <div class="font-serif text-[17px] leading-[1.8] text-foreground/95"><MarkdownPreview content={unit.body || '*No prose drafted yet.*'} /></div>
                </article>
              {/each}
            </div>
          {:else if selectedUnit}
            <div class="grid min-h-full lg:grid-cols-[minmax(0,1fr)_20rem]">
              <label class="min-h-[28rem] border-b border-border lg:border-b-0 lg:border-r"><span class="sr-only">{selectedUnit.title} branch prose</span><textarea data-build-unit-editor={selectedUnit.id} bind:value={bodyDraft} spellcheck={mode === 'write'} class={cn('block size-full min-h-[28rem] resize-none bg-transparent p-5 outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent/30', mode === 'write' ? 'font-serif text-[17px] leading-[1.8] text-foreground' : 'font-mono text-[11px] leading-relaxed text-foreground/90')}></textarea></label>
              <label class="min-h-48"><span class="block border-b border-border px-3 py-2 text-[9px] uppercase tracking-wide text-muted-foreground">Structured metadata</span><textarea bind:value={metadataDraft} spellcheck="false" class="block size-full min-h-48 resize-none bg-sidebar/25 p-3 font-mono text-[10px] leading-relaxed text-foreground/80 outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent/30"></textarea></label>
            </div>
          {/if}
        </div>
        {#if mode !== 'read' && selectedUnit}
          <footer class="flex shrink-0 items-center gap-2 border-t border-border p-2">{#if editError}<span class="min-w-0 flex-1 truncate text-[10px] text-destructive-foreground" role="alert">{editError}</span>{:else}<span class="min-w-0 flex-1 font-mono text-[9px] text-muted-foreground">head {selectedUnit.headVersionId ?? '—'} · rev {selectedUnit.revision}</span>{/if}<button type="button" onclick={() => void saveUnit()} disabled={busy} class="inline-flex h-8 items-center gap-1 rounded bg-accent px-3 text-[10px] font-medium text-accent-foreground outline-none disabled:opacity-50 focus-visible:ring-2 focus-visible:ring-accent"><Save class="size-3" />Save branch unit</button></footer>
        {/if}
      </div>
    </div>
  {:else if surface === 'comparison'}
    <div id="build-manuscript-panel-comparison" role="tabpanel" aria-labelledby="build-manuscript-tab-comparison" class="flex min-h-0 flex-1 flex-col lg:flex-row">
      <aside class="max-h-48 shrink-0 overflow-y-auto border-b border-border bg-sidebar/40 lg:max-h-none lg:w-72 lg:border-b-0 lg:border-r">
        <div class="flex items-center gap-2 border-b border-border p-2"><span class="flex-1 text-[10px] text-muted-foreground">{comparison?.prose.filter((item) => item.changed).length ?? 0} changed units</span><button type="button" onclick={() => void onCompare()} class="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground" aria-label="Refresh comparison"><RefreshCw class="size-3.5" /></button></div>
        {#each comparison?.prose ?? [] as diff (diff.unitId)}<button type="button" onclick={() => (selectedDiffId = diff.unitId)} class={cn('flex w-full items-center gap-2 border-b border-border/50 px-3 py-2 text-left text-[10px] outline-none hover:bg-muted/35 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent', selectedDiff?.unitId === diff.unitId && 'bg-accent/7')}><span class={cn('size-2 rounded-full', diff.changed ? 'bg-amber-400' : 'bg-emerald-400')}></span><span class="min-w-0 flex-1 truncate">{diff.title}</span><span class="font-mono text-muted-foreground">{diff.wordDelta >= 0 ? '+' : ''}{diff.wordDelta}</span></button>{/each}
      </aside>
      <div class="min-h-0 min-w-0 flex-1 overflow-y-auto p-3 sm:p-5">
        {#if !comparison}<div class="flex min-h-64 flex-col items-center justify-center text-center"><FileDiff class="size-7 text-muted-foreground/40" /><p class="mt-3 text-xs text-foreground">Compile the branch to compare it with main.</p><button type="button" onclick={() => void onCompare()} class="mt-3 rounded border border-border px-3 py-1.5 text-[10px] text-foreground">Refresh comparison</button></div>
        {:else if selectedDiff}<div><div class="mb-3 flex items-baseline justify-between"><h2 class="font-serif text-lg font-semibold text-foreground">{selectedDiff.title}</h2><span class="font-mono text-[9px] uppercase text-muted-foreground">{selectedDiff.kind} · {selectedDiff.wordDelta >= 0 ? '+' : ''}{selectedDiff.wordDelta} words</span></div><div class="grid gap-px overflow-hidden rounded border border-border bg-border lg:grid-cols-2"><section class="min-w-0 bg-background"><h3 class="border-b border-border px-3 py-2 text-[9px] uppercase text-muted-foreground">Main</h3><pre class="max-h-[32rem] overflow-auto whitespace-pre-wrap p-4 font-mono text-[10px] leading-relaxed text-foreground/75">{selectedDiff.mainBody || '—'}</pre></section><section class="min-w-0 bg-background"><h3 class="border-b border-border px-3 py-2 text-[9px] uppercase text-accent">Build branch</h3><pre class="max-h-[32rem] overflow-auto whitespace-pre-wrap p-4 font-mono text-[10px] leading-relaxed text-foreground/90">{selectedDiff.buildBody || '—'}</pre></section></div></div>{/if}
        {#if comparison}<section class="mt-5 border-t border-border pt-4"><h3 class="text-[9px] font-semibold uppercase tracking-wide text-muted-foreground">Semantic change set</h3><div class="mt-2 grid gap-2 sm:grid-cols-2 xl:grid-cols-5">{#each [['Canon added',comparison.semantic.addedCanonFactIds],['State changed',comparison.semantic.changedEntityStateIds],['Timeline',comparison.semantic.timelineEventIds],['Open loops',comparison.semantic.unresolvedOpenLoopIds],['Active threads',comparison.semantic.activePlotThreadIds]] as item (item[0])}<div class="border-l border-border pl-2"><span class="text-[9px] uppercase text-muted-foreground">{item[0]}</span><span class="mt-0.5 block font-mono text-sm text-foreground">{item[1].length}</span></div>{/each}</div></section>{/if}
      </div>
    </div>
  {:else}
    <div id="build-manuscript-panel-review" role="tabpanel" aria-labelledby="build-manuscript-tab-review" class="min-h-0 flex-1 overflow-y-auto p-4 sm:p-7">
      <div class="mx-auto max-w-3xl">
        <div class="border-l-2 border-accent pl-4"><h2 class="font-serif text-2xl font-semibold text-foreground">Review the branch before main changes.</h2><p class="mt-2 text-xs leading-relaxed text-muted-foreground">Compilation freezes exact unit versions. Approval records intent; merge checks main branch heads again before applying anything.</p></div>
        {#if !compilation}<div class="mt-6 rounded border border-border bg-sidebar p-4"><p class="text-xs text-foreground">No compilation snapshot yet.</p><button type="button" onclick={() => void onCompile(run.latestCheckpoint?.id)} disabled={busy || activeUnits.length === 0} class="mt-3 inline-flex h-8 items-center gap-1 rounded bg-accent px-3 text-[10px] font-medium text-accent-foreground disabled:opacity-50"><Columns3 class="size-3" />Compile branch</button></div>
        {:else}<div class="mt-6 grid gap-3 sm:grid-cols-4"><div class="border-l border-border pl-3"><span class="text-[9px] uppercase text-muted-foreground">Compilation</span><span class="mt-1 block truncate font-mono text-[10px] text-foreground">{compilation.id}</span></div><div class="border-l border-border pl-3"><span class="text-[9px] uppercase text-muted-foreground">Units</span><span class="mt-1 block font-mono text-sm text-foreground">{compilation.units.length}</span></div><div class="border-l border-border pl-3"><span class="text-[9px] uppercase text-muted-foreground">Words</span><span class="mt-1 block font-mono text-sm text-foreground">{compilation.totalWordCount.toLocaleString()}</span></div><div class="border-l border-border pl-3"><span class="text-[9px] uppercase text-muted-foreground">Snapshot hash</span><span class="mt-1 block truncate font-mono text-[10px] text-foreground" title={compilation.contentHash}>{compilation.contentHash}</span></div></div>{/if}

        {#if compilation && (!latestReview || latestReview.compilationId !== compilation.id)}<div class="mt-6 space-y-3 border-t border-border pt-5"><label><span class="mb-1 block text-[9px] uppercase text-muted-foreground">Review title</span><input bind:value={reviewTitle} class="h-9 w-full rounded border border-border bg-input/50 px-2 text-xs text-foreground" /></label><label><span class="mb-1 block text-[9px] uppercase text-muted-foreground">Message</span><textarea bind:value={reviewMessage} rows="4" class="w-full rounded border border-border bg-input/40 p-2 text-xs text-foreground"></textarea></label><button type="button" onclick={() => void createReview()} disabled={busy} class="inline-flex h-8 items-center gap-1 rounded bg-accent px-3 text-[10px] font-medium text-accent-foreground disabled:opacity-50"><ShieldCheck class="size-3" />Open review</button></div>{/if}

        {#if latestReview}
          <article class="mt-6 rounded border border-border bg-sidebar">
            <header class="flex items-start gap-3 border-b border-border p-4"><span class={cn('mt-1 size-2 rounded-full', latestReview.status === 'merged' ? 'bg-emerald-400' : latestReview.status === 'rejected' ? 'bg-destructive' : latestReview.status === 'approved' ? 'bg-accent' : 'bg-amber-400')}></span><div class="min-w-0 flex-1"><h3 class="text-sm font-medium text-foreground">{latestReview.title}</h3><p class="mt-0.5 font-mono text-[9px] uppercase text-muted-foreground">{latestReview.status} · rev {latestReview.revision} · {latestReview.units.length} units</p></div></header>
            <div class="p-4">{#if latestReview.message}<p class="text-xs leading-relaxed text-muted-foreground">{latestReview.message}</p>{/if}{#if latestReview.rejectionReason}<div class="mt-3 border-l-2 border-destructive bg-destructive/7 px-3 py-2"><span class="block text-[9px] uppercase tracking-wide text-destructive-foreground">Rejection reason</span><p class="mt-1 text-xs leading-relaxed text-foreground">{latestReview.rejectionReason}</p></div>{/if}<ol class="mt-3 divide-y divide-border/50">{#each latestReview.units as unit (unit.id)}<li><button type="button" onclick={() => (selectedReviewUnitId = unit.id)} class={cn('flex w-full items-center gap-2 py-2 text-left text-[10px] outline-none focus-visible:ring-2 focus-visible:ring-accent', selectedReviewUnit?.id === unit.id && 'text-accent')}><ChevronRight class="size-3 shrink-0 text-muted-foreground" /><span class="min-w-0 flex-1 truncate">{unit.action} {reviewUnitTitle(unit)}</span><span class="font-mono text-muted-foreground">{unit.reviewedWordCount.toLocaleString()} words · {unit.resultMainVersionId ? 'merged' : 'pending'}</span></button></li>{/each}</ol>
              {#if selectedReviewUnit}
                {@const frozenSnapshot = reviewSnapshot(selectedReviewUnit)}
                {@const mainChanged = Boolean(selectedReviewDiff && selectedReviewDiff.mainVersionId !== selectedReviewUnit.expectedMainHeadVersionId)}
                <section class="mt-4 border-t border-border pt-4" aria-label="Immutable reviewed prose">
                  <div class="flex flex-wrap items-start justify-between gap-2"><div><h4 class="text-[10px] font-semibold uppercase tracking-wide text-foreground">Immutable reviewed snapshot</h4><p class="mt-0.5 font-mono text-[9px] text-muted-foreground">build version {selectedReviewUnit.sourceBuildVersionId} · unit rev {selectedReviewUnit.reviewedUnitRevision}</p></div><span class="max-w-52 truncate font-mono text-[9px] text-muted-foreground" title={selectedReviewUnit.reviewedContentHash}>{selectedReviewUnit.reviewedContentHash}</span></div>
                  {#if mainChanged}<div class="mt-3 border-l-2 border-amber-400 bg-amber-400/8 px-3 py-2 text-[10px] text-foreground" role="status">Main changed after this review was frozen. The reviewed branch below is immutable; merge will enforce the recorded main head.</div>{/if}
                  <div class="mt-3 grid gap-px overflow-hidden rounded border border-border bg-border lg:grid-cols-2">
                    <section class="min-w-0 bg-background"><h5 class="border-b border-border px-3 py-2 text-[9px] uppercase text-muted-foreground">{mainChanged ? 'Current main (changed)' : 'Main at comparison'}</h5><pre class="max-h-80 overflow-auto whitespace-pre-wrap p-4 font-mono text-[10px] leading-relaxed text-foreground/75">{selectedReviewDiff?.mainBody || 'No mapped main prose — this review creates a new unit.'}</pre></section>
                    <section class="min-w-0 bg-background"><h5 class="border-b border-border px-3 py-2 text-[9px] uppercase text-accent">Reviewed build · frozen · {selectedReviewUnit.reviewedWordCount.toLocaleString()} words</h5><pre class="max-h-80 overflow-auto whitespace-pre-wrap p-4 font-mono text-[10px] leading-relaxed text-foreground/90">{selectedReviewUnit.reviewedBody || '—'}</pre></section>
                  </div>
                  <div class="mt-2 flex flex-wrap gap-x-4 font-mono text-[9px] text-muted-foreground"><span>{selectedReviewUnit.reviewedWordCount - countWords(selectedReviewDiff?.mainBody ?? '') >= 0 ? '+' : ''}{selectedReviewUnit.reviewedWordCount - countWords(selectedReviewDiff?.mainBody ?? '')} words vs main</span><span>snapshot {selectedReviewUnit.reviewedUnitSnapshotHash}</span></div>
                  <details class="mt-3"><summary class="cursor-pointer text-[9px] uppercase tracking-wide text-muted-foreground">Frozen structured metadata</summary><pre class="mt-2 max-h-56 overflow-auto whitespace-pre-wrap rounded border border-border bg-background p-3 font-mono text-[9px] text-foreground/75">{JSON.stringify(frozenSnapshot, null, 2)}</pre></details>
                </section>
              {/if}
              <div class="mt-4 flex flex-wrap gap-2">{#if latestReview.status === 'open'}<button type="button" onclick={(event) => openReviewDecision('approve', event)} disabled={busy} class="inline-flex h-8 items-center gap-1 rounded bg-accent px-3 text-[10px] font-medium text-accent-foreground disabled:opacity-50"><Check class="size-3" />Approve review</button>{/if}{#if latestReview.status === 'approved'}<button type="button" onclick={(event) => openReviewDecision('merge', event)} disabled={busy} class="inline-flex h-8 items-center gap-1 rounded bg-emerald-500 px-3 text-[10px] font-medium text-black disabled:opacity-50"><GitMerge class="size-3" />Merge into main</button>{/if}{#if latestReview.status !== 'merged' && latestReview.status !== 'rejected'}<button type="button" onclick={(event) => openReviewDecision('reject', event)} disabled={busy} class="inline-flex h-8 items-center gap-1 rounded border border-destructive/50 px-3 text-[10px] text-destructive-foreground disabled:opacity-50"><AlertTriangle class="size-3" />Reject branch</button>{/if}</div>
              {#if reviewDecision}
                <div class="fixed inset-0 z-[80] flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm" role="presentation" onclick={(event) => event.target === event.currentTarget && closeReviewDecision()}>
                  <div bind:this={reviewDialog} role="alertdialog" aria-modal="true" aria-label={`Confirm ${reviewDecision} review`} tabindex="-1" onkeydown={handleReviewDialogKeydown} class="w-full max-w-md rounded border border-amber-400/45 bg-card p-4 shadow-2xl outline-none focus-visible:ring-2 focus-visible:ring-amber-300">
                    <p class="text-sm leading-relaxed text-foreground">{reviewDecision === 'merge' ? 'Merge this approved compilation into main? Main-head conflicts will stop the merge.' : reviewDecision === 'approve' ? 'Approve this exact compilation for merge?' : 'Reject this branch review? The branch remains inspectable, but this review cannot be merged.'}</p>
                    {#if reviewDecision === 'reject'}<label class="mt-3 block"><span class="mb-1 block text-[10px] uppercase text-muted-foreground">Reason</span><textarea bind:value={rejectReason} rows="3" class="w-full rounded border border-border bg-input/50 p-2 text-xs text-foreground"></textarea></label>{/if}
                    <div class="mt-4 flex justify-end gap-2"><button type="button" onclick={closeReviewDecision} class="rounded border border-border px-3 py-1.5 text-[11px] text-muted-foreground">Go back</button><button type="button" onclick={() => void commitReviewDecision()} disabled={busy || (reviewDecision === 'reject' && !rejectReason.trim())} class="rounded bg-amber-400 px-3 py-1.5 text-[11px] font-medium text-black disabled:opacity-50">Confirm {reviewDecision}</button></div>
                  </div>
                </div>
              {/if}
            </div>
          </article>
        {/if}
      </div>
    </div>
  {/if}
</section>
