import { Prisma, type BuildTask, type PrismaClient } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import type {
  ApplyBuildWritingPatchInput,
  ApplyBuildWritingPatchResult,
  AuthorizeBuildRunInput,
  BuildCheckpoint,
  BranchBuildFromCheckpointInput,
  BuildLifecycleInput,
  BuildRun,
  BuildWritingBranch,
  BuildTaskActionResult,
  BuildTaskLease,
  ClaimBuildTaskInput,
  CompleteBuildTaskInput,
  CreateBuildCheckpointInput,
  CreateBuildRunInput,
  CreateBuildWritingBranchInput,
  CreateChapterBuildTasksInput,
  FailBuildTaskInput,
  HeartbeatBuildTaskInput,
  JsonObject,
  JsonValue,
  RecoverBuildTasksInput,
  RecoverBuildTasksResult,
  ReplanBuildInput,
  ReplanBuildResult,
  StoryArtifactType
} from '@opentales/sdk';
import { HttpError } from '../../http/HttpError.js';
import {
  NovelBuildRepository,
  assertLegalBuildRunTransition,
  type NovelBuildTx
} from '../../repositories/NovelBuildRepository.js';
import { ProjectAccessRepository } from '../../repositories/ProjectAccessRepository.js';
import { countWords } from '../../utils/wordCount.js';
import { abortBuildRunExecutions, abortBuildTaskExecution } from '../ai/workflow/BuildExecutionRegistry.js';
import {
  toBuildCheckpoint,
  toBuildDirective,
  toBuildRun,
  toPrismaArtifactType
} from './novelBuildMapper.js';
import {
  authorizationScopeSchema,
  createBuildManifest,
  createChapterCompilationTaskTemplates,
  createSceneTaskTemplates,
  mergeAuthorizationScope,
  normalizeBuildInput,
  stableHash,
  type TaskTemplate,
  validateArtifactContent
} from './schemas.js';

const TERMINAL_RUN_STATUSES = new Set(['COMPLETED', 'CANCELLED']);
const DEFAULT_LEASE_MS = 5 * 60_000;
const MIN_LEASE_MS = 10_000;
const MAX_LEASE_MS = 30 * 60_000;

export class NovelBuildUseCase {
  readonly repository: NovelBuildRepository;
  private readonly access: ProjectAccessRepository;

  constructor(private readonly prisma: PrismaClient) {
    this.repository = new NovelBuildRepository(prisma);
    this.access = new ProjectAccessRepository(prisma);
  }

  async list(userId: string, projectId: string): Promise<BuildRun[]> {
    await this.access.assertProjectAccess(userId, projectId);
    return (await this.repository.list(projectId)).map(toBuildRun);
  }

  async get(userId: string, projectId: string, buildRunId: string): Promise<BuildRun> {
    await this.access.assertProjectAccess(userId, projectId);
    await this.recoverStaleInternal(projectId, buildRunId);
    return toBuildRun(await this.repository.get(projectId, buildRunId));
  }

  async create(userId: string, projectId: string, rawInput: CreateBuildRunInput): Promise<BuildRun> {
    await this.access.assertProjectAccess(userId, projectId);
    let input: CreateBuildRunInput;
    try {
      input = normalizeBuildInput(rawInput);
    } catch (error) {
      throw validationError(error);
    }
    await this.access.assertPermission(
      userId,
      projectId,
      input.autonomyMode === 'autonomous-draft' && input.authorizationScope !== undefined
        ? 'project:admin'
        : 'project:write'
    );
    const scope = mergeAuthorizationScope(input.autonomyMode, input.authorizationScope);
    if (scope.expiresAt && new Date(scope.expiresAt) <= new Date()) throw new HttpError(400, 'Build authorization expiry must be in the future');
    const manifest = createBuildManifest(input);
    return toBuildRun(await this.repository.create(userId, projectId, input, manifest, scope));
  }

  async authorize(
    userId: string,
    projectId: string,
    buildRunId: string,
    input: AuthorizeBuildRunInput
  ): Promise<BuildRun> {
    await this.access.assertPermission(userId, projectId, 'project:admin');
    let scope;
    try { scope = authorizationScopeSchema.parse(input.authorizationScope); } catch (error) { throw validationError(error); }
    if (scope.expiresAt && new Date(scope.expiresAt) <= new Date()) throw new HttpError(400, 'Build authorization expiry must be in the future');
    validateOptionalBudget(input.maxTokens, 'maxTokens');
    validateOptionalBudget(input.maxCostMicros, 'maxCostMicros');
    await this.runMutation(projectId, buildRunId, 'authorize', input, async (tx, run) => {
      assertExpectedRevision(run.revision, input.expectedRevision);
      if (TERMINAL_RUN_STATUSES.has(run.status)) throw new HttpError(409, `Cannot authorize a ${run.status.toLowerCase()} build`);
      const nextTask = await tx.buildTask.findFirst({
        where: { buildRunId, status: { in: ['READY', 'RUNNING', 'REVIEW'] } },
        orderBy: [{ priority: 'desc' }, { createdAt: 'asc' }],
        select: { phase: true }
      }) ?? await tx.buildTask.findFirst({
        where: { buildRunId, status: 'BLOCKED' },
        orderBy: [{ createdAt: 'asc' }],
        select: { phase: true }
      });
      const nextPhase = nextTask?.phase ?? 'planning';
      const nextStatus = nextPhase === 'revising' || nextPhase === 'planning-review'
        ? (nextPhase === 'revising' ? 'REVISING' : 'PLANNING')
        : nextPhase === 'drafting' ? 'DRAFTING' : 'PLANNING';
      assertLegalBuildRunTransition(run.status, nextStatus);
      const maxTokens = input.maxTokens === undefined ? run.maxTokens : input.maxTokens;
      const maxCostMicros = input.maxCostMicros === undefined ? run.maxCostMicros : input.maxCostMicros;
      if (run.autonomyMode === 'AUTONOMOUS_DRAFT' && (maxTokens == null || maxCostMicros == null)) {
        throw new HttpError(400, 'Autonomous Draft authorization requires finite token and cost budgets');
      }
      await tx.buildRun.update({
        where: { id: buildRunId },
        data: {
          authorizationScope: scope as Prisma.InputJsonValue,
          authorizedById: userId,
          authorizedAt: new Date(),
          maxTokens,
          maxCostMicros,
          status: nextStatus,
          currentPhase: nextPhase,
          pausedAt: null,
          revision: { increment: 1 }
        }
      });
      if (run.currentPhase === 'checkpoint-review:planning-checkpoint') {
        await this.acceptValidatedPlanArtifactsInTransaction(tx, buildRunId);
      }
    });
    return toBuildRun(await this.repository.get(projectId, buildRunId));
  }

  async pause(userId: string, projectId: string, buildRunId: string, input: BuildLifecycleInput): Promise<BuildRun> {
    await this.access.assertPermission(userId, projectId, 'project:write');
    await this.runMutation(projectId, buildRunId, 'pause', input, async (tx, run) => {
      assertExpectedRevision(run.revision, input.expectedRevision);
      if (TERMINAL_RUN_STATUSES.has(run.status)) throw new HttpError(409, `Cannot pause a ${run.status.toLowerCase()} build`);
      assertLegalBuildRunTransition(run.status, 'PAUSED');
      const running = await tx.buildTask.findMany({ where: { buildRunId, status: 'RUNNING' } });
      const reservedTokens = running.reduce((sum, task) => sum + task.reservedTokens, 0);
      const reservedCostMicros = running.reduce((sum, task) => sum + task.reservedCostMicros, 0);
      for (const task of running) {
        await this.repository.transitionTask(tx, task, {
          status: 'READY',
          idempotencyKey: `${input.idempotencyKey}:task:${task.id}`,
          reason: input.reason ?? 'Build paused',
          data: {
            leaseOwner: null,
            leaseToken: null,
            leaseGeneration: { increment: 1 },
            leaseExpiresAt: null,
            heartbeatAt: null,
            reservedTokens: 0,
            reservedCostMicros: 0
          }
        });
        await tx.buildTrace.updateMany({
          where: { buildRunId, taskId: task.id, status: 'STARTED', completedAt: null },
          data: { status: 'FAILED', finishRequestHash: `pause:${task.id}:${task.leaseGeneration}`, error: 'Build paused while task was executing.', completionState: 'interrupted', completedAt: new Date() }
        });
      }
      await tx.buildRun.update({
        where: { id: buildRunId },
        data: {
          status: 'PAUSED',
          pausedAt: new Date(),
          lastError: input.reason ?? run.lastError,
          executionGeneration: { increment: 1 },
          tokensReserved: { decrement: reservedTokens },
          costMicrosReserved: { decrement: reservedCostMicros },
          revision: { increment: 1 }
        }
      });
    });
    await abortBuildRunExecutions(buildRunId, input.reason ?? 'Build paused', 5_000);
    return toBuildRun(await this.repository.get(projectId, buildRunId));
  }

  async resume(userId: string, projectId: string, buildRunId: string, input: BuildLifecycleInput): Promise<BuildRun> {
    await this.access.assertPermission(userId, projectId, 'project:write');
    await this.runMutation(projectId, buildRunId, 'resume', input, async (tx, run) => {
      assertExpectedRevision(run.revision, input.expectedRevision);
      if (run.status !== 'PAUSED' && run.status !== 'FAILED') throw new HttpError(409, 'Only paused or failed builds can be resumed');
      await this.repository.recoverStaleTasks(tx, buildRunId);
      const failed = await tx.buildTask.findMany({ where: { buildRunId, status: 'FAILED' } });
      if (failed.some((task) => task.attempts >= task.maxAttempts)) {
        throw new HttpError(409, 'Build contains exhausted failed tasks; explicitly rerun the failed boundary before resume');
      }
      for (const task of failed) {
        if (task.attempts >= task.maxAttempts) continue;
        await this.repository.transitionTask(tx, task, {
          status: task.dependencyIds.length ? 'BLOCKED' : 'READY',
          idempotencyKey: `${input.idempotencyKey}:resume:${task.id}`,
          reason: input.reason ?? 'Build resumed',
          data: { failedAt: null, lastError: null }
        });
      }
      await this.repository.refreshReadyTasks(tx, buildRunId);
      const phaseStatus = run.currentPhase === 'revising' ? 'REVISING' : run.currentPhase === 'drafting' ? 'DRAFTING' : 'PLANNING';
      assertLegalBuildRunTransition(run.status, phaseStatus);
      await tx.buildRun.update({
        where: { id: buildRunId },
        data: { status: phaseStatus, pausedAt: null, failedAt: null, lastError: null, executionGeneration: { increment: 1 }, revision: { increment: 1 } }
      });
    });
    return toBuildRun(await this.repository.get(projectId, buildRunId));
  }

  async cancel(userId: string, projectId: string, buildRunId: string, input: BuildLifecycleInput): Promise<BuildRun> {
    await this.access.assertPermission(userId, projectId, 'project:write');
    await this.runMutation(projectId, buildRunId, 'cancel', input, async (tx, run) => {
      assertExpectedRevision(run.revision, input.expectedRevision);
      if (run.status === 'COMPLETED') throw new HttpError(409, 'A completed build cannot be cancelled');
      assertLegalBuildRunTransition(run.status, 'CANCELLED');
      const pending = await tx.buildTask.findMany({
        where: { buildRunId, status: { in: ['BLOCKED', 'READY', 'RUNNING', 'REVIEW', 'FAILED'] } }
      });
      const reservedTokens = pending.reduce((sum, task) => sum + task.reservedTokens, 0);
      const reservedCostMicros = pending.reduce((sum, task) => sum + task.reservedCostMicros, 0);
      for (const task of pending) {
        await this.repository.transitionTask(tx, task, {
          status: 'CANCELLED',
          idempotencyKey: `${input.idempotencyKey}:task:${task.id}`,
          reason: input.reason ?? 'Build cancelled',
          data: {
            leaseOwner: null,
            leaseToken: null,
            leaseGeneration: { increment: 1 },
            leaseExpiresAt: null,
            heartbeatAt: null,
            reservedTokens: 0,
            reservedCostMicros: 0,
            cancelledAt: new Date()
          }
        });
      }
      if (pending.length) await tx.buildTrace.updateMany({
        where: { buildRunId, taskId: { in: pending.map((task) => task.id) }, status: 'STARTED', completedAt: null },
        data: { status: 'FAILED', finishRequestHash: `cancel:${input.idempotencyKey}`, error: 'Build cancelled while task was executing.', completionState: 'cancelled', completedAt: new Date() }
      });
      await tx.buildRun.update({
        where: { id: buildRunId },
        data: {
          status: 'CANCELLED',
          cancelledAt: new Date(),
          executionGeneration: { increment: 1 },
          tokensReserved: { decrement: reservedTokens },
          costMicrosReserved: { decrement: reservedCostMicros },
          revision: { increment: 1 }
        }
      });
    });
    await abortBuildRunExecutions(buildRunId, input.reason ?? 'Build cancelled', 5_000);
    return toBuildRun(await this.repository.get(projectId, buildRunId));
  }

  async recover(
    userId: string,
    projectId: string,
    buildRunId: string,
    input: RecoverBuildTasksInput
  ): Promise<RecoverBuildTasksResult> {
    await this.access.assertPermission(userId, projectId, 'project:write');
    const result = await this.repository.transaction(async (tx) => {
      await this.repository.lockRun(tx, projectId, buildRunId);
      const replay = await this.repository.operationReplay<JsonObject>(tx, buildRunId, input.idempotencyKey, 'recover', stableHash(input));
      if (replay) return { recoveredTaskIds: stringArray(replay.recoveredTaskIds), failedTaskIds: stringArray(replay.failedTaskIds) };
      const recovered = await this.repository.recoverStaleTasks(tx, buildRunId);
      await this.repository.refreshReadyTasks(tx, buildRunId);
      await this.repository.saveOperationReceipt(tx, buildRunId, input.idempotencyKey, 'recover', stableHash(input), recovered as unknown as JsonValue);
      return recovered;
    });
    return { buildRun: toBuildRun(await this.repository.get(projectId, buildRunId)), ...result };
  }

