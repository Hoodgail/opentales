<script lang="ts">
  import {
    Activity,
    ArrowRight,
    CalendarClock,
    Check,
    Columns3,
    GitBranch,
    LayoutList,
    MapPin,
    Network,
    Save,
    SlidersHorizontal,
    User,
    X
  } from 'lucide-svelte';
  import type {
    JsonObject,
    BuildManuscriptUnit,
    Scene,
    ScenePlanContent,
    StoryArtifact,
    StoryStateSnapshot,
    UpdateSceneInput
  } from '@opentales/sdk';
  import { manuscript } from '$lib/stores/manuscript.svelte';
  import { storyUi } from '$lib/stores/storyUi.svelte';
  import type { OutlineProjection } from '$lib/stores/storyUi.svelte';
  import {
    deriveOutlineScenes,
    stringField,
    storyRecordData,
    type OutlineSceneProjection
  } from '$lib/story-ide-model';
  import { cn } from '$lib/utils';

  interface Props {
    artifacts: StoryArtifact[];
    storyState: StoryStateSnapshot | null;
    units?: BuildManuscriptUnit[];
    projection?: OutlineProjection;
    saving?: boolean;
    onProjection?: (projection: OutlineProjection) => void;
    onSaveScene?: (
      artifact: StoryArtifact,
      content: ScenePlanContent,
      status: 'draft' | 'validated' | 'accepted'
    ) => void | Promise<void>;
    onSaveSceneEntity?: (scene: Scene, input: Omit<UpdateSceneInput, 'expectedRevision'>) => void | Promise<void>;
    onReorderScenes?: (chapterId: string, sceneIds: string[]) => void | Promise<void>;
    onOpenBuildUnit?: (unit: BuildManuscriptUnit) => void | Promise<void>;
    onReorderBuildUnits?: (parentUnitId: string, unitIds: string[]) => void | Promise<void>;
  }

  let {
    artifacts,
    storyState,
    units = [],
    projection = 'hierarchy',
    saving = false,
    onProjection = () => undefined,
    onSaveScene = () => undefined,
    onSaveSceneEntity = () => undefined,
    onReorderScenes = () => undefined,
    onOpenBuildUnit = () => undefined,
    onReorderBuildUnits = () => undefined
  }: Props = $props();

  const views: Array<{ id: OutlineProjection; label: string; icon: typeof LayoutList }> = [
    { id: 'hierarchy', label: 'Hierarchy', icon: LayoutList },
    { id: 'corkboard', label: 'Corkboard', icon: Columns3 },
    { id: 'plot-grid', label: 'Plot grid', icon: Network },
    { id: 'timeline', label: 'Timeline', icon: CalendarClock },
    { id: 'arc', label: 'Arcs', icon: GitBranch },
    { id: 'tension', label: 'Tension', icon: Activity }
  ];

  function moveProjection(event: KeyboardEvent, index: number) {
    let next = index;
    if (event.key === 'ArrowRight') next = (index + 1) % views.length;
    else if (event.key === 'ArrowLeft') next = (index - 1 + views.length) % views.length;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = views.length - 1;
    else return;
    event.preventDefault();
    onProjection(views[next].id);
    requestAnimationFrame(() => document.getElementById(`outline-projection-tab-${views[next].id}`)?.focus());
  }

  const scenes = $derived(deriveOutlineScenes(artifacts, manuscript.chapters, units));
  const chapterGroups = $derived.by(() => {
    const map = new Map<string, OutlineSceneProjection[]>();
    for (const scene of scenes) {
      const key = `${scene.chapterNumber}:${scene.chapterTitle}`;
      const group = map.get(key) ?? [];
      group.push(scene);
      map.set(key, group);
    }
    return Array.from(map.entries()).map(([key, items]) => ({ key, title: items[0].chapterTitle, number: items[0].chapterNumber, items }));
  });
  const timeline = $derived([...(storyState?.timelineEvents ?? [])].sort((a, b) => (a.sortOrder ?? Number.MAX_SAFE_INTEGER) - (b.sortOrder ?? Number.MAX_SAFE_INTEGER)));
  const arcThreads = $derived((storyState?.plotThreads ?? []).filter((thread) => thread.kind === 'character-arc'));
  const activeThreads = $derived((storyState?.plotThreads ?? []).filter((thread) => !['invalidated', 'abandoned'].includes(thread.status)));
  const tensionScenes = $derived(scenes.filter((scene) => scene.tension !== null));
  const tensionWidth = $derived(Math.max(640, tensionScenes.length * 96));
  const tensionPeak = $derived(Math.max(1, ...tensionScenes.map((scene) => scene.tension ?? 0)));
  const tensionPoints = $derived(tensionScenes.map((scene, index) => `${40 + index * ((tensionWidth - 80) / Math.max(1, tensionScenes.length - 1))},${190 - ((scene.tension ?? 0) / tensionPeak) * 150}`).join(' '));

  let selectedSceneId = $state<string | null>(null);
  const selectedScene = $derived(scenes.find((scene) => scene.id === selectedSceneId) ?? null);
  const selectedArtifact = $derived(selectedScene?.artifactId ? artifacts.find((artifact) => artifact.id === selectedScene.artifactId) ?? null : null);
  const selectedSceneEntity = $derived(selectedScene?.sceneEntityId
    ? manuscript.chapters.flatMap((chapter) => chapter.scenes).find((scene) => scene.id === selectedScene.sceneEntityId) ?? null
    : null);
  let metadataOpen = $state(false);
  let draggingSceneId = $state<string | null>(null);
  let draft = $state({
    title: '', status: 'planned', povCharacterId: '', locationId: '', storyDate: '', storyTime: '', estimatedWordCount: '', function: '', goal: '', obstacle: '', stakes: '', conflict: '', turn: '', revelation: '', outcome: '', emotionalValueShift: '', tension: '', characterPresentIds: '', characterReferencedIds: '', plotThreadIds: '', setupPayoffIds: '', knowledgeDeltas: '{}', objectTransfers: '{}', injuryStateChanges: '{}', worldRuleRefs: '[]', entryState: '{}', exitState: '{}', summary: '', writerNotes: '', aiNotes: ''
  });
  let draftFor = $state<string | null>(null);
  let metadataError = $state<string | null>(null);

  $effect(() => {
    if (!selectedScene || selectedScene.id === draftFor) return;
    const data = storyRecordData(selectedScene.raw);
    const plan = selectedArtifact?.content as ScenePlanContent | undefined;
    const unique = (values: string[]) => [...new Set(values.filter(Boolean))];
    draftFor = selectedScene.id;
    draft = {
      title: plan?.title ?? selectedArtifact?.title ?? selectedScene.title,
      status: selectedArtifact?.status ?? selectedScene.status,
      povCharacterId: plan?.povRef?.id ?? selectedSceneEntity?.povCharacterId ?? selectedScene.pov,
      locationId: plan?.locationRef?.id ?? selectedSceneEntity?.locationId ?? selectedScene.location,
      storyDate: plan?.storyDate ?? selectedSceneEntity?.storyDate ?? stringField(data, 'storyDate'),
      storyTime: plan?.storyTime ?? selectedSceneEntity?.storyTime ?? selectedScene.storyTime,
      estimatedWordCount: (plan?.estimatedWordCount ?? selectedSceneEntity?.estimatedWordCount ?? selectedScene.estimatedWords)?.toString() ?? '',
      function: (plan?.function ?? selectedSceneEntity?.sceneFunction ?? stringField(data, 'function', 'sceneFunction')) || selectedScene.summary,
      goal: plan?.goal ?? selectedSceneEntity?.goal ?? selectedScene.goal,
      obstacle: plan?.obstacle ?? selectedSceneEntity?.obstacle ?? selectedScene.obstacle,
      stakes: plan?.stakes ?? selectedSceneEntity?.stakes ?? (typeof data.stakes === 'string' ? data.stakes : ''),
      conflict: plan?.conflict ?? selectedSceneEntity?.conflict ?? (typeof data.conflict === 'string' ? data.conflict : ''),
      turn: plan?.turn ?? selectedSceneEntity?.turn ?? selectedScene.turn,
      revelation: plan?.revelations?.join('\n') ?? selectedSceneEntity?.revelation ?? (Array.isArray(data.revelations) ? data.revelations.join('\n') : ''),
      outcome: plan?.outcome ?? selectedSceneEntity?.outcome ?? selectedScene.outcome,
      emotionalValueShift: plan?.emotionalValueShift ?? selectedSceneEntity?.emotionalValueShift ?? selectedScene.emotionalShift,
      tension: (plan?.tension ?? selectedSceneEntity?.tension ?? selectedScene.tension)?.toString() ?? '',
      characterPresentIds: unique(plan?.characterPresentIds ?? plan?.characterRefs?.map((ref) => ref.id) ?? selectedSceneEntity?.characterPresentIds ?? selectedScene.characters).join(', '),
      characterReferencedIds: unique(plan?.characterReferencedIds ?? selectedSceneEntity?.characterReferencedIds ?? []).join(', '),
      plotThreadIds: unique(plan?.plotThreadRefs?.map((ref) => ref.id) ?? selectedSceneEntity?.plotThreadIds ?? selectedScene.threads).join(', '),
      setupPayoffIds: unique(plan?.setupPayoffRefs?.map((ref) => ref.id) ?? selectedSceneEntity?.setupPayoffIds ?? []).join(', '),
      knowledgeDeltas: JSON.stringify(plan?.knowledgeDeltas ?? selectedSceneEntity?.knowledgeDeltas ?? {}, null, 2),
      objectTransfers: JSON.stringify(plan?.objectTransfers ?? selectedSceneEntity?.objectTransfers ?? {}, null, 2),
      injuryStateChanges: JSON.stringify(plan?.injuryStateChanges ?? selectedSceneEntity?.injuryStateChanges ?? {}, null, 2),
      worldRuleRefs: JSON.stringify(plan?.worldRuleRefs ?? selectedSceneEntity?.worldRuleRefs ?? [], null, 2),
      entryState: JSON.stringify(plan?.entryState ?? selectedSceneEntity?.entryState ?? data.entryState ?? {}, null, 2),
      exitState: JSON.stringify(plan?.exitState ?? selectedSceneEntity?.exitState ?? data.exitState ?? {}, null, 2),
      summary: plan?.summary ?? selectedSceneEntity?.summary ?? selectedScene.summary,
      writerNotes: plan?.writerNotes ?? selectedSceneEntity?.writerNotes ?? '',
      aiNotes: plan?.aiNotes ?? selectedSceneEntity?.aiNotes ?? ''
    };
    metadataError = null;
  });

  function selectScene(scene: OutlineSceneProjection) {
    selectedSceneId = scene.id;
    storyUi.selectOutlineScene(scene.sceneEntityId ?? scene.id);
    metadataOpen = true;
  }

  function chronology(value: unknown): string {
    if (typeof value === 'string' || typeof value === 'number') return String(value);
    return JSON.stringify(value);
  }

  function characterLabel(value: string): string {
    return manuscript.characters.find((character) => character.id === value)?.name ?? value;
  }

  function locationLabel(value: string): string {
    return manuscript.locations.find((location) => location.id === value)?.name ?? value;
  }

  function threadLabel(value: string): string {
    return activeThreads.find((thread) => thread.id === value || thread.key === value)?.title ?? value;
  }

  function sceneInThread(scene: OutlineSceneProjection, thread: (typeof activeThreads)[number]): boolean {
    return thread.sceneIds.includes(scene.id)
      || (scene.sceneEntityId ? thread.sceneIds.includes(scene.sceneEntityId) : false)
      || (scene.artifactId ? thread.sceneIds.includes(scene.artifactId) : false)
      || scene.threads.some((value) => value === thread.id || value === thread.key || value === thread.title);
  }

  function optionalNumber(value: unknown): number | null {
    const text = String(value ?? '').trim();
    if (!text) return null;
    const parsed = Number(text);
    return Number.isFinite(parsed) ? parsed : null;
  }

  async function saveMetadata() {
    metadataError = null;
    const ids = (value: string) => value.split(',').map((item) => item.trim()).filter(Boolean);
    let parsed: Record<string, JsonObject | unknown>;
    try {
      parsed = { knowledgeDeltas: JSON.parse(draft.knowledgeDeltas), objectTransfers: JSON.parse(draft.objectTransfers), injuryStateChanges: JSON.parse(draft.injuryStateChanges), worldRuleRefs: JSON.parse(draft.worldRuleRefs), entryState: JSON.parse(draft.entryState), exitState: JSON.parse(draft.exitState) };
    } catch (caught) {
      metadataError = caught instanceof Error ? caught.message : 'Scene state must be valid JSON.';
      return;
    }
    if (selectedArtifact) {
      const base = selectedArtifact.content as ScenePlanContent;
      const presentIds = ids(draft.characterPresentIds);
      const referencedIds = ids(draft.characterReferencedIds);
      const content = {
        ...base,
        title: draft.title.trim() || undefined,
        povRef: draft.povCharacterId ? { type: 'character', id: draft.povCharacterId, label: characterLabel(draft.povCharacterId) } : undefined,
        locationRef: draft.locationId ? { type: 'location', id: draft.locationId, label: locationLabel(draft.locationId) } : undefined,
        storyTime: draft.storyTime.trim() || undefined,
        storyDate: draft.storyDate.trim() || undefined,
        estimatedWordCount: optionalNumber(draft.estimatedWordCount) ?? undefined,
        function: draft.function,
        goal: draft.goal,
        obstacle: draft.obstacle,
        stakes: draft.stakes,
        conflict: draft.conflict,
        turn: draft.turn,
        revelations: draft.revelation.split('\n').map((item) => item.trim()).filter(Boolean),
        outcome: draft.outcome,
        emotionalValueShift: draft.emotionalValueShift,
        characterRefs: [...new Set([...presentIds, ...referencedIds])].map((id) => ({ type: 'character', id, label: characterLabel(id) })),
        characterPresentIds: presentIds,
        characterReferencedIds: referencedIds,
        plotThreadRefs: ids(draft.plotThreadIds).map((id) => ({ type: 'plot-thread', id })),
        setupPayoffRefs: ids(draft.setupPayoffIds).map((id) => ({ type: 'setup-payoff', id })),
        knowledgeDeltas: parsed.knowledgeDeltas,
        objectTransfers: parsed.objectTransfers,
        injuryStateChanges: parsed.injuryStateChanges,
        worldRuleRefs: parsed.worldRuleRefs,
        summary: draft.summary,
        writerNotes: draft.writerNotes,
        aiNotes: draft.aiNotes,
        entryState: parsed.entryState as JsonObject,
        exitState: parsed.exitState as JsonObject,
        tension: optionalNumber(draft.tension) ?? base.tension
      } as ScenePlanContent;
      const artifactStatus = ['draft', 'validated', 'accepted'].includes(draft.status)
        ? draft.status as 'draft' | 'validated' | 'accepted'
        : selectedArtifact.status === 'validated' || selectedArtifact.status === 'accepted'
          ? selectedArtifact.status
          : 'draft';
      await onSaveScene(selectedArtifact, content, artifactStatus);
      return;
    }
    if (selectedSceneEntity) {
      await onSaveSceneEntity(selectedSceneEntity, {
        title: draft.title.trim(),
        status: draft.status as Scene['status'],
        povCharacterId: draft.povCharacterId || null,
        locationId: draft.locationId || null,
        storyDate: draft.storyDate || null,
        storyTime: draft.storyTime.trim() || null,
        estimatedWordCount: optionalNumber(draft.estimatedWordCount),
        sceneFunction: draft.function,
        goal: draft.goal,
        obstacle: draft.obstacle,
        stakes: draft.stakes,
        conflict: draft.conflict,
        turn: draft.turn,
        revelation: draft.revelation,
        outcome: draft.outcome,
        emotionalValueShift: draft.emotionalValueShift,
        tension: optionalNumber(draft.tension),
        characterPresentIds: ids(draft.characterPresentIds),
        characterReferencedIds: ids(draft.characterReferencedIds),
        plotThreadIds: ids(draft.plotThreadIds),
        setupPayoffIds: ids(draft.setupPayoffIds),
        knowledgeDeltas: parsed.knowledgeDeltas as JsonObject,
        objectTransfers: parsed.objectTransfers as JsonObject,
        injuryStateChanges: parsed.injuryStateChanges as JsonObject,
        worldRuleRefs: parsed.worldRuleRefs as JsonObject,
        entryState: parsed.entryState as JsonObject,
        exitState: parsed.exitState as JsonObject,
        summary: draft.summary,
        writerNotes: draft.writerNotes,
        aiNotes: draft.aiNotes
      });
    }
  }

  function openChapter(scene: OutlineSceneProjection) {
    if (manuscript.chapters.some((chapter) => chapter.id === scene.chapterId)) {
      void manuscript.navigateToChapter(scene.chapterId);
      return;
    }
    const unit = units.find((candidate) => candidate.id === scene.id || (scene.sceneEntityId && candidate.sourceSceneId === scene.sceneEntityId));
    if (unit) void onOpenBuildUnit(unit);
  }

  async function dropBefore(target: OutlineSceneProjection, event: DragEvent) {
    event.preventDefault();
    const source = scenes.find((scene) => scene.id === draggingSceneId);
    draggingSceneId = null;
    if (!source || source.id === target.id || source.chapterId !== target.chapterId) return;
    const sourceUnit = units.find((unit) => unit.id === source.id);
    const targetUnit = units.find((unit) => unit.id === target.id);
    if (sourceUnit && targetUnit && sourceUnit.parentUnitId && sourceUnit.parentUnitId === targetUnit.parentUnitId) {
      const ordered = units
        .filter((unit) => unit.kind === 'scene' && unit.parentUnitId === sourceUnit.parentUnitId && !unit.invalidatedAt)
        .sort((left, right) => left.order - right.order)
        .map((unit) => unit.id)
        .filter((id) => id !== sourceUnit.id);
      const targetIndex = ordered.indexOf(targetUnit.id);
      ordered.splice(Math.max(0, targetIndex), 0, sourceUnit.id);
      await onReorderBuildUnits(sourceUnit.parentUnitId, ordered);
      return;
    }
    if (!source.sceneEntityId || !target.sceneEntityId) return;
    const chapter = manuscript.chapters.find((candidate) => candidate.id === source.chapterId);
    if (!chapter) return;
    const ordered = chapter.scenes.map((scene) => scene.id).filter((id) => id !== source.sceneEntityId);
    const targetIndex = ordered.indexOf(target.sceneEntityId);
    ordered.splice(Math.max(0, targetIndex), 0, source.sceneEntityId);
    await onReorderScenes(chapter.id, ordered);
  }
