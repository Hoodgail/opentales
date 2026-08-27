import { beforeEach, describe, expect, it, vi } from 'vitest';
import { OpenTalesClient, type BuildManuscriptUnit, type BuildReview, type BuildRun, type CanonFact, type StoryArtifact } from '@opentales/sdk';
import { createStoryIdeStore } from './storyIde.svelte';

function run(id: string, revision = 1): BuildRun {
  return {
    id,
    projectId: 'project-1',
    objective: `Build ${id}`,
    brainstorm: 'A durable test story.',
    manifest: { version: '1', sourceBrainstormHash: 'hash', target: {}, artifactSpecs: [], phases: [] },
    autonomyMode: 'plan-review',
    status: 'paused',
    currentPhase: 'planning',
    workflowVersion: '1',
    branchName: `ai/${id}`,
    authorizationScope: { artifactTypes: [], chapterIds: [], sceneIds: [], allowPlanningArtifacts: true, allowCanonWrites: true, allowChapterWrites: true, allowSceneWrites: true, allowDiagnostics: true, expiresAt: null },
    maxTokens: 10_000,
    tokensUsed: 0,
    tokensReserved: 0,
    maxCostMicros: 1_000_000,
    costMicrosUsed: 0,
    costMicrosReserved: 0,
    revision,
    executionGeneration: 0,
    lastError: null,
    authorizedAt: null,
    pausedAt: null,
    completedAt: null,
    failedAt: null,
    cancelledAt: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    progress: { percent: 0, total: 0, blocked: 0, ready: 0, running: 0, review: 0, done: 0, failed: 0, cancelled: 0 },
    tasks: [],
    latestCheckpoint: null,
    activeDirective: null
  };
}

function artifact(id: string, buildRunId: string): StoryArtifact {
  return {
    id,
    projectId: 'project-1',
    buildRunId,
    taskId: null,
    type: 'story-brief',
    key: id,
    title: id,
    version: 1,
    schemaVersion: '1',
    status: 'validated',
    content: { premise: id, genre: 'test', tone: [], promises: [], constraints: [] },
    contentHash: id,
    replacesArtifactId: null,
    acceptedAt: null,
    invalidatedAt: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    bindings: []
  };
}

function review(status: BuildReview['status'] = 'open', revision = 0): BuildReview {
  return {
    id: 'review-1', projectId: 'project-1', buildRunId: 'run-a', compilationId: 'compilation-1', checkpointId: null,
    title: 'Exact branch review', message: null, status, revision, approvedAt: status === 'approved' ? '2026-01-01T00:00:00.000Z' : null,
    mergedAt: status === 'merged' ? '2026-01-01T00:00:00.000Z' : null, rejectedAt: status === 'rejected' ? '2026-01-01T00:00:00.000Z' : null,
    rejectionReason: status === 'rejected' ? 'Revise it.' : null, createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z', units: []
  };
}

function buildUnit(revision = 1, body = 'Original branch prose.'): BuildManuscriptUnit {
  return {
    id: 'unit-1', projectId: 'project-1', buildRunId: 'run-a', sourceTaskId: null, planArtifactId: null,
    parentUnitId: null, sourceChapterId: 'chapter-1', sourceSceneId: null, writingId: 'writing-1', branchId: 'branch-1',
    headVersionId: `version-${revision}`, kind: 'chapter', status: 'drafting', key: 'chapter-1', containerKey: 'book', order: 0,
    chapterNumber: 1, title: 'Chapter one', povCharacterId: null, locationId: null, storyDate: null, storyTime: null,
    tension: null, metadata: {}, revision, body, wordCount: body.trim().split(/\s+/u).length, invalidatedAt: null,
    createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z'
  };
}

