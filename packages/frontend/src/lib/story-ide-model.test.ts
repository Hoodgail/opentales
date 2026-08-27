import { describe, expect, it } from 'vitest';
import {
  buildProgress,
  deriveOutlineScenes,
  layoutBuildGraph,
  matchesStoryQuery,
  parseStoryQuery
} from './story-ide-model';

describe('parseStoryQuery', () => {
  it('keeps exact phrases, field filters, and regex syntax distinct', () => {
    const parsed = parseStoryQuery('"Black Key" pov:Mara status:draft regex:/red (moth|butterfly)/i');

    expect(parsed.exact).toEqual(['Black Key']);
    expect(parsed.filters).toEqual({ pov: ['Mara'], status: ['draft'] });
    expect(parsed.regex?.test('the red moth')).toBe(true);
    expect(parsed.invalidRegex).toBeNull();
  });

  it('reports malformed regex without throwing', () => {
    const parsed = parseStoryQuery('regex:/[broken/');
    expect(parsed.regex).toBeNull();
    expect(parsed.invalidRegex).toBeTruthy();
  });

  it('parses filter-only symbol, dotted field, and quoted values', () => {
    const parsed = parseStoryQuery('@character:Mara scene.goal:"escape the prison" location:"North Station"');
    expect(parsed.text).toEqual([]);
    expect(parsed.filters).toEqual({
      entity: ['Mara'],
      'scene.goal': ['escape the prison'],
      location: ['North Station']
    });
  });
});

describe('matchesStoryQuery', () => {
  const record = {
    id: 'scene-12',
    kind: 'scene',
    title: 'The North Station',
    text: 'Mara hides the Black Key under the platform.',
    fields: { pov: 'Mara', status: 'draft', thread: ['main', 'romance'] }
  };

  it('combines prose terms and structured filters', () => {
    expect(matchesStoryQuery(record, parseStoryQuery('key pov:Mara thread:romance'))).toBe(true);
    expect(matchesStoryQuery(record, parseStoryQuery('key pov:Elias'))).toBe(false);
  });

  it('is stable for regexes with a global flag across multiple records', () => {
    const parsed = parseStoryQuery('regex:/Mara/g');
    expect(matchesStoryQuery(record, parsed)).toBe(true);
    expect(matchesStoryQuery({ ...record, id: 'scene-13' }, parsed)).toBe(true);
  });
});

describe('layoutBuildGraph', () => {
  it('places dependencies in earlier layers and produces edges', () => {
    const layout = layoutBuildGraph([
      { id: 'brief' },
      { id: 'cast', dependencies: ['brief'] },
      { id: 'world', dependencies: ['brief'] },
      { id: 'outline', dependencies: ['cast', 'world'] }
    ]);
    const byId = new Map(layout.nodes.map((node) => [node.id, node]));

    expect(byId.get('brief')?.layer).toBe(0);
    expect(byId.get('cast')?.layer).toBe(1);
    expect(byId.get('world')?.layer).toBe(1);
    expect(byId.get('outline')?.layer).toBe(2);
    expect(layout.edges).toHaveLength(4);
    expect(layout.hasCycle).toBe(false);
  });

  it('surfaces cycles without dropping nodes', () => {
    const layout = layoutBuildGraph([
      { id: 'a', dependencies: ['b'] },
      { id: 'b', dependencies: ['a'] }
    ]);
    expect(layout.hasCycle).toBe(true);
    expect(layout.nodes).toHaveLength(2);
  });
});

