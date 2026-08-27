import { createHash } from 'node:crypto';
import type { OpenLoopKind, OpenLoopStatus, PrismaClient } from '@prisma/client';
import type { BuildTaskLeaseInput, JsonValue, SetupPayoffStatus, StorySearchKind, StoryStateBatchOperation } from '@opentales/sdk';
import { tool } from 'ai';
import { z } from 'zod';
import { HttpError } from '../../../http/HttpError.js';
import { ContextAssembler } from '../context/ContextAssembler.js';
import { StoryStateUseCase } from '../../novelBuild/StoryStateUseCase.js';
import { assertJsonValue } from '../../novelBuild/schemas.js';
import type { TaskContract } from '../runtime/taskContract.js';
import { bodyOf, invocationToolCallId, pagination, type AgentToolInvocationContext, type ToolContext } from './shared.js';

export const semanticMutatingToolNames = [
  'commitCanonDelta',
  'linkSetupPayoff'
] as const;

export type SemanticMutatingToolName = (typeof semanticMutatingToolNames)[number];

export interface SemanticApprovalHandler {
  handleApproval(toolName: SemanticMutatingToolName, input: unknown, execute: () => Promise<unknown>, toolCallId: string, abortSignal?: AbortSignal): Promise<unknown>;
}

type DynamicDelegate = {
  findFirst(args: unknown): Promise<Record<string, unknown> | null>;
  findMany(args: unknown): Promise<Record<string, unknown>[]>;
};

interface BuildScopeRow {
  id: string;
  authorizationScope: unknown;
  authorizedById: string | null;
  createdById: string | null;
  revision: number;
}

const buildRunInput = z.object({ buildRunId: z.string().trim().min(1) });
const pageInput = z.object({
  page: z.number().int().min(1).optional(),
  limit: z.number().int().min(1).max(100).optional()
});

const factSchema = z.object({
  key: z.string().trim().min(1),
  subjectType: z.string().trim().min(1),
  subjectId: z.string().trim().min(1),
  predicate: z.string().trim().min(1),
  object: z.unknown(),
  status: z.enum(['PROPOSED', 'CANONICAL', 'DISPUTED']).default('CANONICAL'),
  validFromSceneId: z.string().trim().min(1).optional(),
  validToSceneId: z.string().trim().min(1).optional(),
  validFromOrder: z.number().int().optional(),
  validToOrder: z.number().int().optional(),
  sourceChapterId: z.string().trim().min(1).optional(),
  sourceSceneId: z.string().trim().min(1).optional(),
  sourceArtifactId: z.string().trim().min(1).optional(),
  sourceSpan: z.unknown().optional(),
  confidence: z.number().min(0).max(1).default(1)
});

const entityStateSchema = z.object({
  key: z.string().trim().min(1),
  entityType: z.string().trim().min(1),
  entityId: z.string().trim().min(1),
  stateKey: z.string().trim().min(1),
  value: z.unknown(),
  status: z.enum(['PROPOSED', 'ACTIVE']).default('ACTIVE'),
  validFromSceneId: z.string().trim().min(1).optional(),
  validToSceneId: z.string().trim().min(1).optional(),
  validFromOrder: z.number().int().optional(),
  validToOrder: z.number().int().optional(),
  storyOrder: z.number().int().optional(),
  sourceArtifactId: z.string().trim().min(1).optional(),
  sourceFactKey: z.string().trim().min(1).optional(),
  sourceSpan: z.unknown().optional()
});

const timelineEventSchema = z.object({
  key: z.string().trim().min(1),
  title: z.string().trim().min(1),
  description: z.string().optional(),
  chronology: z.unknown(),
  sortOrder: z.number().optional(),
  chapterId: z.string().trim().min(1).optional(),
  sceneId: z.string().trim().min(1).optional(),
  dependencyIds: z.array(z.string()).default([]),
  participantRefs: z.unknown().default([]),
  sourceArtifactId: z.string().trim().min(1).optional(),
  sourceSpan: z.unknown().optional()
});

const openLoopSchema = z.object({
  key: z.string().trim().min(1),
  kind: z.enum(['PROMISE', 'QUESTION', 'CLUE', 'SETUP', 'MYSTERY', 'FORESHADOWING', 'OTHER']),
  status: z.enum(['OPEN', 'REINFORCED', 'RESOLVED', 'ABANDONED']).default('OPEN'),
  title: z.string().trim().min(1),
  description: z.string().trim().min(1),
  introducedSceneId: z.string().trim().min(1).optional(),
  resolvedSceneId: z.string().trim().min(1).optional(),
  introducedArtifactId: z.string().trim().min(1).optional(),
  resolvedArtifactId: z.string().trim().min(1).optional(),
  targetPayoff: z.string().optional(),
  metadata: z.unknown().optional()
});
const setupPayoffInputSchema = buildRunInput.extend({
  idempotencyKey: z.string().trim().min(1),
  taskId: z.string().trim().min(1).optional(),
  sourceUnitId: z.string().trim().min(1).optional(),
  key: z.string().trim().min(1),
  title: z.string().trim().min(1),
  description: z.string().trim().min(1),
  status: z.enum(['PLANNED', 'SETUP', 'REINFORCED', 'PAID_OFF', 'ABANDONED']).default('PLANNED'),
  plotThreadId: z.string().optional(),
  setupSceneId: z.string().optional(),
  payoffSceneId: z.string().optional(),
  reinforcementSceneIds: z.array(z.string()).default([]),
  setupArtifactId: z.string().optional(),
  payoffArtifactId: z.string().optional(),
  metadata: z.unknown().optional()
});
const canonDeltaInputSchema = buildRunInput.extend({
  idempotencyKey: z.string().trim().min(1),
  taskId: z.string().trim().min(1).optional(),
  sourceUnitId: z.string().trim().min(1).optional(),
  facts: z.array(factSchema).max(100).default([]),
  entityStates: z.array(entityStateSchema).max(100).default([]),
  timelineEvents: z.array(timelineEventSchema).max(100).default([]),
  openLoops: z.array(openLoopSchema).max(100).default([])
}).refine((input) => input.facts.length + input.entityStates.length + input.timelineEvents.length + input.openLoops.length > 0, 'At least one delta item is required');
type CanonDeltaInput = z.infer<typeof canonDeltaInputSchema>;
type SetupPayoffInput = z.infer<typeof setupPayoffInputSchema>;

