import { createHash, randomUUID } from 'node:crypto';
import {
  Prisma,
  type BuildRunStatus,
  type BuildTask,
  type BuildTaskStatus,
  type PrismaClient
} from '@prisma/client';
import type {
  BuildAuthorizationScope,
  BuildManifest,
  BuildTaskLeaseInput,
  BuildTaskStatus as SdkBuildTaskStatus,
  CreateBuildRunInput,
  JsonValue
} from '@opentales/sdk';
import { HttpError } from '../http/HttpError.js';
import {
  buildRunInclude,
  toPrismaAutonomyMode,
  type BuildRunWithDetails
} from '../useCases/novelBuild/novelBuildMapper.js';
import {
  createPlanningTaskTemplates,
  REVISION_TASK_TEMPLATES,
  type TaskTemplate
} from '../useCases/novelBuild/schemas.js';

export type NovelBuildTx = Prisma.TransactionClient;

export type TaskLeaseContext = BuildTaskLeaseInput;

export interface TaskTransitionInput {
  status: BuildTaskStatus;
  idempotencyKey: string;
  reason?: string;
  metadata?: JsonValue;
  requestHash?: string;
  data?: Prisma.BuildTaskUpdateInput;
}

export class NovelBuildRepository {
  constructor(readonly prisma: PrismaClient) {}

