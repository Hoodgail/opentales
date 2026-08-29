import { createHash } from 'node:crypto';
import type { Prisma, PrismaClient } from '@prisma/client';
import type { BuildTaskLeaseInput, JsonValue, StoryArtifactBatchOperation, StoryArtifactType } from '@opentales/sdk';
import { tool } from 'ai';
import { z } from 'zod';
import { HttpError } from '../../../http/HttpError.js';
import { validateArtifactContent } from '../../novelBuild/schemas.js';
import { toPrismaArtifactType } from '../../novelBuild/novelBuildMapper.js';
import { StoryStateUseCase } from '../../novelBuild/StoryStateUseCase.js';
import { NovelBuildUseCase } from '../../novelBuild/NovelBuildUseCase.js';
import { NovelBuildRepository } from '../../../repositories/NovelBuildRepository.js';
import { BuildManuscriptUseCase } from '../../novelBuild/BuildManuscriptUseCase.js';
import type { TaskContract } from '../runtime/taskContract.js';
import { applyContentEdit, countWords, editContentInputSchema, invocationToolCallId, type AgentToolInvocationContext, type ToolContext } from './shared.js';

export const buildMutatingToolNames = [
  'startNovelBuild',
  'resumeNovelBuild',
  'retryBuildTask',
  'rerunBuildTask',
  'applyArtifactBatch',
  'applyChapterPatch',
  'createCheckpoint'
] as const;

export type BuildMutatingToolName = (typeof buildMutatingToolNames)[number];

export interface BuildApprovalHandler {
  handleApproval(toolName: BuildMutatingToolName, input: unknown, execute: () => Promise<unknown>, toolCallId: string, abortSignal?: AbortSignal): Promise<unknown>;
}

const artifactTypeSchema = z.enum([
  'story-brief',
  'narrative-contract',
  'character-bible',
  'relationship-graph',
  'world-bible',
  'plot-thread',
  'act-architecture',
  'chapter-brief',
  'scene-plan',
  'timeline',
  'setup-payoff-map',
  'research-questions',
  'open-questions',
  'beat',
  'chapter-draft',
  'revision-issue',
  'finale-plan',
  'export-manifest'
]);

const startNovelBuildSchema = z.object({
  idempotencyKey: z.string().trim().min(1),
  brainstorm: z.string().trim().min(1).max(200_000),
  objective: z.string().trim().min(1).max(20_000).optional(),
  targetWordCount: z.number().int().min(1_000).max(1_000_000).optional(),
  minWordCount: z.number().int().min(1_000).max(1_000_000).optional(),
  maxWordCount: z.number().int().min(1_000).max(1_000_000).optional(),
  targetChapterCount: z.number().int().min(1).max(500).optional(),
  targetSceneCount: z.number().int().min(1).max(5_000).optional(),
  targetCharacterCount: z.number().int().min(1).max(1_000).optional(),
  genre: z.string().trim().min(1).max(500).optional(),
  targetAudience: z.string().trim().min(1).max(500).optional(),
  tone: z.array(z.string().trim().min(1).max(2_000)).max(100).optional(),
  constraints: z.array(z.string().trim().min(1).max(2_000)).max(1_000).optional(),
  autonomyMode: z.enum(['assist', 'plan-review', 'autonomous-draft']).default('plan-review'),
  authorizationScope: z.object({
    artifactTypes: z.array(artifactTypeSchema).optional(),
    chapterIds: z.array(z.string().trim().min(1)).optional(),
    sceneIds: z.array(z.string().trim().min(1)).optional(),
    allowPlanningArtifacts: z.boolean().optional(),
    allowCanonWrites: z.boolean().optional(),
    allowChapterWrites: z.boolean().optional(),
    allowSceneWrites: z.boolean().optional(),
    allowDiagnostics: z.boolean().optional(),
    expiresAt: z.string().datetime().nullable().optional()
  }).strict().optional(),
  maxTokens: z.number().int().positive().nullable().optional(),
  maxCostMicros: z.number().int().positive().nullable().optional(),
  workflowVersion: z.string().trim().min(1).optional()
}).strict();

const artifactBindingSchema = z.object({
  bindingKind: z.enum(['build-unit', 'entity', 'ledger']),
  role: z.string().trim().min(1).max(500),
  unitId: z.string().trim().min(1).optional(),
  entityType: z.string().trim().min(1).optional(),
  entityId: z.string().trim().min(1).optional()
}).strict();

const artifactOperationSchema = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('upsert'),
    type: artifactTypeSchema,
    key: z.string().trim().min(1),
    title: z.string().trim().min(1),
    schemaVersion: z.string().trim().min(1).default('1'),
    content: z.unknown(),
    status: z.enum(['DRAFT', 'VALIDATED', 'ACCEPTED']).default('DRAFT'),
    expectedVersion: z.number().int().min(0).optional(),
    replacesArtifactId: z.string().optional(),
    bindings: z.array(artifactBindingSchema).max(1_000).default([])
  }),
  z.object({
    action: z.literal('invalidate'),
    artifactId: z.string().trim().min(1),
    expectedVersion: z.number().int().min(1).optional()
  })
]);