export function storyIntelligenceTools(
  prisma: PrismaClient,
  context: ToolContext & { userId: string },
  approval: SemanticApprovalHandler,
  taskContract: TaskContract | null,
  executionLease: BuildTaskLeaseInput | null
) {
  return {
    searchStory: tool({
      description: 'Bounded hybrid story search across manuscript, docs, entities, artifacts, canon, timeline, threads, and open loops. Returns stable identifiers for follow-up reads.',
      inputSchema: z.object({
        buildRunId: z.string().trim().min(1).optional(),
        query: z.string().trim().min(1),
        surfaces: z.array(z.enum(['chapters', 'scenes', 'docs', 'characters', 'locations', 'artifacts', 'canon', 'timeline', 'threads', 'loops'])).optional(),
        exact: z.boolean().optional(),
        limit: z.number().int().min(1).max(100).optional(),
        cursor: z.string().trim().min(1).max(1_000).optional()
      }),
      execute: async (input) => input.buildRunId
        ? new StoryStateUseCase(prisma).search(context.userId, context.projectId, input.buildRunId, {
          query: input.query,
          strategy: input.exact ? 'exact' : 'hybrid',
          kinds: input.surfaces?.flatMap(searchKindsForSurface),
          limit: input.limit,
          cursor: input.cursor
        })
        : searchStory(prisma, context.projectId, input)
    }),
    findReferences: tool({
      description: 'Find manuscript and story-state references to one entity, fact, artifact, or thread. Returns evidence locations and stable identifiers.',
      inputSchema: z.object({
        buildRunId: z.string().trim().min(1).optional(),
        refType: z.string().trim().min(1).max(100).optional(),
        refId: z.string().trim().min(1).max(500).optional(),
        entityId: z.string().trim().min(1).max(500).optional(),
        label: z.string().trim().min(1).optional(),
        limit: z.number().int().min(1).max(100).optional()
      }).refine((input) => Boolean(input.refId || input.entityId), 'refId or legacy entityId is required'),
      execute: async (input) => {
        const refId = input.refId ?? input.entityId!;
        return input.buildRunId
          ? new StoryStateUseCase(prisma).findReferences(context.userId, context.projectId, input.buildRunId, { refType: input.refType ?? 'entity', refId, limit: input.limit })
          : findReferences(prisma, context.projectId, { entityId: refId, label: input.label, limit: input.limit });
      }
    }),
    getSceneContext: tool({
      description: 'Compile a token-bounded context pack for one scene, including relevant brief, contract, characters, world, causal history, threads, canon, and style.',
      inputSchema: z.object({
        sceneId: z.string().trim().min(1),
        tokenBudget: z.number().int().min(2_000).max(80_000).optional()
      }),
      execute: async ({ sceneId, tokenBudget }) => new ContextAssembler(prisma).assemble({
        projectId: context.projectId,
        sceneId,
        task: taskContract,
        tokenBudget
      })
    }),
    queryCanon: tool({
      description: 'Query canonical facts with subject, predicate, story-time, scene, and provenance filters.',
      inputSchema: buildRunInput.merge(pageInput).extend({
        subjectType: z.string().optional(),
        subjectId: z.string().optional(),
        predicate: z.string().optional(),
        status: z.enum(['PROPOSED', 'CANONICAL', 'DISPUTED', 'RETRACTED']).optional(),
        sceneId: z.string().optional(),
        atOrder: z.number().int().optional()
      }),
      execute: async (input) => {
        const storyOrder = boundedTaskStoryOrder(taskContract, input.atOrder);
        const state = await new StoryStateUseCase(prisma).temporalState(context.userId, context.projectId, input.buildRunId, {
          sceneId: input.sceneId,
          storyOrder,
          entityType: input.subjectType,
          entityId: input.subjectId,
          predicate: input.predicate,
          limit: input.limit,
          offset: ((input.page ?? 1) - 1) * (input.limit ?? 10)
        });
        return { storyOrder: state.storyOrder, items: input.status ? state.canonFacts.filter((fact) => fact.status === input.status?.toLowerCase()) : state.canonFacts };
      }
    }),
    queryTimeline: tool({
      description: 'Query ordered story-time events by build, scene, chapter, participant, or sort-order range.',
      inputSchema: buildRunInput.merge(pageInput).extend({
        sceneId: z.string().optional(),
        chapterId: z.string().optional(),
        participantId: z.string().optional(),
        fromOrder: z.number().optional(),
        toOrder: z.number().optional()
      }),
      execute: async (input) => {
        const page = pagination(input);
        const storyOrder = boundedTaskStoryOrder(taskContract, input.toOrder);
        const state = await new StoryStateUseCase(prisma).temporalState(context.userId, context.projectId, input.buildRunId, {
          sceneId: input.sceneId,
          storyOrder,
          participantId: input.participantId,
          limit: 500,
          offset: 0
        });
        const bounded = state.timelineEvents.filter((event) =>
          (input.fromOrder === undefined || event.sortOrder === null || event.sortOrder >= input.fromOrder)
          && (storyOrder === undefined || event.sortOrder === null || event.sortOrder <= storyOrder)
          && (!input.sceneId || event.sceneId === input.sceneId)
          && (!input.chapterId || event.chapterId === input.chapterId)
        );
        const items = bounded.slice(page.offset, page.offset + page.limit);
        return { storyOrder: state.storyOrder, items, total: bounded.length, page: page.page, limit: page.limit, nextPage: page.offset + items.length < bounded.length ? page.page + 1 : null, truncatedAt: state.totalTimelineEvents > 500 ? 500 : null };
      }
    }),
    queryEntityState: tool({
      description: 'Read what an entity knows, owns, believes, or otherwise is at a story point.',
      inputSchema: buildRunInput.merge(pageInput).extend({
        entityType: z.string().trim().min(1),
        entityId: z.string().trim().min(1),
        stateKey: z.string().optional(),
        atStoryOrder: z.number().int().optional(),
        atSceneId: z.string().optional()
      }),
      execute: async (input) => new StoryStateUseCase(prisma).temporalState(context.userId, context.projectId, input.buildRunId, {
        sceneId: input.atSceneId,
        storyOrder: boundedTaskStoryOrder(taskContract, input.atStoryOrder),
        entityType: input.entityType,
        entityId: input.entityId,
        stateKey: input.stateKey,
        limit: input.limit,
        offset: ((input.page ?? 1) - 1) * (input.limit ?? 10)
      })
    }),
    queryOpenLoops: tool({
      description: 'Read unresolved promises, mysteries, clues, setups, and foreshadowing with their intended payoff.',
      inputSchema: buildRunInput.merge(pageInput).extend({
        kind: z.enum(['PROMISE', 'QUESTION', 'CLUE', 'SETUP', 'MYSTERY', 'FORESHADOWING', 'OTHER']).optional(),
        status: z.enum(['OPEN', 'REINFORCED', 'RESOLVED', 'ABANDONED']).optional()
      }),
      execute: async (input) => queryOpenLoopsAtTask(prisma, context.projectId, input, taskContract)
    }),
    commitCanonDelta: tool({
      description: 'Atomically commit a validated post-scene delta: canon facts, entity states, timeline events, and open loops. This is approval-gated outside an authorized build scope.',
      inputSchema: canonDeltaInputSchema,
      execute: async (input, options?: AgentToolInvocationContext) => {
        const validated = canonDeltaInputSchema.parse(input);
        return approval.handleApproval('commitCanonDelta', validated, () => commitCanonDelta(prisma, context.projectId, validated, executionLease), invocationToolCallId(options), options?.abortSignal);
      }
    }),
    linkSetupPayoff: tool({
      description: 'Create or update an explicit setup/reinforcement/payoff link. This is approval-gated outside an authorized build scope.',
      inputSchema: setupPayoffInputSchema,
      execute: async (input, options?: AgentToolInvocationContext) => {
        const validated = setupPayoffInputSchema.parse(input);
        return approval.handleApproval('linkSetupPayoff', validated, () => linkSetupPayoff(prisma, context.projectId, validated, executionLease), invocationToolCallId(options), options?.abortSignal);
      }
    }),
    runStoryLint: tool({
      description: 'Run deterministic story diagnostics with evidence and navigation identifiers. Does not mutate story state.',
      inputSchema: buildRunInput.partial().extend({ chapterIds: z.array(z.string()).max(100).optional() }),
      execute: async (input) => runStoryLint(prisma, context.projectId, { ...input, userId: context.userId })
    }),
    getArcState: tool({
      description: 'Read a character or plot-thread arc together with appearances, current state, and linked artifacts.',
      inputSchema: z.object({ buildRunId: z.string().optional(), characterId: z.string().optional(), plotThreadId: z.string().optional() })
        .refine((input) => Boolean(input.characterId || input.plotThreadId), 'characterId or plotThreadId is required'),
      execute: async (input) => getArcState(prisma, context.projectId, input)
    }),
    compareVersions: tool({
      description: 'Compare two writing versions using bounded line/prose changes plus entity and word-count deltas.',
      inputSchema: z.object({ fromVersionId: z.string().trim().min(1), toVersionId: z.string().trim().min(1) }),
      execute: async (input) => compareVersions(
        prisma,
        context.projectId,
        input,
        taskContract?.metadata.allowCrossBuildCompare === true ? undefined : taskContract?.scope.buildRunId
      )
    })
  };
}