  async claim(
    userId: string,
    projectId: string,
    buildRunId: string,
    input: ClaimBuildTaskInput
  ): Promise<BuildTaskActionResult | null> {
    await this.access.assertPermission(userId, projectId, 'project:write');
    validateWorker(input.workerId);
    validateIdempotencyKey(input.idempotencyKey);
    const leaseMs = clampInt(input.leaseMs ?? DEFAULT_LEASE_MS, MIN_LEASE_MS, MAX_LEASE_MS);
    const result = await this.repository.transaction(async (tx) => {
      const run = await this.repository.lockRun(tx, projectId, buildRunId);
      this.assertRunnable(run.status, run.authorizationScope, run.maxTokens, run.tokensUsed, run.maxCostMicros, run.costMicrosUsed);
      if (!run.authorizedAt) throw new HttpError(403, 'Build has no active worker scope authorization');
      const requestHash = stableHash(input);
      const replay = await this.repository.operationReplay<JsonObject>(tx, buildRunId, input.idempotencyKey, 'claim', requestHash);
      if (replay) return {
        taskId: typeof replay.taskId === 'string' ? replay.taskId : null,
        unblockedTaskIds: [],
        lease: replay.lease && typeof replay.lease === 'object' && !Array.isArray(replay.lease) ? replay.lease as JsonObject : null
      };
      await this.repository.recoverStaleTasks(tx, buildRunId);
      const unblockedTaskIds = await this.repository.refreshReadyTasks(tx, buildRunId);
      const activeLease = await tx.buildTask.findFirst({
        where: { buildRunId, status: 'RUNNING', leaseToken: { not: null }, leaseExpiresAt: { gt: new Date() } },
        select: { id: true }
      });
      if (activeLease) {
        await this.repository.saveOperationReceipt(tx, buildRunId, input.idempotencyKey, 'claim', requestHash, { taskId: null, reason: 'build-capacity-in-use' });
        return { taskId: null, unblockedTaskIds, lease: null };
      }
      const task = await tx.buildTask.findFirst({
        where: {
          buildRunId,
          status: 'READY',
          ...(input.taskTypes?.length ? { type: { in: input.taskTypes } } : {})
        },
        orderBy: [{ priority: 'desc' }, { createdAt: 'asc' }]
      });
      if (!task) {
        await this.repository.saveOperationReceipt(tx, buildRunId, input.idempotencyKey, 'claim', requestHash, { taskId: null });
        return { taskId: null, unblockedTaskIds, lease: null };
      }
      this.assertTaskAuthorized(run.authorizationScope, task);
      const reserveTokens = validateReservation(input.reserveTokens, 'reserveTokens');
      const reserveCostMicros = validateReservation(input.reserveCostMicros, 'reserveCostMicros');
      if (run.maxTokens !== null && run.tokensUsed + run.tokensReserved + reserveTokens > run.maxTokens) {
        throw new HttpError(409, 'Build has insufficient unreserved token budget for this task');
      }
      if (run.maxCostMicros !== null && run.costMicrosUsed + run.costMicrosReserved + reserveCostMicros > run.maxCostMicros) {
        throw new HttpError(409, 'Build has insufficient unreserved cost budget for this task');
      }
      const now = new Date();
      const leaseToken = randomUUID();
      const leaseGeneration = task.leaseGeneration + 1;
      const leaseExpiresAt = new Date(now.getTime() + leaseMs);
      await this.repository.transitionTask(tx, task, {
        status: 'RUNNING',
        idempotencyKey: input.idempotencyKey,
        reason: `Claimed by ${input.workerId}`,
        metadata: { leaseMs, reserveTokens, reserveCostMicros, leaseGeneration, runGeneration: run.executionGeneration },
        requestHash,
        data: {
          attempts: { increment: 1 },
          leaseOwner: input.workerId,
          leaseToken,
          leaseGeneration,
          runGeneration: run.executionGeneration,
          reservedTokens: reserveTokens,
          reservedCostMicros: reserveCostMicros,
          leaseExpiresAt,
          heartbeatAt: now,
          startedAt: task.startedAt ?? now,
          failedAt: null,
          invalidatedAt: null,
          lastError: null
        }
      });
      await tx.buildRun.update({
        where: { id: buildRunId },
        data: { tokensReserved: { increment: reserveTokens }, costMicrosReserved: { increment: reserveCostMicros } }
      });
      const lease = {
        taskId: task.id,
        workerId: input.workerId,
        leaseToken,
        leaseGeneration,
        runGeneration: run.executionGeneration,
        expiresAt: leaseExpiresAt.toISOString()
      };
      await this.repository.saveOperationReceipt(tx, buildRunId, input.idempotencyKey, 'claim', requestHash, { taskId: task.id, lease });
      return { taskId: task.id, unblockedTaskIds, lease: lease as unknown as JsonObject };
    });
    if (!result.taskId) return null;
    return this.actionResult(projectId, buildRunId, result.taskId, result.unblockedTaskIds, [], null, result.lease);
  }

  async heartbeat(
    userId: string,
    projectId: string,
    buildRunId: string,
    taskId: string,
    input: HeartbeatBuildTaskInput
  ): Promise<BuildTaskActionResult> {
    await this.access.assertPermission(userId, projectId, 'project:write');
    validateWorker(input.workerId);
    const leaseMs = clampInt(input.leaseMs ?? DEFAULT_LEASE_MS, MIN_LEASE_MS, MAX_LEASE_MS);
    await this.repository.transaction(async (tx) => {
      const { task } = await this.repository.assertTaskLease(tx, projectId, buildRunId, {
        taskId,
        workerId: input.workerId,
        leaseToken: input.leaseToken,
        leaseGeneration: input.leaseGeneration,
        runGeneration: input.runGeneration
      });
      const replay = await tx.buildTaskTransition.findUnique({
        where: { taskId_idempotencyKey: { taskId, idempotencyKey: input.idempotencyKey } }
      });
      if (replay) return;
      assertExpectedRevision(task.revision, input.expectedRevision);
      await this.repository.transitionTask(tx, task, {
        status: 'RUNNING',
        idempotencyKey: input.idempotencyKey,
        requestHash: stableHash(input),
        reason: 'Worker heartbeat',
        data: {
          heartbeatAt: new Date(),
          leaseExpiresAt: new Date(Date.now() + leaseMs),
          progress: input.progress === undefined ? undefined : clampInt(input.progress, 0, 99)
        }
      });
    });
    return this.actionResult(projectId, buildRunId, taskId, [], [], null);
  }

  async complete(
    userId: string,
    projectId: string,
    buildRunId: string,
    taskId: string,
    input: CompleteBuildTaskInput
  ): Promise<BuildTaskActionResult> {
    await this.access.assertPermission(userId, projectId, 'project:write');
    validateWorker(input.workerId);
    const outcome = await this.repository.transaction(async (tx) => {
      await this.repository.lockRun(tx, projectId, buildRunId);
      const replay = await tx.buildTaskTransition.findUnique({ where: { taskId_idempotencyKey: { taskId, idempotencyKey: input.idempotencyKey } } });
      if (replay) {
        if (replay.requestHash && replay.requestHash !== stableHash(input)) throw new HttpError(409, 'Completion idempotency key was reused with different input');
        return { unblockedTaskIds: [] as string[], checkpointId: null as string | null };
      }
      const { run, task } = await this.repository.assertTaskLease(tx, projectId, buildRunId, {
        taskId,
        workerId: input.workerId,
        leaseToken: input.leaseToken,
        leaseGeneration: input.leaseGeneration,
        runGeneration: input.runGeneration
      });
      assertExpectedRevision(task.revision, input.expectedRevision);
      const outputArtifactIds = unique(input.outputArtifactIds ?? []);
      await this.validateTaskCompletion(tx, buildRunId, task, outputArtifactIds, input.qualityScore);
      if (task.type === 'quality-gate' && task.key.startsWith('scene:')) {
        if (task.scopeUnitIds.length !== 1) throw new HttpError(409, 'Scene quality gate must be scoped to exactly one manuscript unit');
        const accepted = await tx.buildManuscriptUnit.updateMany({
          where: { id: task.scopeUnitIds[0], buildRunId, kind: 'SCENE', invalidatedAt: null },
          data: { status: 'ACCEPTED', revision: { increment: 1 } }
        });
        if (accepted.count !== 1) throw new HttpError(409, 'Scene quality gate scope unit is missing or invalidated');
      }
      await this.repository.transitionTask(tx, task, {
        status: 'DONE',
        idempotencyKey: input.idempotencyKey,
        requestHash: stableHash(input),
        reason: 'Task completed',
        metadata: input.result,
        data: {
          outputArtifactIds,
          progress: 100,
          leaseOwner: null,
          leaseToken: null,
          leaseExpiresAt: null,
          heartbeatAt: null,
          reservedTokens: 0,
          reservedCostMicros: 0,
          completedAt: new Date(),
          lastError: null
        }
      });
      if (task.reservedTokens || task.reservedCostMicros) {
        await tx.buildRun.update({
          where: { id: buildRunId },
          data: {
            tokensReserved: { decrement: task.reservedTokens },
            costMicrosReserved: { decrement: task.reservedCostMicros }
          }
        });
      }
      if (['critique-chapter', 'critique-scene'].includes(task.type) && input.qualityScore !== undefined && task.qualityThreshold !== null && input.qualityScore >= task.qualityThreshold) {
        const revision = await tx.buildTask.findFirst({ where: { buildRunId, dependencyIds: { has: task.id }, type: { in: ['revise-chapter', 'revise-scene-unit'] }, status: 'BLOCKED' } });
        if (revision) {
          await this.repository.transitionTask(tx, revision, {
            status: 'DONE',
            idempotencyKey: `${input.idempotencyKey}:skip-revision`,
            reason: 'Critic score met the quality gate; bounded revision was not needed',
            data: { progress: 100, completedAt: new Date() }
          });
        }
      }
      let checkpointId: string | null = null;
      if (task.type === 'checkpoint' || input.createCheckpoint) {
        const snapshot = await this.snapshot(tx, buildRunId);
        const checkpoint = await this.repository.createCheckpoint(tx, {
          projectId,
          buildRunId,
          taskId,
          userId,
          idempotencyKey: `${input.idempotencyKey}:checkpoint`,
          requestHash: stableHash({ ...input, checkpoint: true }),
          label: task.key === 'final-checkpoint' ? 'Final Novel Build' : task.key,
          phase: task.phase,
          stateSnapshot: snapshot,
          contentHash: stableHash(snapshot)
        });
        checkpointId = checkpoint.id;
      }
      if (task.key === 'planning-checkpoint' && run.autonomyMode === 'AUTONOMOUS_DRAFT') {
        await this.acceptValidatedPlanArtifactsInTransaction(tx, buildRunId);
      }
      const unblockedTaskIds = await this.repository.refreshReadyTasks(tx, buildRunId);
      await this.repository.updateRunPhaseAndCompletion(tx, buildRunId);
      if (run.autonomyMode === 'PLAN_REVIEW' && task.type === 'checkpoint' && task.key !== 'final-checkpoint') {
        await tx.buildRun.update({
          where: { id: buildRunId },
          data: {
            status: 'PAUSED',
            currentPhase: `checkpoint-review:${task.key}`,
            pausedAt: new Date(),
            revision: { increment: 1 }
          }
        });
      }
      return { unblockedTaskIds, checkpointId };
    }, Prisma.TransactionIsolationLevel.RepeatableRead);
    const checkpoint = outcome.checkpointId
      ? await this.prisma.buildCheckpoint.findFirst({ where: { id: outcome.checkpointId, buildRunId, projectId } })
      : null;
    return this.actionResult(projectId, buildRunId, taskId, outcome.unblockedTaskIds, [], checkpoint ? toBuildCheckpoint(checkpoint) : null);
  }

  async fail(
    userId: string,
    projectId: string,
    buildRunId: string,
    taskId: string,
    input: FailBuildTaskInput
  ): Promise<BuildTaskActionResult> {
    await this.access.assertPermission(userId, projectId, 'project:write');
    validateWorker(input.workerId);
    const result = await this.repository.transaction(async (tx) => {
      await this.repository.lockRun(tx, projectId, buildRunId);
      const replay = await tx.buildTaskTransition.findUnique({ where: { taskId_idempotencyKey: { taskId, idempotencyKey: input.idempotencyKey } } });
      if (replay) {
        if (replay.requestHash && replay.requestHash !== stableHash(input)) throw new HttpError(409, 'Failure idempotency key was reused with different input');
        return { unblockedTaskIds: [] as string[] };
      }
      const { task } = await this.repository.assertTaskLease(tx, projectId, buildRunId, {
        taskId,
        workerId: input.workerId,
        leaseToken: input.leaseToken,
        leaseGeneration: input.leaseGeneration,
        runGeneration: input.runGeneration
      });
      assertExpectedRevision(task.revision, input.expectedRevision);
      const attemptTrace = await tx.buildTrace.findFirst({ where: { buildRunId, taskId: task.id, attempt: task.attempts }, orderBy: { startedAt: 'desc' }, select: { startedAt: true } });
      await this.compensateTaskAttemptInTransaction(tx, buildRunId, task.id, attemptTrace?.startedAt ?? task.startedAt ?? new Date());
      const retryable = input.retryable !== false && task.attempts < task.maxAttempts;
      await this.repository.transitionTask(tx, task, {
        status: retryable ? 'READY' : 'FAILED',
        idempotencyKey: input.idempotencyKey,
        requestHash: stableHash(input),
        reason: input.error,
        data: {
          leaseOwner: null,
          leaseToken: null,
          leaseExpiresAt: null,
          heartbeatAt: null,
          reservedTokens: 0,
          reservedCostMicros: 0,
          failedAt: retryable ? null : new Date(),
          lastError: input.error
        }
      });
      if (task.reservedTokens || task.reservedCostMicros) {
        await tx.buildRun.update({
          where: { id: buildRunId },
          data: {
            tokensReserved: { decrement: task.reservedTokens },
            costMicrosReserved: { decrement: task.reservedCostMicros }
          }
        });
      }
      if (!retryable) {
        await tx.buildRun.update({
          where: { id: buildRunId },
          data: { status: 'FAILED', failedAt: new Date(), lastError: input.error, revision: { increment: 1 } }
        });
      }
      return { unblockedTaskIds: retryable ? [task.id] : [] };
    });
    return this.actionResult(projectId, buildRunId, taskId, result.unblockedTaskIds, [], null);
  }

