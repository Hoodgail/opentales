import type { PrismaClient } from '@prisma/client';
import type {
  ApproveBuildReviewInput,
  AuthorizeBuildRunInput,
  BranchBuildFromCheckpointInput,
  BuildAuthorizationScope,
  CompileBuildManuscriptInput,
  CreateBuildManuscriptUnitInput,
  CreateBuildReviewInput,
  MergeBuildReviewInput,
  PatchBuildManuscriptUnitInput,
  RejectBuildReviewInput,
  ReorderBuildManuscriptUnitsInput,
  ReplanBuildInput,
  UnpinBuildArtifactsInput
} from '@opentales/sdk';
import { tool, type Tool } from 'ai';
import { z } from 'zod';
import { HttpError } from '../../../http/HttpError.js';
import { ProjectAccessRepository } from '../../../repositories/ProjectAccessRepository.js';
import { BuildManuscriptUseCase } from '../../novelBuild/BuildManuscriptUseCase.js';
import { NovelBuildUseCase } from '../../novelBuild/NovelBuildUseCase.js';
import { StoryStateUseCase } from '../../novelBuild/StoryStateUseCase.js';
import { toStoryArtifact } from '../../novelBuild/novelBuildMapper.js';
import { contentPatchInputSchema, invocationToolCallId, type AgentToolInvocationContext, type ToolContext } from './shared.js';

export const buildWorkspaceMutatingToolNames = [
  'authorizeNovelBuild',
  'pauseNovelBuild',
  'cancelNovelBuild',
  'replanNovelBuild',
  'branchBuildFromCheckpoint',
  'createBuildUnit',
  'updateBuildUnit',
  'invalidateBuildUnit',
  'reorderBuildUnits',
  'compileBuild',
  'createBuildReview',
  'approveBuildReview',
  'mergeBuildReview',
  'rejectBuildReview',
  'unpinBuildArtifacts'
] as const;

export type BuildWorkspaceMutatingToolName = (typeof buildWorkspaceMutatingToolNames)[number];

export interface BuildWorkspaceApprovalHandler {
  handleApproval(
    toolName: BuildWorkspaceMutatingToolName,
    input: unknown,
    execute: () => Promise<unknown>,
    toolCallId: string,
    abortSignal?: AbortSignal
  ): Promise<unknown>;
}