const artifactBatchSchema = z.object({
  buildRunId: z.string().trim().min(1),
  taskId: z.string().trim().min(1).optional(),
  idempotencyKey: z.string().trim().min(1),
  operations: z.array(artifactOperationSchema).min(1).max(100)
});

const chapterPatchSchema = z.object({
  buildRunId: z.string().trim().min(1),
  taskId: z.string().trim().min(1).optional(),
  chapterId: z.string().trim().min(1),
  idempotencyKey: z.string().trim().min(1),
  expectedHeadVersionId: z.string().nullable(),
  replacement: z.string().optional(),
  edits: z.array(editContentInputSchema).max(100).optional(),
  message: z.string().trim().min(1).max(500).default('Apply scoped AI chapter patch')
}).refine((input) => input.replacement !== undefined || Boolean(input.edits?.length), 'replacement or edits is required')
  .refine((input) => !(input.replacement !== undefined && input.edits?.length), 'replacement and edits are mutually exclusive');

const checkpointSchema = z.object({
  buildRunId: z.string().trim().min(1),
  taskId: z.string().trim().min(1).optional(),
  idempotencyKey: z.string().trim().min(1),
  label: z.string().trim().min(1).max(200),
  phase: z.string().trim().min(1),
  stateSnapshot: z.unknown().optional()
});

const reportedCheckValueSchema = z.union([
  z.boolean(),
  z.object({ passed: z.boolean() }).passthrough()
]);
const reportedQualityValueSchema = z.union([
  z.number().min(0).max(1),
  z.string().trim().min(1),
  z.object({ score: z.number().min(0).max(1) }).passthrough()
]);
const taskResultSchema = z.object({
  buildRunId: z.string().trim().min(1),
  taskId: z.string().trim().min(1),
  idempotencyKey: z.string().trim().min(1),
  status: z.enum(['complete', 'blocked', 'failed']),
  decisions: z.array(z.object({ decision: z.string().trim().min(1), reason: z.string().trim().min(1) })).max(100).default([]),
  artifactIds: z.array(z.string()).max(10_000).default([]),
  evidence: z.array(z.object({ type: z.string(), id: z.string().optional(), summary: z.string() })).max(5_000).default([]),
  checks: z.record(z.string(), reportedCheckValueSchema).default({}),
  quality: z.record(z.string(), reportedQualityValueSchema).default({}),
  unresolvedQuestions: z.array(z.string()).max(30).default([])
});
const buildStateInputSchema = z.object({
  buildRunId: z.string().trim().min(1),
  detail: z.enum(['summary', 'context', 'tasks']).default('summary')
}).strict();
const buildLifecycleSchema = z.object({
  buildRunId: z.string().trim().min(1),
  idempotencyKey: z.string().trim().min(1),
  expectedRevision: z.number().int().nonnegative(),
  reason: z.string().trim().min(1).max(1_000).optional()
}).strict();
const buildTaskLifecycleSchema = buildLifecycleSchema.extend({
  taskId: z.string().trim().min(1)
}).strict();
const buildUnitPatchSchema = z.object({
  buildRunId: z.string().trim().min(1),
  taskId: z.string().trim().min(1),
  unitId: z.string().trim().min(1),
  idempotencyKey: z.string().trim().min(1),
  expectedUnitRevision: z.number().int().nonnegative(),
  expectedHeadVersionId: z.string().nullable(),
  body: z.string().optional(),
  title: z.string().trim().min(1).optional(),
  status: z.enum(['planned', 'drafting', 'review', 'accepted', 'invalidated']).optional(),
  tension: z.number().min(0).max(1).nullable().optional(),
  metadata: z.unknown().optional(),
  message: z.string().trim().min(1).max(1_000).optional()
}).refine((input) => input.body !== undefined || input.title !== undefined || input.status !== undefined || input.tension !== undefined || input.metadata !== undefined, 'At least one unit change is required');

export type ReportedTaskResult = z.infer<typeof taskResultSchema>;

export function normalizeReportedTaskResult(input: ReportedTaskResult) {
  const checks = Object.fromEntries(Object.entries(input.checks).map(([key, value]) => [
    key,
    typeof value === 'boolean' ? value : value.passed
  ]));
  const quality = Object.fromEntries(Object.entries(input.quality).flatMap(([key, value]) => {
    const score = typeof value === 'number'
      ? value
      : typeof value === 'object' && value !== null && 'score' in value
        ? value.score
        : null;
    return typeof score === 'number' ? [[key, score]] : [];
  }));
  return { ...input, checks, quality };
}

export function normalizeArtifactBatchForContract(
  input: z.infer<typeof artifactBatchSchema>,
  contract: TaskContract | null
): z.infer<typeof artifactBatchSchema> {
  if (!contract?.scope.buildTaskId || contract.scope.manuscriptUnitIds.length > 0) return input;
  return {
    ...input,
    operations: input.operations.map((operation) => operation.action === 'upsert'
      ? { ...operation, bindings: (operation.bindings ?? []).filter((binding) => binding.bindingKind !== 'build-unit') }
      : operation)
  };
}