function canonFact(version = 1, object: string = 'blue'): CanonFact {
  return {
    id: `fact-${version}`, projectId: 'project-1', buildRunId: 'run-a', sourceArtifactId: null, sourceTaskId: null,
    sourceUnitId: null, supersedesFactId: version > 1 ? `fact-${version - 1}` : null, key: 'mara-eyes', version, isCurrent: true,
    subjectType: 'character', subjectId: 'mara', predicate: 'eye-color', object, status: 'canonical', validFromSceneId: null,
    validToSceneId: null, validFromOrder: null, validToOrder: null, sourceChapterId: null, sourceSceneId: null, sourceSpan: null,
    confidence: 1, invalidatedAt: null, createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z'
  };
}

function installDetailDefaults() {
  vi.spyOn(OpenTalesClient.prototype, 'getStoryStateDelta').mockResolvedValue({ projectId: 'project-1', buildRunId: 'run', canonFacts: [], entityStates: [], timelineEvents: [], openLoops: [], setupPayoffs: [], plotThreads: [], generatedAt: new Date().toISOString(), sinceUpdatedAt: null, nextOffset: null });
  vi.spyOn(OpenTalesClient.prototype, 'getBuildObservability').mockResolvedValue({ projectId: 'project-1', buildRunId: 'run', traces: [], evaluations: [], checkpoints: [], directives: [] });
  vi.spyOn(OpenTalesClient.prototype, 'getStoryDiagnostics').mockResolvedValue({ projectId: 'project-1', buildRunId: 'run', generatedAt: new Date().toISOString(), diagnostics: [] });
  vi.spyOn(OpenTalesClient.prototype, 'listBuildManuscriptUnits').mockResolvedValue([]);
  vi.spyOn(OpenTalesClient.prototype, 'listBuildReviews').mockResolvedValue([]);
  vi.spyOn(OpenTalesClient.prototype, 'compareBuildManuscript').mockResolvedValue({ projectId: 'project-1', buildRunId: 'run', compilationId: null, prose: [], semantic: { addedCanonFactIds: [], changedEntityStateIds: [], timelineEventIds: [], unresolvedOpenLoopIds: [], activePlotThreadIds: [] } });
}