const artifactTypeSchema = z.enum([
  'story-brief', 'narrative-contract', 'character-bible', 'relationship-graph', 'world-bible',
  'plot-thread', 'act-architecture', 'chapter-brief', 'scene-plan', 'timeline', 'setup-payoff-map',
  'research-questions', 'open-questions', 'beat', 'chapter-draft', 'revision-issue', 'finale-plan',
  'export-manifest'
]);
const id = z.string().trim().min(1);
const idempotencyKey = id.describe('Unique key for this logical operation; reuse it only to retry identical input.');
const expectedRevision = z.number().int().nonnegative();
const buildLifecycleSchema = z.object({
  buildRunId: id,
  idempotencyKey,
  expectedRevision,
  reason: z.string().trim().min(1).max(1_000).optional()
}).strict();
const authorizationScopeSchema = z.object({
  artifactTypes: z.array(artifactTypeSchema),
  chapterIds: z.array(id),
  sceneIds: z.array(id),
  allowPlanningArtifacts: z.boolean(),
  allowCanonWrites: z.boolean(),
  allowChapterWrites: z.boolean(),
  allowSceneWrites: z.boolean(),
  allowDiagnostics: z.boolean(),
  expiresAt: z.string().datetime().nullable().optional()
}).strict();
const authorizeSchema = buildLifecycleSchema.extend({
  authorizationScope: authorizationScopeSchema,
  maxTokens: z.number().int().positive().nullable().optional(),
  maxCostMicros: z.number().int().positive().nullable().optional()
}).strict();
const replanSchema = z.object({
  buildRunId: id,
  idempotencyKey,
  expectedRevision,
  fromTaskId: id,
  checkpointId: id.nullable().optional(),
  directive: z.string().trim().min(1).max(50_000),
  pinnedArtifactIds: z.array(id).max(10_000).optional()
}).strict();
const branchSchema = replanSchema.extend({ checkpointId: id }).strict();
const createUnitSchema = z.object({
  buildRunId: id,
  idempotencyKey,
  expectedBuildRevision: expectedRevision,
  kind: z.enum(['chapter', 'scene']),
  key: id.max(500),
  parentUnitId: id.nullable().optional(),
  sourceChapterId: id.nullable().optional(),
  sourceSceneId: id.nullable().optional(),
  planArtifactId: id,
  order: z.number().int().nonnegative(),
  chapterNumber: z.number().int().positive().nullable().optional(),
  title: id.max(1_000),
  povCharacterId: id.nullable().optional(),
  locationId: id.nullable().optional(),
  storyDate: z.string().max(500).nullable().optional(),
  storyTime: z.string().max(500).nullable().optional(),
  tension: z.number().min(0).max(1).nullable().optional(),
  metadata: z.unknown().optional(),
  initialBody: z.string().max(2_000_000).optional()
}).strict();
const updateUnitSchema = z.object({
  buildRunId: id,
  unitId: id,
  idempotencyKey,
  expectedBuildRevision: expectedRevision,
  expectedUnitRevision: expectedRevision,
  expectedHeadVersionId: id.nullable(),
  patch: contentPatchInputSchema.optional(),
  title: id.max(1_000).optional(),
  status: z.enum(['planned', 'drafting', 'review', 'accepted']).optional(),
  tension: z.number().min(0).max(1).nullable().optional(),
  metadata: z.unknown().optional(),
  message: z.string().trim().min(1).max(1_000).optional()
}).strict().refine((input) =>
  input.patch !== undefined || input.title !== undefined || input.status !== undefined ||
  input.tension !== undefined || input.metadata !== undefined,
  'At least one build-unit prose or metadata change is required'
);
const invalidateUnitSchema = z.object({
  buildRunId: id,
  unitId: id,
  idempotencyKey,
  expectedBuildRevision: expectedRevision,
  expectedUnitRevision: expectedRevision,
  expectedHeadVersionId: id.nullable(),
  reason: z.string().trim().min(1).max(1_000).optional()
}).strict();
const reorderUnitsSchema = z.object({
  buildRunId: id,
  idempotencyKey,
  expectedBuildRevision: expectedRevision,
  parentUnitId: id,
  unitIds: z.array(id).min(1),
  expectedUnitRevisions: z.record(z.string(), expectedRevision)
}).strict();
const compileSchema = z.object({
  buildRunId: id,
  idempotencyKey,
  expectedBuildRevision: expectedRevision,
  checkpointId: id.nullable().optional()
}).strict();
const createReviewSchema = z.object({
  buildRunId: id,
  idempotencyKey,
  compilationId: id,
  checkpointId: id.nullable().optional(),
  title: id.max(1_000),
  message: z.string().max(20_000).optional()
}).strict();
const reviewDecisionSchema = z.object({
  buildRunId: id,
  reviewId: id,
  idempotencyKey,
  expectedRevision,
  confirm: z.literal(true)
}).strict();
const rejectReviewSchema = reviewDecisionSchema.extend({
  reason: z.string().trim().min(1).max(20_000)
}).strict();
const unpinSchema = z.object({
  buildRunId: id,
  idempotencyKey,
  expectedRevision,
  artifactIds: z.array(id).min(1).max(10_000)
}).strict();

const schemas = {
  authorizeNovelBuild: authorizeSchema,
  pauseNovelBuild: buildLifecycleSchema,
  cancelNovelBuild: buildLifecycleSchema,
  replanNovelBuild: replanSchema,
  branchBuildFromCheckpoint: branchSchema,
  createBuildUnit: createUnitSchema,
  updateBuildUnit: updateUnitSchema,
  invalidateBuildUnit: invalidateUnitSchema,
  reorderBuildUnits: reorderUnitsSchema,
  compileBuild: compileSchema,
  createBuildReview: createReviewSchema,
  approveBuildReview: reviewDecisionSchema,
  mergeBuildReview: reviewDecisionSchema,
  rejectBuildReview: rejectReviewSchema,
  unpinBuildArtifacts: unpinSchema
} satisfies Record<BuildWorkspaceMutatingToolName, z.ZodTypeAny>;