describe('deriveOutlineScenes', () => {
  it('normalizes scene artifacts into one ordered semantic projection', () => {
    const scenes = deriveOutlineScenes(
      [
        {
          id: 'artifact-2',
          type: 'ScenePlan',
          status: 'accepted',
          data: { title: 'Second turn', chapterId: 'chapter-1', ordinal: 2, tension: 8 }
        },
        {
          id: 'artifact-1',
          type: 'ScenePlan',
          data: {
            title: 'First turn',
            chapterId: 'chapter-1',
            ordinal: 1,
            goal: 'Escape',
            plotThreads: ['main']
          }
        }
      ],
      [{ id: 'chapter-1', number: 1, title: 'Arrival' }]
    );

    expect(scenes.map((scene) => scene.title)).toEqual(['First turn', 'Second turn']);
    expect(scenes[0]).toMatchObject({ chapterTitle: 'Arrival', goal: 'Escape', threads: ['main'] });
    expect(scenes[1].tension).toBe(8);
  });

  it('includes human-authored scene entities when no artifact shadows them', () => {
    const scenes = deriveOutlineScenes([], [
      {
        id: 'chapter-1',
        number: 1,
        title: 'Arrival',
        scenes: [
          {
            id: 'scene-entity-1',
            chapterId: 'chapter-1',
            order: 0,
            title: 'Platform',
            status: 'planned',
            povCharacterId: 'mara',
            locationId: 'north-station',
            storyDate: null,
            storyTime: 'dawn',
            estimatedWordCount: 1200,
            actualWordCount: 0,
            sceneFunction: 'Force the departure',
            goal: 'Board the train',
            obstacle: 'The key is missing',
            stakes: 'Capture',
            conflict: 'Mara versus the guard',
            turn: 'The train leaves early',
            revelation: '',
            outcome: 'Mara jumps aboard',
            emotionalValueShift: 'trapped → committed',
            characterPresentIds: ['mara'],
            plotThreadIds: ['escape'],
            summary: ''
          }
        ]
      }
    ]);

    expect(scenes).toHaveLength(1);
    expect(scenes[0]).toMatchObject({
      id: 'scene-entity-1',
      artifactId: null,
      sceneEntityId: 'scene-entity-1',
      goal: 'Board the train'
    });
  });

  it('uses a build-unit binding to avoid duplicating its materialized scene', () => {
    const scenes = deriveOutlineScenes(
      [{ id: 'plan-1', type: 'scene-plan', title: 'Plan', status: 'accepted', content: { sceneKey: 'scene-key', chapterKey: 'chapter-key', ordinal: 1 }, bindings: [{ unitId: 'unit-1' }] }],
      [{ id: 'chapter-1', number: 1, title: 'Arrival', scenes: [{ id: 'scene-1', chapterId: 'chapter-1', order: 0, title: 'Materialized', status: 'planned', povCharacterId: null, locationId: null, storyDate: null, storyTime: null, estimatedWordCount: null, actualWordCount: 0, sceneFunction: '', goal: '', obstacle: '', stakes: '', conflict: '', turn: '', revelation: '', outcome: '', emotionalValueShift: '', characterPresentIds: [], plotThreadIds: [], summary: '' }] }],
      [{ id: 'unit-1', projectId: 'p', buildRunId: 'b', sourceTaskId: null, planArtifactId: 'plan-1', parentUnitId: null, sourceChapterId: 'chapter-1', sourceSceneId: 'scene-1', writingId: 'w', branchId: 'br', headVersionId: null, kind: 'scene', status: 'accepted', key: 'scene-key', containerKey: 'chapter-key', order: 0, chapterNumber: 1, title: 'Bound scene', povCharacterId: null, locationId: null, storyDate: null, storyTime: null, tension: 0.7, metadata: {}, revision: 1, body: 'Prose', wordCount: 1, invalidatedAt: null, createdAt: '', updatedAt: '' }]
    );
    expect(scenes).toHaveLength(1);
    expect(scenes[0]).toMatchObject({ id: 'unit-1', sceneEntityId: 'scene-1', title: 'Bound scene', tension: 0.7 });
  });

  it('resolves a scene unit through its parent chapter instead of exposing internal keys', () => {
    const baseUnit = {
      projectId: 'p', buildRunId: 'b', sourceTaskId: null, planArtifactId: null, writingId: 'w', branchId: 'br', headVersionId: null,
      status: 'accepted' as const, order: 0, povCharacterId: null, locationId: null, storyDate: null, storyTime: null, tension: null,
      metadata: {}, revision: 1, body: '', wordCount: 0, invalidatedAt: null, createdAt: '', updatedAt: ''
    };
    const scenes = deriveOutlineScenes(
      [
        { id: 'chapter-plan', key: 'e2e-chapter-7', type: 'chapter-brief', title: 'The Living Page', status: 'accepted', content: { chapterKey: 'e2e-chapter-7', number: 7 } },
        { id: 'scene-plan', key: 'e2e-scene-7', type: 'scene-plan', title: 'The Return', status: 'accepted', content: { sceneKey: 'e2e-scene-7', chapterKey: 'e2e-chapter-7', ordinal: 1 }, bindings: [{ unitId: 'scene-unit' }] }
      ],
      [{ id: 'chapter-main', number: 7, title: 'The Living Page' }],
      [
        { ...baseUnit, id: 'chapter-unit', parentUnitId: null, sourceChapterId: 'chapter-main', sourceSceneId: null, writingId: 'chapter-writing', branchId: 'chapter-branch', kind: 'chapter', key: 'e2e-chapter-7', containerKey: '__manuscript__', chapterNumber: 7, title: 'The Living Page' },
        { ...baseUnit, id: 'scene-unit', parentUnitId: 'chapter-unit', sourceChapterId: null, sourceSceneId: null, writingId: 'scene-writing', branchId: 'scene-branch', kind: 'scene', key: 'e2e-scene-7', containerKey: 'e2e-chapter-7', chapterNumber: null, title: 'The Return' }
      ]
    );

    expect(scenes).toHaveLength(1);
    expect(scenes[0]).toMatchObject({ chapterId: 'chapter-main', chapterTitle: 'The Living Page', chapterNumber: 7 });
  });

  it('does not project superseded scene-plan versions', () => {
    const scenes = deriveOutlineScenes([
      { id: 'old', type: 'scene-plan', status: 'superseded', content: { title: 'Old', chapterId: 'chapter-1', ordinal: 1 } },
      { id: 'new', type: 'scene-plan', status: 'accepted', content: { title: 'New', chapterId: 'chapter-1', ordinal: 1 } }
    ], [{ id: 'chapter-1', number: 1, title: 'Arrival' }]);
    expect(scenes.map((scene) => scene.title)).toEqual(['New']);
  });
});

describe('buildProgress', () => {
  it('counts completed and active durable tasks predictably', () => {
    expect(buildProgress([{ status: 'done' }, { status: 'running' }, { status: 'blocked' }])).toBe(50);
  });
});
