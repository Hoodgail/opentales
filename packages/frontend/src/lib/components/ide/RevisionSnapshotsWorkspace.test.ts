import { cleanup, fireEvent, render, screen } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Chapter, NamedSnapshot, NamedSnapshotComparison } from '@opentales/sdk';
import RevisionSnapshotsWorkspace from './RevisionSnapshotsWorkspace.svelte';

afterEach(() => cleanup());

const snapshot: NamedSnapshot = {
  id: 'snapshot-1', projectId: 'project-1', createdById: 'user-1', label: 'Before line pass', message: 'Preserve this voice.',
  scope: 'chapter', chapterId: 'chapter-1', sceneId: null, projectDocId: null, writingId: null, buildRunId: null,
  checkpointId: null, compilationId: null, heads: [{ entityType: 'chapter', entityId: 'chapter-1', writingId: 'writing-1', branchId: 'branch-1', versionId: 'version-1', wordCount: 2, bodyHash: 'hash' }],
  structuredState: {}, contentHash: 'abcdef1234567890', sizeBytes: 64, createdAt: '2026-01-01T00:00:00.000Z', deletedAt: null
};
const comparison: NamedSnapshotComparison = {
  leftSnapshotId: snapshot.id, rightSnapshotId: null,
  prose: [{ writingId: 'writing-1', entityType: 'chapter', entityId: 'chapter-1', leftVersionId: 'version-1', rightVersionId: 'version-2', leftWordCount: 2, rightWordCount: 3, wordDelta: 1, changes: [{ kind: 'added', leftStart: 1, rightStart: 1, lines: ['A new line.'] }] }],
  semantic: [{ path: 'chapters.chapter-1.status', before: 'draft', after: 'review' }]
};

describe('RevisionSnapshotsWorkspace', () => {
  it('renders prose + semantic diffs and requires confirmation before restore', async () => {
    const onRestore = vi.fn();
    render(RevisionSnapshotsWorkspace, {
      snapshots: [snapshot], selected: snapshot, comparison, chapters: [] as Chapter[],
      onSelect: vi.fn(), onCreate: vi.fn(), onCompare: vi.fn(), onRestore, onBranch: vi.fn(), onDelete: vi.fn()
    });

    expect(screen.getByText('A new line.')).toBeTruthy();
    expect(screen.getByText('chapters.chapter-1.status')).toBeTruthy();
    const trigger = screen.getByRole('button', { name: 'Restore' });
    await fireEvent.click(trigger);
    expect(onRestore).not.toHaveBeenCalled();
    expect(screen.getByRole('alertdialog', { name: 'Restore this snapshot?' })).toBeTruthy();
    await fireEvent.click(screen.getByRole('button', { name: 'Confirm restore' }));
    expect(onRestore).toHaveBeenCalledWith(snapshot);
  });
});
