import { cleanup, fireEvent, render, screen } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { WritingAnnotationThread } from '@opentales/sdk';
import EditorAnnotationsSidecar from './EditorAnnotationsSidecar.svelte';

afterEach(() => cleanup());

function suggestion(): WritingAnnotationThread {
  return {
    id: 'thread-1', projectId: 'project-1', writingId: 'writing-1', branchId: 'branch-1', anchorVersionId: 'version-2',
    authorId: 'user-1', resolvedById: null, acceptedVersionId: null, chapterId: 'chapter-1', sceneId: null, kind: 'suggestion',
    status: 'open', revision: 0, start: 4, end: 9, quote: 'amber', anchorHash: 'hash', body: 'Tighten this.',
    suggestedReplacement: 'gold', resolvedAt: null, createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z', replies: []
  };
}

function callbacks() {
  return {
    onClose: vi.fn(), onSelect: vi.fn(), onNavigate: vi.fn(), onCreate: vi.fn(async () => suggestion()),
    onReply: vi.fn(async () => suggestion()), onResolve: vi.fn(async () => suggestion()), onReopen: vi.fn(async () => suggestion()),
    onAccept: vi.fn(async () => ({ ...suggestion(), status: 'accepted' as const })), onReject: vi.fn(async () => suggestion())
  };
}

describe('EditorAnnotationsSidecar', () => {
  it('creates a selection-anchored suggestion with native spellcheck inputs', async () => {
    const actions = callbacks();
    render(EditorAnnotationsSidecar, {
      threads: [], selectedId: null, selection: { start: 4, end: 9, quote: 'amber' }, currentVersionId: 'version-2', ...actions
    });
    await fireEvent.click(screen.getByRole('button', { name: 'Add to selection' }));
    await fireEvent.click(screen.getByRole('button', { name: 'Suggestion' }));
    const annotation = screen.getByPlaceholderText('Explain the proposed edit…');
    expect(annotation.getAttribute('spellcheck')).toBe('true');
    await fireEvent.input(annotation, { target: { value: 'Tighten this.' } });
    const replacement = screen.getByText('Replacement text').parentElement!.querySelector('textarea')!;
    expect(replacement.getAttribute('spellcheck')).toBe('true');
    await fireEvent.input(replacement, { target: { value: 'gold' } });
    await fireEvent.click(screen.getByRole('button', { name: 'Post' }));
    expect(actions.onCreate).toHaveBeenCalledWith('suggestion', 'Tighten this.', 'gold');
  });

  it('navigates highlights and confirms before applying a tracked suggestion', async () => {
    const thread = suggestion();
    const actions = callbacks();
    render(EditorAnnotationsSidecar, {
      threads: [thread], selectedId: thread.id, selection: null, currentVersionId: 'version-2', ...actions
    });
    await fireEvent.click(screen.getByRole('button', { name: 'Accept' }));
    expect(actions.onAccept).not.toHaveBeenCalled();
    expect(screen.getByRole('alertdialog', { name: 'Accept tracked suggestion?' })).toBeTruthy();
    await fireEvent.click(screen.getByRole('button', { name: 'Confirm replacement' }));
    expect(actions.onAccept).toHaveBeenCalledWith(thread);
  });
});
