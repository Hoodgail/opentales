<script lang="ts">
  import {
    AlertTriangle,
    BookMarked,
    Braces,
    Check,
    Clock3,
    Database,
    GitBranch,
    Link2,
    Save,
    Search,
    Sparkles,
    X
  } from 'lucide-svelte';
  import type {
    CanonFact,
    EntityState,
    OpenLoop,
    PlotThread,
    SetupPayoffLink,
    StoryArtifact,
    StoryStateEntityKind,
    StoryStateHistoryResult,
    StoryStateSnapshot,
    TimelineEvent
  } from '@opentales/sdk';
  import { storyRecordData } from '$lib/story-ide-model';
  import { manuscript } from '$lib/stores/manuscript.svelte';
  import { storyUi, type BibleSection, type BibleSelection } from '$lib/stores/storyUi.svelte';
  import { cn } from '$lib/utils';
  import EvidenceLinks, { type EvidenceRef } from './EvidenceLinks.svelte';

  type VersionedState = CanonFact | EntityState | OpenLoop | TimelineEvent | SetupPayoffLink | PlotThread;

  interface Props {
    artifacts: StoryArtifact[];
    snapshot: StoryStateSnapshot | null;
    selection?: BibleSelection | null;
    saving?: boolean;
    onSelect?: (selection: BibleSelection | null) => void;
    onSaveArtifact?: (artifact: StoryArtifact, content: StoryArtifact['content']) => StoryArtifact | null | void | Promise<StoryArtifact | null | void>;
    onSaveFact?: (fact: CanonFact, update: { object: CanonFact['object']; status: CanonFact['status'] }) => CanonFact | null | void | Promise<CanonFact | null | void>;
    onSaveEntityState?: (entity: EntityState, update: { value: EntityState['value']; status: EntityState['status'] }) => EntityState | null | void | Promise<EntityState | null | void>;
    onSaveLoop?: (loop: OpenLoop, update: { description: string; targetPayoff: string | null; status: OpenLoop['status'] }) => OpenLoop | null | void | Promise<OpenLoop | null | void>;
    histories?: Record<string, StoryStateHistoryResult>;
    onLoadHistory?: (kind: StoryStateEntityKind, key: string) => unknown | Promise<unknown>;
    onRestore?: (kind: StoryStateEntityKind, key: string, version: number) => VersionedState | null | void | Promise<VersionedState | null | void>;
    onSaveTimeline?: (event: TimelineEvent, update: Partial<TimelineEvent>) => TimelineEvent | null | void | Promise<TimelineEvent | null | void>;
    onSaveSetup?: (link: SetupPayoffLink, update: Partial<SetupPayoffLink>) => SetupPayoffLink | null | void | Promise<SetupPayoffLink | null | void>;
    onSaveThread?: (thread: PlotThread, update: Partial<PlotThread>) => PlotThread | null | void | Promise<PlotThread | null | void>;
  }

  let {
    artifacts,
    snapshot,
    selection = null,
    saving = false,
    onSelect = () => undefined,
    onSaveArtifact = () => undefined,
    onSaveFact = () => undefined,
    onSaveEntityState = () => undefined,
    onSaveLoop = () => undefined,
    histories = {},
    onLoadHistory = () => undefined,
    onRestore = () => undefined,
    onSaveTimeline = () => undefined,
    onSaveSetup = () => undefined,
    onSaveThread = () => undefined
  }: Props = $props();

  let section = $state<BibleSection>('artifacts');
  let query = $state('');
  let editMode = $state(false);
  let jsonDraft = $state('');
  let textDraft = $state('');
  let targetDraft = $state('');
  let statusDraft = $state('');
  let editError = $state<string | null>(null);
  let draftFor = $state('');

  const canonFacts = $derived(snapshot?.canonFacts ?? []);
  const currentArtifacts = $derived(artifacts.filter((item) => !['superseded', 'invalidated'].includes(item.status)));
  const entityStates = $derived(snapshot?.entityStates ?? []);
  const openLoops = $derived(snapshot?.openLoops ?? []);
  const timelineEvents = $derived(snapshot?.timelineEvents ?? []);
  const setupPayoffs = $derived(snapshot?.setupPayoffs ?? []);
  const plotThreads = $derived(snapshot?.plotThreads ?? []);
  const selectedArtifact = $derived(selection?.section === 'artifacts' ? artifacts.find((item) => item.id === selection?.id) ?? null : null);
  const selectedFact = $derived(selection?.section === 'canon' ? canonFacts.find((item) => item.id === selection?.id) ?? null : null);
  const selectedEntity = $derived(selection?.section === 'entities' ? entityStates.find((item) => item.id === selection?.id) ?? null : null);
  const selectedLoop = $derived(selection?.section === 'loops' ? openLoops.find((item) => item.id === selection?.id) ?? null : null);
  const selectedTimeline = $derived(selection?.section === 'timeline' ? timelineEvents.find((item) => item.id === selection?.id) ?? null : null);
  const selectedSetup = $derived(selection?.section === 'setups' ? setupPayoffs.find((item) => item.id === selection?.id) ?? null : null);
  const selectedThread = $derived(selection?.section === 'threads' ? plotThreads.find((item) => item.id === selection?.id) ?? null : null);

  $effect(() => {
    const key = selection ? `${selection.section}:${selection.id}` : '';
    if (key === draftFor) return;
    draftFor = key;
    editMode = false;
    editError = null;
    if (selectedArtifact) {
      jsonDraft = JSON.stringify(selectedArtifact.content, null, 2);
      statusDraft = selectedArtifact.status;
    } else if (selectedFact) {
      jsonDraft = JSON.stringify(selectedFact.object, null, 2);
      statusDraft = selectedFact.status;
    } else if (selectedEntity) {
      jsonDraft = JSON.stringify(selectedEntity.value, null, 2);
      statusDraft = selectedEntity.status;
    } else if (selectedLoop) {
      textDraft = selectedLoop.description;
      targetDraft = selectedLoop.targetPayoff ?? '';
      statusDraft = selectedLoop.status;
    } else if (selectedTimeline) {
      jsonDraft = JSON.stringify({ title: selectedTimeline.title, description: selectedTimeline.description, chronology: selectedTimeline.chronology, sortOrder: selectedTimeline.sortOrder, chapterId: selectedTimeline.chapterId, sceneId: selectedTimeline.sceneId, dependencyIds: selectedTimeline.dependencyIds, participantRefs: selectedTimeline.participantRefs }, null, 2);
    } else if (selectedSetup) {
      jsonDraft = JSON.stringify({ title: selectedSetup.title, description: selectedSetup.description, status: selectedSetup.status, plotThreadId: selectedSetup.plotThreadId, setupSceneId: selectedSetup.setupSceneId, payoffSceneId: selectedSetup.payoffSceneId, reinforcementSceneIds: selectedSetup.reinforcementSceneIds }, null, 2);
      statusDraft = selectedSetup.status;
    } else if (selectedThread) {
      jsonDraft = JSON.stringify({ title: selectedThread.title, kind: selectedThread.kind, status: selectedThread.status, summary: selectedThread.summary, stakes: selectedThread.stakes, parentThreadId: selectedThread.parentThreadId, sceneIds: selectedThread.sceneIds }, null, 2);
      statusDraft = selectedThread.status;
    }
    const stateRecord = selectedFact ?? selectedEntity ?? selectedLoop ?? selectedTimeline ?? selectedSetup ?? selectedThread;
    const kind = selectedFact ? 'canon-fact' : selectedEntity ? 'entity-state' : selectedLoop ? 'open-loop' : selectedTimeline ? 'timeline-event' : selectedSetup ? 'setup-payoff' : selectedThread ? 'plot-thread' : null;
    if (stateRecord && kind) void onLoadHistory(kind, stateRecord.key);
  });

  $effect(() => {
    if (selection) section = selection.section;
  });

  const rows = $derived.by(() => {
    const needle = query.trim().toLowerCase();
    if (section === 'artifacts') return currentArtifacts.filter((item) => !needle || `${item.title} ${item.key} ${item.type}`.toLowerCase().includes(needle));
    if (section === 'canon') return canonFacts.filter((item) => !needle || `${item.subjectId} ${item.predicate} ${item.key} ${JSON.stringify(item.object)}`.toLowerCase().includes(needle));
    if (section === 'entities') return entityStates.filter((item) => !needle || `${item.entityId} ${item.stateKey} ${item.key} ${JSON.stringify(item.value)}`.toLowerCase().includes(needle));
    if (section === 'loops') return openLoops.filter((item) => !needle || `${item.title} ${item.description} ${item.kind}`.toLowerCase().includes(needle));
    if (section === 'timeline') return timelineEvents.filter((item) => !needle || `${item.title} ${item.description ?? ''} ${JSON.stringify(item.chronology)}`.toLowerCase().includes(needle));
    if (section === 'setups') return setupPayoffs.filter((item) => !needle || `${item.title} ${item.description} ${item.status}`.toLowerCase().includes(needle));
    return plotThreads.filter((item) => !needle || `${item.title} ${item.summary} ${item.kind}`.toLowerCase().includes(needle));
  });

  const evidence = $derived.by<EvidenceRef[]>(() => {
    if (selectedFact) return [{ id: selectedFact.id, unitId: selectedFact.sourceUnitId, chapterId: selectedFact.sourceChapterId, sceneId: selectedFact.sourceSceneId, artifactId: selectedFact.sourceArtifactId, sourceSpan: selectedFact.sourceSpan }];
    if (selectedEntity) return [{ id: selectedEntity.id, unitId: selectedEntity.sourceUnitId, sceneId: selectedEntity.validFromSceneId, artifactId: selectedEntity.sourceArtifactId, sourceSpan: selectedEntity.sourceSpan }];
    if (selectedLoop) return [
      { id: `${selectedLoop.id}-intro`, unitId: selectedLoop.sourceUnitId, sceneId: selectedLoop.introducedSceneId, artifactId: selectedLoop.introducedArtifactId, title: 'Introduced' },
      ...(selectedLoop.resolvedSceneId || selectedLoop.resolvedArtifactId ? [{ id: `${selectedLoop.id}-resolved`, sceneId: selectedLoop.resolvedSceneId, artifactId: selectedLoop.resolvedArtifactId, title: 'Resolved' }] : [])
    ];
    if (selectedTimeline) return [{ id: selectedTimeline.id, unitId: selectedTimeline.sourceUnitId, chapterId: selectedTimeline.chapterId, sceneId: selectedTimeline.sceneId, artifactId: selectedTimeline.sourceArtifactId, sourceSpan: selectedTimeline.sourceSpan }];
    if (selectedSetup) return [
      { id: `${selectedSetup.id}-setup`, unitId: selectedSetup.sourceUnitId, sceneId: selectedSetup.setupSceneId, artifactId: selectedSetup.setupArtifactId, title: 'Setup' },
      ...selectedSetup.reinforcementSceneIds.map((sceneId) => ({ id: `${selectedSetup.id}-${sceneId}`, sceneId, title: 'Reinforcement' })),
      ...(selectedSetup.payoffSceneId || selectedSetup.payoffArtifactId ? [{ id: `${selectedSetup.id}-payoff`, sceneId: selectedSetup.payoffSceneId, artifactId: selectedSetup.payoffArtifactId, title: 'Payoff' }] : [])
    ];
    if (selectedThread) return [
      ...(selectedThread.sourceUnitId ? [{ id: `${selectedThread.id}-source`, unitId: selectedThread.sourceUnitId, title: 'Latest source' }] : []),
      ...selectedThread.sceneIds.map((sceneId) => ({ id: `${selectedThread.id}-${sceneId}`, sceneId, title: 'Thread appearance' }))
    ];
    return [];
  });

  const relatedFacts = $derived(selectedEntity ? canonFacts.filter((fact) => fact.subjectType === selectedEntity.entityType && fact.subjectId === selectedEntity.entityId) : selectedFact ? canonFacts.filter((fact) => fact.subjectType === selectedFact.subjectType && fact.subjectId === selectedFact.subjectId && fact.id !== selectedFact.id) : []);
  const relatedStates = $derived(selectedFact ? entityStates.filter((entity) => entity.sourceFactId === selectedFact.id || (entity.entityType === selectedFact.subjectType && entity.entityId === selectedFact.subjectId)) : selectedEntity ? entityStates.filter((entity) => entity.entityType === selectedEntity.entityType && entity.entityId === selectedEntity.entityId && entity.id !== selectedEntity.id) : []);
  const artifactHistory = $derived(selectedArtifact ? artifacts.filter((artifact) => artifact.type === selectedArtifact.type && artifact.key === selectedArtifact.key).sort((a, b) => b.version - a.version) : []);

  const sections: Array<{ id: BibleSection; label: string; icon: typeof Database }> = [
    { id: 'artifacts', label: 'Artifacts', icon: Braces },
    { id: 'canon', label: 'Canon', icon: BookMarked },
    { id: 'entities', label: 'State', icon: Database },
    { id: 'loops', label: 'Open loops', icon: GitBranch },
    { id: 'timeline', label: 'Timeline', icon: Clock3 },
    { id: 'setups', label: 'Setup / payoff', icon: Link2 },
    { id: 'threads', label: 'Plot threads', icon: GitBranch }
  ];

  function moveSection(event: KeyboardEvent, index: number) {
    let next = index;
    if (event.key === 'ArrowRight') next = (index + 1) % sections.length;
    else if (event.key === 'ArrowLeft') next = (index - 1 + sections.length) % sections.length;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = sections.length - 1;
    else return;
    event.preventDefault();
    section = sections[next].id;
    onSelect(null);
    requestAnimationFrame(() => document.getElementById(`story-bible-tab-${section}`)?.focus());
  }

  function displayJson(value: unknown): string {
    if (typeof value === 'string') return value;
    return JSON.stringify(value, null, 2);
  }

  function objectList(value: unknown): Array<Record<string, unknown>> {
    return Array.isArray(value) ? value.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === 'object' && !Array.isArray(item)) : [];
  }

  function openArtifact(artifactId: string) {
    if (artifacts.some((artifact) => artifact.id === artifactId)) onSelect({ section: 'artifacts', id: artifactId });
  }

  function openUnit(unitId: string, range?: { start?: number; end?: number }) {
    const buildRunId = selectedArtifact?.buildRunId
      ?? selectedFact?.buildRunId
      ?? selectedEntity?.buildRunId
      ?? selectedLoop?.buildRunId
      ?? selectedTimeline?.buildRunId
      ?? selectedSetup?.buildRunId
      ?? selectedThread?.buildRunId;
    if (!buildRunId) return;
    storyUi.requestBuildSurface('manuscript', { unitId, ...range });
    void manuscript.setActiveView('build');
    void manuscript.openTab({ id: `tab-build-${buildRunId}`, type: 'build', refId: buildRunId, title: 'Novel Build' });
  }

  function openReference(refType: string, refId: string) {
    const target = refType === 'canon-fact' ? { section: 'canon' as const, id: refId }
      : refType === 'entity-state' ? { section: 'entities' as const, id: refId }
      : refType === 'open-loop' ? { section: 'loops' as const, id: refId }
      : refType === 'timeline-event' ? { section: 'timeline' as const, id: refId }
      : refType === 'setup-payoff' ? { section: 'setups' as const, id: refId }
      : refType === 'plot-thread' ? { section: 'threads' as const, id: refId }
      : refType === 'artifact' ? { section: 'artifacts' as const, id: refId }
      : null;
    if (target) onSelect(target);
  }

  function selectRelatedReference(id: unknown) {
    if (typeof id !== 'string') return;
    const state = entityStates.find((item) => item.entityId === id);
    if (state) { onSelect({ section: 'entities', id: state.id }); return; }
    const fact = canonFacts.find((item) => item.subjectId === id);
    if (fact) onSelect({ section: 'canon', id: fact.id });
  }

  async function save() {
    editError = null;
    try {
      let updated: StoryArtifact | VersionedState | null | void = null;
      if (selectedArtifact) {
        updated = await onSaveArtifact(selectedArtifact, JSON.parse(jsonDraft) as StoryArtifact['content']);
      } else if (selectedFact) {
        updated = await onSaveFact(selectedFact, { object: JSON.parse(jsonDraft) as CanonFact['object'], status: statusDraft as CanonFact['status'] });
      } else if (selectedEntity) {
        updated = await onSaveEntityState(selectedEntity, { value: JSON.parse(jsonDraft) as EntityState['value'], status: statusDraft as EntityState['status'] });
      } else if (selectedLoop) {
        updated = await onSaveLoop(selectedLoop, { description: textDraft.trim(), targetPayoff: targetDraft.trim() || null, status: statusDraft as OpenLoop['status'] });
      } else if (selectedTimeline) {
        updated = await onSaveTimeline(selectedTimeline, JSON.parse(jsonDraft) as Partial<TimelineEvent>);
      } else if (selectedSetup) {
        updated = await onSaveSetup(selectedSetup, JSON.parse(jsonDraft) as Partial<SetupPayoffLink>);
      } else if (selectedThread) {
        updated = await onSaveThread(selectedThread, JSON.parse(jsonDraft) as Partial<PlotThread>);
      }
      if (updated?.id) onSelect({ section, id: updated.id });
      editMode = false;
    } catch (error) {
      editError = error instanceof Error ? error.message : 'Structured content is not valid JSON.';
    }
  }

  const historyDescriptor = $derived.by(() => {
    const record = selectedFact ?? selectedEntity ?? selectedLoop ?? selectedTimeline ?? selectedSetup ?? selectedThread;
    const kind: StoryStateEntityKind | null = selectedFact ? 'canon-fact' : selectedEntity ? 'entity-state' : selectedLoop ? 'open-loop' : selectedTimeline ? 'timeline-event' : selectedSetup ? 'setup-payoff' : selectedThread ? 'plot-thread' : null;
    return record && kind ? { record, kind, history: histories[`${kind}:${record.key}`]?.versions ?? [] } : null;
  });

  function selectRow(item: (typeof rows)[number]) {
    onSelect({ section, id: item.id });
  }

  async function restoreVersion(kind: StoryStateEntityKind, key: string, version: number) {
    const restored = await onRestore(kind, key, version);
    if (restored?.id) onSelect({ section, id: restored.id });
  }