export function buildWorkflowTools(
  prisma: PrismaClient,
  context: ToolContext & { userId: string },
  approval: BuildApprovalHandler,
  taskContract: TaskContract | null,
  executionLease: BuildTaskLeaseInput | null
) {
  return {
    listBuildRuns: tool({
      description: 'List bounded summaries of persisted Novel Builds for this project with page/limit pagination. Use this before asking for a buildRunId; select an active or explicitly requested historical run from the returned stable IDs.',
      inputSchema: z.object({
        page: z.number().int().min(1).default(1),
        limit: z.number().int().min(1).max(50).default(10)
      }),
      execute: async (rawInput) => {
        const { page, limit } = z.object({
          page: z.number().int().min(1).default(1),
          limit: z.number().int().min(1).max(50).default(10)
        }).parse(rawInput ?? {});
        const where = { projectId: context.projectId };
        const [runs, total] = await Promise.all([
          prisma.buildRun.findMany({
            where,
            orderBy: { updatedAt: 'desc' },
            skip: (page - 1) * limit,
            take: limit,
            select: {
              id: true,
              objective: true,
              autonomyMode: true,
              status: true,
              currentPhase: true,
              revision: true,
              tokensUsed: true,
              maxTokens: true,
              costMicrosUsed: true,
              maxCostMicros: true,
              createdAt: true,
              updatedAt: true,
              _count: { select: { tasks: true } }
            }
          }),
          prisma.buildRun.count({ where })
        ]);
        return {
          items: runs.map(({ _count, objective, ...run }) => ({
            ...run,
            objective: objective.length > 500 ? `${objective.slice(0, 500)}…` : objective,
            objectiveTruncated: objective.length > 500,
            taskCount: _count.tasks
          })),
          total,
          page,
          limit,
          nextPage: page * limit < total ? page + 1 : null
        };
      }
    }),
    startNovelBuild: tool({
      description: 'Create the durable Novel Build and initial dependency graph from an approved brainstorm. Use this when no build exists; it defaults to Plan & Review, remains approval-gated, and returns the new buildRunId as id.',
      inputSchema: startNovelBuildSchema,
      execute: async (rawInput, options?: AgentToolInvocationContext) => {
        const input = startNovelBuildSchema.parse(rawInput);
        return approval.handleApproval(
          'startNovelBuild',
          input,
          async () => compactCreatedBuild(
            await new NovelBuildUseCase(prisma).create(context.userId, context.projectId, input)
          ),
          invocationToolCallId(options),
          options?.abortSignal
        );
      }
    }),
    getBuildState: tool({
      description: 'Read a bounded Novel Build summary. Use detail=context for the source brainstorm/target, or detail=tasks for the compact dependency graph; the default never returns the full manifest or artifact bodies.',
      inputSchema: buildStateInputSchema,
      execute: async ({ buildRunId, detail }) => getBuildState(prisma, context.projectId, buildRunId, detail)
    }),
    resumeNovelBuild: tool({
      description: 'Resume a paused or failed Novel Build when no failed task has exhausted its attempt budget. If getBuildState reports an exhausted failed task, call rerunBuildTask on that exact boundary instead.',
      inputSchema: buildLifecycleSchema,
      execute: async (input, options?: AgentToolInvocationContext) => approval.handleApproval(
        'resumeNovelBuild',
        input,
        () => new NovelBuildUseCase(prisma).resume(context.userId, context.projectId, input.buildRunId, {
          idempotencyKey: input.idempotencyKey,
          expectedRevision: input.expectedRevision,
          reason: input.reason
        }),
        invocationToolCallId(options),
        options?.abortSignal
      )
    }),
    retryBuildTask: tool({
      description: 'Retry one failed BuildTask only while attempts remain. Use rerunBuildTask when attempts equals maxAttempts.',
      inputSchema: buildTaskLifecycleSchema,
      execute: async (input, options?: AgentToolInvocationContext) => approval.handleApproval(
        'retryBuildTask',
        input,
        () => new NovelBuildUseCase(prisma).retry(context.userId, context.projectId, input.buildRunId, input.taskId, {
          idempotencyKey: input.idempotencyKey,
          expectedRevision: input.expectedRevision,
          reason: input.reason
        }),
        invocationToolCallId(options),
        options?.abortSignal
      )
    }),
    rerunBuildTask: tool({
      description: 'Explicitly rerun one failed or stale BuildTask boundary. Resets its attempt budget and invalidates transitive downstream output before continuing; inspect getBuildState detail=tasks first.',
      inputSchema: buildTaskLifecycleSchema,
      execute: async (input, options?: AgentToolInvocationContext) => approval.handleApproval(
        'rerunBuildTask',
        input,
        () => new NovelBuildUseCase(prisma).rerun(context.userId, context.projectId, input.buildRunId, input.taskId, {
          idempotencyKey: input.idempotencyKey,
          expectedRevision: input.expectedRevision,
          reason: input.reason
        }, { waitForAbort: false }),
        invocationToolCallId(options),
        options?.abortSignal
      )
    }),
    listBuildUnits: tool({
      description: 'List isolated build manuscript units and their build-branch heads. Durable drafters must use these units instead of canonical chapters/scenes.',
      inputSchema: z.object({ buildRunId: z.string().trim().min(1), kind: z.enum(['chapter', 'scene']).optional(), parentUnitId: z.string().nullable().optional() }),
      execute: async (input) => new BuildManuscriptUseCase(prisma).list(context.userId, context.projectId, input.buildRunId, { kind: input.kind, parentUnitId: input.parentUnitId })
    }),
    readBuildUnit: tool({
      description: 'Read one isolated build manuscript unit with exact unit revision and branch head for a CAS patch.',
      inputSchema: z.object({ buildRunId: z.string().trim().min(1), unitId: z.string().trim().min(1) }),
      execute: async (input) => new BuildManuscriptUseCase(prisma).get(context.userId, context.projectId, input.buildRunId, input.unitId)
    }),
    applyBuildUnitPatch: tool({
      description: 'Apply a fenced compare-and-swap patch to exactly one assigned isolated build unit. Never writes canonical/default manuscript heads.',
      inputSchema: buildUnitPatchSchema,
      execute: async (rawInput) => {
        const input = buildUnitPatchSchema.parse(rawInput);
        if (!executionLease) throw new HttpError(403, 'Build unit patches require an active worker lease');
        if (executionLease.taskId !== input.taskId) throw new HttpError(403, 'Build unit patch task does not match the active lease');
        const run = await assertBuild(prisma, context.projectId, input.buildRunId);
        return new BuildManuscriptUseCase(prisma).patch(context.userId, context.projectId, input.buildRunId, input.unitId, {
          idempotencyKey: input.idempotencyKey,
          expectedBuildRevision: run.revision,
          expectedUnitRevision: input.expectedUnitRevision,
          expectedHeadVersionId: input.expectedHeadVersionId,
          lease: executionLease,
          body: input.body,
          title: input.title,
          status: input.status,
          tension: input.tension,
          metadata: input.metadata === undefined ? undefined : jsonSafeForTransition(input.metadata),
          message: input.message
        });
      }
    }),
    compileBuildManuscript: tool({
      description: 'Compile accepted isolated build units in order into an immutable build compilation. Does not merge canonical manuscript heads.',
      inputSchema: z.object({ buildRunId: z.string().trim().min(1), taskId: z.string().trim().min(1), idempotencyKey: z.string().trim().min(1), checkpointId: z.string().nullable().optional(), exportManifestArtifactId: z.string().nullable().optional() }),
      execute: async (input) => {
        if (!executionLease || executionLease.taskId !== input.taskId) throw new HttpError(403, 'Compilation requires the assigned active worker lease');
        const run = await assertBuild(prisma, context.projectId, input.buildRunId);
        return new BuildManuscriptUseCase(prisma).compile(context.userId, context.projectId, input.buildRunId, {
          idempotencyKey: input.idempotencyKey,
          expectedBuildRevision: run.revision,
          checkpointId: input.checkpointId,
          exportManifestArtifactId: input.exportManifestArtifactId,
          lease: executionLease
        });
      }
    }),
    applyArtifactBatch: tool({
      description: 'Atomically create/version/invalidate up to 100 structured story artifacts on one build. Idempotency and expected-version checks are required. Omit build-unit bindings unless the active task contract assigns real manuscriptUnitIds.',
      inputSchema: artifactBatchSchema,
      execute: async (input, options?: AgentToolInvocationContext) => {
        const scopedInput = normalizeArtifactBatchForContract(input, taskContract);
        return approval.handleApproval(
          'applyArtifactBatch',
          scopedInput,
          () => applyArtifactBatch(prisma, context.projectId, scopedInput, executionLease),
          invocationToolCallId(options),
          options?.abortSignal
        );
      }
    }),
    applyChapterPatch: tool({
      description: 'Apply a stale-safe full replacement or exact edits only to the assigned chapter on the build-bound AI writing branch.',
      inputSchema: chapterPatchSchema,
      execute: async (input, options?: AgentToolInvocationContext) => approval.handleApproval('applyChapterPatch', input, () => applyChapterPatch(prisma, context, input), invocationToolCallId(options), options?.abortSignal)
    }),
    createCheckpoint: tool({
      description: 'Create an immutable idempotent build checkpoint containing an observable state snapshot and content hash.',
      inputSchema: checkpointSchema,
      execute: async (input, options?: AgentToolInvocationContext) => approval.handleApproval('createCheckpoint', input, () => createCheckpoint(prisma, context, input), invocationToolCallId(options), options?.abortSignal)
    }),
    reportTaskResult: tool({
      description: 'Report the assigned task result as decisions, persisted artifact IDs, validator evidence, checks, and quality scores. Checks may be booleans or detailed objects containing passed; quality may include numeric scores or detailed objects containing score. This never records hidden reasoning and cannot self-approve quality.',
      inputSchema: taskResultSchema,
      execute: async (input) => {
        if (!taskContract?.scope.buildTaskId) throw new HttpError(403, 'Task results require an assigned typed build task contract');
        if (!executionLease) throw new HttpError(403, 'Task results require an active fenced worker lease');
        return reportTaskResult(prisma, context.projectId, input, taskContract, executionLease);
      }
    })
  };
}

