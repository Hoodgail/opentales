<script lang="ts">
  import { onDestroy } from 'svelte';
  import type { StoryArtifact } from '@opentales/sdk';
  import { ai } from '$lib/stores/ai.svelte';
  import { manuscript } from '$lib/stores/manuscript.svelte';
  import { storyIde } from '$lib/stores/storyIde.svelte';
  import { storyUi } from '$lib/stores/storyUi.svelte';
  import NovelBuildWorkspace from './NovelBuildWorkspace.svelte';

  let loadedDocsFor = $state<string | null>(null);
  let pollTimer: ReturnType<typeof setTimeout> | null = null;
  const brainstorms = $derived(ai.fileTree.docs.filter((doc) => doc.kind === 'brainstorm'));

  $effect(() => {
    const projectId = manuscript.projectId;
    if (projectId && loadedDocsFor !== projectId) {
      loadedDocsFor = projectId;
      void ai.loadFileTree(projectId);
    }
  });

  $effect(() => {
    const run = storyIde.selectedRun;
    if (pollTimer) {
      clearTimeout(pollTimer);
      pollTimer = null;
    }
    if (!run || ['completed', 'cancelled'].includes(run.status)) return;
    const runId = run.id;
    const schedule = () => {
      const delay = ['paused', 'failed'].includes(storyIde.selectedRun?.status ?? '')
        ? Math.max(10_000, storyIde.nextPollDelayMs)
        : storyIde.nextPollDelayMs;
      pollTimer = setTimeout(async () => {
        if (storyIde.selectedRunId !== runId) return;
        try {
          if (typeof document === 'undefined' || document.visibilityState === 'visible') {
            await storyIde.refreshSelected(true);
          }
        } finally {
          const current = storyIde.selectedRun;
          if (storyIde.selectedRunId === runId && current && !['completed', 'cancelled'].includes(current.status)) {
            schedule();
          }
        }
      }, delay);
    };
    schedule();
  });

  onDestroy(() => {
    if (pollTimer) clearTimeout(pollTimer);
  });

  function openArtifact(artifact: StoryArtifact) {
    storyUi.selectBible({ section: 'artifacts', id: artifact.id });
    void manuscript.setActiveView('bible');
    void manuscript.openTab({
      id: 'tab-story-bible',
      type: 'story-bible',
      refId: storyIde.selectedRunId ?? 'story-bible',
      title: 'Story Bible'
    });
  }
</script>

<NovelBuildWorkspace
  run={storyIde.selectedRun}
  {brainstorms}
  artifacts={storyIde.activeArtifacts}
  traces={storyIde.traces}
  evaluations={storyIde.evaluations}
  checkpoints={storyIde.observability?.checkpoints ?? []}
  directives={storyIde.observability?.directives ?? []}
  units={storyIde.units}
  compilation={storyIde.compilation}
  comparison={storyIde.comparison}
  reviews={storyIde.reviews}
  loading={storyIde.loadingDetails || storyIde.mutating}
  mutating={storyIde.mutating}
  error={storyIde.error ?? storyIde.detailWarning}
  connection={storyIde.connection}
  lastUpdatedAt={storyIde.lastUpdatedAt}
  onStart={async (input) => manuscript.projectId ? storyIde.createRun(manuscript.projectId, input) : null}
  onNew={() => storyIde.beginNew()}
  onRefresh={() => void storyIde.refreshSelected()}
  onAuthorize={(run) => void storyIde.authorizeRun(run)}
  onPause={() => void storyIde.pauseRun()}
  onResume={() => void storyIde.resumeRun()}
  onCancel={() => void storyIde.cancelRun()}
  onRetry={(task) => void storyIde.retryTask(task)}
  onRerun={(task, reason) => void storyIde.rerunTask(task, reason)}
  onReplan={(task, directive, checkpointId, pinnedArtifactIds) => storyIde.replanTask(task, directive, checkpointId, pinnedArtifactIds)}
  onPatchUnit={(unit, input) => storyIde.patchUnit(unit, input)}
  onCompile={(checkpointId) => storyIde.compileManuscript(checkpointId)}
  onCompare={() => storyIde.refreshComparison()}
  onCreateReview={(input) => storyIde.createReview(input)}
  onApproveReview={(review) => storyIde.approveReview(review)}
  onMergeReview={(review) => storyIde.mergeReview(review)}
  onRejectReview={(review, reason) => storyIde.rejectReview(review, reason)}
  onCheckpoint={() => void storyIde.checkpoint()}
  onArtifact={openArtifact}
/>
