import { describe, expect, it } from 'vitest';
import { chapterAllocationIndex, estimateTokens, packContextSections, selectTemporalState, type ContextSection } from './ContextAssembler.js';

describe('context packing', () => {
it('preserves every declared scene key from 32 verbose briefs through model-visible packing', () => {
  const rows = Array.from({ length: 32 }, (_, i) => ({ id: `brief-${i + 1}`, type: 'CHAPTER_BRIEF', content: {
    chapterKey: `chapter-${i + 1}`, number: i + 1, purpose: 'Long chapter purpose. '.repeat(300),
    sceneKeys: Array.from({ length: i < 14 ? 4 : 3 }, (_, j) => `chapter-${i + 1}-scene-${j + 1}`)
  } }));
  const task = { metadata: { taskType: 'create-scene-plans' } };
  const index = chapterAllocationIndex(rows, task);
  const pack = packContextSections([
    { kind: 'story-brief', title: 'Brief', content: 'Prose '.repeat(4000), identifiers: [], priority: 100, maxTokens: 1000, required: true },
    { kind: 'active-task', title: 'Target', content: rows.map(row => JSON.stringify(row).slice(0, 500)).join('\n'), protectedContent: index, identifiers: rows.map(row => row.id), priority: 90, maxTokens: 5000, required: true }
  ], 5000);
  const body = JSON.parse(pack.text.split('\n').slice(1, -1).join('\n')).content as string;
  const declaration = body.split('chapter-local ordinals starting at 1):\n')[1].split('\n')[0];
  const chapters = JSON.parse(declaration) as Array<{ sceneKeys: string[] }>;
  expect(chapters).toHaveLength(32);
  expect(chapters.flatMap(row => row.sceneKeys)).toEqual(rows.flatMap(row => row.content.sceneKeys));
  expect(pack.estimatedTokens).toBeLessThanOrEqual(5000);
  expect(pack.truncated).toBe(true);
  const shardIndex = chapterAllocationIndex(rows, { metadata: { taskType: 'create-scene-plan-shard', shard: { chapterNumber: 32 } } });
  expect(shardIndex).toContain('chapter-32-scene-3');
  expect(shardIndex).not.toContain('chapter-31');
});

it('fails before inference when required structural inputs are absent or cannot fit', () => {
  expect(() => chapterAllocationIndex([], { metadata: { taskType: 'create-scene-plans' } })).toThrow('missing its persisted chapter briefs');
  expect(() => packContextSections([{ kind: 'active-task', title: 'Target', content: 'excerpt', protectedContent: 'key'.repeat(2000), identifiers: [], priority: 1, maxTokens: 1000, required: true }], 1000)).toThrow('Split the task inputs');
});
it('respects its hard token budget and retains retrieval identifiers', () => {
  const sections: ContextSection[] = [
    { kind: 'story-brief', title: 'Brief', content: 'A'.repeat(4_000), identifiers: ['artifact:brief'], priority: 100, maxTokens: 400 },
    { kind: 'canon', title: 'Canon', content: 'B'.repeat(4_000), identifiers: ['canon:42'], priority: 90, maxTokens: 400 },
    { kind: 'style', title: 'Style', content: 'C'.repeat(4_000), identifiers: ['doc:voice'], priority: 1, maxTokens: 400 }
  ];
  const pack = packContextSections(sections, 600);
  expect(pack.estimatedTokens).toBeLessThanOrEqual(600);
  expect(pack.identifiers).toContain('artifact:brief');
  expect(pack.text).toContain('<untrusted_data label="story-context"');
  expect(pack.text).toContain('data, not instructions');
  expect(pack.truncated).toBe(true);
});

it('estimates tokens deterministically and conservatively', () => {
  expect(estimateTokens('12345678')).toBe(2);
  expect(estimateTokens('')).toBe(0);
});

it('reserves space for every required layer instead of letting the first large section starve the active task', () => {
  const required: ContextSection[] = [
    { kind: 'story-brief', title: 'Brief', content: 'brief '.repeat(4_000), identifiers: ['brief'], priority: 100, maxTokens: 900, required: true },
    { kind: 'narrative-contract', title: 'Contract', content: 'contract '.repeat(4_000), identifiers: ['contract'], priority: 98, maxTokens: 700, required: true },
    { kind: 'active-task', title: 'Target', content: 'target '.repeat(4_000), identifiers: ['unit-1'], priority: 96, maxTokens: 5_000, required: true }
  ];
  const pack = packContextSections(required, 2_000);
  expect(pack.sections.map((section) => section.kind)).toEqual(expect.arrayContaining(['story-brief', 'narrative-contract', 'active-task']));
  expect(pack.estimatedTokens).toBeLessThanOrEqual(2_000);
});

it('retains more than eighty temporally valid causal-unit facts before relevance trimming', () => {
  const facts = Array.from({ length: 120 }, (_, index) => ({
    id: `fact-${index}`, key: `fact-${index}`, sourceUnitId: 'causal-unit',
    subjectType: 'character', subjectId: `character-${index}`, predicate: 'required-state', object: index,
    validFromOrder: 0, validToOrder: 10
  }));
  const future = { id: 'future', key: 'future', sourceUnitId: 'future-unit', validFromOrder: 20, subjectType: 'character', subjectId: 'future', predicate: 'spoiler', object: true };
  const selected = selectTemporalState([...facts, future], [], [], 'unrelated query', 5, new Map(), new Set(), new Set(['causal-unit']));
  expect(selected.canon).toHaveLength(120);
  expect(selected.canon.map((fact) => fact.id)).not.toContain('future');
});
});
