import { createHash } from 'node:crypto';
import { z } from 'zod';
import type {
  BuildAuthorizationScope,
  BuildManifest,
  BuildManifestArtifactSpec,
  BuildManifestPhase,
  CreateBuildRunInput,
  JsonObject,
  JsonValue,
  StoryArtifactType
} from '@opentales/sdk';

export const WORKFLOW_VERSION = 'novel-build-v1';
export const STORY_SCHEMA_VERSION = 'story-ir-v1';

const trimmedString = (label: string, max = 20_000) =>
  z.string().trim().min(1, `${label} is required`).max(max, `${label} is too long`);
const stringList = z.array(z.string().trim().min(1).max(2_000)).max(1_000);
const referenceSchema = z
  .object({
    type: trimmedString('Reference type', 100),
    id: trimmedString('Reference id', 500),
    key: z.string().trim().min(1).max(500).optional(),
    label: z.string().trim().min(1).max(500).optional()
  })
  .strict();
const sourceSpanSchema = z
  .object({
    chapterId: z.string().trim().min(1).max(500).optional(),
    sceneId: z.string().trim().min(1).max(500).optional(),
    artifactId: z.string().trim().min(1).max(500).optional(),
    unitId: z.string().trim().min(1).max(500).optional(),
    start: z.number().int().min(0).optional(),
    end: z.number().int().min(0).optional(),
    quote: z.string().max(4_000).optional()
  })
  .strict()
  .refine((value) => value.end === undefined || value.start === undefined || value.end >= value.start, {
    message: 'Source span end must be greater than or equal to start'
  });

const storyBriefSchema = z
  .object({
    premise: trimmedString('Premise'),
    genre: trimmedString('Genre', 500),
    targetAudience: z.string().trim().max(500).optional(),
    tone: stringList,
    promises: stringList,
    constraints: stringList,
    thematicQuestion: z.string().trim().max(2_000).optional(),
    targetWordCount: z.number().int().min(1_000).max(1_000_000).optional()
    ,minWordCount: z.number().int().min(1_000).max(1_000_000).optional()
    ,maxWordCount: z.number().int().min(1_000).max(1_000_000).optional()
    ,targetChapterCount: z.number().int().min(1).max(500).optional()
    ,targetSceneCount: z.number().int().min(1).max(5_000).optional()
    ,targetCharacterCount: z.number().int().min(1).max(1_000).optional()
  })
  .strict();

const narrativeContractSchema = z
  .object({
    pov: trimmedString('POV', 500),
    tense: trimmedString('Tense', 500),
    narrativeDistance: trimmedString('Narrative distance', 500),
    sentenceRhythm: trimmedString('Sentence rhythm', 1_000),
    diction: trimmedString('Diction', 1_000),
    metaphorDensity: trimmedString('Metaphor density', 500),
    interiority: trimmedString('Interiority', 500),
    dialogueCompression: trimmedString('Dialogue compression', 500),
    expositionStyle: trimmedString('Exposition style', 1_000),
    descriptionDensity: trimmedString('Description density', 500),
    contentConstraints: stringList
  })
  .strict();

const characterBibleSchema = z
  .object({
    characterKey: trimmedString('Character key', 500),
    name: trimmedString('Character name', 500),
    aliases: z.array(z.string().trim().min(1).max(500)).max(1_000).refine((values) => new Set(values.map((value) => value.toLocaleLowerCase())).size === values.length, 'Character aliases must be unique'),
    role: z.string().trim().max(500).optional(),
    wants: stringList,
    needs: stringList,
    contradictions: stringList,
    backstory: z.string().max(20_000).optional(),
    arc: z.string().max(20_000).optional(),
    voice: z.string().max(10_000).optional(),
    knowledge: stringList,
    secrets: stringList,
    relationships: z.array(referenceSchema).max(1_000)
  })
  .strict();

const relationshipGraphSchema = z
  .object({
    nodes: z.array(referenceSchema).min(1).max(5_000),
    edges: z
      .array(
        z
          .object({
            key: trimmedString('Relationship key', 500),
            from: referenceSchema,
            to: referenceSchema,
            type: trimmedString('Relationship type', 500),
            description: z.string().max(5_000).optional(),
            state: z.string().max(2_000).optional()
          })
          .strict()
      )
      .max(20_000)
  })
  .strict();

const worldBibleSchema = z
  .object({
    rules: z.array(z.object({ key: trimmedString('Rule key', 500), statement: trimmedString('Rule') }).strict()).max(5_000),
    institutions: z.array(z.object({ key: trimmedString('Institution key', 500), name: trimmedString('Institution name', 500), description: trimmedString('Institution description') }).strict()).max(5_000),
    geography: z.array(z.object({ key: trimmedString('Geography key', 500), name: trimmedString('Geography name', 500), description: trimmedString('Geography description') }).strict()).max(5_000),
    factions: z.array(z.object({ key: trimmedString('Faction key', 500), name: trimmedString('Faction name', 500), description: trimmedString('Faction description') }).strict()).max(5_000),
    terminology: z.array(z.object({ term: trimmedString('Term', 500), definition: trimmedString('Definition') }).strict()).max(10_000),
    technologyOrMagicConstraints: stringList
  })
  .strict();