  async compensateTaskAttemptInTransaction(tx: NovelBuildTx, buildRunId: string, taskId: string, startedAt: Date): Promise<void> {
    const attemptBoundary = new Date(startedAt.getTime() - 2_000);
    const task = await tx.buildTask.findFirst({ where: { id: taskId, buildRunId }, select: { scopeUnitIds: true } });
    if (!task) throw new HttpError(404, 'Build task not found for attempt compensation');
    const artifacts = await tx.storyArtifact.findMany({ where: { buildRunId, taskId, createdAt: { gte: attemptBoundary }, invalidatedAt: null }, select: { id: true, replacesArtifactId: true } });
    if (artifacts.length) {
      await tx.storyArtifact.updateMany({ where: { id: { in: artifacts.map((artifact) => artifact.id) } }, data: { status: 'INVALIDATED', invalidatedAt: new Date() } });
      for (const replacedId of artifacts.flatMap((artifact) => artifact.replacesArtifactId ? [artifact.replacesArtifactId] : [])) {
        const replaced = await tx.storyArtifact.findUnique({ where: { id: replacedId }, select: { acceptedAt: true } });
        if (replaced) await tx.storyArtifact.update({ where: { id: replacedId }, data: { status: replaced.acceptedAt ? 'ACCEPTED' : 'VALIDATED', invalidatedAt: null } });
      }
    }
    const restorePrevious = async <T extends { id: string; supersedesId: string | null }>(rows: T[], invalidate: (ids: string[]) => Promise<unknown>, restore: (ids: string[]) => Promise<unknown>) => {
      if (!rows.length) return;
      await invalidate(rows.map((row) => row.id));
      const previous = [...new Set(rows.flatMap((row) => row.supersedesId ? [row.supersedesId] : []))];
      if (previous.length) await restore(previous);
    };
    await restorePrevious((await tx.canonFact.findMany({ where: { buildRunId, sourceTaskId: taskId, createdAt: { gte: attemptBoundary }, isCurrent: true }, select: { id: true, supersedesFactId: true } })).map((row) => ({ id: row.id, supersedesId: row.supersedesFactId })),
      (ids) => tx.canonFact.updateMany({ where: { id: { in: ids } }, data: { isCurrent: false, status: 'INVALIDATED', invalidatedAt: new Date() } }),
      (ids) => tx.canonFact.updateMany({ where: { id: { in: ids }, invalidatedAt: null }, data: { isCurrent: true } }));
    await restorePrevious((await tx.entityState.findMany({ where: { buildRunId, sourceTaskId: taskId, createdAt: { gte: attemptBoundary }, isCurrent: true }, select: { id: true, supersedesStateId: true } })).map((row) => ({ id: row.id, supersedesId: row.supersedesStateId })),
      (ids) => tx.entityState.updateMany({ where: { id: { in: ids } }, data: { isCurrent: false, status: 'INVALIDATED', invalidatedAt: new Date() } }),
      (ids) => tx.entityState.updateMany({ where: { id: { in: ids }, invalidatedAt: null }, data: { isCurrent: true } }));
    await restorePrevious((await tx.timelineEvent.findMany({ where: { buildRunId, sourceTaskId: taskId, createdAt: { gte: attemptBoundary }, isCurrent: true }, select: { id: true, supersedesEventId: true } })).map((row) => ({ id: row.id, supersedesId: row.supersedesEventId })),
      (ids) => tx.timelineEvent.updateMany({ where: { id: { in: ids } }, data: { isCurrent: false, invalidatedAt: new Date() } }),
      (ids) => tx.timelineEvent.updateMany({ where: { id: { in: ids }, invalidatedAt: null }, data: { isCurrent: true } }));
    await restorePrevious((await tx.openLoop.findMany({ where: { buildRunId, sourceTaskId: taskId, createdAt: { gte: attemptBoundary }, isCurrent: true }, select: { id: true, supersedesLoopId: true } })).map((row) => ({ id: row.id, supersedesId: row.supersedesLoopId })),
      (ids) => tx.openLoop.updateMany({ where: { id: { in: ids } }, data: { isCurrent: false, status: 'INVALIDATED', invalidatedAt: new Date() } }),
      (ids) => tx.openLoop.updateMany({ where: { id: { in: ids }, invalidatedAt: null }, data: { isCurrent: true } }));
    await restorePrevious((await tx.setupPayoffLink.findMany({ where: { buildRunId, sourceTaskId: taskId, createdAt: { gte: attemptBoundary }, isCurrent: true }, select: { id: true, supersedesLinkId: true } })).map((row) => ({ id: row.id, supersedesId: row.supersedesLinkId })),
      (ids) => tx.setupPayoffLink.updateMany({ where: { id: { in: ids } }, data: { isCurrent: false, status: 'INVALIDATED', invalidatedAt: new Date() } }),
      (ids) => tx.setupPayoffLink.updateMany({ where: { id: { in: ids }, invalidatedAt: null }, data: { isCurrent: true } }));
    await restorePrevious((await tx.plotThread.findMany({ where: { buildRunId, sourceTaskId: taskId, createdAt: { gte: attemptBoundary }, isCurrent: true }, select: { id: true, supersedesThreadId: true } })).map((row) => ({ id: row.id, supersedesId: row.supersedesThreadId })),
      (ids) => tx.plotThread.updateMany({ where: { id: { in: ids } }, data: { isCurrent: false, status: 'INVALIDATED', invalidatedAt: new Date() } }),
      (ids) => tx.plotThread.updateMany({ where: { id: { in: ids }, invalidatedAt: null }, data: { isCurrent: true } }));
    if (task.scopeUnitIds.length) {
      const units = await tx.buildManuscriptUnit.findMany({ where: { buildRunId, id: { in: task.scopeUnitIds } }, select: { id: true, branchId: true } });
      for (const unit of units) {
        const branch = await tx.writingBranch.findUnique({ where: { id: unit.branchId }, select: { headVersionId: true } });
        const versions = await tx.writingVersion.findMany({ where: { branchId: unit.branchId, sourceTaskId: taskId, createdAt: { gte: attemptBoundary } }, select: { id: true, parentVersionId: true } });
        const byId = new Map(versions.map((version) => [version.id, version]));
        let cursor = branch?.headVersionId ?? null; let restoreHead: string | null | undefined;
        while (cursor) { const version = byId.get(cursor); if (!version) break; restoreHead = version.parentVersionId; cursor = version.parentVersionId; }
        if (restoreHead !== undefined) await tx.writingBranch.update({ where: { id: unit.branchId }, data: { headVersionId: restoreHead } });
      }
    }
  }

  async retry(
    userId: string,
    projectId: string,
    buildRunId: string,
    taskId: string,
    input: BuildLifecycleInput
  ): Promise<BuildTaskActionResult> {
    await this.access.assertPermission(userId, projectId, 'project:write');
    await this.runMutation(projectId, buildRunId, `retry:${taskId}`, input, async (tx, run) => {
      assertExpectedRevision(run.revision, input.expectedRevision);
      const task = await this.repository.getTask(tx, buildRunId, taskId);
      if (task.status !== 'FAILED') throw new HttpError(409, 'Only failed tasks can be retried');
      if (task.attempts >= task.maxAttempts) throw new HttpError(409, 'Task retry budget is exhausted; rerun it explicitly to reset the attempt budget');
      const dependenciesDone = await this.dependenciesDone(tx, task);
      await this.repository.transitionTask(tx, task, {
        status: dependenciesDone ? 'READY' : 'BLOCKED',
        idempotencyKey: input.idempotencyKey,
        requestHash: stableHash(input),
        reason: input.reason ?? 'Task retry requested',
        data: { failedAt: null, lastError: null }
      });
      await tx.buildRun.update({ where: { id: buildRunId }, data: { failedAt: null, lastError: null, revision: { increment: 1 } } });
    });
    return this.actionResult(projectId, buildRunId, taskId, [], [], null);
  }

  async rerun(
    userId: string,
    projectId: string,
    buildRunId: string,
    taskId: string,
    input: BuildLifecycleInput,
    options: { waitForAbort?: boolean } = {}
  ): Promise<BuildTaskActionResult> {
    await this.access.assertPermission(userId, projectId, 'project:write');
    let invalidatedTaskIds: string[] = [];
    await this.runMutation(projectId, buildRunId, `rerun:${taskId}`, input, async (tx, run) => {
      assertExpectedRevision(run.revision, input.expectedRevision);
      if (TERMINAL_RUN_STATUSES.has(run.status)) throw new HttpError(409, `Cannot rerun a ${run.status.toLowerCase()} build`);
      const target = await this.repository.getTask(tx, buildRunId, taskId);
      const tasks = await tx.buildTask.findMany({ where: { buildRunId } });
      invalidatedTaskIds = transitiveDownstream(tasks, taskId);
      const invalidatedTasks = tasks.filter((task) => invalidatedTaskIds.includes(task.id));
      const releasedTokens = invalidatedTasks.reduce((sum, task) => sum + task.reservedTokens, 0);
      const releasedCostMicros = invalidatedTasks.reduce((sum, task) => sum + task.reservedCostMicros, 0);
      const invalidatedSet = new Set(invalidatedTaskIds);
      const activeDirective = await tx.buildDirective.findFirst({ where: { buildRunId }, orderBy: { createdAt: 'desc' }, select: { pinnedArtifactIds: true } });
      const pinnedArtifactIds = activeDirective?.pinnedArtifactIds ?? [];
      const artifacts = await tx.storyArtifact.findMany({
        where: { buildRunId, taskId: { in: invalidatedTaskIds }, invalidatedAt: null, ...(pinnedArtifactIds.length ? { id: { notIn: pinnedArtifactIds } } : {}) },
        select: { id: true }
      });
      const artifactIds = artifacts.map((artifact) => artifact.id);
      const now = new Date();
      if (artifactIds.length) {
        await tx.storyArtifact.updateMany({ where: { id: { in: artifactIds } }, data: { status: 'INVALIDATED', invalidatedAt: now } });
        await Promise.all([
          tx.canonFact.updateMany({ where: { buildRunId, sourceArtifactId: { in: artifactIds } }, data: { status: 'INVALIDATED', invalidatedAt: now } }),
          tx.entityState.updateMany({ where: { buildRunId, sourceArtifactId: { in: artifactIds } }, data: { status: 'INVALIDATED', invalidatedAt: now } }),
          tx.timelineEvent.updateMany({ where: { buildRunId, sourceArtifactId: { in: artifactIds } }, data: { invalidatedAt: now } }),
          tx.plotThread.updateMany({ where: { buildRunId, sourceArtifactId: { in: artifactIds } }, data: { status: 'INVALIDATED', invalidatedAt: now } }),
          tx.openLoop.updateMany({ where: { buildRunId, OR: [{ introducedArtifactId: { in: artifactIds } }, { resolvedArtifactId: { in: artifactIds } }] }, data: { status: 'INVALIDATED', invalidatedAt: now } }),
          tx.setupPayoffLink.updateMany({ where: { buildRunId, OR: [{ setupArtifactId: { in: artifactIds } }, { payoffArtifactId: { in: artifactIds } }] }, data: { status: 'INVALIDATED', invalidatedAt: now } })
        ]);
      }
      await this.invalidateTaskDerivedStateAndProse(tx, buildRunId, invalidatedTaskIds, artifactIds, pinnedArtifactIds);
      await tx.buildTrace.updateMany({
        where: { buildRunId, taskId: { in: invalidatedTaskIds }, status: 'STARTED', completedAt: null },
        data: { status: 'FAILED', finishRequestHash: `rerun:${input.idempotencyKey}`, error: 'Task rerun fenced the active execution.', completionState: 'invalidated', completedAt: new Date() }
      });
      const byId = new Map(tasks.map((task) => [task.id, task]));
      for (const taskIdToReset of invalidatedTaskIds) {
        const task = byId.get(taskIdToReset)!;
        const outsideDependenciesDone = task.dependencyIds
          .filter((dependencyId) => !invalidatedSet.has(dependencyId))
          .every((dependencyId) => byId.get(dependencyId)?.status === 'DONE');
        const nextStatus = taskIdToReset === taskId && outsideDependenciesDone ? 'READY' : 'BLOCKED';
        await this.repository.transitionTask(tx, task, {
          status: nextStatus,
          idempotencyKey: `${input.idempotencyKey}:reset:${task.id}`,
          reason: input.reason ?? `Rerun requested from ${target.key}`,
          data: {
            attempts: 0,
            revisionIteration: { increment: 1 },
            outputArtifactIds: task.outputArtifactIds.filter((artifactId) => pinnedArtifactIds.includes(artifactId)),
            progress: 0,
            leaseOwner: null,
            leaseToken: null,
            leaseGeneration: { increment: 1 },
            leaseExpiresAt: null,
            heartbeatAt: null,
            reservedTokens: 0,
            reservedCostMicros: 0,
            startedAt: null,
            completedAt: null,
            failedAt: null,
            cancelledAt: null,
            invalidatedAt: now,
            lastError: null
          }
        });
      }
      await tx.buildRun.update({
        where: { id: buildRunId },
        data: {
          status: target.phase === 'revising' ? 'REVISING' : target.phase === 'drafting' ? 'DRAFTING' : 'PLANNING',
          currentPhase: target.phase,
          completedAt: null,
          failedAt: null,
          lastError: null,
          tokensReserved: { decrement: releasedTokens },
          costMicrosReserved: { decrement: releasedCostMicros },
          revision: { increment: 1 }
        }
      });
    });
    const abortWaitMs = options.waitForAbort === false ? 0 : 5_000;
    await Promise.all(invalidatedTaskIds.map((id) => abortBuildTaskExecution(buildRunId, id, input.reason ?? 'Task rerun fenced prior execution', abortWaitMs)));
    return this.actionResult(projectId, buildRunId, taskId, [], invalidatedTaskIds, null);
  }