const descriptions: Record<BuildWorkspaceMutatingToolName, string> = {
  authorizeNovelBuild: 'Authorize a paused Plan & Review checkpoint or update a build authorization scope. Requires admin permission, a complete finite scope, current build revision, and explicit budgets for Autonomous Draft.',
  pauseNovelBuild: 'Pause a non-terminal Novel Build and invalidate active worker leases using the current build revision.',
  cancelNovelBuild: 'Cancel a Novel Build and invalidate pending/running work. This is destructive and cannot be used on a completed build.',
  replanNovelBuild: 'Invalidate a task boundary and its transitive downstream work, preserve explicitly pinned artifacts, and persist a replacement author directive.',
  branchBuildFromCheckpoint: 'Create a new Novel Build branch from an immutable checkpoint with an explicit directive and pinned artifacts.',
  createBuildUnit: 'Create an isolated chapter or scene unit from a current validated plan artifact. This writes only the build branch, never canonical main.',
  updateBuildUnit: 'Edit an isolated build unit with build/unit/head compare-and-swap guards. Use patch.mode=replace for empty/full bodies or patch.mode=edit for exact replacements; status=accepted satisfies compilation gates.',
  invalidateBuildUnit: 'Remove an isolated build unit from active compilation by marking it invalidated with compare-and-swap guards. Immutable history is retained.',
  reorderBuildUnits: 'Atomically reorder every active scene unit under one build chapter using current build and unit revisions.',
  compileBuild: 'Compile accepted build units into an immutable manuscript snapshot. This does not merge canonical chapters or scenes.',
  createBuildReview: 'Freeze an exact compilation and unit revisions into a review proposal for owner approval and merge.',
  approveBuildReview: 'Owner-only explicit approval of an open build review. Requires confirm=true and the review revision.',
  mergeBuildReview: 'Owner-only merge of an approved frozen build review into canonical main. Requires confirm=true; stale main or drift is rejected.',
  rejectBuildReview: 'Owner-only rejection of an open or approved build review with a reason and confirm=true.',
  unpinBuildArtifacts: 'Remove selected artifacts from the active build directive while retaining immutable history.'
};

