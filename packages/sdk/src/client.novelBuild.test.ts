import { describe, expect, it, vi } from 'vitest';
import { ApiError, OpenTalesClient } from './client.js';

function createHarness(responseBody: unknown = {}) {
  const fetcher = vi.fn(async () => new Response(JSON.stringify(responseBody), {
    status: 200,
    headers: { 'content-type': 'application/json' }
  })) as unknown as typeof fetch;
  const client = new OpenTalesClient({ baseUrl: 'https://api.example.test/', token: 'secret-token', fetcher });
  return { client, fetcher: fetcher as unknown as ReturnType<typeof vi.fn> };
}

describe('OpenTalesClient Novel Build contracts', () => {
  it('uses authenticated build collection and detail routes', async () => {
    const { client, fetcher } = createHarness([]);
    await client.listBuildRuns('project one');
    expect(fetcher).toHaveBeenLastCalledWith('https://api.example.test/projects/project one/builds', expect.objectContaining({
      method: 'GET', headers: expect.any(Headers)
    }));
    const headers = fetcher.mock.calls[0][1]?.headers as Headers;
    expect(headers.get('authorization')).toBe('Bearer secret-token');

    await client.createBuildRun('p1', {
      idempotencyKey: 'create-1', brainstorm: 'One complete brainstorm.', autonomyMode: 'plan-review'
    });
    const [, createInit] = fetcher.mock.calls[1];
    expect(fetcher.mock.calls[1][0]).toBe('https://api.example.test/projects/p1/builds');
    expect(createInit.method).toBe('POST');
    expect(JSON.parse(String(createInit.body))).toEqual(expect.objectContaining({ idempotencyKey: 'create-1', autonomyMode: 'plan-review' }));

    await client.getBuildRun('p1', 'build-1');
    expect(fetcher.mock.calls[2][0]).toBe('https://api.example.test/projects/p1/builds/build-1');
  });

  it('serializes only writer-authorized lifecycle and checkpoint actions', async () => {
    const { client, fetcher } = createHarness({});
    await client.pauseBuildRun('p', 'b', { idempotencyKey: 'pause-1', expectedRevision: 4 });
    await client.resumeBuildRun('p', 'b', { idempotencyKey: 'resume-1', expectedRevision: 5 });
    await client.cancelBuildRun('p', 'b', { idempotencyKey: 'cancel-1', expectedRevision: 6 });
    await client.retryBuildTask('p', 'b', 't', { idempotencyKey: 'retry-1', expectedRevision: 7 });
    await client.rerunBuildTask('p', 'b', 't', { idempotencyKey: 'rerun-1', expectedRevision: 8 });
    await client.replanBuildRun('p', 'b', {
      idempotencyKey: 'replan-1', expectedRevision: 9, fromTaskId: 'chapter-12-context',
      checkpointId: 'chapter-11-checkpoint', directive: 'Keep everything through Chapter 11; Mara refuses Elias in Chapter 12.',
      pinnedArtifactIds: ['chapter-11-draft']
    });
    await client.createBuildCheckpoint('p', 'b', {
      idempotencyKey: 'checkpoint-1', expectedBuildRevision: 10, label: 'Author checkpoint'
    });

    expect(fetcher.mock.calls.map((call) => call[0])).toEqual([
      'https://api.example.test/projects/p/builds/b/pause',
      'https://api.example.test/projects/p/builds/b/resume',
      'https://api.example.test/projects/p/builds/b/cancel',
      'https://api.example.test/projects/p/builds/b/tasks/t/retry',
      'https://api.example.test/projects/p/builds/b/tasks/t/rerun',
      'https://api.example.test/projects/p/builds/b/replan',
      'https://api.example.test/projects/p/builds/b/checkpoints'
    ]);
    expect(fetcher.mock.calls.every((call) => call[1]?.method === 'POST')).toBe(true);
  });

  it('serializes artifact filters as repeated bounded query parameters', async () => {
    const { client, fetcher } = createHarness({ items: [] });
    await client.listStoryArtifacts('p', 'b', {
      types: ['story-brief', 'scene-plan'], statuses: ['validated', 'accepted'], taskId: 'task-1', limit: 25, offset: 50
    });
    const url = new URL(String(fetcher.mock.calls[0][0]));
    expect(url.pathname).toBe('/projects/p/builds/b/artifacts');
    expect(url.searchParams.getAll('types')).toEqual(['story-brief', 'scene-plan']);
    expect(url.searchParams.getAll('statuses')).toEqual(['validated', 'accepted']);
    expect(url.searchParams.get('taskId')).toBe('task-1');
    expect(url.searchParams.get('limit')).toBe('25');
    expect(url.searchParams.get('offset')).toBe('50');
  });

  it('uses production story-state, observability, search, reference and diagnostic routes', async () => {
    const { client, fetcher } = createHarness({});
    await client.getStoryState('p', 'b');
    await client.applyStoryStateBatch('p', 'b', { idempotencyKey: 'state-1', expectedBuildRevision: 1, operations: [] });
    await client.applyStoryArtifactBatch('p', 'b', { idempotencyKey: 'artifact-1', expectedBuildRevision: 2, operations: [] });
    await client.getBuildObservability('p', 'b', { taskId: 't', limit: 20, offset: 0 });
    await client.searchStory('p', 'b', { query: 'black key', strategy: 'hybrid', kinds: ['chapter', 'canon-fact'], filters: { pov: ['Mara'] }, cursor: 'story-search-v1:500' });
    await client.findStoryReferences('p', 'b', { refType: 'character', refId: 'mara', limit: 50 });
    await client.getStoryDiagnostics('p', 'b');

    expect(fetcher.mock.calls.map((call) => String(call[0]).replace(/\?.*$/, ''))).toEqual([
      'https://api.example.test/projects/p/builds/b/story-state',
      'https://api.example.test/projects/p/builds/b/story-state/batch',
      'https://api.example.test/projects/p/builds/b/artifacts/batch',
      'https://api.example.test/projects/p/builds/b/observability',
      'https://api.example.test/projects/p/builds/b/search',
      'https://api.example.test/projects/p/builds/b/references',
      'https://api.example.test/projects/p/builds/b/diagnostics'
    ]);
    expect(JSON.parse(String(fetcher.mock.calls[4][1]?.body))).toEqual(expect.objectContaining({ query: 'black key', strategy: 'hybrid', filters: { pov: ['Mara'] }, cursor: 'story-search-v1:500' }));
  });

  it('uses first-class scene CRUD routes', async () => {
    const { client, fetcher } = createHarness({});
    await client.listScenes('p', 'c');
    await client.createScene('p', 'c', { title: 'Threshold', sceneFunction: 'inciting incident', content: 'The door opened.' });
    await client.updateScene('p', 'c', 's', { status: 'review', expectedRevision: 2 });
    await client.deleteScene('p', 'c', 's');
    expect(fetcher.mock.calls.map((call) => call[0])).toEqual([
      'https://api.example.test/projects/p/chapters/c/scenes',
      'https://api.example.test/projects/p/chapters/c/scenes',
      'https://api.example.test/projects/p/chapters/c/scenes/s',
      'https://api.example.test/projects/p/chapters/c/scenes/s'
    ]);
    expect(fetcher.mock.calls.map((call) => call[1]?.method)).toEqual(['GET', 'POST', 'PATCH', 'DELETE']);
  });

  it('uses sandbox compilation, checkpoint branching, review, export, history and reorder contracts', async () => {
    const { client, fetcher } = createHarness({});
    await client.listBuildManuscriptUnits('p', 'b', { kind: 'scene', parentUnitId: 'chapter-unit' });
    await client.getBuildManuscriptUnit('p', 'b', 'unit');
    await client.createBuildManuscriptUnit('p', 'b', {
      idempotencyKey: 'unit-create', expectedBuildRevision: 1, kind: 'scene', key: 'scene-1',
      order: 0, title: 'Threshold', planArtifactId: 'plan', parentUnitId: 'chapter-unit'
    });
    await client.patchBuildManuscriptUnit('p', 'b', 'unit', {
      idempotencyKey: 'unit-patch', expectedBuildRevision: 2, expectedUnitRevision: 0,
      expectedHeadVersionId: 'head-1', body: 'Changed build prose.'
    });
    await client.compileBuildManuscript('p', 'b', { idempotencyKey: 'compile', expectedBuildRevision: 3 });
    await client.compareBuildManuscript('p', 'b');
    await client.listBuildReviews('p', 'b');
    await client.createBuildReview('p', 'b', { idempotencyKey: 'review', compilationId: 'compilation', title: 'Author review' });
    await client.getBuildReview('p', 'b', 'review');
    await client.approveBuildReview('p', 'b', 'review', { idempotencyKey: 'approve', expectedRevision: 0, confirm: true });
    await client.mergeBuildReview('p', 'b', 'review', { idempotencyKey: 'merge', expectedRevision: 1, confirm: true });
    await client.rejectBuildReview('p', 'b', 'review-2', { idempotencyKey: 'reject', expectedRevision: 0, confirm: true, reason: 'Revise the ending.' });
    await client.registerBuildExport('p', 'b', {
      idempotencyKey: 'export', expectedBuildRevision: 4, compilationId: 'compilation',
      outputs: [{ projectExportId: 'project-export', format: 'pdf', assetId: 'asset', mimeType: 'application/pdf' }]
    });
    await client.unpinBuildArtifacts('p', 'b', { idempotencyKey: 'unpin', expectedRevision: 5, artifactIds: ['artifact'] });
    await client.branchBuildFromCheckpoint('p', 'b', {
      idempotencyKey: 'branch', expectedRevision: 6, checkpointId: 'checkpoint', fromTaskId: 'task',
      directive: 'Keep the checkpoint and explore a darker ending.'
    });
    await client.getStoryStateDelta('p', 'b', { sinceUpdatedAt: '2026-08-25T00:00:00.000Z', limit: 25, offset: 50 });
    await client.getStoryStateHistory('p', 'b', 'canon-fact', 'mara:alive');
    await client.queryTemporalStoryState('p', 'b', { storyOrder: 12, entityType: 'character', entityId: 'mara' });
    await client.reorderScenes('p', 'chapter', { sceneIds: ['s2', 's1'], expectedRevisions: { s1: 1, s2: 2 } });

    expect(fetcher.mock.calls.map((call) => String(call[0]).replace(/\?.*$/, ''))).toEqual([
      'https://api.example.test/projects/p/builds/b/units',
      'https://api.example.test/projects/p/builds/b/units/unit',
      'https://api.example.test/projects/p/builds/b/units',
      'https://api.example.test/projects/p/builds/b/units/unit',
      'https://api.example.test/projects/p/builds/b/compile',
      'https://api.example.test/projects/p/builds/b/comparison',
      'https://api.example.test/projects/p/builds/b/reviews',
      'https://api.example.test/projects/p/builds/b/reviews',
      'https://api.example.test/projects/p/builds/b/reviews/review',
      'https://api.example.test/projects/p/builds/b/reviews/review/approve',
      'https://api.example.test/projects/p/builds/b/reviews/review/merge',
      'https://api.example.test/projects/p/builds/b/reviews/review-2/reject',
      'https://api.example.test/projects/p/builds/b/exports',
      'https://api.example.test/projects/p/builds/b/pins/unpin',
      'https://api.example.test/projects/p/builds/b/branches/from-checkpoint',
      'https://api.example.test/projects/p/builds/b/story-state/delta',
      'https://api.example.test/projects/p/builds/b/story-state/history/canon-fact/mara%3Aalive',
      'https://api.example.test/projects/p/builds/b/story-state/temporal',
      'https://api.example.test/projects/p/chapters/chapter/scenes/reorder'
    ]);
    expect(fetcher.mock.calls[9][1]?.method).toBe('POST');
    expect(JSON.parse(String(fetcher.mock.calls[11][1]?.body))).toEqual(expect.objectContaining({ confirm: true, reason: 'Revise the ending.' }));
    expect(JSON.parse(String(fetcher.mock.calls[18][1]?.body))).toEqual({ sceneIds: ['s2', 's1'], expectedRevisions: { s1: 1, s2: 2 } });
  });

  it('surfaces typed API errors from build endpoints', async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ message: 'Build revision is stale', details: { expected: 2, actual: 3 } }), {
      status: 409,
      headers: { 'content-type': 'application/json' }
    })) as unknown as typeof fetch;
    const client = new OpenTalesClient({ baseUrl: 'https://api.example.test', fetcher });
    const error = await client.getBuildRun('p', 'b').catch((caught) => caught);
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({
      name: 'ApiError', status: 409, message: 'Build revision is stale',
      details: expect.objectContaining({ details: expect.objectContaining({ expected: 2, actual: 3 }) })
    });
  });

  it('uses the isolated build-unit reorder route without mutating main Scene order', async () => {
    const { client, fetcher } = createHarness([]);
    await client.reorderBuildManuscriptUnits('p', 'b', {
      idempotencyKey: 'unit-order', expectedBuildRevision: 9, parentUnitId: 'chapter-unit',
      unitIds: ['scene-unit-2', 'scene-unit-1'], expectedUnitRevisions: { 'scene-unit-1': 3, 'scene-unit-2': 4 }
    });
    expect(fetcher.mock.calls[0][0]).toBe('https://api.example.test/projects/p/builds/b/units/reorder');
    expect(fetcher.mock.calls[0][1]?.method).toBe('POST');
  });

  it('reads a persisted build compilation through the typed route', async () => {
    const { client, fetcher } = createHarness({});
    await client.getBuildCompilation('p', 'b', 'compilation-1');
    expect(fetcher.mock.calls[0][0]).toBe('https://api.example.test/projects/p/builds/b/compilations/compilation-1');
    expect(fetcher.mock.calls[0][1]?.method).toBe('GET');
  });

  it('does not expose worker-internal execution mutations on the public SDK', () => {
    const { client } = createHarness();
    for (const method of [
      'recoverBuildTasks', 'claimBuildTask', 'heartbeatBuildTask', 'completeBuildTask', 'failBuildTask',
      'createChapterBuildTasks', 'createBuildWritingBranch', 'applyBuildWritingPatch',
      'appendBuildTrace', 'appendBuildEvaluation'
    ]) {
      expect(method in client).toBe(false);
    }
  });
});
