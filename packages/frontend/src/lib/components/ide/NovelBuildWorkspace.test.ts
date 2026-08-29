import { cleanup, fireEvent, render, screen } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { BuildRun, BuildTask } from '@opentales/sdk';
import NovelBuildWorkspace from './NovelBuildWorkspace.svelte';

afterEach(() => cleanup());

const exhaustedTask = {
  id: 'task-story-brief', buildRunId: 'build-1', key: 'story-brief', type: 'create-story-brief', phase: 'planning', status: 'failed',
  dependencyIds: [], inputArtifactIds: [], outputArtifactIds: [], scopeUnitIds: [], assignedAgent: 'creator', skillVersions: {},
  acceptanceCriteria: {}, executionPolicy: {}, attempts: 3, maxAttempts: 3, revisionIteration: 0, maxRevisionIterations: 1,
  qualityThreshold: 0.8, priority: 100, progress: 0, revision: 3, leaseOwner: null, leaseGeneration: 3, runGeneration: 1,
  reservedTokens: 0, reservedCostMicros: 0, leaseExpiresAt: null, heartbeatAt: null, startedAt: null, completedAt: null,
  failedAt: '2026-08-29T00:00:00.000Z', cancelledAt: null, invalidatedAt: null, lastError: 'Bad Request', createdAt: '2026-08-29T00:00:00.000Z',
  updatedAt: '2026-08-29T00:00:00.000Z', transitions: []
} satisfies BuildTask;

const failedRun = {
  id: 'build-1', projectId: 'project-1', objective: 'Build a novel', brainstorm: 'Idea',
  manifest: { version: '1', sourceBrainstormHash: 'hash', target: {}, artifactSpecs: [], phases: [] },
  autonomyMode: 'plan-review', status: 'failed', currentPhase: 'planning', workflowVersion: '1', branchName: 'ai/build-1',
  authorizationScope: { artifactTypes: [], chapterIds: [], sceneIds: [], allowPlanningArtifacts: true, allowCanonWrites: true, allowChapterWrites: true, allowSceneWrites: true, allowDiagnostics: true, expiresAt: null },
  maxTokens: 1_000_000, tokensUsed: 324_000, tokensReserved: 0, maxCostMicros: null, costMicrosUsed: 0, costMicrosReserved: 0,
  revision: 4, executionGeneration: 1, lastError: 'Build contains exhausted failed tasks', authorizedAt: '2026-08-29T00:00:00.000Z',
  pausedAt: null, completedAt: null, failedAt: '2026-08-29T00:00:00.000Z', cancelledAt: null,
  createdAt: '2026-08-29T00:00:00.000Z', updatedAt: '2026-08-29T00:00:00.000Z',
  progress: { percent: 0, total: 29, blocked: 28, ready: 0, running: 0, review: 0, done: 0, failed: 1, cancelled: 0 },
  tasks: [exhaustedTask], latestCheckpoint: null, activeDirective: null
} satisfies BuildRun;

function callbacks() {
  return {
    onStart: vi.fn(), onNew: vi.fn(), onRefresh: vi.fn(), onPause: vi.fn(), onAuthorize: vi.fn(), onResume: vi.fn(), onCancel: vi.fn(),
    onRetry: vi.fn(), onRerun: vi.fn(), onReplan: vi.fn(), onPatchUnit: vi.fn(async () => null), onCompile: vi.fn(async () => null),
    onCompare: vi.fn(async () => null), onCreateReview: vi.fn(async () => null), onApproveReview: vi.fn(async () => null),
    onMergeReview: vi.fn(async () => null), onRejectReview: vi.fn(async () => null)
  };
}

describe('NovelBuildWorkspace exhausted failure recovery', () => {
  it('routes the run-level action through explicit boundary-rerun confirmation', async () => {
    const actions = callbacks();
    render(NovelBuildWorkspace, { run: failedRun, brainstorms: [], ...actions });

    expect(screen.queryByRole('button', { name: 'Resume' })).toBeNull();
    await fireEvent.click(screen.getByRole('button', { name: 'Rerun story-brief' }));
    expect(screen.getByRole('alertdialog').textContent).toContain('Rerun “story-brief”?');
    await fireEvent.click(screen.getByRole('button', { name: 'Invalidate & continue' }));

    expect(actions.onResume).not.toHaveBeenCalled();
    expect(actions.onRerun).toHaveBeenCalledWith(exhaustedTask, 'Human requested a clean rerun of this task.');
  });
});