describe('storyIde store resilience', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    installDetailDefaults();
  });

  it('clears prior run slices when a new run has a partial detail failure', async () => {
    vi.spyOn(OpenTalesClient.prototype, 'getBuildRun').mockImplementation(async (_projectId, runId) => run(runId));
    vi.spyOn(OpenTalesClient.prototype, 'listStoryArtifacts').mockImplementation(async (_projectId, runId) => {
      if (runId === 'run-b') throw new Error('artifact index unavailable');
      return { items: [artifact('artifact-a', runId)], total: 1, limit: 500, offset: 0, nextOffset: null };
    });
    const store = createStoryIdeStore();

    await store.selectRun('project-1', 'run-a');
    expect(store.artifacts.map((item) => item.id)).toEqual(['artifact-a']);

    await store.selectRun('project-1', 'run-b');
    expect(store.selectedRunId).toBe('run-b');
    expect(store.artifacts).toHaveLength(0);
    expect(store.detailWarning).toContain('artifact index unavailable');
  });

  it('loads every artifact page instead of truncating a full-book history', async () => {
    vi.spyOn(OpenTalesClient.prototype, 'getBuildRun').mockResolvedValue(run('run-a'));
    const all = Array.from({ length: 501 }, (_, index) => artifact(`artifact-${index}`, 'run-a'));
    vi.spyOn(OpenTalesClient.prototype, 'listStoryArtifacts').mockImplementation(async (_projectId, _runId, input) => {
      const offset = input?.offset ?? 0;
      const items = all.slice(offset, offset + 500);
      return { items, total: all.length, limit: 500, offset, nextOffset: offset + items.length < all.length ? offset + items.length : null };
    });
    const store = createStoryIdeStore();

    await store.selectRun('project-1', 'run-a');
    expect(store.artifacts).toHaveLength(501);
  });

  it('projects only the latest active story-state version from delta pages', async () => {
    vi.spyOn(OpenTalesClient.prototype, 'getBuildRun').mockResolvedValue(run('run-a'));
    vi.spyOn(OpenTalesClient.prototype, 'listStoryArtifacts').mockResolvedValue({ items: [], total: 0, limit: 500, offset: 0, nextOffset: null });
    const fact = (version: number, isCurrent: boolean) => ({
      id: `fact-${version}`, projectId: 'project-1', buildRunId: 'run-a', sourceArtifactId: null, sourceTaskId: null,
      sourceUnitId: null, supersedesFactId: version > 1 ? `fact-${version - 1}` : null, key: 'keeper', version, isCurrent,
      subjectType: 'character', subjectId: 'mara', predicate: 'keeper', object: version, status: 'canonical' as const,
      validFromSceneId: null, validToSceneId: null, validFromOrder: null, validToOrder: null, sourceChapterId: null,
      sourceSceneId: null, sourceSpan: null, confidence: 1, invalidatedAt: null, createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: `2026-01-0${version}T00:00:00.000Z`
    });
    vi.spyOn(OpenTalesClient.prototype, 'getStoryStateDelta').mockResolvedValue({
      projectId: 'project-1', buildRunId: 'run-a', canonFacts: [fact(1, false), fact(2, true)], entityStates: [], timelineEvents: [],
      openLoops: [], setupPayoffs: [], plotThreads: [], generatedAt: new Date().toISOString(), sinceUpdatedAt: null, nextOffset: null
    });
    const store = createStoryIdeStore();

    await store.selectRun('project-1', 'run-a');

    expect(store.snapshot?.canonFacts.map((item) => [item.id, item.version])).toEqual([['fact-2', 2]]);
  });

  it('surfaces quiet poll failures as reconnecting state instead of freezing silently', async () => {
    const getRun = vi.spyOn(OpenTalesClient.prototype, 'getBuildRun');
    getRun.mockResolvedValueOnce(run('run-a')).mockRejectedValueOnce(new Error('network offline'));
    vi.spyOn(OpenTalesClient.prototype, 'listStoryArtifacts').mockResolvedValue({ items: [], total: 0, limit: 500, offset: 0, nextOffset: null });
    const store = createStoryIdeStore();
    await store.selectRun('project-1', 'run-a');

    await store.refreshSelected(true);
    expect(store.connection).toBe('reconnecting');
    expect(store.error).toContain('network offline');
    expect(store.consecutivePollFailures).toBe(1);
  });

  it('retries a failed supporting slice even when the Build revision is unchanged', async () => {
    vi.spyOn(OpenTalesClient.prototype, 'getBuildRun').mockResolvedValue(run('run-a', 7));
    vi.spyOn(OpenTalesClient.prototype, 'listStoryArtifacts').mockResolvedValue({ items: [], total: 0, limit: 500, offset: 0, nextOffset: null });
    const diagnostics = vi.spyOn(OpenTalesClient.prototype, 'getStoryDiagnostics')
      .mockRejectedValueOnce(new Error('diagnostics temporarily unavailable'))
      .mockResolvedValue({ projectId: 'project-1', buildRunId: 'run-a', generatedAt: new Date().toISOString(), diagnostics: [] });
    const store = createStoryIdeStore();

    await store.selectRun('project-1', 'run-a');
    expect(store.detailWarning).toContain('diagnostics temporarily unavailable');
    await store.refreshSelected(true);

    expect(diagnostics).toHaveBeenCalledTimes(2);
    expect(store.detailWarning).toBeNull();
    expect(store.connection).toBe('connected');
  });

  it('recovers fail → fail → success and clears the stale refresh error', async () => {
    const getRun = vi.spyOn(OpenTalesClient.prototype, 'getBuildRun')
      .mockResolvedValueOnce(run('run-a'))
      .mockRejectedValueOnce(new Error('offline one'))
      .mockRejectedValueOnce(new Error('offline two'))
      .mockResolvedValue(run('run-a'));
    vi.spyOn(OpenTalesClient.prototype, 'listStoryArtifacts').mockResolvedValue({ items: [], total: 0, limit: 500, offset: 0, nextOffset: null });
    const store = createStoryIdeStore();
    await store.selectRun('project-1', 'run-a');

    await store.refreshSelected(true);
    await store.refreshSelected(true);
    expect(store.connection).toBe('reconnecting');
    await store.refreshSelected(true);

    expect(getRun).toHaveBeenCalledTimes(4);
    expect(store.connection).toBe('connected');
    expect(store.consecutivePollFailures).toBe(0);
    expect(store.error).toBeNull();
  });

  it('reuses the same idempotency request after ambiguous review response loss', async () => {
    vi.spyOn(OpenTalesClient.prototype, 'getBuildRun').mockResolvedValue(run('run-a'));
    vi.spyOn(OpenTalesClient.prototype, 'listStoryArtifacts').mockResolvedValue({ items: [], total: 0, limit: 500, offset: 0, nextOffset: null });
    vi.spyOn(OpenTalesClient.prototype, 'listBuildReviews').mockResolvedValue([review('open', 0)]);
    vi.spyOn(OpenTalesClient.prototype, 'getBuildCompilation').mockResolvedValue({ id: 'compilation-1', projectId: 'project-1', buildRunId: 'run-a', checkpointId: null, exportManifestArtifactId: null, manifest: {}, chapterDraftArtifactIds: [], totalWordCount: 10, contentHash: 'hash', createdAt: '2026-01-01T00:00:00.000Z', units: [] });
    const calls: string[] = [];
    const reject = vi.spyOn(OpenTalesClient.prototype, 'rejectBuildReview')
      .mockImplementationOnce(async (_projectId, _runId, _reviewId, input) => { calls.push(input.idempotencyKey); throw new SyntaxError('truncated response'); })
      .mockImplementationOnce(async (_projectId, _runId, _reviewId, input) => { calls.push(input.idempotencyKey); return review('rejected', 1); });
    const store = createStoryIdeStore();
    await store.selectRun('project-1', 'run-a');

    await expect(store.rejectReview(review('open', 0), 'Revise it.')).rejects.toThrow('truncated response');
    await expect(store.rejectReview(review('open', 0), 'Revise it.')).resolves.toMatchObject({ status: 'rejected' });

    expect(reject).toHaveBeenCalledTimes(2);
    expect(calls[0]).toBe(calls[1]);
  });

  it('reuses the exact unit mutation key after an ambiguous uncommitted response', async () => {
    vi.spyOn(OpenTalesClient.prototype, 'getBuildRun').mockResolvedValue(run('run-a'));
    vi.spyOn(OpenTalesClient.prototype, 'listStoryArtifacts').mockResolvedValue({ items: [], total: 0, limit: 500, offset: 0, nextOffset: null });
    vi.spyOn(OpenTalesClient.prototype, 'listBuildManuscriptUnits').mockResolvedValue([buildUnit()]);
    const keys: string[] = [];
    vi.spyOn(OpenTalesClient.prototype, 'patchBuildManuscriptUnit')
      .mockImplementationOnce(async (_projectId, _runId, _unitId, input) => { keys.push(input.idempotencyKey); throw new SyntaxError('lost unit response'); })
      .mockImplementationOnce(async (_projectId, _runId, _unitId, input) => { keys.push(input.idempotencyKey); return buildUnit(2, 'Revised branch prose.'); });
    const store = createStoryIdeStore();
    await store.selectRun('project-1', 'run-a');

    const input = { body: 'Revised branch prose.', message: 'writer edit' };
    await expect(store.patchUnit(buildUnit(), input)).rejects.toThrow('lost unit response');
    await expect(store.patchUnit(buildUnit(), input)).resolves.toMatchObject({ revision: 2, body: 'Revised branch prose.' });

    expect(keys).toHaveLength(2);
    expect(keys[0]).toBe(keys[1]);
  });

  it('reorders a complete build-only sibling set with run and unit CAS revisions', async () => {
    vi.spyOn(OpenTalesClient.prototype, 'getBuildRun').mockResolvedValue(run('run-a', 3));
    vi.spyOn(OpenTalesClient.prototype, 'listStoryArtifacts').mockResolvedValue({ items: [], total: 0, limit: 500, offset: 0, nextOffset: null });
    const first = { ...buildUnit(2), id: 'scene-a', kind: 'scene' as const, parentUnitId: 'chapter-unit', sourceChapterId: null, sourceSceneId: null, order: 0 };
    const second = { ...buildUnit(4), id: 'scene-b', kind: 'scene' as const, parentUnitId: 'chapter-unit', sourceChapterId: null, sourceSceneId: null, order: 1 };
    vi.spyOn(OpenTalesClient.prototype, 'listBuildManuscriptUnits').mockResolvedValue([first, second]);
    const reorder = vi.spyOn(OpenTalesClient.prototype, 'reorderBuildManuscriptUnits').mockResolvedValue([{ ...second, order: 0, revision: 5 }, { ...first, order: 1, revision: 3 }]);
    const store = createStoryIdeStore();
    await store.selectRun('project-1', 'run-a');

    await store.reorderUnits('chapter-unit', [second.id, first.id]);

    expect(reorder).toHaveBeenCalledWith('project-1', 'run-a', expect.objectContaining({
      expectedBuildRevision: 3,
      parentUnitId: 'chapter-unit',
      unitIds: ['scene-b', 'scene-a'],
      expectedUnitRevisions: { 'scene-a': 2, 'scene-b': 4 },
      idempotencyKey: expect.any(String)
    }));
  });

  it('reuses the exact story-state batch key after an ambiguous uncommitted response', async () => {
    vi.spyOn(OpenTalesClient.prototype, 'getBuildRun').mockResolvedValue(run('run-a'));
    vi.spyOn(OpenTalesClient.prototype, 'listStoryArtifacts').mockResolvedValue({ items: [], total: 0, limit: 500, offset: 0, nextOffset: null });
    vi.spyOn(OpenTalesClient.prototype, 'getStoryStateDelta').mockResolvedValue({ projectId: 'project-1', buildRunId: 'run-a', canonFacts: [canonFact()], entityStates: [], timelineEvents: [], openLoops: [], setupPayoffs: [], plotThreads: [], generatedAt: new Date().toISOString(), sinceUpdatedAt: null, nextOffset: null });
    const keys: string[] = [];
    const updated = canonFact(2, 'green');
    vi.spyOn(OpenTalesClient.prototype, 'applyStoryStateBatch')
      .mockImplementationOnce(async (_projectId, _runId, input) => { keys.push(input.idempotencyKey); throw new SyntaxError('lost state response'); })
      .mockImplementationOnce(async (_projectId, _runId, input) => { keys.push(input.idempotencyKey); return { projectId: 'project-1', buildRunId: 'run-a', buildRevision: 2, canonFacts: [updated], entityStates: [], timelineEvents: [], openLoops: [], setupPayoffs: [], plotThreads: [] }; });
    const store = createStoryIdeStore();
    await store.selectRun('project-1', 'run-a');

    await expect(store.updateFact(canonFact(), { object: 'green', status: 'canonical' })).rejects.toThrow('lost state response');
    await expect(store.updateFact(canonFact(), { object: 'green', status: 'canonical' })).resolves.toMatchObject({ version: 2, object: 'green' });

    expect(keys).toHaveLength(2);
    expect(keys[0]).toBe(keys[1]);
  });

  it('reconciles a committed review when the success response is lost', async () => {
    vi.spyOn(OpenTalesClient.prototype, 'getBuildRun').mockResolvedValue(run('run-a'));
    vi.spyOn(OpenTalesClient.prototype, 'listStoryArtifacts').mockResolvedValue({ items: [], total: 0, limit: 500, offset: 0, nextOffset: null });
    const listReviews = vi.spyOn(OpenTalesClient.prototype, 'listBuildReviews')
      .mockResolvedValueOnce([review('open', 0)])
      .mockResolvedValue([review('rejected', 1)]);
    vi.spyOn(OpenTalesClient.prototype, 'getBuildCompilation').mockResolvedValue({ id: 'compilation-1', projectId: 'project-1', buildRunId: 'run-a', checkpointId: null, exportManifestArtifactId: null, manifest: {}, chapterDraftArtifactIds: [], totalWordCount: 10, contentHash: 'hash', createdAt: '2026-01-01T00:00:00.000Z', units: [] });
    vi.spyOn(OpenTalesClient.prototype, 'rejectBuildReview').mockRejectedValue(new SyntaxError('malformed success payload'));
    const store = createStoryIdeStore();
    await store.selectRun('project-1', 'run-a');

    await expect(store.rejectReview(review('open', 0), 'Revise it.')).resolves.toMatchObject({ status: 'rejected', revision: 1 });
    expect(listReviews).toHaveBeenCalledTimes(2);
    expect(store.reviews[0]).toMatchObject({ status: 'rejected', revision: 1 });
    expect(store.error).toBeNull();
  });

  it('loads more than 500 observability and story-state records', async () => {
    vi.spyOn(OpenTalesClient.prototype, 'getBuildRun').mockResolvedValue(run('run-a'));
    vi.spyOn(OpenTalesClient.prototype, 'listStoryArtifacts').mockResolvedValue({ items: [], total: 0, limit: 500, offset: 0, nextOffset: null });
    const traces = Array.from({ length: 501 }, (_, index) => ({ id: `trace-${index}`, projectId: 'project-1', buildRunId: 'run-a', taskId: null, idempotencyKey: `trace-${index}`, attempt: index, status: 'completed' as const, provider: null, model: null, modelParameters: null, workflowVersion: '1', systemPromptVersion: null, skillVersions: {}, toolSchemaVersions: {}, inputs: {}, retrievedArtifactIds: [], contextTokenCount: 0, toolCalls: [], toolResults: [], outputs: {}, validatorResults: {}, inputTokens: 0, outputTokens: 0, costMicros: 0, latencyMs: 0, retries: 0, completionState: 'done', error: null, startedAt: '2026-01-01T00:00:00.000Z', completedAt: '2026-01-01T00:00:00.000Z' }));
    vi.spyOn(OpenTalesClient.prototype, 'getBuildObservability').mockImplementation(async (_projectId, _runId, input) => ({ projectId: 'project-1', buildRunId: 'run-a', traces: traces.slice(input?.offset ?? 0, (input?.offset ?? 0) + 500), evaluations: [], checkpoints: [], directives: [] }));
    const facts = Array.from({ length: 501 }, (_, index) => ({ id: `fact-${index}`, projectId: 'project-1', buildRunId: 'run-a', sourceArtifactId: null, sourceTaskId: null, sourceUnitId: null, supersedesFactId: null, key: `fact-${index}`, version: 1, isCurrent: true, subjectType: 'character', subjectId: 'mara', predicate: `fact-${index}`, object: index, status: 'canonical' as const, validFromSceneId: null, validToSceneId: null, validFromOrder: null, validToOrder: null, sourceChapterId: null, sourceSceneId: null, sourceSpan: null, confidence: 1, invalidatedAt: null, createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' }));
    vi.spyOn(OpenTalesClient.prototype, 'getStoryStateDelta').mockImplementation(async (_projectId, _runId, input) => { const offset = input?.offset ?? 0; const page = facts.slice(offset, offset + 500); return { projectId: 'project-1', buildRunId: 'run-a', canonFacts: page, entityStates: [], timelineEvents: [], openLoops: [], setupPayoffs: [], plotThreads: [], generatedAt: new Date().toISOString(), sinceUpdatedAt: null, nextOffset: offset + page.length < facts.length ? offset + page.length : null }; });
    const store = createStoryIdeStore();

    await store.selectRun('project-1', 'run-a');

    expect(store.traces).toHaveLength(501);
    expect(store.snapshot?.canonFacts).toHaveLength(501);
  });

  it('reloads the immutable compilation for the active persisted review', async () => {
    vi.spyOn(OpenTalesClient.prototype, 'getBuildRun').mockResolvedValue(run('run-a'));
    vi.spyOn(OpenTalesClient.prototype, 'listStoryArtifacts').mockResolvedValue({ items: [], total: 0, limit: 500, offset: 0, nextOffset: null });
    vi.spyOn(OpenTalesClient.prototype, 'listBuildReviews').mockResolvedValue([review('open', 0)]);
    const getCompilation = vi.spyOn(OpenTalesClient.prototype, 'getBuildCompilation').mockResolvedValue({
      id: 'compilation-1', projectId: 'project-1', buildRunId: 'run-a', checkpointId: null, exportManifestArtifactId: null,
      manifest: { frozen: true }, chapterDraftArtifactIds: [], totalWordCount: 42, contentHash: 'frozen-hash',
      createdAt: '2026-01-01T00:00:00.000Z', units: []
    });
    const store = createStoryIdeStore();

    await store.selectRun('project-1', 'run-a');

    expect(getCompilation).toHaveBeenCalledWith('project-1', 'run-a', 'compilation-1');
    expect(store.compilation).toMatchObject({ id: 'compilation-1', totalWordCount: 42, contentHash: 'frozen-hash' });
  });

  it('ignores a stale search response that resolves after the current query', async () => {
    vi.spyOn(OpenTalesClient.prototype, 'getBuildRun').mockResolvedValue(run('run-a'));
    vi.spyOn(OpenTalesClient.prototype, 'listStoryArtifacts').mockResolvedValue({ items: [], total: 0, limit: 500, offset: 0, nextOffset: null });
    let resolveOld!: (value: any) => void;
    let resolveNew!: (value: any) => void;
    vi.spyOn(OpenTalesClient.prototype, 'searchStory')
      .mockImplementationOnce(() => new Promise((resolve) => { resolveOld = resolve; }))
      .mockImplementationOnce(() => new Promise((resolve) => { resolveNew = resolve; }));
    const store = createStoryIdeStore();
    await store.selectRun('project-1', 'run-a');
    const oldRequest = store.search({ query: 'old' });
    const newRequest = store.search({ query: 'new' });
    resolveNew({ query: 'new', strategyUsed: 'exact', warnings: [], hits: [{ kind: 'chapter', id: 'new', key: null, title: 'New', snippet: 'new', score: 1, ref: { type: 'chapter', id: 'new' }, sourceSpan: null }], total: 1, limit: 50, offset: 0, nextOffset: null });
    await newRequest;
    resolveOld({ query: 'old', strategyUsed: 'exact', warnings: [], hits: [{ kind: 'chapter', id: 'old', key: null, title: 'Old', snippet: 'old', score: 1, ref: { type: 'chapter', id: 'old' }, sourceSpan: null }], total: 1, limit: 50, offset: 0, nextOffset: null });
    await oldRequest;

    expect(store.searchResult?.query).toBe('new');
    expect(store.searchResult?.hits.map((hit) => hit.id)).toEqual(['new']);
  });

  it('appends more than 500 search hits through opaque cursors without duplicate or offset fallbacks', async () => {
    vi.spyOn(OpenTalesClient.prototype, 'getBuildRun').mockResolvedValue(run('run-a'));
    vi.spyOn(OpenTalesClient.prototype, 'listStoryArtifacts').mockResolvedValue({ items: [], total: 0, limit: 500, offset: 0, nextOffset: null });
    const hits = Array.from({ length: 501 }, (_, index) => ({
      kind: 'build-unit' as const, id: `unit-${index}`, key: `scene-${index}`, title: `Scene ${index}`,
      snippet: `Prose ${index}`, score: 1, ref: { type: 'build-unit', id: `unit-${index}` },
      sourceSpan: { unitId: `unit-${index}`, start: index, end: index + 1 }
    }));
    const search = vi.spyOn(OpenTalesClient.prototype, 'searchStory').mockImplementation(async (_projectId, _runId, input) => {
      const offset = input.cursor ? Number(input.cursor.slice('cursor-'.length)) : 0;
      const page = hits.slice(offset, offset + 100);
      const nextOffset = offset + page.length < hits.length ? offset + page.length : null;
      return { query: input.query, strategyUsed: 'exact', warnings: [], hits: page, total: hits.length, limit: 100, offset, nextOffset, nextCursor: nextOffset === null ? null : `cursor-${nextOffset}` };
    });
    const store = createStoryIdeStore();
    await store.selectRun('project-1', 'run-a');

    await store.search({ query: 'Prose', strategy: 'exact', limit: 100 });
    while (store.searchResult?.nextCursor) {
      await store.search({ query: 'Prose', strategy: 'exact', limit: 100, cursor: store.searchResult.nextCursor }, true);
    }

    expect(store.searchResult?.hits).toHaveLength(501);
    expect(new Set(store.searchResult?.hits.map((hit) => hit.id)).size).toBe(501);
    expect(search).toHaveBeenCalledTimes(6);
    expect(search.mock.calls.slice(1).every((call) => Boolean(call[2].cursor) && call[2].offset === undefined)).toBe(true);
  });

  it('forwards exact preview and confirmed apply contracts to the project refactor API', async () => {
    const previewInput = {
      targetType: 'character' as const, targetId: 'character-1', newName: 'Maris', scope: 'main' as const,
      caseSensitive: true, includeAliases: ['The Fox']
    };
    const preview = {
      projectId: 'project-1', ...previewInput, oldName: 'Mara', aliases: ['The Fox'], buildRunId: null,
      selectedNames: ['The Fox', 'Mara'], occurrences: [], totalOccurrences: 0, truncated: false,
      expectedHeads: [], expectedRevisions: { 'character:character-1': 'revision-1' },
      expectedEntityUpdatedAt: '2026-01-01T00:00:00.000Z', previewHash: 'preview-hash', conflicts: []
    };
    const applyInput = {
      ...previewInput, idempotencyKey: 'rename-key', confirm: true as const, previewHash: preview.previewHash,
      expectedHeads: preview.expectedHeads, expectedRevisions: preview.expectedRevisions,
      expectedEntityUpdatedAt: preview.expectedEntityUpdatedAt
    };
    const result = {
      previewHash: preview.previewHash, targetType: 'character' as const, targetId: 'character-1',
      oldName: 'Mara', newName: 'Maris', aliases: ['Mara', 'The Fox'], scope: 'main' as const,
      buildRunId: null, appliedOccurrences: 0, updatedBranches: [], updatedArtifactIds: [], updatedUnitIds: [],
      appliedAt: '2026-01-01T00:01:00.000Z'
    };
    const previewCall = vi.spyOn(OpenTalesClient.prototype, 'previewRenameSymbol').mockResolvedValue(preview);
    const applyCall = vi.spyOn(OpenTalesClient.prototype, 'applyRenameSymbol').mockResolvedValue(result);
    const store = createStoryIdeStore();

    await expect(store.previewRenameSymbol('project-1', previewInput)).resolves.toEqual(preview);
    await expect(store.applyRenameSymbol('project-1', applyInput)).resolves.toEqual(result);

    expect(previewCall).toHaveBeenCalledWith('project-1', previewInput);
    expect(applyCall).toHaveBeenCalledWith('project-1', applyInput);
  });

});
