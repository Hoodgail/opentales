<script lang="ts">
  import { Archive, BookMarked, BookOpen, BookOpenText, Bot, Compass, FileText, GitPullRequest, History, MapPin, Network, Sparkles, Users, Workflow, X } from 'lucide-svelte';
  import { manuscript } from '$lib/stores/manuscript.svelte';
  import { viewport } from '$lib/stores/viewport.svelte';
  import type { OpenTab } from '$lib/data/manuscript-types';
  import { cn } from '$lib/utils';

  const tabIcon = {
    chapter: FileText,
    character: Users,
    location: MapPin,
    manuscript: BookOpenText,
    build: Workflow,
    'story-bible': BookMarked,
    'outline-studio': Network,
    publishing: Archive,
    revisions: History,
    structure: Compass,
    outline: BookOpen,
    submission: GitPullRequest,
    doc: FileText,
    'ai-skill': Sparkles,
    'ai-approval': Bot
  } as const;

  function close(e: MouseEvent, t: OpenTab) {
    e.stopPropagation();
    void manuscript.closeTab(t.id);
  }

  function handleTabKey(e: KeyboardEvent, index: number, tab: OpenTab) {
    if (e.key === 'Delete' || e.key === 'Backspace') {
      e.preventDefault();
      void manuscript.closeTab(tab.id);
      return;
    }
    const target = e.key === 'ArrowRight' ? (index + 1) % manuscript.tabs.length
      : e.key === 'ArrowLeft' ? (index - 1 + manuscript.tabs.length) % manuscript.tabs.length
      : e.key === 'Home' ? 0
      : e.key === 'End' ? manuscript.tabs.length - 1
      : -1;
    if (target < 0) return;
    e.preventDefault();
    const next = manuscript.tabs[target];
    void manuscript.setActiveTab(next.id).then(() => document.getElementById(`editor-tab-${next.id}`)?.focus());
  }
</script>

{#if manuscript.tabs.length > 0}
  <div
    class={cn(
      'editor-tabs flex shrink-0 items-stretch overflow-x-auto overflow-y-hidden border-b border-border bg-sidebar',
      viewport.mobile ? 'h-11' : 'h-9'
    )}
    role="tablist"
    aria-label="Open editors"
  >
    {#each manuscript.tabs as t, index (t.id)}
      {@const Icon = tabIcon[t.type]}
      {@const active = t.id === manuscript.activeTabId}
      <div class={cn(
          'group relative flex h-full max-w-[220px] shrink-0 items-center border-r border-border text-xs transition-colors',
          active
            ? 'bg-background text-foreground'
            : 'bg-sidebar text-muted-foreground hover:bg-muted/50 hover:text-foreground/90'
        )}>
        {#if active}
          <div class="absolute inset-x-0 top-0 h-px bg-accent" aria-hidden="true"></div>
        {/if}
        <button id={`editor-tab-${t.id}`} type="button" role="tab" tabindex={active ? 0 : -1} aria-selected={active} aria-controls={`editor-panel-${t.id}`} onclick={() => void manuscript.setActiveTab(t.id)} onkeydown={(event) => handleTabKey(event, index, t)} class="flex min-w-0 flex-1 items-center gap-2 py-2 pl-3 text-left outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent"><Icon class="size-3.5 shrink-0" /><span class="truncate">{t.title}</span>{#if t.dirty}<span class="size-1.5 shrink-0 rounded-full bg-accent"></span>{/if}</button>
        <button
          type="button"
          onclick={(e) => close(e, t)}
          class={cn(
            'mx-2 flex size-4 shrink-0 items-center justify-center rounded transition-opacity hover:bg-muted-foreground/20 focus-visible:ring-2 focus-visible:ring-accent',
            viewport.mobile
              ? 'opacity-70'
              : 'opacity-0 group-hover:opacity-100'
          )}
          aria-label="Close tab"
        >
          <X class="size-3" />
        </button>
      </div>
    {/each}
    <div class="shrink-0 flex-1 border-b border-border"></div>
  </div>
{/if}

<style>
  .editor-tabs {
    -webkit-overflow-scrolling: touch;
    overscroll-behavior-x: contain;
    scrollbar-width: thin;
  }
  .editor-tabs::-webkit-scrollbar {
    height: 0;
  }
</style>