  async transaction<T>(work: (tx: NovelBuildTx) => Promise<T>, isolationLevel: Prisma.TransactionIsolationLevel = Prisma.TransactionIsolationLevel.Serializable): Promise<T> {
    let lastError: unknown;
    const maxAttempts = 20;
    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
      try {
        return await this.prisma.$transaction(work, {
          isolationLevel,
          maxWait: 10_000,
          timeout: 30_000
        });
      } catch (error) {
        lastError = error;
        if (!isSerializationConflict(error) || attempt === maxAttempts - 1) throw error;
        const backoffMs = Math.min(750, 25 * (2 ** Math.min(attempt, 5)));
        await new Promise((resolve) => setTimeout(resolve, backoffMs + Math.floor(Math.random() * 75)));
      }
    }
    throw lastError;
  }

  list(projectId: string): Promise<BuildRunWithDetails[]> {
    return this.prisma.buildRun.findMany({
      where: { projectId },
      orderBy: { createdAt: 'desc' },
      include: buildRunInclude
    });
  }

  async get(projectId: string, buildRunId: string): Promise<BuildRunWithDetails> {
    const run = await this.prisma.buildRun.findFirst({
      where: { id: buildRunId, projectId },
      include: buildRunInclude
    });
    if (!run) throw new HttpError(404, 'Novel Build not found');
    return run;
  }

  async create(
    userId: string,
    projectId: string,
    input: CreateBuildRunInput,
    manifest: BuildManifest,
    scope: BuildAuthorizationScope
  ): Promise<BuildRunWithDetails> {
    const requestHash = createHash('sha256').update(JSON.stringify(input)).digest('hex');
    const existing = await this.prisma.buildRun.findUnique({
      where: { projectId_idempotencyKey: { projectId, idempotencyKey: input.idempotencyKey } },
      include: buildRunInclude
    });
    if (existing) {
      if (existing.requestHash && existing.requestHash !== requestHash) throw new HttpError(409, 'Build creation idempotency key was reused with different input');
      return existing;
    }
    const buildRunId = randomUUID();
    const autoAuthorized = input.autonomyMode === 'autonomous-draft'
      && input.authorizationScope !== undefined
      && input.maxTokens != null
      && input.maxCostMicros != null;
    const requiresManifestApproval = input.autonomyMode === 'plan-review'
      || (input.autonomyMode === 'autonomous-draft' && !autoAuthorized);
    try {
      await this.transaction(async (tx) => {
        await tx.buildRun.create({
          data: {
            id: buildRunId,
            projectId,
            createdById: userId,
            authorizedById: autoAuthorized ? userId : null,
            objective: input.objective ?? 'Build a complete, internally coherent novel from the supplied brainstorm.',
            brainstorm: input.brainstorm,
            idempotencyKey: input.idempotencyKey,
            requestHash,
            manifest: manifest as unknown as Prisma.InputJsonValue,
            autonomyMode: toPrismaAutonomyMode(input.autonomyMode ?? 'assist'),
            status: requiresManifestApproval ? 'PAUSED' : 'PLANNING',
            currentPhase: requiresManifestApproval ? 'manifest-review' : 'planning',
            workflowVersion: manifest.version,
            branchName: `ai/build-${buildRunId}`,
            authorizationScope: scope as unknown as Prisma.InputJsonValue,
            maxTokens: input.maxTokens ?? null,
            maxCostMicros: input.maxCostMicros ?? null,
            authorizedAt: autoAuthorized ? new Date() : null,
            pausedAt: requiresManifestApproval ? new Date() : null
          }
        });
        const target = manifest.target;
        const chapterCount = typeof target.targetChapterCount === 'number' ? target.targetChapterCount : 1;
        const sceneCount = typeof target.targetSceneCount === 'number' ? target.targetSceneCount : chapterCount;
        await this.ensureTaskTemplates(tx, buildRunId, [...createPlanningTaskTemplates(chapterCount, sceneCount), ...REVISION_TASK_TEMPLATES]);
      }, Prisma.TransactionIsolationLevel.RepeatableRead);
    } catch (error) {
      if (!isUniqueViolation(error)) throw error;
    }
    return this.get(projectId, buildRunId).catch(async (error) => {
      const replay = await this.prisma.buildRun.findUnique({
        where: { projectId_idempotencyKey: { projectId, idempotencyKey: input.idempotencyKey } },
        include: buildRunInclude
      });
      if (replay) {
        if (replay.requestHash && replay.requestHash !== requestHash) throw new HttpError(409, 'Build creation idempotency key was reused with different input');
        return replay;
      }
      throw error;
    });
  }

  async lockRun(tx: NovelBuildTx, projectId: string, buildRunId: string) {
    const rows = await tx.$queryRaw<Array<{ id: string }>>`
      SELECT id FROM "BuildRun"
      WHERE id = ${buildRunId} AND "projectId" = ${projectId}
      FOR UPDATE
    `;
    if (!rows.length) throw new HttpError(404, 'Novel Build not found');
    return tx.buildRun.findUniqueOrThrow({ where: { id: buildRunId } });
  }

  async getTask(tx: NovelBuildTx, buildRunId: string, taskId: string): Promise<BuildTask> {
    const task = await tx.buildTask.findFirst({ where: { id: taskId, buildRunId } });
    if (!task) throw new HttpError(404, 'Build task not found');
    return task;
  }

  async assertTaskLease(
    tx: NovelBuildTx,
    projectId: string,
    buildRunId: string,
    lease: TaskLeaseContext,
    now = new Date()
  ): Promise<{ run: Awaited<ReturnType<NovelBuildRepository['lockRun']>>; task: BuildTask }> {
    const run = await this.lockRun(tx, projectId, buildRunId);
    if (!['PLANNING', 'DRAFTING', 'REVISING'].includes(run.status)) {
      throw new HttpError(409, `Build is ${run.status.toLowerCase()}; worker mutation is fenced`);
    }
    if (!run.authorizedAt) throw new HttpError(403, 'Build has no active scope authorization');
    if (run.executionGeneration !== lease.runGeneration) throw new HttpError(409, 'Worker run generation is stale');
    const task = await this.getTask(tx, buildRunId, lease.taskId);
    if (
      task.status !== 'RUNNING'
      || task.leaseOwner !== lease.workerId
      || task.leaseToken !== lease.leaseToken
      || task.leaseGeneration !== lease.leaseGeneration
      || task.runGeneration !== lease.runGeneration
      || !task.leaseExpiresAt
      || task.leaseExpiresAt <= now
    ) {
      throw new HttpError(409, 'Worker task lease is stale or expired');
    }
    return { run, task };
  }

  async ensureTaskTemplates(
    tx: NovelBuildTx,
    buildRunId: string,
    templates: readonly TaskTemplate[]
  ): Promise<string[]> {
    const existing = await tx.buildTask.findMany({
      where: { buildRunId },
      select: { id: true, key: true }
    });
    const keyToId = new Map(existing.map((task) => [task.key, task.id]));
    const createdIds: string[] = [];
    for (const template of templates) {
      if (!keyToId.has(template.key)) {
        const id = randomUUID();
        keyToId.set(template.key, id);
        createdIds.push(id);
      }
    }
    const rows = templates
      .filter((template) => createdIds.includes(keyToId.get(template.key)!))
      .map((template) => {
        const dependencyIds = template.dependencyKeys.map((key) => {
          const id = keyToId.get(key);
          if (!id) throw new HttpError(409, `Task dependency '${key}' does not exist`);
          return id;
        });
        return {
          id: keyToId.get(template.key)!,
          buildRunId,
          key: template.key,
          type: template.type,
          phase: template.phase,
          status: (dependencyIds.length === 0 ? 'READY' : 'BLOCKED') as BuildTaskStatus,
          dependencyIds,
          assignedAgent: template.assignedAgent,
          skillVersions: template.skillVersions as Prisma.InputJsonValue,
          acceptanceCriteria: template.acceptanceCriteria as Prisma.InputJsonValue,
          executionPolicy: template.executionPolicy as Prisma.InputJsonValue,
          maxAttempts: template.maxAttempts,
          maxRevisionIterations: template.maxRevisionIterations,
          qualityThreshold: template.qualityThreshold,
          priority: template.priority
        };
      });
    if (rows.length) await tx.buildTask.createMany({ data: rows });
    return createdIds;
  }

  async transitionTask(
    tx: NovelBuildTx,
    task: BuildTask,
    input: TaskTransitionInput
  ): Promise<{ task: BuildTask; replay: boolean }> {
    const previous = await tx.buildTaskTransition.findUnique({
      where: { taskId_idempotencyKey: { taskId: task.id, idempotencyKey: input.idempotencyKey } }
    });
    if (previous) {
      const requestHash = input.requestHash ?? transitionRequestHash(task.id, input);
      if (previous.requestHash && previous.requestHash !== requestHash) {
        throw new HttpError(409, 'Task transition idempotency key was reused with a different request');
      }
      return { task: await tx.buildTask.findUniqueOrThrow({ where: { id: task.id } }), replay: true };
    }
    if (!LEGAL_TASK_TRANSITIONS[task.status].has(input.status)) {
      throw new HttpError(409, `Illegal BuildTask transition ${task.status} -> ${input.status}`);
    }
    const requestHash = input.requestHash ?? transitionRequestHash(task.id, input);
    const updated = await tx.buildTask.update({
      where: { id: task.id },
      data: {
        ...input.data,
        status: input.status,
        revision: { increment: 1 }
      }
    });
    await tx.buildTaskTransition.create({
      data: {
        buildRunId: task.buildRunId,
        taskId: task.id,
        fromStatus: task.status,
        toStatus: input.status,
        idempotencyKey: input.idempotencyKey,
        requestHash,
        reason: input.reason,
        metadata: input.metadata === undefined
          ? undefined
          : input.metadata === null
            ? Prisma.JsonNull
            : input.metadata as Prisma.InputJsonValue
      }
    });
    return { task: updated, replay: false };
  }

  async recoverStaleTasks(
    tx: NovelBuildTx,
    buildRunId: string,
    now = new Date()
  ): Promise<{ recoveredTaskIds: string[]; failedTaskIds: string[] }> {
    const stale = await tx.buildTask.findMany({
      where: { buildRunId, status: 'RUNNING', leaseExpiresAt: { lt: now } },
      orderBy: { createdAt: 'asc' }
    });
    const recoveredTaskIds: string[] = [];
    const failedTaskIds: string[] = [];
    let releasedTokens = 0;
    let releasedCostMicros = 0;
    for (const task of stale) {
      releasedTokens += task.reservedTokens;
      releasedCostMicros += task.reservedCostMicros;
      const exhausted = task.attempts >= task.maxAttempts;
      await this.transitionTask(tx, task, {
        status: exhausted ? 'FAILED' : 'READY',
        idempotencyKey: `recovery:${task.revision}:${task.leaseExpiresAt?.toISOString() ?? 'none'}`,
        reason: exhausted ? 'Lease expired and retry budget was exhausted' : 'Recovered after worker lease expired',
        data: {
          leaseOwner: null,
          leaseToken: null,
          leaseGeneration: { increment: 1 },
          leaseExpiresAt: null,
          heartbeatAt: null,
          reservedTokens: 0,
          reservedCostMicros: 0,
          failedAt: exhausted ? now : null,
          lastError: exhausted ? 'Worker lease expired' : task.lastError
        }
      });
      await tx.buildTrace.updateMany({
        where: { buildRunId, taskId: task.id, status: 'STARTED', completedAt: null },
        data: {
          status: 'FAILED',
          finishRequestHash: `recovery:${task.id}:${task.leaseGeneration}`,
          error: exhausted ? 'Worker lease expired and retry budget was exhausted.' : 'Worker lease expired; task was recovered for retry.',
          completionState: 'interrupted',
          completedAt: now
        }
      });
      (exhausted ? failedTaskIds : recoveredTaskIds).push(task.id);
    }
    if (releasedTokens || releasedCostMicros) {
      await tx.buildRun.update({
        where: { id: buildRunId },
        data: {
          tokensReserved: { decrement: releasedTokens },
          costMicrosReserved: { decrement: releasedCostMicros }
        }
      });
    }
    if (failedTaskIds.length) {
      await tx.buildRun.update({
        where: { id: buildRunId },
        data: { status: 'FAILED', failedAt: now, lastError: 'One or more tasks exhausted their recovery budget', revision: { increment: 1 } }
      });
    }
    return { recoveredTaskIds, failedTaskIds };
  }

  async refreshReadyTasks(tx: NovelBuildTx, buildRunId: string): Promise<string[]> {
    const tasks = await tx.buildTask.findMany({ where: { buildRunId }, orderBy: { createdAt: 'asc' } });
    const byId = new Map(tasks.map((task) => [task.id, task]));
    const chapterCheckpoints = tasks.filter((task) => task.key.startsWith('chapter:') && task.key.endsWith(':checkpoint'));
    const unblocked: string[] = [];
    for (const task of tasks) {
      if (task.status !== 'BLOCKED') continue;
      const dependenciesDone = task.dependencyIds.every((id) => byId.get(id)?.status === 'DONE');
      const barrierReady = task.type !== 'drafting-complete-barrier'
        || (chapterCheckpoints.length > 0 && chapterCheckpoints.every((chapterTask) => chapterTask.status === 'DONE'));
      if (!dependenciesDone || !barrierReady) continue;
      const dependencyOutputs = uniqueStrings(task.dependencyIds.flatMap((id) => byId.get(id)?.outputArtifactIds ?? []));
      if (dependencyOutputs.length) {
        const validOutputs = await tx.storyArtifact.count({
          where: { id: { in: dependencyOutputs }, buildRunId, invalidatedAt: null, status: { in: ['VALIDATED', 'ACCEPTED'] } }
        });
        if (validOutputs !== dependencyOutputs.length) {
          throw new HttpError(409, `Task '${task.key}' dependency outputs are missing, invalidated, or unvalidated`);
        }
      }
      await this.transitionTask(tx, task, {
        status: 'READY',
        idempotencyKey: `scheduler:${task.revision}:ready`,
        reason: 'All task dependencies completed',
        data: { inputArtifactIds: uniqueStrings([...task.inputArtifactIds, ...dependencyOutputs]) }
      });
      unblocked.push(task.id);
    }
    return unblocked;
  }

  async operationReplay<T extends JsonValue>(
    tx: NovelBuildTx,
    buildRunId: string,
    idempotencyKey: string,
    operation: string,
    requestHash: string
  ): Promise<T | null> {
    const receipt = await tx.buildOperationReceipt.findUnique({
      where: { buildRunId_idempotencyKey: { buildRunId, idempotencyKey } }
    });
    if (!receipt) return null;
    if (receipt.operation !== operation || receipt.requestHash !== requestHash) {
      throw new HttpError(409, 'Idempotency key was already used for a different operation');
    }
    return receipt.response as unknown as T;
  }

  async saveOperationReceipt(
    tx: NovelBuildTx,
    buildRunId: string,
    idempotencyKey: string,
    operation: string,
    requestHash: string,
    response: JsonValue
  ): Promise<void> {
    await tx.buildOperationReceipt.create({
      data: { buildRunId, idempotencyKey, operation, requestHash, response: response as Prisma.InputJsonValue }
    });
  }

  async createCheckpoint(
    tx: NovelBuildTx,
    input: {
      projectId: string;
      buildRunId: string;
      taskId?: string | null;
      userId?: string | null;
      idempotencyKey: string;
      requestHash: string;
      label: string;
      phase: string;
      stateSnapshot: JsonValue;
      contentHash: string;
    }
  ) {
    const existing = await tx.buildCheckpoint.findUnique({
      where: { buildRunId_idempotencyKey: { buildRunId: input.buildRunId, idempotencyKey: input.idempotencyKey } }
    });
    if (existing) {
      if (existing.requestHash && existing.requestHash !== input.requestHash) throw new HttpError(409, 'Checkpoint idempotency key was reused with different input');
      return existing;
    }
    const last = await tx.buildCheckpoint.findFirst({
      where: { buildRunId: input.buildRunId },
      orderBy: { sequence: 'desc' },
      select: { sequence: true }
    });
    return tx.buildCheckpoint.create({
      data: {
        projectId: input.projectId,
        buildRunId: input.buildRunId,
        taskId: input.taskId ?? null,
        createdById: input.userId ?? null,
        idempotencyKey: input.idempotencyKey,
        requestHash: input.requestHash,
        sequence: (last?.sequence ?? 0) + 1,
        label: input.label,
        phase: input.phase,
        stateSnapshot: input.stateSnapshot as Prisma.InputJsonValue,
        contentHash: input.contentHash
      }
    });
  }

  async updateRunPhaseAndCompletion(tx: NovelBuildTx, buildRunId: string): Promise<void> {
    const [run, tasks] = await Promise.all([
      tx.buildRun.findUniqueOrThrow({ where: { id: buildRunId }, select: { status: true } }),
      tx.buildTask.findMany({ where: { buildRunId }, select: { status: true, phase: true, key: true } })
    ]);
    if (tasks.some((task) => task.status === 'FAILED')) return;
    const unfinished = tasks.filter((task) => !['DONE', 'CANCELLED'].includes(task.status));
    let status: BuildRunStatus = 'PLANNING';
    let currentPhase = 'planning';
    if (tasks.some((task) => task.phase === 'drafting' && task.status !== 'BLOCKED')) {
      status = 'DRAFTING';
      currentPhase = 'drafting';
    }
    if (tasks.some((task) => task.phase === 'revising' && task.status !== 'BLOCKED')) {
      status = 'REVISING';
      currentPhase = 'revising';
    }
    if (!unfinished.length && tasks.length) {
      status = 'COMPLETED';
      currentPhase = 'completed';
    }
    assertLegalBuildRunTransition(run.status, status);
    await tx.buildRun.update({
      where: { id: buildRunId },
      data: {
        status,
        currentPhase,
        completedAt: status === 'COMPLETED' ? new Date() : null,
        revision: { increment: 1 }
      }
    });
  }
}