export async function executeBuildMutation(
  prisma: PrismaClient,
  context: ToolContext & { userId: string },
  toolName: string,
  input: Record<string, unknown>
): Promise<unknown> {
  if (toolName === 'startNovelBuild') {
    return compactCreatedBuild(
      await new NovelBuildUseCase(prisma).create(
        context.userId,
        context.projectId,
        startNovelBuildSchema.parse(input)
      )
    );
  }
  if (toolName === 'resumeNovelBuild') {
    const parsed = buildLifecycleSchema.parse(input);
    return new NovelBuildUseCase(prisma).resume(context.userId, context.projectId, parsed.buildRunId, {
      idempotencyKey: parsed.idempotencyKey,
      expectedRevision: parsed.expectedRevision,
      reason: parsed.reason
    });
  }
  if (toolName === 'retryBuildTask') {
    const parsed = buildTaskLifecycleSchema.parse(input);
    return new NovelBuildUseCase(prisma).retry(context.userId, context.projectId, parsed.buildRunId, parsed.taskId, {
      idempotencyKey: parsed.idempotencyKey,
      expectedRevision: parsed.expectedRevision,
      reason: parsed.reason
    });
  }
  if (toolName === 'rerunBuildTask') {
    const parsed = buildTaskLifecycleSchema.parse(input);
    return new NovelBuildUseCase(prisma).rerun(context.userId, context.projectId, parsed.buildRunId, parsed.taskId, {
      idempotencyKey: parsed.idempotencyKey,
      expectedRevision: parsed.expectedRevision,
      reason: parsed.reason
    }, { waitForAbort: false });
  }
  if (toolName === 'applyArtifactBatch') return applyArtifactBatch(prisma, context.projectId, artifactBatchSchema.parse(input), null);
  if (toolName === 'applyChapterPatch') return applyChapterPatch(prisma, context, chapterPatchSchema.parse(input));
  if (toolName === 'createCheckpoint') return createCheckpoint(prisma, context, checkpointSchema.parse(input));
  throw new HttpError(400, `Build mutation ${toolName} is not implemented`);
}

