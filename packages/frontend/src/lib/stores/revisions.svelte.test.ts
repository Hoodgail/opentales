import { beforeEach, describe, expect, it, vi } from 'vitest';
import { OpenTalesClient, type NamedSnapshot, type NamedSnapshotComparison, type WritingAnnotationThread } from '@opentales/sdk';
import { createRevisionsStore } from './revisions.svelte';

function snapshot(id = 'snapshot-1'): NamedSnapshot {
  return {
    id, projectId: 'project-1', createdById: 'user-1', label: 'Before line pass', message: 'Known good prose.', scope: 'chapter',
    chapterId: 'chapter-1', sceneId: null, projectDocId: null, writingId: null, buildRunId: null, checkpointId: null,
    compilationId: null, heads: [{ entityType: 'chapter', entityId: 'chapter-1', writingId: 'writing-1', branchId: 'branch-1', versionId: 'version-1', wordCount: 3, bodyHash: 'body-hash' }],
    structuredState: {}, contentHash: 'snapshot-hash', sizeBytes: 128, createdAt: '2026-01-01T00:00:00.000Z', deletedAt: null
  };
}

function comparison(): NamedSnapshotComparison {
  return {
    leftSnapshotId: 'snapshot-1', rightSnapshotId: null,
    prose: [{ writingId: 'writing-1', entityType: 'chapter', entityId: 'chapter-1', leftVersionId: 'version-1', rightVersionId: 'version-2', leftWordCount: 3, rightWordCount: 4, wordDelta: 1, changes: [] }],
    semantic: []
  };
}

function thread(overrides: Partial<WritingAnnotationThread> = {}): WritingAnnotationThread {
  return {
    id: 'thread-1', projectId: 'project-1', writingId: 'writing-1', branchId: 'branch-1', anchorVersionId: 'version-2',
    authorId: 'user-1', resolvedById: null, acceptedVersionId: null, chapterId: 'chapter-1', sceneId: null, kind: 'suggestion',
    status: 'open', revision: 0, start: 4, end: 9, quote: 'amber', anchorHash: 'anchor-hash', body: 'Tighten this.',
    suggestedReplacement: 'gold', resolvedAt: null, createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z', replies: [],
    ...overrides
  };
}

describe('revisions store', () => {
  beforeEach(() => vi.restoreAllMocks());

  it('loads details, compares against the working copy, and sends explicit restore CAS heads', async () => {
    const value = snapshot();
    vi.spyOn(OpenTalesClient.prototype, 'listNamedSnapshots').mockResolvedValue([value]);
    vi.spyOn(OpenTalesClient.prototype, 'getNamedSnapshot').mockResolvedValue(value);
    vi.spyOn(OpenTalesClient.prototype, 'compareNamedSnapshots').mockResolvedValue(comparison());
    const restore = vi.spyOn(OpenTalesClient.prototype, 'restoreNamedSnapshot').mockResolvedValue({ snapshotId: value.id, restoredVersionIds: { 'writing-1': 'version-3' }, restoredAt: '2026-01-02T00:00:00.000Z' });
    const store = createRevisionsStore();

    await store.loadSnapshots('project-1');
    await store.selectSnapshot('project-1', value.id);
    await store.restoreSnapshot(value, { 'writing-1': 'version-2' }, { 'scene-1': 4 });

    expect(store.selectedSnapshot?.id).toBe(value.id);
    expect(restore).toHaveBeenCalledWith('project-1', value.id, {
      idempotencyKey: expect.any(String), confirm: true, expectedHeads: { 'writing-1': 'version-2' }, expectedEntityRevisions: { 'scene-1': 4 }
    });
  });

  it('persists exact annotation anchors and applies suggestions with head + thread fencing', async () => {
    vi.spyOn(OpenTalesClient.prototype, 'listWritingAnnotations').mockResolvedValue([]);
    const create = vi.spyOn(OpenTalesClient.prototype, 'createWritingAnnotation').mockResolvedValue(thread());
    const accept = vi.spyOn(OpenTalesClient.prototype, 'acceptWritingSuggestion').mockResolvedValue(thread({ status: 'accepted', revision: 1, acceptedVersionId: 'version-3' }));
    const store = createRevisionsStore();
    await store.loadAnnotations('project-1', { chapterId: 'chapter-1' });

    const created = await store.createAnnotation('project-1', {
      writingId: 'writing-1', branchId: 'branch-1', versionId: 'version-2', chapterId: 'chapter-1', kind: 'suggestion',
      start: 4, end: 9, quote: 'amber', body: 'Tighten this.', suggestedReplacement: 'gold'
    });
    await store.acceptSuggestion(created!, 'version-2');

    expect(create).toHaveBeenCalledWith('project-1', expect.objectContaining({ start: 4, end: 9, quote: 'amber', idempotencyKey: expect.any(String) }));
    expect(accept).toHaveBeenCalledWith('project-1', 'thread-1', {
      idempotencyKey: expect.any(String), confirm: true, expectedRevision: 0, expectedHeadVersionId: 'version-2'
    });
    expect(store.annotations[0].status).toBe('accepted');
  });
});
