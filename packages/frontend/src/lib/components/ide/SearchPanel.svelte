<script lang="ts">
  import {
    BookMarked,
    Braces,
    FileText,
    GitBranch,
    Link2,
    LoaderCircle,
    MapPin,
    Replace,
    Search,
    Users,
    X
  } from 'lucide-svelte';
  import type { StorySearchKind } from '@opentales/sdk';
  import { ai } from '$lib/stores/ai.svelte';
  import { manuscript } from '$lib/stores/manuscript.svelte';
  import { storyIde } from '$lib/stores/storyIde.svelte';
  import { storyUi } from '$lib/stores/storyUi.svelte';
  import { matchesStoryQuery, parseStoryQuery, type SearchableStoryRecord } from '$lib/story-ide-model';
  import PanelHeader from './PanelHeader.svelte';

  type ResultKind = StorySearchKind | 'plot';
  const storySearchKinds: StorySearchKind[] = [
    'artifact', 'build-unit', 'chapter', 'scene', 'character', 'location', 'doc', 'obstacle', 'act', 'story-structure', 'relationship', 'asset',
    'canon-fact', 'entity-state', 'timeline-event', 'open-loop', 'setup-payoff', 'plot-thread'
  ];
  function isStorySearchKind(value: string): value is StorySearchKind {
    return storySearchKinds.some((kind) => kind === value);
  }
  interface Result extends SearchableStoryRecord {
    kind: ResultKind;
    snippet: string;
    chapterId?: string;
    line?: number;
    refType?: string;
    refId?: string;
    source: 'index' | 'live';
    relationship?: string;
    unitId?: string;
    start?: number;
    end?: number;
  }

  let q = $state('');
  let referenceTarget = $state<Result | null>(null);
  let loadedProjectId = $state<string | null>(null);
  let requestedQuery = $state('');
  let handledReferenceNonce = $state(0);
  const parsed = $derived(parseStoryQuery(q));
  const backendQuery = $derived(parsed.regex?.source ?? [...parsed.exact, ...parsed.text].join(' ').trim());
  const requestKey = $derived(JSON.stringify({ query: backendQuery, exact: parsed.exact, filters: parsed.filters, regex: parsed.regex?.toString() ?? null }));

  $effect(() => {
    const projectId = manuscript.projectId;
    if (projectId && loadedProjectId !== projectId) {
      loadedProjectId = projectId;
      void ai.loadFileTree(projectId);
      void storyIde.loadRuns(projectId).then(() => {
        const first = storyIde.runs[0];
        if (!storyIde.selectedRunId && first) void storyIde.selectRun(projectId, first.id);
      });
    }
  });

  $effect(() => {
    const request = storyUi.referenceRequest;
    if (!request || request.nonce === handledReferenceNonce) return;
    const kind = (['chapter','scene','character','location','doc','artifact','canon-fact','entity-state','timeline-event','open-loop','setup-payoff','plot-thread','obstacle'].includes(request.refType) ? request.refType : 'artifact') as ResultKind;
    referenceTarget = { id: request.refId, kind, title: request.title, text: request.title, snippet: '', refType: request.refType, refId: request.refId, source: 'index' };
    storyIde.clearSearch();
    if (storyIde.selectedRunId) {
      handledReferenceNonce = request.nonce;
      void storyIde.findReferences({ refType: request.refType, refId: request.refId, limit: 100 });
    }
  });

  $effect(() => {
    const query = backendQuery;
    const buildId = storyIde.selectedRunId;
    if (!buildId || referenceTarget || parsed.invalidRegex || !q.trim()) return;
    const timer = setTimeout(() => {
      requestedQuery = requestKey;
      const kinds = (parsed.filters.type ?? parsed.filters.kind ?? []).filter(isStorySearchKind);
      void storyIde.search({
        query,
        strategy: parsed.regex ? 'regex' : parsed.exact.length && !parsed.text.length ? 'exact' : 'hybrid',
        kinds: kinds.length ? kinds : undefined,
        statuses: parsed.filters.status,
        filters: Object.fromEntries(Object.entries(parsed.filters).filter(([field]) => !['type','kind','status'].includes(field))),
        caseSensitive: parsed.regex ? !parsed.regex.flags.includes('i') : undefined,
        limit: 100
      });
    }, 250);
    return () => clearTimeout(timer);
  });

  function lineFor(content: string, terms: string[]): number | undefined {
    if (!terms.length) return undefined;
    const index = content.toLowerCase().indexOf(terms[0].toLowerCase());
    return index < 0 ? undefined : content.slice(0, index).split('\n').length;
  }

  function lineFromOffset(chapterId: string | undefined, offset: number | undefined): number | undefined {
    if (!chapterId || offset === undefined) return undefined;
    const content = manuscript.chapters.find((chapter) => chapter.id === chapterId)?.content;
    return content === undefined ? undefined : content.slice(0, Math.max(0, offset)).split('\n').length;
  }

  function excerpt(content: string, terms: string[]): string {
    const clean = content.replace(/\s+/g, ' ').trim();
    if (!clean) return 'No searchable prose or notes.';
    const lower = clean.toLowerCase();
    const index = terms.map((term) => lower.indexOf(term.toLowerCase())).find((value) => value >= 0) ?? 0;
    const start = Math.max(0, index - 42);
    return `${start > 0 ? '…' : ''}${clean.slice(start, start + 130)}${start + 130 < clean.length ? '…' : ''}`;
  }

  function plainSnippet(value: string): string {
    return value.replace(/<\/?b>/gi, '').replace(/&lt;\/?b&gt;/gi, '');
  }

  const liveRecords = $derived.by<Result[]>(() => {
    const terms = [...parsed.exact, ...parsed.text];
    const out: Result[] = [];
    for (const chapter of manuscript.chapters) {
      const pov = manuscript.characters.find((character) => character.id === chapter.povCharacterId)?.name ?? '';
      const location = manuscript.locations.find((item) => item.id === chapter.locationId)?.name ?? '';
      out.push({ id: chapter.id, kind: 'chapter', title: `Ch${chapter.number}: ${chapter.title}`, text: `${chapter.title}\n${chapter.summary}\n${chapter.content}`, snippet: excerpt(`${chapter.summary} ${chapter.content}`, terms), line: lineFor(chapter.content, terms), chapterId: chapter.id, refType: 'chapter', refId: chapter.id, source: 'live', fields: { type: 'chapter', status: chapter.status, pov, location, chapter: chapter.number } });
      for (const scene of chapter.scenes) {
        const text = [scene.title, scene.summary, scene.sceneFunction, scene.goal, scene.obstacle, scene.stakes, scene.conflict, scene.turn, scene.revelation, scene.outcome, scene.writerNotes, scene.content].join('\n');
        out.push({ id: scene.id, kind: 'scene', title: `${chapter.number}.${scene.order + 1} ${scene.title}`, text, snippet: excerpt(text, terms), chapterId: chapter.id, line: lineFor(chapter.content, [scene.title]), refType: 'scene', refId: scene.id, source: 'live', fields: { type: 'scene', status: scene.status, pov: manuscript.characters.find((character) => character.id === scene.povCharacterId)?.name ?? scene.povCharacterId, location: manuscript.locations.find((item) => item.id === scene.locationId)?.name ?? scene.locationId, thread: scene.plotThreadIds, chapter: chapter.number, scene: scene.order + 1, 'scene.goal': scene.goal, setup: scene.setupPayoffIds, entity: scene.characterPresentIds } });
      }
    }
    for (const character of manuscript.characters) {
      const text = [character.name, character.role, character.description, character.appearance, character.motivation, character.arc, ...character.traits].join('\n');
      out.push({ id: character.id, kind: 'character', title: character.name, text, snippet: excerpt(text, terms), refType: 'character', refId: character.id, source: 'live', fields: { type: 'character', status: character.role, entity: [character.id, character.name] } });
    }
    for (const location of manuscript.locations) {
      const text = [location.name, location.type, location.description, location.atmosphere, location.significance, location.sensoryDetails].join('\n');
      out.push({ id: location.id, kind: 'location', title: location.name, text, snippet: excerpt(text, terms), refType: 'location', refId: location.id, source: 'live', fields: { type: 'location', kind: location.type } });
    }
    for (const doc of ai.fileTree.docs) {
      const text = `${doc.title}\n${doc.content}`;
      out.push({ id: doc.id, kind: 'doc', title: doc.title, text, snippet: excerpt(text, terms), refType: 'doc', refId: doc.id, source: 'live', fields: { type: 'doc', kind: doc.kind } });
    }
    const text = [manuscript.structure.logline, manuscript.structure.outline, manuscript.structure.climax, ...manuscript.structure.themes].join('\n');
    out.push({ id: 'story-structure', kind: 'plot', title: 'Story structure', text, snippet: excerpt(text, terms), source: 'live', fields: { type: 'plot' } });
    return out;
  });

  const indexedResults = $derived.by<Result[]>(() => {
    const referenceHits = storyIde.referencesResult?.hits;
    if (referenceTarget && referenceHits) return referenceHits.map((hit) => ({ id: hit.id, kind: hit.kind, title: hit.title, text: plainSnippet(hit.snippet), snippet: plainSnippet(hit.snippet), chapterId: hit.sourceSpan?.chapterId, line: lineFromOffset(hit.sourceSpan?.chapterId, hit.sourceSpan?.start), unitId: hit.sourceSpan?.unitId, start: hit.sourceSpan?.start, end: hit.sourceSpan?.end, refType: hit.ref.type, refId: hit.ref.id, source: 'index', relationship: hit.relationship, fields: { type: hit.kind } }));
    const result = storyIde.searchResult;
    if (!referenceTarget && result && requestedQuery === requestKey) return result.hits.map((hit) => ({ id: hit.id, kind: hit.kind, title: hit.title, text: plainSnippet(hit.snippet), snippet: plainSnippet(hit.snippet), chapterId: hit.sourceSpan?.chapterId, line: lineFromOffset(hit.sourceSpan?.chapterId, hit.sourceSpan?.start), unitId: hit.sourceSpan?.unitId, start: hit.sourceSpan?.start, end: hit.sourceSpan?.end, refType: hit.ref.type, refId: hit.ref.id, source: 'index', fields: { type: hit.kind } }));
    return [];
  });

  const results = $derived.by<Result[]>(() => {
    if (referenceTarget) {
      const name = referenceTarget.title.replace(/^Ch\d+:\s*/, '').toLowerCase();
      const combined = [...indexedResults];
      const ids = new Set(combined.map((item) => `${item.kind}:${item.id}`));
      for (const record of liveRecords.filter((item) => item.id !== referenceTarget?.id && `${item.title}\n${item.text}`.toLowerCase().includes(name))) {
        if (!ids.has(`${record.kind}:${record.id}`)) combined.push({ ...record, relationship: 'prose-mention' });
      }
      return combined;
    }
    if (!q.trim() || parsed.invalidRegex) return [];
    const combined = [...indexedResults];
    const ids = new Set(combined.map((item) => `${item.kind}:${item.id}`));
    for (const record of liveRecords.filter((item) => matchesStoryQuery(item, parsed))) {
      if (!ids.has(`${record.kind}:${record.id}`)) combined.push(record);
    }
    return combined;
  });

  function requestRename(result: Result) {
    if (result.kind === 'character') {
      const character = manuscript.characters.find((item) => item.id === result.id);
      if (character) storyUi.requestRenameSymbol({ targetType: 'character', targetId: character.id, name: character.name, aliases: character.aliases });
    } else if (result.kind === 'location') {
      const location = manuscript.locations.find((item) => item.id === result.id);
      if (location) storyUi.requestRenameSymbol({ targetType: 'location', targetId: location.id, name: location.name, aliases: location.aliases });
    }
  }

  function selectReference(result: Result) {
    referenceTarget = result;
    storyIde.clearSearch();
    if (storyIde.selectedRunId && result.refType && result.refId) void storyIde.findReferences({ refType: result.refType, refId: result.refId, limit: 100 });
  }

  function closeReferences() {
    referenceTarget = null;
    storyIde.clearSearch();
    storyUi.clearReferenceRequest();
  }

  function openBible(kind: ResultKind, id: string) {
    const section = kind === 'artifact' ? 'artifacts' : kind === 'canon-fact' ? 'canon' : kind === 'entity-state' ? 'entities' : kind === 'open-loop' ? 'loops' : null;
    if (!section) return;
    storyUi.selectBible({ section, id });
    void manuscript.setActiveView('bible');
    void manuscript.openTab({ id: 'tab-story-bible', type: 'story-bible', refId: storyIde.selectedRunId ?? 'story-bible', title: 'Story Bible' });
  }

  function openResult(result: Result) {
    if (result.unitId || result.kind === 'build-unit') {
      storyUi.requestBuildSurface('manuscript', { unitId: result.unitId ?? result.id, start: result.start, end: result.end });
      void manuscript.setActiveView('build');
      void manuscript.openTab({ id: `tab-build-${storyIde.selectedRunId}`, type: 'build', refId: storyIde.selectedRunId ?? 'build', title: 'Novel Build' });
    } else if (result.chapterId) void manuscript.navigateToChapter(result.chapterId, { line: result.line });
    else if (result.kind === 'character') {
      const item = manuscript.characters.find((candidate) => candidate.id === result.id);
      if (item) void manuscript.openTab({ id: `tab-${item.id}`, type: 'character', refId: item.id, title: item.name });
    } else if (result.kind === 'location') {
      const item = manuscript.locations.find((candidate) => candidate.id === result.id);
      if (item) void manuscript.openTab({ id: `tab-${item.id}`, type: 'location', refId: item.id, title: item.name });
    } else if (result.kind === 'doc') void manuscript.openTab({ id: `tab-doc-${result.id}`, type: 'doc', refId: result.id, title: result.title });
    else if (['artifact','canon-fact','entity-state','open-loop'].includes(result.kind)) openBible(result.kind, result.id);
    else if (result.kind === 'plot' || result.kind === 'obstacle' || result.kind === 'act' || result.kind === 'story-structure') void manuscript.openTab({ id: 'tab-structure', type: 'structure', refId: 'structure', title: 'Story Structure' });
    else if (['timeline-event','setup-payoff','plot-thread'].includes(result.kind)) void manuscript.openTab({ id: 'tab-outline-studio', type: 'outline-studio', refId: storyIde.selectedRunId ?? 'outline', title: 'Semantic Outline' });
  }

  function iconFor(kind: ResultKind) {
    if (kind === 'chapter') return FileText;
    if (kind === 'scene' || kind === 'plot-thread' || kind === 'timeline-event') return GitBranch;
    if (kind === 'character' || kind === 'entity-state') return Users;
    if (kind === 'location') return MapPin;
    if (kind === 'doc' || kind === 'canon-fact' || kind === 'open-loop') return BookMarked;
    return Braces;
  }

  function loadMore() {
    if (referenceTarget && storyIde.referencesResult?.nextOffset !== null && storyIde.referencesResult?.nextOffset !== undefined) {
      void storyIde.findReferences({ refType: referenceTarget.refType ?? referenceTarget.kind, refId: referenceTarget.refId ?? referenceTarget.id, limit: 100, offset: storyIde.referencesResult.nextOffset }, true);
      return;
    }
    const nextOffset = storyIde.searchResult?.nextOffset;
    const nextCursor = storyIde.searchResult?.nextCursor;
    if (!referenceTarget && (nextCursor || (nextOffset !== null && nextOffset !== undefined))) {
      const kinds = (parsed.filters.type ?? parsed.filters.kind ?? []).filter(isStorySearchKind);
      void storyIde.search({ query: backendQuery, strategy: parsed.regex ? 'regex' : parsed.exact.length && !parsed.text.length ? 'exact' : 'hybrid', kinds: kinds.length ? kinds : undefined, statuses: parsed.filters.status, filters: Object.fromEntries(Object.entries(parsed.filters).filter(([field]) => !['type','kind','status'].includes(field))), caseSensitive: parsed.regex ? !parsed.regex.flags.includes('i') : undefined, limit: 100, ...(nextCursor ? { cursor: nextCursor } : { offset: nextOffset! }) }, true);
    }
  }