</script>

<section class="flex min-h-0 flex-1 flex-col bg-background" aria-label="Story Bible">
  <header class="flex min-h-12 shrink-0 items-center gap-3 overflow-x-auto border-b border-border bg-sidebar px-3 [scrollbar-width:none]">
    <div class="hidden shrink-0 sm:block"><h1 class="text-xs font-semibold text-foreground">Story Bible</h1><p class="font-mono text-[9px] uppercase tracking-wide text-muted-foreground">Structured story state</p></div>
    <div class="flex shrink-0 rounded border border-border bg-input/40 p-0.5 sm:ml-auto" role="tablist" aria-label="Story Bible sections">
      {#each sections as item, index (item.id)}
        <button type="button" role="tab" id={`story-bible-tab-${item.id}`} aria-controls={`story-bible-panel-${item.id}`} aria-selected={section === item.id} tabindex={section === item.id ? 0 : -1} onclick={() => { section = item.id; onSelect(null); }} onkeydown={(event) => moveSection(event, index)} class={cn('inline-flex h-8 items-center gap-1.5 rounded-sm px-2 text-[10px] outline-none focus-visible:ring-2 focus-visible:ring-accent', section === item.id ? 'bg-accent text-accent-foreground' : 'text-muted-foreground hover:text-foreground')}><item.icon class="size-3" />{item.label}</button>
      {/each}
    </div>
  </header>

  <div id={`story-bible-panel-${section}`} role="tabpanel" aria-labelledby={`story-bible-tab-${section}`} class="flex min-h-0 flex-1 flex-col lg:flex-row">
    <div class={cn('min-h-0 min-w-0 flex-1 overflow-y-auto', selection && 'lg:max-w-[48%] lg:border-r lg:border-border')}>
      <div class="sticky top-0 z-10 border-b border-border bg-background/95 p-3 backdrop-blur">
        <label class="relative block"><Search class="pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" /><span class="sr-only">Filter Story Bible</span><input bind:value={query} placeholder={`Filter ${sections.find((item) => item.id === section)?.label.toLowerCase()}…`} class="h-8 w-full rounded border border-border bg-input/50 pl-7 pr-2 text-[11px] text-foreground outline-none focus-visible:border-accent focus-visible:ring-2 focus-visible:ring-accent/30" /></label>
      </div>
      {#if rows.length === 0}<div class="px-5 py-16 text-center text-xs text-muted-foreground">No {sections.find((item) => item.id === section)?.label.toLowerCase()} match this view.</div>{:else}<div class="divide-y divide-border/55">{#each rows as item (item.id)}<button type="button" onclick={() => selectRow(item)} class={cn('grid w-full grid-cols-[minmax(0,1fr)_auto] gap-3 px-4 py-3 text-left outline-none transition-colors hover:bg-muted/35 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent', selection?.section === section && selection?.id === item.id && 'bg-accent/6')}>
        {#if section === 'artifacts'}{@const artifact = item as StoryArtifact}<span class="min-w-0"><span class="block truncate text-xs font-medium text-foreground">{artifact.title}</span><span class="mt-0.5 block truncate font-mono text-[9px] uppercase text-muted-foreground">{artifact.type} · {artifact.key}</span></span><span class="text-right font-mono text-[9px] text-muted-foreground">v{artifact.version}<br />{artifact.status}</span>
        {:else if section === 'canon'}{@const fact = item as CanonFact}<span class="min-w-0"><span class="block truncate text-xs text-foreground"><strong>{fact.subjectId}</strong> {fact.predicate}</span><span class="mt-0.5 line-clamp-2 block font-mono text-[9px] text-muted-foreground">{displayJson(fact.object)}</span></span><span class="font-mono text-[9px] uppercase text-muted-foreground">{fact.status}</span>
        {:else if section === 'entities'}{@const entity = item as EntityState}<span class="min-w-0"><span class="block truncate text-xs text-foreground"><strong>{entity.entityId}</strong> · {entity.stateKey}</span><span class="mt-0.5 line-clamp-2 block font-mono text-[9px] text-muted-foreground">{displayJson(entity.value)}</span></span><span class="font-mono text-[9px] uppercase text-muted-foreground">{entity.status}</span>
        {:else if section === 'loops'}{@const loop = item as OpenLoop}<span class="min-w-0"><span class="block truncate text-xs font-medium text-foreground">{loop.title}</span><span class="mt-0.5 line-clamp-2 block text-[10px] text-muted-foreground">{loop.description}</span></span><span class="font-mono text-[9px] uppercase text-muted-foreground">{loop.kind}<br />{loop.status}</span>
        {:else if section === 'timeline'}{@const event = item as TimelineEvent}<span class="min-w-0"><span class="block truncate text-xs font-medium text-foreground">{event.title}</span><span class="mt-0.5 line-clamp-2 block font-mono text-[9px] text-muted-foreground">{displayJson(event.chronology)}</span></span><span class="font-mono text-[9px] text-muted-foreground">v{event.version}<br />{event.sortOrder ?? '—'}</span>
        {:else if section === 'setups'}{@const setup = item as SetupPayoffLink}<span class="min-w-0"><span class="block truncate text-xs font-medium text-foreground">{setup.title}</span><span class="mt-0.5 line-clamp-2 block text-[10px] text-muted-foreground">{setup.description}</span></span><span class="font-mono text-[9px] uppercase text-muted-foreground">{setup.status}<br />v{setup.version}</span>
        {:else}{@const thread = item as PlotThread}<span class="min-w-0"><span class="block truncate text-xs font-medium text-foreground">{thread.title}</span><span class="mt-0.5 line-clamp-2 block text-[10px] text-muted-foreground">{thread.summary}</span></span><span class="font-mono text-[9px] uppercase text-muted-foreground">{thread.kind}<br />{thread.status}</span>{/if}
      </button>{/each}</div>{/if}
    </div>

    {#if selection}
      <aside class="min-h-0 flex-1 overflow-y-auto bg-sidebar/35" aria-label="Story Bible details">
        <div class="sticky top-0 z-10 flex items-center justify-between border-b border-border bg-sidebar px-4 py-2"><div><span class="font-mono text-[9px] uppercase tracking-wide text-accent">{selection.section}</span><h2 class="text-xs font-semibold text-foreground">{selectedArtifact?.title ?? selectedFact?.subjectId ?? selectedEntity?.entityId ?? selectedLoop?.title ?? selectedTimeline?.title ?? selectedSetup?.title ?? selectedThread?.title ?? 'Missing record'}</h2></div><div class="flex items-center gap-1"><button type="button" onclick={() => (editMode = !editMode)} aria-pressed={editMode} class={cn('rounded border px-2 py-1 text-[10px] outline-none focus-visible:ring-2 focus-visible:ring-accent', editMode ? 'border-accent text-accent' : 'border-border text-muted-foreground hover:text-foreground')}>Edit</button><button type="button" onclick={() => onSelect(null)} aria-label="Close details" class="rounded p-1 text-muted-foreground outline-none hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-accent"><X class="size-3.5" /></button></div></div>
        <div class="p-4 sm:p-5">
          {#if editError}<div class="mb-3 flex gap-2 border-l-2 border-destructive bg-destructive/8 px-3 py-2 text-[11px] text-destructive-foreground"><AlertTriangle class="mt-0.5 size-3.5 shrink-0" />{editError}</div>{/if}
          {#if editMode}
            {#if selectedLoop}<label><span class="mb-1 block text-[9px] uppercase tracking-wide text-muted-foreground">Description</span><textarea bind:value={textDraft} rows="6" class="w-full resize-y rounded border border-border bg-input/40 p-2 text-xs leading-relaxed text-foreground outline-none focus-visible:border-accent focus-visible:ring-2 focus-visible:ring-accent/30"></textarea></label><label class="mt-3 block"><span class="mb-1 block text-[9px] uppercase tracking-wide text-muted-foreground">Intended payoff</span><textarea bind:value={targetDraft} rows="3" class="w-full resize-y rounded border border-border bg-input/40 p-2 text-xs text-foreground outline-none focus-visible:border-accent focus-visible:ring-2 focus-visible:ring-accent/30"></textarea></label>{:else}<label><span class="mb-1 block text-[9px] uppercase tracking-wide text-muted-foreground">Structured value</span><textarea bind:value={jsonDraft} rows="18" spellcheck="false" class="w-full resize-y rounded border border-border bg-input/40 p-2 font-mono text-[10px] leading-relaxed text-foreground outline-none focus-visible:border-accent focus-visible:ring-2 focus-visible:ring-accent/30"></textarea></label>{/if}
            {#if !selectedArtifact && !selectedTimeline && !selectedSetup && !selectedThread}<label class="mt-3 block"><span class="mb-1 block text-[9px] uppercase tracking-wide text-muted-foreground">Status</span><select bind:value={statusDraft} class="h-8 w-full rounded border border-border bg-input/50 px-2 text-[10px] text-foreground outline-none focus-visible:border-accent">{#each selectedFact ? ['proposed','canonical','disputed','retracted'] : selectedEntity ? ['proposed','active','superseded'] : ['open','reinforced','resolved','abandoned'] as status (status)}<option value={status}>{status}</option>{/each}</select></label>{/if}
            <button type="button" onclick={() => void save()} disabled={saving} class="mt-4 inline-flex h-8 items-center gap-1 rounded bg-accent px-3 text-[10px] font-medium text-accent-foreground outline-none disabled:opacity-50 focus-visible:ring-2 focus-visible:ring-accent"><Save class="size-3" />{saving ? 'Saving…' : 'Save structured state'}</button>
          {:else if selectedArtifact}
            {@const data = storyRecordData(selectedArtifact as unknown as { id: string; content?: unknown })}
            <dl class="grid grid-cols-[7rem_1fr] gap-x-3 gap-y-2 text-[11px]"><dt class="text-muted-foreground">Type</dt><dd class="text-foreground">{selectedArtifact.type}</dd><dt class="text-muted-foreground">Schema</dt><dd class="font-mono text-foreground">{selectedArtifact.schemaVersion}</dd><dt class="text-muted-foreground">Status</dt><dd class="text-foreground">{selectedArtifact.status}</dd><dt class="text-muted-foreground">Content hash</dt><dd class="truncate font-mono text-[9px] text-muted-foreground">{selectedArtifact.contentHash}</dd></dl>
            <div class="mt-5 border-t border-border pt-4"><h3 class="mb-2 flex items-center gap-1 text-[9px] font-semibold uppercase tracking-[0.14em] text-muted-foreground"><Braces class="size-3" />Structured content</h3><pre class="max-h-[28rem] overflow-auto whitespace-pre-wrap font-mono text-[10px] leading-relaxed text-foreground/80">{JSON.stringify(data, null, 2)}</pre></div>
            {#if selectedArtifact.type === 'character-bible'}<section class="mt-5 border-t border-border pt-4"><h3 class="text-[9px] font-semibold uppercase tracking-wide text-muted-foreground">Character knowledge graph</h3><dl class="mt-2 grid grid-cols-[6rem_1fr] gap-2 text-[10px]"><dt class="text-muted-foreground">Wants</dt><dd>{displayJson(data.wants ?? [])}</dd><dt class="text-muted-foreground">Needs</dt><dd>{displayJson(data.needs ?? [])}</dd><dt class="text-muted-foreground">Secrets</dt><dd>{displayJson(data.secrets ?? [])}</dd></dl><h4 class="mt-3 text-[9px] uppercase text-muted-foreground">Relationships</h4><div class="mt-1 space-y-1">{#each objectList(data.relationships) as relationship, index (`${relationship.id ?? relationship.key ?? index}`)}<button type="button" onclick={() => selectRelatedReference(relationship.id)} disabled={!relationship.id} class="flex w-full items-center gap-2 border-l border-border px-2 py-1 text-left text-[10px] enabled:hover:border-accent"><span class="min-w-0 flex-1 truncate">{String(relationship.label ?? relationship.key ?? relationship.id ?? 'Related entity')}</span><span class="font-mono text-muted-foreground">{String(relationship.type ?? 'entity')}</span></button>{/each}</div></section>{/if}
            {#if selectedArtifact.type === 'relationship-graph'}<section class="mt-5 border-t border-border pt-4"><h3 class="text-[9px] font-semibold uppercase tracking-wide text-muted-foreground">Relationship edges</h3><div class="mt-2 space-y-1">{#each objectList(data.edges) as edge, index (`${edge.key ?? index}`)}<div class="grid grid-cols-[1fr_auto_1fr] items-center gap-2 border-l border-border px-2 py-1 text-[10px]"><span class="truncate">{displayJson(edge.from)}</span><span class="font-mono text-accent">{String(edge.type ?? '→')}</span><span class="truncate">{displayJson(edge.to)}</span></div>{/each}</div></section>{/if}
            <div class="mt-5 border-t border-border pt-4"><h3 class="mb-2 text-[9px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">Revision history</h3><ol class="space-y-1">{#each artifactHistory as revision (revision.id)}<li class="flex items-center justify-between border-l border-border pl-2 text-[10px]"><span>Version {revision.version}</span><span class="font-mono text-muted-foreground">{revision.status} · {new Date(revision.updatedAt).toLocaleDateString()}</span></li>{/each}</ol></div>
          {:else if selectedFact}
            <div class="border-l-2 border-accent pl-4"><p class="font-serif text-lg leading-relaxed text-foreground"><strong>{selectedFact.subjectId}</strong> <span class="text-muted-foreground">{selectedFact.predicate}</span> {displayJson(selectedFact.object)}</p><div class="mt-2 flex flex-wrap gap-2 font-mono text-[9px] uppercase text-muted-foreground"><span>{selectedFact.status}</span><span>confidence {Math.round(selectedFact.confidence * 100)}%</span>{#if selectedFact.validFromSceneId}<span>from {selectedFact.validFromSceneId}</span>{/if}</div></div>
          {:else if selectedEntity}
            <div class="border-l-2 border-accent pl-4"><p class="text-xs text-muted-foreground">{selectedEntity.entityType}</p><h3 class="mt-0.5 font-serif text-xl text-foreground">{selectedEntity.entityId}</h3><p class="mt-2 text-sm text-foreground"><span class="text-muted-foreground">{selectedEntity.stateKey}:</span> {displayJson(selectedEntity.value)}</p><div class="mt-2 font-mono text-[9px] uppercase text-muted-foreground">{selectedEntity.status}{selectedEntity.storyOrder !== null ? ` · story order ${selectedEntity.storyOrder}` : ''}</div></div>
          {:else if selectedLoop}
            <div class="border-l-2 border-accent pl-4"><div class="flex items-center gap-2"><span class="rounded border border-border px-1.5 py-0.5 font-mono text-[9px] uppercase text-muted-foreground">{selectedLoop.kind}</span><span class="font-mono text-[9px] uppercase text-accent">{selectedLoop.status}</span></div><p class="mt-3 text-sm leading-relaxed text-foreground">{selectedLoop.description}</p>{#if selectedLoop.targetPayoff}<p class="mt-3 text-xs leading-relaxed text-muted-foreground"><strong class="text-foreground">Intended payoff:</strong> {selectedLoop.targetPayoff}</p>{/if}</div>
          {:else if selectedTimeline}<div class="border-l-2 border-accent pl-4"><p class="font-mono text-[9px] uppercase text-accent">Timeline · v{selectedTimeline.version}</p><h3 class="mt-1 font-serif text-xl text-foreground">{selectedTimeline.title}</h3><p class="mt-2 text-xs text-muted-foreground">{selectedTimeline.description ?? 'No description.'}</p><pre class="mt-3 whitespace-pre-wrap font-mono text-[10px] text-foreground/80">{displayJson(selectedTimeline.chronology)}</pre></div>
          {:else if selectedSetup}<div class="border-l-2 border-accent pl-4"><p class="font-mono text-[9px] uppercase text-accent">{selectedSetup.status} · v{selectedSetup.version}</p><h3 class="mt-1 font-serif text-xl text-foreground">{selectedSetup.title}</h3><p class="mt-2 text-xs text-muted-foreground">{selectedSetup.description}</p><dl class="mt-3 grid grid-cols-[6rem_1fr] gap-1 text-[10px]"><dt class="text-muted-foreground">Setup</dt><dd>{selectedSetup.setupSceneId ?? '—'}</dd><dt class="text-muted-foreground">Payoff</dt><dd>{selectedSetup.payoffSceneId ?? '—'}</dd><dt class="text-muted-foreground">Reinforce</dt><dd>{selectedSetup.reinforcementSceneIds.length}</dd></dl></div>
          {:else if selectedThread}<div class="border-l-2 border-accent pl-4"><p class="font-mono text-[9px] uppercase text-accent">{selectedThread.kind} · {selectedThread.status} · v{selectedThread.version}</p><h3 class="mt-1 font-serif text-xl text-foreground">{selectedThread.title}</h3><p class="mt-2 text-xs leading-relaxed text-muted-foreground">{selectedThread.summary}</p>{#if selectedThread.stakes}<p class="mt-2 text-xs"><strong>Stakes:</strong> {selectedThread.stakes}</p>{/if}</div>
          {/if}

          {#if !editMode && evidence.length}
            <section class="mt-5 border-t border-border pt-4"><h3 class="mb-2 flex items-center gap-1 text-[9px] font-semibold uppercase tracking-[0.14em] text-muted-foreground"><Link2 class="size-3" />Evidence</h3><EvidenceLinks {evidence} onArtifact={openArtifact} onReference={openReference} onUnit={openUnit} /></section>
          {/if}
          {#if !editMode && (relatedFacts.length || relatedStates.length)}
            <section class="mt-5 border-t border-border pt-4"><h3 class="mb-2 text-[9px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">Related state</h3><div class="divide-y divide-border/45">{#each relatedFacts as fact (fact.id)}<button type="button" onclick={() => onSelect({section:'canon',id:fact.id})} class="flex w-full items-center justify-between py-2 text-left text-[10px] outline-none hover:text-accent focus-visible:ring-2 focus-visible:ring-accent"><span>{fact.predicate} {displayJson(fact.object)}</span><span class="font-mono text-muted-foreground">fact</span></button>{/each}{#each relatedStates as entity (entity.id)}<button type="button" onclick={() => onSelect({section:'entities',id:entity.id})} class="flex w-full items-center justify-between py-2 text-left text-[10px] outline-none hover:text-accent focus-visible:ring-2 focus-visible:ring-accent"><span>{entity.stateKey}: {displayJson(entity.value)}</span><span class="font-mono text-muted-foreground">state</span></button>{/each}</div></section>
          {/if}
          {#if !editMode && historyDescriptor}
            <section class="mt-5 border-t border-border pt-4"><h3 class="mb-2 text-[9px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">Version history</h3>{#if historyDescriptor.history.length === 0}<p class="text-[10px] text-muted-foreground">History is loading or this is the first version.</p>{:else}<ol class="space-y-1">{#each historyDescriptor.history as revision (revision.id)}<li class="flex items-center gap-2 border-l border-border py-1 pl-2 text-[10px]"><span class="font-mono text-foreground">v{revision.version}</span><span class="min-w-0 flex-1 truncate text-muted-foreground">{new Date(revision.updatedAt).toLocaleString()}</span>{#if revision.version !== historyDescriptor.record.version}<button type="button" onclick={() => void restoreVersion(historyDescriptor.kind, historyDescriptor.record.key, revision.version)} class="rounded border border-border px-2 py-0.5 text-[9px] text-foreground outline-none hover:border-accent focus-visible:ring-2 focus-visible:ring-accent">Restore</button>{:else}<span class="font-mono text-[9px] text-accent">current</span>{/if}</li>{/each}</ol>{/if}</section>
          {/if}
        </div>
      </aside>
    {/if}
  </div>
</section>