const plotThreadSchema = z
  .object({
    threadKey: trimmedString('Plot thread key', 500),
    kind: z.enum(['main', 'subplot', 'character-arc', 'mystery', 'romance', 'thematic', 'other']),
    summary: trimmedString('Plot thread summary'),
    stakes: z.string().max(5_000).optional(),
    characterRefs: z.array(referenceSchema).max(1_000),
    beatKeys: stringList,
    setupPayoffKeys: stringList,
    resolution: z.string().max(10_000).optional()
  })
  .strict();

const beatSchema = z
  .object({
    beatKey: trimmedString('Beat key', 500),
    title: trimmedString('Beat title', 1_000),
    function: trimmedString('Beat function', 5_000),
    causeKeys: stringList,
    consequenceKeys: stringList,
    threadRefs: z.array(referenceSchema).max(1_000),
    expectedPayoff: z.string().max(5_000).optional()
  })
  .strict();

const actArchitectureSchema = z
  .object({
    acts: z
      .array(
        z
          .object({
            actKey: trimmedString('Act key', 500),
            title: trimmedString('Act title', 1_000),
            purpose: trimmedString('Act purpose', 5_000),
            entryState: trimmedString('Act entry state', 5_000),
            exitState: trimmedString('Act exit state', 5_000),
            beatKeys: stringList,
            chapterKeys: stringList
          })
          .strict()
      )
      .min(1)
      .max(20)
  })
  .strict();

const chapterBriefSchema = z
  .object({
    chapterKey: trimmedString('Chapter key', 500),
    number: z.number().int().min(1).max(10_000),
    title: trimmedString('Chapter title', 1_000),
    actKey: z.string().trim().min(1).max(500).optional(),
    purpose: trimmedString('Chapter purpose', 10_000),
    povRef: referenceSchema.optional(),
    sceneKeys: stringList,
    threadRefs: z.array(referenceSchema).max(1_000),
    entryState: z.record(z.string(), z.unknown()),
    exitState: z.record(z.string(), z.unknown()),
    targetWordCount: z.number().int().min(100).max(100_000).optional()
  })
  .strict();

const scenePlanSchema = z
  .object({
    sceneKey: trimmedString('Scene key', 500),
    chapterKey: trimmedString('Chapter key', 500),
    ordinal: z.number().int().min(1).max(100_000),
    title: z.string().trim().max(1_000).optional(),
    povRef: referenceSchema.optional(),
    locationRef: referenceSchema.optional(),
    storyDate: z.string().trim().min(1).max(500).optional(),
    storyTime: z.string().trim().min(1).max(500).optional(),
    estimatedWordCount: z.number().int().min(0).max(1_000_000).optional(),
    function: trimmedString('Scene function', 5_000),
    goal: trimmedString('Scene goal', 5_000),
    obstacle: trimmedString('Scene obstacle', 5_000),
    stakes: trimmedString('Scene stakes', 5_000),
    conflict: trimmedString('Scene conflict', 10_000),
    turn: trimmedString('Scene turn', 10_000),
    outcome: trimmedString('Scene outcome', 10_000),
    emotionalValueShift: trimmedString('Emotional value shift', 5_000),
    tension: z.number().min(0).max(1),
    dependencies: stringList,
    characterRefs: z.array(referenceSchema).max(1_000),
    plotThreadRefs: z.array(referenceSchema).max(1_000),
    setupPayoffRefs: z.array(referenceSchema).max(1_000),
    revelations: stringList,
    characterPresentIds: stringList.optional(),
    characterReferencedIds: stringList.optional(),
    knowledgeDeltas: z.unknown().optional(),
    objectTransfers: z.unknown().optional(),
    injuryStateChanges: z.unknown().optional(),
    worldRuleRefs: z.unknown().optional(),
    summary: z.string().max(20_000).optional(),
    writerNotes: z.string().max(50_000).optional(),
    aiNotes: z.string().max(50_000).optional(),
    entryState: z.record(z.string(), z.unknown()),
    exitState: z.record(z.string(), z.unknown())
  })
  .strict();

const timelineSchema = z
  .object({
    events: z
      .array(
        z
          .object({
            eventKey: trimmedString('Timeline event key', 500),
            title: trimmedString('Timeline event title', 1_000),
            chronology: z.unknown(),
            dependencyKeys: stringList,
            sceneRef: referenceSchema.optional(),
            participantRefs: z.array(referenceSchema).max(1_000)
          })
          .strict()
      )
      .max(100_000)
  })
  .strict();

const setupPayoffMapSchema = z
  .object({
    links: z
      .array(
        z
          .object({
            key: trimmedString('Setup/payoff key', 500),
            description: trimmedString('Setup/payoff description', 10_000),
            setupRef: referenceSchema,
            reinforcementRefs: z.array(referenceSchema).max(1_000),
            payoffRef: referenceSchema.optional(),
            threadRef: referenceSchema.optional()
          })
          .strict()
      )
      .max(100_000)
  })
  .strict();