export async function getBuildState(
  prisma: PrismaClient,
  projectId: string,
  buildRunId: string,
  detail: 'summary' | 'context' | 'tasks' = 'summary'
) {
  const run = await prisma.buildRun.findFirst({ where: { id: buildRunId, projectId } });
  if (!run) throw new HttpError(404, 'Build run not found');
  const [tasks, artifacts, checkpoints] = await Promise.all([
    prisma.buildTask.findMany({ where: { buildRunId }, orderBy: [{ phase: 'asc' }, { priority: 'desc' }, { createdAt: 'asc' }] }),
    prisma.storyArtifact.findMany({ where: { buildRunId, invalidatedAt: null }, orderBy: [{ type: 'asc' }, { key: 'asc' }, { version: 'desc' }] }),
    prisma.buildCheckpoint.findMany({ where: { buildRunId }, orderBy: { sequence: 'asc' } })
  ]);
  const counts = tasks.reduce((result: Record<string, number>, task) => {
    result[task.status] = (result[task.status] ?? 0) + 1;
    return result;
  }, {});
  const taskKeys = new Map(tasks.map((task) => [task.id, task.key]));
  const compactTask = (task: typeof tasks[number]) => ({
    id: task.id,
    key: task.key,
    type: task.type,
    phase: task.phase,
    status: task.status,
    dependencyKeys: task.dependencyIds.map((id) => taskKeys.get(id) ?? id),
    assignedAgent: task.assignedAgent,
    attempts: task.attempts,
    maxAttempts: task.maxAttempts,
    progress: task.progress,
    priority: task.priority,
    lastError: task.lastError,
    updatedAt: task.updatedAt
  });
  const currentArtifacts = currentArtifactVersions(artifacts);
  const artifactCounts = currentArtifacts.reduce((result: Record<string, number>, artifact) => {
    result[artifact.type] = (result[artifact.type] ?? 0) + 1;
    return result;
  }, {});
  const summary = {
    run: {
      id: run.id,
      status: run.status,
      objective: truncateText(run.objective, 1_500),
      autonomyMode: run.autonomyMode,
      currentPhase: run.currentPhase,
      workflowVersion: run.workflowVersion,
      branchName: run.branchName,
      revision: run.revision,
      executionGeneration: run.executionGeneration,
      authorizedAt: run.authorizedAt,
      pausedAt: run.pausedAt,
      lastError: run.lastError,
      budget: {
        maxTokens: run.maxTokens,
        tokensUsed: run.tokensUsed,
        tokensReserved: run.tokensReserved,
        maxCostMicros: run.maxCostMicros,
        costMicrosUsed: run.costMicrosUsed,
        costMicrosReserved: run.costMicrosReserved
      },
      updatedAt: run.updatedAt
    },
    taskCounts: counts,
    readyTasks: tasks.filter((task) => task.status === 'READY').map(compactTask),
    blockers: tasks.filter((task) => task.status === 'BLOCKED').slice(0, 10).map(compactTask),
    blockersTruncated: tasks.filter((task) => task.status === 'BLOCKED').length > 10,
    artifactCounts,
    artifacts: currentArtifacts.slice(0, 100).map((artifact) => ({
      id: artifact.id,
      type: artifact.type,
      key: artifact.key,
      title: artifact.title,
      version: artifact.version,
      schemaVersion: artifact.schemaVersion,
      status: artifact.status,
      taskId: artifact.taskId,
      updatedAt: artifact.updatedAt
    })),
    artifactsTruncated: currentArtifacts.length > 100,
    checkpoints: checkpoints.map((checkpoint) => ({
      id: checkpoint.id,
      sequence: checkpoint.sequence,
      label: checkpoint.label,
      phase: checkpoint.phase,
      taskId: checkpoint.taskId,
      createdAt: checkpoint.createdAt
    })),
    completionEligible: tasks.length > 0 && tasks.every((task) => ['DONE', 'CANCELLED'].includes(task.status)) && hasFinalizationPass(tasks)
  };
  if (detail === 'context') {
    const manifest = jsonRecord(run.manifest);
    return {
      ...summary,
      context: {
        brainstorm: truncateText(run.brainstorm, 30_000),
        brainstormTruncated: run.brainstorm.length > 30_000,
        target: manifest.target ?? null,
        manifestVersion: manifest.version ?? null,
        authorizationScope: run.authorizationScope
      }
    };
  }
  if (detail === 'tasks') return { ...summary, tasks: tasks.map(compactTask) };
  return summary;
}

