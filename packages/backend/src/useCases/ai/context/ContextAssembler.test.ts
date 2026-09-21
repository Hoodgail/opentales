import { describe, expect, it } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import { ContextAssembler, characterIdentityIndex, chapterAllocationIndex, worldLocationIndex, estimateTokens, packContextSections, selectTemporalState, type ContextSection } from './ContextAssembler.js';

describe('context packing', () => {
it('preserves exact geography keys beyond a verbose world-bible excerpt', () => {
  const rows = [{ id: 'world-container', content: { rules: 'World rules. '.repeat(4000), geography: [
    { key: 'geo:diner-interior', name: 'Night Diner Interior', description: 'A long setting description.' },
    { key: 'geo:studio', name: 'Broadcast Studio' }
  ] } }];
  const pack = packContextSections([{ kind: 'world', title: 'World', content: JSON.stringify(rows), protectedContent: worldLocationIndex(rows), required: true, identifiers: ['world-container'], priority: 1, maxTokens: 500 }], 600);
  expect(pack.text).toContain('geo:diner-interior');
  expect(pack.text).toContain('geo:studio');
  expect(pack.text).toContain('artifact ID is not a location');
  expect(pack.truncated).toBe(true);
});
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
  const wrongTotal = rows.map(row => ({ ...row, content: { ...row.content, sceneKeys: row.content.sceneKeys.slice(0, 3) } }));
  expect(() => chapterAllocationIndex(wrongTotal, { metadata: { taskType: 'create-scene-plan-shard', shard: { chapterNumber: 1, total: 110 } } })).toThrow('declare 96 scenes');
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


describe('large model context', () => {
  it('preserves full prose and canon beyond 100k tokens when a 1M window has room', () => {
    const prose = 'Mara crossed the diner, remembering the studio. '.repeat(14000) + 'FINAL-PROSE-MARKER';
    const canon = 'Location detail. '.repeat(3000) + 'EXACT-LOCATION: geo:channel-83-basement-studio';
    const sections: ContextSection[] = [
      { kind: 'recent-causal', title: 'Manuscript', content: prose, identifiers: ['scene-1'], priority: 90, maxTokens: 4000 },
      { kind: 'world', title: 'World', content: canon, identifiers: ['world-1'], priority: 80, maxTokens: 2500 }
    ];
    const full = packContextSections(sections, 850000, true);
    expect(full.estimatedTokens).toBeGreaterThan(100000);
    expect(full.estimatedTokens).toBeLessThanOrEqual(850000);
    expect(full.text).toContain(prose);
    expect(full.text).toContain(canon);
    expect(full.truncated).toBe(false);
    const small = packContextSections(sections, 24000, true);
    expect(small.truncated).toBe(true);
    expect(small.estimatedTokens).toBeLessThanOrEqual(24000);
    expect(small.text).toContain('Some context was omitted');
  });
});

it('preserves character names and aliases even when descriptive prose cannot fit', () => {
  const rows = [{ id: 'character-1', type: 'CHARACTER_BIBLE', content: { characterKey: 'mara', name: 'Mara Chen', aliases: ['Night Cook'], description: 'Long history. '.repeat(10000) } }];
  const pack = packContextSections([{ kind: 'characters', title: 'Characters', content: JSON.stringify(rows), protectedContent: characterIdentityIndex(rows), required: true, priority: 90, maxTokens: 500 } as ContextSection].map(section => ({ ...section, identifiers: ['character-1'] })), 1000, true);
  expect(pack.text).toContain('Mara Chen');
  expect(pack.text).toContain('Night Cook');
  expect(pack.truncated).toBe(true);
});

it('loads all ordinary project notes through the assembler when a large window can hold them', async () => {
  const docs = Array.from({ length: 70 }, (_, i) => ({
    id: `note-${i}`, title: `Notebook ${i}`, bodyWriting: { defaultBranch: { headVersion: { body: 'Established story detail. '.repeat(400) + `END-NOTE-${i}` } } }
  }));
  const prisma = {
    project: { findUnique: async () => null },
    projectDoc: { findMany: async (args: { take?: number }) => docs.slice(0, args.take) },
    scene: { findMany: async () => [] }, character: { findMany: async () => [] },
    location: { findMany: async () => [] }, chapter: { findMany: async () => [] }
  } as unknown as PrismaClient;
  const pack = await new ContextAssembler(prisma).assemble({ projectId: 'project', task: null, fullContext: true, tokenBudget: 850000 });
  expect(pack.estimatedTokens).toBeGreaterThan(100000);
  expect(pack.truncated).toBe(false);
  for (let i = 0; i < 70; i++) expect(pack.text).toContain(`END-NOTE-${i}`);
});
