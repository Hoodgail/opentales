<script lang="ts">
  import {
    AlertTriangle,
    Ban,
    BookOpenText,
    Milestone,
    CircleDollarSign,
    CirclePause,
    GitBranch,
    Pause,
    Play,
    Plus,
    RefreshCw,
    Workflow
  } from 'lucide-svelte';
  import { tick } from 'svelte';
  import type {
    BuildCheckpoint,
    BuildDirective,
    BuildComparison,
    BuildCompilation,
    BuildEvaluationResult,
    BuildManuscriptUnit,
    BuildReview,
    BuildRun,
    BuildTask,
    BuildTrace,
    CreateBuildRunInput,
    ProjectDoc,
    StoryArtifact,
    PatchBuildManuscriptUnitInput
  } from '@opentales/sdk';
  import { compactNumber } from '$lib/story-ide-model';
  import { storyUi } from '$lib/stores/storyUi.svelte';
  import { cn } from '$lib/utils';
  import BuildDependencyGraph from './BuildDependencyGraph.svelte';
  import BuildTaskInspector from './BuildTaskInspector.svelte';
  import BuildManuscriptWorkspace from './BuildManuscriptWorkspace.svelte';
  import NovelBuildStart from './NovelBuildStart.svelte';

  interface Props {
    run: BuildRun | null;
    brainstorms: ProjectDoc[];
    artifacts?: StoryArtifact[];
    traces?: BuildTrace[];
    evaluations?: BuildEvaluationResult[];
    checkpoints?: BuildCheckpoint[];
    directives?: BuildDirective[];
    units?: BuildManuscriptUnit[];
    compilation?: BuildCompilation | null;
    comparison?: BuildComparison | null;
    reviews?: BuildReview[];
    loading?: boolean;
    mutating?: boolean;
    error?: string | null;
    connection?: 'idle' | 'syncing' | 'connected' | 'reconnecting' | 'stale';
    lastUpdatedAt?: string | null;
    onStart: (input: CreateBuildRunInput) => unknown | Promise<unknown>;
    onNew: () => void;
    onRefresh: () => void;
    onPause: (run: BuildRun) => void | Promise<void>;
    onAuthorize: (run: BuildRun) => void | Promise<void>;
    onResume: (run: BuildRun) => void | Promise<void>;
    onCancel: (run: BuildRun) => void | Promise<void>;
    onRetry: (task: BuildTask) => void | Promise<void>;
    onRerun: (task: BuildTask, reason?: string) => void | Promise<void>;
    onReplan: (task: BuildTask, directive: string, checkpointId: string | null, pinnedArtifactIds: string[]) => void | Promise<void>;
    onPatchUnit: (unit: BuildManuscriptUnit, input: Omit<PatchBuildManuscriptUnitInput, 'idempotencyKey' | 'expectedBuildRevision' | 'expectedUnitRevision' | 'expectedHeadVersionId'>) => Promise<BuildManuscriptUnit | null>;
    onCompile: (checkpointId?: string | null) => Promise<BuildCompilation | null>;
    onCompare: () => Promise<BuildComparison | null>;
    onCreateReview: (input: { compilationId: string; checkpointId?: string | null; title: string; message?: string }) => Promise<BuildReview | null>;
    onApproveReview: (review: BuildReview) => Promise<BuildReview | null>;
    onMergeReview: (review: BuildReview) => Promise<BuildReview | null>;
    onRejectReview: (review: BuildReview, reason: string) => Promise<BuildReview | null>;
    onCheckpoint?: (run: BuildRun) => void | Promise<void>;
    onArtifact?: (artifact: StoryArtifact) => void;
  }

  let {
    run,
    brainstorms,
    artifacts = [],
    traces = [],
    evaluations = [],
    checkpoints = [],
    directives = [],
    units = [],
    compilation = null,
    comparison = null,
    reviews = [],
    loading = false,
    mutating = false,
    error = null,
    connection = 'idle',
    lastUpdatedAt = null,
    onStart,
    onNew,
    onRefresh,
    onPause,
    onAuthorize,
    onResume,
    onCancel,
    onRetry,
    onRerun,
    onReplan,
    onPatchUnit,
    onCompile,
    onCompare,
    onCreateReview,
    onApproveReview,
    onMergeReview,
    onRejectReview,
    onCheckpoint = () => undefined,
    onArtifact = () => undefined
  }: Props = $props();

  let selectedTaskId = $state<string | null>(null);
  let runSeen = $state<string | null>(null);
  let confirmAction = $state<{ kind: 'rerun' | 'cancel'; task?: BuildTask } | null>(null);
  let replanAction = $state<{ task: BuildTask; directive: string; checkpointId: string; pinnedArtifactIds: Set<string> } | null>(null);
  let workspace = $state<'execution' | 'manuscript'>('execution');
  let mobilePane = $state<'graph' | 'task'>('graph');
  let manifestOpen = $state(false);
  let handledBuildRequest = $state(0);
  let actionDialog: HTMLElement | undefined = $state();
  let actionReturnFocus: HTMLElement | null = null;
  const selectedTask = $derived(run?.tasks.find((task) => task.id === selectedTaskId) ?? run?.tasks.find((task) => task.status === 'running') ?? null);

  $effect(() => {
    if (!run || run.id === runSeen) return;
    runSeen = run.id;
    selectedTaskId = run.tasks.find((task) => task.status === 'running')?.id
      ?? run.tasks.find((task) => task.status === 'ready')?.id
      ?? run.tasks.find((task) => task.status === 'failed')?.id
      ?? run.tasks[0]?.id
      ?? null;
    confirmAction = null;
    replanAction = null;
  });

  $effect(() => {
    const request = storyUi.buildSurfaceRequest;
    if (!request || request.nonce === handledBuildRequest) return;
    handledBuildRequest = request.nonce;
    workspace = 'manuscript';
  });

  const graphTasks = $derived((run?.tasks ?? []).map((task) => ({
    id: task.id,
    key: task.key,
    type: task.type,
    phase: task.phase,
    status: task.status,
    dependencyIds: task.dependencyIds,
    progress: task.progress,
    attempts: task.attempts,
    maxAttempts: task.maxAttempts
  })));

  function downstream(task: BuildTask): BuildTask[] {
    if (!run) return [];
    const found = new Set<string>();
    const queue = [task.id];
    while (queue.length) {
      const current = queue.shift()!;
      for (const candidate of run.tasks) {
        if (candidate.dependencyIds.includes(current) && !found.has(candidate.id)) {
          found.add(candidate.id);
          queue.push(candidate.id);
        }
      }
    }
    return run.tasks.filter((candidate) => found.has(candidate.id));
  }

  async function commitConfirmed() {
    if (!confirmAction || !run) return;
    const action = confirmAction;
    if (action.kind === 'cancel') await onCancel(run);
    else if (action.task) await onRerun(action.task, 'Human requested a clean rerun of this task.');
    closeActionDialog();
  }

  async function commitReplan() {
    if (!replanAction || !replanAction.directive.trim()) return;
    const action = replanAction;
    await onReplan(action.task, action.directive, action.checkpointId || null, [...action.pinnedArtifactIds]);
    closeActionDialog();
  }

  function openConfirm(action: { kind: 'rerun' | 'cancel'; task?: BuildTask }, event?: MouseEvent) {
    actionReturnFocus = event?.currentTarget instanceof HTMLElement ? event.currentTarget : null;
    confirmAction = action;
    void tick().then(() => actionDialog?.focus());
  }

  function openReplan(task: BuildTask, event?: MouseEvent) {
    actionReturnFocus = event?.currentTarget instanceof HTMLElement ? event.currentTarget : null;
    replanAction = { task, directive: '', checkpointId: run?.latestCheckpoint?.id ?? '', pinnedArtifactIds: new Set() };
    void tick().then(() => actionDialog?.focus());
  }

  function closeActionDialog() {
    confirmAction = null;
    replanAction = null;
    const target = actionReturnFocus;
    actionReturnFocus = null;
    void tick().then(() => target?.isConnected && target.focus());
  }

  function handleActionDialogKeydown(event: KeyboardEvent) {
    if (event.key === 'Escape') { event.preventDefault(); closeActionDialog(); return; }
    if (event.key !== 'Tab' || !actionDialog) return;
    const focusable = [...actionDialog.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])')];
    if (!focusable.length) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  }

  function moveMobilePane(event: KeyboardEvent, pane: 'graph' | 'task') {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    mobilePane = event.key === 'ArrowLeft' || event.key === 'Home' ? 'graph' : 'task';
    if (pane === mobilePane && (event.key === 'ArrowLeft' || event.key === 'ArrowRight')) {
      mobilePane = pane === 'graph' ? 'task' : 'graph';
    }
    requestAnimationFrame(() => document.getElementById(`build-pane-tab-${mobilePane}`)?.focus());
  }