export async function applyArtifactBatch(
  prisma: PrismaClient,
  projectId: string,
  input: z.infer<typeof artifactBatchSchema>,
  executionLease: BuildTaskLeaseInput | null
) {
  const run = await assertBuild(prisma, projectId, input.buildRunId);
  if (!executionLease && input.taskId) throw new HttpError(403, 'Public artifact edits cannot bind outputs to a worker task');
  if (executionLease && input.taskId !== executionLease.taskId) throw new HttpError(403, 'Artifact batch task does not match the active worker lease');
  const serviceOperations: StoryArtifactBatchOperation[] = [];
  const unchanged: Array<{ action: 'unchanged'; id: string; version: number; type: string; key: string }> = [];
  for (const operation of input.operations) {
    if (operation.action === 'invalidate') {
      const current = await prisma.storyArtifact.findFirst({ where: { id: operation.artifactId, projectId, buildRunId: input.buildRunId } });
      if (!current) throw new HttpError(404, `Artifact ${operation.artifactId} not found`);
      if (operation.expectedVersion !== undefined && current.version !== operation.expectedVersion) throw new HttpError(409, `Artifact ${operation.artifactId} version is stale`);
      serviceOperations.push({ op: 'invalidate', artifactId: current.id, expectedVersion: current.version });
      continue;
    }
    const content = validateArtifactContent(operation.type, operation.content);
    const current = await prisma.storyArtifact.findFirst({
      where: { projectId, buildRunId: input.buildRunId, type: toPrismaArtifactType(operation.type), key: operation.key, invalidatedAt: null, status: { notIn: ['SUPERSEDED', 'INVALIDATED'] } },
      orderBy: { version: 'desc' }
    });
    if (operation.expectedVersion !== undefined && (current?.version ?? 0) !== operation.expectedVersion) throw new HttpError(409, `Artifact ${operation.type}/${operation.key} version is stale`);
    const status = operation.status.toLowerCase() as 'draft' | 'validated' | 'accepted';
    if (current?.contentHash === sha256(stableJson(content)) && current.status.toLowerCase() === status) {
      unchanged.push({ action: 'unchanged', id: current.id, version: current.version, type: operation.type, key: operation.key });
      continue;
    }
    const artifact = { taskId: executionLease?.taskId ?? null, type: operation.type as StoryArtifactType, key: operation.key, title: operation.title, schemaVersion: operation.schemaVersion, status, content, bindings: operation.bindings };
    serviceOperations.push(current
      ? { op: 'replace', artifactId: current.id, expectedVersion: current.version, artifact }
      : { op: 'create', artifact });
  }
  if (!serviceOperations.length) {
    if (executionLease) {
      const repository = new NovelBuildRepository(prisma);
      await repository.transaction(async (tx) => {
        await repository.assertTaskLease(tx, projectId, input.buildRunId, executionLease);
      });
    }
    return { ok: true, buildRunId: input.buildRunId, branchName: run.branchName, results: unchanged };
  }
  const applied = await new StoryStateUseCase(prisma).applyArtifactBatch(
    requiredUserId(run),
    projectId,
    input.buildRunId,
    { idempotencyKey: input.idempotencyKey, expectedBuildRevision: run.revision, operations: serviceOperations },
    executionLease ? { allowTaskBinding: true, lease: executionLease } : { allowTaskBinding: false }
  );
  const currentArtifacts = applied.artifacts.filter((artifact) => !['superseded', 'invalidated'].includes(artifact.status));
  return {
    ok: true,
    buildRunId: input.buildRunId,
    branchName: run.branchName,
    buildRevision: applied.buildRevision,
    createdChapterTaskIds: applied.createdChapterTaskIds,
    results: [
      ...unchanged,
      ...currentArtifacts.map((artifact) => ({ action: 'created', id: artifact.id, version: artifact.version, type: artifact.type, key: artifact.key }))
    ]
  };
}

