import { cleanup, fireEvent, render, screen } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { BuildRun, BuildTask } from '@opentales/sdk';
import NovelBuildWorkspace from './NovelBuildWorkspace.svelte';
import { buildExecutionStatus } from './buildExecutionStatus';

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

const checkpointTask = {
  ...exhaustedTask,
  id: 'task-planning-checkpoint', key: 'planning-checkpoint', type: 'checkpoint', phase: 'planning-review', status: 'done',
  attempts: 1, maxAttempts: 3, progress: 100, lastError: null, failedAt: null, completedAt: '2026-08-30T00:55:42.900Z'
} satisfies BuildTask;

const checkpointRun = {
  ...failedRun,
  status: 'paused', currentPhase: 'checkpoint-review:planning-checkpoint', revision: 17, lastError: null,
  authorizationScope: {
    ...failedRun.authorizationScope,
    allowChapterWrites: false,
    allowSceneWrites: false,
    allowCanonWrites: true,
    allowDiagnostics: true
  },
  pausedAt: '2026-08-30T00:55:43.197Z', failedAt: null,
  progress: { percent: 59, total: 29, blocked: 12, ready: 0, running: 0, review: 0, done: 17, failed: 0, cancelled: 0 },
  tasks: [checkpointTask]
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
  it('shows the provider retry deadline and retains the reason instead of implying active work', () => {
    const task = { ...exhaustedTask, status: 'ready' as const, attempts: 1, retryAfterAt: '2099-01-01T00:00:00.000Z', lastError: 'Provider quota exhausted' };
    render(NovelBuildWorkspace, { run: { ...failedRun, status: 'drafting', tasks: [task], lastError: null }, brainstorms: [], ...callbacks() });
    const status = screen.getByRole('status', { name: 'Build execution status' });
    expect(status.textContent).toContain('Waiting for provider retry window');
    expect(status.textContent).toContain('Provider quota exhausted');
    expect(status.querySelector('time')?.getAttribute('datetime')).toBe(task.retryAfterAt);
  });

  it('only describes the whole build as waiting when all ready tasks are cooling down', () => {
    const now = Date.parse('2026-09-22T00:00:00Z');
    const task = { ...exhaustedTask, status: 'ready' as const, retryAfterAt: '2026-09-22T01:00:00Z' };
    const run = { ...failedRun, status: 'drafting' as const, tasks: [task] };
    expect(buildExecutionStatus(run, now)?.kind).toBe('provider-wait');
    expect(buildExecutionStatus(run, Date.parse(task.retryAfterAt))).toEqual({ kind: 'queued' });
    expect(buildExecutionStatus({ ...run, tasks: [task, { ...task, id: 'due', retryAfterAt: null }] }, now)).toEqual({ kind: 'queued' });
    expect(buildExecutionStatus({ ...run, tasks: [{ ...task, retryAfterAt: 'invalid' }] }, now)).toEqual({ kind: 'queued' });
    expect(buildExecutionStatus({ ...run, tasks: [task, { ...task, id: 'running', status: 'running' }] }, now)).toBeNull();
    expect(buildExecutionStatus({ ...run, status: 'paused' }, now)).toBeNull();
    expect(buildExecutionStatus({ ...run, authorizedAt: null }, now)).toBeNull();
    expect(buildExecutionStatus({ ...run, tasks: [] }, now)).toBeNull();
    expect(buildExecutionStatus(null, now)).toBeNull();
  });

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

  it('requires explicit checkpoint authorization instead of offering plain resume', async () => {
    const actions = callbacks();
    render(NovelBuildWorkspace, { run: checkpointRun, brainstorms: [], ...actions });

    expect(screen.queryByRole('button', { name: 'Resume' })).toBeNull();
    await fireEvent.click(screen.getAllByRole('button', { name: 'Review & authorize' })[0]!);
    expect(screen.getByRole('dialog', { name: 'Authorize build checkpoint' })).toBeTruthy();
    const authorize = screen.getByRole('button', { name: 'Authorize checkpoint' }) as HTMLButtonElement;
    expect(authorize.disabled).toBe(true);

    await fireEvent.click(screen.getByRole('checkbox', { name: 'Chapter prose' }));
    await fireEvent.click(screen.getByRole('checkbox', { name: 'Scene prose' }));
    expect(authorize.disabled).toBe(false);
    await fireEvent.click(authorize);

    expect(actions.onResume).not.toHaveBeenCalled();
    expect(actions.onAuthorize).toHaveBeenCalledWith(checkpointRun, expect.objectContaining({
      authorizationScope: expect.objectContaining({
        allowChapterWrites: true,
        allowSceneWrites: true,
        allowCanonWrites: true,
        allowDiagnostics: true
      })
    }));
  });
});