</script>

<section class="flex min-h-0 flex-1 flex-col bg-background" aria-label="Semantic outline">
  <header class="flex min-h-12 shrink-0 items-center gap-3 overflow-x-auto border-b border-border bg-sidebar px-3 [scrollbar-width:none]">
    <div class="hidden shrink-0 sm:block"><h1 class="text-xs font-semibold text-foreground">Semantic outline</h1><p class="font-mono text-[9px] uppercase tracking-wide text-muted-foreground">{scenes.length} scene plans · one graph</p></div>
    <div class="flex shrink-0 rounded border border-border bg-input/40 p-0.5 sm:ml-auto" role="tablist" aria-label="Outline projections">
      {#each views as view, index (view.id)}
        <button type="button" role="tab" id={`outline-projection-tab-${view.id}`} aria-controls={`outline-projection-panel-${view.id}`} aria-selected={projection === view.id} tabindex={projection === view.id ? 0 : -1} onclick={() => onProjection(view.id)} onkeydown={(event) => moveProjection(event, index)} class={cn('inline-flex h-8 items-center gap-1.5 rounded-sm px-2 text-[10px] outline-none transition-colors focus-visible:ring-2 focus-visible:ring-accent', projection === view.id ? 'bg-accent text-accent-foreground' : 'text-muted-foreground hover:text-foreground')}><view.icon class="size-3" /><span>{view.label}</span></button>
      {/each}
    </div>
  </header>

  <div id={`outline-projection-panel-${projection}`} role="tabpanel" aria-labelledby={`outline-projection-tab-${projection}`} class="flex min-h-0 flex-1 flex-col xl:flex-row">
    <div class="min-h-0 min-w-0 flex-1 overflow-auto">
      {#if scenes.length === 0 && projection !== 'timeline' && projection !== 'arc'}
        <div class="mx-auto flex max-w-lg flex-col items-center px-6 py-20 text-center"><Network class="size-8 text-muted-foreground/40" /><h2 class="mt-3 text-sm font-medium text-foreground">No ScenePlan artifacts yet</h2><p class="mt-1 text-xs leading-relaxed text-muted-foreground">Start a Novel Build or add structured scene plans. Every projection will appear from the same underlying story graph.</p></div>
      {:else if projection === 'hierarchy'}
        <div class="mx-auto max-w-4xl p-4 sm:p-7">
          {#each chapterGroups as group (group.key)}
            <section class="mb-7 border-l border-border pl-4" aria-labelledby={`outline-chapter-${group.key}`}>
              <div class="mb-2 flex items-baseline gap-2"><span class="font-mono text-[10px] text-accent">{group.number === Number.MAX_SAFE_INTEGER ? '—' : group.number.toString().padStart(2, '0')}</span><h2 id={`outline-chapter-${group.key}`} class="font-serif text-lg font-semibold text-foreground">{group.title}</h2></div>
              <div class="divide-y divide-border/55">
                {#each group.items as scene, index (scene.id)}
                  <button type="button" onclick={() => selectScene(scene)} class={cn('group grid w-full grid-cols-[2rem_minmax(0,1fr)] gap-2 py-3 text-left outline-none focus-visible:ring-2 focus-visible:ring-accent/40 sm:grid-cols-[2rem_minmax(0,1fr)_10rem]', selectedSceneId === scene.id && 'bg-accent/5')}>
                    <span class="pt-0.5 font-mono text-[9px] text-muted-foreground">S{index + 1}</span><span class="min-w-0"><span class="block text-xs font-medium text-foreground">{scene.title}</span><span class="mt-0.5 line-clamp-2 block text-[11px] leading-relaxed text-muted-foreground">{scene.summary || scene.goal || 'No scene function recorded.'}</span></span><span class="hidden text-right font-mono text-[9px] text-muted-foreground sm:block">{scene.pov ? characterLabel(scene.pov) : 'POV —'}<br />{scene.storyTime || 'TIME —'}</span>
                  </button>
                {/each}
              </div>
            </section>
          {/each}
        </div>
      {:else if projection === 'corkboard'}
        <div class="flex min-w-max gap-4 p-4 sm:p-6">
          {#each chapterGroups as group (group.key)}
            <section class="w-64 shrink-0" aria-labelledby={`cork-${group.key}`}><div class="mb-2 flex items-center justify-between border-b border-border pb-2"><h2 id={`cork-${group.key}`} class="truncate text-[10px] font-semibold uppercase tracking-wide text-foreground">{group.title}</h2><span class="font-mono text-[9px] text-muted-foreground">{group.items.length}</span></div><div class="space-y-2">{#each group.items as scene, index (scene.id)}{@const branchUnit = units.find((unit) => unit.id === scene.id)}<button type="button" draggable={Boolean(scene.sceneEntityId || branchUnit?.parentUnitId)} ondragstart={() => (draggingSceneId = scene.id)} ondragend={() => (draggingSceneId = null)} ondragover={(event) => { const source = scenes.find((item) => item.id === draggingSceneId); const sourceUnit = units.find((unit) => unit.id === source?.id); if (source?.chapterId === scene.chapterId && ((source.sceneEntityId && scene.sceneEntityId) || (sourceUnit?.parentUnitId && sourceUnit.parentUnitId === branchUnit?.parentUnitId))) event.preventDefault(); }} ondrop={(event) => void dropBefore(scene, event)} onclick={() => selectScene(scene)} title={scene.sceneEntityId || branchUnit?.parentUnitId ? 'Open metadata; drag within this chapter to reorder' : 'Open artifact metadata'} class={cn('w-full rounded border bg-sidebar p-3 text-left shadow-md outline-none transition-[border-color,transform,opacity] focus-visible:ring-2 focus-visible:ring-accent motion-safe:hover:-translate-y-0.5', selectedSceneId === scene.id ? 'border-accent' : 'border-border hover:border-accent/40', draggingSceneId === scene.id && 'opacity-50')}><span class="font-mono text-[9px] text-accent">{String(index + 1).padStart(2, '0')}</span><h3 class="mt-1 text-xs font-medium text-foreground">{scene.title}</h3><p class="mt-1 line-clamp-3 text-[11px] leading-relaxed text-muted-foreground">{scene.summary || scene.goal || 'Open metadata to define this scene.'}</p><div class="mt-3 flex items-center justify-between border-t border-border/60 pt-2 font-mono text-[9px] text-muted-foreground"><span>{scene.pov ? characterLabel(scene.pov) : 'POV —'}</span><span>{scene.status}</span></div></button>{/each}</div></section>
          {/each}
        </div>
      {:else if projection === 'plot-grid'}
        <div class="min-w-max p-4 sm:p-6">
          {#if activeThreads.length === 0}<p class="text-xs text-muted-foreground">No active plot threads have been linked to scenes.</p>{:else}<table class="border-collapse text-[10px]"><thead><tr><th class="sticky left-0 z-10 min-w-44 border-b border-r border-border bg-background p-2 text-left font-semibold uppercase tracking-wide text-muted-foreground">Plot thread</th>{#each scenes as scene, index (scene.id)}<th class="w-16 min-w-16 border-b border-border p-1 font-mono font-normal text-muted-foreground"><button type="button" onclick={() => selectScene(scene)} class="w-full truncate outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-accent" title={scene.title}>S{index + 1}</button></th>{/each}</tr></thead><tbody>{#each activeThreads as thread (thread.id)}<tr><th class="sticky left-0 z-10 border-b border-r border-border bg-background p-2 text-left"><span class="block text-[11px] font-medium text-foreground">{thread.title}</span><span class="font-mono text-[9px] font-normal uppercase text-muted-foreground">{thread.kind}</span></th>{#each scenes as scene (scene.id)}<td class="h-10 border-b border-border/45 text-center">{#if sceneInThread(scene, thread)}<button type="button" onclick={() => selectScene(scene)} class="mx-auto flex size-5 items-center justify-center rounded-full bg-accent/15 text-accent outline-none hover:bg-accent hover:text-accent-foreground focus-visible:ring-2 focus-visible:ring-accent" aria-label={`${thread.title} appears in ${scene.title}`}><Check class="size-3" /></button>{:else}<span class="text-border">·</span>{/if}</td>{/each}</tr>{/each}</tbody></table>{/if}
        </div>
      {:else if projection === 'timeline'}
        <div class="mx-auto max-w-4xl p-5 sm:p-9">{#if timeline.length === 0}<div class="py-16 text-center text-xs text-muted-foreground">No timeline events have been committed.</div>{:else}<ol class="relative ml-3 border-l border-border">{#each timeline as event, index (event.id)}<li class="relative pb-8 pl-6 last:pb-0"><span class="absolute -left-2 top-0 flex size-4 items-center justify-center rounded-full border border-accent/50 bg-background font-mono text-[8px] text-accent">{index + 1}</span><div class="flex flex-wrap items-baseline justify-between gap-2"><h2 class="font-serif text-base font-semibold text-foreground">{event.title}</h2><span class="font-mono text-[9px] uppercase text-accent">{chronology(event.chronology)}</span></div>{#if event.description}<p class="mt-1 text-xs leading-relaxed text-muted-foreground">{event.description}</p>{/if}{#if event.participantRefs.length}<div class="mt-2 flex flex-wrap gap-1">{#each event.participantRefs as ref (`${event.id}-${ref.type}-${ref.id}`)}<span class="rounded border border-border px-1.5 py-0.5 text-[9px] text-muted-foreground">{ref.label ?? ref.key ?? ref.id}</span>{/each}</div>{/if}</li>{/each}</ol>{/if}</div>
      {:else if projection === 'arc'}
        <div class="mx-auto max-w-5xl p-5 sm:p-9">{#if arcThreads.length === 0}<div class="py-16 text-center"><GitBranch class="mx-auto size-7 text-muted-foreground/40" /><p class="mt-3 text-xs text-muted-foreground">No character-arc plot threads have been committed.</p></div>{:else}<div class="space-y-8">{#each arcThreads as thread (thread.id)}<section><div class="flex items-baseline justify-between gap-3"><div><h2 class="text-sm font-medium text-foreground">{thread.title}</h2><p class="mt-0.5 text-[11px] text-muted-foreground">{thread.summary}</p></div><span class="font-mono text-[9px] uppercase text-muted-foreground">{thread.status}</span></div><div class="relative mt-4 flex h-8 items-center"><span class="absolute inset-x-0 h-px bg-border"></span>{#each scenes as scene, index (scene.id)}{#if sceneInThread(scene, thread)}<button type="button" onclick={() => selectScene(scene)} class="absolute flex size-5 -translate-x-1/2 items-center justify-center rounded-full border border-accent bg-background text-[8px] text-accent outline-none hover:bg-accent hover:text-accent-foreground focus-visible:ring-2 focus-visible:ring-accent" style:left={`${scenes.length <= 1 ? 50 : (index / (scenes.length - 1)) * 100}%`} title={scene.title}>{index + 1}</button>{/if}{/each}</div><div class="flex justify-between font-mono text-[8px] uppercase text-muted-foreground"><span>opening state</span><ArrowRight class="size-3" /><span>final choice</span></div></section>{/each}</div>{/if}</div>
      {:else}
        <div class="min-w-max p-5 sm:p-9">{#if tensionScenes.length < 2}<div class="w-[min(90vw,40rem)] py-16 text-center"><SlidersHorizontal class="mx-auto size-7 text-muted-foreground/40" /><p class="mt-3 text-xs text-foreground">Tension needs scene metadata.</p><p class="mt-1 text-[11px] text-muted-foreground">Open at least two scene plans and add a numeric tension level. OpenTales will not invent the curve from word count.</p></div>{:else}<div class="mb-3 flex items-baseline justify-between"><div><h2 class="text-sm font-medium text-foreground">Scene tension</h2><p class="text-[10px] text-muted-foreground">Declared ScenePlan tension, in manuscript order</p></div><span class="font-mono text-[9px] text-muted-foreground">peak {tensionPeak}</span></div><svg width={tensionWidth} height="230" viewBox={`0 0 ${tensionWidth} 230`} role="img" aria-label="Scene tension curve"><g stroke="color-mix(in oklch,var(--border) 75%,transparent)" stroke-width="1">{#each [40, 90, 140, 190] as y (y)}<line x1="30" y1={y} x2={tensionWidth - 25} y2={y} />{/each}</g><polyline points={tensionPoints} fill="none" stroke="var(--accent)" stroke-width="2" stroke-linejoin="round" />{#each tensionScenes as scene, index (scene.id)}{@const x = 40 + index * ((tensionWidth - 80) / Math.max(1, tensionScenes.length - 1))}{@const y = 190 - ((scene.tension ?? 0) / tensionPeak) * 150}<g><circle cx={x} cy={y} r="5" fill="var(--background)" stroke="var(--accent)" stroke-width="2" /><text x={x} y="215" text-anchor="middle" fill="var(--muted-foreground)" font-size="9">S{scenes.indexOf(scene) + 1}</text></g>{/each}</svg>{/if}</div>
      {/if}
    </div>

    {#if metadataOpen && selectedScene && (selectedArtifact || selectedSceneEntity)}
      <aside class="w-full shrink-0 border-t border-border bg-sidebar xl:w-[22rem] xl:border-l xl:border-t-0" aria-label="Scene metadata">
        <div class="flex items-center justify-between border-b border-border px-3 py-2"><div><h2 class="text-xs font-semibold text-foreground">Scene metadata</h2><p class="font-mono text-[9px] uppercase text-muted-foreground">{selectedArtifact ? `${selectedArtifact.key} · v${selectedArtifact.version}` : `scene:${selectedSceneEntity?.id}`}</p></div><button type="button" onclick={() => (metadataOpen = false)} aria-label="Close scene metadata" class="rounded p-1 text-muted-foreground outline-none hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-accent"><X class="size-3.5" /></button></div>
        <div class="max-h-[55vh] overflow-y-auto p-3 xl:max-h-[calc(100vh-10rem)]">
          <div class="mb-3 grid grid-cols-2 gap-2 text-[10px]"><div class="border-l border-border pl-2"><span class="block uppercase text-muted-foreground">POV</span><span class="mt-0.5 block text-foreground">{selectedScene.pov ? characterLabel(selectedScene.pov) : 'Not set'}</span></div><div class="border-l border-border pl-2"><span class="block uppercase text-muted-foreground">Location</span><span class="mt-0.5 block text-foreground">{selectedScene.location ? locationLabel(selectedScene.location) : 'Not set'}</span></div></div>
          <div class="space-y-3">
            <label><span class="mb-1 block text-[9px] uppercase tracking-wide text-muted-foreground">Title</span><input bind:value={draft.title} class="h-8 w-full rounded border border-border bg-input/50 px-2 text-[11px] text-foreground outline-none focus-visible:border-accent focus-visible:ring-2 focus-visible:ring-accent/30" /></label>
            <div class="grid grid-cols-2 gap-2"><label><span class="mb-1 block text-[9px] uppercase tracking-wide text-muted-foreground">POV</span><select bind:value={draft.povCharacterId} class="h-8 w-full rounded border border-border bg-input/50 px-2 text-[10px] text-foreground"><option value="">Not set</option>{#each manuscript.characters as character (character.id)}<option value={character.id}>{character.name}</option>{/each}</select></label><label><span class="mb-1 block text-[9px] uppercase tracking-wide text-muted-foreground">Location</span><select bind:value={draft.locationId} class="h-8 w-full rounded border border-border bg-input/50 px-2 text-[10px] text-foreground"><option value="">Not set</option>{#each manuscript.locations as location (location.id)}<option value={location.id}>{location.name}</option>{/each}</select></label></div>
            <div class="grid grid-cols-3 gap-2"><label><span class="mb-1 block text-[9px] uppercase tracking-wide text-muted-foreground">Status</span><select bind:value={draft.status} class="h-8 w-full rounded border border-border bg-input/50 px-1 text-[10px] text-foreground">{#each selectedArtifact ? ['draft','validated','accepted'] : ['planned','draft','in-progress','review','revised','final'] as status (status)}<option value={status}>{status}</option>{/each}</select></label><label><span class="mb-1 block text-[9px] uppercase tracking-wide text-muted-foreground">Story date</span><input bind:value={draft.storyDate} class="h-8 w-full rounded border border-border bg-input/50 px-2 font-mono text-[9px] text-foreground" /></label><label><span class="mb-1 block text-[9px] uppercase tracking-wide text-muted-foreground">Target words</span><input bind:value={draft.estimatedWordCount} type="number" min="0" class="h-8 w-full rounded border border-border bg-input/50 px-2 font-mono text-[9px] text-foreground" /></label></div>
            <label><span class="mb-1 block text-[9px] uppercase tracking-wide text-muted-foreground">Story time</span><input bind:value={draft.storyTime} class="h-8 w-full rounded border border-border bg-input/50 px-2 font-mono text-[10px] text-foreground outline-none focus-visible:border-accent focus-visible:ring-2 focus-visible:ring-accent/30" /></label>
            {#each [
              ['function', 'Scene function'], ['goal', 'POV immediate goal'], ['obstacle', 'Obstacle'], ['stakes', 'Stakes'], ['conflict', 'Conflict'], ['turn', 'Turn'], ['revelation', 'Revelations'], ['outcome', 'Outcome'], ['emotionalValueShift', 'Emotional value shift'], ['summary', 'Scene summary'], ['writerNotes', 'Writer notes'], ['aiNotes', 'AI provenance notes']
            ] as field (field[0])}<label><span class="mb-1 block text-[9px] uppercase tracking-wide text-muted-foreground">{field[1]}</span><textarea bind:value={draft[field[0] as keyof typeof draft]} rows="2" class="w-full resize-y rounded border border-border bg-input/40 px-2 py-1.5 text-[11px] leading-relaxed text-foreground outline-none focus-visible:border-accent focus-visible:ring-2 focus-visible:ring-accent/30"></textarea></label>{/each}
            <label><span class="mb-1 block text-[9px] uppercase tracking-wide text-muted-foreground">Tension level <span class="normal-case tracking-normal">(0–1, optional)</span></span><input bind:value={draft.tension} type="number" min="0" max="1" step="0.05" placeholder="0.7" class="h-8 w-full rounded border border-border bg-input/50 px-2 font-mono text-[10px] text-foreground outline-none focus-visible:border-accent focus-visible:ring-2 focus-visible:ring-accent/30" /></label>
            <details class="border-t border-border pt-3"><summary class="cursor-pointer text-[9px] font-semibold uppercase tracking-wide text-muted-foreground">Connections & state deltas</summary><div class="mt-3 space-y-3">{#each [['characterPresentIds','Characters present'],['characterReferencedIds','Characters referenced'],['plotThreadIds','Plot threads'],['setupPayoffIds','Setup / payoff links']] as field (field[0])}<label><span class="mb-1 block text-[9px] uppercase text-muted-foreground">{field[1]} <span class="normal-case">(comma separated IDs)</span></span><input bind:value={draft[field[0] as keyof typeof draft]} class="h-8 w-full rounded border border-border bg-input/50 px-2 font-mono text-[9px] text-foreground" /></label>{/each}{#each [['knowledgeDeltas','Knowledge gained'],['objectTransfers','Objects transferred'],['injuryStateChanges','Injuries / state changes'],['worldRuleRefs','World rules invoked'],['entryState','Entry state'],['exitState','Exit state']] as field (field[0])}<label><span class="mb-1 block text-[9px] uppercase text-muted-foreground">{field[1]} <span class="normal-case">(JSON)</span></span><textarea bind:value={draft[field[0] as keyof typeof draft]} rows="3" spellcheck="false" class="w-full rounded border border-border bg-input/40 p-2 font-mono text-[9px] text-foreground"></textarea></label>{/each}</div></details>
          </div>
          {#if selectedScene.characters.length || selectedScene.threads.length}<div class="mt-4 border-t border-border pt-3 text-[10px]">{#if selectedScene.characters.length}<div class="flex gap-2"><User class="mt-0.5 size-3 shrink-0 text-muted-foreground" /><div class="flex flex-wrap gap-1">{#each selectedScene.characters as character (character)}<span class="rounded border border-border px-1.5 py-0.5 text-muted-foreground">{characterLabel(character)}</span>{/each}</div></div>{/if}{#if selectedScene.threads.length}<div class="mt-2 flex gap-2"><GitBranch class="mt-0.5 size-3 shrink-0 text-muted-foreground" /><div class="flex flex-wrap gap-1">{#each selectedScene.threads as thread (thread)}<span class="rounded border border-border px-1.5 py-0.5 text-muted-foreground">{threadLabel(thread)}</span>{/each}</div></div>{/if}</div>{/if}
        </div>
        {#if metadataError}<div class="border-t border-destructive/30 bg-destructive/8 px-3 py-2 text-[10px] text-destructive-foreground" role="alert">{metadataError}</div>{/if}<div class="flex gap-2 border-t border-border p-2"><button type="button" onclick={() => openChapter(selectedScene)} disabled={!manuscript.chapters.some((chapter) => chapter.id === selectedScene.chapterId) && !units.some((unit) => unit.id === selectedScene.id)} class="inline-flex h-8 flex-1 items-center justify-center gap-1 rounded border border-border text-[10px] text-foreground outline-none hover:border-accent/50 disabled:opacity-40 focus-visible:ring-2 focus-visible:ring-accent"><MapPin class="size-3" />Open prose</button><button type="button" onclick={() => void saveMetadata()} disabled={saving} class="inline-flex h-8 flex-1 items-center justify-center gap-1 rounded bg-accent text-[10px] font-medium text-accent-foreground outline-none disabled:opacity-50 focus-visible:ring-2 focus-visible:ring-accent"><Save class="size-3" />{saving ? 'Saving…' : 'Save metadata'}</button></div>
      </aside>
    {/if}
  </div>
</section>
