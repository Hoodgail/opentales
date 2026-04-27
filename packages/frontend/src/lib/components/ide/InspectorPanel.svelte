<script lang="ts">
  import { Activity, Calendar, FileText, Hash, MapPin, Target, Users } from 'lucide-svelte';
  import { manuscript } from '$lib/stores/manuscript.svelte';
  import InspectorChapter from './InspectorChapter.svelte';
  import InspectorCharacter from './InspectorCharacter.svelte';
  import InspectorLocation from './InspectorLocation.svelte';
  import InspectorProject from './InspectorProject.svelte';

  const activeTab = $derived(
    manuscript.tabs.find((t) => t.id === manuscript.activeTabId) ?? null
  );

  const activeChapter = $derived(
    activeTab?.type === 'chapter'
      ? manuscript.chapters.find((c) => c.id === activeTab.refId) ?? null
      : null
  );
  const activeCharacter = $derived(
    activeTab?.type === 'character'
      ? manuscript.characters.find((c) => c.id === activeTab.refId) ?? null
      : null
  );
  const activeLocation = $derived(
    activeTab?.type === 'location'
      ? manuscript.locations.find((l) => l.id === activeTab.refId) ?? null
      : null
  );
</script>

<aside
  class="flex h-full w-full shrink-0 flex-col border-l border-border bg-sidebar md:w-72"
>
  <div
    class="flex h-9 shrink-0 items-center justify-between border-b border-border px-3"
  >
    <h2
      class="text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground"
    >
      Inspector
    </h2>
    <span class="text-[10px] text-muted-foreground">
      {activeTab?.type ?? '—'}
    </span>
  </div>

  <div class="flex-1 overflow-y-auto">
    {#if !activeTab}
      <InspectorProject />
    {:else if activeTab.type === 'chapter' && activeChapter}
      <InspectorChapter chapter={activeChapter} />
    {:else if activeTab.type === 'character' && activeCharacter}
      <InspectorCharacter character={activeCharacter} />
    {:else if activeTab.type === 'location' && activeLocation}
      <InspectorLocation location={activeLocation} />
    {:else if activeTab.type === 'structure' || activeTab.type === 'outline'}
      <InspectorProject />
    {/if}
  </div>
</aside>
