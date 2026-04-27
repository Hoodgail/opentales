<script lang="ts">
  import { manuscript } from '$lib/stores/manuscript.svelte';
  import CharactersPanel from './CharactersPanel.svelte';
  import ExplorerPanel from './ExplorerPanel.svelte';
  import InboxPanel from './InboxPanel.svelte';
  import LocationsPanel from './LocationsPanel.svelte';
  import MembersPanel from './MembersPanel.svelte';
  import OutlinePanel from './OutlinePanel.svelte';
  import PlotPanel from './PlotPanel.svelte';
  import ProblemsPanel from './ProblemsPanel.svelte';
  import SearchPanel from './SearchPanel.svelte';
  import SettingsPanel from './SettingsPanel.svelte';
  import StatsPanel from './StatsPanel.svelte';
  import TrashPanel from './TrashPanel.svelte';
</script>

<aside
  class="flex h-full w-full shrink-0 flex-col border-r border-border bg-sidebar md:w-72"
>
  {#if manuscript.activeView === 'explorer'}
    <ExplorerPanel />
  {:else if manuscript.activeView === 'characters'}
    <CharactersPanel />
  {:else if manuscript.activeView === 'locations'}
    <LocationsPanel />
  {:else if manuscript.activeView === 'plot'}
    <PlotPanel />
  {:else if manuscript.activeView === 'outline'}
    <OutlinePanel />
  {:else if manuscript.activeView === 'search'}
    <SearchPanel />
  {:else if manuscript.activeView === 'inbox'}
    <InboxPanel />
  {:else if manuscript.activeView === 'problems'}
    <ProblemsPanel />
  {:else if manuscript.activeView === 'members'}
    <MembersPanel />
  {:else if manuscript.activeView === 'stats'}
    <StatsPanel />
  {:else if manuscript.activeView === 'trash'}
    <TrashPanel />
  {:else if manuscript.activeView === 'settings'}
    <SettingsPanel />
  {/if}
</aside>
