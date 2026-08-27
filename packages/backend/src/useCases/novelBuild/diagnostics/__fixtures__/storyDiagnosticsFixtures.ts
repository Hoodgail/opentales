import type {
  CanonFact,
  EntityState,
  OpenLoop,
  PlotThread,
  SetupPayoffLink,
  StoryArtifact,
  TimelineEvent
} from '@opentales/sdk';
import type {
  DiagnosticChapterSnapshot,
  DiagnosticCharacterSnapshot,
  DiagnosticLocationSnapshot,
  DiagnosticSceneSnapshot,
  StoryDiagnosticsInput
} from '../types.js';

const NOW = '2026-08-25T12:00:00.000Z';
const PROJECT_ID = 'project-diagnostics';
const BUILD_RUN_ID = 'build-diagnostics';

export function makeCleanDiagnosticsFixture(): StoryDiagnosticsInput {
  const firstScene = scene({
    id: 'scene-1',
    chapterId: 'chapter-1',
    order: 1,
    title: 'The Gate',
    povCharacterId: 'character-mara',
    locationId: 'location-north',
    storyDate: '2026-01-01',
    storyTime: '08:00',
    characterPresentIds: ['character-mara'],
    sceneFunction: 'Mara enters the city.',
    goal: 'Reach the archive.',
    obstacle: 'The gate guard challenges her papers.',
    stakes: 'She may lose the only map.',
    conflict: 'Mara bargains with the guard.',
    turn: 'The guard recognizes her seal.',
    outcome: 'She enters under suspicion.',
    emotionalValueShift: 'confidence to unease',
    content:
      "Mara's gray eyes narrowed at the gate. She showed the guard her papers and waited. The seal bought her passage, but his stare followed her into the city."
  });
  const secondScene = scene({
    id: 'scene-2',
    chapterId: 'chapter-2',
    order: 1,
    title: 'The Archive',
    povCharacterId: 'character-mara',
    locationId: 'location-archive',
    storyDate: '2026-01-01',
    storyTime: '12:00',
    characterPresentIds: ['character-mara', 'character-elias'],
    sceneFunction: 'Mara finds the forbidden ledger.',
    goal: 'Confirm the erased road existed.',
    obstacle: 'Elias refuses access to the sealed shelves.',
    stakes: 'Without proof, Mara remains disgraced.',
    conflict: 'They negotiate the price of access.',
    turn: 'Elias reveals he kept a copied index.',
    revelation: 'The road was removed from every official map.',
    outcome: 'They agree to investigate together.',
    emotionalValueShift: 'distrust to wary alliance',
    content:
      'Mara crossed the archive at noon. Elias barred the sealed shelves, so she offered him the map. He studied the watermark, reconsidered, and produced a copied index.'
  });
  return snapshot({
    chapters: [
      chapter({ id: 'chapter-1', number: 1, title: 'Arrival', scenes: [firstScene] }),
      chapter({ id: 'chapter-2', number: 2, title: 'Records', scenes: [secondScene] })
    ],
    characters: [character('character-mara', 'Mara'), character('character-elias', 'Elias')],
    locations: [location('location-north', 'North Gate'), location('location-archive', 'Archive')]
  });
}

