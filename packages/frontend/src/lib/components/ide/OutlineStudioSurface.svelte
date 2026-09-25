<script lang="ts">
  import { manuscript } from "$lib/stores/manuscript.svelte";
  import { storyUi } from "$lib/stores/storyUi.svelte";
  import OutlineStudio from "./OutlineStudio.svelte";
</script>

<div class="flex min-h-0 flex-1 flex-col">
  {#if manuscript.error}
    <div
      class="shrink-0 border-b border-destructive/30 bg-destructive/8 px-3 py-2 text-[11px] text-destructive-foreground"
      role="alert"
    >
      {manuscript.error}
    </div>
  {/if}
  <OutlineStudio
    artifacts={[]}
    storyState={null}
    units={[]}
    projection={storyUi.outlineProjection}
    saving={manuscript.saving}
    onProjection={(projection) => storyUi.setOutlineProjection(projection)}
    onSaveSceneEntity={async (scene, input) => {
      await manuscript.updateScene(scene.id, scene.chapterId, input);
    }}
    onReorderScenes={async (chapterId, sceneIds) => {
      await manuscript.reorderScenes(chapterId, sceneIds);
    }}
  />
</div>