export async function executeSemanticMutation(
  prisma: PrismaClient,
  context: ToolContext & { userId: string },
  toolName: string,
  input: Record<string, unknown>
): Promise<unknown> {
  if (toolName === 'commitCanonDelta') {
    const parsed = canonDeltaInputSchema.parse(input);
    return commitCanonDelta(prisma, context.projectId, parsed, null);
  }
  if (toolName === 'linkSetupPayoff') return linkSetupPayoff(prisma, context.projectId, setupPayoffInputSchema.parse(input), null);
  throw new HttpError(400, `Semantic mutation ${toolName} is not implemented`);
}

async function searchStory(
  prisma: PrismaClient,
  projectId: string,
  input: { query: string; surfaces?: string[]; exact?: boolean; limit?: number }
) {
  const limit = Math.min(input.limit ?? 50, 100);
  const surfaces = new Set(input.surfaces ?? ['chapters', 'scenes', 'docs', 'characters', 'locations', 'artifacts', 'canon', 'timeline', 'threads', 'loops']);
  const [chapters, scenes, docs, characters, locations, artifacts, canon, timeline, threads, loops] = await Promise.all([
    surfaces.has('chapters') ? prisma.chapter.findMany({ where: { projectId, deletedAt: null }, take: 120, orderBy: { number: 'asc' }, include: { bodyWriting: { include: { defaultBranch: { include: { headVersion: true } } } } } }) : [],
    surfaces.has('scenes') ? prisma.scene.findMany({
      where: { chapter: { projectId, deletedAt: null } },
      take: 300,
      orderBy: [{ chapter: { number: 'asc' } }, { order: 'asc' }],
      include: {
        chapter: { select: { number: true, title: true } },
        bodyWriting: { include: { defaultBranch: { include: { headVersion: true } } } }
      }
    }) : [],
    surfaces.has('docs') ? prisma.projectDoc.findMany({ where: { projectId }, take: 120, include: { bodyWriting: { include: { defaultBranch: { include: { headVersion: true } } } } } }) : [],
    surfaces.has('characters') ? prisma.character.findMany({ where: { projectId }, take: 120, include: { descriptionWriting: { include: { defaultBranch: { include: { headVersion: true } } } }, motivationWriting: { include: { defaultBranch: { include: { headVersion: true } } } }, arcWriting: { include: { defaultBranch: { include: { headVersion: true } } } } } }) : [],
    surfaces.has('locations') ? prisma.location.findMany({ where: { projectId }, take: 120, include: { descriptionWriting: { include: { defaultBranch: { include: { headVersion: true } } } } } }) : [],
    surfaces.has('artifacts') ? dynamicFindMany(prisma, 'storyArtifact', { projectId, invalidatedAt: null }, 200) : [],
    surfaces.has('canon') ? dynamicFindMany(prisma, 'canonFact', { projectId, invalidatedAt: null }, 300) : [],
    surfaces.has('timeline') ? dynamicFindMany(prisma, 'timelineEvent', { projectId, invalidatedAt: null }, 200) : [],
    surfaces.has('threads') ? dynamicFindMany(prisma, 'plotThread', { projectId, invalidatedAt: null }, 100) : [],
    surfaces.has('loops') ? dynamicFindMany(prisma, 'openLoop', { projectId, invalidatedAt: null }, 100) : []
  ]);

  const candidates: SearchCandidate[] = [];
  for (const chapter of chapters) candidates.push({ surface: 'chapter', id: chapter.id, label: `Chapter ${chapter.number}: ${chapter.title}`, text: `${chapter.title}\n${chapter.summary ?? ''}\n${bodyOf(chapter.bodyWriting)}` });
  for (const scene of scenes) candidates.push({ surface: 'scene', id: scene.id, label: `Chapter ${scene.chapter.number}, scene ${scene.order}: ${scene.title ?? 'Untitled'}`, text: `${scene.title ?? ''}\n${bodyOf(scene.bodyWriting)}` });
  for (const doc of docs) candidates.push({ surface: 'doc', id: doc.id, label: doc.title, text: `${doc.title}\n${bodyOf(doc.bodyWriting)}` });
  for (const character of characters) candidates.push({ surface: 'character', id: character.id, label: character.name, text: `${character.name}\n${character.role ?? ''}\n${character.traits.join(' ')}\n${bodyOf(character.descriptionWriting)}\n${bodyOf(character.motivationWriting)}\n${bodyOf(character.arcWriting)}` });
  for (const location of locations) candidates.push({ surface: 'location', id: location.id, label: location.name, text: `${location.name}\n${location.type ?? ''}\n${bodyOf(location.descriptionWriting)}` });
  for (const [surface, rows] of [['artifact', artifacts], ['canon', canon], ['timeline', timeline], ['thread', threads], ['loop', loops]] as const) {
    for (const row of rows) candidates.push({ surface, id: String(row.id), label: String(row.title ?? row.key ?? row.id), text: JSON.stringify(row) });
  }
  const matches = candidates
    .map((candidate) => scoreCandidate(candidate, input.query, Boolean(input.exact)))
    .filter((candidate): candidate is SearchResult => candidate !== null)
    .sort((a, b) => b.score - a.score || a.label.localeCompare(b.label))
    .slice(0, limit);
  return { query: input.query, strategy: input.exact ? 'exact' : 'hybrid-lexical', matches, truncated: matches.length === limit };
}