export function makeTruePositiveDiagnosticsFixture(): StoryDiagnosticsInput {
  const repeated =
    'The black key clicked against the glass compass while the red moth circled the silent lantern.';
  const presentTense =
    'She runs to the door and sees the fire. She hears the bells and feels the floor move. She knows the guard waits. She turns, reaches, opens, closes, and says the forbidden phrase is very unique.';
  const exposition = `As you already know, ${Array.from(
    { length: 84 },
    (_, index) => `detail${index + 1}`
  ).join(' ')}.`;

  const scenes = [
    scene({
      id: 'scene-1',
      chapterId: 'chapter-1',
      order: 1,
      title: 'Impossible Knowledge',
      povCharacterId: 'character-mara',
      locationId: 'location-north',
      storyDate: '2026-01-02',
      storyTime: '08:00',
      characterPresentIds: ['character-mara', 'character-elias'],
      sceneFunction: 'Mara begins the pursuit.',
      goal: 'Catch the courier.',
      content: `${repeated}\n\n${presentTense}`,
      dependencyIds: ['missing-scene'],
      knowledgeClaims: [
        {
          characterId: 'character-mara',
          knowledgeKey: 'bridge-is-alive',
          quote: 'She knows the guard waits.'
        }
      ],
      interiorityCharacterIds: ['character-mara', 'character-elias'],
      characterSignals: [
        {
          characterId: 'character-mara',
          kind: 'behavior',
          value: 'She abandons the map without pressure.',
          contradicts: ['protects-the-map'],
          quote: 'She abandons the map without pressure.'
        }
      ],
      worldRuleRefs: ['memory-price'],
      worldRuleViolations: [
        {
          ruleKey: 'memory-price',
          explanation: 'The map changes without taking a memory.',
          quote: 'the forbidden phrase is very unique'
        }
      ]
    }),
    scene({
      id: 'scene-2',
      chapterId: 'chapter-1',
      order: 2,
      title: 'Too Far Too Fast',
      povCharacterId: 'character-mara',
      locationId: 'location-archive',
      storyDate: '2026-01-02',
      storyTime: '08:30',
      characterPresentIds: ['character-mara'],
      sceneFunction: 'Mara searches the archive.',
      goal: 'Find the ledger.',
      revelation: 'The council burned the original ledger.',
      content: presentTense
    }),
    scene({
      id: 'scene-3',
      chapterId: 'chapter-1',
      order: 3,
      title: 'The Lecture',
      povCharacterId: 'character-mara',
      locationId: 'location-archive',
      storyDate: '2026-01-01',
      storyTime: '09:00',
      characterPresentIds: ['character-mara', 'character-elias'],
      sceneFunction: 'Elias reveals the rules.',
      goal: 'Win Mara over.',
      revelation: 'The bridge consumes memories.',
      content: `${repeated}\n\n“${exposition}” Elias said.`,
      dialogueTurns: [{ speakerId: 'character-elias', text: exposition, quote: exposition }]
    }),
    scene({
      id: 'scene-4',
      chapterId: 'chapter-3',
      order: 1,
      title: 'Late Disclosure',
      povCharacterId: 'character-mara',
      locationId: 'location-north',
      storyDate: '2026-01-03',
      storyTime: '08:00',
      characterPresentIds: ['character-mara'],
      sceneFunction: 'Mara finally learns the secret.',
      goal: 'Question the witness.',
      revelation: 'The bridge is alive.',
      content: presentTense,
      normalizedKnowledgeDeltas: [
        { characterId: 'character-mara', knowledgeKey: 'bridge-is-alive', operation: 'gain' }
      ]
    }),
    scene({
      id: 'scene-5',
      chapterId: 'chapter-3',
      order: 2,
      title: 'Blank Card',
      povCharacterId: null,
      locationId: null,
      storyDate: null,
      storyTime: null,
      sceneFunction: '',
      goal: '',
      content: 'A brief unplanned transition remains in the publication branch.'
    }),
    scene({
      id: 'scene-6',
      chapterId: 'chapter-3',
      order: 3,
      title: 'Two Places',
      povCharacterId: 'character-elias',
      locationId: 'location-vault',
      storyDate: '2026-01-02',
      storyTime: '08:00',
      characterPresentIds: ['character-elias', 'character-unknown'],
      sceneFunction: 'Mara reaches the vault.',
      goal: 'Open the vault.',
      content: `${repeated}\n\nMara's blue eyes reflected the vault light.`
    })
  ];

  const artifacts = [
    narrativeContractArtifact(),
    worldBibleArtifact(),
    characterBibleArtifact([]),
    scenePlanArtifact(),
    beatArtifact('beat-1', 'beat-one'),
    beatArtifact('beat-2', 'beat-two'),
    artifact({
      id: 'artifact-invalid',
      key: 'invalid-brief',
      title: 'Invalid brief',
      type: 'story-brief',
      content: { premise: '' } as StoryArtifact['content']
    })
  ];

  return snapshot({
    chapters: [
      chapter({ id: 'chapter-1', number: 1, title: 'Opening', status: 'draft', scenes: scenes.slice(0, 3) }),
      chapter({ id: 'chapter-3', number: 3, title: 'Ending', status: 'review', scenes: scenes.slice(3) })
    ],
    characters: [character('character-mara', 'Mara'), character('character-elias', 'Elias')],
    locations: [
      location('location-north', 'North Gate'),
      location('location-archive', 'Archive'),
      location('location-vault', 'Vault')
    ],
    artifacts,
    canonFacts: [
      canonFact({
        id: 'fact-eyes-gray',
        key: 'mara-eyes-gray',
        subjectType: 'character',
        subjectId: 'character-mara',
        predicate: 'eye-color',
        object: 'gray',
        sourceSceneId: 'scene-1',
        sourceSpan: { chapterId: 'chapter-1', sceneId: 'scene-1', quote: "Mara's gray eyes" }
      }),
      canonFact({
        id: 'fact-eyes-blue',
        key: 'mara-eyes-blue',
        subjectType: 'character',
        subjectId: 'character-mara',
        predicate: 'eye-color',
        object: 'blue',
        sourceSceneId: 'scene-6',
        sourceSpan: { chapterId: 'chapter-3', sceneId: 'scene-6', quote: "Mara's blue eyes" }
      })
    ],
    timelineEvents: [
      timelineEvent({ id: 'event-effect', key: 'effect', title: 'Effect', sortOrder: 1, dependencyIds: ['event-cause'], sceneId: 'scene-1' }),
      timelineEvent({ id: 'event-cause', key: 'cause', title: 'Cause', sortOrder: 2, sceneId: 'scene-2' })
    ],
    setupPayoffs: [
      setupPayoff({
        id: 'setup-red-moth',
        key: 'red-moth',
        title: 'Red moth',
        status: 'paid-off',
        setupSceneId: null,
        payoffSceneId: 'scene-6'
      })
    ],
    openLoops: [
      openLoop({
        id: 'loop-bridge',
        key: 'bridge-question',
        title: 'Who built the bridge?',
        kind: 'mystery',
        status: 'open',
        introducedSceneId: 'scene-1'
      })
    ],
    plotThreads: [
      plotThread({
        id: 'thread-main',
        key: 'main',
        title: 'Save the maps',
        kind: 'main',
        status: 'active',
        sceneIds: ['scene-1']
      })
    ],
    projectRules: {
      metadata: {
        requirePov: true,
        requireLocation: true,
        requireStoryDate: true,
        requireStoryTime: true,
        requireSceneFunction: true,
        requireGoal: true
      },
      pov: { mode: 'single', person: 'third', tense: 'past', narrativeDistance: 'close' },
      travelTimes: [
        {
          fromLocationId: 'location-north',
          toLocationId: 'location-archive',
          minimumMinutes: 120,
          bidirectional: true
        }
      ],
      pacing: { lowConflictRunLength: 3, revelationClusterLength: 3 },
      repetition: {
        minimumRepeatedPassageWords: 10,
        minimumPhraseWords: 8,
        minimumPhraseOccurrences: 3
      },
      dialogue: { expositionTurnWords: 50 },
      style: { bannedPhrases: ['very unique'] },
      plot: { requireSceneDependencies: true, dormantThreadSceneCount: 3 },
      publishing: {
        enabled: true,
        requireSequentialChapterNumbers: true,
        requireFinalChapterStatus: true,
        targetWordCountMin: 2_000
      }
    },
    metadata: {
      planningMode: 'planner',
      enforceOptionalSceneMetadata: true,
      manuscriptComplete: true,
      phase: 'publishing',
      generatedAt: NOW
    }
  });
}

