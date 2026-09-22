import { describe, expect, it } from 'vitest';
import {
  makeCleanDiagnosticsFixture,
  entityState,
  artifact,
  timelineEvent,
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
  it('resolves timeline prerequisites by stable key or current ID while rejecting stale, missing and reversed events', () => {
    const input = makeCleanDiagnosticsFixture();
    const cause = timelineEvent({ id: 'database-event-v2', key: 'event-1', title: 'Diner opens', sortOrder: 1, version: 2 });
    const effect = timelineEvent({ id: 'database-event-2', key: 'event-2', title: 'Gus arrives', sortOrder: 2, dependencyIds: ['event-1'] });
    input.timelineEvents = [{ ...cause, id: 'database-event-v1', version: 1, isCurrent: false }, cause, effect];
    const errors = () => runStoryDiagnostics(input).filter(item => item.code.includes('timeline-prerequisite'));
    expect(errors()).toEqual([]);
    effect.dependencyIds = [cause.id];
    expect(errors()).toEqual([]);
    effect.dependencyIds = ['database-event-v1'];
    expect(errors().map(item => item.code)).toEqual(['missing-timeline-prerequisite']);
    effect.dependencyIds = ['missing-event'];
    expect(errors().map(item => item.code)).toEqual(['missing-timeline-prerequisite']);
    effect.dependencyIds = [cause.key];
    cause.sortOrder = 3;
    expect(errors().map(item => item.code)).toEqual(['timeline-prerequisite-after-event']);
    cause.invalidatedAt = '2026-09-21T00:00:00.000Z';
    expect(errors().map(item => item.code)).toEqual(['missing-timeline-prerequisite']);
  });

  it('returns no diagnostics for a coherent, conservatively annotated snapshot', () => {
    expect(runStoryDiagnostics(makeCleanDiagnosticsFixture())).toEqual([]);
  });

  it('recognizes isolated character-bible references without publishing canonical characters', () => {
    const input = makeCleanDiagnosticsFixture();
    input.characters = [];
    input.artifacts = ['mara', 'elias'].map(name => artifact({ id: `bible-${name}`, key: `character-${name}`, title: name, type: 'character-bible', content: { characterKey: `character-${name}`, name } }));
    input.chapters[0]!.scenes[0]!.povCharacterId = 'bible-mara';
    const unknown = () => runStoryDiagnostics(input).filter(item => item.code === 'unknown-character-reference');
    expect(unknown()).toEqual([]);
    input.chapters[0]!.scenes[0]!.povCharacterId = 'missing-character';
    expect(unknown()).toHaveLength(1);
  });

  it('orders planned causal dependencies by chapter before chapter-local scene ordinal', () => {
    const input = makeCleanDiagnosticsFixture();
    input.chapters = [];
    input.artifacts = [
      artifact({ id: 'c1', key: 'c1', title: 'First', type: 'chapter-brief', content: { chapterKey: 'c1', number: 1 } }),
      artifact({ id: 'c2', key: 'c2', title: 'Second', type: 'chapter-brief', content: { chapterKey: 'c2', number: 2 } }),
      artifact({ id: 's2', key: 's2', title: 'Second', type: 'scene-plan', content: { sceneKey: 's2', chapterKey: 'c2', ordinal: 1, dependencies: ['s1'] } }),
      artifact({ id: 's1', key: 's1', title: 'First', type: 'scene-plan', content: { sceneKey: 's1', chapterKey: 'c1', ordinal: 1, dependencies: [] } })
    ];
    const orderingErrors = () => runStoryDiagnostics(input).filter(item => item.code === 'causal-predecessor-after-scene');
    expect(orderingErrors()).toEqual([]);
    input.artifacts[2]!.content = { sceneKey: 's2', chapterKey: 'c1', ordinal: 1, dependencies: ['s1'] };
    input.artifacts[3]!.content = { sceneKey: 's1', chapterKey: 'c1', ordinal: 2, dependencies: [] };
    expect(orderingErrors()).toHaveLength(1);
    input.artifacts[3]!.content = { sceneKey: 's1', chapterKey: 'c2', ordinal: 1, dependencies: [] };
    expect(orderingErrors()).toHaveLength(1);
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

  it('does not interpret character inventory descriptions as object owner identities', () => {
    const input = makeCleanDiagnosticsFixture();
    input.entityStates = [
      entityState({ id: 'inventory-before', key: 'inventory-before', entityType: 'character', entityId: 'character-mara', stateKey: 'possession', value: 'Carries the spool inside her coat.', validFromOrder: 0, validToOrder: 0 }),
      entityState({ id: 'inventory-after', key: 'inventory-after', entityType: 'character', entityId: 'character-mara', stateKey: 'possession', value: 'Carries the spool and shared logbook.', validFromOrder: 1, validToOrder: null })
    ];
    expect(runStoryDiagnostics(input).map(item => item.code)).not.toContain('object-owner-changed-without-transfer');
    input.entityStates[0]!.validToOrder = null;
    expect(runStoryDiagnostics(input).map(item => item.code)).toContain('entity-state-conflict');
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
