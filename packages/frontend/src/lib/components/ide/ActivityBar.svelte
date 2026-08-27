<script lang="ts">
  import {
    AlertTriangle,
    Archive,
    BarChart3,
    BookMarked,
    BookOpen,
    Bot,
    Compass,
    FileText,
    Inbox,
    MapPin,
    PanelLeftClose,
    PanelLeftOpen,
    Search,
    Settings,
    StickyNote,
    History,
    Trash2,
    UserCog,
    Users,
    Workflow
  } from 'lucide-svelte';
  import { manuscript } from '$lib/stores/manuscript.svelte';
  import { ui } from '$lib/stores/ui.svelte';
  import type { ActivityView } from '$lib/data/manuscript-types';
  import { cn } from '$lib/utils';

  // lucide-svelte ships legacy SvelteComponentTyped types; accept anything here.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  type Item = { id: ActivityView; label: string; icon: any };

  const items: Item[] = [
    { id: 'explorer', label: 'Manuscript', icon: FileText },
    { id: 'build', label: 'Novel Builds', icon: Workflow },
    { id: 'bible', label: 'Story Bible', icon: BookMarked },
    { id: 'publishing', label: 'Export & Import', icon: Archive },
    { id: 'revisions', label: 'Revisions', icon: History },
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

  function selectActivity(id: ActivityView) {
    if (manuscript.activeView === id) {
      ui.toggleSidePanel();
      return;
    }
    ui.expandSidePanel();
    void manuscript.setActiveView(id);
  }
</script>

<aside
  class="flex w-12 shrink-0 flex-col items-center overflow-hidden border-r border-border bg-sidebar py-2"
>
  <nav class="min-h-0 flex-1 overflow-y-auto overflow-x-hidden [scrollbar-width:none] flex flex-col items-center gap-0.5" aria-label="Workspace sections">
    {#each items as item (item.id)}
      {@const active = manuscript.activeView === item.id}
      <button
        type="button"
        onclick={() => selectActivity(item.id)}
        title={active && !ui.sidePanelCollapsed ? `Collapse ${item.label}` : item.label}
        class={cn(
          'group relative flex size-10 shrink-0 items-center justify-center rounded-md transition-colors',
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
  <div class="mt-1 flex shrink-0 flex-col items-center gap-0.5 border-t border-border/60 pt-1">
    <button
      type="button"
      onclick={() => ui.toggleSidePanel()}
      title={ui.sidePanelCollapsed ? 'Expand side panel' : 'Collapse side panel'}
      aria-label={ui.sidePanelCollapsed ? 'Expand side panel' : 'Collapse side panel'}
      aria-pressed={ui.sidePanelCollapsed}
      class="flex size-10 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
    >
      {#if ui.sidePanelCollapsed}
        <PanelLeftOpen class="size-5" strokeWidth={1.75} />
      {:else}
        <PanelLeftClose class="size-5" strokeWidth={1.75} />
      {/if}
    </button>
    <button
      type="button"
      onclick={() => selectActivity('settings')}
      title="Settings"
      aria-label="Settings"
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