const questionSetSchema = z
  .object({
    questions: z
      .array(
        z
          .object({
            key: trimmedString('Question key', 500),
            question: trimmedString('Question', 5_000),
            priority: z.enum(['low', 'medium', 'high', 'critical']),
            status: z.enum(['open', 'answered', 'deferred']),
            answer: z.string().max(20_000).optional(),
            references: z.array(referenceSchema).max(1_000)
          })
          .strict()
      )
      .max(10_000)
  })
  .strict();

const chapterDraftSchema = z
  .object({
    chapterKey: trimmedString('Chapter key', 500),
    chapterId: z.string().trim().min(1).max(500).optional(),
    planArtifactId: trimmedString('Plan artifact id', 500),
    writingBranchId: trimmedString('Writing branch id', 500),
    writingVersionId: trimmedString('Writing version id', 500),
    wordCount: z.number().int().min(0),
    summary: trimmedString('Chapter summary', 10_000)
  })
  .strict();

const revisionIssueSchema = z
  .object({
    code: trimmedString('Issue code', 500),
    severity: z.enum(['info', 'warning', 'error']),
    category: trimmedString('Issue category', 500),
    message: trimmedString('Issue message', 10_000),
    evidence: z.array(sourceSpanSchema).max(1_000),
    candidateResolution: z.string().max(20_000).optional()
  })
  .strict();

const finalePlanSchema = z.object({
  finaleKey: trimmedString('Finale key', 500),
  mainThreadKey: trimmedString('Main thread key', 500),
  resolvesMainThread: z.literal(true),
  climax: trimmedString('Finale climax', 20_000),
  endingCost: trimmedString('Ending cost', 10_000),
  thematicResolution: trimmedString('Thematic resolution', 10_000),
  intentionallyOpenLoopKeys: stringList
}).strict();

const exportManifestSchema = z.object({
  compilationId: trimmedString('Compilation id', 500),
  totalWordCount: z.number().int().min(1),
  contentHash: z.string().regex(/^[a-f0-9]{64}$/),
  outputs: z.array(z.object({
    format: z.enum(['docx', 'pdf', 'epub', 'markdown', 'text', 'html', 'project-archive']),
    assetId: trimmedString('Export asset id', 500),
    mimeType: trimmedString('Export MIME type', 500),
    checksum: z.string().max(500).nullable().optional()
  }).strict()).min(1).max(20),
  generatedAt: z.string().datetime()
}).strict();

export const ARTIFACT_CONTENT_SCHEMAS: Record<StoryArtifactType, z.ZodType> = {
  'story-brief': storyBriefSchema,
  'narrative-contract': narrativeContractSchema,
  'character-bible': characterBibleSchema,
  'relationship-graph': relationshipGraphSchema,
  'world-bible': worldBibleSchema,
  'plot-thread': plotThreadSchema,
  'act-architecture': actArchitectureSchema,
  'chapter-brief': chapterBriefSchema,
  'scene-plan': scenePlanSchema,
  timeline: timelineSchema,
  'setup-payoff-map': setupPayoffMapSchema,
  'research-questions': questionSetSchema,
  'open-questions': questionSetSchema,
  beat: beatSchema,
  'chapter-draft': chapterDraftSchema,
  'revision-issue': revisionIssueSchema
  ,'finale-plan': finalePlanSchema
  ,'export-manifest': exportManifestSchema
};

export const ARTIFACT_TYPES = Object.freeze(Object.keys(ARTIFACT_CONTENT_SCHEMAS) as StoryArtifactType[]);

export const authorizationScopeSchema = z
  .object({
    artifactTypes: z.array(z.enum(ARTIFACT_TYPES as [StoryArtifactType, ...StoryArtifactType[]])).max(100),
    chapterIds: z.array(z.string().trim().min(1).max(500)).max(100_000),
    sceneIds: z.array(z.string().trim().min(1).max(500)).max(500_000),
    allowPlanningArtifacts: z.boolean(),
    allowCanonWrites: z.boolean(),
    allowChapterWrites: z.boolean(),
    allowSceneWrites: z.boolean(),
    allowDiagnostics: z.boolean(),
    expiresAt: z.string().datetime().nullable().optional()
  })
  .strict();

export const createBuildRunSchema = z
  .object({
    idempotencyKey: trimmedString('Idempotency key', 500),
    brainstorm: trimmedString('Brainstorm', 500_000),
    objective: z.string().trim().min(1).max(20_000).optional(),
    targetWordCount: z.number().int().min(1_000).max(1_000_000).optional(),
    minWordCount: z.number().int().min(1_000).max(1_000_000).optional(),
    maxWordCount: z.number().int().min(1_000).max(1_000_000).optional(),
    targetChapterCount: z.number().int().min(1).max(500).optional(),
    targetSceneCount: z.number().int().min(1).max(5_000).optional(),
    targetCharacterCount: z.number().int().min(1).max(1_000).optional(),
    genre: z.string().trim().min(1).max(500).optional(),
    targetAudience: z.string().trim().min(1).max(500).optional(),
    tone: z.array(z.string().trim().min(1).max(500)).max(100).optional(),
    constraints: z.array(z.string().trim().min(1).max(2_000)).max(1_000).optional(),
    autonomyMode: z.enum(['assist', 'plan-review', 'autonomous-draft']).optional(),
    authorizationScope: authorizationScopeSchema.partial().optional(),
    maxTokens: z.number().int().min(1).max(2_000_000_000).nullable().optional(),
    maxCostMicros: z.number().int().min(1).max(2_000_000_000).nullable().optional(),
    workflowVersion: z.string().trim().min(1).max(500).optional()
  })
  .strict()
  .superRefine((value, context) => {
    const target = value.targetWordCount ?? 80_000;
    const min = value.minWordCount ?? Math.floor(target * 0.9);
    const max = value.maxWordCount ?? Math.ceil(target * 1.1);
    if (min > target || target > max) {
      context.addIssue({ code: 'custom', message: 'Word-count range must satisfy minWordCount <= targetWordCount <= maxWordCount' });
    }
    if (value.targetSceneCount !== undefined && value.targetChapterCount !== undefined && value.targetSceneCount < value.targetChapterCount) {
      context.addIssue({ code: 'custom', message: 'targetSceneCount cannot be smaller than targetChapterCount' });
    }
  });