async function findReferences(prisma: PrismaClient, projectId: string, input: { entityId: string; label?: string; limit?: number }) {
  const label = input.label ?? await resolveEntityLabel(prisma, projectId, input.entityId);
  const terms = [...new Set([input.entityId, label].filter((value): value is string => Boolean(value)))];
  const all = (await Promise.all(terms.map((query) => searchStory(prisma, projectId, { query, exact: false, limit: input.limit ?? 100 })))).flatMap((result) => result.matches);
  const references = [...new Map(all.filter((match) => match.id !== input.entityId).map((match) => [`${match.surface}:${match.id}:${match.line ?? 0}`, match])).values()]
    .slice(0, input.limit ?? 100);
  return { entityId: input.entityId, label, references, count: references.length };
}

async function queryOpenLoopsAtTask(
  prisma: PrismaClient,
  projectId: string,
  input: { buildRunId: string; page?: number; limit?: number; kind?: OpenLoopKind; status?: OpenLoopStatus },
  taskContract: TaskContract | null
) {
  await assertBuildScope(prisma, projectId, input.buildRunId);
  const page = pagination(input);
  const targetOrder = boundedTaskStoryOrder(taskContract, undefined);
  const rows = await prisma.openLoop.findMany({
    where: {
      projectId,
      buildRunId: input.buildRunId,
      isCurrent: true,
      invalidatedAt: null,
      ...(input.kind ? { kind: input.kind } : {}),
      ...(input.status ? { status: input.status } : { status: { in: ['OPEN', 'REINFORCED'] } })
    },
    orderBy: [{ updatedAt: 'desc' }, { createdAt: 'desc' }],
    take: 5_000,
    include: { sourceUnit: { include: { parentUnit: { select: { order: true } } } } }
  });
  const visible = targetOrder === undefined ? rows : rows.filter((row) => !row.sourceUnit || (row.sourceUnit.parentUnit?.order ?? 0) * 10_000 + row.sourceUnit.order <= targetOrder);
  const items = visible.slice(page.offset, page.offset + page.limit).map(({ sourceUnit: _sourceUnit, ...row }) => row);
  return { items, total: visible.length, page: page.page, limit: page.limit, nextPage: page.offset + items.length < visible.length ? page.page + 1 : null, truncatedAt: rows.length === 5_000 ? 5_000 : null };
}