export function buildWorkspaceTools(
  prisma: PrismaClient,
  context: ToolContext & { userId: string },
  approval: BuildWorkspaceApprovalHandler
) {
  const reads = {
    listBuildArtifacts: tool({
      description: 'List bounded build artifact metadata without content. Use readBuildArtifact for one selected artifact body.',
      inputSchema: z.object({
        buildRunId: id,
        types: z.array(artifactTypeSchema).max(20).optional(),
        statuses: z.array(z.enum(['draft', 'validated', 'accepted', 'superseded', 'invalidated'])).max(5).optional(),
        taskId: id.optional(),
        limit: z.number().int().min(1).max(100).default(20),
        offset: z.number().int().nonnegative().default(0)
      }).strict(),
      execute: async ({ buildRunId, ...input }) => {
        const page = await new StoryStateUseCase(prisma).listArtifacts(context.userId, context.projectId, buildRunId, input);
        return {
          ...page,
          items: page.items.map(({ content: _content, ...artifact }) => artifact)
        };
      }
    }),
    readBuildArtifact: tool({
      description: 'Read one exact schema-versioned build artifact, including content and provenance. Resolve the artifact ID with listBuildArtifacts or getBuildState first.',
      inputSchema: z.object({ buildRunId: id, artifactId: id }).strict(),
      execute: async ({ buildRunId, artifactId }) => {
        await new ProjectAccessRepository(prisma).assertProjectAccess(context.userId, context.projectId);
        const artifact = await prisma.storyArtifact.findFirst({
          where: { id: artifactId, projectId: context.projectId, buildRunId },
          include: { bindings: true, outgoingLinks: true, incomingLinks: true }
        });
        if (!artifact) throw new HttpError(404, 'Build artifact not found');
        return {
          ...toStoryArtifact(artifact),
          bindings: artifact.bindings,
          outgoingLinks: artifact.outgoingLinks,
          incomingLinks: artifact.incomingLinks
        };
      }
    }),
    readBuildCompilation: tool({
      description: 'Read one immutable build compilation manifest and its frozen unit/version hashes.',
      inputSchema: z.object({ buildRunId: id, compilationId: id }).strict(),
      execute: async ({ buildRunId, compilationId }) =>
        new BuildManuscriptUseCase(prisma).getCompilation(context.userId, context.projectId, buildRunId, compilationId)
    }),
    compareBuildManuscript: tool({
      description: 'Compare the latest build compilation with canonical main. Bodies are omitted by default; pass includeBodies=true only for a focused unit.',
      inputSchema: z.object({
        buildRunId: id,
        unitId: id.optional(),
        includeBodies: z.boolean().default(false)
      }).strict(),
      execute: async ({ buildRunId, unitId, includeBodies }) => {
        const comparison = await new BuildManuscriptUseCase(prisma).compare(context.userId, context.projectId, buildRunId);
        const prose = comparison.prose
          .filter((item) => !unitId || item.unitId === unitId)
          .map((item) => includeBodies ? item : withoutBodies(item));
        return { ...comparison, prose };
      }
    }),
    listBuildReviews: tool({
      description: 'List compact build-review summaries without frozen manuscript bodies.',
      inputSchema: z.object({ buildRunId: id }).strict(),
      execute: async ({ buildRunId }) => (await new BuildManuscriptUseCase(prisma).listReviews(context.userId, context.projectId, buildRunId))
        .map(compactReview)
    }),
    readBuildReview: tool({
      description: 'Read one build review. Frozen unit bodies are omitted by default to protect context; set includeBodies=true only when needed.',
      inputSchema: z.object({ buildRunId: id, reviewId: id, includeBodies: z.boolean().default(false) }).strict(),
      execute: async ({ buildRunId, reviewId, includeBodies }) => {
        const review = await new BuildManuscriptUseCase(prisma).getReview(context.userId, context.projectId, buildRunId, reviewId);
        return includeBodies ? review : {
          ...review,
          units: review.units.map(({ reviewedBody: _body, ...unit }) => unit)
        };
      }
    })
  };

  const writes = Object.fromEntries(buildWorkspaceMutatingToolNames.map((name) => [
    name,
    workspaceTool({
      description: descriptions[name],
      inputSchema: schemas[name],
      execute: async (rawInput: unknown, options?: AgentToolInvocationContext) => {
        const input = parse(name, rawInput);
        return approval.handleApproval(
          name,
          input,
          () => executeBuildWorkspaceMutation(prisma, context, name, input),
          invocationToolCallId(options),
          options?.abortSignal
        );
      }
    })
  ]));
  return { ...reads, ...writes };
}

function workspaceTool(config: Tool<any, any>): Tool<any, any> {
  return tool(config) as Tool<any, any>;
}