const LEGAL_RUN_TRANSITIONS: Record<BuildRunStatus, ReadonlySet<BuildRunStatus>> = {
  PLANNING: new Set(['PLANNING', 'DRAFTING', 'REVISING', 'PAUSED', 'COMPLETED', 'FAILED', 'CANCELLED']),
  DRAFTING: new Set(['DRAFTING', 'REVISING', 'PLANNING', 'PAUSED', 'COMPLETED', 'FAILED', 'CANCELLED']),
  REVISING: new Set(['REVISING', 'DRAFTING', 'PLANNING', 'PAUSED', 'COMPLETED', 'FAILED', 'CANCELLED']),
  PAUSED: new Set(['PAUSED', 'PLANNING', 'DRAFTING', 'REVISING', 'CANCELLED']),
  COMPLETED: new Set(['COMPLETED']),
  FAILED: new Set(['FAILED', 'PLANNING', 'DRAFTING', 'REVISING', 'CANCELLED']),
  CANCELLED: new Set(['CANCELLED'])
};

export function assertLegalBuildRunTransition(from: BuildRunStatus, to: BuildRunStatus): void {
  if (!LEGAL_RUN_TRANSITIONS[from].has(to)) throw new HttpError(409, `Illegal BuildRun transition ${from} -> ${to}`);
}

