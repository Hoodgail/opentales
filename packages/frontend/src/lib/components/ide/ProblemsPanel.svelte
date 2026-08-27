<script lang="ts">
  import {
    AlertCircle,
    AlertTriangle,
    ChevronDown,
    ChevronRight,
    Filter,
    Info,
    RefreshCw
  } from 'lucide-svelte';
  import { manuscript } from '$lib/stores/manuscript.svelte';
  import { storyIde } from '$lib/stores/storyIde.svelte';
  import { storyUi } from '$lib/stores/storyUi.svelte';
  import { runLint, type Diagnostic } from '$lib/lint/engine';
  import { mergeDiagnostics, revisionPassForCategory } from '$lib/lint/merge';
  import { allRules } from '$lib/lint/rules';
  import type { DiagnosticCategory, RevisionPass } from '$lib/lint/types';
  import { cn } from '$lib/utils';
  import EvidenceLinks from './EvidenceLinks.svelte';
  import PanelHeader from './PanelHeader.svelte';

  const enabledRuleIds = $state<Set<string>>(
    new Set(allRules.filter((rule) => rule.defaultEnabled).map((rule) => rule.id))
  );

  let severityFilter = $state<'all' | Diagnostic['severity']>('all');
  let categoryFilter = $state<'all' | DiagnosticCategory>('all');
  let passFilter = $state<'all' | RevisionPass>('all');
  let configOpen = $state(false);
  let filterOpen = $state(false);
  let expandedId = $state<string | null>(null);

  const localDiagnostics = $derived(
    runLint(
      { chapters: manuscript.chapters, characters: manuscript.characters },
      { rules: allRules, enabled: enabledRuleIds }
    ).map((diagnostic) => ({ ...diagnostic, source: 'local' as const }))
  );

  let loadedProjectId = $state<string | null>(null);
  $effect(() => {
    const projectId = manuscript.projectId;
    if (projectId && loadedProjectId !== projectId) {
      loadedProjectId = projectId;
      void storyIde.loadRuns(projectId).then(() => {
        const first = storyIde.runs[0];
        if (!storyIde.selectedRunId && first) void storyIde.selectRun(projectId, first.id);
      });
    }
  });

  function passForCategory(category: string): RevisionPass {
    return revisionPassForCategory(category);
  }

  function lineFromOffset(chapterId: string | undefined, offset: number | undefined): number | undefined {
    if (!chapterId || offset === undefined) return undefined;
    const content = manuscript.chapters.find((chapter) => chapter.id === chapterId)?.content;
    if (content === undefined) return undefined;
    return content.slice(0, Math.max(0, offset)).split('\n').length;
  }

  const remoteDiagnostics = $derived((storyIde.diagnostics?.diagnostics ?? []).map((diagnostic): Diagnostic => ({
    ruleId: diagnostic.code,
    severity: diagnostic.severity,
    category: diagnostic.category,
    pass: passForCategory(diagnostic.category),
    chapterId: diagnostic.evidence.find((item) => item.chapterId)?.chapterId ?? '',
    chapterTitle: manuscript.chapters.find((chapter) => chapter.id === diagnostic.evidence.find((item) => item.chapterId)?.chapterId)?.title ?? 'Story graph',
    message: diagnostic.message,
    source: 'semantic',
    hint: diagnostic.suggestedResolution ?? undefined,
    evidence: [
      ...diagnostic.evidence.map((item) => ({
        unitId: item.unitId,
        chapterId: item.chapterId,
        sceneId: item.sceneId,
        artifactId: item.artifactId,
        excerpt: item.quote,
        lineStart: lineFromOffset(item.chapterId, item.start),
        lineEnd: lineFromOffset(item.chapterId, item.end),
        sourceSpan: {
          unitId: item.unitId,
          chapterId: item.chapterId,
          sceneId: item.sceneId,
          start: item.start,
          end: item.end,
          quote: item.quote
        }
      })),
      ...diagnostic.relatedRefs.map((ref) => ({
        id: `${ref.type}:${ref.id}`,
        refType: ref.type,
        refId: ref.id,
        title: ref.label ?? ref.key ?? `${ref.type}:${ref.id}`,
        unitId: ref.type === 'build-unit' ? ref.id : undefined,
        chapterId: ref.type === 'chapter' ? ref.id : undefined,
        sceneId: ref.type === 'scene' ? ref.id : undefined,
        artifactId: ref.type === 'artifact' ? ref.id : undefined
      }))
    ]
  })));

  const diagnostics = $derived(mergeDiagnostics(localDiagnostics, remoteDiagnostics));

  const visible = $derived(
    diagnostics.filter(
      (diagnostic) =>
        (severityFilter === 'all' || diagnostic.severity === severityFilter) &&
        (categoryFilter === 'all' || diagnostic.category === categoryFilter) &&
        (passFilter === 'all' || diagnostic.pass === passFilter)
    )
  );

  const grouped = $derived.by(() => {
    const map = new Map<string, Diagnostic[]>();
    for (const diagnostic of visible) {
      const key = diagnostic.category ?? 'workflow';
      const list = map.get(key) ?? [];
      list.push(diagnostic);
      map.set(key, list);
    }
    return Array.from(map.entries())
      .map(([category, items]) => ({ category, items }))
      .sort((a, b) => a.category.localeCompare(b.category));
  });

  const categories = $derived(
    Array.from(
      new Set(diagnostics.map((diagnostic) => diagnostic.category).filter(Boolean))
    ).sort() as DiagnosticCategory[]
  );

  const counts = $derived({
    error: diagnostics.filter((diagnostic) => diagnostic.severity === 'error').length,
    warning: diagnostics.filter((diagnostic) => diagnostic.severity === 'warning').length,
    info: diagnostics.filter((diagnostic) => diagnostic.severity === 'info').length
  });

  const passOptions: Array<{ value: RevisionPass; label: string }> = [
    { value: 'story', label: 'Story / developmental' },
    { value: 'character', label: 'Character' },
    { value: 'continuity', label: 'Continuity' },
    { value: 'pacing', label: 'Pacing' },
    { value: 'scene', label: 'Scene-level' },
    { value: 'line', label: 'Line edit' },
    { value: 'copy', label: 'Copy edit' },
    { value: 'proof', label: 'Proof' },
    { value: 'final', label: 'Final' }
  ];

  function diagnosticId(diagnostic: Diagnostic): string {
    return `${diagnostic.ruleId}:${diagnostic.chapterId}:${diagnostic.lineStart ?? 0}:${diagnostic.message}`;
  }

  function severityIcon(severity: Diagnostic['severity']) {
    return severity === 'error' ? AlertCircle : severity === 'warning' ? AlertTriangle : Info;
  }

  function severityColor(severity: Diagnostic['severity']): string {
    if (severity === 'error') return 'text-destructive';
    if (severity === 'warning') return 'text-amber-400';
    return 'text-muted-foreground';
  }

  function toggleRule(id: string) {
    if (enabledRuleIds.has(id)) enabledRuleIds.delete(id);
    else enabledRuleIds.add(id);
  }

  function openPrimaryEvidence(diagnostic: Diagnostic) {
    const evidence = diagnostic.evidence?.[0];
    const chapterId = evidence?.chapterId ?? diagnostic.chapterId;
    if (!chapterId) return;
    void manuscript.navigateToChapter(chapterId, {
      line: evidence?.lineStart ?? diagnostic.lineStart,
      endLine: evidence?.lineEnd ?? diagnostic.lineEnd
    });
  }

  function rerun() {
    const snapshot = [...enabledRuleIds];
    enabledRuleIds.clear();
    for (const id of snapshot) enabledRuleIds.add(id);
    if (storyIde.selectedRunId) void storyIde.refreshSelected();
  }

  function openArtifact(artifactId: string) {
    storyUi.selectBible({ section: 'artifacts', id: artifactId });
    void manuscript.setActiveView('bible');
    void manuscript.openTab({ id: 'tab-story-bible', type: 'story-bible', refId: storyIde.selectedRunId ?? 'story-bible', title: 'Story Bible' });
  }

  function openUnit(unitId: string, range?: { start?: number; end?: number }) {
    if (!storyIde.selectedRun) return;
    storyUi.requestBuildSurface('manuscript', { unitId, ...range });
    void manuscript.setActiveView('build');
    void manuscript.openTab({ id: `tab-build-${storyIde.selectedRun.id}`, type: 'build', refId: storyIde.selectedRun.id, title: 'Novel Build' });
  }

  function openReference(refType: string, refId: string) {
    const section = refType === 'canon-fact' ? 'canon'
      : refType === 'entity-state' ? 'entities'
      : refType === 'open-loop' ? 'loops'
      : refType === 'timeline-event' ? 'timeline'
      : refType === 'setup-payoff' ? 'setups'
      : refType === 'plot-thread' ? 'threads'
      : refType === 'artifact' ? 'artifacts'
      : null;
    if (!section) return;
    storyUi.selectBible({ section, id: refId });
    void manuscript.setActiveView('bible');
    void manuscript.openTab({ id: 'tab-story-bible', type: 'story-bible', refId: storyIde.selectedRunId ?? 'story-bible', title: 'Story Bible' });
  }