  async replan(
    userId: string,
    projectId: string,
    buildRunId: string,
    input: ReplanBuildInput
  ): Promise<ReplanBuildResult> {
    await this.access.assertPermission(userId, projectId, 'project:write');
    validateIdempotencyKey(input.idempotencyKey);
    const directiveText = requiredText(input.directive, 'Creative directive', 100_000);
    const requestHash = stableHash(input);
    const outcome = await this.repository.transaction(async (tx) => {
      const run = await this.repository.lockRun(tx, projectId, buildRunId);
      const replay = await this.repository.operationReplay<JsonObject>(tx, buildRunId, input.idempotencyKey, 'replan', requestHash);
      if (replay && typeof replay.directiveId === 'string') {
        return {
          directiveId: replay.directiveId,
          invalidatedTaskIds: stringArray(replay.invalidatedTaskIds),
          invalidatedArtifactIds: stringArray(replay.invalidatedArtifactIds),
          preservedArtifactIds: stringArray(replay.preservedArtifactIds)
        };
      }
      assertExpectedRevision(run.revision, input.expectedRevision);
      if (TERMINAL_RUN_STATUSES.has(run.status)) throw new HttpError(409, `Cannot re-plan a ${run.status.toLowerCase()} build`);
      const target = await this.repository.getTask(tx, buildRunId, input.fromTaskId);
      let checkpointId: string | null = null;
      let checkpointSnapshot: Prisma.JsonValue | null = null;
      if (input.checkpointId) {
        const checkpoint = await tx.buildCheckpoint.findFirst({ where: { id: input.checkpointId, projectId, buildRunId } });
        if (!checkpoint) throw new HttpError(400, 'Checkpoint does not belong to this build');
        checkpointId = checkpoint.id;
        checkpointSnapshot = checkpoint.stateSnapshot;
        if (checkpoint.taskId) {
          const checkpointDownstream = new Set(transitiveDownstream(await tx.buildTask.findMany({ where: { buildRunId } }), checkpoint.taskId));
          if (!checkpointDownstream.has(target.id) || checkpoint.taskId === target.id) {
            throw new HttpError(409, 'Re-plan start task must be downstream of the selected checkpoint');
          }
        }
      }
      const pinnedArtifactIds = unique(input.pinnedArtifactIds ?? []);
      if (pinnedArtifactIds.length) {
        const pins = await tx.storyArtifact.findMany({
          where: { id: { in: pinnedArtifactIds }, projectId, buildRunId, invalidatedAt: null, status: { in: ['VALIDATED', 'ACCEPTED'] } },
          select: { id: true }
        });
        if (pins.length !== pinnedArtifactIds.length) throw new HttpError(400, 'Pinned artifacts must be validated, current, and belong to this build');
      }
      const tasks = await tx.buildTask.findMany({ where: { buildRunId } });
      const invalidatedTaskIds = transitiveDownstream(tasks, target.id);
      const invalidatedTasks = tasks.filter((task) => invalidatedTaskIds.includes(task.id));
      const releasedTokens = invalidatedTasks.reduce((sum, task) => sum + task.reservedTokens, 0);
      const releasedCostMicros = invalidatedTasks.reduce((sum, task) => sum + task.reservedCostMicros, 0);
      const invalidatedSet = new Set(invalidatedTaskIds);
      const artifacts = await tx.storyArtifact.findMany({
        where: {
          buildRunId,
          taskId: { in: invalidatedTaskIds },
          id: { notIn: pinnedArtifactIds.length ? pinnedArtifactIds : ['__none__'] },
          invalidatedAt: null
        },
        select: { id: true }
      });
      const invalidatedArtifactIds = artifacts.map((artifact) => artifact.id);
      const directive = await tx.buildDirective.create({
        data: {
          projectId,
          buildRunId,
          fromTaskId: target.id,
          checkpointId,
          createdById: userId,
          idempotencyKey: input.idempotencyKey,
          directive: directiveText,
          pinnedArtifactIds
        }
      });
      if (checkpointSnapshot) await this.restoreWritingBranchHeads(tx, buildRunId, checkpointSnapshot);
      const now = new Date();
      if (invalidatedArtifactIds.length) {
        await tx.storyArtifact.updateMany({ where: { id: { in: invalidatedArtifactIds } }, data: { status: 'INVALIDATED', invalidatedAt: now } });
        await Promise.all([
          tx.canonFact.updateMany({ where: { buildRunId, sourceArtifactId: { in: invalidatedArtifactIds } }, data: { status: 'INVALIDATED', invalidatedAt: now } }),
          tx.entityState.updateMany({ where: { buildRunId, sourceArtifactId: { in: invalidatedArtifactIds } }, data: { status: 'INVALIDATED', invalidatedAt: now } }),
          tx.timelineEvent.updateMany({ where: { buildRunId, sourceArtifactId: { in: invalidatedArtifactIds } }, data: { invalidatedAt: now } }),
          tx.plotThread.updateMany({ where: { buildRunId, sourceArtifactId: { in: invalidatedArtifactIds } }, data: { status: 'INVALIDATED', invalidatedAt: now } }),
          tx.openLoop.updateMany({ where: { buildRunId, OR: [{ introducedArtifactId: { in: invalidatedArtifactIds } }, { resolvedArtifactId: { in: invalidatedArtifactIds } }] }, data: { status: 'INVALIDATED', invalidatedAt: now } }),
          tx.setupPayoffLink.updateMany({ where: { buildRunId, OR: [{ setupArtifactId: { in: invalidatedArtifactIds } }, { payoffArtifactId: { in: invalidatedArtifactIds } }] }, data: { status: 'INVALIDATED', invalidatedAt: now } })
        ]);
      }
      await this.invalidateTaskDerivedStateAndProse(tx, buildRunId, invalidatedTaskIds, invalidatedArtifactIds, pinnedArtifactIds);
      await tx.buildTrace.updateMany({
        where: { buildRunId, taskId: { in: invalidatedTaskIds }, status: 'STARTED', completedAt: null },
        data: { status: 'FAILED', finishRequestHash: `replan:${input.idempotencyKey}`, error: 'Author re-plan fenced the active execution.', completionState: 'invalidated', completedAt: new Date() }
      });
      const byId = new Map(tasks.map((task) => [task.id, task]));
      for (const taskId of invalidatedTaskIds) {
        const task = byId.get(taskId)!;
        const outsideDependenciesDone = task.dependencyIds
          .filter((dependencyId) => !invalidatedSet.has(dependencyId))
          .every((dependencyId) => byId.get(dependencyId)?.status === 'DONE');
        const nextStatus = task.id === target.id && outsideDependenciesDone ? 'READY' : 'BLOCKED';
        await this.repository.transitionTask(tx, task, {
          status: nextStatus,
          idempotencyKey: `${input.idempotencyKey}:reset:${task.id}`,
          reason: `Author re-plan: ${directiveText.slice(0, 1_000)}`,
          metadata: { directiveId: directive.id, checkpointId, pinnedArtifactIds },
          data: {
            attempts: 0,
            revisionIteration: { increment: 1 },
            outputArtifactIds: task.outputArtifactIds.filter((artifactId) => pinnedArtifactIds.includes(artifactId)),
            progress: 0,
            leaseOwner: null,
            leaseToken: null,
            leaseGeneration: { increment: 1 },
            leaseExpiresAt: null,
            heartbeatAt: null,
            reservedTokens: 0,
            reservedCostMicros: 0,
            startedAt: null,
            completedAt: null,
            failedAt: null,
            cancelledAt: null,
            invalidatedAt: now,
            lastError: null
          }
        });
      }
      await tx.buildRun.update({
        where: { id: buildRunId },
        data: {
          status: target.phase === 'revising' ? 'REVISING' : target.phase === 'drafting' ? 'DRAFTING' : 'PLANNING',
          currentPhase: target.phase,
          pausedAt: null,
          completedAt: null,
          failedAt: null,
          lastError: null,
          tokensReserved: { decrement: releasedTokens },
          costMicrosReserved: { decrement: releasedCostMicros },
          revision: { increment: 1 }
        }
      });
      const receipt: JsonObject = { directiveId: directive.id, invalidatedTaskIds, invalidatedArtifactIds, preservedArtifactIds: pinnedArtifactIds };
      await this.repository.saveOperationReceipt(tx, buildRunId, input.idempotencyKey, 'replan', requestHash, receipt);
      return { directiveId: directive.id, invalidatedTaskIds, invalidatedArtifactIds, preservedArtifactIds: pinnedArtifactIds };
    }, Prisma.TransactionIsolationLevel.RepeatableRead);
    const directive = await this.prisma.buildDirective.findFirst({ where: { id: outcome.directiveId, projectId, buildRunId } });
    if (!directive) throw new HttpError(404, 'Build directive not found');
    await Promise.all(outcome.invalidatedTaskIds.map((id) => abortBuildTaskExecution(buildRunId, id, `Build re-plan: ${directiveText}`, 5_000)));
    return {
      buildRun: toBuildRun(await this.repository.get(projectId, buildRunId)),
      directive: toBuildDirective(directive),
      invalidatedTaskIds: outcome.invalidatedTaskIds,
      invalidatedArtifactIds: outcome.invalidatedArtifactIds,
      preservedArtifactIds: outcome.preservedArtifactIds
    };
  }

  async branchFromCheckpoint(
    userId: string,
    projectId: string,
    buildRunId: string,
    input: BranchBuildFromCheckpointInput
  ): Promise<ReplanBuildResult> {
    if (!input.checkpointId) throw new HttpError(400, 'checkpointId is required when branching from a checkpoint');
    return this.replan(userId, projectId, buildRunId, input);
  }

  async materializeChapterTasks(
    userId: string,
    projectId: string,
    buildRunId: string,
    input: CreateChapterBuildTasksInput
  ): Promise<BuildRun> {
    await this.access.assertPermission(userId, projectId, 'project:write');
    validateIdempotencyKey(input.idempotencyKey);
    await this.repository.transaction(async (tx) => {
      await this.repository.lockRun(tx, projectId, buildRunId);
      const requestHash = stableHash(input);
      const replay = await this.repository.operationReplay<JsonObject>(tx, buildRunId, input.idempotencyKey, 'materialize-chapter-tasks', requestHash);
      if (replay) return;
      const artifactIds = unique([input.chapterBriefArtifactId, ...input.scenePlanArtifactIds]);
      const artifacts = await tx.storyArtifact.findMany({ where: { id: { in: artifactIds }, buildRunId, projectId, invalidatedAt: null } });
      if (artifacts.length !== artifactIds.length) throw new HttpError(400, 'One or more chapter planning artifacts do not belong to this build');
      const brief = artifacts.find((artifact) => artifact.id === input.chapterBriefArtifactId);
      if (brief?.type !== 'CHAPTER_BRIEF') throw new HttpError(400, 'chapterBriefArtifactId must reference a chapter-brief artifact');
      if (input.scenePlanArtifactIds.some((id) => artifacts.find((artifact) => artifact.id === id)?.type !== 'SCENE_PLAN')) throw new HttpError(400, 'scenePlanArtifactIds must reference scene-plan artifacts');
      await this.materializeChapterGraphsInTransaction(tx, buildRunId);
      await this.repository.saveOperationReceipt(tx, buildRunId, input.idempotencyKey, 'materialize-chapter-tasks', requestHash, { chapterKey: input.chapterKey });
      await this.repository.refreshReadyTasks(tx, buildRunId);
    });
    return toBuildRun(await this.repository.get(projectId, buildRunId));
  }

  async createWritingBranch(
    userId: string,
    projectId: string,
    buildRunId: string,
    input: CreateBuildWritingBranchInput
  ): Promise<BuildWritingBranch> {
    await this.access.assertPermission(userId, projectId, 'project:write');
    throw new HttpError(410, 'Canonical Writing branch creation is disabled for Novel Builds; create a BuildManuscriptUnit instead');
  }

  async applyWritingPatch(
    userId: string,
    projectId: string,
    buildRunId: string,
    input: ApplyBuildWritingPatchInput
  ): Promise<ApplyBuildWritingPatchResult> {
    await this.access.assertPermission(userId, projectId, 'project:write');
    validateIdempotencyKey(input.idempotencyKey);
    if (typeof input.body !== 'string' || input.body.length > 2_000_000) throw new HttpError(400, 'Writing body must be a string no larger than 2 MB');
    const outcome = await this.repository.transaction(async (tx) => {
      const { run, task } = await this.repository.assertTaskLease(tx, projectId, buildRunId, input.lease);
      const requestHash = stableHash(input);
      const replay = await this.repository.operationReplay<JsonObject>(tx, buildRunId, input.idempotencyKey, 'apply-writing-patch', requestHash);
      if (replay && typeof replay.writingVersionId === 'string' && typeof replay.buildRevision === 'number' && typeof replay.wordCount === 'number') {
        return { writingVersionId: replay.writingVersionId, buildRevision: replay.buildRevision, wordCount: replay.wordCount };
      }
      assertExpectedRevision(run.revision, input.expectedBuildRevision);
      if (input.taskId !== task.id) throw new HttpError(403, 'Writing patch taskId must match fenced lease');
      if (!['drafter', 'reviser'].includes(task.assignedAgent)) throw new HttpError(403, `Task agent '${task.assignedAgent}' is not authorized to write prose`);
      const branch = await tx.writingBranch.findFirst({
        where: { id: input.branchId, buildRunId, writing: { projectId } },
        include: { buildManuscriptUnits: { where: { buildRunId, invalidatedAt: null }, select: { id: true, key: true } } }
      });
      if (!branch) throw new HttpError(404, 'Build writing branch not found');
      const unit = branch.buildManuscriptUnits[0];
      if (!unit || !task.scopeUnitIds.includes(unit.id)) throw new HttpError(403, 'Fenced task is not scoped to this build manuscript unit');
      await tx.$queryRaw`SELECT id FROM "WritingBranch" WHERE id = ${branch.id} FOR UPDATE`;
      if (branch.headVersionId !== input.expectedHeadVersionId) throw new HttpError(409, 'Writing branch head is stale', { expected: input.expectedHeadVersionId, actual: branch.headVersionId });
      const wordCount = countWords(input.body);
      const version = await tx.writingVersion.create({
        data: {
          branchId: branch.id,
          sourceTaskId: task.id,
          parentVersionId: branch.headVersionId,
          body: input.body,
          wordCount,
          authorId: userId,
          message: input.message ? requiredText(input.message, 'Version message', 1_000) : 'Novel Build writing update'
        }
      });
      const cas = await tx.writingBranch.updateMany({ where: { id: branch.id, headVersionId: input.expectedHeadVersionId }, data: { headVersionId: version.id } });
      if (cas.count !== 1) throw new HttpError(409, 'Writing branch head changed concurrently');
      const updated = await tx.buildRun.update({ where: { id: buildRunId }, data: { revision: { increment: 1 } }, select: { revision: true } });
      const response: JsonObject = { writingVersionId: version.id, buildRevision: updated.revision, wordCount };
      await this.repository.saveOperationReceipt(tx, buildRunId, input.idempotencyKey, 'apply-writing-patch', requestHash, response);
      return response as { writingVersionId: string; buildRevision: number; wordCount: number };
    });
    const branch = await this.prisma.writingBranch.findFirst({ where: { id: input.branchId, buildRunId, writing: { projectId } } });
    if (!branch || !branch.buildRunId) throw new HttpError(404, 'Build writing branch not found');
    return {
      branch: {
        id: branch.id,
        buildRunId: branch.buildRunId,
        writingId: branch.writingId,
        name: branch.name,
        parentBranchId: branch.parentBranchId,
        headVersionId: branch.headVersionId,
        createdAt: branch.createdAt.toISOString(),
        updatedAt: branch.updatedAt.toISOString()
      },
      ...outcome
    };
  }

  async createCheckpoint(
    userId: string,
    projectId: string,
    buildRunId: string,
    input: CreateBuildCheckpointInput
  ): Promise<BuildCheckpoint> {
    await this.access.assertPermission(userId, projectId, 'project:write');
    if (input.taskId) throw new HttpError(403, 'Public checkpoints cannot bind themselves to worker tasks; task checkpoints are committed by fenced completion');
    const checkpoint = await this.repository.transaction(async (tx) => {
      const run = await this.repository.lockRun(tx, projectId, buildRunId);
      const replay = await tx.buildCheckpoint.findUnique({
        where: { buildRunId_idempotencyKey: { buildRunId, idempotencyKey: input.idempotencyKey } }
      });
      if (replay) return replay;
      assertExpectedRevision(run.revision, input.expectedBuildRevision);
      const snapshot = await this.snapshot(tx, buildRunId);
      const result = await this.repository.createCheckpoint(tx, {
        projectId,
        buildRunId,
        taskId: input.taskId,
        userId,
        idempotencyKey: input.idempotencyKey,
        requestHash: stableHash(input),
        label: requiredText(input.label, 'Checkpoint label', 1_000),
        phase: input.phase ? requiredText(input.phase, 'Checkpoint phase', 500) : run.currentPhase,
        stateSnapshot: snapshot,
        contentHash: stableHash(snapshot)
      });
      await tx.buildRun.update({ where: { id: buildRunId }, data: { revision: { increment: 1 } } });
      return result;
    });
    return toBuildCheckpoint(checkpoint);
  }

  private async runMutation<T extends { idempotencyKey: string }>(
    projectId: string,
    buildRunId: string,
    operation: string,
    input: T,
    mutate: (tx: NovelBuildTx, run: Awaited<ReturnType<NovelBuildRepository['lockRun']>>) => Promise<void>
  ): Promise<void> {
    validateIdempotencyKey(input.idempotencyKey);
    await this.repository.transaction(async (tx) => {
      const run = await this.repository.lockRun(tx, projectId, buildRunId);
      const requestHash = stableHash(input);
      const replay = await this.repository.operationReplay<JsonObject>(tx, buildRunId, input.idempotencyKey, operation, requestHash);
      if (replay) return;
      await mutate(tx, run);
      await this.repository.saveOperationReceipt(tx, buildRunId, input.idempotencyKey, operation, requestHash, { ok: true });
    });
  }

  private async recoverStaleInternal(projectId: string, buildRunId: string): Promise<void> {
    const run = await this.prisma.buildRun.findFirst({ where: { id: buildRunId, projectId }, select: { status: true } });
    if (!run) throw new HttpError(404, 'Novel Build not found');
    if (!['PLANNING', 'DRAFTING', 'REVISING'].includes(run.status)) return;
    await this.repository.transaction(async (tx) => {
      await this.repository.lockRun(tx, projectId, buildRunId);
      await this.repository.recoverStaleTasks(tx, buildRunId);
      await this.repository.refreshReadyTasks(tx, buildRunId);
    });
  }

