<script lang="ts">
  import { manuscript } from '$lib/stores/manuscript.svelte';
  import { storyIde } from '$lib/stores/storyIde.svelte';
  import { storyUi } from '$lib/stores/storyUi.svelte';
  import OutlineStudio from './OutlineStudio.svelte';
</script>

<div class="flex min-h-0 flex-1 flex-col">
  {#if manuscript.error || storyIde.error}
    <div class="shrink-0 border-b border-destructive/30 bg-destructive/8 px-3 py-2 text-[11px] text-destructive-foreground" role="alert">{manuscript.error ?? storyIde.error}</div>
  {/if}
  <OutlineStudio
    artifacts={storyIde.activeArtifacts}
    storyState={storyIde.snapshot}
    units={storyIde.units}
    projection={storyUi.outlineProjection}
    saving={storyIde.mutating || manuscript.saving}
    onProjection={(projection) => storyUi.setOutlineProjection(projection)}
    onSaveScene={async (artifact, content, status) => { await storyIde.replaceArtifact(artifact, content, status); }}
    onSaveSceneEntity={async (scene, input) => { await manuscript.updateScene(scene.id, scene.chapterId, input); }}
    onReorderScenes={async (chapterId, sceneIds) => { await manuscript.reorderScenes(chapterId, sceneIds); }}
    onOpenBuildUnit={async (unit) => {
      storyUi.requestBuildSurface('manuscript', { unitId: unit.id });
      await manuscript.setActiveView('build');
      await manuscript.openTab({ id: `tab-build-${unit.buildRunId}`, type: 'build', refId: unit.buildRunId, title: 'Novel Build' });
    }}
    onReorderBuildUnits={async (parentUnitId, unitIds) => { await storyIde.reorderUnits(parentUnitId, unitIds); }}
  />
</div>