export interface TaskTemplate {
  key: string;
  type: string;
  phase: string;
  dependencyKeys: string[];
  assignedAgent: string;
  skillVersions: JsonObject;
  acceptanceCriteria: JsonObject;
  executionPolicy: JsonObject;
  maxAttempts: number;
  maxRevisionIterations: number;
  qualityThreshold?: number;
  priority: number;
}

export const PLANNING_TASK_TEMPLATES: readonly TaskTemplate[] = Object.freeze([
  planningTask('story-brief', 'create-story-brief', [], 'creator', ['story-brief'], 100),
  planningTask('narrative-contract', 'create-narrative-contract', ['story-brief'], 'creator', ['narrative-contract'], 90),
  planningTask('character-bibles', 'create-character-bibles', ['story-brief'], 'creator', ['character-bible'], 85),
  planningTask('world-bible', 'create-world-bible', ['story-brief'], 'creator', ['world-bible'], 85),
  planningTask('relationship-graph', 'create-relationship-graph', ['character-bibles'], 'creator', ['relationship-graph'], 80),
  planningTask('research-questions', 'create-research-questions', ['story-brief', 'world-bible'], 'researcher', ['research-questions'], 75),
  planningTask('plot-threads', 'create-plot-threads', ['story-brief', 'character-bibles', 'world-bible'], 'creator', ['plot-thread'], 70),
  planningTask('beats', 'create-beats', ['plot-threads'], 'creator', ['beat'], 68),
  planningTask('act-architecture', 'create-act-architecture', ['plot-threads', 'beats'], 'creator', ['act-architecture'], 65),
  planningTask('chapter-briefs', 'create-chapter-briefs', ['act-architecture', 'plot-threads'], 'creator', ['chapter-brief'], 60),
  planningTask('scene-plans', 'create-scene-plans', ['chapter-briefs'], 'creator', ['scene-plan'], 55),
  planningTask('timeline', 'create-timeline', ['scene-plans'], 'librarian', ['timeline'], 50),
  planningTask('setup-payoff-map', 'create-setup-payoff-map', ['plot-threads', 'scene-plans'], 'creator', ['setup-payoff-map'], 50),
  planningTask('finale-plan', 'create-finale-plan', ['plot-threads', 'scene-plans', 'setup-payoff-map'], 'creator', ['finale-plan'], 48),
  planningTask('open-questions', 'create-open-questions', ['relationship-graph', 'act-architecture'], 'creator', ['open-questions'], 45),
  {
    key: 'planning-quality-gate',
    type: 'quality-gate',
    phase: 'planning-review',
    dependencyKeys: ['narrative-contract', 'research-questions', 'timeline', 'setup-payoff-map', 'finale-plan', 'open-questions'],
    assignedAgent: 'critic',
    skillVersions: { 'novel-build': '1.1.0', 'novel-critic': '2.0.0' },
    acceptanceCriteria: { requiresPassingEvaluation: true, rubric: 'complete-book-plan-v1' },
    executionPolicy: { maxIterations: 1, deterministicValidationRequired: true },
    maxAttempts: 2,
    maxRevisionIterations: 1,
    qualityThreshold: 0.8,
    priority: 20
  },
  {
    key: 'planning-checkpoint',
    type: 'checkpoint',
    phase: 'planning-review',
    dependencyKeys: ['planning-quality-gate'],
    assignedAgent: 'orchestrator',
    skillVersions: { 'novel-build': '1.1.0' },
    acceptanceCriteria: { checkpoint: true },
    executionPolicy: { deterministic: true },
    maxAttempts: 3,
    maxRevisionIterations: 0,
    priority: 10
  }
]);

