import { cleanup, render } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { OpenTalesClient, type BuildRun } from '@opentales/sdk';
import { storyIde } from '$lib/stores/storyIde.svelte';
import NovelBuildSurface from './NovelBuildSurface.svelte';

function runningRun(): BuildRun {
  return {
    id: 'poll-run', projectId: 'project-1', objective: 'Poll durably', brainstorm: 'A story.',
    manifest: { version: '1', sourceBrainstormHash: 'hash', target: {}, artifactSpecs: [], phases: [] },
    autonomyMode: 'autonomous-draft', status: 'drafting', currentPhase: 'drafting', workflowVersion: '1', branchName: 'ai/poll-run',
    authorizationScope: { artifactTypes: [], chapterIds: [], sceneIds: [], allowPlanningArtifacts: true, allowCanonWrites: true, allowChapterWrites: true, allowSceneWrites: true, allowDiagnostics: true, expiresAt: null },
    maxTokens: null, tokensUsed: 0, tokensReserved: 0, maxCostMicros: null, costMicrosUsed: 0, costMicrosReserved: 0,
    revision: 1, executionGeneration: 0, lastError: null, authorizedAt: '2026-01-01T00:00:00.000Z', pausedAt: null,
    completedAt: null, failedAt: null, cancelledAt: null, createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
    progress: { percent: 10, total: 1, blocked: 0, ready: 0, running: 1, review: 0, done: 0, failed: 0, cancelled: 0 },
    tasks: [], latestCheckpoint: null, activeDirective: null
  };
}

afterEach(() => {
  cleanup();
  storyIde.reset();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('NovelBuildSurface polling', () => {
  it('reschedules through fail → fail → success and clears reconnecting state', async () => {
    const run = runningRun();
    const getRun = vi.spyOn(OpenTalesClient.prototype, 'getBuildRun')
      .mockResolvedValueOnce(run)
      .mockRejectedValueOnce(new Error('offline one'))
      .mockRejectedValueOnce(new Error('offline two'))
      .mockResolvedValue(run);
    vi.spyOn(OpenTalesClient.prototype, 'listStoryArtifacts').mockResolvedValue({ items: [], total: 0, limit: 500, offset: 0, nextOffset: null });
    vi.spyOn(OpenTalesClient.prototype, 'getStoryStateDelta').mockResolvedValue({ projectId: 'project-1', buildRunId: run.id, canonFacts: [], entityStates: [], timelineEvents: [], openLoops: [], setupPayoffs: [], plotThreads: [], generatedAt: '2026-01-01T00:00:00.000Z', sinceUpdatedAt: null, nextOffset: null });
    vi.spyOn(OpenTalesClient.prototype, 'getBuildObservability').mockResolvedValue({ projectId: 'project-1', buildRunId: run.id, traces: [], evaluations: [], checkpoints: [], directives: [] });
    vi.spyOn(OpenTalesClient.prototype, 'getStoryDiagnostics').mockResolvedValue({ projectId: 'project-1', buildRunId: run.id, generatedAt: '2026-01-01T00:00:00.000Z', diagnostics: [] });
    vi.spyOn(OpenTalesClient.prototype, 'listBuildManuscriptUnits').mockResolvedValue([]);
    vi.spyOn(OpenTalesClient.prototype, 'listBuildReviews').mockResolvedValue([]);
    vi.spyOn(OpenTalesClient.prototype, 'compareBuildManuscript').mockResolvedValue({ projectId: 'project-1', buildRunId: run.id, compilationId: null, prose: [], semantic: { addedCanonFactIds: [], changedEntityStateIds: [], timelineEventIds: [], unresolvedOpenLoopIds: [], activePlotThreadIds: [] } });
    await storyIde.selectRun('project-1', run.id);

    vi.useFakeTimers();
    render(NovelBuildSurface);
    await vi.advanceTimersByTimeAsync(4_000);
    expect(storyIde.connection).toBe('reconnecting');
    expect(storyIde.error).toContain('offline one');
    await vi.advanceTimersByTimeAsync(8_000);
    expect(storyIde.connection).toBe('reconnecting');
    expect(storyIde.error).toContain('offline two');
    await vi.advanceTimersByTimeAsync(16_000);

    expect(getRun).toHaveBeenCalledTimes(4);
    expect(storyIde.connection).toBe('connected');
    expect(storyIde.error).toBeNull();
  });
});
