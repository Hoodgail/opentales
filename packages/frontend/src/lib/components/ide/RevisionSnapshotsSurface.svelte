<script lang="ts">
  import { manuscript } from '$lib/stores/manuscript.svelte';
  import { revisions } from '$lib/stores/revisions.svelte';
  import { currentHeadsFromComparison } from '$lib/revision-ui';
  import RevisionSnapshotsWorkspace from './RevisionSnapshotsWorkspace.svelte';

  let loadedProjectId = $state<string | null>(null);
  $effect(() => {
    const projectId = manuscript.projectId;
    if (projectId && loadedProjectId !== projectId) {
      loadedProjectId = projectId;
      void revisions.loadSnapshots(projectId);
    }
  });

  async function restore() {
    const snapshot = revisions.selectedSnapshot;
    if (!snapshot) return;
    const comparison = await revisions.compareSnapshots(snapshot.projectId, snapshot.id, null);
    if (!comparison) return null;
    const expectedEntityRevisions = Object.fromEntries(manuscript.chapters.flatMap((chapter) => chapter.scenes.map((scene) => [scene.id, scene.revision])));
    const result = await revisions.restoreSnapshot(snapshot, currentHeadsFromComparison(comparison), expectedEntityRevisions);
    if (result) await manuscript.refreshProject(snapshot.projectId);
    return result;
  }
</script>

<RevisionSnapshotsWorkspace
  snapshots={revisions.snapshots}
  selected={revisions.selectedSnapshot}
  comparison={revisions.comparison}
  chapters={manuscript.chapters}
  loading={revisions.loadingSnapshots}
  busy={revisions.mutating}
  error={revisions.error}
  onSelect={(snapshot) => manuscript.projectId ? revisions.selectSnapshot(manuscript.projectId, snapshot.id) : undefined}
  onCreate={(input) => manuscript.projectId ? revisions.createSnapshot(manuscript.projectId, input) : undefined}
  onCompare={(left, right) => manuscript.projectId ? revisions.compareSnapshots(manuscript.projectId, left, right) : undefined}
  onRestore={() => restore()}
  onBranch={(snapshot, name) => revisions.branchSnapshot(snapshot, name)}
  onDelete={(snapshot) => revisions.deleteSnapshot(snapshot)}
/>