export function createPlanningTaskTemplates(targetChapterCount: number, targetSceneCount: number): TaskTemplate[] {
  if (targetSceneCount <= 100) return [...PLANNING_TASK_TEMPLATES];
  const base = PLANNING_TASK_TEMPLATES.filter((task) => !['beats', 'scene-plans'].includes(task.key)).map((task) => ({ ...task, dependencyKeys: [...task.dependencyKeys] }));
  const beatShardSize = 20;
  const beatShards = Array.from({ length: Math.ceil(targetSceneCount / beatShardSize) }, (_, index) => {
    const count = Math.min(beatShardSize, targetSceneCount - index * beatShardSize);
    return { ...planningTask(`beats:${String(index + 1).padStart(3, '0')}`, 'create-beat-shard', ['plot-threads'], 'creator', ['beat'], 68 - index),
      acceptanceCriteria: { requiredArtifactTypes: ['beat'], minOutputCount: count, maxOutputCount: count },
      executionPolicy: { shardIndex: index, startOrdinal: index * beatShardSize + 1, count, total: targetSceneCount }
    };
  });
  const sceneBase = Math.floor(targetSceneCount / targetChapterCount);
  const sceneRemainder = targetSceneCount % targetChapterCount;
  let startOrdinal = 1;
  const sceneShards = Array.from({ length: targetChapterCount }, (_, index) => {
    const count = sceneBase + (index < sceneRemainder ? 1 : 0);
    const task = { ...planningTask(`scene-plans:chapter-${String(index + 1).padStart(3, '0')}`, 'create-scene-plan-shard', ['chapter-briefs'], 'creator', ['scene-plan'], 55 - index),
      acceptanceCriteria: { requiredArtifactTypes: ['scene-plan'], minOutputCount: count, maxOutputCount: count },
      executionPolicy: { shardIndex: index, chapterNumber: index + 1, startOrdinal, count, total: targetSceneCount }
    };
    startOrdinal += count;
    return task;
  });
  const aggregate = (key: string, type: string, dependencies: string[], priority: number): TaskTemplate => ({
    key, type, phase: 'planning', dependencyKeys: dependencies, assignedAgent: 'orchestrator',
    skillVersions: { 'novel-build': '1.1.0' }, acceptanceCriteria: { deterministicValidationRequired: true },
    executionPolicy: { deterministic: true, aggregate: true }, maxAttempts: 3, maxRevisionIterations: 0, priority
  });
  base.push(aggregate('beats', 'aggregate-beats', beatShards.map((task) => task.key), 67));
  base.push(aggregate('scene-plans', 'aggregate-scene-plans', sceneShards.map((task) => task.key), 54));
  return [...base, ...beatShards, ...sceneShards];
}

export const REVISION_TASK_TEMPLATES: readonly TaskTemplate[] = Object.freeze([
  revisionTask('drafting-complete', 'drafting-complete-barrier', ['planning-checkpoint'], 'orchestrator', 100, {
    acceptanceCriteria: { allChapterCheckpointsRequired: true },
    executionPolicy: { deterministic: true, barrier: true }
  }),
  revisionTask('manuscript-developmental-review', 'manuscript-developmental-review', ['drafting-complete'], 'critic', 90, {
    skillVersions: { 'novel-build': '1.1.0', 'novel-critic': '2.0.0', 'novel-developmental-revision': '1.0.0' },
    acceptanceCriteria: { rubric: 'manuscript-developmental-v1' },
    qualityThreshold: 0.8
  }),
  revisionTask('character-review-pass', 'character-review-pass', ['manuscript-developmental-review'], 'critic', 85, {
    skillVersions: { 'novel-build': '1.1.0', 'novel-critic': '2.0.0', 'novel-developmental-revision': '1.0.0' },
    acceptanceCriteria: { rubric: 'character-continuity-v1' },
    qualityThreshold: 0.8
  }),
  revisionTask('continuity-review-pass', 'continuity-review-pass', ['character-review-pass'], 'critic', 80, {
    skillVersions: { 'novel-build': '1.1.0', 'novel-critic': '2.0.0', 'novel-continuity': '1.1.0' },
    acceptanceCriteria: { deterministicValidationRequired: true, rubric: 'continuity-v1' },
    qualityThreshold: 0.9
  }),
  revisionTask('pacing-review-pass', 'pacing-review-pass', ['continuity-review-pass'], 'critic', 75, {
    skillVersions: { 'novel-build': '1.1.0', 'novel-critic': '2.0.0', 'novel-developmental-revision': '1.0.0' },
    acceptanceCriteria: { rubric: 'pacing-v1' },
    qualityThreshold: 0.8
  }),
  revisionTask('structural-revision', 'structural-revision', ['pacing-review-pass'], 'reviser', 70, {
    skillVersions: { 'novel-build': '1.1.0', 'novel-chapters': '2.0.0', 'novel-developmental-revision': '1.0.0' },
    maxAttempts: 2,
    maxRevisionIterations: 1,
    acceptanceCriteria: { boundedRevision: true }
  }),
  revisionTask('line-edit', 'line-edit', ['structural-revision'], 'reviser', 60, {
    skillVersions: { 'novel-build': '1.1.0', 'novel-line-revision': '1.0.0' },
    maxAttempts: 2,
    maxRevisionIterations: 1
  }),
  revisionTask('copy-edit', 'copy-edit', ['line-edit'], 'reviser', 50, {
    skillVersions: { 'novel-build': '1.1.0', 'novel-copy-edit': '1.0.0' },
    maxAttempts: 2,
    maxRevisionIterations: 1
  }),
  revisionTask('proof', 'proof', ['copy-edit'], 'critic', 40, {
    skillVersions: { 'novel-build': '1.1.0', 'novel-critic': '2.0.0', 'novel-finalization': '1.0.0' },
    acceptanceCriteria: { deterministicValidationRequired: true, rubric: 'proof-v1' },
    qualityThreshold: 0.95
  }),
  revisionTask('finalization', 'finalization', ['proof'], 'reviser', 30, {
    skillVersions: { 'novel-build': '1.1.0', 'novel-finalization': '1.0.0' },
    acceptanceCriteria: { finalManuscriptRequired: true }
  }),
  revisionTask('export-preparation', 'export-preparation', ['finalization'], 'orchestrator', 20, {
    skillVersions: { 'novel-build': '1.1.0', 'novel-finalization': '1.0.0' },
    acceptanceCriteria: { exportManifestRequired: true, requiredArtifactTypes: ['export-manifest'] },
    executionPolicy: { externalServiceRequired: true }
  }),
  revisionTask('final-checkpoint', 'checkpoint', ['export-preparation'], 'orchestrator', 10, {
    skillVersions: { 'novel-build': '1.1.0', 'novel-finalization': '1.0.0' },
    acceptanceCriteria: { checkpoint: true, final: true },
    executionPolicy: { deterministic: true },
    maxRevisionIterations: 0
  })
]);

