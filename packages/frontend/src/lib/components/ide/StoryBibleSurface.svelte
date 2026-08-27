<script lang="ts">
  import { BookMarked } from 'lucide-svelte';
  import { manuscript } from '$lib/stores/manuscript.svelte';
  import { storyIde } from '$lib/stores/storyIde.svelte';
  import { storyUi, type BibleSelection } from '$lib/stores/storyUi.svelte';
  import StoryBibleEditor from './StoryBibleEditor.svelte';

  function select(next: BibleSelection | null) {
    storyUi.selectBible(next);
  }
</script>

{#if storyIde.selectedRun}
  <StoryBibleEditor
    artifacts={storyIde.artifacts}
    snapshot={storyIde.snapshot}
    selection={storyUi.bibleSelection}
    saving={storyIde.mutating}
    onSelect={select}
    onSaveArtifact={(artifact, content) => storyIde.replaceArtifact(artifact, content)}
    onSaveFact={(fact, update) => storyIde.updateFact(fact, update)}
    onSaveEntityState={(entity, update) => storyIde.updateEntityState(entity, update)}
    onSaveLoop={(loop, update) => storyIde.updateLoop(loop, update)}
    histories={storyIde.histories}
    onLoadHistory={(kind, key) => storyIde.loadStateHistory(kind, key)}
    onRestore={(kind, key, version) => storyIde.restoreState(kind, key, version)}
    onSaveTimeline={(event, update) => storyIde.updateTimeline(event, update)}
    onSaveSetup={(link, update) => storyIde.updateSetupPayoff(link, update)}
    onSaveThread={(thread, update) => storyIde.updatePlotThread(thread, update)}
  />
{:else}
  <div class="flex min-h-0 flex-1 flex-col items-center justify-center bg-background px-6 text-center">
    <BookMarked class="size-8 text-muted-foreground/40" />
    <h1 class="mt-3 text-sm font-medium text-foreground">Choose a Novel Build first.</h1>
    <p class="mt-1 max-w-md text-xs leading-relaxed text-muted-foreground">The Story Bible is versioned per build so canon, entity state, and open loops never silently cross branches.</p>
    <button type="button" onclick={() => void manuscript.setActiveView('build')} class="mt-4 rounded border border-border px-3 py-1.5 text-[11px] text-foreground outline-none hover:border-accent/50 focus-visible:ring-2 focus-visible:ring-accent">Open Novel Builds</button>
  </div>
{/if}