</script>

<div class="flex h-full flex-col">
  <PanelHeader title="Problems" />

  <div class="flex items-center gap-2 border-b border-border px-3 py-2 text-[11px]">
    <button type="button" onclick={() => (severityFilter = severityFilter === 'error' ? 'all' : 'error')} aria-label={`${counts.error} errors`} aria-pressed={severityFilter === 'error'} class="flex items-center gap-1 rounded px-1 py-0.5 text-destructive outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-accent">
      <AlertCircle class="size-3" /> {counts.error}
    </button>
    <button type="button" onclick={() => (severityFilter = severityFilter === 'warning' ? 'all' : 'warning')} aria-label={`${counts.warning} warnings`} aria-pressed={severityFilter === 'warning'} class="flex items-center gap-1 rounded px-1 py-0.5 text-amber-400 outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-accent">
      <AlertTriangle class="size-3" /> {counts.warning}
    </button>
    <button type="button" onclick={() => (severityFilter = severityFilter === 'info' ? 'all' : 'info')} aria-label={`${counts.info} informational issues`} aria-pressed={severityFilter === 'info'} class="flex items-center gap-1 rounded px-1 py-0.5 text-muted-foreground outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-accent">
      <Info class="size-3" /> {counts.info}
    </button>
    <button
      type="button"
      onclick={() => (filterOpen = !filterOpen)}
      aria-expanded={filterOpen}
      class={cn('ml-auto inline-flex items-center gap-1 rounded border border-border px-2 py-0.5 text-[10px] outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-accent', (categoryFilter !== 'all' || passFilter !== 'all') ? 'text-accent' : 'text-muted-foreground')}
    >
      <Filter class="size-3" /> Filter
    </button>
    <button type="button" onclick={() => (configOpen = !configOpen)} aria-expanded={configOpen} class="rounded border border-border px-2 py-0.5 text-[10px] text-muted-foreground outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-accent">Rules</button>
    <button type="button" onclick={rerun} title="Re-run diagnostics" aria-label="Re-run diagnostics" class="rounded p-1 text-muted-foreground outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-accent"><RefreshCw class="size-3.5" /></button>
  </div>

  {#if storyIde.loadingDetails}<div class="border-b border-border px-3 py-2 text-[10px] text-muted-foreground" role="status">Refreshing semantic diagnostics…</div>{/if}
  {#if storyIde.detailWarning || (storyIde.error && storyIde.selectedRunId)}<div class="border-b border-amber-400/30 bg-amber-400/8 px-3 py-2 text-[10px] leading-relaxed text-amber-200" role="status">Semantic analysis is incomplete: {storyIde.detailWarning ?? storyIde.error}. Local checks remain visible, but this is not a clean build.</div>{/if}

  {#if filterOpen}
    <div class="grid grid-cols-1 gap-2 border-b border-border bg-card/35 p-2">
      <label>
        <span class="mb-1 block text-[9px] font-semibold uppercase tracking-wider text-muted-foreground">Category</span>
        <select bind:value={categoryFilter} class="h-8 w-full rounded border border-border bg-input/70 px-2 text-[11px] text-foreground outline-none focus-visible:border-accent focus-visible:ring-2 focus-visible:ring-accent/30">
          <option value="all">All categories</option>
          {#each categories as category (category)}<option value={category}>{category.replace('-', ' ')}</option>{/each}
        </select>
      </label>
      <label>
        <span class="mb-1 block text-[9px] font-semibold uppercase tracking-wider text-muted-foreground">Revision pass</span>
        <select bind:value={passFilter} class="h-8 w-full rounded border border-border bg-input/70 px-2 text-[11px] text-foreground outline-none focus-visible:border-accent focus-visible:ring-2 focus-visible:ring-accent/30">
          <option value="all">All passes</option>
          {#each passOptions as pass (pass.value)}<option value={pass.value}>{pass.label}</option>{/each}
        </select>
      </label>
    </div>
  {/if}

  {#if configOpen}
    <div class="space-y-1 border-b border-border bg-card/40 px-3 py-2 text-[11px]">
      {#each allRules as rule (rule.id)}
        <label class="flex cursor-pointer items-start gap-2">
          <input type="checkbox" checked={enabledRuleIds.has(rule.id)} onchange={() => toggleRule(rule.id)} class="mt-0.5 accent-accent" />
          <span class="min-w-0 flex-1"><span class="text-foreground">{rule.label}</span><span class="ml-1 text-muted-foreground">{rule.description}</span></span>
        </label>
      {/each}
    </div>
  {/if}

  <div class="flex-1 overflow-y-auto">
    {#if grouped.length === 0}
      <div class="px-4 py-12 text-center text-xs text-muted-foreground">
        {diagnostics.length === 0 ? (storyIde.selectedRunId && storyIde.diagnostics ? 'No local or semantic problems detected for the current snapshot.' : 'No local problems detected. Choose a Novel Build to run semantic analysis.') : 'No diagnostics match this revision pass.'}
      </div>
    {/if}
    {#each grouped as group (group.category)}
      <section class="border-b border-border" aria-labelledby={`problem-group-${group.category}`}>
        <div id={`problem-group-${group.category}`} class="flex items-center justify-between bg-card/40 px-3 py-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
          <span>{group.category.replace('-', ' ')}</span><span class="font-mono">{group.items.length}</span>
        </div>
        {#each group.items as diagnostic (diagnosticId(diagnostic))}
          {@const id = diagnosticId(diagnostic)}
          {@const Icon = severityIcon(diagnostic.severity)}
          <div class="border-b border-border/40 last:border-b-0">
            <div class="flex items-start gap-1 px-2 py-2">
              <button type="button" onclick={() => (expandedId = expandedId === id ? null : id)} aria-expanded={expandedId === id} aria-label="Show diagnostic evidence" class="mt-0.5 rounded p-0.5 text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-accent">
                {#if expandedId === id}<ChevronDown class="size-3" />{:else}<ChevronRight class="size-3" />{/if}
              </button>
              <Icon class={cn('mt-0.5 size-3.5 shrink-0', severityColor(diagnostic.severity))} />
              <button type="button" onclick={() => openPrimaryEvidence(diagnostic)} class="min-w-0 flex-1 text-left outline-none focus-visible:ring-2 focus-visible:ring-accent/40">
                <span class="text-xs text-foreground">{diagnostic.message}</span>
                {#if diagnostic.hint}<span class="mt-0.5 block text-[11px] leading-relaxed text-muted-foreground">{diagnostic.hint}</span>{/if}
                <span class="mt-1 flex flex-wrap gap-x-2 font-mono text-[9px] uppercase text-muted-foreground/70">
                  <span>{diagnostic.ruleId}</span>
                  <span>{diagnostic.source ?? 'local'}</span>
                  {#if diagnostic.pass}<span>pass:{diagnostic.pass}</span>{/if}
                  {#if diagnostic.lineStart}<span>line:{diagnostic.lineStart}</span>{/if}
                </span>
              </button>
            </div>
            {#if expandedId === id}
              <div class="border-t border-border/30 bg-background/45 px-8 py-2">
                {#if diagnostic.evidence?.length}
                  <EvidenceLinks evidence={diagnostic.evidence} compact onArtifact={openArtifact} onReference={openReference} onUnit={openUnit} />
                {:else}
                  <p class="text-[10px] text-muted-foreground">This rule did not emit source evidence.</p>
                {/if}
              </div>
            {/if}
          </div>
        {/each}
      </section>
    {/each}
  </div>
</div>
