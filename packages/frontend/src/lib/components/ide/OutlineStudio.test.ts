import { cleanup, fireEvent, render, screen } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { BuildManuscriptUnit, StoryArtifact } from '@opentales/sdk';
import OutlineStudio from './OutlineStudio.svelte';

afterEach(() => cleanup());

const content = {
  sceneKey: 'arbitrary-scene-Z9', chapterKey: 'arbitrary-chapter-X7', ordinal: 1, title: 'The Toll',
  storyDate: 'Day 1', storyTime: 'midnight', estimatedWordCount: 800,
  function: 'Threshold', goal: 'Cross', obstacle: 'A toll', stakes: 'Memory', conflict: 'Bargain', turn: 'The price changes',
  outcome: 'She pays', emotionalValueShift: 'resolve to grief', tension: 0.7, dependencies: ['prior-scene'], characterRefs: [{ type: 'character', id: 'mara' }],
  characterPresentIds: ['mara'], characterReferencedIds: ['keeper'], plotThreadRefs: [{ type: 'plot-thread', id: 'romance' }], setupPayoffRefs: [{ type: 'setup-payoff', id: 'red-moth' }], revelations: ['The gate remembers'],
  knowledgeDeltas: { mara: ['old truth'] }, objectTransfers: { coin: 'keeper' }, injuryStateChanges: { hand: 'scarred' }, worldRuleRefs: ['memory-toll'], summary: 'Original summary',
  writerNotes: 'Original writer note', aiNotes: 'Original AI note', entryState: { gate: 'closed' }, exitState: { gate: 'open' }
};

const artifact = {
  id: 'artifact-scene', projectId: 'project-1', buildRunId: 'build-1', taskId: null, type: 'scene-plan', key: content.sceneKey,
  title: content.title, version: 1, schemaVersion: 'story-ir-v1', status: 'accepted', content, contentHash: 'hash', replacesArtifactId: null,
  acceptedAt: '2026-01-01T00:00:00.000Z', invalidatedAt: null, createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z', bindings: []
} satisfies StoryArtifact;

function unit(id: string, key: string, title: string, order: number, parentUnitId: string | null, kind: 'chapter' | 'scene'): BuildManuscriptUnit {
  return {
    id, projectId: 'project-1', buildRunId: 'build-1', sourceTaskId: null, planArtifactId: null, parentUnitId,
    sourceChapterId: null, sourceSceneId: null, writingId: `writing-${id}`, branchId: `branch-${id}`, headVersionId: `version-${id}`,
    kind, status: 'drafting', key, containerKey: parentUnitId ?? 'book', order, chapterNumber: kind === 'chapter' ? 1 : null,
    title, povCharacterId: null, locationId: null, storyDate: null, storyTime: null, tension: 0.5, metadata: {}, revision: 1,
    body: `${title} isolated prose.`, wordCount: 3, invalidatedAt: null, createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z'
  };
}