export async function executeBuildWorkspaceMutation(
  prisma: PrismaClient,
  context: ToolContext & { userId: string },
  toolName: string,
  rawInput: Record<string, unknown>
) {
  if (!(buildWorkspaceMutatingToolNames as readonly string[]).includes(toolName)) {
    throw new HttpError(400, `Build workspace mutation '${toolName}' is not implemented`);
  }
  const name = toolName as BuildWorkspaceMutatingToolName;
  const input = parse(name, rawInput);
  const builds = new NovelBuildUseCase(prisma);
  const manuscript = new BuildManuscriptUseCase(prisma);

  if (name === 'authorizeNovelBuild') {
    const value = authorizeSchema.parse(input);
    return compactBuild(await builds.authorize(context.userId, context.projectId, value.buildRunId, {
      idempotencyKey: value.idempotencyKey,
      expectedRevision: value.expectedRevision,
      reason: value.reason,
      authorizationScope: value.authorizationScope as BuildAuthorizationScope,
      maxTokens: value.maxTokens,
      maxCostMicros: value.maxCostMicros
    } satisfies AuthorizeBuildRunInput));
  }
  if (name === 'pauseNovelBuild' || name === 'cancelNovelBuild') {
    const value = buildLifecycleSchema.parse(input);
    const method = name === 'pauseNovelBuild' ? builds.pause.bind(builds) : builds.cancel.bind(builds);
    return compactBuild(await method(context.userId, context.projectId, value.buildRunId, value));
  }
  if (name === 'replanNovelBuild') {
    const value = replanSchema.parse(input);
    return builds.replan(context.userId, context.projectId, value.buildRunId, withoutBuildRunId(value) as ReplanBuildInput);
  }
  if (name === 'branchBuildFromCheckpoint') {
    const value = branchSchema.parse(input);
    return builds.branchFromCheckpoint(context.userId, context.projectId, value.buildRunId, withoutBuildRunId(value) as BranchBuildFromCheckpointInput);
  }
  if (name === 'createBuildUnit') {
    const value = createUnitSchema.parse(input);
    return compactUnit(await manuscript.create(context.userId, context.projectId, value.buildRunId, withoutBuildRunId(value) as CreateBuildManuscriptUnitInput));
  }
  if (name === 'updateBuildUnit') {
    const value = updateUnitSchema.parse(input);
    return compactUnit(await manuscript.patch(context.userId, context.projectId, value.buildRunId, value.unitId, {
      idempotencyKey: value.idempotencyKey,
      expectedBuildRevision: value.expectedBuildRevision,
      expectedUnitRevision: value.expectedUnitRevision,
      expectedHeadVersionId: value.expectedHeadVersionId,
      contentPatch: value.patch,
      title: value.title,
      status: value.status,
      tension: value.tension,
      metadata: jsonValue(value.metadata),
      message: value.message
    } satisfies PatchBuildManuscriptUnitInput));
  }
  if (name === 'invalidateBuildUnit') {
    const value = invalidateUnitSchema.parse(input);
    return compactUnit(await manuscript.patch(context.userId, context.projectId, value.buildRunId, value.unitId, {
      idempotencyKey: value.idempotencyKey,
      expectedBuildRevision: value.expectedBuildRevision,
      expectedUnitRevision: value.expectedUnitRevision,
      expectedHeadVersionId: value.expectedHeadVersionId,
      status: 'invalidated',
      message: value.reason ?? 'Invalidate build manuscript unit'
    } satisfies PatchBuildManuscriptUnitInput));
  }
  if (name === 'reorderBuildUnits') {
    const value = reorderUnitsSchema.parse(input);
    return (await manuscript.reorder(context.userId, context.projectId, value.buildRunId, withoutBuildRunId(value) as ReorderBuildManuscriptUnitsInput)).map(compactUnit);
  }
  if (name === 'compileBuild') {
    const value = compileSchema.parse(input);
    return compactCompilation(await manuscript.compile(context.userId, context.projectId, value.buildRunId, {
      idempotencyKey: value.idempotencyKey,
      expectedBuildRevision: value.expectedBuildRevision,
      checkpointId: value.checkpointId
    } satisfies CompileBuildManuscriptInput));
  }
  if (name === 'createBuildReview') {
    const value = createReviewSchema.parse(input);
    return compactReview(await manuscript.createReview(context.userId, context.projectId, value.buildRunId, withoutBuildRunId(value) as CreateBuildReviewInput));
  }
  if (name === 'approveBuildReview' || name === 'mergeBuildReview') {
    const value = reviewDecisionSchema.parse(input);
    const reviewInput = {
      idempotencyKey: value.idempotencyKey,
      expectedRevision: value.expectedRevision,
      confirm: true as const
    };
    const review = name === 'approveBuildReview'
      ? await manuscript.approveReview(context.userId, context.projectId, value.buildRunId, value.reviewId, reviewInput satisfies ApproveBuildReviewInput)
      : await manuscript.mergeReview(context.userId, context.projectId, value.buildRunId, value.reviewId, reviewInput satisfies MergeBuildReviewInput);
    return compactReview(review);
  }
  if (name === 'rejectBuildReview') {
    const value = rejectReviewSchema.parse(input);
    return compactReview(await manuscript.rejectReview(context.userId, context.projectId, value.buildRunId, value.reviewId, {
      idempotencyKey: value.idempotencyKey,
      expectedRevision: value.expectedRevision,
      confirm: true,
      reason: value.reason
    } satisfies RejectBuildReviewInput));
  }
  const value = unpinSchema.parse(input);
  return compactBuild(await manuscript.unpin(context.userId, context.projectId, value.buildRunId, {
    idempotencyKey: value.idempotencyKey,
    expectedRevision: value.expectedRevision,
    artifactIds: value.artifactIds
  } satisfies UnpinBuildArtifactsInput));
}