  private assertRunnable(
    status: string,
    rawScope: Prisma.JsonValue,
    maxTokens: number | null,
    tokensUsed: number,
    maxCostMicros: number | null,
    costMicrosUsed: number
  ) {
    if (!['PLANNING', 'DRAFTING', 'REVISING'].includes(status)) throw new HttpError(409, `Build is ${status.toLowerCase()} and cannot claim work`);
    const scope = authorizationScopeSchema.parse(rawScope);
    if (scope.expiresAt && new Date(scope.expiresAt) <= new Date()) throw new HttpError(403, 'Build authorization has expired');
    if (maxTokens !== null && tokensUsed >= maxTokens) throw new HttpError(409, 'Build token budget is exhausted');
    if (maxCostMicros !== null && costMicrosUsed >= maxCostMicros) throw new HttpError(409, 'Build cost budget is exhausted');
  }

  private assertTaskAuthorized(rawScope: Prisma.JsonValue, task: BuildTask) {
    const scope = authorizationScopeSchema.parse(rawScope);
    const criteria = task.acceptanceCriteria as JsonObject;
    const requiredTypes = stringArray(criteria.requiredArtifactTypes) as StoryArtifactType[];
    if (requiredTypes.some((type) => !scope.artifactTypes.includes(type))) throw new HttpError(403, `Build scope does not authorize task '${task.key}' output`);
    if (!scope.allowChapterWrites && ['draft-chapter', 'revise-chapter', 'compile-chapter-unit'].includes(task.type)) throw new HttpError(403, 'Build scope does not authorize chapter writes');
    if (!scope.allowSceneWrites && ['draft-scene-unit', 'revise-scene-unit'].includes(task.type)) throw new HttpError(403, 'Build scope does not authorize scene writes');
    if (task.phase === 'revising' && ['reviser', 'orchestrator'].includes(task.assignedAgent) && (!scope.allowChapterWrites || !scope.allowSceneWrites)) throw new HttpError(403, 'Build scope does not authorize whole-manuscript revision writes');
    if (task.type.includes('canon') && !scope.allowCanonWrites) throw new HttpError(403, 'Build scope does not authorize canon writes');
    if (task.type.includes('diagnostic') && !scope.allowDiagnostics) throw new HttpError(403, 'Build scope does not authorize diagnostics');
  }

  private async validateTaskCompletion(
    tx: NovelBuildTx,
    buildRunId: string,
    task: BuildTask,
    outputArtifactIds: string[],
    qualityScore?: number
  ) {
    const criteria = task.acceptanceCriteria as JsonObject;
    const requiredTypes = stringArray(criteria.requiredArtifactTypes) as StoryArtifactType[];
      if (outputArtifactIds.length) {
      const artifacts = await tx.storyArtifact.findMany({ where: { id: { in: outputArtifactIds }, buildRunId, invalidatedAt: null, status: { in: ['VALIDATED', 'ACCEPTED'] } } });
      if (artifacts.length !== outputArtifactIds.length || artifacts.some((artifact) => artifact.taskId !== task.id && !(task.type === 'export-preparation' && artifact.type === 'EXPORT_MANIFEST' && artifact.taskId === null))) {
        throw new HttpError(400, 'One or more output artifacts do not belong to this task and build');
      }
      if (task.type === 'export-preparation') {
        for (const artifact of artifacts.filter((candidate) => candidate.type === 'EXPORT_MANIFEST')) {
          const binding = await tx.storyArtifactBinding.findFirst({
            where: { artifactId: artifact.id, buildRunId, bindingKind: 'LEDGER', entityType: 'build-compilation' }
          });
          const compilation = binding ? await tx.buildCompilation.findFirst({ where: { id: binding.entityId ?? '', buildRunId, exportManifestArtifactId: artifact.id } }) : null;
          if (!binding || !compilation) throw new HttpError(409, 'Export manifest is not bound to a verified BuildCompilation');
        }
      }
      if (new Set(artifacts.map((artifact) => `${artifact.type}:${artifact.key}`)).size !== artifacts.length) throw new HttpError(409, 'Task outputs contain duplicate artifact type/key pairs');
      for (const type of requiredTypes) {
        const produced = artifacts.filter((artifact) => artifact.type === toPrismaArtifactType(type));
        if (!produced.length) throw new HttpError(409, `Task requires a ${type} artifact`);
        const run = await tx.buildRun.findUniqueOrThrow({ where: { id: buildRunId }, select: { manifest: true } });
        const manifest = run.manifest as JsonObject;
        const spec = Array.isArray(manifest.artifactSpecs)
          ? manifest.artifactSpecs.filter(isJsonObjectValue).find((candidate) => candidate.type === type)
          : undefined;
        const aggregateProducer = new Set([
          'create-character-bibles', 'create-plot-threads', 'create-beats', 'create-chapter-briefs', 'create-scene-plans'
        ]).has(task.type);
        const explicitMin = typeof criteria.minOutputCount === 'number' ? criteria.minOutputCount : null;
        const explicitMax = typeof criteria.maxOutputCount === 'number' ? criteria.maxOutputCount : null;
        const minCount = explicitMin ?? (aggregateProducer && spec && typeof spec.minCount === 'number' ? spec.minCount : 1);
        const maxCount = explicitMax ?? (aggregateProducer && spec && typeof spec.maxCount === 'number' ? spec.maxCount : 1);
        if (produced.length < minCount || produced.length > maxCount) {
          throw new HttpError(409, `Task produced ${produced.length} ${type} artifacts; required range is ${minCount}-${maxCount}`);
        }
      }
    } else if (requiredTypes.length) {
      throw new HttpError(409, `Task requires output artifacts: ${requiredTypes.join(', ')}`);
    }
    if (criteria.requiresPassingEvaluation === true) {
      const rubric = typeof criteria.rubric === 'string' ? criteria.rubric : undefined;
      const passed = await tx.buildEvaluationResult.findFirst({
        where: { buildRunId, taskId: task.id, kind: 'MODEL', passed: true, ...(rubric ? { rubric } : {}), evidence: { not: Prisma.DbNull } },
        orderBy: { createdAt: 'desc' }
      });
      if (!passed || (task.qualityThreshold !== null && (passed.threshold ?? 0) < task.qualityThreshold)) {
        throw new HttpError(409, 'Task requires an independent passing MODEL evaluation at the configured rubric threshold');
      }
    }
    if (qualityScore !== undefined && (qualityScore < 0 || qualityScore > 1)) throw new HttpError(400, 'qualityScore must be between 0 and 1');
    if (task.type === 'quality-gate' && task.qualityThreshold !== null && qualityScore !== undefined && qualityScore < task.qualityThreshold) throw new HttpError(409, `Quality score ${qualityScore} is below the required threshold ${task.qualityThreshold}`);
    if ((task.type.includes('revision') || task.type.startsWith('revise-')) && task.revisionIteration > task.maxRevisionIterations) throw new HttpError(409, 'Task revision iteration budget is exhausted');
    if (task.key === 'planning-quality-gate') {
      await this.validateBuildCompletenessInTransaction(tx, buildRunId, { requireExport: false, planningOnly: true });
    }
    if (task.type === 'aggregate-beats' || task.type === 'aggregate-scene-plans') await this.validatePlanningAggregate(tx, buildRunId, task.type);
    if (task.type === 'finalization') await this.validateBuildCompletenessInTransaction(tx, buildRunId, { requireExport: false });
    if (task.type === 'export-preparation' || task.key === 'final-checkpoint') {
      await this.validateBuildCompletenessInTransaction(tx, buildRunId, { requireExport: true });
    }
  }

