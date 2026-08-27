<script lang="ts">
  import type { BuildRun } from '@opentales/sdk';
  import { manuscript } from '$lib/stores/manuscript.svelte';
  import { storyIde } from '$lib/stores/storyIde.svelte';
  import NovelBuildPanel from './NovelBuildPanel.svelte';

  let loadedProjectId = $state<string | null>(null);
  $effect(() => {
    const projectId = manuscript.projectId;
    if (projectId && loadedProjectId !== projectId) {
      loadedProjectId = projectId;
      void storyIde.loadRuns(projectId);
    }
  });

  function newBuild() {
    storyIde.beginNew();
    void manuscript.openTab({ id: 'tab-new-build', type: 'build', refId: 'new', title: 'New Novel Build' });
  }

  async function open(run: BuildRun) {
    if (!manuscript.projectId) return;
    await storyIde.selectRun(manuscript.projectId, run.id);
    void manuscript.openTab({ id: `tab-build-${run.id}`, type: 'build', refId: run.id, title: 'Novel Build' });
  }
</script>

<NovelBuildPanel
  runs={storyIde.runs}
  selectedId={storyIde.selectedRunId}
  loading={storyIde.loadingRuns}
  error={storyIde.error}
  onNew={newBuild}
  onOpen={(run) => void open(run)}
  onRefresh={() => manuscript.projectId ? void storyIde.loadRuns(manuscript.projectId, true) : undefined}
/>