async function commitCanonDelta(prisma: PrismaClient, projectId: string, input: CanonDeltaInput, executionLease: BuildTaskLeaseInput | null) {
  const run = await assertBuildScope(prisma, projectId, input.buildRunId);
  if (jsonRecord(run.authorizationScope).allowCanonWrites !== true) throw new HttpError(403, 'Build is not authorized to write canon');
  const operations: StoryStateBatchOperation[] = [
    ...input.facts.map((fact) => ({ op: 'upsert-canon-fact' as const, value: {
      sourceArtifactId: fact.sourceArtifactId ?? null,
      sourceUnitId: input.sourceUnitId ?? null,
      key: fact.key,
      subjectType: fact.subjectType,
      subjectId: fact.subjectId,
      predicate: fact.predicate,
      object: fact.object,
      status: fact.status.toLowerCase(),
      validFromSceneId: fact.validFromSceneId ?? null,
      validToSceneId: fact.validToSceneId ?? null,
      validFromOrder: fact.validFromOrder ?? null,
      validToOrder: fact.validToOrder ?? null,
      sourceChapterId: fact.sourceChapterId ?? null,
      sourceSceneId: fact.sourceSceneId ?? null,
      sourceSpan: fact.sourceSpan ?? null,
      confidence: fact.confidence
    } })),
    ...input.entityStates.map((state) => ({ op: 'upsert-entity-state' as const, value: {
      sourceArtifactId: state.sourceArtifactId ?? null,
      sourceUnitId: input.sourceUnitId ?? null,
      sourceFactId: null,
      key: state.key,
      entityType: state.entityType,
      entityId: state.entityId,
      stateKey: state.stateKey,
      value: state.value,
      status: state.status.toLowerCase(),
      validFromSceneId: state.validFromSceneId ?? null,
      validToSceneId: state.validToSceneId ?? null,
      validFromOrder: state.validFromOrder ?? null,
      validToOrder: state.validToOrder ?? null,
      storyOrder: state.storyOrder ?? null,
      sourceSpan: state.sourceSpan ?? null
    } })),
    ...input.timelineEvents.map((event) => ({ op: 'upsert-timeline-event' as const, value: {
      sourceArtifactId: event.sourceArtifactId ?? null,
      sourceUnitId: input.sourceUnitId ?? null,
      key: event.key,
      title: event.title,
      description: event.description ?? null,
      chronology: event.chronology,
      sortOrder: event.sortOrder ?? null,
      chapterId: event.chapterId ?? null,
      sceneId: event.sceneId ?? null,
      dependencyIds: event.dependencyIds,
      participantRefs: event.participantRefs,
      sourceSpan: event.sourceSpan ?? null
    } })),
    ...input.openLoops.map((loop) => ({ op: 'upsert-open-loop' as const, value: {
      key: loop.key,
      sourceUnitId: input.sourceUnitId ?? null,
      kind: loop.kind.toLowerCase(),
      status: loop.status.toLowerCase(),
      title: loop.title,
      description: loop.description,
      introducedSceneId: loop.introducedSceneId ?? null,
      resolvedSceneId: loop.resolvedSceneId ?? null,
      introducedArtifactId: loop.introducedArtifactId ?? null,
      resolvedArtifactId: loop.resolvedArtifactId ?? null,
      targetPayoff: loop.targetPayoff ?? null,
      metadata: loop.metadata ?? null
    } }))
  ] as StoryStateBatchOperation[];
  const applied = await new StoryStateUseCase(prisma).applyStateBatch(
    requiredUserId(run),
    projectId,
    input.buildRunId,
    { idempotencyKey: input.idempotencyKey, expectedBuildRevision: run.revision, operations },
    executionLease ? { lease: executionLease } : {}
  );
  return {
    ok: true,
    idempotencyKey: input.idempotencyKey,
    buildRevision: applied.buildRevision,
    counts: { facts: input.facts.length, entityStates: input.entityStates.length, timelineEvents: input.timelineEvents.length, openLoops: input.openLoops.length },
    ids: { facts: applied.canonFacts.filter((item) => input.facts.some((fact) => fact.key === item.key)).map((item) => item.id), entityStates: applied.entityStates.filter((item) => input.entityStates.some((state) => state.key === item.key)).map((item) => item.id), timelineEvents: applied.timelineEvents.filter((item) => input.timelineEvents.some((event) => event.key === item.key)).map((item) => item.id), openLoops: applied.openLoops.filter((item) => input.openLoops.some((loop) => loop.key === item.key)).map((item) => item.id) }
  };
}

