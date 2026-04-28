<script lang="ts">
  import {
    AlertTriangle,
    BarChart3,
    BookOpen,
    Bot,
    Compass,
    FileText,
    Inbox,
    MapPin,
    Search,
    Settings,
    StickyNote,
    Trash2,
    UserCog,
    Users
  } from 'lucide-svelte';
  import { manuscript } from '$lib/stores/manuscript.svelte';
  import type { ActivityView } from '$lib/data/manuscript-types';
  import { cn } from '$lib/utils';

  // lucide-svelte ships legacy SvelteComponentTyped types; accept anything here.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  type Item = { id: ActivityView; label: string; icon: any };

  const items: Item[] = [
    { id: 'explorer', label: 'Manuscript', icon: FileText },
    { id: 'characters', label: 'Characters', icon: Users },
    { id: 'locations', label: 'Settings', icon: MapPin },
    { id: 'plot', label: 'Plot', icon: Compass },
    { id: 'outline', label: 'Outline', icon: BookOpen },
    { id: 'search', label: 'Search', icon: Search },
    { id: 'problems', label: 'Problems', icon: AlertTriangle },
    { id: 'inbox', label: 'Drafts inbox', icon: Inbox },
    { id: 'stats', label: 'Writing stats', icon: BarChart3 },
    { id: 'trash', label: 'Trash', icon: Trash2 },
    { id: 'docs', label: 'Docs & Notes', icon: StickyNote },
    { id: 'ai', label: 'AI Agent', icon: Bot },
    { id: 'members', label: 'Members', icon: UserCog }
  ];
</script>

<aside
  class="flex w-12 shrink-0 flex-col items-center justify-between border-r border-border bg-sidebar py-2"
>
  <nav class="flex flex-col items-center gap-0.5">
    {#each items as item (item.id)}
      {@const active = manuscript.activeView === item.id}
      <button
        type="button"
        onclick={() => void manuscript.setActiveView(item.id)}
        title={item.label}
        class={cn(
          'group relative flex size-10 items-center justify-center rounded-md transition-colors',
          active ? 'text-foreground' : 'text-muted-foreground hover:text-foreground'
        )}
      >
        <span
          class={cn(
            'absolute left-0 h-6 w-0.5 rounded-r-full bg-accent transition-opacity',
            active ? 'opacity-100' : 'opacity-0'
          )}
          aria-hidden="true"
        ></span>
        <item.icon class="size-5" strokeWidth={1.75} />
        <span class="sr-only">{item.label}</span>
      </button>
    {/each}
  </nav>
  <div class="flex flex-col items-center gap-0.5">
    <button
      type="button"
      onclick={() => void manuscript.setActiveView('settings')}
      title="Settings"
      class={cn(
        'flex size-10 items-center justify-center rounded-md transition-colors',
        manuscript.activeView === 'settings'
          ? 'text-foreground'
          : 'text-muted-foreground hover:text-foreground'
      )}
    >
      <Settings class="size-5" strokeWidth={1.75} />
    </button>
  </div>
</aside>