</script>

<div class="flex h-full flex-col">
  <PanelHeader title={referenceTarget ? 'Find References' : 'Search'} />
  {#if referenceTarget}
    <div class="flex items-center gap-2 border-b border-border bg-accent/6 px-3 py-2"><Link2 class="size-3.5 shrink-0 text-accent" /><div class="min-w-0 flex-1"><span class="block text-[9px] uppercase tracking-wide text-muted-foreground">References to</span><span class="block truncate text-xs text-foreground">{referenceTarget.title}</span></div>{#if storyIde.searching}<LoaderCircle class="size-3.5 motion-safe:animate-spin text-muted-foreground" />{/if}{#if referenceTarget.kind === 'character' || referenceTarget.kind === 'location'}<button type="button" onclick={() => requestRename(referenceTarget!)} aria-label={`Rename ${referenceTarget.title}`} title="Rename symbol" class="rounded p-1 text-muted-foreground outline-none hover:bg-muted hover:text-accent focus-visible:ring-2 focus-visible:ring-accent"><Replace class="size-3.5" /></button>{/if}<button type="button" onclick={closeReferences} aria-label="Close reference search" class="rounded p-1 text-muted-foreground outline-none hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-accent"><X class="size-3.5" /></button></div>
  {:else}
    <div class="border-b border-border p-2"><label class="relative block"><Search class="pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" /><span class="sr-only">Search the whole project</span><input bind:value={q} placeholder={'Mara · pov:Mara · setup:unpaid'} spellcheck="false" class="h-8 w-full rounded border border-border bg-input/60 pl-7 pr-7 font-mono text-[10px] text-foreground outline-none placeholder:text-muted-foreground focus-visible:border-accent focus-visible:ring-2 focus-visible:ring-accent/35" />{#if storyIde.searching}<LoaderCircle class="pointer-events-none absolute right-2 top-1/2 size-3 -translate-y-1/2 motion-safe:animate-spin text-muted-foreground" />{/if}</label><details class="mt-1.5"><summary class="cursor-pointer text-[9px] text-muted-foreground hover:text-foreground">Query syntax</summary><p class="mt-1 font-mono text-[9px] leading-relaxed text-muted-foreground">"exact phrase" · @character:Mara · pov:Mara · status:draft · thread:romance · setup:unpaid · scene.goal:"escape" · after:chapter-10 · regex:/red (moth|butterfly)/i</p></details>{#if parsed.invalidRegex}<p class="mt-1 text-[10px] text-destructive-foreground" role="alert">{parsed.invalidRegex}</p>{/if}{#if storyIde.searchResult?.warnings.length}<p class="mt-1 text-[9px] text-amber-300">{storyIde.searchResult.warnings.join(' · ')}</p>{/if}</div>
  {/if}
  {#if storyIde.error && (q || referenceTarget)}<div class="border-b border-destructive/30 bg-destructive/8 px-3 py-2 text-[10px] text-destructive-foreground" role="status">{storyIde.error}</div>{/if}
  <div class="flex-1 overflow-y-auto">
    {#if !referenceTarget && q.trim() === ''}<div class="px-4 py-12 text-center text-[11px] leading-relaxed text-muted-foreground">Search the persisted story index and live chapter buffers. Field filters compose like an IDE query.</div>
    {:else if !storyIde.searching && results.length === 0}<div class="px-4 py-12 text-center text-[11px] text-muted-foreground">{referenceTarget ? 'No references found in indexed or live project state.' : 'No project records match this query.'}</div>
    {:else}<div class="divide-y divide-border/50">{#each results as result (`${result.source}-${result.kind}-${result.id}`)}{@const Icon = iconFor(result.kind)}<div class="group flex items-start gap-2 px-2 py-2 hover:bg-muted/35"><button type="button" onclick={() => openResult(result)} class="flex min-w-0 flex-1 items-start gap-2 text-left outline-none focus-visible:ring-2 focus-visible:ring-accent/40"><Icon class="mt-0.5 size-3.5 shrink-0 text-muted-foreground" /><span class="min-w-0 flex-1"><span class="block truncate text-[11px] font-medium text-foreground">{result.title}</span><span class="mt-0.5 line-clamp-2 block text-[10px] leading-relaxed text-muted-foreground">{result.snippet}</span><span class="mt-1 block font-mono text-[9px] uppercase text-muted-foreground/65">{result.kind}{result.relationship ? ` · ${result.relationship}` : ''}{result.line ? ` · line ${result.line}` : ''} · {result.source}</span></span></button>{#if result.refId}<button type="button" onclick={() => selectReference(result)} title="Find references" aria-label={`Find references to ${result.title}`} class="rounded p-1 text-muted-foreground opacity-60 outline-none hover:bg-muted hover:text-accent focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-accent sm:opacity-0 sm:group-hover:opacity-100"><Link2 class="size-3" /></button>{/if}{#if result.kind === 'character' || result.kind === 'location'}<button type="button" onclick={() => requestRename(result)} title="Rename symbol" aria-label={`Rename ${result.title}`} class="rounded p-1 text-muted-foreground opacity-60 outline-none hover:bg-muted hover:text-accent focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-accent sm:opacity-0 sm:group-hover:opacity-100"><Replace class="size-3" /></button>{/if}</div>{/each}</div>{/if}
  </div>
  {#if results.length}<div class="flex items-center border-t border-border px-3 py-1.5 font-mono text-[9px] text-muted-foreground"><span>{results.length}/{referenceTarget ? storyIde.referencesResult?.total ?? results.length : storyIde.searchResult?.total ?? results.length} {referenceTarget ? 'references' : 'matches'} · persistent index + live buffers</span>{#if (referenceTarget ? storyIde.referencesResult?.nextOffset : storyIde.searchResult?.nextOffset) !== null && (referenceTarget ? storyIde.referencesResult?.nextOffset : storyIde.searchResult?.nextOffset) !== undefined}<button type="button" onclick={loadMore} disabled={storyIde.searching} class="ml-auto rounded border border-border px-2 py-0.5 text-[9px] text-foreground disabled:opacity-50">Load more</button>{/if}</div>{/if}
</div>
