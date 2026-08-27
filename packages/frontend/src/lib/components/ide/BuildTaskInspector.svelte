<script lang="ts">
  import {
    AlertTriangle,
    Braces,
    CheckCircle2,
    Clock3,
    FileOutput,
    Gauge,
    RefreshCw,
    Route,
    Wrench
  } from 'lucide-svelte';
  import type {
    BuildCheckpoint,
    BuildDirective,
    BuildEvaluationResult,
    BuildTask,
    BuildTrace,
    StoryArtifact
  } from '@opentales/sdk';
  import { compactNumber } from '$lib/story-ide-model';
  import { cn } from '$lib/utils';

  type Tab = 'task' | 'trace' | 'eval';

  interface Props {
    task: BuildTask | null;
    tasks: BuildTask[];
    artifacts?: StoryArtifact[];
    traces?: BuildTrace[];
    evaluations?: BuildEvaluationResult[];
    checkpoints?: BuildCheckpoint[];
    directives?: BuildDirective[];
    busy?: boolean;
    onRetry?: (task: BuildTask) => void;
    onRerun?: (task: BuildTask, event?: MouseEvent) => void;
    onReplan?: (task: BuildTask, event?: MouseEvent) => void;
    onArtifact?: (artifact: StoryArtifact) => void;
  }

  let {
    task,
    tasks,
    artifacts = [],
    traces = [],
    evaluations = [],
    checkpoints = [],
    directives = [],
    busy = false,
    onRetry = () => undefined,
    onRerun = () => undefined,
    onReplan = () => undefined,
    onArtifact = () => undefined
  }: Props = $props();

  let tab = $state<Tab>('task');
  const tabs: Array<{ id: Tab; label: string }> = [
    { id: 'task', label: 'Contract' },
    { id: 'trace', label: 'Trace' },
    { id: 'eval', label: 'Evals' }
  ];
  const taskTraces = $derived(task ? traces.filter((trace) => trace.taskId === task.id) : []);
  const taskEvaluations = $derived(task ? evaluations.filter((evaluation) => evaluation.taskId === task.id) : []);
  const dependencies = $derived(task ? task.dependencyIds.map((id) => tasks.find((candidate) => candidate.id === id)).filter(Boolean) as BuildTask[] : []);
  const outputs = $derived(task ? task.outputArtifactIds.map((id) => artifacts.find((artifact) => artifact.id === id)).filter(Boolean) as StoryArtifact[] : []);
  const taskCheckpoints = $derived(task ? checkpoints.filter((checkpoint) => checkpoint.taskId === task.id) : []);
  const taskDirectives = $derived(task ? directives.filter((directive) => directive.fromTaskId === task.id) : []);

  function json(value: unknown): string {
    return JSON.stringify(value, null, 2);
  }

  function isPlanningTask(value: BuildTask): boolean {
    const haystack = `${value.phase} ${value.type} ${value.key}`.toLowerCase();
    return /plan|outline|architecture|scene|beat/.test(haystack);
  }

  function tabLabel(id: Tab): string {
    if (id === 'trace') return `Trace ${taskTraces.length}`;
    if (id === 'eval') return `Evals ${taskEvaluations.length}`;
    return 'Contract';
  }

  function moveTab(event: KeyboardEvent, index: number) {
    let next = index;
    if (event.key === 'ArrowRight') next = (index + 1) % tabs.length;
    else if (event.key === 'ArrowLeft') next = (index - 1 + tabs.length) % tabs.length;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = tabs.length - 1;
    else return;
    event.preventDefault();
    const nextTab = tabs[next].id;
    tab = nextTab;
    document.getElementById(`build-task-tab-${task?.id}-${nextTab}`)?.focus();
  }
</script>

