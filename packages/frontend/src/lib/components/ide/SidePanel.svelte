<script lang="ts">
  import { manuscript } from '$lib/stores/manuscript.svelte';
  import AiAgentPanel from './AiAgentPanel.svelte';
  import CharactersPanel from './CharactersPanel.svelte';
  import DocsPanel from './DocsPanel.svelte';
  import ExplorerPanel from './ExplorerPanel.svelte';
  import InboxPanel from './InboxPanel.svelte';
  import LocationsPanel from './LocationsPanel.svelte';
  import MembersPanel from './MembersPanel.svelte';
  import NovelBuildSidePanel from './NovelBuildSidePanel.svelte';
  import OutlinePanel from './OutlinePanel.svelte';
  import PlotPanel from './PlotPanel.svelte';
  import ProblemsPanel from './ProblemsPanel.svelte';
  import SearchPanel from './SearchPanel.svelte';
  import SettingsPanel from './SettingsPanel.svelte';
  import StatsPanel from './StatsPanel.svelte';
  import StoryBibleSidePanel from './StoryBibleSidePanel.svelte';
  import PublishingSidePanel from './PublishingSidePanel.svelte';
  import RevisionSnapshotsSidePanel from './RevisionSnapshotsSidePanel.svelte';
  import TrashPanel from './TrashPanel.svelte';
</script>

<aside
  class="flex h-full w-full shrink-0 flex-col bg-sidebar"
>
  {#if manuscript.activeView === 'explorer'}
    <ExplorerPanel />
  {:else if manuscript.activeView === 'build'}
    <NovelBuildSidePanel />
  {:else if manuscript.activeView === 'bible'}
    <StoryBibleSidePanel />
  {:else if manuscript.activeView === 'publishing'}
    <PublishingSidePanel />
  {:else if manuscript.activeView === 'revisions'}
    <RevisionSnapshotsSidePanel />
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
  {:else if manuscript.activeView === 'docs'}
    <DocsPanel />
  {:else if manuscript.activeView === 'ai'}
    <AiAgentPanel />
  {:else if manuscript.activeView === 'settings'}
    <SettingsPanel />
  {/if}
</aside>
