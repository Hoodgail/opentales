<script lang="ts">
  import { ArrowRight, Bot, Coins, FileText, ShieldCheck, Target } from 'lucide-svelte';
  import type {
    BuildAutonomyMode,
    CreateBuildRunInput,
    ProjectDoc,
    StoryArtifactType
  } from '@opentales/sdk';
  import { cn } from '$lib/utils';

  interface Props {
    brainstorms: ProjectDoc[];
    loading?: boolean;
    error?: string | null;
    onStart: (input: CreateBuildRunInput) => unknown | Promise<unknown>;
  }

  let { brainstorms, loading = false, error = null, onStart }: Props = $props();

  let selectedDocId = $state('');
  let brainstorm = $state('');
  let objective = $state('Build a complete, internally coherent novel from this brainstorm.');
  let targetWordCount = $state(85000);
  let targetChapterCount = $state(32);
  let targetSceneCount = $state(96);
  let targetCharacterCount = $state(8);
  let genre = $state('');
  let targetAudience = $state('Adult');
  let tone = $state('');
  let constraints = $state('');
  let autonomyMode = $state<BuildAutonomyMode>('plan-review');
  let maxTokens = $state<number | null>(750000);
  let maxCost = $state<number | null>(75);
  let submitted = $state(false);
  let submissionKey = $state(crypto.randomUUID());
  let scope = $state({ planning: true, canon: true, chapters: true, scenes: true, diagnostics: true });
  let scopedMode = $state<BuildAutonomyMode>('plan-review');

  const autonomyOptions: Array<{
    id: BuildAutonomyMode;
    title: string;
    description: string;
  }> = [
    {
      id: 'assist',
      title: 'Assist',
      description: 'Review significant mutations one by one.'
    },
    {
      id: 'plan-review',
      title: 'Plan & review',
      description: 'Approve the manifest, then let the build write within its isolated branch.'
    },
    {
      id: 'autonomous-draft',
      title: 'Autonomous draft',
      description: 'Authorize scoped planning, chapters, scenes, canon, and diagnostics until completion or blocker.'
    }
  ];

  const artifactTypes: StoryArtifactType[] = [
    'story-brief',
    'narrative-contract',
    'character-bible',
    'relationship-graph',
    'world-bible',
    'plot-thread',
    'act-architecture',
    'chapter-brief',
    'scene-plan',
    'timeline',
    'setup-payoff-map',
    'research-questions',
    'open-questions',
    'beat',
    'chapter-draft',
    'revision-issue'
  ];

  $effect(() => {
    if (!selectedDocId) return;
    const doc = brainstorms.find((candidate) => candidate.id === selectedDocId);
    if (doc) brainstorm = doc.content;
  });

  $effect(() => {
    if (autonomyMode === scopedMode) return;
    scopedMode = autonomyMode;
    scope = autonomyMode === 'assist'
      ? { planning: true, canon: false, chapters: false, scenes: false, diagnostics: true }
      : { planning: true, canon: true, chapters: true, scenes: true, diagnostics: true };
  });

  async function submit() {
    submitted = true;
    if (!brainstorm.trim() || targetWordCount < 1000) return;
    const result = await onStart({
      idempotencyKey: submissionKey,
      brainstorm: brainstorm.trim(),
      objective: objective.trim() || undefined,
      targetWordCount,
      minWordCount: Math.max(1_000, Math.round(targetWordCount * 0.96)),
      maxWordCount: Math.round(targetWordCount * 1.06),
      targetChapterCount,
      targetSceneCount,
      targetCharacterCount,
      genre: genre.trim() || undefined,
      targetAudience: targetAudience.trim() || undefined,
      tone: tone.split(',').map((value) => value.trim()).filter(Boolean),
      constraints: constraints.split('\n').map((value) => value.trim()).filter(Boolean),
      autonomyMode,
      maxTokens: maxTokens && maxTokens > 0 ? Math.round(maxTokens) : null,
      maxCostMicros: maxCost && maxCost > 0 ? Math.round(maxCost * 1_000_000) : null,
      authorizationScope: {
        artifactTypes,
        chapterIds: [],
        sceneIds: [],
        allowPlanningArtifacts: scope.planning,
        allowCanonWrites: scope.canon,
        allowChapterWrites: scope.chapters,
        allowSceneWrites: scope.scenes,
        allowDiagnostics: scope.diagnostics,
        expiresAt: null
      }
    });
    if (result) {
      submissionKey = crypto.randomUUID();
      submitted = false;
    }
  }
</script>

