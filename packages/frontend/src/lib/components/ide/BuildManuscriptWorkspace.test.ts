import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { BuildCompilation, BuildManuscriptUnit, BuildReview, BuildRun } from '@opentales/sdk';
import BuildManuscriptWorkspace from './BuildManuscriptWorkspace.svelte';
import { storyUi } from '$lib/stores/storyUi.svelte';

afterEach(() => cleanup());

const run = {
  id: 'build-1', projectId: 'project-1', objective: 'Build a novel', brainstorm: 'Idea',
  manifest: { version: '1', sourceBrainstormHash: 'hash', target: {}, artifactSpecs: [], phases: [] },
  autonomyMode: 'plan-review', status: 'paused', currentPhase: 'review', workflowVersion: '1', branchName: 'ai/build-1',
  authorizationScope: { artifactTypes: [], chapterIds: [], sceneIds: [], allowPlanningArtifacts: true, allowCanonWrites: true, allowChapterWrites: true, allowSceneWrites: true, allowDiagnostics: true, expiresAt: null },
  maxTokens: null, tokensUsed: 0, tokensReserved: 0, maxCostMicros: null, costMicrosUsed: 0, costMicrosReserved: 0,
  revision: 2, executionGeneration: 0, lastError: null, authorizedAt: null, pausedAt: null, completedAt: null, failedAt: null, cancelledAt: null,
  createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
  progress: { percent: 50, total: 2, blocked: 0, ready: 0, running: 0, review: 1, done: 1, failed: 0, cancelled: 0 }, tasks: [], latestCheckpoint: null, activeDirective: null
} satisfies BuildRun;

const unit = {
  id: 'unit-1', projectId: 'project-1', buildRunId: 'build-1', sourceTaskId: null, planArtifactId: null,
  parentUnitId: null, sourceChapterId: 'chapter-1', sourceSceneId: null, writingId: 'writing-1', branchId: 'branch-1', headVersionId: 'version-1',
  kind: 'chapter', status: 'review', key: 'chapter-1', containerKey: 'book', order: 0, chapterNumber: 1, title: 'Arrival', povCharacterId: null,
  locationId: null, storyDate: null, storyTime: null, tension: 0.6, metadata: {}, revision: 1, body: 'Original branch prose.', wordCount: 3,
  invalidatedAt: null, createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z'
} satisfies BuildManuscriptUnit;

const compilation = {
  id: 'compilation-1', projectId: 'project-1', buildRunId: 'build-1', checkpointId: null, exportManifestArtifactId: null,
  manifest: {}, chapterDraftArtifactIds: [], totalWordCount: 3, contentHash: 'hash', createdAt: '2026-01-01T00:00:00.000Z',
  units: [{ id: 'compiled-unit-1', unitId: 'unit-1', writingVersionId: 'version-1', order: 0, wordCount: 3, contentHash: 'hash' }]
} satisfies BuildCompilation;

function callbacks() {
  return {
    onPatchUnit: vi.fn(async () => unit),
    onCompile: vi.fn(async () => compilation),
    onCompare: vi.fn(async () => null),
    onCreateReview: vi.fn(async () => null),
    onApprove: vi.fn(async () => null),
    onMerge: vi.fn(async () => null),
    onReject: vi.fn(async () => null)
  };
}