  async validateBuildCompletenessInTransaction(
    tx: NovelBuildTx,
    buildRunId: string,
    options: { requireExport: boolean; planningOnly?: boolean }
  ): Promise<JsonObject> {
    const run = await tx.buildRun.findUniqueOrThrow({ where: { id: buildRunId } });
    const manifest = run.manifest as JsonObject;
    const target = isJsonObjectValue(manifest.target) ? manifest.target : {};
    const specs = Array.isArray(manifest.artifactSpecs) ? manifest.artifactSpecs.filter(isJsonObjectValue) : [];
    if (!specs.length) throw new HttpError(409, 'Build manifest has no enforceable artifact specifications');
    const artifacts = await tx.storyArtifact.findMany({
      where: { buildRunId, invalidatedAt: null, status: { in: ['VALIDATED', 'ACCEPTED'] } },
      orderBy: { version: 'desc' }
    });
    const latest = latestArtifactsByKey(artifacts);
    for (const spec of specs) {
      const type = typeof spec.type === 'string' ? spec.type as StoryArtifactType : null;
      if (!type) throw new HttpError(409, 'Build manifest contains an invalid artifact type');
      if (!options.requireExport && ['chapter-draft', 'export-manifest'].includes(type)) continue;
      const count = latest.filter((artifact) => artifact.type === toPrismaArtifactType(type)).length;
      const min = typeof spec.minCount === 'number' ? spec.minCount : 0;
      const max = typeof spec.maxCount === 'number' ? spec.maxCount : Number.MAX_SAFE_INTEGER;
      if (count < min || count > max) throw new HttpError(409, `Artifact count for ${type} is ${count}; required range is ${min}-${max}`);
    }
    const finale = latest.find((artifact) => artifact.type === 'FINALE_PLAN');
    if (!finale) throw new HttpError(409, 'Build is missing a validated finale plan');
    const finaleContent = finale.content as JsonObject;
    if (finaleContent.resolvesMainThread !== true || typeof finaleContent.mainThreadKey !== 'string') throw new HttpError(409, 'Finale plan does not resolve the main plot thread');
    const mainThread = latest.find((artifact) => artifact.type === 'PLOT_THREAD'
      && isJsonObjectValue(artifact.content)
      && [artifact.key, artifact.content.threadKey].includes(finaleContent.mainThreadKey)
      && artifact.content.kind === 'main');
    if (!mainThread) throw new HttpError(409, 'Finale mainThreadKey does not reference the validated main plot thread');
    if (options.planningOnly) {
      const chapterArtifacts = latest.filter((artifact) => artifact.type === 'CHAPTER_BRIEF');
      const sceneArtifacts = latest.filter((artifact) => artifact.type === 'SCENE_PLAN');
      const beatArtifacts = latest.filter((artifact) => artifact.type === 'BEAT');
      const characterArtifacts = latest.filter((artifact) => artifact.type === 'CHARACTER_BIBLE');
      const actArtifact = latest.find((artifact) => artifact.type === 'ACT_ARCHITECTURE');
      if (!actArtifact) throw new HttpError(409, 'Build is missing validated act architecture');
      const targetChapters = numericJson(target.targetChapterCount);
      const targetScenes = numericJson(target.targetSceneCount);
      const targetCharacters = numericJson(target.targetCharacterCount);
      if (targetChapters !== null && chapterArtifacts.length !== targetChapters) throw new HttpError(409, `Planning has ${chapterArtifacts.length} chapter briefs; target is ${targetChapters}`);
      if (targetScenes !== null && sceneArtifacts.length !== targetScenes) throw new HttpError(409, `Planning has ${sceneArtifacts.length} scene plans; target is ${targetScenes}`);
      if (targetCharacters !== null && characterArtifacts.length !== targetCharacters) throw new HttpError(409, `Planning has ${characterArtifacts.length} character bibles; target is ${targetCharacters}`);

      const chapters = chapterArtifacts.map((artifact) => {
        const content = artifact.content as JsonObject;
        return {
          artifact,
          chapterKey: requiredText(content.chapterKey, 'chapterKey', 500),
          number: requiredPositiveInt(content.number, 'Chapter number'),
          actKey: typeof content.actKey === 'string' ? content.actKey : null,
          sceneKeys: stringArray(content.sceneKeys)
        };
      });
      assertUniqueValues(chapters.map((chapter) => chapter.chapterKey), 'chapter keys');
      assertUniqueValues(chapters.map((chapter) => String(chapter.number)), 'chapter numbers');
      const sortedNumbers = chapters.map((chapter) => chapter.number).sort((a, b) => a - b);
      if (sortedNumbers.some((number, index) => number !== index + 1)) throw new HttpError(409, 'Chapter numbers must form a contiguous sequence beginning at 1');
      const chapterByKey = new Map(chapters.map((chapter) => [chapter.chapterKey, chapter]));

      const scenes = sceneArtifacts.map((artifact) => {
        const content = artifact.content as JsonObject;
        return {
          artifact,
          sceneKey: requiredText(content.sceneKey, 'sceneKey', 500),
          chapterKey: requiredText(content.chapterKey, 'chapterKey', 500),
          ordinal: requiredPositiveInt(content.ordinal, 'Scene ordinal'),
          dependencies: stringArray(content.dependencies),
          characterRefs: Array.isArray(content.characterRefs) ? content.characterRefs.filter(isJsonObjectValue) : [],
          plotThreadRefs: Array.isArray(content.plotThreadRefs) ? content.plotThreadRefs.filter(isJsonObjectValue) : []
        };
      });
      assertUniqueValues(scenes.map((scene) => scene.sceneKey), 'scene keys');
      const sceneByKey = new Map(scenes.map((scene) => [scene.sceneKey, scene]));
      const orderedScenes = scenes.slice().sort((left, right) => (chapterByKey.get(left.chapterKey)?.number ?? Number.MAX_SAFE_INTEGER) - (chapterByKey.get(right.chapterKey)?.number ?? Number.MAX_SAFE_INTEGER) || left.ordinal - right.ordinal || left.sceneKey.localeCompare(right.sceneKey));
      const storyOrder = new Map(orderedScenes.map((scene, index) => [scene.sceneKey, index]));
      const scenePlanProducerIds = unique(sceneArtifacts.flatMap((artifact) => artifact.taskId ? [artifact.taskId] : []));
      const scenePlanProducers = scenePlanProducerIds.length
        ? await tx.buildTask.findMany({ where: { id: { in: scenePlanProducerIds }, buildRunId }, select: { acceptanceCriteria: true } })
        : [];
      const exactChapterSceneKeysRequired = scenePlanProducers.some((producer) =>
        isJsonObjectValue(producer.acceptanceCriteria) && producer.acceptanceCriteria.exactChapterSceneKeysRequired === true
      );
      for (const chapter of chapters) {
        assertUniqueValues(chapter.sceneKeys, `scene keys in chapter '${chapter.chapterKey}'`);
        const actual = scenes.filter((scene) => scene.chapterKey === chapter.chapterKey).sort((a, b) => a.ordinal - b.ordinal);
        if (!actual.length) throw new HttpError(409, `Chapter '${chapter.chapterKey}' has no scene plans`);
        const firstOrdinal = actual[0]!.ordinal;
        if (actual.some((scene, index) => scene.ordinal !== firstOrdinal + index)) throw new HttpError(409, `Scene ordinals in chapter '${chapter.chapterKey}' must be contiguous`);
        if (exactChapterSceneKeysRequired && !sameStringSet(chapter.sceneKeys, actual.map((scene) => scene.sceneKey))) {
          throw new HttpError(409, `Chapter '${chapter.chapterKey}' sceneKeys do not exactly match its scene plans`);
        }
      }
      for (const scene of scenes) {
        if (!chapterByKey.has(scene.chapterKey)) throw new HttpError(409, `Scene '${scene.sceneKey}' references missing chapter '${scene.chapterKey}'`);
        assertUniqueValues(scene.dependencies, `dependencies for scene '${scene.sceneKey}'`);
        for (const dependency of scene.dependencies) {
          if (!sceneByKey.has(dependency)) throw new HttpError(409, `Scene '${scene.sceneKey}' references missing dependency '${dependency}'`);
          if ((storyOrder.get(dependency) ?? Number.MAX_SAFE_INTEGER) >= (storyOrder.get(scene.sceneKey) ?? -1)) throw new HttpError(409, `Scene '${scene.sceneKey}' must occur after dependency '${dependency}'`);
        }
      }
      assertAcyclicScenePlans(scenes);

      const beatKeys = beatArtifacts.map((artifact) => requiredText((artifact.content as JsonObject).beatKey, 'beatKey', 500));
      assertUniqueValues(beatKeys, 'beat keys');
      const beatKeySet = new Set(beatKeys);
      for (const artifact of beatArtifacts) {
        const content = artifact.content as JsonObject;
        const key = requiredText(content.beatKey, 'beatKey', 500);
        for (const linked of [...stringArray(content.causeKeys), ...stringArray(content.consequenceKeys)]) if (!beatKeySet.has(linked)) throw new HttpError(409, `Beat '${key}' references missing beat '${linked}'`);
      }

      const actContent = actArtifact.content as JsonObject;
      const acts = Array.isArray(actContent.acts) ? actContent.acts.filter(isJsonObjectValue).map((act) => ({
        actKey: requiredText(act.actKey, 'actKey', 500),
        chapterKeys: stringArray(act.chapterKeys),
        beatKeys: stringArray(act.beatKeys)
      })) : [];
      if (!acts.length) throw new HttpError(409, 'Act architecture must contain at least one act');
      assertUniqueValues(acts.map((act) => act.actKey), 'act keys');
      const declaredChapterKeys = acts.flatMap((act) => act.chapterKeys);
      const declaredBeatKeys = acts.flatMap((act) => act.beatKeys);
      assertUniqueValues(declaredChapterKeys, 'chapter assignments across acts');
      assertUniqueValues(declaredBeatKeys, 'beat assignments across acts');
      if (!sameStringSet(declaredChapterKeys, chapters.map((chapter) => chapter.chapterKey))) throw new HttpError(409, 'Act architecture chapterKeys must exactly cover all chapter briefs');
      if (!sameStringSet(declaredBeatKeys, beatKeys)) throw new HttpError(409, 'Act architecture beatKeys must exactly cover all beats');
      const actByKey = new Map(acts.map((act) => [act.actKey, act]));
      for (const chapter of chapters) {
        if (!chapter.actKey || !actByKey.get(chapter.actKey)?.chapterKeys.includes(chapter.chapterKey)) throw new HttpError(409, `Chapter '${chapter.chapterKey}' is not assigned to its declared act`);
      }

      const characterKeys = new Set(characterArtifacts.flatMap((artifact) => [artifact.key, typeof (artifact.content as JsonObject).characterKey === 'string' ? String((artifact.content as JsonObject).characterKey) : artifact.key]));
      const threadKeys = new Set(latest.filter((artifact) => artifact.type === 'PLOT_THREAD').flatMap((artifact) => [artifact.id, artifact.key, typeof (artifact.content as JsonObject).threadKey === 'string' ? String((artifact.content as JsonObject).threadKey) : artifact.key]));
      const world = latest.find((artifact) => artifact.type === 'WORLD_BIBLE');
      const worldContent = world ? world.content as JsonObject : {};
      const locationKeys = new Set((Array.isArray(worldContent.geography) ? worldContent.geography.filter(isJsonObjectValue) : []).flatMap((entry) => [entry.key, entry.name].filter((value): value is string => typeof value === 'string')));
      const worldRuleKeys = new Set((Array.isArray(worldContent.rules) ? worldContent.rules.filter(isJsonObjectValue) : []).flatMap((entry) => typeof entry.key === 'string' ? [entry.key] : []));
      const setupMap = latest.find((artifact) => artifact.type === 'SETUP_PAYOFF_MAP');
      const setupKeys = new Set(setupMap && isJsonObjectValue(setupMap.content) && Array.isArray(setupMap.content.links)
        ? setupMap.content.links.filter(isJsonObjectValue).flatMap((link) => typeof link.key === 'string' ? [link.key] : []) : []);
      const [canonicalCharacters, canonicalLocations] = await Promise.all([
        tx.character.findMany({ where: { projectId: run.projectId }, select: { id: true, name: true, aliases: true } }),
        tx.location.findMany({ where: { projectId: run.projectId }, select: { id: true, name: true } })
      ]);
      canonicalCharacters.forEach((character) => [character.id, character.name, ...character.aliases].forEach((value) => characterKeys.add(value)));
      canonicalLocations.forEach((location) => [location.id, location.name].forEach((value) => locationKeys.add(value)));
      const artifactsByType = new Map<string, Set<string>>();
      const allArtifactRefs = new Set<string>();
      for (const artifact of latest) {
        const type = artifact.type.toLowerCase().replaceAll('_', '-');
        const values = artifactsByType.get(type) ?? new Set<string>();
        values.add(artifact.id); values.add(artifact.key); allArtifactRefs.add(artifact.id); allArtifactRefs.add(artifact.key);
        artifactsByType.set(type, values);
      }
      const assertPlanningReference = (ref: { type: string; id: string; key?: string }) => {
        const candidates = [ref.id, ref.key].filter((value): value is string => Boolean(value));
        const valid = ref.type === 'character' ? candidates.some((value) => characterKeys.has(value))
          : ref.type === 'location' ? candidates.some((value) => locationKeys.has(value))
          : ['chapter', 'chapter-brief'].includes(ref.type) ? candidates.some((value) => chapterByKey.has(value) || artifactsByType.get('chapter-brief')?.has(value))
          : ['scene', 'scene-plan'].includes(ref.type) ? candidates.some((value) => sceneByKey.has(value) || artifactsByType.get('scene-plan')?.has(value))
          : ref.type === 'plot-thread' ? candidates.some((value) => threadKeys.has(value))
          : ref.type === 'setup-payoff' ? candidates.some((value) => setupKeys.has(value))
          : ref.type === 'world-rule' ? candidates.some((value) => worldRuleKeys.has(value))
          : ref.type === 'artifact' ? candidates.some((value) => allArtifactRefs.has(value))
          : candidates.some((value) => artifactsByType.get(ref.type)?.has(value));
        if (!valid) throw new HttpError(409, `Planning artifact reference '${ref.type}:${ref.id}' does not resolve inside this project/build`);
      };
      for (const artifact of latest) for (const ref of collectJsonReferences(artifact.content as JsonValue)) assertPlanningReference(ref);
      for (const scene of scenes) {
        for (const ref of scene.characterRefs) {
          const id = typeof ref.id === 'string' ? ref.id : '';
          const key = typeof ref.key === 'string' ? ref.key : '';
          if (!characterKeys.has(id) && !characterKeys.has(key)) {
            const canonical = id ? await tx.character.findFirst({ where: { id, projectId: run.projectId }, select: { id: true } }) : null;
            if (!canonical) throw new HttpError(409, `Scene '${scene.sceneKey}' references missing character '${id || key}'`);
          }
        }
        for (const ref of scene.plotThreadRefs) {
          const id = typeof ref.id === 'string' ? ref.id : '';
          const key = typeof ref.key === 'string' ? ref.key : '';
          if (!threadKeys.has(id) && !threadKeys.has(key)) throw new HttpError(409, `Scene '${scene.sceneKey}' references missing plot thread '${id || key}'`);
        }
      }
      return { artifactSpecsSatisfied: true, chapterCount: chapters.length, scenePlanCount: scenes.length, beatCount: beatArtifacts.length, finaleResolved: true };
    }
    const units = await tx.buildManuscriptUnit.findMany({ where: { buildRunId, invalidatedAt: null }, include: { branch: { include: { headVersion: true } } } });
    const chapterUnits = units.filter((unit) => unit.kind === 'CHAPTER');
    const sceneUnits = units.filter((unit) => unit.kind === 'SCENE');
    const chapterTarget = numericJson(target.targetChapterCount);
    const sceneTarget = numericJson(target.targetSceneCount);
    if (chapterTarget !== null && chapterUnits.length !== chapterTarget) throw new HttpError(409, `Build has ${chapterUnits.length} chapter units; target is ${chapterTarget}`);
    if (sceneTarget !== null && sceneUnits.length !== sceneTarget) throw new HttpError(409, `Build has ${sceneUnits.length} scene units; target is ${sceneTarget}`);
    if (new Set(chapterUnits.map((unit) => unit.chapterNumber)).size !== chapterUnits.length) throw new HttpError(409, 'Build chapter numbers are not unique');
    for (const chapter of chapterUnits) {
      const scenes = sceneUnits.filter((scene) => scene.parentUnitId === chapter.id);
      if (!scenes.length) throw new HttpError(409, `Chapter unit '${chapter.key}' has no scene units`);
      if (new Set(scenes.map((scene) => scene.order)).size !== scenes.length) throw new HttpError(409, `Chapter unit '${chapter.key}' has duplicate scene ordinals`);
    }
    const sceneDependencies = sceneUnits.map((unit) => ({
      sceneKey: unit.key,
      dependencies: stringArray(isJsonObjectValue(unit.metadata) ? unit.metadata.dependencies : undefined)
    }));
    assertAcyclicScenePlans(sceneDependencies);
    const compilation = await tx.buildCompilation.findFirst({ where: { buildRunId }, orderBy: { createdAt: 'desc' } });
    if (!compilation) throw new HttpError(409, 'Build has no deterministic manuscript compilation');
    const minWords = numericJson(target.minWordCount);
    const maxWords = numericJson(target.maxWordCount);
    if (minWords !== null && compilation.totalWordCount < minWords) throw new HttpError(409, `Compiled manuscript has ${compilation.totalWordCount} words; minimum is ${minWords}`);
    if (maxWords !== null && compilation.totalWordCount > maxWords) throw new HttpError(409, `Compiled manuscript has ${compilation.totalWordCount} words; maximum is ${maxWords}`);
    if (options.requireExport) {
      if (!compilation.exportManifestArtifactId) throw new HttpError(409, 'External export service has not registered an export manifest');
      const exportArtifact = await tx.storyArtifact.findFirst({
        where: { id: compilation.exportManifestArtifactId, buildRunId, type: 'EXPORT_MANIFEST', status: { in: ['VALIDATED', 'ACCEPTED'] }, invalidatedAt: null }
      });
      if (!exportArtifact) throw new HttpError(409, 'Latest compilation export manifest is missing or invalidated');
      validateArtifactContent('export-manifest', exportArtifact.content);
    }
    return {
      artifactSpecsSatisfied: true,
      chapterCount: chapterUnits.length,
      sceneCount: sceneUnits.length,
      totalWordCount: compilation.totalWordCount,
      finaleResolved: true,
      exportRegistered: Boolean(compilation.exportManifestArtifactId)
    };
  }

  private async validatePlanningAggregate(tx: NovelBuildTx, buildRunId: string, type: 'aggregate-beats' | 'aggregate-scene-plans') {
    const run = await tx.buildRun.findUniqueOrThrow({ where: { id: buildRunId }, select: { manifest: true } });
    const target = isJsonObjectValue((run.manifest as JsonObject).target) ? (run.manifest as JsonObject).target as JsonObject : {};
    const artifactType = type === 'aggregate-beats' ? 'BEAT' as const : 'SCENE_PLAN' as const;
    const expected = numericJson(target.targetSceneCount);
    const artifacts = latestArtifactsByKey(await tx.storyArtifact.findMany({ where: { buildRunId, type: artifactType, status: { in: ['VALIDATED', 'ACCEPTED'] }, invalidatedAt: null } }));
    if (expected !== null && artifacts.length !== expected) throw new HttpError(409, `${type} found ${artifacts.length} outputs; expected ${expected}`);
    const keys = artifacts.map((artifact) => requiredText((artifact.content as JsonObject)[type === 'aggregate-beats' ? 'beatKey' : 'sceneKey'], 'aggregate key', 500));
    assertUniqueValues(keys, `${type} output keys`);
    if (type === 'aggregate-scene-plans') {
      const chapters = new Set((await tx.storyArtifact.findMany({ where: { buildRunId, type: 'CHAPTER_BRIEF', status: { in: ['VALIDATED', 'ACCEPTED'] }, invalidatedAt: null } })).map((artifact) => requiredText((artifact.content as JsonObject).chapterKey, 'chapterKey', 500)));
      const scenes = artifacts.map((artifact) => ({ sceneKey: requiredText((artifact.content as JsonObject).sceneKey, 'sceneKey', 500), chapterKey: requiredText((artifact.content as JsonObject).chapterKey, 'chapterKey', 500), dependencies: stringArray((artifact.content as JsonObject).dependencies) }));
      for (const scene of scenes) {
        if (!chapters.has(scene.chapterKey)) throw new HttpError(409, `Scene shard output '${scene.sceneKey}' references missing chapter '${scene.chapterKey}'`);
        for (const dependency of scene.dependencies) if (!keys.includes(dependency)) throw new HttpError(409, `Scene shard output '${scene.sceneKey}' references missing dependency '${dependency}'`);
      }
      assertAcyclicScenePlans(scenes);
    }
  }

  private async dependenciesDone(tx: NovelBuildTx, task: BuildTask): Promise<boolean> {
    if (!task.dependencyIds.length) return true;
    const done = await tx.buildTask.count({ where: { id: { in: task.dependencyIds }, buildRunId: task.buildRunId, status: 'DONE' } });
    return done === task.dependencyIds.length;
  }