</script>

{#if !run}
  <NovelBuildStart {brainstorms} {loading} {error} onStart={onStart} />
{:else}
  <section class="flex min-h-0 flex-1 flex-col bg-background" aria-label="Novel Build execution">
    <header class="shrink-0 border-b border-border bg-sidebar">
      <div class="flex min-h-12 flex-wrap items-center gap-3 px-3 py-2 sm:px-4">
        <div class="flex min-w-0 items-center gap-2"><Workflow class={cn('size-4 shrink-0', ['failed','cancelled'].includes(run.status) ? 'text-destructive' : 'text-accent')} /><div class="min-w-0"><h1 class="truncate text-xs font-semibold text-foreground">{run.objective}</h1><p class="font-mono text-[9px] uppercase tracking-wide text-muted-foreground">{run.branchName} · {run.currentPhase} · rev {run.revision}</p></div></div>
        <div class="flex shrink-0 rounded border border-border bg-input/40 p-0.5" aria-label="Novel Build workspace">
          <button type="button" aria-pressed={workspace === 'execution'} onclick={() => (workspace = 'execution')} class={cn('inline-flex h-7 items-center gap-1 rounded-sm px-2 text-[10px] outline-none focus-visible:ring-2 focus-visible:ring-accent', workspace === 'execution' ? 'bg-accent text-accent-foreground' : 'text-muted-foreground hover:text-foreground')}><Workflow class="size-3" />Execution</button>
          <button type="button" aria-pressed={workspace === 'manuscript'} onclick={() => (workspace = 'manuscript')} class={cn('inline-flex h-7 items-center gap-1 rounded-sm px-2 text-[10px] outline-none focus-visible:ring-2 focus-visible:ring-accent', workspace === 'manuscript' ? 'bg-accent text-accent-foreground' : 'text-muted-foreground hover:text-foreground')}><BookOpenText class="size-3" />Branch</button>
        </div>
        <div class="ml-auto flex shrink-0 items-center gap-1">
          <span class={cn('hidden items-center gap-1 rounded border px-2 py-1 font-mono text-[9px] sm:inline-flex', connection === 'stale' ? 'border-destructive/50 text-destructive-foreground' : connection === 'reconnecting' ? 'border-amber-400/50 text-amber-300' : 'border-border text-muted-foreground')} title={lastUpdatedAt ? `Last synchronized ${new Date(lastUpdatedAt).toLocaleTimeString()}` : 'Not synchronized yet'}><span class={cn('size-1.5 rounded-full', connection === 'connected' ? 'bg-emerald-400' : connection === 'syncing' ? 'bg-accent motion-safe:animate-pulse' : connection === 'stale' ? 'bg-destructive' : 'bg-amber-400')}></span>{connection}</span>
          <button type="button" onclick={onNew} class="inline-flex h-8 items-center gap-1 rounded border border-border px-2 text-[10px] text-foreground outline-none hover:border-accent/50 focus-visible:ring-2 focus-visible:ring-accent"><Plus class="size-3" />New</button>
          <button type="button" onclick={onRefresh} disabled={loading} aria-label="Refresh build" class="flex size-8 items-center justify-center rounded border border-border text-muted-foreground outline-none hover:text-foreground disabled:opacity-40 focus-visible:ring-2 focus-visible:ring-accent"><RefreshCw class={cn('size-3.5', loading && 'motion-safe:animate-spin')} /></button>
          {#if !['completed','cancelled'].includes(run.status)}
            {#if run.authorizedAt}
              {#if run.status === 'paused' || run.status === 'failed'}<button type="button" onclick={() => void onResume(run)} disabled={mutating} class="inline-flex h-8 items-center gap-1 rounded bg-accent px-2 text-[10px] font-medium text-accent-foreground outline-none disabled:opacity-50 focus-visible:ring-2 focus-visible:ring-accent"><Play class="size-3" />Resume</button>{:else}<button type="button" onclick={() => void onPause(run)} disabled={mutating} class="inline-flex h-8 items-center gap-1 rounded border border-border px-2 text-[10px] text-foreground outline-none hover:border-accent/50 disabled:opacity-50 focus-visible:ring-2 focus-visible:ring-accent"><Pause class="size-3" />Pause</button>{/if}
            {/if}
            <button type="button" onclick={(event) => openConfirm({ kind: 'cancel' }, event)} disabled={mutating} class="inline-flex h-8 items-center gap-1 rounded border border-destructive/40 px-2 text-[10px] text-destructive-foreground outline-none hover:bg-destructive/10 disabled:opacity-50 focus-visible:ring-2 focus-visible:ring-destructive"><Ban class="size-3" />Cancel</button>
          {/if}
          <button type="button" onclick={() => void onCheckpoint(run)} disabled={mutating || run.status === 'cancelled'} title="Create immutable checkpoint" class="flex size-8 items-center justify-center rounded border border-border text-muted-foreground outline-none hover:text-foreground disabled:opacity-40 focus-visible:ring-2 focus-visible:ring-accent"><Milestone class="size-3.5" /></button>
        </div>
      </div>
      <div class={cn('grid grid-cols-2 border-t border-border sm:grid-cols-4', workspace === 'manuscript' && 'hidden')}>
        <div class="border-r border-border px-3 py-2"><span class="block text-[9px] uppercase tracking-wide text-muted-foreground">Progress</span><span class="mt-0.5 block font-mono text-sm text-accent">{run.progress.percent}%</span></div>
        <div class="border-r border-border px-3 py-2"><span class="block text-[9px] uppercase tracking-wide text-muted-foreground">Tasks</span><span class="mt-0.5 block font-mono text-sm text-foreground">{run.progress.done}<span class="text-muted-foreground">/{run.progress.total}</span></span></div>
        <div class="border-r border-t border-border px-3 py-2 sm:border-t-0"><span class="block text-[9px] uppercase tracking-wide text-muted-foreground">Tokens <span class="normal-case">used + reserved</span></span><span class="mt-0.5 block font-mono text-sm text-foreground">{compactNumber(run.tokensUsed)} + {compactNumber(run.tokensReserved)}<span class="text-muted-foreground">/{compactNumber(run.maxTokens)}</span></span></div>
        <div class="border-t border-border px-3 py-2 sm:border-t-0"><span class="block text-[9px] uppercase tracking-wide text-muted-foreground">Cost <span class="normal-case">used + reserved</span></span><span class="mt-0.5 flex items-center gap-1 font-mono text-sm text-foreground"><CircleDollarSign class="size-3 text-muted-foreground" />{(run.costMicrosUsed / 1_000_000).toFixed(2)} + {(run.costMicrosReserved / 1_000_000).toFixed(2)}<span class="text-muted-foreground">/{run.maxCostMicros ? (run.maxCostMicros / 1_000_000).toFixed(2) : '—'}</span></span></div>
      </div>
      <div class="h-1 bg-muted"><span class={cn('block h-full transition-[width] motion-reduce:transition-none', run.status === 'failed' ? 'bg-destructive' : 'bg-accent')} style:width={`${run.progress.percent}%`}></span></div>
    </header>

    {#if error}<div class="flex shrink-0 items-center gap-2 border-b border-destructive/30 bg-destructive/8 px-3 py-2 text-[11px] text-destructive-foreground" role="alert"><AlertTriangle class="size-3.5" />{error}</div>{/if}
    {#if run.lastError}<div class="flex shrink-0 items-center gap-2 border-b border-destructive/30 bg-destructive/8 px-3 py-2 text-[11px] text-destructive-foreground"><AlertTriangle class="size-3.5" />{run.lastError}</div>{/if}
    {#if !run.authorizedAt}
      <div class="shrink-0 border-b border-accent/30 bg-accent/6 px-3 py-2">
        <div class="flex flex-wrap items-center gap-2 text-[11px]"><GitBranch class="size-3.5 shrink-0 text-accent" /><span class="min-w-0 flex-1 text-foreground">The manifest is planned but not authorized. Review its phases, scope, and budget before workers begin.</span><button type="button" onclick={() => (manifestOpen = !manifestOpen)} class="rounded border border-border px-2 py-1 text-[10px] text-foreground outline-none hover:border-accent/50 focus-visible:ring-2 focus-visible:ring-accent">{manifestOpen ? 'Hide manifest' : 'Review manifest'}</button><button type="button" onclick={() => void onAuthorize(run)} disabled={mutating} class="rounded bg-accent px-2 py-1 text-[10px] font-medium text-accent-foreground outline-none disabled:opacity-50 focus-visible:ring-2 focus-visible:ring-accent">Authorize scope</button></div>
        {#if manifestOpen}
          <div class="mt-3 grid gap-4 border-t border-border/60 pt-3 lg:grid-cols-2">
            <section><h2 class="text-[9px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">Workflow phases</h2><ol class="mt-2 space-y-1">{#each run.manifest.phases as phase, index (phase.key)}<li class="grid grid-cols-[1.5rem_1fr_auto] gap-2 text-[10px]"><span class="font-mono text-accent">{String(index + 1).padStart(2,'0')}</span><span class="text-foreground">{phase.title}</span><span class="font-mono text-muted-foreground">{phase.taskKeys.length} tasks{phase.checkpoint ? ' · checkpoint' : ''}</span></li>{/each}</ol></section>
            <section><h2 class="text-[9px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">Authorized capability</h2><dl class="mt-2 grid grid-cols-[8rem_1fr] gap-y-1 text-[10px]"><dt class="text-muted-foreground">Autonomy</dt><dd class="text-foreground">{run.autonomyMode}</dd><dt class="text-muted-foreground">Planning</dt><dd>{run.authorizationScope.allowPlanningArtifacts ? 'allowed' : 'blocked'}</dd><dt class="text-muted-foreground">Chapter writes</dt><dd>{run.authorizationScope.allowChapterWrites ? 'allowed on branch' : 'blocked'}</dd><dt class="text-muted-foreground">Scene writes</dt><dd>{run.authorizationScope.allowSceneWrites ? 'allowed on branch' : 'blocked'}</dd><dt class="text-muted-foreground">Canon writes</dt><dd>{run.authorizationScope.allowCanonWrites ? 'allowed on branch' : 'blocked'}</dd><dt class="text-muted-foreground">Diagnostics</dt><dd>{run.authorizationScope.allowDiagnostics ? 'allowed' : 'blocked'}</dd><dt class="text-muted-foreground">Artifact types</dt><dd class="break-words">{run.authorizationScope.artifactTypes.length ? run.authorizationScope.artifactTypes.join(', ') : 'none'}</dd><dt class="text-muted-foreground">Entity scope</dt><dd>{run.authorizationScope.chapterIds.length || run.authorizationScope.sceneIds.length ? `${run.authorizationScope.chapterIds.length} chapters · ${run.authorizationScope.sceneIds.length} scenes` : 'all planned branch entities'}</dd></dl></section>
          </div>
        {/if}
      </div>
    {/if}

    {#if confirmAction}
      <div class="fixed inset-0 z-[80] flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm" role="presentation" onclick={(event) => event.target === event.currentTarget && closeActionDialog()}>
        <div bind:this={actionDialog} role="alertdialog" aria-modal="true" aria-label="Confirm build action" tabindex="-1" onkeydown={handleActionDialogKeydown} class="w-full max-w-lg rounded border border-amber-400/45 bg-card p-4 shadow-2xl outline-none focus-visible:ring-2 focus-visible:ring-amber-300">
          <div class="flex items-start gap-3"><AlertTriangle class="mt-0.5 size-4 shrink-0 text-amber-400" /><p class="text-sm leading-relaxed text-foreground">{confirmAction.kind === 'cancel' ? 'Cancel this durable run? Completed artifacts remain inspectable, but execution cannot resume.' : `Rerun “${confirmAction.task?.key}”? ${confirmAction.task ? downstream(confirmAction.task).length : 0} downstream tasks and their outputs will be invalidated.`}</p></div>
          <div class="mt-4 flex justify-end gap-2"><button type="button" onclick={closeActionDialog} class="rounded border border-border px-3 py-1.5 text-[11px] text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-accent">Keep current</button><button type="button" onclick={() => void commitConfirmed()} disabled={mutating} class="rounded bg-amber-400 px-3 py-1.5 text-[11px] font-medium text-black outline-none disabled:opacity-50 focus-visible:ring-2 focus-visible:ring-amber-300">{confirmAction.kind === 'cancel' ? 'Cancel run' : 'Invalidate & continue'}</button></div>
        </div>
      </div>
    {/if}

    {#if replanAction}
      <div class="fixed inset-0 z-[80] flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm" role="presentation" onclick={(event) => event.target === event.currentTarget && closeActionDialog()}>
        <div bind:this={actionDialog} role="alertdialog" aria-modal="true" aria-label="Re-plan build" tabindex="-1" onkeydown={handleActionDialogKeydown} class="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded border border-amber-400/45 bg-card p-4 shadow-2xl outline-none focus-visible:ring-2 focus-visible:ring-amber-300">
          <div class="flex items-start gap-2"><AlertTriangle class="mt-0.5 size-4 shrink-0 text-amber-400" /><div class="min-w-0 flex-1"><h2 class="text-sm font-medium text-foreground">Re-plan from {replanAction.task.key}</h2><p class="mt-1 text-[11px] leading-relaxed text-muted-foreground">Only this task and its {downstream(replanAction.task).length} dependents will be invalidated. Describe the creative change; upstream work stays intact.</p></div></div>
          <label class="mt-4 block"><span class="mb-1 block text-[10px] uppercase tracking-wide text-muted-foreground">Creative directive</span><textarea bind:value={replanAction.directive} rows="4" placeholder="Keep everything through Chapter 11. From Chapter 12, Mara refuses Elias…" class="w-full rounded border border-border bg-input/50 p-2 text-xs leading-relaxed text-foreground outline-none focus-visible:border-amber-400 focus-visible:ring-2 focus-visible:ring-amber-400/30"></textarea></label>
          <div class="mt-3 grid gap-3 md:grid-cols-2"><label><span class="mb-1 block text-[10px] uppercase tracking-wide text-muted-foreground">Branch from checkpoint</span><select bind:value={replanAction.checkpointId} class="h-9 w-full rounded border border-border bg-input/50 px-2 text-[11px] text-foreground"><option value="">Current upstream state</option>{#each checkpoints as checkpoint (checkpoint.id)}<option value={checkpoint.id}>{checkpoint.sequence}. {checkpoint.label}</option>{/each}</select></label><fieldset><legend class="mb-1 text-[10px] uppercase tracking-wide text-muted-foreground">Pin accepted artifacts</legend><div class="max-h-36 overflow-y-auto rounded border border-border bg-input/30 p-1">{#each artifacts.filter((artifact) => artifact.status === 'accepted' || artifact.status === 'validated') as artifact (artifact.id)}<label class="flex items-center gap-2 px-1 py-1.5 text-[11px]"><input type="checkbox" checked={replanAction.pinnedArtifactIds.has(artifact.id)} onchange={() => { if (replanAction?.pinnedArtifactIds.has(artifact.id)) replanAction.pinnedArtifactIds.delete(artifact.id); else replanAction?.pinnedArtifactIds.add(artifact.id); }} class="accent-accent" /><span class="min-w-0 flex-1 truncate">{artifact.title}</span><span class="font-mono text-muted-foreground">v{artifact.version}</span></label>{/each}</div></fieldset></div>
          <div class="mt-4 flex justify-end gap-2"><button type="button" onclick={closeActionDialog} class="rounded border border-border px-3 py-1.5 text-[11px] text-muted-foreground">Keep current plan</button><button type="button" onclick={() => void commitReplan()} disabled={!replanAction.directive.trim() || mutating} class="rounded bg-amber-400 px-3 py-1.5 text-[11px] font-medium text-black disabled:opacity-50">Invalidate & re-plan</button></div>
        </div>
      </div>
    {/if}

    {#if workspace === 'execution'}
      <div class="flex shrink-0 border-b border-border xl:hidden" role="tablist" aria-label="Mobile build execution panes"><button type="button" role="tab" id="build-pane-tab-graph" aria-controls="build-pane-panel-graph" aria-selected={mobilePane === 'graph'} tabindex={mobilePane === 'graph' ? 0 : -1} onclick={() => (mobilePane = 'graph')} onkeydown={(event) => moveMobilePane(event, 'graph')} class={cn('flex-1 px-3 py-2 text-[10px] outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent', mobilePane === 'graph' ? 'bg-accent/10 text-accent' : 'text-muted-foreground')}>Dependency graph</button><button type="button" role="tab" id="build-pane-tab-task" aria-controls="build-pane-panel-task" aria-selected={mobilePane === 'task'} tabindex={mobilePane === 'task' ? 0 : -1} onclick={() => (mobilePane = 'task')} onkeydown={(event) => moveMobilePane(event, 'task')} class={cn('flex-1 px-3 py-2 text-[10px] outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent', mobilePane === 'task' ? 'bg-accent/10 text-accent' : 'text-muted-foreground')}>Task details</button></div>
      <div class="flex min-h-0 flex-1 flex-col xl:flex-row">
        <div id="build-pane-panel-graph" role="tabpanel" aria-labelledby="build-pane-tab-graph" class={cn('flex min-h-0 min-w-0 flex-1', mobilePane !== 'graph' && 'hidden xl:flex')}><BuildDependencyGraph tasks={graphTasks} selectedId={selectedTask?.id ?? null} onSelect={(task) => { selectedTaskId = task.id; mobilePane = 'task'; }} /></div>
        <div id="build-pane-panel-task" role="tabpanel" aria-labelledby="build-pane-tab-task" class={cn('flex min-h-0', mobilePane !== 'task' && 'hidden xl:flex')}><BuildTaskInspector task={selectedTask} tasks={run.tasks} {artifacts} {traces} {evaluations} {checkpoints} {directives} busy={mutating} onRetry={(task) => void onRetry(task)} onRerun={(task, event) => openConfirm({ kind: 'rerun', task }, event)} onReplan={(task, event) => openReplan(task, event)} onArtifact={onArtifact} /></div>
      </div>
    {:else}
      <BuildManuscriptWorkspace {run} {units} {compilation} {comparison} {reviews} busy={mutating} {error} onPatchUnit={onPatchUnit} onCompile={onCompile} onCompare={onCompare} onCreateReview={onCreateReview} onApprove={onApproveReview} onMerge={onMergeReview} onReject={onRejectReview} />
    {/if}
  </section>
{/if}