export function createSceneTaskTemplates(sceneKey: string, dependencyCheckpointKeys: string[]): TaskTemplate[] {
  const prefix = `scene:${sceneKey}`;
  const task = (
    suffix: string,
    type: string,
    dependencies: string[],
    agent: string,
    priority: number,
    extra: Partial<TaskTemplate> = {}
  ): TaskTemplate => ({
    key: `${prefix}:${suffix}`,
    type,
    phase: 'drafting',
    dependencyKeys: dependencies,
    assignedAgent: agent,
    skillVersions: { 'novel-build': '1.1.0' },
    acceptanceCriteria: {},
    executionPolicy: { maxIterations: 1 },
    maxAttempts: 3,
    maxRevisionIterations: 1,
    priority,
    ...extra
  });
  return [
    task('context', 'assemble-scene-context', dependencyCheckpointKeys.length ? dependencyCheckpointKeys : ['planning-checkpoint'], 'orchestrator', 100, {
      acceptanceCriteria: { contextPackRequired: true },
      executionPolicy: { deterministic: true }
    }),
    task('draft', 'draft-scene-unit', [`${prefix}:context`], 'drafter', 90, {
      skillVersions: { 'novel-build': '1.1.0', 'novel-chapters': '2.0.0' },
      acceptanceCriteria: { manuscriptUnitDraftRequired: true }
    }),
    task('canon', 'extract-scene-canon', [`${prefix}:draft`], 'librarian', 80, {
      skillVersions: { 'novel-build': '1.1.0', 'novel-continuity': '1.1.0' },
      acceptanceCriteria: { canonDeltaRequired: true }
    }),
    task('diagnostics', 'run-scene-diagnostics', [`${prefix}:canon`], 'critic', 70, {
      skillVersions: { 'novel-build': '1.1.0', 'novel-critic': '2.0.0', 'novel-continuity': '1.1.0' },
      acceptanceCriteria: { deterministicValidationRequired: true },
      executionPolicy: { deterministic: true }
    }),
    task('critic', 'critique-scene', [`${prefix}:diagnostics`], 'critic', 60, {
      skillVersions: { 'novel-build': '1.1.0', 'novel-critic': '2.0.0' },
      acceptanceCriteria: { rubric: 'scene-quality-v1' },
      qualityThreshold: 0.8
    }),
    task('revision', 'revise-scene-unit', [`${prefix}:critic`], 'reviser', 50, {
      skillVersions: { 'novel-build': '1.1.0', 'novel-chapters': '2.0.0', 'novel-developmental-revision': '1.0.0' },
      acceptanceCriteria: { boundedRevision: true },
      maxAttempts: 2,
      maxRevisionIterations: 1
    }),
    task('reextract-canon', 'extract-scene-canon', [`${prefix}:revision`], 'librarian', 45, {
      skillVersions: { 'novel-build': '1.1.0', 'novel-continuity': '1.1.0' },
      acceptanceCriteria: { canonDeltaRequired: true }
    }),
    task('rerun-diagnostics', 'run-scene-diagnostics', [`${prefix}:reextract-canon`], 'critic', 42, {
      skillVersions: { 'novel-build': '1.1.0', 'novel-critic': '2.0.0', 'novel-continuity': '1.1.0' },
      acceptanceCriteria: { deterministicValidationRequired: true },
      executionPolicy: { deterministic: true }
    }),
    task('quality-gate', 'quality-gate', [`${prefix}:rerun-diagnostics`], 'critic', 40, {
      skillVersions: { 'novel-build': '1.1.0', 'novel-critic': '2.0.0' },
      acceptanceCriteria: { requiresPassingEvaluation: true, rubric: 'scene-quality-v1' },
      qualityThreshold: 0.8
    }),
    task('checkpoint', 'checkpoint', [`${prefix}:quality-gate`], 'orchestrator', 30, {
      acceptanceCriteria: { checkpoint: true },
      executionPolicy: { deterministic: true },
      maxRevisionIterations: 0
    })
  ];
}

