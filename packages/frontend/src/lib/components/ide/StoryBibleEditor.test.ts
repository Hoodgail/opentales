import { cleanup, fireEvent, render, screen } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CanonFact, StoryStateSnapshot } from '@opentales/sdk';
import StoryBibleEditor from './StoryBibleEditor.svelte';

afterEach(() => cleanup());

function fact(version: number, object: string): CanonFact {
  return {
    id: `fact-${version}`,
    projectId: 'project-1',
    buildRunId: 'build-1',
    sourceArtifactId: 'artifact-1',
    sourceTaskId: null,
    sourceUnitId: 'unit-1',
    supersedesFactId: version > 1 ? `fact-${version - 1}` : null,
    key: 'keeper',
    version,
    isCurrent: version === 2,
    subjectType: 'artifact',
    subjectId: 'living-page',
    predicate: 'chooses',
    object,
    status: 'canonical',
    validFromSceneId: 'scene-1',
    validToSceneId: null,
    validFromOrder: 1,
    validToOrder: null,
    sourceChapterId: 'chapter-1',
    sourceSceneId: 'scene-1',
    sourceSpan: { unitId: 'unit-1', start: 0, end: 11, quote: 'The page chose' },
    confidence: 1,
    invalidatedAt: null,
    createdAt: `2026-01-0${version}T00:00:00.000Z`,
    updatedAt: `2026-01-0${version}T00:00:00.000Z`
  };
}

function snapshot(current: CanonFact): StoryStateSnapshot {
  return {
    projectId: 'project-1',
    buildRunId: 'build-1',
    canonFacts: [current],
    entityStates: [],
    timelineEvents: [],
    openLoops: [],
    setupPayoffs: [],
    plotThreads: []
  };
}

describe('StoryBibleEditor', () => {
  it('selects the newly versioned fact returned by a structured edit', async () => {
    const current = fact(2, 'its keeper');
    const updated = { ...fact(3, 'its chosen keeper'), isCurrent: true };
    const onSelect = vi.fn();
    const onSaveFact = vi.fn(async () => updated);
    render(StoryBibleEditor, {
      artifacts: [],
      snapshot: snapshot(current),
      selection: { section: 'canon', id: current.id },
      onSelect,
      onSaveFact
    });

    await fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
    await fireEvent.input(screen.getByLabelText('Structured value'), { target: { value: '"its chosen keeper"' } });
    await fireEvent.click(screen.getByRole('button', { name: 'Save structured state' }));

    expect(onSaveFact).toHaveBeenCalledWith(current, { object: 'its chosen keeper', status: 'canonical' });
    expect(onSelect).toHaveBeenCalledWith({ section: 'canon', id: updated.id });
  });

  it('selects the new current record returned by a history restore', async () => {
    const previous = fact(1, 'the first keeper');
    const current = fact(2, 'its keeper');
    const restored = { ...fact(3, 'the first keeper'), isCurrent: true };
    const onSelect = vi.fn();
    const onRestore = vi.fn(async () => restored);
    render(StoryBibleEditor, {
      artifacts: [],
      snapshot: snapshot(current),
      selection: { section: 'canon', id: current.id },
      histories: { 'canon-fact:keeper': { entityKind: 'canon-fact', key: 'keeper', versions: [current, previous] } },
      onSelect,
      onRestore
    });

    await fireEvent.click(screen.getByRole('button', { name: 'Restore' }));

    expect(onRestore).toHaveBeenCalledWith('canon-fact', 'keeper', 1);
    expect(onSelect).toHaveBeenCalledWith({ section: 'canon', id: restored.id });
  });
});
