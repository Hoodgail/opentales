<script lang="ts">
  import { manuscript } from '$lib/stores/manuscript.svelte';
  import { storyIde } from '$lib/stores/storyIde.svelte';
  import { storyUi } from '$lib/stores/storyUi.svelte';
  import { lineFromOffset, type RenameSymbolOccurrence } from '$lib/rename-symbol-ui';
  import RenameSymbolDialog from './RenameSymbolDialog.svelte';

  $effect(() => {
    if (storyUi.renameSymbolRequest && manuscript.projectId) void storyIde.loadRuns(manuscript.projectId);
  });

  async function refreshAfterRename() {
    const projectId = manuscript.projectId;
    if (!projectId) return;
    await manuscript.refreshProject(projectId);
    await storyIde.refreshSelected(true);
  }

  async function navigateToOccurrence(occurrence: RenameSymbolOccurrence) {
    const buildUnit = storyIde.units.find((unit) =>
      unit.id === occurrence.unitId || unit.id === occurrence.entityId ||
      (unit.writingId === occurrence.writingId && unit.branchId === occurrence.branchId)
    );
    storyUi.clearRenameSymbolRequest();
    if (buildUnit) {
      storyUi.requestBuildSurface('manuscript', {
        unitId: buildUnit.id,
        start: occurrence.start,
        end: occurrence.end
      });
      await manuscript.setActiveView('build');
      await manuscript.openTab({
        id: `tab-build-${buildUnit.buildRunId}`,
        type: 'build',
        refId: buildUnit.buildRunId,
        title: 'Novel Build'
      });
      return;
    }

    const directChapter = manuscript.chapters.find((chapter) =>
      chapter.id === occurrence.entityId || chapter.writingId === occurrence.writingId
    );
    const sceneChapter = directChapter ?? manuscript.chapters.find((chapter) =>
      chapter.scenes.some((scene) => scene.id === occurrence.entityId || scene.writingId === occurrence.writingId)
    );
    if (sceneChapter) {
      const line = directChapter && occurrence.field === 'body'
        ? lineFromOffset(directChapter.content, occurrence.start)
        : 1;
      await manuscript.navigateToChapter(sceneChapter.id, { line });
      return;
    }

    if (occurrence.artifactId) {
      storyUi.selectBible({ section: 'artifacts', id: occurrence.artifactId });
      await manuscript.setActiveView('bible');
      await manuscript.openTab({
        id: 'tab-story-bible',
        type: 'story-bible',
        refId: occurrence.buildRunId ?? storyIde.selectedRunId ?? 'story-bible',
        title: 'Story Bible'
      });
      return;
    }
    if (occurrence.entityType === 'project-doc') {
      await manuscript.openTab({
        id: `tab-doc-${occurrence.entityId}`,
        type: 'doc',
        refId: occurrence.entityId,
        title: occurrence.title
      });
      return;
    }
    if (occurrence.entityType === 'story-structure' || occurrence.entityType === 'obstacle') {
      await manuscript.openTab({
        id: 'tab-structure',
        type: 'structure',
        refId: 'structure',
        title: 'Story Structure'
      });
      return;
    }

    const character = manuscript.characters.find((item) => item.id === occurrence.entityId);
    if (character) {
      await manuscript.setSelectedId(character.id);
      await manuscript.openTab({ id: `tab-${character.id}`, type: 'character', refId: character.id, title: character.name });
      return;
    }
    const location = manuscript.locations.find((item) => item.id === occurrence.entityId);
    if (location) {
      await manuscript.setSelectedId(location.id);
      await manuscript.openTab({ id: `tab-${location.id}`, type: 'location', refId: location.id, title: location.name });
      return;
    }

    manuscript.setActiveView('search');
  }
</script>

{#if storyUi.renameSymbolRequest && manuscript.projectId}
  <RenameSymbolDialog
    target={storyUi.renameSymbolRequest}
    builds={storyIde.runs}
    activeBuildId={storyIde.selectedRunId}
    onPreview={(input) => storyIde.previewRenameSymbol(manuscript.projectId!, input)}
    onApply={(input) => storyIde.applyRenameSymbol(manuscript.projectId!, input)}
    onApplied={refreshAfterRename}
    onNavigate={navigateToOccurrence}
    onClose={() => storyUi.clearRenameSymbolRequest()}
  />
{/if}