export async function applyChapterPatch(
  prisma: PrismaClient,
  context: ToolContext & { userId: string },
  input: z.infer<typeof chapterPatchSchema>
) {
  const run = await assertBuild(prisma, context.projectId, input.buildRunId);
  assertAuthorizedChapter(run.authorizationScope, input.chapterId);
  try {
    return await prisma.$transaction(async (tx) => {
    const receipt = await operationReceipt(tx, input.buildRunId, input.idempotencyKey, 'applyChapterPatch', input);
    if (receipt) return receipt;
    if (input.taskId) await assertTask(tx, input.buildRunId, input.taskId);
    const chapter = await tx.chapter.findFirst({ where: { id: input.chapterId, projectId: context.projectId, deletedAt: null }, include: { bodyWriting: { include: { defaultBranch: { include: { headVersion: true } }, branches: { where: { buildRunId: input.buildRunId }, include: { headVersion: true } } } } } });
    if (!chapter?.bodyWriting.defaultBranch) throw new HttpError(404, 'Chapter or default writing branch not found');
    let branch = chapter.bodyWriting.branches[0];
    if (!branch) branch = await tx.writingBranch.create({
      data: {
        writingId: chapter.bodyWritingId,
        name: run.branchName,
        parentBranchId: chapter.bodyWriting.defaultBranch.id,
        headVersionId: chapter.bodyWriting.defaultBranch.headVersionId,
        buildRunId: input.buildRunId
      },
      include: { headVersion: true }
    });
    await tx.$queryRaw`SELECT id FROM "WritingBranch" WHERE id = ${branch.id} FOR UPDATE`;
    branch = await tx.writingBranch.findUniqueOrThrow({ where: { id: branch.id }, include: { headVersion: true } });
    if ((branch.headVersionId ?? null) !== input.expectedHeadVersionId) throw new HttpError(409, 'Chapter branch head changed; refresh context before applying the patch');
    let body = branch.headVersion?.body ?? chapter.bodyWriting.defaultBranch.headVersion?.body ?? '';
    if (input.replacement !== undefined) body = input.replacement;
    else for (const edit of input.edits ?? []) body = applyContentEdit(body, edit);
    const version = await tx.writingVersion.create({
      data: {
        branchId: branch.id,
        parentVersionId: branch.headVersionId,
        body,
        wordCount: countWords(body),
        authorId: context.userId,
        message: input.message
      }
    });
    await tx.writingBranch.update({ where: { id: branch.id }, data: { headVersionId: version.id } });
    const response = { ok: true, buildRunId: input.buildRunId, chapterId: chapter.id, branchId: branch.id, versionId: version.id, parentVersionId: version.parentVersionId, wordCount: version.wordCount };
    await saveOperationReceipt(tx, input.buildRunId, input.idempotencyKey, 'applyChapterPatch', input, response);
    return response;
    });
  } catch (error) {
    if (!isUniqueViolation(error)) throw error;
    const replay = await operationReceipt(prisma, input.buildRunId, input.idempotencyKey, 'applyChapterPatch', input);
    if (replay) return replay;
    throw error;
  }
}

export async function createCheckpoint(
  prisma: PrismaClient,
  context: ToolContext & { userId: string },
  input: z.infer<typeof checkpointSchema>
) {
  const run = await assertBuild(prisma, context.projectId, input.buildRunId);
  return new NovelBuildUseCase(prisma).createCheckpoint(context.userId, context.projectId, input.buildRunId, {
    idempotencyKey: input.idempotencyKey,
    expectedBuildRevision: run.revision,
    taskId: input.taskId ?? null,
    label: input.label,
    phase: input.phase
  });
}

export async function reportTaskResult(
  prisma: PrismaClient,
  projectId: string,
  input: ReportedTaskResult,
  contract: TaskContract | null,
  executionLease: BuildTaskLeaseInput
) {
  const repository = new NovelBuildRepository(prisma);
  return repository.transaction(async (tx) => {
    const { task } = await repository.assertTaskLease(tx, projectId, input.buildRunId, executionLease);
    if (contract?.scope.buildTaskId && contract.scope.buildTaskId !== task.id) throw new HttpError(403, 'Cannot report a different build task');
    const artifacts = input.artifactIds.length ? await tx.storyArtifact.findMany({ where: { id: { in: input.artifactIds }, buildRunId: input.buildRunId, invalidatedAt: null } }) : [];
    if (artifacts.length !== input.artifactIds.length) throw new HttpError(400, 'One or more reported artifacts do not exist in this build');
    if (artifacts.some((artifact) => artifact.taskId !== task.id)) throw new HttpError(403, 'Reported artifacts must be outputs of the assigned task');
    const declaredOutputTypes = new Set((contract?.outputs ?? []).map((output) => output.type));
    if (artifacts.some((artifact) => !declaredOutputTypes.has(artifact.type.toLowerCase().replaceAll('_', '-')))) throw new HttpError(403, 'Reported artifact type is outside the assigned output contract');
    // Reporting is deliberately non-transitioning. The same active lease must
    // remain RUNNING while the independent evaluator persists checks and the
    // worker alone decides DONE/retry/escalation. The observable report is
    // captured in the worker trace.
    return {
      ok: true,
      taskId: task.id,
      status: 'RUNNING',
      evaluatorRequired: true,
      observableResult: normalizeReportedTaskResult(input)
    };
  });
}

