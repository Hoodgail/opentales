<script lang="ts">
  import { BookMarked, Braces, CalendarClock, Database, GitBranch, Link2, LoaderCircle, RefreshCw, Search } from 'lucide-svelte';
  import type { StoryArtifact, StoryStateSnapshot } from '@opentales/sdk';
  import type { BibleSection, BibleSelection } from '$lib/stores/storyUi.svelte';
  import { cn } from '$lib/utils';
  import HeaderButton from './HeaderButton.svelte';
  import PanelHeader from './PanelHeader.svelte';

  interface Props {
    artifacts: StoryArtifact[];
    snapshot: StoryStateSnapshot | null;
    loading?: boolean;
    error?: string | null;
    selection?: BibleSelection | null;
    onOpen: (selection?: BibleSelection) => void;
    onRefresh: () => void;
  }

  let { artifacts, snapshot, loading = false, error = null, selection = null, onOpen, onRefresh }: Props = $props();
  let section = $state<BibleSection>('artifacts');
  let query = $state('');

  const sections: Array<{ id: BibleSection; label: string; icon: typeof Braces }> = [
    { id: 'artifacts', label: 'Artifacts', icon: Braces },
    { id: 'canon', label: 'Canon facts', icon: BookMarked },
    { id: 'entities', label: 'Entity state', icon: Database },
    { id: 'loops', label: 'Open loops', icon: GitBranch },
    { id: 'timeline', label: 'Timeline', icon: CalendarClock },
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
    requestAnimationFrame(() => document.getElementById(`story-bible-side-tab-${section}`)?.focus());
  }
  const rows = $derived.by(() => {
    const needle = query.trim().toLowerCase();
    if (section === 'artifacts') return artifacts.filter((item) => !needle || `${item.title} ${item.key} ${item.type}`.toLowerCase().includes(needle));
    if (section === 'canon') return (snapshot?.canonFacts ?? []).filter((item) => !needle || `${item.subjectId} ${item.predicate} ${item.key}`.toLowerCase().includes(needle));
    if (section === 'entities') return (snapshot?.entityStates ?? []).filter((item) => !needle || `${item.entityId} ${item.stateKey} ${item.key}`.toLowerCase().includes(needle));
    if (section === 'loops') return (snapshot?.openLoops ?? []).filter((item) => !needle || `${item.title} ${item.description} ${item.kind}`.toLowerCase().includes(needle));
    if (section === 'timeline') return (snapshot?.timelineEvents ?? []).filter((item) => !needle || `${item.title} ${item.description ?? ''}`.toLowerCase().includes(needle));
    if (section === 'setups') return (snapshot?.setupPayoffs ?? []).filter((item) => !needle || `${item.title} ${item.description}`.toLowerCase().includes(needle));
    return (snapshot?.plotThreads ?? []).filter((item) => !needle || `${item.title} ${item.summary}`.toLowerCase().includes(needle));
  });

  function title(item: (typeof rows)[number]): string {
    if ('title' in item && typeof item.title === 'string') return item.title;
    if ('subjectId' in item) return `${item.subjectId} ${item.predicate}`;
    if ('entityId' in item) return `${item.entityId} · ${item.stateKey}`;
    return item.id;
  }

  function meta(item: (typeof rows)[number]): string {
    if ('type' in item && typeof item.type === 'string') return `${item.type} · ${'status' in item ? item.status : ''}`;
    if ('kind' in item && typeof item.kind === 'string') return `${item.kind} · ${'status' in item ? item.status : ''}`;
    return 'status' in item ? String(item.status) : '';
  }
</script>

<div class="flex h-full flex-col">
  <PanelHeader title="Story Bible">
    {#snippet actions()}<HeaderButton icon={RefreshCw} label="Refresh Story Bible" onclick={onRefresh} />{/snippet}
  </PanelHeader>
  <div class="flex overflow-x-auto border-b border-border [scrollbar-width:none]" role="tablist" aria-label="Story Bible sections">
    {#each sections as item, index (item.id)}<button type="button" role="tab" id={`story-bible-side-tab-${item.id}`} aria-controls={`story-bible-side-panel-${item.id}`} aria-selected={section === item.id} tabindex={section === item.id ? 0 : -1} onclick={() => (section = item.id)} onkeydown={(event) => moveSection(event, index)} title={item.label} class={cn('flex size-9 shrink-0 items-center justify-center outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent', section === item.id ? 'bg-accent/10 text-accent' : 'text-muted-foreground hover:text-foreground')}><item.icon class="size-3.5" /><span class="sr-only">{item.label}</span></button>{/each}
  </div>
  <div class="border-b border-border p-2"><label class="relative block"><Search class="pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" /><span class="sr-only">Filter Story Bible</span><input bind:value={query} placeholder={`Filter ${sections.find((item) => item.id === section)?.label.toLowerCase()}…`} class="h-8 w-full rounded border border-border bg-input/50 pl-7 pr-2 text-[11px] text-foreground outline-none focus-visible:border-accent focus-visible:ring-2 focus-visible:ring-accent/30" /></label></div>
  <div id={`story-bible-side-panel-${section}`} role="tabpanel" aria-labelledby={`story-bible-side-tab-${section}`} class="min-h-0 flex-1 overflow-y-auto">
    {#if loading && !snapshot}<div class="flex items-center gap-2 p-4 text-[11px] text-muted-foreground"><LoaderCircle class="size-3.5 motion-safe:animate-spin" />Loading structured story state…</div>
    {:else if error && !snapshot}<div class="p-4"><div class="border-l-2 border-destructive bg-destructive/8 px-3 py-2 text-[11px] text-destructive-foreground">{error}</div><button type="button" onclick={onRefresh} class="mt-3 rounded border border-border px-2 py-1 text-[10px] text-foreground">Try again</button></div>
    {:else if rows.length === 0}<div class="px-4 py-10 text-center text-[11px] leading-relaxed text-muted-foreground">No {sections.find((item) => item.id === section)?.label.toLowerCase()} in this build.</div>
    {:else}<div class="divide-y divide-border/55">{#each rows as item (item.id)}<button type="button" onclick={() => onOpen({section,id:item.id})} class={cn('w-full px-3 py-2.5 text-left outline-none hover:bg-muted/35 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent', selection?.section === section && selection?.id === item.id && 'bg-accent/6')}><span class="block truncate text-[11px] font-medium text-foreground">{title(item)}</span><span class="mt-0.5 block truncate font-mono text-[9px] uppercase text-muted-foreground">{meta(item)}</span></button>{/each}</div>{/if}
  </div>
  <button type="button" onclick={() => onOpen()} class="m-2 inline-flex h-8 items-center justify-center gap-1 rounded border border-border text-[10px] text-foreground outline-none hover:border-accent/50 focus-visible:ring-2 focus-visible:ring-accent"><BookMarked class="size-3" />Open full Story Bible</button>
</div>