<aside class="flex min-h-0 w-full shrink-0 flex-col border-t border-border bg-sidebar xl:w-[22rem] xl:border-l xl:border-t-0" aria-label="Build task details">
  {#if !task}
    <div class="flex flex-1 flex-col items-center justify-center px-6 py-12 text-center">
      <Route class="size-7 text-muted-foreground/45" />
      <p class="mt-3 text-xs text-foreground">Select a task in the graph.</p>
      <p class="mt-1 text-[11px] leading-relaxed text-muted-foreground">Inspect its contract, durable transitions, traces, outputs, and quality gates.</p>
    </div>
  {:else}
    <header class="shrink-0 border-b border-border px-3 py-3">
      <div class="flex items-start gap-2">
        <span class={cn('mt-0.5 size-2 shrink-0 rounded-full', task.status === 'done' ? 'bg-emerald-400' : task.status === 'running' ? 'bg-accent motion-safe:animate-pulse' : task.status === 'failed' ? 'bg-destructive' : 'bg-muted-foreground/50')}></span>
        <div class="min-w-0 flex-1">
          <h2 class="truncate text-xs font-semibold text-foreground">{task.key}</h2>
          <p class="mt-0.5 font-mono text-[9px] uppercase tracking-wide text-muted-foreground">{task.type} · {task.phase}</p>
        </div>
        <span class="rounded border border-border px-1.5 py-0.5 font-mono text-[9px] uppercase text-muted-foreground">{task.status}</span>
      </div>
      <div class="mt-3 h-1 overflow-hidden rounded-full bg-muted" aria-label={`${task.progress}% complete`}>
        <span class="block h-full bg-accent transition-[width] motion-reduce:transition-none" style:width={`${Math.max(0, Math.min(100, task.status === 'done' ? 100 : task.progress))}%`}></span>
      </div>
    </header>

    <div class="flex shrink-0 border-b border-border" role="tablist" aria-label="Task detail views">
      {#each tabs as item, index (item.id)}
        <button type="button" role="tab" id={`build-task-tab-${task.id}-${item.id}`} aria-controls={`build-task-panel-${task.id}-${item.id}`} aria-selected={tab === item.id} tabindex={tab === item.id ? 0 : -1} onclick={() => (tab = item.id)} onkeydown={(event) => moveTab(event, index)} class={cn('relative flex-1 px-2 py-2 text-[10px] outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent', tab === item.id ? 'text-foreground' : 'text-muted-foreground hover:text-foreground')}>
          {tabLabel(item.id)}
          {#if tab === item.id}<span class="absolute inset-x-2 bottom-0 h-px bg-accent"></span>{/if}
        </button>
      {/each}
    </div>

    <div id={`build-task-panel-${task.id}-${tab}`} role="tabpanel" aria-labelledby={`build-task-tab-${task.id}-${tab}`} tabindex="0" class="min-h-0 flex-1 overflow-y-auto p-3 outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent/30">
      {#if tab === 'task'}
        <dl class="divide-y divide-border/55 text-[11px]">
          <div class="grid grid-cols-[5.5rem_1fr] gap-2 py-2"><dt class="text-muted-foreground">Agent</dt><dd class="text-foreground">{task.assignedAgent}</dd></div>
          <div class="grid grid-cols-[5.5rem_1fr] gap-2 py-2"><dt class="text-muted-foreground">Attempts</dt><dd class="font-mono text-foreground">{task.attempts} / {task.maxAttempts}</dd></div>
          <div class="grid grid-cols-[5.5rem_1fr] gap-2 py-2"><dt class="text-muted-foreground">Revision</dt><dd class="font-mono text-foreground">{task.revisionIteration} / {task.maxRevisionIterations}</dd></div>
          <div class="grid grid-cols-[5.5rem_1fr] gap-2 py-2"><dt class="text-muted-foreground">Quality gate</dt><dd class="font-mono text-foreground">{task.qualityThreshold ?? 'not set'}</dd></div>
          <div class="grid grid-cols-[5.5rem_1fr] gap-2 py-2"><dt class="text-muted-foreground">Reserved</dt><dd class="font-mono text-foreground">{compactNumber(task.reservedTokens)} tok · ${(task.reservedCostMicros / 1_000_000).toFixed(2)} USD</dd></div>
          {#if task.startedAt}<div class="grid grid-cols-[5.5rem_1fr] gap-2 py-2"><dt class="text-muted-foreground">Started</dt><dd class="text-foreground">{new Date(task.startedAt).toLocaleString()}</dd></div>{/if}
          {#if task.completedAt}<div class="grid grid-cols-[5.5rem_1fr] gap-2 py-2"><dt class="text-muted-foreground">Completed</dt><dd class="text-foreground">{new Date(task.completedAt).toLocaleString()}</dd></div>{/if}
        </dl>

        {#if task.lastError}
          <div class="mt-3 border-l-2 border-destructive bg-destructive/8 px-3 py-2 text-[11px] leading-relaxed text-destructive-foreground" role="alert"><AlertTriangle class="mr-1 inline size-3" />{task.lastError}</div>
        {/if}

        <section class="mt-4">
          <h3 class="mb-2 flex items-center gap-1 text-[9px] font-semibold uppercase tracking-[0.14em] text-muted-foreground"><Route class="size-3" /> Dependencies</h3>
          {#if dependencies.length === 0}<p class="text-[10px] text-muted-foreground">Entry task — no prerequisites.</p>{:else}<ul class="space-y-1">{#each dependencies as dependency (dependency.id)}<li class="flex items-center justify-between border-l border-border pl-2 text-[10px]"><span class="truncate text-foreground/85">{dependency.key}</span><span class="font-mono text-muted-foreground">{dependency.status}</span></li>{/each}</ul>{/if}
        </section>

        <section class="mt-4">
          <h3 class="mb-2 flex items-center gap-1 text-[9px] font-semibold uppercase tracking-[0.14em] text-muted-foreground"><FileOutput class="size-3" /> Outputs</h3>
          {#if outputs.length === 0}<p class="text-[10px] text-muted-foreground">No artifact emitted yet.</p>{:else}<div class="space-y-1">{#each outputs as artifact (artifact.id)}<button type="button" onclick={() => onArtifact(artifact)} class="flex w-full items-center justify-between border-l border-accent/35 py-1 pl-2 text-left text-[10px] outline-none hover:border-accent focus-visible:ring-2 focus-visible:ring-accent"><span class="truncate text-foreground">{artifact.title}</span><span class="font-mono text-muted-foreground">v{artifact.version}</span></button>{/each}</div>{/if}
        </section>

        <details class="mt-4 border-t border-border pt-3">
          <summary class="cursor-pointer text-[9px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">Acceptance criteria</summary>
          <pre class="mt-2 overflow-x-auto whitespace-pre-wrap font-mono text-[9px] leading-relaxed text-foreground/75">{json(task.acceptanceCriteria)}</pre>
        </details>
        <details class="mt-3 border-t border-border pt-3"><summary class="cursor-pointer text-[9px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">Execution policy & skills</summary><pre class="mt-2 max-h-56 overflow-auto whitespace-pre-wrap font-mono text-[9px] leading-relaxed text-foreground/75">{json({ inputArtifactIds: task.inputArtifactIds, skillVersions: task.skillVersions, executionPolicy: task.executionPolicy })}</pre></details>
        <details class="mt-3 border-t border-border pt-3"><summary class="cursor-pointer text-[9px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">Durable transitions ({task.transitions.length})</summary><ol class="mt-2 space-y-2">{#each [...task.transitions].sort((a,b)=>a.createdAt.localeCompare(b.createdAt)) as transition (transition.id)}<li class="border-l border-border pl-2 text-[9px]"><span class="font-mono text-foreground">{transition.fromStatus} → {transition.toStatus}</span><span class="ml-2 text-muted-foreground">{new Date(transition.createdAt).toLocaleString()}</span>{#if transition.reason}<p class="mt-0.5 text-[10px] text-muted-foreground">{transition.reason}</p>{/if}</li>{/each}</ol></details>
        {#if taskCheckpoints.length || taskDirectives.length}<details class="mt-3 border-t border-border pt-3"><summary class="cursor-pointer text-[9px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">Checkpoints & directives</summary><div class="mt-2 space-y-2">{#each taskCheckpoints as checkpoint (checkpoint.id)}<div class="border-l border-emerald-400/40 pl-2 text-[10px]"><span class="text-foreground">{checkpoint.label}</span><span class="ml-2 font-mono text-muted-foreground">#{checkpoint.sequence}</span></div>{/each}{#each taskDirectives as directive (directive.id)}<div class="border-l border-amber-400/40 pl-2 text-[10px]"><p class="text-foreground">{directive.directive}</p><span class="font-mono text-muted-foreground">{directive.pinnedArtifactIds.length} pinned</span></div>{/each}</div></details>{/if}
      {:else if tab === 'trace'}
        {#if taskTraces.length === 0}
          <p class="py-8 text-center text-[11px] text-muted-foreground">No invocation traces recorded for this task.</p>
        {:else}
          <ol class="relative ml-2 border-l border-border">
            {#each [...taskTraces].sort((a, b) => b.attempt - a.attempt) as trace (trace.id)}
              <li class="relative mb-4 pl-4 last:mb-0">
                <span class={cn('absolute -left-1 top-1 size-2 rounded-full ring-4 ring-sidebar', trace.status === 'completed' ? 'bg-emerald-400' : trace.status === 'failed' ? 'bg-destructive' : 'bg-accent')}></span>
                <div class="flex items-center justify-between"><span class="font-mono text-[9px] uppercase text-muted-foreground">Attempt {trace.attempt}</span><span class="text-[9px] text-muted-foreground">{trace.latencyMs ? `${(trace.latencyMs / 1000).toFixed(1)}s` : trace.status}</span></div>
                <p class="mt-1 text-[11px] text-foreground">{trace.model ?? 'Model not recorded'}</p>
                <div class="mt-1 flex flex-wrap gap-x-2 font-mono text-[9px] text-muted-foreground"><span>{trace.provider ?? 'provider —'}</span><span>{compactNumber(trace.inputTokens)} in</span><span>{compactNumber(trace.outputTokens)} out</span><span>{trace.contextTokenCount ?? 0} ctx</span><span>{trace.toolCalls && Array.isArray(trace.toolCalls) ? trace.toolCalls.length : 0} tools</span><span>{trace.costMicros === null ? 'cost —' : `$${(trace.costMicros / 1_000_000).toFixed(4)}`}</span><span>{trace.retries} retries</span></div>
                {#if trace.error}<p class="mt-1 text-[10px] text-destructive-foreground">{trace.error}</p>{/if}
                <details class="mt-2"><summary class="cursor-pointer text-[9px] text-muted-foreground"><Braces class="mr-1 inline size-3" />Validator results</summary><pre class="mt-1 max-h-48 overflow-auto whitespace-pre-wrap font-mono text-[9px] text-foreground/70">{json(trace.validatorResults)}</pre></details>
                <details class="mt-2"><summary class="cursor-pointer text-[9px] text-muted-foreground"><Braces class="mr-1 inline size-3" />Redacted invocation record</summary><pre class="mt-1 max-h-72 overflow-auto whitespace-pre-wrap font-mono text-[9px] text-foreground/70">{json({ workflowVersion: trace.workflowVersion, systemPromptVersion: trace.systemPromptVersion, modelParameters: trace.modelParameters, skillVersions: trace.skillVersions, toolSchemaVersions: trace.toolSchemaVersions, inputs: trace.inputs, retrievedArtifactIds: trace.retrievedArtifactIds, toolCalls: trace.toolCalls, toolResults: trace.toolResults, outputs: trace.outputs, completionState: trace.completionState })}</pre></details>
              </li>
            {/each}
          </ol>
        {/if}
      {:else}
        {#if taskEvaluations.length === 0}
          <p class="py-8 text-center text-[11px] text-muted-foreground">No quality evaluation recorded for this task.</p>
        {:else}
          <div class="divide-y divide-border/60">
            {#each taskEvaluations as evaluation (evaluation.id)}
              <article class="py-3 first:pt-0">
                <div class="flex items-start gap-2">{#if evaluation.passed}<CheckCircle2 class="mt-0.5 size-3.5 text-emerald-400" />{:else}<AlertTriangle class="mt-0.5 size-3.5 text-destructive" />{/if}<div class="min-w-0"><h3 class="text-[11px] font-medium text-foreground">{evaluation.rubric}</h3><p class="font-mono text-[9px] uppercase text-muted-foreground">{evaluation.kind} · v{evaluation.rubricVersion}</p></div></div>
                {#if evaluation.feedback}<p class="mt-2 text-[10px] leading-relaxed text-muted-foreground">{evaluation.feedback}</p>{/if}
                <details class="mt-2"><summary class="cursor-pointer text-[9px] text-muted-foreground"><Gauge class="mr-1 inline size-3" />Scores, threshold & evidence</summary><pre class="mt-1 max-h-48 overflow-auto whitespace-pre-wrap font-mono text-[9px] text-foreground/70">{json({ threshold: evaluation.threshold, scores: evaluation.scores, checks: evaluation.checks, evidence: evaluation.evidence })}</pre></details>
              </article>
            {/each}
          </div>
        {/if}
      {/if}
    </div>

    <footer class="flex shrink-0 gap-1 border-t border-border p-2">
      {#if task.status === 'failed'}<button type="button" disabled={busy} onclick={() => onRetry(task)} class="inline-flex flex-1 items-center justify-center gap-1 rounded bg-accent px-2 py-1.5 text-[10px] font-medium text-accent-foreground outline-none disabled:opacity-50 focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-sidebar"><RefreshCw class="size-3" />Retry task</button>{/if}
      <button type="button" disabled={busy || task.status === 'running'} onclick={(event) => onRerun(task, event)} title="Rerun this task and invalidate transitive downstream output" class="inline-flex flex-1 items-center justify-center gap-1 rounded border border-border px-2 py-1.5 text-[10px] text-foreground outline-none hover:border-accent/50 disabled:opacity-40 focus-visible:ring-2 focus-visible:ring-accent"><Wrench class="size-3" />Rerun</button>
      {#if isPlanningTask(task)}<button type="button" disabled={busy || task.status === 'running'} onclick={(event) => onReplan(task, event)} title="Keep upstream work and re-plan from this task" class="inline-flex flex-1 items-center justify-center gap-1 rounded border border-border px-2 py-1.5 text-[10px] text-foreground outline-none hover:border-accent/50 disabled:opacity-40 focus-visible:ring-2 focus-visible:ring-accent"><Clock3 class="size-3" />Re-plan</button>{/if}
    </footer>
  {/if}
</aside>