  async materializeChapterGraphsInTransaction(tx: NovelBuildTx, buildRunId: string): Promise<string[]> {
    const run = await tx.buildRun.findUniqueOrThrow({ where: { id: buildRunId } });
    const [briefs, plans] = await Promise.all([
      tx.storyArtifact.findMany({
        where: { buildRunId, type: 'CHAPTER_BRIEF', status: 'ACCEPTED', invalidatedAt: null },
        orderBy: [{ key: 'asc' }, { version: 'desc' }]
      }),
      tx.storyArtifact.findMany({
        where: { buildRunId, type: 'SCENE_PLAN', status: 'ACCEPTED', invalidatedAt: null },
        orderBy: [{ key: 'asc' }, { version: 'desc' }]
      })
    ]);
    const latestBriefs = latestArtifactsByKey(briefs);
    const latestPlans = latestArtifactsByKey(plans);
    const ordered = latestBriefs.map((artifact) => {
      const content = artifact.content as JsonObject;
      return { artifact, content, chapterKey: requiredText(content.chapterKey, 'chapterKey', 500), number: requiredPositiveInt(content.number, 'chapter number') };
    }).sort((a, b) => a.number - b.number || a.chapterKey.localeCompare(b.chapterKey));
    if (new Set(ordered.map((item) => item.chapterKey)).size !== ordered.length || new Set(ordered.map((item) => item.number)).size !== ordered.length) {
      throw new HttpError(409, 'Accepted chapter briefs contain duplicate keys or chapter numbers');
    }
    const acceptedChapterKeys = new Set(ordered.map((chapter) => chapter.chapterKey));
    const sceneRecords = latestPlans.map((artifact) => {
      const content = artifact.content as JsonObject;
      return {
        artifact,
        content,
        sceneKey: requiredText(content.sceneKey, 'sceneKey', 500),
        chapterKey: requiredText(content.chapterKey, 'chapterKey', 500),
        ordinal: requiredPositiveInt(content.ordinal, 'scene ordinal'),
        dependencies: stringArray(content.dependencies)
      };
    }).filter((scene) => acceptedChapterKeys.has(scene.chapterKey));
    if (new Set(sceneRecords.map((item) => item.sceneKey)).size !== sceneRecords.length) throw new HttpError(409, 'Accepted scene plans contain duplicate keys');
    const localSceneOrder = new Map<string, number>();
    for (const chapter of ordered) {
      const chapterScenes = sceneRecords.filter((scene) => scene.chapterKey === chapter.chapterKey).sort((left, right) => left.ordinal - right.ordinal || left.sceneKey.localeCompare(right.sceneKey));
      if (new Set(chapterScenes.map((scene) => scene.ordinal)).size !== chapterScenes.length) throw new HttpError(409, `Chapter '${chapter.chapterKey}' has duplicate scene ordinals`);
      const firstOrdinal = chapterScenes[0]?.ordinal;
      if (firstOrdinal !== undefined && chapterScenes.some((scene, index) => scene.ordinal !== firstOrdinal + index)) throw new HttpError(409, `Chapter '${chapter.chapterKey}' has non-contiguous scene ordinals`);
      chapterScenes.forEach((scene, index) => localSceneOrder.set(scene.sceneKey, index));
    }
    const sceneKeys = new Set(sceneRecords.map((scene) => scene.sceneKey));
    for (const scene of sceneRecords) for (const dependency of scene.dependencies) if (!sceneKeys.has(dependency)) throw new HttpError(409, `Scene '${scene.sceneKey}' depends on missing accepted scene '${dependency}'`);
    assertAcyclicScenePlans(sceneRecords);
    const created: string[] = [];
    const chapterUnits = new Map<string, { id: string; key: string }>();
    const sceneUnits = new Map<string, { id: string; key: string }>();
    const [characters, locations, canonicalChapters, entityBindings] = await Promise.all([
      tx.character.findMany({ where: { projectId: run.projectId }, select: { id: true, name: true, aliases: true } }),
      tx.location.findMany({ where: { projectId: run.projectId }, select: { id: true, name: true } }),
      tx.chapter.findMany({
        where: { projectId: run.projectId, deletedAt: null },
        select: { id: true, number: true, scenes: { select: { id: true, order: true } } }
      }),
      tx.storyArtifactBinding.findMany({
        where: { buildRunId, artifactId: { in: [...latestBriefs, ...latestPlans].map((artifact) => artifact.id) }, bindingKind: 'ENTITY', entityType: { in: ['chapter', 'scene'] } },
        select: { artifactId: true, entityType: true, entityId: true }
      })
    ]);
    const characterRefs = new Map(characters.flatMap((character) => [character.id, character.name, ...character.aliases].map((value) => [value, character.id] as const)));
    const locationRefs = new Map(locations.flatMap((location) => [[location.id, location.id] as const, [location.name, location.id] as const]));
    const canonicalChapterById = new Map(canonicalChapters.map((chapter) => [chapter.id, chapter]));
    const sourceChapterIds = new Map<string, string | null>();
    const usedChapterIds = new Set<string>();
    for (const chapter of ordered) {
      const explicit = entityBindings.find((binding) => binding.artifactId === chapter.artifact.id && binding.entityType === 'chapter')?.entityId ?? null;
      const candidates = explicit ? [canonicalChapterById.get(explicit)].filter(Boolean) : canonicalChapters.filter((candidate) => candidate.number === chapter.number);
      if (candidates.length > 1) throw new HttpError(409, `Chapter plan '${chapter.chapterKey}' ambiguously matches multiple canonical chapters`);
      const sourceChapterId = candidates[0]?.id ?? null;
      if (explicit && !sourceChapterId) throw new HttpError(409, `Chapter plan '${chapter.chapterKey}' has a stale canonical entity binding`);
      if (sourceChapterId && usedChapterIds.has(sourceChapterId)) throw new HttpError(409, `Multiple chapter plans map to canonical chapter '${sourceChapterId}'`);
      if (sourceChapterId) usedChapterIds.add(sourceChapterId);
      sourceChapterIds.set(chapter.chapterKey, sourceChapterId);
      const unit = await this.ensureBuildUnit(tx, run, {
        kind: 'CHAPTER', key: chapter.chapterKey, parentUnitId: null, containerKey: '__manuscript__', order: chapter.number - 1,
        chapterNumber: chapter.number, title: typeof chapter.content.title === 'string' ? chapter.content.title : chapter.artifact.title,
        planArtifactId: chapter.artifact.id,
        sourceChapterId,
        povCharacterId: resolvePlanReference(chapter.content.povRef, characterRefs),
        locationId: resolvePlanReference(chapter.content.locationRef, locationRefs),
        metadata: chapter.content
      });
      chapterUnits.set(chapter.chapterKey, { id: unit.id, key: unit.key });
      if (sourceChapterId && !explicit) await tx.storyArtifactBinding.create({ data: {
        projectId: run.projectId, buildRunId, artifactId: chapter.artifact.id, bindingKind: 'ENTITY',
        entityType: 'chapter', entityId: sourceChapterId, role: 'source-canonical-chapter'
      } });
    }
    const usedSceneIds = new Set<string>();
    for (const scene of sceneRecords.sort((a, b) => {
      const chapterA = ordered.find((chapter) => chapter.chapterKey === a.chapterKey)?.number ?? 0;
      const chapterB = ordered.find((chapter) => chapter.chapterKey === b.chapterKey)?.number ?? 0;
      return chapterA - chapterB || a.ordinal - b.ordinal;
    })) {
      const parent = chapterUnits.get(scene.chapterKey);
      if (!parent) throw new HttpError(409, `Scene '${scene.sceneKey}' references missing accepted chapter '${scene.chapterKey}'`);
      const explicit = entityBindings.find((binding) => binding.artifactId === scene.artifact.id && binding.entityType === 'scene')?.entityId ?? null;
      const sourceChapterId = sourceChapterIds.get(scene.chapterKey) ?? null;
      const canonicalParent = sourceChapterId ? canonicalChapterById.get(sourceChapterId) : null;
      const localOrder = localSceneOrder.get(scene.sceneKey);
      if (localOrder === undefined) throw new HttpError(409, `Scene '${scene.sceneKey}' has no chapter-local order`);
      const candidates = explicit
        ? canonicalChapters.flatMap((chapter) => chapter.scenes).filter((candidate) => candidate.id === explicit)
        : canonicalParent?.scenes.filter((candidate) => candidate.order === localOrder) ?? [];
      if (candidates.length > 1) throw new HttpError(409, `Scene plan '${scene.sceneKey}' ambiguously matches multiple canonical scenes`);
      const sourceSceneId = candidates[0]?.id ?? null;
      if (explicit && !sourceSceneId) throw new HttpError(409, `Scene plan '${scene.sceneKey}' has a stale canonical entity binding`);
      if (sourceSceneId && usedSceneIds.has(sourceSceneId)) throw new HttpError(409, `Multiple scene plans map to canonical scene '${sourceSceneId}'`);
      if (sourceSceneId) usedSceneIds.add(sourceSceneId);
      const unit = await this.ensureBuildUnit(tx, run, {
        kind: 'SCENE', key: scene.sceneKey, parentUnitId: parent.id, containerKey: scene.chapterKey, order: localOrder,
        chapterNumber: null, title: typeof scene.content.title === 'string' ? scene.content.title : scene.artifact.title,
        planArtifactId: scene.artifact.id, tension: typeof scene.content.tension === 'number' ? scene.content.tension : null,
        sourceSceneId,
        povCharacterId: resolvePlanReference(scene.content.povRef, characterRefs),
        locationId: resolvePlanReference(scene.content.locationRef, locationRefs),
        storyDate: typeof scene.content.storyDate === 'string' ? scene.content.storyDate : null,
        storyTime: typeof scene.content.storyTime === 'string' ? scene.content.storyTime : null,
        metadata: scene.content
      });
      sceneUnits.set(scene.sceneKey, { id: unit.id, key: unit.key });
      if (sourceSceneId && !explicit) await tx.storyArtifactBinding.create({ data: {
        projectId: run.projectId, buildRunId, artifactId: scene.artifact.id, bindingKind: 'ENTITY',
        entityType: 'scene', entityId: sourceSceneId, role: 'source-canonical-scene'
      } });
    }
    const allTemplates: TaskTemplate[] = [];
    const taskScopes = new Map<string, { unitIds: string[]; inputArtifactIds: string[]; policy: JsonObject }>();
    let priorChapterCheckpointKey = 'planning-checkpoint';
    for (const chapter of ordered) {
      const chapterScenes = sceneRecords.filter((scene) => scene.chapterKey === chapter.chapterKey).sort((a, b) => a.ordinal - b.ordinal);
      let priorSceneCheckpointKey: string | null = null;
      for (const scene of chapterScenes) {
        const explicitDependencies = scene.dependencies.map((key) => `scene:${key}:checkpoint`);
        const dependencyKeys = unique([
          ...explicitDependencies,
          ...(priorSceneCheckpointKey ? (explicitDependencies.length ? [] : [priorSceneCheckpointKey]) : [priorChapterCheckpointKey])
        ]);
        const templates = createSceneTaskTemplates(scene.sceneKey, dependencyKeys);
        allTemplates.push(...templates);
        const unit = sceneUnits.get(scene.sceneKey)!;
        const chapterUnit = chapterUnits.get(chapter.chapterKey)!;
        for (const template of templates) taskScopes.set(template.key, {
          unitIds: [unit.id],
          inputArtifactIds: [chapter.artifact.id, scene.artifact.id],
          policy: { unitIds: [unit.id], unitKeys: [scene.sceneKey], chapterUnitId: chapterUnit.id, chapterKey: chapter.chapterKey, sceneKey: scene.sceneKey }
        });
        priorSceneCheckpointKey = `scene:${scene.sceneKey}:checkpoint`;
      }
      if (!chapterScenes.length) throw new HttpError(409, `Accepted chapter '${chapter.chapterKey}' has no accepted scene plans`);
      const compileTemplates = createChapterCompilationTaskTemplates(chapter.chapterKey, chapterScenes.map((scene) => `scene:${scene.sceneKey}:checkpoint`));
      allTemplates.push(...compileTemplates);
      const chapterUnit = chapterUnits.get(chapter.chapterKey)!;
      const scopedUnits = [chapterUnit.id, ...chapterScenes.map((scene) => sceneUnits.get(scene.sceneKey)!.id)];
      for (const template of compileTemplates) taskScopes.set(template.key, {
        unitIds: scopedUnits,
        inputArtifactIds: [chapter.artifact.id, ...chapterScenes.map((scene) => scene.artifact.id)],
        policy: { unitIds: scopedUnits, chapterUnitId: chapterUnit.id, chapterKey: chapter.chapterKey }
      });
      priorChapterCheckpointKey = `chapter:${chapter.chapterKey}:checkpoint`;
    }
    created.push(...await this.repository.ensureTaskTemplates(tx, buildRunId, allTemplates));
    const scopedTasks = await tx.buildTask.findMany({
      where: { buildRunId, key: { in: [...taskScopes.keys()] } },
      select: { id: true, key: true, executionPolicy: true }
    });
    for (const batch of chunks(scopedTasks, 250)) {
      const rows = batch.map((task) => {
        const scope = taskScopes.get(task.key)!;
        const policy = { ...(task.executionPolicy as Prisma.JsonObject), ...scope.policy };
        return Prisma.sql`(${task.id}::text, ${scope.unitIds}::text[], ${scope.inputArtifactIds}::text[], ${JSON.stringify(policy)}::jsonb)`;
      });
      await tx.$executeRaw(Prisma.sql`
        UPDATE "BuildTask" AS task
        SET "scopeUnitIds" = scoped.unit_ids,
            "inputArtifactIds" = scoped.input_artifact_ids,
            "executionPolicy" = scoped.policy,
            revision = task.revision + 1,
            "updatedAt" = CURRENT_TIMESTAMP
        FROM (VALUES ${Prisma.join(rows)}) AS scoped(id, unit_ids, input_artifact_ids, policy)
        WHERE task.id = scoped.id AND task."buildRunId" = ${buildRunId}
      `);
    }
    const allUnitIds = [...chapterUnits.values(), ...sceneUnits.values()].map((unit) => unit.id);
    await tx.buildTask.updateMany({
      where: { buildRunId, phase: 'revising' },
      data: { scopeUnitIds: allUnitIds, revision: { increment: 1 } }
    });
    return created;
  }

  private async acceptValidatedPlanArtifactsInTransaction(tx: NovelBuildTx, buildRunId: string) {
    await this.validateBuildCompletenessInTransaction(tx, buildRunId, { requireExport: false, planningOnly: true });
    await tx.storyArtifact.updateMany({
      where: {
        buildRunId,
        status: 'VALIDATED',
        type: { notIn: ['CHAPTER_DRAFT', 'REVISION_ISSUE', 'EXPORT_MANIFEST'] },
        invalidatedAt: null
      },
      data: { status: 'ACCEPTED', acceptedAt: new Date() }
    });
    await this.materializeChapterGraphsInTransaction(tx, buildRunId);
  }

  private async ensureBuildUnit(
    tx: NovelBuildTx,
    run: Prisma.BuildRunGetPayload<object>,
    input: {
      kind: 'CHAPTER' | 'SCENE'; key: string; parentUnitId: string | null; containerKey: string; order: number;
      chapterNumber: number | null; title: string; planArtifactId: string; tension?: number | null;
      sourceChapterId?: string | null; sourceSceneId?: string | null;
      povCharacterId?: string | null; locationId?: string | null;
      storyDate?: string | null; storyTime?: string | null; metadata: JsonObject;
    }
  ) {
    const existing = await tx.buildManuscriptUnit.findUnique({
      where: { buildRunId_kind_key: { buildRunId: run.id, kind: input.kind, key: input.key } }
    });
    if (existing) {
      if (existing.planArtifactId !== input.planArtifactId && existing.status !== 'INVALIDATED') {
        await tx.buildManuscriptUnit.update({ where: { id: existing.id }, data: {
          planArtifactId: input.planArtifactId, sourceChapterId: input.sourceChapterId, sourceSceneId: input.sourceSceneId,
          metadata: input.metadata as Prisma.InputJsonValue, revision: { increment: 1 }
        } });
      }
      return existing;
    }
    const writing = await tx.writing.create({ data: { projectId: run.projectId, kind: input.kind === 'CHAPTER' ? 'CHAPTER_BODY' : 'SCENE_BODY' } });
    const branch = await tx.writingBranch.create({ data: { writingId: writing.id, buildRunId: run.id, name: run.branchName } });
    const version = await tx.writingVersion.create({ data: { branchId: branch.id, body: '', wordCount: 0, authorId: run.createdById, message: 'Materialize accepted build plan unit' } });
    await tx.writingBranch.update({ where: { id: branch.id }, data: { headVersionId: version.id } });
    await tx.writing.update({ where: { id: writing.id }, data: { defaultBranchId: branch.id } });
    const unit = await tx.buildManuscriptUnit.create({ data: {
      projectId: run.projectId, buildRunId: run.id, planArtifactId: input.planArtifactId, parentUnitId: input.parentUnitId,
      sourceChapterId: input.sourceChapterId ?? null, sourceSceneId: input.sourceSceneId ?? null,
      writingId: writing.id, branchId: branch.id, kind: input.kind, status: 'PLANNED', key: input.key,
      containerKey: input.containerKey, order: input.order, chapterNumber: input.chapterNumber, title: input.title,
      povCharacterId: input.povCharacterId ?? null, locationId: input.locationId ?? null,
      storyDate: input.storyDate, storyTime: input.storyTime, tension: input.tension, metadata: input.metadata as Prisma.InputJsonValue
    } });
    await tx.storyArtifactBinding.create({ data: {
      projectId: run.projectId, buildRunId: run.id, artifactId: input.planArtifactId, unitId: unit.id,
      bindingKind: 'BUILD_UNIT', role: input.kind === 'CHAPTER' ? 'chapter-plan' : 'scene-plan'
    } });
    return unit;
  }

