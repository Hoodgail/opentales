<script lang="ts">
  import { BookOpen, Compass, FileText, GitPullRequest, MapPin, Users, X } from 'lucide-svelte';
  import { manuscript } from '$lib/stores/manuscript.svelte';
  import type { OpenTab } from '$lib/data/manuscript-types';
  import { cn } from '$lib/utils';

  const tabIcon = {
    chapter: FileText,
    character: Users,
    location: MapPin,
    structure: Compass,
    outline: BookOpen,
    submission: GitPullRequest
  } as const;

  function close(e: MouseEvent, t: OpenTab) {
    e.stopPropagation();
    void manuscript.closeTab(t.id);
  }
</script>

{#if manuscript.tabs.length > 0}
  <div
    class="flex h-9 shrink-0 items-stretch overflow-x-auto border-b border-border bg-sidebar"
  >
    {#each manuscript.tabs as t (t.id)}
      {@const Icon = tabIcon[t.type]}
      {@const active = t.id === manuscript.activeTabId}
      <div
        role="tab"
        tabindex="0"
        aria-selected={active}
        onclick={() => void manuscript.setActiveTab(t.id)}
        onkeydown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') void manuscript.setActiveTab(t.id);
        }}
        class={cn(
          'group relative flex h-full min-w-0 max-w-[220px] cursor-pointer items-center gap-2 border-r border-border px-3 text-xs transition-colors',
          active
            ? 'bg-background text-foreground'
            : 'bg-sidebar text-muted-foreground hover:bg-muted/50 hover:text-foreground/90'
        )}
      >
        {#if active}
          <div class="absolute inset-x-0 top-0 h-px bg-accent" aria-hidden="true"></div>
        {/if}
        <Icon class="size-3.5 shrink-0" />
        <span class="truncate">{t.title}</span>
        {#if t.dirty}
          <span class="size-1.5 shrink-0 rounded-full bg-accent"></span>
        {/if}
        <button
          type="button"
          onclick={(e) => close(e, t)}
          class="ml-1 flex size-4 shrink-0 items-center justify-center rounded opacity-0 transition-opacity hover:bg-muted-foreground/20 group-hover:opacity-100"
          aria-label="Close tab"
        >
          <X class="size-3" />
        </button>
      </div>
    {/each}
    <div class="flex-1 border-b border-border"></div>
  </div>
{/if}