async function assertBuild(prisma: PrismaClient, projectId: string, buildRunId: string) {
  const run = await prisma.buildRun.findFirst({ where: { id: buildRunId, projectId } });
  if (!run) throw new HttpError(404, 'Build run not found');
  return run;
}

function requiredUserId(run: { authorizedById?: string | null; createdById?: string | null }): string {
  const userId = run.authorizedById ?? run.createdById;
  if (!userId) throw new HttpError(409, 'Build has no authorizing user');
  return userId;
}

async function assertTask(client: PrismaClient | Prisma.TransactionClient, buildRunId: string, taskId: string) {
  const task = await client.buildTask.findFirst({ where: { id: taskId, buildRunId } });
  if (!task) throw new HttpError(404, 'Build task not found');
  return task;
}

function assertAuthorizedChapter(scope: unknown, chapterId: string): void {
  if (!scope || typeof scope !== 'object' || Array.isArray(scope)) throw new HttpError(403, 'Build has no chapter authorization scope');
  const record = scope as Record<string, unknown>;
  const chapterIds = Array.isArray(record.chapterIds) ? record.chapterIds.filter((id): id is string => typeof id === 'string') : [];
  const manuscript = record.manuscript === true || record.chapters === true || record.allowChapterWrites === true;
  if (!manuscript || (chapterIds.length > 0 && !chapterIds.includes(chapterId))) throw new HttpError(403, 'Build is not authorized to mutate this chapter');
}

async function operationReceipt(client: PrismaClient | Prisma.TransactionClient, buildRunId: string, idempotencyKey: string, operation: string, input: unknown): Promise<unknown | null> {
  const receipt = await client.buildOperationReceipt.findFirst({ where: { buildRunId, idempotencyKey } });
  if (!receipt) return null;
  if (receipt.operation !== operation || receipt.requestHash !== sha256(stableJson(input))) throw new HttpError(409, 'Idempotency key was reused with different input');
  return receipt.response;
}

async function saveOperationReceipt(client: PrismaClient | Prisma.TransactionClient, buildRunId: string, idempotencyKey: string, operation: string, input: unknown, response: unknown): Promise<void> {
  await client.buildOperationReceipt.create({ data: { buildRunId, idempotencyKey, operation, requestHash: sha256(stableJson(input)), response: jsonSafeForTransition(response) as Prisma.InputJsonValue } });
}

function compactCreatedBuild(
  run: Awaited<ReturnType<NovelBuildUseCase['create']>>
) {
  const taskCounts = run.tasks.reduce((result: Record<string, number>, task) => {
    result[task.status] = (result[task.status] ?? 0) + 1;
    return result;
  }, {});
  return {
    id: run.id,
    projectId: run.projectId,
    status: run.status,
    autonomyMode: run.autonomyMode,
    currentPhase: run.currentPhase,
    workflowVersion: run.workflowVersion,
    revision: run.revision,
    authorizedAt: run.authorizedAt,
    lastError: run.lastError,
    taskCounts,
    readyTasks: run.tasks
      .filter((task) => task.status === 'ready')
      .map((task) => ({ id: task.id, key: task.key, type: task.type, phase: task.phase })),
    authorizationRequired: run.authorizedAt === null,
    nextAction: run.authorizedAt === null
      ? 'Review and authorize this build in the Novel Build workspace. The durable worker will execute ready tasks after authorization.'
      : 'The durable Novel Build worker owns task execution; monitor it in the Novel Build workspace.'
  };
}

function currentArtifactVersions<T extends { type: string; key: string }>(artifacts: T[]): T[] {
  const current = new Map<string, T>();
  for (const artifact of artifacts) {
    const key = `${artifact.type}:${artifact.key}`;
    if (!current.has(key)) current.set(key, artifact);
  }
  return [...current.values()];
}

function truncateText(value: string, limit: number): string {
  return value.length > limit ? `${value.slice(0, limit)}…` : value;
}

function hasFinalizationPass(tasks: Array<{ phase: string; type: string; key: string; status: string }>): boolean {
  return tasks.some((task) => /final|proof|copy|manuscript/i.test(`${task.phase} ${task.type} ${task.key}`) && task.status === 'DONE');
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`).join(',')}}`;
  return JSON.stringify(value);
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function jsonRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}

function isUniqueViolation(error: unknown): boolean {
  return Boolean(error && typeof error === 'object' && 'code' in error && (error as { code?: string }).code === 'P2002');
}

function jsonSafeForTransition(value: unknown): JsonValue {
  return JSON.parse(JSON.stringify(value)) as JsonValue;
}