describe('BuildManuscriptWorkspace', () => {
  it('edits real branch-unit prose through the revision-aware callback', async () => {
    const actions = callbacks();
    render(BuildManuscriptWorkspace, { run, units: [unit], compilation, comparison: null, reviews: [], ...actions });

    await fireEvent.click(screen.getByRole('button', { name: 'Write' }));
    const editor = screen.getByLabelText('Arrival branch prose');
    await fireEvent.input(editor, { target: { value: 'Revised branch prose.' } });
    await fireEvent.click(screen.getByRole('button', { name: 'Save branch unit' }));

    expect(actions.onPatchUnit).toHaveBeenCalledWith(unit, expect.objectContaining({ body: 'Revised branch prose.' }));
  });

  it('requires an explicit reason and confirmation before rejecting a review', async () => {
    const review = {
      id: 'review-1', projectId: 'project-1', buildRunId: 'build-1', compilationId: compilation.id, checkpointId: null,
      title: 'Review', message: null, status: 'open', revision: 1, approvedAt: null, mergedAt: null, rejectedAt: null,
      rejectionReason: null, createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z', units: []
    } satisfies BuildReview;
    const actions = callbacks();
    render(BuildManuscriptWorkspace, { run, units: [unit], compilation, comparison: null, reviews: [review], ...actions });
    await fireEvent.click(screen.getByRole('tab', { name: 'Review & merge' }));
    await fireEvent.click(screen.getByRole('button', { name: 'Reject branch' }));
    const confirm = screen.getByRole('button', { name: 'Confirm reject' });
    expect((confirm as HTMLButtonElement).disabled).toBe(true);
    await fireEvent.input(screen.getByLabelText('Reason'), { target: { value: 'The climax contradicts canon.' } });
    await fireEvent.click(confirm);
    expect(actions.onReject).toHaveBeenCalledWith(review, 'The climax contradicts canon.');
  });

  it('reads compiled scene prose once when the chapter compilation rolls up the same scene', () => {
    const scene = {
      ...unit,
      id: 'unit-scene-1',
      parentUnitId: unit.id,
      sourceChapterId: null,
      sourceSceneId: 'scene-1',
      writingId: 'writing-scene-1',
      branchId: 'branch-scene-1',
      headVersionId: 'version-scene-1',
      kind: 'scene',
      key: 'scene-1',
      chapterNumber: null,
      title: 'Threshold',
      body: 'Shared branch prose.'
    } satisfies BuildManuscriptUnit;
    const compiled = {
      ...compilation,
      units: [
        ...compilation.units,
        { id: 'compiled-unit-scene-1', unitId: scene.id, writingVersionId: scene.headVersionId!, order: 1, wordCount: 3, contentHash: 'scene-hash' }
      ]
    } satisfies BuildCompilation;

    render(BuildManuscriptWorkspace, { run, units: [{ ...unit, body: 'Shared branch prose.' }, scene], compilation: compiled, comparison: null, reviews: [], ...callbacks() });

    expect(screen.getAllByText('Shared branch prose.')).toHaveLength(1);
  });

  it('shows a persisted rejection reason and requires a new compilation before opening another review', async () => {
    const review = {
      id: 'review-rejected', projectId: 'project-1', buildRunId: 'build-1', compilationId: compilation.id, checkpointId: null,
      title: 'Rejected review', message: null, status: 'rejected', revision: 1, approvedAt: null, mergedAt: null,
      rejectedAt: '2026-01-02T00:00:00.000Z', rejectionReason: 'The climax contradicts canon.',
      createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-02T00:00:00.000Z', units: []
    } satisfies BuildReview;
    render(BuildManuscriptWorkspace, { run, units: [unit], compilation, comparison: null, reviews: [review], ...callbacks() });

    await fireEvent.click(screen.getByRole('tab', { name: 'Review & merge' }));

    expect(screen.getByText('The climax contradicts canon.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Open review' })).toBeNull();
  });

  it('renders the frozen reviewed prose and compilation totals after reload, not the mutable branch head', async () => {
    const frozenReview = {
      id: 'review-frozen', projectId: 'project-1', buildRunId: 'build-1', compilationId: compilation.id, checkpointId: null,
      title: 'Frozen review', message: 'Inspect the exact reviewed bytes.', status: 'open', revision: 0, approvedAt: null,
      mergedAt: null, rejectedAt: null, rejectionReason: null, createdAt: '2026-01-02T00:00:00.000Z', updatedAt: '2026-01-02T00:00:00.000Z',
      units: [{
        id: 'review-unit-1', unitId: unit.id, action: 'update', targetChapterId: 'chapter-1', targetSceneId: null,
        expectedMainHeadVersionId: 'main-version-1', sourceBuildVersionId: 'version-1', reviewedUnitRevision: 1,
        reviewedUnitSnapshot: { kind: 'chapter', title: 'Arrival at review time', tension: 0.6 }, reviewedUnitSnapshotHash: 'snapshot-hash',
        reviewedBody: 'Frozen reviewed prose.', reviewedWordCount: 3, reviewedContentHash: 'reviewed-content-hash', resultMainVersionId: null, order: 0
      }]
    } satisfies BuildReview;
    const currentUnit = { ...unit, body: 'Branch prose changed after review.', headVersionId: 'version-2', revision: 2 } satisfies BuildManuscriptUnit;
    const currentComparison = {
      projectId: 'project-1', buildRunId: 'build-1', compilationId: compilation.id,
      prose: [{ unitId: unit.id, unitKey: unit.key, kind: 'chapter', title: unit.title, mainRefId: 'chapter-1', mainVersionId: 'main-version-1', buildVersionId: 'version-2', mainBody: 'Main prose.', buildBody: currentUnit.body, wordDelta: 2, changed: true }],
      semantic: { addedCanonFactIds: [], changedEntityStateIds: [], timelineEventIds: [], unresolvedOpenLoopIds: [], activePlotThreadIds: [] }
    } satisfies import('@opentales/sdk').BuildComparison;
    render(BuildManuscriptWorkspace, { run, units: [currentUnit], compilation, comparison: currentComparison, reviews: [frozenReview], ...callbacks() });

    await fireEvent.click(screen.getByRole('tab', { name: 'Review & merge' }));

    expect(screen.getByText('Frozen reviewed prose.')).toBeTruthy();
    expect(screen.queryByText('Branch prose changed after review.')).toBeNull();
    expect(screen.getByText('Main prose.')).toBeTruthy();
    expect(screen.getByText('3', { selector: 'span' })).toBeTruthy();
    expect(screen.getByText('reviewed-content-hash')).toBeTruthy();
  });

  it('opens the requested comparison and exact branch-unit range', async () => {
    render(BuildManuscriptWorkspace, { run, units: [unit], compilation, comparison: { projectId: 'project-1', buildRunId: 'build-1', compilationId: compilation.id, prose: [], semantic: { addedCanonFactIds: [], changedEntityStateIds: [], timelineEventIds: [], unresolvedOpenLoopIds: [], activePlotThreadIds: [] } }, reviews: [], ...callbacks() });

    storyUi.requestBuildSurface('comparison');
    await waitFor(() => expect(screen.getByRole('tab', { name: 'Main ↔ build' }).getAttribute('aria-selected')).toBe('true'));
    storyUi.requestBuildSurface('manuscript', { unitId: unit.id, start: 0, end: 8 });

    const editor = await screen.findByLabelText('Arrival branch prose');
    await waitFor(() => expect(document.activeElement).toBe(editor));
    expect((editor as HTMLTextAreaElement).selectionStart).toBe(0);
    expect((editor as HTMLTextAreaElement).selectionEnd).toBe(8);
  });

  it('traps focus in review confirmation and restores the invoking control', async () => {
    const openReview = {
      id: 'review-focus', projectId: 'project-1', buildRunId: 'build-1', compilationId: compilation.id, checkpointId: null,
      title: 'Review', message: null, status: 'open', revision: 1, approvedAt: null, mergedAt: null, rejectedAt: null,
      rejectionReason: null, createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z', units: []
    } satisfies BuildReview;
    render(BuildManuscriptWorkspace, { run, units: [unit], compilation, comparison: null, reviews: [openReview], ...callbacks() });
    await fireEvent.click(screen.getByRole('tab', { name: 'Review & merge' }));
    const trigger = screen.getByRole('button', { name: 'Approve review' });
    trigger.focus();
    await fireEvent.click(trigger);
    const dialog = screen.getByRole('alertdialog', { name: 'Confirm approve review' });
    await waitFor(() => expect(document.activeElement).toBe(dialog));
    await fireEvent.keyDown(dialog, { key: 'Escape' });
    await waitFor(() => expect(document.activeElement).toBe(trigger));
  });
});