function isUniqueViolation(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
}

const LEGAL_TASK_TRANSITIONS: Record<BuildTaskStatus, ReadonlySet<BuildTaskStatus>> = {
  BLOCKED: new Set(['BLOCKED', 'READY', 'DONE', 'CANCELLED']),
  READY: new Set(['READY', 'RUNNING', 'BLOCKED', 'CANCELLED']),
  RUNNING: new Set(['RUNNING', 'READY', 'REVIEW', 'DONE', 'FAILED', 'CANCELLED']),
  REVIEW: new Set(['REVIEW', 'RUNNING', 'READY', 'DONE', 'FAILED', 'CANCELLED']),
  DONE: new Set(['DONE', 'READY', 'BLOCKED', 'CANCELLED']),
  FAILED: new Set(['FAILED', 'READY', 'BLOCKED', 'CANCELLED']),
  CANCELLED: new Set(['CANCELLED'])
};

function transitionRequestHash(taskId: string, input: TaskTransitionInput): string {
  return createHash('sha256').update(JSON.stringify({
    taskId,
    status: input.status,
    reason: input.reason ?? null,
    metadata: input.metadata ?? null
  })).digest('hex');
}

function isSerializationConflict(error: unknown): boolean {
  if (error instanceof HttpError) return false;
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    if (error.code === 'P2034') return true;
    if (error.code === 'P2010' && typeof error.meta?.code === 'string' && ['40001', '40P01'].includes(error.meta.code)) return true;
  }
  const message = error instanceof Error ? error.message : String(error);
  return /\b40001\b|\b40P01\b|could not serialize access|serialization failure|deadlock detected/i.test(message);
}

export function sdkTaskStatus(status: BuildTaskStatus): SdkBuildTaskStatus {
  return status.toLowerCase() as SdkBuildTaskStatus;
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values)];
}