async function linkSetupPayoff(prisma: PrismaClient, projectId: string, input: SetupPayoffInput, executionLease: BuildTaskLeaseInput | null) {
  const run = await assertBuildScope(prisma, projectId, input.buildRunId);
  if (jsonRecord(run.authorizationScope).allowCanonWrites !== true) throw new HttpError(403, 'Build is not authorized to write canon');
  const applied = await new StoryStateUseCase(prisma).applyStateBatch(
    requiredUserId(run),
    projectId,
    input.buildRunId,
    {
      idempotencyKey: input.idempotencyKey,
      expectedBuildRevision: run.revision,
      operations: [{ op: 'upsert-setup-payoff', value: {
        sourceUnitId: input.sourceUnitId ?? null,
        plotThreadId: input.plotThreadId ?? null,
        key: input.key,
        title: input.title,
        description: input.description,
        status: input.status.toLowerCase().replace('_', '-') as SetupPayoffStatus,
        setupSceneId: input.setupSceneId ?? null,
        payoffSceneId: input.payoffSceneId ?? null,
        reinforcementSceneIds: input.reinforcementSceneIds,
        setupArtifactId: input.setupArtifactId ?? null,
        payoffArtifactId: input.payoffArtifactId ?? null,
        metadata: jsonValue(input.metadata)
      } }]
    },
    executionLease ? { lease: executionLease } : {}
  );
  const saved = applied.setupPayoffs.find((item) => item.key === input.key);
  return { ok: true, id: saved?.id, key: saved?.key ?? input.key, status: saved?.status, buildRevision: applied.buildRevision };
}

export async function runStoryLint(prisma: PrismaClient, projectId: string, input: { buildRunId?: string; chapterIds?: string[]; userId?: string }) {
  const chapters = input.buildRunId ? [] : await prisma.chapter.findMany({
    where: { projectId, deletedAt: null, ...(input.chapterIds?.length ? { id: { in: input.chapterIds } } : {}) },
    orderBy: { number: 'asc' },
    take: 200,
    include: { bodyWriting: { include: { defaultBranch: { include: { headVersion: true } } } }, scenes: { orderBy: { order: 'asc' } } }
  });
  const issues: StoryLintIssue[] = [];
  if (input.buildRunId && input.userId) {
    const semantic = await new StoryStateUseCase(prisma).diagnostics(input.userId, projectId, input.buildRunId);
    for (const diagnostic of semantic.diagnostics) issues.push({
      code: diagnostic.code,
      severity: diagnostic.severity,
      message: diagnostic.message,
      evidence: diagnostic.relatedRefs.length
        ? diagnostic.relatedRefs.map((ref) => ({ type: ref.type, id: ref.id }))
        : diagnostic.evidence.map((span) => ({ type: span.sceneId ? 'scene' : span.chapterId ? 'chapter' : 'artifact', id: span.sceneId ?? span.chapterId ?? span.artifactId ?? diagnostic.id, quote: span.quote }))
    });
  }
  if (input.buildRunId) {
    const units = await dynamicFindMany(prisma, 'buildManuscriptUnit', { projectId, buildRunId: input.buildRunId, invalidatedAt: null }, 5_000);
    for (const unit of units) {
      const branch = await prisma.writingBranch.findFirst({ where: { id: String(unit.branchId), buildRunId: input.buildRunId }, include: { headVersion: true } });
      if (!branch) {
        issues.push(lintIssue('workflow/missing-build-branch', 'error', String(unit.id), `Build unit ${String(unit.key)} has no build-bound branch.`, 'build-unit'));
        continue;
      }
      const body = branch.headVersion?.body ?? '';
      if (String(unit.status) !== 'PLANNED' && !branch.headVersionId) issues.push(lintIssue('workflow/missing-build-head', 'error', String(unit.id), `Build unit ${String(unit.key)} has no head version.`, 'build-unit'));
      if (body.trim() && body.split(/\s+/).length < 20) issues.push(lintIssue('pacing/very-short-unit', 'info', String(unit.id), `Build unit ${String(unit.key)} contains fewer than 20 words.`, 'build-unit'));
    }
  }
  for (const chapter of chapters) {
    const body = bodyOf(chapter.bodyWriting);
    if (body.trim() && body.split(/\s+/).length < 100) issues.push(lintIssue('pacing/very-short-chapter', 'info', chapter.id, `Chapter ${chapter.number} contains fewer than 100 words.`, 'chapter'));
  }
  if (input.buildRunId) {
    await assertBuildScope(prisma, projectId, input.buildRunId);
    const facts = await dynamicFindMany(prisma, 'canonFact', { projectId, buildRunId: input.buildRunId, status: 'CANONICAL', isCurrent: true, invalidatedAt: null }, 1_000);
    const groups = new Map<string, Record<string, unknown>[]>();
    for (const fact of facts) {
      const key = `${String(fact.subjectType)}:${String(fact.subjectId)}:${String(fact.predicate)}`;
      groups.set(key, [...(groups.get(key) ?? []), fact]);
    }
    for (const factsAtPoint of groups.values()) {
      const conflicting = factsAtPoint.filter((fact, index) => factsAtPoint.slice(index + 1).some((other) => stableJson(fact.object) !== stableJson(other.object) && storyIntervalsOverlap(fact, other)));
      if (conflicting.length) issues.push({
        code: 'canon/conflicting-facts',
        severity: 'error',
        message: `Conflicting canonical values for ${factsAtPoint[0].subjectType}:${factsAtPoint[0].subjectId} ${factsAtPoint[0].predicate}.`,
        evidence: factsAtPoint.filter((fact) => conflicting.some((candidate) => storyIntervalsOverlap(candidate, fact) && stableJson(candidate.object) !== stableJson(fact.object))).map((fact) => ({ type: 'canon', id: String(fact.id), quote: stableJson(fact.object) }))
      });
    }
  }
  return {
    generatedAt: new Date().toISOString(),
    counts: {
      error: issues.filter((issue) => issue.severity === 'error').length,
      warning: issues.filter((issue) => issue.severity === 'warning').length,
      info: issues.filter((issue) => issue.severity === 'info').length
    },
    issues
  };
}