export function createChapterCompilationTaskTemplates(chapterKey: string, sceneCheckpointKeys: string[]): TaskTemplate[] {
  const prefix = `chapter:${chapterKey}`;
  return [
    {
      key: `${prefix}:compile`,
      type: 'compile-chapter-unit',
      phase: 'drafting',
      dependencyKeys: sceneCheckpointKeys,
      assignedAgent: 'orchestrator',
      skillVersions: { 'novel-build': '1.1.0', 'novel-finalization': '1.0.0' },
      acceptanceCriteria: { compiledChapterRequired: true, requiredArtifactTypes: ['chapter-draft'] },
      executionPolicy: { deterministic: true },
      maxAttempts: 3,
      maxRevisionIterations: 0,
      priority: 25
    },
    {
      key: `${prefix}:checkpoint`,
      type: 'checkpoint',
      phase: 'drafting',
      dependencyKeys: [`${prefix}:compile`],
      assignedAgent: 'orchestrator',
      skillVersions: { 'novel-build': '1.1.0' },
      acceptanceCriteria: { checkpoint: true, compiledChapterRequired: true },
      executionPolicy: { deterministic: true },
      maxAttempts: 3,
      maxRevisionIterations: 0,
      priority: 20
    }
  ];
}

export function normalizeBuildInput(input: CreateBuildRunInput): CreateBuildRunInput {
  return createBuildRunSchema.parse(input) as CreateBuildRunInput;
}

export function defaultAuthorizationScope(mode: CreateBuildRunInput['autonomyMode']): BuildAuthorizationScope {
  const autonomyMode = mode ?? 'assist';
  const planningTypes = ARTIFACT_TYPES.filter((type) => type !== 'chapter-draft');
  return {
    artifactTypes: autonomyMode === 'assist' ? planningTypes : ARTIFACT_TYPES.slice(),
    chapterIds: [],
    sceneIds: [],
    allowPlanningArtifacts: true,
    allowCanonWrites: autonomyMode !== 'assist',
    allowChapterWrites: autonomyMode === 'autonomous-draft',
    allowSceneWrites: autonomyMode === 'autonomous-draft',
    allowDiagnostics: true,
    expiresAt: null
  };
}

export function mergeAuthorizationScope(
  mode: CreateBuildRunInput['autonomyMode'],
  provided?: Partial<BuildAuthorizationScope>
): BuildAuthorizationScope {
  return authorizationScopeSchema.parse({ ...defaultAuthorizationScope(mode), ...provided });
}

export function createBuildManifest(input: CreateBuildRunInput): BuildManifest {
  const targetWordCount = input.targetWordCount ?? 80_000;
  const minWordCount = input.minWordCount ?? Math.floor(targetWordCount * 0.9);
  const maxWordCount = input.maxWordCount ?? Math.ceil(targetWordCount * 1.1);
  const targetChapterCount = input.targetChapterCount ?? Math.max(1, Math.round(targetWordCount / 2_650));
  const targetSceneCount = input.targetSceneCount ?? Math.max(targetChapterCount, Math.round(targetChapterCount * 3.25));
  const targetCharacterCount = input.targetCharacterCount ?? Math.max(5, Math.round(targetChapterCount * 0.375));
  const artifactSpecs: BuildManifestArtifactSpec[] = [
    artifactSpec('story-brief', 'story-brief', 1, [], 1),
    artifactSpec('narrative-contract', 'narrative-contract', 1, ['story-brief'], 1),
    artifactSpec('character-bible', 'characters', targetCharacterCount, ['story-brief'], targetCharacterCount),
    artifactSpec('relationship-graph', 'relationships', 1, ['characters'], 1),
    artifactSpec('world-bible', 'world-bible', 1, ['story-brief'], 1),
    artifactSpec('plot-thread', 'plot-threads', 5, ['story-brief', 'characters', 'world-bible'], Math.max(5, targetCharacterCount)),
    artifactSpec('beat', 'beats', targetSceneCount, ['plot-threads'], targetSceneCount),
    artifactSpec('act-architecture', 'act-architecture', 1, ['plot-threads', 'beats'], 1),
    artifactSpec('chapter-brief', 'chapter-briefs', targetChapterCount, ['act-architecture'], targetChapterCount),
    artifactSpec('scene-plan', 'scene-plans', targetSceneCount, ['chapter-briefs'], targetSceneCount),
    artifactSpec('timeline', 'timeline', 1, ['scene-plans'], 1),
    artifactSpec('setup-payoff-map', 'setup-payoff-map', 1, ['plot-threads', 'scene-plans'], 1),
    artifactSpec('research-questions', 'research-questions', 1, ['story-brief', 'world-bible'], 1),
    artifactSpec('open-questions', 'open-questions', 1, ['relationships', 'act-architecture'], 1),
    artifactSpec('finale-plan', 'finale-plan', 1, ['plot-threads', 'scene-plans', 'setup-payoff-map'], 1),
    artifactSpec('chapter-draft', 'chapter-drafts', targetChapterCount, ['chapter-briefs', 'scene-plans'], targetChapterCount),
    artifactSpec('export-manifest', 'export-manifest', 1, ['chapter-drafts', 'finale-plan'], 1)
  ];
  const planningTemplates = createPlanningTaskTemplates(targetChapterCount, targetSceneCount);
  const phases: BuildManifestPhase[] = [
    {
      key: 'planning',
      title: 'Book planning',
      taskKeys: planningTemplates.map((task) => task.key),
      checkpoint: true
    },
    {
      key: 'drafting',
      title: 'Sequential chapter production',
      taskKeys: ['chapter:*:context', 'chapter:*:draft', 'chapter:*:canon', 'chapter:*:diagnostics', 'chapter:*:critic', 'chapter:*:revision', 'chapter:*:quality-gate', 'chapter:*:checkpoint'],
      checkpoint: true
    },
    {
      key: 'revising',
      title: 'Whole-manuscript revision',
      taskKeys: REVISION_TASK_TEMPLATES.map((task) => task.key),
      checkpoint: true
    }
  ];
  return {
    version: input.workflowVersion ?? WORKFLOW_VERSION,
    sourceBrainstormHash: stableHash(input.brainstorm),
    target: {
      objective: input.objective ?? 'Build a complete, internally coherent novel from the supplied brainstorm.',
      targetWordCount,
      minWordCount,
      maxWordCount,
      targetChapterCount,
      targetSceneCount,
      targetCharacterCount,
      genre: input.genre ?? null,
      targetAudience: input.targetAudience ?? null,
      tone: input.tone ?? [],
      constraints: input.constraints ?? []
    },
    artifactSpecs,
    phases
  };
}

