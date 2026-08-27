<script lang="ts">
  import { manuscript } from '$lib/stores/manuscript.svelte';
  import { storyIde } from '$lib/stores/storyIde.svelte';
  import { storyUi, type BibleSelection } from '$lib/stores/storyUi.svelte';
  import StoryBiblePanel from './StoryBiblePanel.svelte';

  let loadedProjectId = $state<string | null>(null);
  $effect(() => {
    const projectId = manuscript.projectId;
    if (projectId && loadedProjectId !== projectId) {
      loadedProjectId = projectId;
      void storyIde.loadRuns(projectId).then(() => {
        const first = storyIde.runs[0];
        if (!storyIde.selectedRunId && first) void storyIde.selectRun(projectId, first.id);
      });
    }
  });

  function open(selection?: BibleSelection) {
    if (selection) storyUi.selectBible(selection);
    void manuscript.openTab({
      id: 'tab-story-bible',
      type: 'story-bible',
      refId: storyIde.selectedRunId ?? 'story-bible',
      title: 'Story Bible'
    });
  }

  async function refresh() {
    if (storyIde.selectedRunId) await storyIde.refreshSelected();
    else if (manuscript.projectId) await storyIde.loadRuns(manuscript.projectId, true);
  }
</script>

<StoryBiblePanel
  artifacts={storyIde.activeArtifacts}
  snapshot={storyIde.snapshot}
  loading={storyIde.loadingRuns || storyIde.loadingDetails}
  error={storyIde.error ?? storyIde.detailWarning}
  selection={storyUi.bibleSelection}
  onOpen={open}
  onRefresh={() => void refresh()}
/>