export function makeFalsePositiveDiagnosticsFixture(): StoryDiagnosticsInput {
  const repeated =
    'By the old road and the cold river, the map remembers what every traveler willingly forgets.';
  const first = scene({
    id: 'scene-1',
    chapterId: 'chapter-1',
    order: 1,
    title: 'Present Day',
    povCharacterId: 'character-mara',
    locationId: 'location-north',
    storyDate: '2026-01-02',
    storyTime: '12:00',
    characterPresentIds: ['character-mara'],
    worldRuleRefs: ['memory-price'],
    knowledgeClaims: [
      { characterId: 'character-mara', knowledgeKey: 'bridge-is-alive', quote: 'the bridge is alive' }
    ],
    content: `${repeated}\n\nMara walked north. She saw the bridge and knew it was alive. She kept moving.`
  });
  const flashback = scene({
    id: 'scene-2',
    chapterId: 'chapter-2',
    order: 1,
    title: 'Marked Flashback',
    povCharacterId: 'character-mara',
    locationId: 'location-archive',
    storyDate: '2026-01-01',
    storyTime: '08:00',
    chronologyMode: 'flashback',
    characterPresentIds: ['character-mara'],
    worldRuleRefs: ['memory-price'],
    content: `${repeated}\n\nMara entered the archive. She found the ledger and carried it home.`
  });
  const input = snapshot({
    chapters: [
      chapter({ id: 'chapter-1', number: 1, title: 'Now', status: 'final', scenes: [first] }),
      chapter({ id: 'chapter-2', number: 2, title: 'Before', status: 'final', scenes: [flashback] })
    ],
    characters: [character('character-mara', 'Mara')],
    locations: [location('location-north', 'North Gate'), location('location-archive', 'Archive')],
    artifacts: [narrativeContractArtifact(), worldBibleArtifact(), characterBibleArtifact(['bridge-is-alive'])],
    canonFacts: [
      canonFact({
        id: 'fact-gray-old',
        key: 'eyes-old',
        predicate: 'eye-color',
        object: 'gray',
        validFromOrder: 0,
        validToOrder: 0,
        sourceSceneId: 'scene-1'
      }),
      canonFact({
        id: 'fact-blue-new',
        key: 'eyes-new',
        predicate: 'eye-color',
        object: 'blue',
        validFromOrder: 1,
        validToOrder: null,
        sourceSceneId: 'scene-2'
      }),
      canonFact({
        id: 'fact-superseded',
        key: 'eyes-superseded',
        predicate: 'eye-color',
        object: 'violet',
        isCurrent: false,
        sourceSceneId: 'scene-1'
      })
    ],
    timelineEvents: [
      timelineEvent({ id: 'event-cause', key: 'cause', title: 'Cause', sortOrder: 1, sceneId: 'scene-2' }),
      timelineEvent({ id: 'event-effect', key: 'effect', title: 'Effect', sortOrder: 2, dependencyIds: ['event-cause'], sceneId: 'scene-1' })
    ],
    setupPayoffs: [
      setupPayoff({
        id: 'setup-map',
        key: 'map',
        title: 'Living map',
        status: 'paid-off',
        setupSceneId: 'scene-1',
        payoffSceneId: 'scene-2'
      })
    ],
    openLoops: [
      openLoop({
        id: 'loop-map',
        key: 'map-loop',
        title: 'What does the map cost?',
        status: 'resolved',
        introducedSceneId: 'scene-1',
        resolvedSceneId: 'scene-2'
      })
    ],
    plotThreads: [
      plotThread({
        id: 'thread-main',
        key: 'main',
        title: 'Map mystery',
        kind: 'main',
        status: 'resolved',
        sceneIds: ['scene-1', 'scene-2'],
        introducedSceneId: 'scene-1',
        resolvedSceneId: 'scene-2'
      })
    ],
    projectRules: {
      metadata: {
        requireSceneFunction: true,
        requireGoal: true,
        requireConflict: true,
        requireOutcome: true
      },
      travelTimes: [
        {
          fromLocationId: 'location-archive',
          toLocationId: 'location-north',
          minimumMinutes: 120,
          bidirectional: true
        }
      ],
      repetition: { allowedPhrases: [repeated] }
    },
    metadata: {
      planningMode: 'pantser',
      enforceOptionalSceneMetadata: false,
      generatedAt: NOW
    }
  });
  return input;
}