async function getArcState(prisma: PrismaClient, projectId: string, input: { buildRunId?: string; characterId?: string; plotThreadId?: string }) {
  if (input.characterId) {
    const character = await prisma.character.findFirst({
      where: { id: input.characterId, projectId },
      include: { arcWriting: { include: { defaultBranch: { include: { headVersion: true } } } }, povChapters: { where: { deletedAt: null }, orderBy: { number: 'asc' }, select: { id: true, number: true, title: true, summary: true } }, povScenes: { orderBy: { order: 'asc' }, select: { id: true, title: true, order: true, chapterId: true } } }
    });
    if (character) {
      const states = input.buildRunId ? await dynamicFindMany(prisma, 'entityState', { projectId, buildRunId: input.buildRunId, entityType: 'character', entityId: input.characterId, status: 'ACTIVE', isCurrent: true, invalidatedAt: null }, 100) : [];
      return { type: 'character', id: character.id, name: character.name, aliases: character.aliases, arc: bodyOf(character.arcWriting), povChapters: character.povChapters, povScenes: character.povScenes, currentStates: states };
    }
    if (input.buildRunId) {
      const artifact = await prisma.storyArtifact.findFirst({
        where: { projectId, buildRunId: input.buildRunId, type: 'CHARACTER_BIBLE', invalidatedAt: null, OR: [{ id: input.characterId }, { key: input.characterId }] },
        orderBy: { version: 'desc' }
      });
      if (artifact) {
        const content = jsonRecord(artifact.content);
        const entityId = typeof content.characterKey === 'string' ? content.characterKey : artifact.key;
        const states = await dynamicFindMany(prisma, 'entityState', { projectId, buildRunId: input.buildRunId, entityType: 'character', entityId, status: 'ACTIVE', isCurrent: true, invalidatedAt: null }, 100);
        return { type: 'character-artifact', id: artifact.id, key: artifact.key, name: content.name, aliases: content.aliases, arc: content.arc, content, currentStates: states };
      }
    }
    throw new HttpError(404, 'Character not found');
  }
  const thread = await delegate(prisma, 'plotThread').findFirst({ where: { id: input.plotThreadId, projectId, invalidatedAt: null } });
  if (!thread) throw new HttpError(404, 'Plot thread not found');
  const links = await dynamicFindMany(prisma, 'setupPayoffLink', { projectId, plotThreadId: thread.id, invalidatedAt: null }, 100);
  return { type: 'plot-thread', ...thread, setupPayoffs: links };
}

async function compareVersions(prisma: PrismaClient, projectId: string, input: { fromVersionId: string; toVersionId: string }, buildRunId?: string) {
  const versions = await prisma.writingVersion.findMany({
    where: { id: { in: [input.fromVersionId, input.toVersionId] }, branch: { ...(buildRunId ? { buildRunId } : {}), writing: { projectId } } },
    include: { branch: { select: { writingId: true } } }
  });
  const from = versions.find((version) => version.id === input.fromVersionId);
  const to = versions.find((version) => version.id === input.toVersionId);
  if (!from || !to) throw new HttpError(404, 'One or both writing versions were not found');
  if (from.branch.writingId !== to.branch.writingId) throw new HttpError(400, 'Versions must belong to the same writing');
  const fromBody = from.body ?? '';
  const toBody = to.body ?? '';
  const fromLines = new Set(fromBody.split(/\r?\n/).filter(Boolean));
  const toLines = new Set(toBody.split(/\r?\n/).filter(Boolean));
  const removed = [...fromLines].filter((line) => !toLines.has(line)).slice(0, 100);
  const added = [...toLines].filter((line) => !fromLines.has(line)).slice(0, 100);
  return {
    fromVersionId: from.id,
    toVersionId: to.id,
    wordCountDelta: to.wordCount - from.wordCount,
    contentHashChanged: sha256(fromBody) !== sha256(toBody),
    lineChanges: { added, removed, truncated: added.length >= 100 || removed.length >= 100 },
    entityMentionDelta: mentionDelta(fromBody, toBody)
  };
}

interface SearchCandidate { surface: string; id: string; label: string; text: string }
interface SearchResult extends SearchCandidate { score: number; excerpt: string; line?: number }
interface StoryLintIssue { code: string; severity: 'info' | 'warning' | 'error'; message: string; evidence: Array<{ type: string; id: string; quote?: string }> }

function scoreCandidate(candidate: SearchCandidate, query: string, exact: boolean): SearchResult | null {
  const haystack = candidate.text.toLowerCase();
  const needle = query.toLowerCase();
  const index = haystack.indexOf(needle);
  const words = needle.split(/[^a-z0-9]+/).filter((word) => word.length > 1);
  const matches = words.filter((word) => haystack.includes(word)).length;
  if (exact && index < 0) return null;
  if (!exact && index < 0 && matches === 0) return null;
  const labelExact = candidate.label.toLowerCase() === needle;
  const score = (labelExact ? 100 : 0) + (index >= 0 ? 50 : 0) + matches / Math.max(words.length, 1) * 20;
  const start = Math.max(0, index >= 0 ? index - 180 : 0);
  return { ...candidate, score, excerpt: candidate.text.slice(start, start + 500), line: index >= 0 ? candidate.text.slice(0, index).split(/\r?\n/).length : undefined };
}