  private async invalidateTaskDerivedStateAndProse(
    tx: NovelBuildTx,
    buildRunId: string,
    taskIds: string[],
    artifactIds: string[],
    pinnedArtifactIds: string[]
  ) {
    const tasks = await tx.buildTask.findMany({ where: { id: { in: taskIds }, buildRunId }, select: { scopeUnitIds: true } });
    const unitIds = unique(tasks.flatMap((task) => task.scopeUnitIds));
    const invalidArtifactIds = artifactIds.filter((id) => !pinnedArtifactIds.includes(id));
    const stateWhere = {
      buildRunId,
      isCurrent: true,
      AND: [
        { OR: [
          { sourceTaskId: { in: taskIds } },
          ...(unitIds.length ? [{ sourceTaskId: null, sourceUnitId: { in: unitIds } }] : []),
          ...(invalidArtifactIds.length ? [{ sourceTaskId: null, sourceArtifactId: { in: invalidArtifactIds } }] : [])
        ] },
        ...(pinnedArtifactIds.length ? [{ OR: [{ sourceArtifactId: null }, { sourceArtifactId: { notIn: pinnedArtifactIds } }] }] : [])
      ]
    };
    const now = new Date();
    if (taskIds.length || unitIds.length || invalidArtifactIds.length) {
      await Promise.all([
        tx.canonFact.updateMany({ where: stateWhere, data: { isCurrent: false, status: 'INVALIDATED', invalidatedAt: now } }),
        tx.entityState.updateMany({ where: stateWhere, data: { isCurrent: false, status: 'INVALIDATED', invalidatedAt: now } }),
        tx.timelineEvent.updateMany({ where: stateWhere, data: { isCurrent: false, invalidatedAt: now } }),
        tx.plotThread.updateMany({ where: stateWhere, data: { isCurrent: false, status: 'INVALIDATED', invalidatedAt: now } }),
        tx.openLoop.updateMany({ where: { buildRunId, isCurrent: true, AND: [
          { OR: [{ sourceTaskId: { in: taskIds } }, ...(unitIds.length ? [{ sourceTaskId: null, sourceUnitId: { in: unitIds } }] : []), ...(invalidArtifactIds.length ? [{ sourceTaskId: null, introducedArtifactId: { in: invalidArtifactIds } }, { sourceTaskId: null, resolvedArtifactId: { in: invalidArtifactIds } }] : [])] },
          ...(pinnedArtifactIds.length ? [
            { OR: [{ introducedArtifactId: null }, { introducedArtifactId: { notIn: pinnedArtifactIds } }] },
            { OR: [{ resolvedArtifactId: null }, { resolvedArtifactId: { notIn: pinnedArtifactIds } }] }
          ] : [])
        ] }, data: { isCurrent: false, status: 'INVALIDATED', invalidatedAt: now } }),
        tx.setupPayoffLink.updateMany({ where: { buildRunId, isCurrent: true, AND: [
          { OR: [{ sourceTaskId: { in: taskIds } }, ...(unitIds.length ? [{ sourceTaskId: null, sourceUnitId: { in: unitIds } }] : []), ...(invalidArtifactIds.length ? [{ sourceTaskId: null, setupArtifactId: { in: invalidArtifactIds } }, { sourceTaskId: null, payoffArtifactId: { in: invalidArtifactIds } }] : [])] },
          ...(pinnedArtifactIds.length ? [
            { OR: [{ setupArtifactId: null }, { setupArtifactId: { notIn: pinnedArtifactIds } }] },
            { OR: [{ payoffArtifactId: null }, { payoffArtifactId: { notIn: pinnedArtifactIds } }] }
          ] : [])
        ] }, data: { isCurrent: false, status: 'INVALIDATED', invalidatedAt: now } })
      ]);
    }
    if (unitIds.length) {
      const pinnedBindings = pinnedArtifactIds.length ? await tx.storyArtifactBinding.findMany({ where: { buildRunId, artifactId: { in: pinnedArtifactIds }, unitId: { not: null } }, select: { unitId: true } }) : [];
      const preservedUnitIds = unique(pinnedBindings.flatMap((binding) => binding.unitId ? [binding.unitId] : []));
      const units = await tx.buildManuscriptUnit.findMany({ where: { id: { in: unitIds, ...(preservedUnitIds.length ? { notIn: preservedUnitIds } : {}) }, buildRunId }, select: { id: true, branchId: true } });
      const branches = units.length ? await tx.writingBranch.findMany({ where: { id: { in: units.map((unit) => unit.branchId) } }, select: { id: true, headVersionId: true } }) : [];
      const versions = units.length ? await tx.writingVersion.findMany({ where: { branchId: { in: units.map((unit) => unit.branchId) } }, select: { id: true, branchId: true, parentVersionId: true, sourceTaskId: true } }) : [];
      for (const unit of units) {
        const byId = new Map(versions.filter((version) => version.branchId === unit.branchId).map((version) => [version.id, version]));
        let cursor = branches.find((branch) => branch.id === unit.branchId)?.headVersionId ?? null;
        let restoreHead: string | null | undefined;
        while (cursor) {
          const version = byId.get(cursor);
          if (!version) break;
          if (version.sourceTaskId && taskIds.includes(version.sourceTaskId)) restoreHead = version.parentVersionId;
          cursor = version.parentVersionId;
        }
        if (restoreHead !== undefined) {
          await tx.writingBranch.update({ where: { id: unit.branchId }, data: { headVersionId: restoreHead } });
          await tx.buildManuscriptUnit.update({ where: { id: unit.id }, data: { status: 'DRAFTING', revision: { increment: 1 } } });
        }
      }
    }
  }

  private async restoreWritingBranchHeads(
    tx: NovelBuildTx,
    buildRunId: string,
    rawSnapshot: Prisma.JsonValue
  ): Promise<void> {
    if (!rawSnapshot || typeof rawSnapshot !== 'object' || Array.isArray(rawSnapshot)) return;
    const snapshotBranches = Array.isArray(rawSnapshot.writingBranches)
      ? rawSnapshot.writingBranches.filter((value): value is Prisma.JsonObject => Boolean(value) && typeof value === 'object' && !Array.isArray(value))
      : [];
    const heads = new Map<string, string | null>();
    for (const snapshotBranch of snapshotBranches) {
      if (typeof snapshotBranch.id !== 'string') continue;
      if (snapshotBranch.headVersionId !== null && typeof snapshotBranch.headVersionId !== 'string') continue;
      heads.set(snapshotBranch.id, snapshotBranch.headVersionId);
    }
    const branches = await tx.writingBranch.findMany({
      where: { buildRunId },
      include: { parentBranch: { select: { headVersionId: true } } }
    });
    for (const branch of branches) {
      const headVersionId = heads.has(branch.id)
        ? heads.get(branch.id) ?? null
        : branch.parentBranch?.headVersionId ?? null;
      if (headVersionId) {
        const version = await tx.writingVersion.findFirst({
          where: { id: headVersionId, branch: { writingId: branch.writingId } },
          select: { id: true }
        });
        if (!version) throw new HttpError(409, `Checkpoint references an invalid writing version for branch '${branch.id}'`);
      }
      await tx.writingBranch.update({ where: { id: branch.id }, data: { headVersionId } });
    }
  }

  private async snapshot(tx: NovelBuildTx, buildRunId: string): Promise<JsonValue> {
    const [run, tasks, artifacts, facts, states, events, loops, setups, threads, writingBranches] = await Promise.all([
      tx.buildRun.findUniqueOrThrow({ where: { id: buildRunId } }),
      tx.buildTask.findMany({ where: { buildRunId }, select: { id: true, key: true, status: true, revision: true, outputArtifactIds: true } }),
      tx.storyArtifact.findMany({ where: { buildRunId, invalidatedAt: null }, select: { id: true, type: true, key: true, version: true, contentHash: true, status: true } }),
      tx.canonFact.findMany({ where: { buildRunId, invalidatedAt: null }, select: { id: true, key: true, status: true } }),
      tx.entityState.findMany({ where: { buildRunId, invalidatedAt: null }, select: { id: true, key: true, status: true } }),
      tx.timelineEvent.findMany({ where: { buildRunId, invalidatedAt: null }, select: { id: true, key: true } }),
      tx.openLoop.findMany({ where: { buildRunId, invalidatedAt: null }, select: { id: true, key: true, status: true } }),
      tx.setupPayoffLink.findMany({ where: { buildRunId, invalidatedAt: null }, select: { id: true, key: true, status: true } }),
      tx.plotThread.findMany({ where: { buildRunId, invalidatedAt: null }, select: { id: true, key: true, status: true } }),
      tx.writingBranch.findMany({
        where: { buildRunId },
        select: { id: true, writingId: true, parentBranchId: true, headVersionId: true, name: true }
      })
    ]);
    return JSON.parse(JSON.stringify({
      run: { id: run.id, revision: run.revision, phase: run.currentPhase, status: run.status, branchName: run.branchName, tokensUsed: run.tokensUsed, costMicrosUsed: run.costMicrosUsed },
      tasks,
      artifacts,
      canonFacts: facts,
      entityStates: states,
      timelineEvents: events,
      openLoops: loops,
      setupPayoffs: setups,
      plotThreads: threads,
      writingBranches
    })) as JsonValue;
  }

  private async actionResult(
    projectId: string,
    buildRunId: string,
    taskId: string,
    unblockedTaskIds: string[],
    invalidatedTaskIds: string[],
    checkpoint: BuildCheckpoint | null,
    lease: JsonObject | null = null
  ): Promise<BuildTaskActionResult> {
    const buildRun = toBuildRun(await this.repository.get(projectId, buildRunId));
    const task = buildRun.tasks.find((candidate) => candidate.id === taskId);
    if (!task) throw new HttpError(404, 'Build task not found');
    return { buildRun, task, unblockedTaskIds, invalidatedTaskIds, checkpoint, lease: lease as unknown as BuildTaskLease | null };
  }
}

function transitiveDownstream(tasks: BuildTask[], taskId: string): string[] {
  if (!tasks.some((task) => task.id === taskId)) throw new HttpError(404, 'Build task not found');
  const result = new Set([taskId]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const task of tasks) {
      if (!result.has(task.id) && task.dependencyIds.some((dependencyId) => result.has(dependencyId))) {
        result.add(task.id);
        changed = true;
      }
    }
  }
  return tasks.filter((task) => result.has(task.id)).map((task) => task.id);
}

function assertExpectedRevision(actual: number, expected: number) {
  if (!Number.isInteger(expected) || expected < 0) throw new HttpError(400, 'expectedRevision must be a non-negative integer');
  if (actual !== expected) throw new HttpError(409, 'Build or task revision is stale', { expected, actual });
}

function validateIdempotencyKey(value: string) {
  requiredText(value, 'Idempotency key', 500);
}

function validateWorker(value: string) {
  requiredText(value, 'Worker id', 500);
}

function requiredText(value: unknown, label: string, max: number): string {
  if (typeof value !== 'string' || !value.trim()) throw new HttpError(400, `${label} is required`);
  if (value.trim().length > max) throw new HttpError(400, `${label} is too long`);
  return value.trim();
}

function validationError(error: unknown): HttpError {
  return new HttpError(400, 'Invalid Novel Build input', error instanceof Error ? { message: error.message } : error);
}

function clampInt(value: number, min: number, max: number): number {
  if (!Number.isInteger(value)) throw new HttpError(400, 'Expected an integer');
  return Math.min(Math.max(value, min), max);
}

function validateOptionalBudget(value: number | null | undefined, label: string) {
  if (value !== undefined && value !== null && (!Number.isInteger(value) || value < 1 || value > 2_000_000_000)) {
    throw new HttpError(400, `${label} must be a positive integer`);
  }
}

function validateReservation(value: number | undefined, label: string): number {
  if (value === undefined) return 0;
  if (!Number.isInteger(value) || value < 0 || value > 2_000_000_000) throw new HttpError(400, `${label} must be a non-negative integer`);
  return value;
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

function stringArray(value: JsonValue | undefined): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}

function latestArtifactsByKey<T extends { key: string; version: number; type?: unknown }>(artifacts: T[]): T[] {
  const latest = new Map<string, T>();
  for (const artifact of artifacts) {
    const identity = `${String(artifact.type ?? '')}:${artifact.key}`;
    if (!latest.has(identity) || latest.get(identity)!.version < artifact.version) latest.set(identity, artifact);
  }
  return [...latest.values()];
}

function assertUniqueValues(values: string[], label: string) {
  if (new Set(values).size !== values.length) throw new HttpError(409, `Planning contains duplicate ${label}`);
}

function sameStringSet(left: string[], right: string[]): boolean {
  return left.length === right.length && left.every((value) => right.includes(value));
}

function chunks<T>(values: T[], size: number): T[][] {
  const result: T[][] = [];
  for (let index = 0; index < values.length; index += size) result.push(values.slice(index, index + size));
  return result;
}

function requiredPositiveInt(value: JsonValue | undefined, label: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1) throw new HttpError(409, `${label} must be a positive integer`);
  return value;
}

function assertAcyclicScenePlans(scenes: Array<{ sceneKey: string; dependencies: string[] }>) {
  const dependencies = new Map(scenes.map((scene) => [scene.sceneKey, scene.dependencies]));
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const visit = (key: string) => {
    if (visiting.has(key)) throw new HttpError(409, `Scene dependency cycle includes '${key}'`);
    if (visited.has(key)) return;
    visiting.add(key);
    for (const dependency of dependencies.get(key) ?? []) visit(dependency);
    visiting.delete(key);
    visited.add(key);
  };
  scenes.forEach((scene) => visit(scene.sceneKey));
}

function isJsonObjectValue(value: unknown): value is JsonObject {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function numericJson(value: JsonValue | undefined): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function collectJsonReferences(value: JsonValue): Array<{ type: string; id: string; key?: string }> {
  const references: Array<{ type: string; id: string; key?: string }> = [];
  const visit = (node: JsonValue) => {
    if (Array.isArray(node)) return node.forEach(visit);
    if (!isJsonObjectValue(node)) return;
    if (typeof node.type === 'string' && typeof node.id === 'string') references.push({
      type: node.type,
      id: node.id,
      ...(typeof node.key === 'string' ? { key: node.key } : {})
    });
    Object.values(node).forEach(visit);
  };
  visit(value);
  return references;
}

function resolvePlanReference(value: JsonValue | undefined, references: Map<string, string>): string | null {
  if (!isJsonObjectValue(value)) return null;
  return (typeof value.id === 'string' ? references.get(value.id) : undefined)
    ?? (typeof value.key === 'string' ? references.get(value.key) : undefined)
    ?? null;
}