function snapshot(overrides: Partial<StoryDiagnosticsInput>): StoryDiagnosticsInput {
  return {
    projectId: PROJECT_ID,
    buildRunId: BUILD_RUN_ID,
    buildRevision: 1,
    chapters: [],
    characters: [],
    locations: [],
    artifacts: [],
    canonFacts: [],
    entityStates: [],
    timelineEvents: [],
    openLoops: [],
    setupPayoffs: [],
    plotThreads: [],
    ...overrides
  };
}

function chapter(
  overrides: Pick<DiagnosticChapterSnapshot, 'id' | 'number' | 'title' | 'scenes'> &
    Partial<DiagnosticChapterSnapshot>
): DiagnosticChapterSnapshot {
  const { id, number, title, scenes, ...rest } = overrides;
  const content = rest.content ?? scenes.map((value) => value.content).join('\n\n');
  return {
    status: 'in-progress',
    summary: '',
    publishedAt: null,
    ...rest,
    id,
    number,
    title,
    content,
    scenes,
    wordCount: rest.wordCount ?? words(content)
  };
}

function scene(overrides: Partial<DiagnosticSceneSnapshot> & Pick<DiagnosticSceneSnapshot, 'id' | 'chapterId' | 'order' | 'title'>): DiagnosticSceneSnapshot {
  const { id, chapterId, order, title, content = '', actualWordCount, ...rest } = overrides;
  return {
    status: 'draft',
    povCharacterId: null,
    locationId: null,
    storyDate: null,
    storyTime: null,
    estimatedWordCount: null,
    sceneFunction: '',
    goal: '',
    obstacle: '',
    stakes: '',
    conflict: '',
    turn: '',
    revelation: '',
    outcome: '',
    emotionalValueShift: '',
    tension: null,
    characterPresentIds: [],
    characterReferencedIds: [],
    plotThreadIds: [],
    setupPayoffIds: [],
    knowledgeDeltas: null,
    objectTransfers: null,
    injuryStateChanges: null,
    worldRuleRefs: null,
    entryState: null,
    exitState: null,
    summary: '',
    writerNotes: '',
    aiNotes: '',
    createdAt: NOW,
    updatedAt: NOW,
    revision: 1,
    ...rest,
    id,
    chapterId,
    order,
    title,
    content,
    actualWordCount: actualWordCount ?? words(content)
  };
}

