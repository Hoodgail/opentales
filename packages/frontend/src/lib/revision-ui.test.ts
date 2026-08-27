import { describe, expect, it } from 'vitest';
import type { NamedSnapshotComparison, WritingAnnotationThread } from '@opentales/sdk';
import { annotationMarkers, currentHeadsFromComparison } from './revision-ui';

describe('revision UI projections', () => {
  it('uses only a working-copy comparison for restore CAS heads', () => {
    const comparison = {
      leftSnapshotId: 'snap-a', rightSnapshotId: null, semantic: [],
      prose: [{ writingId: 'writing-1', entityType: 'chapter', entityId: 'chapter-1', leftVersionId: 'v1', rightVersionId: 'v4', leftWordCount: 2, rightWordCount: 3, wordDelta: 1, changes: [] }]
    } satisfies NamedSnapshotComparison;
    expect(currentHeadsFromComparison(comparison)).toEqual({ 'writing-1': 'v4' });
    expect(currentHeadsFromComparison({ ...comparison, rightSnapshotId: 'snap-b' })).toEqual({});
  });

  it('projects exact persisted offsets into editor markers', () => {
    const thread = {
      id: 'thread-1', projectId: 'project-1', writingId: 'writing-1', branchId: 'branch-1', anchorVersionId: 'version-1',
      authorId: null, resolvedById: null, acceptedVersionId: null, chapterId: 'chapter-1', sceneId: null,
      kind: 'suggestion', status: 'open', revision: 0, start: 4, end: 9, quote: 'amber', anchorHash: 'hash',
      body: 'Use a sharper verb.', suggestedReplacement: 'blazed', resolvedAt: null, createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z', replies: []
    } satisfies WritingAnnotationThread;
    expect(annotationMarkers([thread])).toEqual([{ id: 'thread-1', start: 4, end: 9, kind: 'suggestion', status: 'open', label: 'suggestion: Use a sharper verb.' }]);
  });
});
