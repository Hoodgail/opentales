<script lang="ts">
  import {
    BookOpen,
    Compass,
    FileText,
    Inbox,
    MapPin,
    Search,
    Settings,
    UserCog,
    Users
  } from 'lucide-svelte';
  import { manuscript } from '$lib/stores/manuscript.svelte';
  import { ui } from '$lib/stores/ui.svelte';
  import type { ActivityView } from '$lib/data/manuscript-types';
  import { cn } from '$lib/utils';

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  type Item = { id: ActivityView; label: string; icon: any };

  const items: Item[] = [
    { id: 'explorer', label: 'Manuscript', icon: FileText },
    { id: 'characters', label: 'Characters', icon: Users },
    { id: 'locations', label: 'Settings', icon: MapPin },
    { id: 'plot', label: 'Plot', icon: Compass },
    { id: 'outline', label: 'Outline', icon: BookOpen },
    { id: 'search', label: 'Search', icon: Search },
    { id: 'inbox', label: 'Drafts', icon: Inbox },
    { id: 'members', label: 'Members', icon: UserCog },
    { id: 'settings', label: 'Settings', icon: Settings }
  ];

  function activate(id: ActivityView) {
    void manuscript.setActiveView(id);
    ui.open('side');
  }
</script>

<nav
  class="flex h-14 shrink-0 items-stretch gap-0.5 overflow-x-auto border-t border-border bg-sidebar px-1 [scrollbar-width:none] [-webkit-overflow-scrolling:touch]"
  aria-label="Sections"
>
  {#each items as item (item.id)}
    {@const active = manuscript.activeView === item.id && ui.drawer === 'side'}
    <button
      type="button"
      onclick={() => activate(item.id)}
      class={cn(
        'flex min-w-[64px] flex-col items-center justify-center gap-0.5 rounded-md px-2 text-[10px] font-medium transition-colors',
        active
          ? 'text-foreground bg-muted/50'
          : 'text-muted-foreground hover:text-foreground'
      )}
    >
      <item.icon class="size-5" strokeWidth={1.75} />
      <span class="leading-none">{item.label}</span>
    </button>
  {/each}
</nav>

<style>
  nav::-webkit-scrollbar {
    display: none;
  }
</style>