function character(id: string, name: string): DiagnosticCharacterSnapshot {
  return {
    id,
    key: id,
    name,
    role: '',
    age: '',
    occupation: '',
    description: '',
    appearance: '',
    motivation: '',
    arc: '',
    traits: [],
    aliases: [],
    relationships: [],
    assets: []
  };
}

function location(id: string, name: string): DiagnosticLocationSnapshot {
  return {
    id,
    key: id,
    name,
    aliases: [],
    type: '',
    description: '',
    atmosphere: '',
    significance: '',
    sensoryDetails: ''
  };
}

function artifact(
  overrides: Pick<StoryArtifact, 'id' | 'key' | 'title' | 'type' | 'content'> & Partial<StoryArtifact>
): StoryArtifact {
  const { id, key, title, type, content, ...rest } = overrides;
  return {
    projectId: PROJECT_ID,
    buildRunId: BUILD_RUN_ID,
    taskId: null,
    version: 1,
    schemaVersion: 'story-ir-v1',
    status: 'accepted',
    contentHash: `hash-${id}`,
    replacesArtifactId: null,
    acceptedAt: NOW,
    invalidatedAt: null,
    createdAt: NOW,
    updatedAt: NOW,
    ...rest,
    id,
    type,
    key,
    title,
    content
  };
}