async function resolveEntityLabel(prisma: PrismaClient, projectId: string, id: string): Promise<string | undefined> {
  const [character, location, chapter, artifact] = await Promise.all([
    prisma.character.findFirst({ where: { id, projectId }, select: { name: true } }),
    prisma.location.findFirst({ where: { id, projectId }, select: { name: true } }),
    prisma.chapter.findFirst({ where: { id, projectId }, select: { title: true } }),
    delegate(prisma, 'storyArtifact').findFirst({ where: { id, projectId }, select: { title: true } }).catch(() => null)
  ]);
  const artifactTitle = typeof artifact?.title === 'string' ? artifact.title : undefined;
  return character?.name ?? location?.name ?? chapter?.title ?? artifactTitle;
}

async function assertBuildScope(prisma: PrismaClient, projectId: string, buildRunId: string): Promise<BuildScopeRow> {
  const run = await delegate(prisma, 'buildRun').findFirst({ where: { id: buildRunId, projectId }, select: { id: true, authorizationScope: true, authorizedById: true, createdById: true, revision: true } });
  if (!run) throw new HttpError(404, 'Build run not found');
  if (typeof run.id !== 'string' || typeof run.revision !== 'number') throw new HttpError(500, 'Build scope query returned an invalid record');
  return {
    id: run.id,
    authorizationScope: run.authorizationScope,
    authorizedById: typeof run.authorizedById === 'string' ? run.authorizedById : null,
    createdById: typeof run.createdById === 'string' ? run.createdById : null,
    revision: run.revision
  };
}

function delegate(client: unknown, name: string): DynamicDelegate {
  const value = (client as Record<string, unknown>)[name] as DynamicDelegate | undefined;
  if (!value) throw new HttpError(503, `Story-state model ${name} is unavailable; run the current database migration`);
  return value;
}

async function dynamicFindMany(client: unknown, name: string, where: unknown, take: number): Promise<Record<string, unknown>[]> {
  try {
    return await delegate(client, name).findMany({ where, take, orderBy: { updatedAt: 'desc' } });
  } catch (error) {
    if (error instanceof HttpError) throw error;
    return [];
  }
}

function lintIssue(code: string, severity: StoryLintIssue['severity'], id: string, message: string, type: string): StoryLintIssue {
  return { code, severity, message, evidence: [{ type, id }] };
}

function mentionDelta(from: string, to: string): Array<{ mention: string; delta: number }> {
  const count = (value: string) => {
    const map = new Map<string, number>();
    for (const match of value.matchAll(/\b[A-Z][a-z]{2,}(?:\s+[A-Z][a-z]{2,})?\b/g)) map.set(match[0], (map.get(match[0]) ?? 0) + 1);
    return map;
  };
  const before = count(from);
  const after = count(to);
  return [...new Set([...before.keys(), ...after.keys()])]
    .map((mention) => ({ mention, delta: (after.get(mention) ?? 0) - (before.get(mention) ?? 0) }))
    .filter((item) => item.delta !== 0)
    .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta))
    .slice(0, 50);
}

function stableJson(value: unknown): string {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return JSON.stringify(value);
  return JSON.stringify(Object.fromEntries(Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b))));
}

function storyIntervalsOverlap(left: Record<string, unknown>, right: Record<string, unknown>): boolean {
  const hasNumericBounds = [left.validFromOrder, left.validToOrder, right.validFromOrder, right.validToOrder].some((value) => typeof value === 'number');
  if (hasNumericBounds) {
    const leftFrom = typeof left.validFromOrder === 'number' ? left.validFromOrder : Number.NEGATIVE_INFINITY;
    const leftTo = typeof left.validToOrder === 'number' ? left.validToOrder : Number.POSITIVE_INFINITY;
    const rightFrom = typeof right.validFromOrder === 'number' ? right.validFromOrder : Number.NEGATIVE_INFINITY;
    const rightTo = typeof right.validToOrder === 'number' ? right.validToOrder : Number.POSITIVE_INFINITY;
    return leftFrom <= rightTo && rightFrom <= leftTo;
  }
  const leftFromScene = typeof left.validFromSceneId === 'string' ? left.validFromSceneId : null;
  const leftToScene = typeof left.validToSceneId === 'string' ? left.validToSceneId : null;
  const rightFromScene = typeof right.validFromSceneId === 'string' ? right.validFromSceneId : null;
  const rightToScene = typeof right.validToSceneId === 'string' ? right.validToSceneId : null;
  if (!leftFromScene && !leftToScene && !rightFromScene && !rightToScene) return true;
  return Boolean(
    (leftFromScene && (leftFromScene === rightFromScene || leftFromScene === rightToScene))
    || (leftToScene && (leftToScene === rightFromScene || leftToScene === rightToScene))
  );
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function jsonRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function boundedTaskStoryOrder(taskContract: TaskContract | null, requested: number | undefined): number | undefined {
  const target = taskContract?.metadata.targetStoryOrder;
  if (typeof target !== 'number' || !Number.isFinite(target)) return requested;
  return requested === undefined ? target : Math.min(requested, target);
}

function searchKindsForSurface(surface: string): StorySearchKind[] {
  const map: Record<string, StorySearchKind[]> = {
    chapters: ['chapter'],
    scenes: ['scene'],
    docs: ['doc'],
    characters: ['character'],
    locations: ['location'],
    artifacts: ['artifact'],
    canon: ['canon-fact'],
    timeline: ['timeline-event'],
    threads: ['plot-thread'],
    loops: ['open-loop']
  };
  return map[surface] ?? [];
}

function requiredUserId(run: { authorizedById?: string | null; createdById?: string | null }): string {
  const userId = run.authorizedById ?? run.createdById;
  if (!userId) throw new HttpError(409, 'Build has no authorizing user');
  return userId;
}

function jsonValue(value: unknown): JsonValue {
  const normalized = value ?? null;
  assertJsonValue(normalized);
  return normalized;
}