export function validateArtifactContent(type: StoryArtifactType, content: unknown): JsonObject {
  const parsed = ARTIFACT_CONTENT_SCHEMAS[type].parse(content);
  assertJsonValue(parsed);
  return parsed as JsonObject;
}

export function assertJsonValue(value: unknown, path = '$'): asserts value is JsonValue {
  if (value === null || ['string', 'number', 'boolean'].includes(typeof value)) {
    if (typeof value === 'number' && !Number.isFinite(value)) throw new Error(`${path} contains a non-finite number`);
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertJsonValue(item, `${path}[${index}]`));
    return;
  }
  if (typeof value === 'object') {
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      if (child === undefined) throw new Error(`${path}.${key} is undefined`);
      assertJsonValue(child, `${path}.${key}`);
    }
    return;
  }
  throw new Error(`${path} is not valid JSON`);
}

export function stableHash(value: unknown): string {
  return createHash('sha256').update(stableStringify(value)).digest('hex');
}

export function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, child]) => `${JSON.stringify(key)}:${stableStringify(child)}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

function planningTask(
  key: string,
  type: string,
  dependencyKeys: string[],
  agent: string,
  requiredArtifactTypes: StoryArtifactType[],
  priority: number
): TaskTemplate {
  return {
    key,
    type,
    phase: 'planning',
    dependencyKeys,
    assignedAgent: agent,
    skillVersions: planningSkillVersions(requiredArtifactTypes),
    acceptanceCriteria: { requiredArtifactTypes },
    executionPolicy: { maxIterations: 1, schemaValidationRequired: true },
    maxAttempts: 3,
    maxRevisionIterations: 1,
    priority
  };
}

function planningSkillVersions(types: StoryArtifactType[]): JsonObject {
  const skills: JsonObject = { 'novel-build': '1.1.0' };
  for (const type of types) {
    if (type === 'story-brief' || type === 'open-questions') skills['novel-intake'] = '1.0.0';
    if (type === 'narrative-contract') skills['novel-voice'] = '1.0.0';
    if (type === 'character-bible' || type === 'relationship-graph') skills['novel-characters'] = '1.2.0';
    if (type === 'world-bible') skills['novel-world'] = '1.0.0';
    if (['plot-thread', 'act-architecture', 'chapter-brief'].includes(type)) skills['novel-outline'] = '2.0.0';
    if (type === 'scene-plan') skills['novel-scenes'] = '1.0.0';
    if (type === 'timeline') skills['novel-continuity'] = '1.1.0';
    if (type === 'setup-payoff-map') skills['novel-setup-payoff'] = '1.0.0';
    if (type === 'research-questions') skills['novel-research'] = '1.0.0';
  }
  return skills;
}

function revisionTask(
  key: string,
  type: string,
  dependencyKeys: string[],
  assignedAgent: string,
  priority: number,
  overrides: Partial<TaskTemplate> = {}
): TaskTemplate {
  return {
    key,
    type,
    phase: 'revising',
    dependencyKeys,
    assignedAgent,
    skillVersions: {
      'novel-build': '1.1.0',
      ...(assignedAgent === 'critic' ? { 'novel-critic': '2.0.0' } : {}),
      ...(assignedAgent === 'reviser' ? { 'novel-chapters': '2.0.0' } : {})
    },
    acceptanceCriteria: {},
    executionPolicy: { maxIterations: 1 },
    maxAttempts: 3,
    maxRevisionIterations: 1,
    priority,
    ...overrides
  };
}

function artifactSpec(
  type: StoryArtifactType,
  key: string,
  minCount: number,
  dependsOn: string[] = [],
  maxCount?: number
): BuildManifestArtifactSpec {
  return { type, key, required: true, minCount, maxCount, dependsOn };
}