<div class="min-h-0 flex-1 overflow-y-auto bg-background">
  <form class="mx-auto w-full max-w-[58rem] px-4 py-8 sm:px-8 sm:py-12" onsubmit={(event) => { event.preventDefault(); void submit(); }}>
    <div class="border-b border-border pb-6">
      <div class="flex items-center gap-2 font-mono text-[10px] font-semibold uppercase tracking-[0.18em] text-accent"><Bot class="size-3.5" />New compiler run</div>
      <h1 class="mt-3 max-w-2xl font-serif text-3xl font-semibold tracking-tight text-foreground sm:text-4xl">Turn one brainstorm into a durable Novel Build.</h1>
      <p class="mt-3 max-w-2xl text-sm leading-relaxed text-muted-foreground">OpenTales will compile structured story state, draft on an isolated branch, validate each dependency, and keep the entire run inspectable.</p>
    </div>

    {#if error}<div class="mt-5 border-l-2 border-destructive bg-destructive/10 px-3 py-2 text-sm text-destructive-foreground" role="alert">{error}</div>{/if}

    <fieldset class="mt-7">
      <legend class="flex items-center gap-2 text-xs font-semibold text-foreground"><FileText class="size-3.5 text-accent" />Source brainstorm</legend>
      {#if brainstorms.length > 0}
        <label class="mt-3 block">
          <span class="mb-1 block text-[10px] uppercase tracking-wider text-muted-foreground">Project brainstorm</span>
          <select bind:value={selectedDocId} class="h-9 w-full rounded border border-border bg-input/60 px-2 text-xs text-foreground outline-none focus-visible:border-accent focus-visible:ring-2 focus-visible:ring-accent/30">
            <option value="">Paste or write below</option>
            {#each brainstorms as doc (doc.id)}<option value={doc.id}>{doc.title}</option>{/each}
          </select>
        </label>
      {/if}
      <label class="mt-3 block">
        <span class="sr-only">Brainstorm</span>
        <textarea bind:value={brainstorm} rows="9" placeholder="A disgraced cartographer discovers that every map she draws erases one of her memories…" class={cn('w-full resize-y rounded border bg-transparent px-3 py-2 font-serif text-base leading-relaxed text-foreground outline-none placeholder:text-muted-foreground/60 focus-visible:ring-2 focus-visible:ring-accent/30', submitted && !brainstorm.trim() ? 'border-destructive' : 'border-border focus-visible:border-accent')}></textarea>
        {#if submitted && !brainstorm.trim()}<span class="mt-1 block text-[10px] text-destructive-foreground">A brainstorm is required.</span>{/if}
      </label>
    </fieldset>

    <fieldset class="mt-8 border-t border-border pt-6">
      <legend class="flex items-center gap-2 text-xs font-semibold text-foreground"><Target class="size-3.5 text-accent" />Target contract</legend>
      <div class="mt-3 grid gap-3 sm:grid-cols-2">
        <label class="sm:col-span-2"><span class="mb-1 block text-[10px] uppercase tracking-wider text-muted-foreground">Objective</span><input bind:value={objective} class="h-9 w-full rounded border border-border bg-input/60 px-2 text-xs text-foreground outline-none focus-visible:border-accent focus-visible:ring-2 focus-visible:ring-accent/30" /></label>
        <label><span class="mb-1 block text-[10px] uppercase tracking-wider text-muted-foreground">Target words</span><input bind:value={targetWordCount} type="number" min="1000" step="1000" class="h-9 w-full rounded border border-border bg-input/60 px-2 font-mono text-xs text-foreground outline-none focus-visible:border-accent focus-visible:ring-2 focus-visible:ring-accent/30" /></label>
        <label><span class="mb-1 block text-[10px] uppercase tracking-wider text-muted-foreground">Audience</span><input bind:value={targetAudience} placeholder="Adult" class="h-9 w-full rounded border border-border bg-input/60 px-2 text-xs text-foreground outline-none focus-visible:border-accent focus-visible:ring-2 focus-visible:ring-accent/30" /></label>
        <label><span class="mb-1 block text-[10px] uppercase tracking-wider text-muted-foreground">Chapters</span><input bind:value={targetChapterCount} type="number" min="1" max="500" class="h-9 w-full rounded border border-border bg-input/60 px-2 font-mono text-xs text-foreground" /></label>
        <label><span class="mb-1 block text-[10px] uppercase tracking-wider text-muted-foreground">Scenes</span><input bind:value={targetSceneCount} type="number" min="1" max="5000" class="h-9 w-full rounded border border-border bg-input/60 px-2 font-mono text-xs text-foreground" /></label>
        <label><span class="mb-1 block text-[10px] uppercase tracking-wider text-muted-foreground">Core characters</span><input bind:value={targetCharacterCount} type="number" min="1" max="500" class="h-9 w-full rounded border border-border bg-input/60 px-2 font-mono text-xs text-foreground" /></label>
        <label><span class="mb-1 block text-[10px] uppercase tracking-wider text-muted-foreground">Genre</span><input bind:value={genre} placeholder="Gothic fantasy" class="h-9 w-full rounded border border-border bg-input/60 px-2 text-xs text-foreground outline-none focus-visible:border-accent focus-visible:ring-2 focus-visible:ring-accent/30" /></label>
        <label><span class="mb-1 block text-[10px] uppercase tracking-wider text-muted-foreground">Tone <span class="normal-case tracking-normal">(comma separated)</span></span><input bind:value={tone} placeholder="haunting, intimate, bittersweet" class="h-9 w-full rounded border border-border bg-input/60 px-2 text-xs text-foreground outline-none focus-visible:border-accent focus-visible:ring-2 focus-visible:ring-accent/30" /></label>
        <label class="sm:col-span-2"><span class="mb-1 block text-[10px] uppercase tracking-wider text-muted-foreground">Constraints <span class="normal-case tracking-normal">(one per line)</span></span><textarea bind:value={constraints} rows="4" placeholder={'Close third person\nNo resurrection\nBittersweet ending'} class="w-full resize-y rounded border border-border bg-input/40 px-2 py-2 text-xs leading-relaxed text-foreground outline-none focus-visible:border-accent focus-visible:ring-2 focus-visible:ring-accent/30"></textarea></label>
      </div>
    </fieldset>

    <fieldset class="mt-8 border-t border-border pt-6">
      <legend class="flex items-center gap-2 text-xs font-semibold text-foreground"><ShieldCheck class="size-3.5 text-accent" />Authority</legend>
      <div class="mt-3 grid gap-px overflow-hidden rounded border border-border bg-border md:grid-cols-3">
        {#each autonomyOptions as option (option.id)}
          <label class={cn('cursor-pointer bg-sidebar p-3 outline-none transition-colors hover:bg-muted/60 has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-inset has-[:focus-visible]:ring-accent', autonomyMode === option.id && 'bg-accent/8')}>
            <span class="flex items-center gap-2"><input type="radio" bind:group={autonomyMode} value={option.id} class="accent-accent" /><span class="text-xs font-medium text-foreground">{option.title}</span></span>
            <span class="mt-1.5 block pl-5 text-[11px] leading-relaxed text-muted-foreground">{option.description}</span>
          </label>
        {/each}
      </div>
      <fieldset class="mt-3"><legend class="text-[9px] uppercase tracking-wide text-muted-foreground">Authorized branch capabilities</legend><div class="mt-1 grid gap-1 rounded border border-border bg-sidebar/40 p-2 sm:grid-cols-5">{#each [['planning','Planning artifacts'],['canon','Canon ledger'],['chapters','Chapter prose'],['scenes','Scene prose'],['diagnostics','Diagnostics']] as item (item[0])}<label class="flex items-center gap-2 text-[10px] text-foreground"><input type="checkbox" bind:checked={scope[item[0] as keyof typeof scope]} class="accent-accent" />{item[1]}</label>{/each}</div></fieldset>
      <p class="mt-2 text-[10px] leading-relaxed text-muted-foreground">The build is confined to its generated branch. Final merge always remains under human control.</p>
    </fieldset>

    <fieldset class="mt-8 border-t border-border pt-6">
      <legend class="flex items-center gap-2 text-xs font-semibold text-foreground"><Coins class="size-3.5 text-accent" />Budget ceiling</legend>
      <div class="mt-3 grid gap-3 sm:grid-cols-2">
        <label><span class="mb-1 block text-[10px] uppercase tracking-wider text-muted-foreground">Maximum tokens</span><input bind:value={maxTokens} type="number" min="0" step="10000" class="h-9 w-full rounded border border-border bg-input/60 px-2 font-mono text-xs text-foreground outline-none focus-visible:border-accent focus-visible:ring-2 focus-visible:ring-accent/30" /></label>
        <label><span class="mb-1 block text-[10px] uppercase tracking-wider text-muted-foreground">Maximum cost (USD)</span><input bind:value={maxCost} type="number" min="0" step="1" class="h-9 w-full rounded border border-border bg-input/60 px-2 font-mono text-xs text-foreground outline-none focus-visible:border-accent focus-visible:ring-2 focus-visible:ring-accent/30" /></label>
      </div>
    </fieldset>

    <div class="mt-8 flex items-center justify-between gap-3 border-t border-border pt-5">
      <p class="max-w-md text-[10px] leading-relaxed text-muted-foreground">Starting creates durable workflow state and an isolated branch; it does not merge prose into the canonical manuscript.</p>
      <button type="submit" disabled={loading} class="inline-flex h-9 shrink-0 items-center gap-2 rounded bg-accent px-4 text-xs font-semibold text-accent-foreground outline-none transition-opacity hover:opacity-90 disabled:opacity-50 focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-background">{loading ? 'Starting…' : 'Start Novel Build'}<ArrowRight class="size-3.5" /></button>
    </div>
  </form>
</div>