function narrativeContractArtifact(): StoryArtifact {
  return artifact({
    id: 'artifact-contract',
    key: 'narrative-contract',
    title: 'Narrative Contract',
    type: 'narrative-contract',
    content: {
      pov: 'close third person',
      tense: 'past',
      narrativeDistance: 'close',
      sentenceRhythm: 'varied',
      diction: 'concrete',
      metaphorDensity: 'low',
      interiority: 'high',
      dialogueCompression: 'high',
      expositionStyle: 'embedded in action',
      descriptionDensity: 'medium',
      contentConstraints: []
    }
  });
}

function worldBibleArtifact(): StoryArtifact {
  return artifact({
    id: 'artifact-world',
    key: 'world',
    title: 'World Bible',
    type: 'world-bible',
    content: {
      rules: [{ key: 'memory-price', statement: 'Every map alteration consumes one living memory.' }],
      institutions: [],
      geography: [],
      factions: [],
      terminology: [],
      technologyOrMagicConstraints: []
    }
  });
}

function characterBibleArtifact(knowledge: string[]): StoryArtifact {
  return artifact({
    id: 'artifact-character-mara',
    key: 'character-mara',
    title: 'Mara',
    type: 'character-bible',
    content: {
      characterKey: 'character-mara',
      aliases: [],
      name: 'Mara',
      wants: ['restore her reputation'],
      needs: ['trust another person'],
      contradictions: ['protects maps but destroys evidence'],
      voice: 'precise and guarded',
      knowledge,
      secrets: [],
      relationships: []
    }
  });
}

function scenePlanArtifact(): StoryArtifact {
  return artifact({
    id: 'artifact-scene-plan',
    key: 'scene-plan-orphan',
    title: 'Orphan scene plan',
    type: 'scene-plan',
    content: {
      sceneKey: 'planned-orphan',
      chapterKey: 'missing-chapter',
      ordinal: 99,
      title: 'Orphan scene',
      function: 'Complicate the pursuit.',
      goal: 'Escape.',
      obstacle: 'Locked gate.',
      stakes: 'Capture.',
      conflict: 'Guard pursuit.',
      turn: 'The gate opens.',
      outcome: 'Escape.',
      emotionalValueShift: 'fear to relief',
      tension: 0.7,
      dependencies: ['missing-plan'],
      characterRefs: [],
      plotThreadRefs: [],
      setupPayoffRefs: [],
      revelations: [],
      entryState: {},
      exitState: {}
    }
  });
}

function beatArtifact(id: string, key: string): StoryArtifact {
  return artifact({
    id,
    key,
    title: key,
    type: 'beat',
    content: {
      beatKey: key,
      title: key,
      function: 'The protagonist loses access to the archive.',
      causeKeys: ['gate-closes'],
      consequenceKeys: ['seek-smuggler'],
      threadRefs: [],
      expectedPayoff: 'Mara finds another route.'
    }
  });
}

function canonFact(overrides: Partial<CanonFact>): CanonFact {
  return {
    id: 'fact',
    projectId: PROJECT_ID,
    buildRunId: BUILD_RUN_ID,
    sourceArtifactId: null,
    sourceTaskId: null,
    sourceUnitId: null,
    supersedesFactId: null,
    key: 'fact',
    version: 1,
    isCurrent: true,
    subjectType: 'character',
    subjectId: 'character-mara',
    predicate: 'state',
    object: 'value',
    status: 'canonical',
    validFromSceneId: null,
    validToSceneId: null,
    validFromOrder: null,
    validToOrder: null,
    sourceChapterId: null,
    sourceSceneId: null,
    sourceSpan: null,
    confidence: 1,
    invalidatedAt: null,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides
  };
}

