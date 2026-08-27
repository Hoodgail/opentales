import { describe, expect, it } from 'vitest';
import {
  makeCleanDiagnosticsFixture,
  entityState,
  makeFalsePositiveDiagnosticsFixture,
  makeTruePositiveDiagnosticsFixture
} from './__fixtures__/storyDiagnosticsFixtures.js';
import {
  STORY_DIAGNOSTIC_CATEGORIES,
  StoryDiagnosticsEngine,
  createStoryDiagnosticsResult,
  runStoryDiagnostics
} from './index.js';

describe('StoryDiagnosticsEngine', () => {
  it('returns no diagnostics for a coherent, conservatively annotated snapshot', () => {
    expect(runStoryDiagnostics(makeCleanDiagnosticsFixture())).toEqual([]);
  });

  it('detects every semantic and craft family required by the research document', () => {
    const diagnostics = runStoryDiagnostics(makeTruePositiveDiagnosticsFixture());
    const categories = new Set(diagnostics.map((diagnostic) => diagnostic.category));

    for (const category of [
      'continuity',
      'chronology',
      'knowledge',
      'location',
      'world-rule',
      'character',
      'pov',
      'setup-payoff',
      'plot',
      'pacing',
      'repetition',
      'dialogue',
      'style',
      'metadata',
      'publishing'
    ] as const) {
      expect(categories.has(category), `missing diagnostic category ${category}`).toBe(true);
    }

    const codes = new Set(diagnostics.map((diagnostic) => diagnostic.code));
    for (const code of [
      'canon-conflict',
      'impossible-travel',
      'knowledge-used-too-early',
      'simultaneous-incompatible-locations',
      'world-rule-violation',
      'character-behavior-discontinuity',
      'head-hopping',
      'payoff-without-setup',
      'missing-causal-predecessor',
      'long-low-conflict-run',
      'repeated-passage',
      'exposition-heavy-dialogue',
      'configured-banned-phrase',
      'required-scene-metadata-missing',
      'chapter-number-gap'
    ]) {
      expect(codes.has(code), `missing diagnostic code ${code}`).toBe(true);
    }
  });

  it('attaches stable IDs and navigable evidence or related references to every finding', () => {
    const input = makeTruePositiveDiagnosticsFixture();
    const first = runStoryDiagnostics(input);
    const second = runStoryDiagnostics(input);

    expect(second).toEqual(first);
    expect(new Set(first.map((diagnostic) => diagnostic.id)).size).toBe(first.length);
    for (const diagnostic of first) {
      expect(diagnostic.id).toMatch(/^[a-f0-9]{24}$/);
      expect(diagnostic.evidence.length + diagnostic.relatedRefs.length).toBeGreaterThan(0);
      expect(diagnostic.suggestedResolution).not.toBeNull();
      for (const span of diagnostic.evidence) {
        expect(
          Boolean(
            span.chapterId ||
              span.sceneId ||
              span.artifactId ||
              span.quote ||
              span.start !== undefined ||
              span.end !== undefined
          )
        ).toBe(true);
      }
    }
  });

  it('avoids synthetic false positives for version history, intentional flashbacks, valid travel, canon intervals, and tracked knowledge', () => {
    expect(runStoryDiagnostics(makeFalsePositiveDiagnosticsFixture())).toEqual([]);
  });

  it('persists point-in-story entity state and flags a post-death appearance without flagging the death scene itself', () => {
    const input = makeCleanDiagnosticsFixture();
    input.entityStates = [
      entityState({
        id: 'state-mara-dead',
        key: 'mara-life',
        stateKey: 'life-status',
        value: 'dead',
        storyOrder: 0,
        validFromSceneId: 'scene-1',
        sourceSpan: { chapterId: 'chapter-1', sceneId: 'scene-1', quote: 'her final breath' }
      })
    ];

    const findings = runStoryDiagnostics(input).filter(
      (diagnostic) => diagnostic.code === 'dead-character-appears'
    );
    expect(findings).toHaveLength(1);
    expect(findings[0].evidence.some((span) => span.sceneId === 'scene-2')).toBe(true);
  });

  it('requires an explicit object transfer when sequential ownership states change', () => {
    const input = makeCleanDiagnosticsFixture();
    input.entityStates = [
      entityState({
        id: 'state-key-elias',
        key: 'key-owner-elias',
        entityType: 'object',
        entityId: 'black-key',
        stateKey: 'owner',
        value: 'character-elias',
        storyOrder: 0,
        sourceSpan: { chapterId: 'chapter-1', sceneId: 'scene-1', quote: 'Elias held the key.' }
      }),
      entityState({
        id: 'state-key-mara',
        key: 'key-owner-mara',
        entityType: 'object',
        entityId: 'black-key',
        stateKey: 'owner',
        value: 'character-mara',
        storyOrder: 1,
        sourceSpan: { chapterId: 'chapter-2', sceneId: 'scene-2', quote: 'Mara held the key.' }
      })
    ];

    expect(runStoryDiagnostics(input).map((diagnostic) => diagnostic.code)).toContain(
      'object-owner-changed-without-transfer'
    );

    input.chapters[1].scenes[0].objectTransfers = [
      {
        objectId: 'black-key',
        fromCharacterId: 'character-elias',
        toCharacterId: 'character-mara'
      }
    ];
    expect(runStoryDiagnostics(input).map((diagnostic) => diagnostic.code)).not.toContain(
      'object-owner-changed-without-transfer'
    );
  });

  it('honors the pantser opt-out even when project metadata requirements are configured', () => {
    const input = makeFalsePositiveDiagnosticsFixture();
    const codes = runStoryDiagnostics(input).map((diagnostic) => diagnostic.code);
    expect(codes).not.toContain('required-scene-metadata-missing');

    input.metadata = { ...input.metadata, enforceOptionalSceneMetadata: true };
    expect(runStoryDiagnostics(input).map((diagnostic) => diagnostic.code)).toContain(
      'required-scene-metadata-missing'
    );
  });

  it('supports category allowlists and per-code opt-outs without weakening unrelated diagnostics', () => {
    const input = makeTruePositiveDiagnosticsFixture();
    input.metadata = {
      ...input.metadata,
      enabledCategories: ['continuity', 'chronology'],
      disabledRuleCodes: ['canon-conflict']
    };
    const diagnostics = runStoryDiagnostics(input);

    expect(diagnostics.length).toBeGreaterThan(0);
    expect(diagnostics.every((value) => ['continuity', 'chronology'].includes(value.category))).toBe(true);
    expect(diagnostics.map((value) => value.code)).not.toContain('canon-conflict');
    expect(diagnostics.map((value) => value.code)).toContain('impossible-travel');
  });

  it('returns an SDK-compatible result envelope with a reproducible caller timestamp', () => {
    const input = makeCleanDiagnosticsFixture();
    input.metadata = { generatedAt: '2030-01-02T03:04:05.000Z' };
    const result = createStoryDiagnosticsResult(input, {
      now: () => new Date('2040-01-01T00:00:00.000Z')
    });

    expect(result).toEqual({
      projectId: input.projectId,
      buildRunId: input.buildRunId,
      generatedAt: '2030-01-02T03:04:05.000Z',
      diagnostics: []
    });
  });

  it('uses the injected clock when the snapshot does not provide generatedAt', () => {
    const input = makeCleanDiagnosticsFixture();
    const engine = new StoryDiagnosticsEngine({
      now: () => new Date('2042-02-03T04:05:06.000Z')
    });
    expect(engine.run(input).generatedAt).toBe('2042-02-03T04:05:06.000Z');
  });

  it('keeps the exported category catalog unique and complete', () => {
    expect(new Set(STORY_DIAGNOSTIC_CATEGORIES).size).toBe(STORY_DIAGNOSTIC_CATEGORIES.length);
    expect(STORY_DIAGNOSTIC_CATEGORIES).toEqual(
      expect.arrayContaining([
        'continuity',
        'chronology',
        'knowledge',
        'location',
        'world-rule',
        'character',
        'pov',
        'setup-payoff',
        'plot',
        'pacing',
        'repetition',
        'dialogue',
        'style',
        'metadata',
        'publishing'
      ])
    );
  });

  it('rejects a malformed runtime snapshot instead of emitting misleading partial diagnostics', () => {
    const input = makeCleanDiagnosticsFixture();
    expect(() => runStoryDiagnostics({ ...input, chapters: null } as never)).toThrow(
      'Story diagnostics chapters must be an array'
    );
  });
});