function parse(name: BuildWorkspaceMutatingToolName, input: unknown): Record<string, unknown> {
  const result = schemas[name].safeParse(input);
  if (!result.success) {
    throw new HttpError(400, `${name} input is invalid: ${result.error.issues.map((issue) =>
      `${issue.path.length ? `${issue.path.join('.')}: ` : ''}${issue.message}`
    ).join('; ')}`);
  }
  return result.data as Record<string, unknown>;
}

function withoutBuildRunId<T extends { buildRunId: string }>(input: T): Omit<T, 'buildRunId'> {
  const { buildRunId: _buildRunId, ...rest } = input;
  return rest;
}

function compactUnit(unit: {
  id: string; buildRunId: string; kind: string; key: string; title: string; status: string;
  parentUnitId: string | null; headVersionId: string | null; revision: number; wordCount: number;
}) {
  return {
    ok: true,
    id: unit.id,
    buildRunId: unit.buildRunId,
    kind: unit.kind,
    key: unit.key,
    title: unit.title,
    status: unit.status,
    parentUnitId: unit.parentUnitId,
    headVersionId: unit.headVersionId,
    revision: unit.revision,
    wordCount: unit.wordCount
  };
}

function compactBuild(run: {
  id: string; status: string; currentPhase: string; revision: number; authorizedAt: string | null;
  maxTokens: number | null; maxCostMicros: number | null; tokensUsed: number; costMicrosUsed: number;
}) {
  return {
    ok: true,
    id: run.id,
    status: run.status,
    currentPhase: run.currentPhase,
    revision: run.revision,
    authorizedAt: run.authorizedAt,
    budget: {
      maxTokens: run.maxTokens,
      maxCostMicros: run.maxCostMicros,
      tokensUsed: run.tokensUsed,
      costMicrosUsed: run.costMicrosUsed
    }
  };
}

function compactCompilation(compilation: {
  id: string; projectId: string; buildRunId: string; checkpointId: string | null;
  totalWordCount: number; contentHash: string; units: unknown[]; createdAt: string;
}) {
  return {
    ok: true,
    id: compilation.id,
    projectId: compilation.projectId,
    buildRunId: compilation.buildRunId,
    checkpointId: compilation.checkpointId,
    totalWordCount: compilation.totalWordCount,
    contentHash: compilation.contentHash,
    unitCount: compilation.units.length,
    createdAt: compilation.createdAt
  };
}

function compactReview(review: {
  id: string; buildRunId: string; compilationId: string; title: string; status: string;
  revision: number; units: unknown[]; createdAt: string; updatedAt: string;
}) {
  return {
    id: review.id,
    buildRunId: review.buildRunId,
    compilationId: review.compilationId,
    title: review.title,
    status: review.status,
    revision: review.revision,
    unitCount: review.units.length,
    createdAt: review.createdAt,
    updatedAt: review.updatedAt
  };
}

function withoutBodies<T extends { mainBody: string; buildBody: string }>(value: T): Omit<T, 'mainBody' | 'buildBody'> {
  const { mainBody: _mainBody, buildBody: _buildBody, ...rest } = value;
  return rest;
}

function jsonValue(value: unknown) {
  if (value === undefined) return undefined;
  return JSON.parse(JSON.stringify(value));
}