export function entityState(overrides: Partial<EntityState>): EntityState {
  return {
    id: 'state',
    projectId: PROJECT_ID,
    buildRunId: BUILD_RUN_ID,
    sourceArtifactId: null,
    sourceTaskId: null,
    sourceUnitId: null,
    sourceFactId: null,
    supersedesStateId: null,
    key: 'state',
    version: 1,
    isCurrent: true,
    entityType: 'character',
    entityId: 'character-mara',
    stateKey: 'status',
    value: 'active',
    status: 'active',
    validFromSceneId: null,
    validToSceneId: null,
    validFromOrder: null,
    validToOrder: null,
    storyOrder: null,
    sourceSpan: null,
    invalidatedAt: null,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides
  };
}

function timelineEvent(overrides: Partial<TimelineEvent>): TimelineEvent {
  return {
    id: 'event',
    projectId: PROJECT_ID,
    buildRunId: BUILD_RUN_ID,
    sourceArtifactId: null,
    sourceTaskId: null,
    sourceUnitId: null,
    supersedesEventId: null,
    key: 'event',
    version: 1,
    isCurrent: true,
    title: 'Event',
    description: null,
    chronology: 0,
    sortOrder: 0,
    chapterId: null,
    sceneId: null,
    dependencyIds: [],
    participantRefs: [],
    sourceSpan: null,
    invalidatedAt: null,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides
  };
}

function setupPayoff(overrides: Partial<SetupPayoffLink>): SetupPayoffLink {
  return {
    id: 'setup',
    projectId: PROJECT_ID,
    buildRunId: BUILD_RUN_ID,
    sourceTaskId: null,
    sourceUnitId: null,
    supersedesLinkId: null,
    plotThreadId: null,
    key: 'setup',
    version: 1,
    isCurrent: true,
    title: 'Setup',
    description: '',
    status: 'planned',
    setupSceneId: null,
    payoffSceneId: null,
    reinforcementSceneIds: [],
    setupArtifactId: null,
    payoffArtifactId: null,
    metadata: null,
    invalidatedAt: null,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides
  };
}

function openLoop(overrides: Partial<OpenLoop>): OpenLoop {
  return {
    id: 'loop',
    projectId: PROJECT_ID,
    buildRunId: BUILD_RUN_ID,
    sourceTaskId: null,
    sourceUnitId: null,
    supersedesLoopId: null,
    key: 'loop',
    version: 1,
    isCurrent: true,
    kind: 'question',
    status: 'open',
    title: 'Question',
    description: '',
    introducedSceneId: null,
    resolvedSceneId: null,
    introducedArtifactId: null,
    resolvedArtifactId: null,
    targetPayoff: null,
    metadata: null,
    invalidatedAt: null,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides
  };
}

function plotThread(overrides: Partial<PlotThread>): PlotThread {
  return {
    id: 'thread',
    projectId: PROJECT_ID,
    buildRunId: BUILD_RUN_ID,
    sourceArtifactId: null,
    sourceTaskId: null,
    sourceUnitId: null,
    supersedesThreadId: null,
    parentThreadId: null,
    key: 'thread',
    version: 1,
    isCurrent: true,
    title: 'Thread',
    kind: 'subplot',
    status: 'planned',
    summary: '',
    stakes: null,
    sceneIds: [],
    introducedSceneId: null,
    resolvedSceneId: null,
    metadata: null,
    invalidatedAt: null,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides
  };
}

function words(value: string): number {
  return value.trim() ? value.trim().split(/\s+/).length : 0;
}