describe('OutlineStudio ScenePlan editing', () => {
  it('round-trips every displayed plan field and artifact status', async () => {
    const onSaveScene = vi.fn(async (_artifact: StoryArtifact, _content: unknown, _status: string) => undefined);
    render(OutlineStudio, { artifacts: [artifact], storyState: null, units: [], onSaveScene });
    await fireEvent.click(screen.getByRole('button', { name: /The Toll/ }));

    await fireEvent.change(screen.getByLabelText('Status'), { target: { value: 'validated' } });
    await fireEvent.input(screen.getByLabelText('Story date'), { target: { value: 'Day 2' } });
    await fireEvent.input(screen.getByLabelText('Story time'), { target: { value: 'dawn' } });
    await fireEvent.input(screen.getByLabelText('Target words'), { target: { value: '1200' } });
    await fireEvent.input(screen.getByLabelText('Characters present (comma separated IDs)'), { target: { value: 'mara, elias' } });
    await fireEvent.input(screen.getByLabelText('Characters referenced (comma separated IDs)'), { target: { value: 'keeper' } });
    await fireEvent.input(screen.getByLabelText('Knowledge gained (JSON)'), { target: { value: '{"mara":["the toll"]}' } });
    await fireEvent.input(screen.getByLabelText('Objects transferred (JSON)'), { target: { value: '{"key":"gate"}' } });
    await fireEvent.input(screen.getByLabelText('Injuries / state changes (JSON)'), { target: { value: '{"hand":"cut"}' } });
    await fireEvent.input(screen.getByLabelText('World rules invoked (JSON)'), { target: { value: '["memory-toll"]' } });
    await fireEvent.input(screen.getByLabelText('Scene summary'), { target: { value: 'Updated summary' } });
    await fireEvent.input(screen.getByLabelText('Writer notes'), { target: { value: 'Updated writer note' } });
    await fireEvent.input(screen.getByLabelText('AI provenance notes'), { target: { value: 'Updated AI note' } });
    await fireEvent.click(screen.getByRole('button', { name: 'Save metadata' }));

    expect(onSaveScene).toHaveBeenCalledTimes(1);
    expect(onSaveScene.mock.calls[0][1]).toEqual(expect.objectContaining({
      storyDate: 'Day 2', storyTime: 'dawn', estimatedWordCount: 1200,
      characterPresentIds: ['mara', 'elias'], characterReferencedIds: ['keeper'],
      characterRefs: [{ type: 'character', id: 'mara', label: 'mara' }, { type: 'character', id: 'elias', label: 'elias' }, { type: 'character', id: 'keeper', label: 'keeper' }],
      plotThreadRefs: [{ type: 'plot-thread', id: 'romance' }], setupPayoffRefs: [{ type: 'setup-payoff', id: 'red-moth' }],
      knowledgeDeltas: { mara: ['the toll'] }, objectTransfers: { key: 'gate' }, injuryStateChanges: { hand: 'cut' },
      worldRuleRefs: ['memory-toll'], summary: 'Updated summary', writerNotes: 'Updated writer note', aiNotes: 'Updated AI note',
      function: 'Threshold', goal: 'Cross', obstacle: 'A toll', stakes: 'Memory', conflict: 'Bargain', turn: 'The price changes',
      revelations: ['The gate remembers'], outcome: 'She pays', emotionalValueShift: 'resolve to grief', tension: 0.7,
      dependencies: ['prior-scene'], entryState: { gate: 'closed' }, exitState: { gate: 'open' }
    }));
    expect(onSaveScene.mock.calls[0][2]).toBe('validated');
  });

  it('opens and reorders build-only scenes through isolated build-unit callbacks', async () => {
    const chapter = unit('chapter-unit', 'chapter-arbitrary', 'Build chapter', 0, null, 'chapter');
    const first = unit('scene-unit-a', 'scene-arbitrary-a', 'First scene', 0, chapter.id, 'scene');
    const second = unit('scene-unit-b', 'scene-arbitrary-b', 'Second scene', 1, chapter.id, 'scene');
    const firstArtifact = { ...artifact, id: 'artifact-a', key: first.key, title: first.title, content: { ...content, sceneKey: first.key, chapterKey: chapter.key, ordinal: 7, title: first.title } } satisfies StoryArtifact;
    const secondArtifact = { ...artifact, id: 'artifact-b', key: second.key, title: second.title, content: { ...content, sceneKey: second.key, chapterKey: chapter.key, ordinal: 11, title: second.title } } satisfies StoryArtifact;
    const onOpenBuildUnit = vi.fn();
    const onReorderBuildUnits = vi.fn(async () => undefined);
    render(OutlineStudio, { artifacts: [firstArtifact, secondArtifact], storyState: null, units: [chapter, first, second], onOpenBuildUnit, onReorderBuildUnits });

    await fireEvent.click(screen.getByRole('button', { name: /First scene/ }));
    await fireEvent.click(screen.getByRole('button', { name: 'Open prose' }));
    expect(onOpenBuildUnit).toHaveBeenCalledWith(first);

    cleanup();
    render(OutlineStudio, { artifacts: [firstArtifact, secondArtifact], storyState: null, units: [chapter, first, second], projection: 'corkboard', onOpenBuildUnit, onReorderBuildUnits });
    const firstCard = screen.getByRole('button', { name: /First scene/ });
    const secondCard = screen.getByRole('button', { name: /Second scene/ });
    await fireEvent.dragStart(secondCard);
    await fireEvent.dragOver(firstCard);
    await fireEvent.drop(firstCard);

    expect(onReorderBuildUnits).toHaveBeenCalledWith(chapter.id, [second.id, first.id]);
  });
});
