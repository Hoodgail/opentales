import { Prisma, type BuildTask, type PrismaClient, type StoryArtifactType as PrismaStoryArtifactType } from '@prisma/client';
import type {
  AppendBuildEvaluationInput,
  AppendBuildTraceInput,
  ApplyStoryArtifactBatchInput,
  ApplyStoryArtifactBatchResult,
  ApplyStoryStateBatchInput,
  ApplyStoryStateBatchResult,
  BuildEvaluationResult,
  BuildObservability,
  BuildTrace,
  BuildTaskLeaseInput,
  CanonFact,
  EntityState,
  FindStoryReferencesInput,
  FindStoryReferencesResult,
  GetBuildObservabilityInput,
  JsonObject,
  JsonValue,
  ListStoryArtifactsInput,
  OpenLoop,
  PaginatedStoryArtifacts,
  PlotThread,
  SearchStoryInput,
  SetupPayoffLink,
  StoryArtifact,
  StoryArtifactBatchOperation,
  StoryArtifactLink,
  StoryArtifactType,
  StoryDiagnostic,
  StoryDiagnosticsResult,
  StoryReference,
  StorySearchResult,
  StorySourceSpan,
  StoryStateBatchOperation,
  StoryStateEntityKind,
  StoryStateSnapshot,
  StoryStateDelta,
  StoryStateHistoryResult,
  TemporalStoryStateQuery,
  TemporalStoryStateResult,
  StartBuildTraceInput,
  FinishBuildTraceInput,
  TimelineEvent
} from '@opentales/sdk';
import { HttpError } from '../../http/HttpError.js';
import { NovelBuildRepository, type NovelBuildTx } from '../../repositories/NovelBuildRepository.js';
import { ProjectAccessRepository } from '../../repositories/ProjectAccessRepository.js';
import { StoryStateRepository } from '../../repositories/StoryStateRepository.js';
import {
  toBuildEvaluation,
  toBuildTrace,
  toPrismaArtifactStatus,
  toPrismaArtifactType,
  toPrismaCanonStatus,
  toPrismaEntityStateStatus,
  toPrismaEvaluationKind,
  toPrismaOpenLoopKind,
  toPrismaOpenLoopStatus,
  toPrismaPlotThreadKind,
  toPrismaPlotThreadStatus,
  toPrismaSetupPayoffStatus,
  toPrismaTraceStatus,
  toStoryArtifact,
  toStoryArtifactLink
} from './novelBuildMapper.js';
import {
  ARTIFACT_TYPES,
  STORY_SCHEMA_VERSION,
  assertJsonValue,
  authorizationScopeSchema,
  stableHash,
  stableStringify,
  validateArtifactContent
} from './schemas.js';
import { NovelBuildUseCase } from './NovelBuildUseCase.js';
import { abortBuildRunExecutions } from '../ai/workflow/BuildExecutionRegistry.js';
import { getProjectInclude, toManuscriptProject } from '../projects/projectMapper.js';
import { createStoryDiagnosticsResult } from './diagnostics/index.js';
import type { DiagnosticChapterSnapshot, DiagnosticSceneSnapshot, StoryDiagnosticsInput } from './diagnostics/types.js';

export class StoryStateUseCase {
  readonly repository: StoryStateRepository;
  private readonly builds: NovelBuildRepository;
  private readonly buildUseCase: NovelBuildUseCase;
  private readonly access: ProjectAccessRepository;

  constructor(private readonly prisma: PrismaClient) {
    this.repository = new StoryStateRepository(prisma);
    this.builds = new NovelBuildRepository(prisma);
    this.buildUseCase = new NovelBuildUseCase(prisma);
    this.access = new ProjectAccessRepository(prisma);
  }

  async listArtifacts(
    userId: string,
    projectId: string,
    buildRunId: string,
    input: ListStoryArtifactsInput = {}
  ): Promise<PaginatedStoryArtifacts> {
    await this.assertBuildAccess(userId, projectId, buildRunId);
    return this.repository.listArtifacts(projectId, buildRunId, input);
  }

  async applyArtifactBatch(
    userId: string,
    projectId: string,
    buildRunId: string,
    input: ApplyStoryArtifactBatchInput,
    options: { allowTaskBinding?: boolean; lease?: BuildTaskLeaseInput } = { allowTaskBinding: true }
  ): Promise<ApplyStoryArtifactBatchResult> {
    await this.access.assertPermission(userId, projectId, 'project:write');
    if (!Array.isArray(input.operations) || input.operations.length < 1 || input.operations.length > 1_000) throw new HttpError(400, 'Artifact batch must contain between 1 and 1,000 operations');
    const requestHash = stableHash(input);
    const outcome = await this.builds.transaction(async (tx) => {
      const fenced = options.lease ? await this.builds.assertTaskLease(tx, projectId, buildRunId, options.lease) : null;
      const run = fenced?.run ?? await this.builds.lockRun(tx, projectId, buildRunId);
      const replay = await this.builds.operationReplay<JsonObject>(tx, buildRunId, input.idempotencyKey, 'artifact-batch', requestHash);
      if (replay) {
        return {
          artifactIds: stringArray(replay.artifactIds),
          linkIds: stringArray(replay.linkIds),
          createdChapterTaskIds: stringArray(replay.createdChapterTaskIds),
          buildRevision: typeof replay.buildRevision === 'number' ? replay.buildRevision : run.revision
        };
      }
      assertRevision(run.revision, input.expectedBuildRevision);
      if (['COMPLETED', 'CANCELLED'].includes(run.status)) throw new HttpError(409, 'Re-plan the build before editing terminal build artifacts');
      const scope = fenced ? authorizationScopeSchema.parse(run.authorizationScope) : null;
      if (scope) assertScopeCurrent(scope.expiresAt);
      const allowedTypes = fenced ? this.allowedTaskArtifactTypes(fenced.task, scope!.artifactTypes) : ARTIFACT_TYPES;
      const artifactIds: string[] = [];
      const linkIds: string[] = [];
      const replacementMap = new Map<string, string>();
      for (const operation of input.operations) {
        await this.applyArtifactOperation(
          tx, projectId, buildRunId, allowedTypes, operation, artifactIds, linkIds, replacementMap,
          options.allowTaskBinding !== false,
          fenced?.task ? {
            id: fenced.task.id,
            type: fenced.task.type,
            scopeUnitIds: fenced.task.scopeUnitIds,
            inputArtifactIds: fenced.task.inputArtifactIds,
            outputArtifactIds: fenced.task.outputArtifactIds,
            executionPolicy: fenced.task.executionPolicy
          } : null
        );
      }
      await this.validateArtifactCrossLinks(tx, projectId, buildRunId);
      const createdChapterTaskIds = await this.buildUseCase.materializeChapterGraphsInTransaction(tx, buildRunId);
      await this.rewireArtifactConsumers(tx, buildRunId, replacementMap);
      await this.builds.refreshReadyTasks(tx, buildRunId);
      const updated = await tx.buildRun.update({ where: { id: buildRunId }, data: { revision: { increment: 1 } }, select: { revision: true } });
      const response: JsonObject = { artifactIds: unique(artifactIds), linkIds: unique(linkIds), createdChapterTaskIds, buildRevision: updated.revision };
      await this.builds.saveOperationReceipt(tx, buildRunId, input.idempotencyKey, 'artifact-batch', requestHash, response);
      return { artifactIds: unique(artifactIds), linkIds: unique(linkIds), createdChapterTaskIds, buildRevision: updated.revision };
    }, Prisma.TransactionIsolationLevel.ReadCommitted);
    const [artifacts, links] = await Promise.all([
      this.prisma.storyArtifact.findMany({ where: { id: { in: outcome.artifactIds }, projectId, buildRunId } }),
      this.prisma.storyArtifactLink.findMany({ where: { id: { in: outcome.linkIds }, projectId, buildRunId } })
    ]);
    return {
      buildRevision: outcome.buildRevision,
      artifacts: artifacts.map(toStoryArtifact),
      links: links.map(toStoryArtifactLink),
      createdChapterTaskIds: outcome.createdChapterTaskIds
    };
  }

  async getState(userId: string, projectId: string, buildRunId: string): Promise<StoryStateSnapshot> {
    await this.assertBuildAccess(userId, projectId, buildRunId);
    return this.repository.snapshot(projectId, buildRunId);
  }

  async getStateDelta(
    userId: string,
    projectId: string,
    buildRunId: string,
    input: { sinceUpdatedAt?: string; limit?: number; offset?: number }
  ): Promise<StoryStateDelta> {
    await this.assertBuildAccess(userId, projectId, buildRunId);
    return this.repository.delta(projectId, buildRunId, input);
  }

  async getStateHistory(
    userId: string,
    projectId: string,
    buildRunId: string,
    entityKind: StoryStateEntityKind,
    key: string
  ): Promise<StoryStateHistoryResult> {
    await this.assertBuildAccess(userId, projectId, buildRunId);
    return this.repository.history(projectId, buildRunId, entityKind, key);
  }

  async temporalState(
    userId: string,
    projectId: string,
    buildRunId: string,
    input: TemporalStoryStateQuery
  ): Promise<TemporalStoryStateResult> {
    await this.assertBuildAccess(userId, projectId, buildRunId);
    return this.repository.temporal(projectId, buildRunId, input);
  }

  async applyStateBatch(
    userId: string,
    projectId: string,
    buildRunId: string,
    input: ApplyStoryStateBatchInput,
    options: { lease?: BuildTaskLeaseInput } = {}
  ): Promise<ApplyStoryStateBatchResult> {
    await this.access.assertPermission(userId, projectId, 'project:write');
    if (!Array.isArray(input.operations) || input.operations.length < 1 || input.operations.length > 1_000) throw new HttpError(400, 'Story-state batch must contain between 1 and 1,000 operations');
    const requestHash = stableHash(input);
    const buildRevision = await this.builds.transaction(async (tx) => {
      const fenced = options.lease ? await this.builds.assertTaskLease(tx, projectId, buildRunId, options.lease) : null;
      const run = fenced?.run ?? await this.builds.lockRun(tx, projectId, buildRunId);
      const replay = await this.builds.operationReplay<JsonObject>(tx, buildRunId, input.idempotencyKey, 'story-state-batch', requestHash);
      if (replay) return typeof replay.buildRevision === 'number' ? replay.buildRevision : run.revision;
      assertRevision(run.revision, input.expectedBuildRevision);
      if (['COMPLETED', 'CANCELLED'].includes(run.status)) throw new HttpError(409, 'Re-plan the build before editing terminal story state');
      if (fenced) {
        const scope = authorizationScopeSchema.parse(run.authorizationScope);
        assertScopeCurrent(scope.expiresAt);
        if (!scope.allowCanonWrites) throw new HttpError(403, 'Build scope does not authorize story-state or canon writes');
      }
      const allowedUnitIds = fenced?.task.scopeUnitIds ?? [];
      for (const operation of input.operations) {
        await this.applyStateOperation(tx, projectId, buildRunId, operation, {
          sourceTaskId: fenced?.task.id ?? null,
          allowedUnitIds
        });
      }
      await this.validateStateCrossLinks(tx, projectId, buildRunId);
      const updated = await tx.buildRun.update({ where: { id: buildRunId }, data: { revision: { increment: 1 } }, select: { revision: true } });
      await this.builds.saveOperationReceipt(tx, buildRunId, input.idempotencyKey, 'story-state-batch', requestHash, { buildRevision: updated.revision });
      return updated.revision;
    }, Prisma.TransactionIsolationLevel.ReadCommitted);
    return { ...(await this.repository.snapshot(projectId, buildRunId)), buildRevision };
  }

  async startTrace(
    userId: string,
    projectId: string,
    buildRunId: string,
    lease: BuildTaskLeaseInput,
    input: StartBuildTraceInput
  ): Promise<BuildTrace> {
    await this.access.assertPermission(userId, projectId, 'project:write');
    if (input.taskId !== lease.taskId) throw new HttpError(400, 'Trace taskId must match the fenced lease');
    const requestHash = stableHash(input);
    const trace = await this.builds.transaction(async (tx) => {
      const { run, task } = await this.builds.assertTaskLease(tx, projectId, buildRunId, lease);
      const existing = await tx.buildTrace.findUnique({ where: { buildRunId_idempotencyKey: { buildRunId, idempotencyKey: required(input.idempotencyKey, 'Idempotency key', 500) } } });
      if (existing) {
        if (existing.requestHash && existing.requestHash !== requestHash) throw new HttpError(409, 'Trace idempotency key was reused with different start input');
        return existing;
      }
      return tx.buildTrace.create({ data: {
        projectId, buildRunId, taskId: task.id, idempotencyKey: input.idempotencyKey, requestHash,
        attempt: int(input.attempt, 0, 100_000, 'attempt'), status: 'STARTED',
        provider: cleanNullable(input.provider, 500), model: cleanNullable(input.model, 500),
        modelParameters: jsonNullable(input.modelParameters), workflowVersion: required(input.workflowVersion || run.workflowVersion, 'workflowVersion', 500),
        systemPromptVersion: cleanNullable(input.systemPromptVersion, 500), skillVersions: json(input.skillVersions),
        toolSchemaVersions: json(input.toolSchemaVersions), inputs: json(input.inputs),
        retrievedArtifactIds: unique(input.retrievedArtifactIds ?? []), contextTokenCount: optionalInt(input.contextTokenCount, 0, 2_000_000_000, 'contextTokenCount'),
        toolCalls: [], toolResults: [], outputs: {}, validatorResults: {}, retries: 0,
        startedAt: input.startedAt ? date(input.startedAt, 'startedAt') : new Date()
      } });
    });
    return toBuildTrace(trace);
  }

  async finishTrace(
    userId: string,
    projectId: string,
    buildRunId: string,
    traceId: string,
    input: FinishBuildTraceInput
  ): Promise<BuildTrace> {
    await this.access.assertPermission(userId, projectId, 'project:write');
    const finishHash = stableHash(input);
    const outcome = await this.builds.transaction(async (tx) => {
      const trace = await tx.buildTrace.findFirst({ where: { id: traceId, projectId, buildRunId } });
      if (!trace) throw new HttpError(404, 'Build trace not found');
      if (trace.finishRequestHash) {
        if (trace.finishRequestHash !== finishHash) throw new HttpError(409, 'Trace finish request was replayed with different input');
        return { trace, overrun: false };
      }
      const { run, task } = await this.builds.assertTaskLease(tx, projectId, buildRunId, input.lease);
      if (trace.taskId !== task.id || trace.status !== 'STARTED') throw new HttpError(409, 'Trace is not the active STARTED trace for this task lease');
      const inputTokens = int(input.inputTokens, 0, 2_000_000_000, 'inputTokens');
      const outputTokens = int(input.outputTokens, 0, 2_000_000_000, 'outputTokens');
      const costMicros = int(input.costMicros, 0, 2_000_000_000, 'costMicros');
      const tokenDelta = inputTokens + outputTokens;
      const overrun = (run.maxTokens !== null && run.tokensUsed + tokenDelta > run.maxTokens)
        || (run.maxCostMicros !== null && run.costMicrosUsed + costMicros > run.maxCostMicros);
      const updated = await tx.buildTrace.update({ where: { id: trace.id }, data: {
        finishRequestHash: finishHash,
        status: toPrismaTraceStatus(input.status), provider: input.provider === undefined ? undefined : cleanNullable(input.provider, 500),
        model: input.model === undefined ? undefined : cleanNullable(input.model, 500),
        modelParameters: input.modelParameters === undefined ? undefined : jsonNullable(input.modelParameters),
        toolCalls: json(input.toolCalls), toolResults: json(input.toolResults),
        outputs: json(input.outputs), validatorResults: json(input.validatorResults), inputTokens, outputTokens, costMicros,
        latencyMs: optionalInt(input.latencyMs, 0, 2_000_000_000, 'latencyMs'), retries: input.retries === undefined ? 0 : int(input.retries, 0, 100_000, 'retries'),
        completionState: cleanNullable(input.completionState, 500), error: cleanNullable(input.error, 50_000),
        completedAt: input.completedAt ? date(input.completedAt, 'completedAt') : new Date()
      } });
      if (overrun) await this.buildUseCase.compensateTaskAttemptInTransaction(tx, buildRunId, task.id, trace.startedAt);
      await tx.buildRun.update({ where: { id: buildRunId }, data: {
        tokensUsed: { increment: tokenDelta }, costMicrosUsed: { increment: costMicros },
        tokensReserved: { decrement: task.reservedTokens }, costMicrosReserved: { decrement: task.reservedCostMicros },
        ...(overrun ? {
          status: 'PAUSED' as const,
          pausedAt: new Date(),
          lastError: 'Novel Build budget exceeded; actual provider usage was persisted and execution was fenced.',
          executionGeneration: { increment: 1 }
        } : {}),
        revision: { increment: 1 }
      } });
      await tx.buildTask.update({ where: { id: task.id }, data: {
        reservedTokens: 0, reservedCostMicros: 0,
        ...(overrun ? {
          status: 'FAILED' as const, failedAt: new Date(), lastError: 'Provider usage exceeded the authorized budget.',
          leaseOwner: null, leaseToken: null, leaseGeneration: { increment: 1 }, leaseExpiresAt: null, heartbeatAt: null
        } : {})
      } });
      return { trace: updated, overrun };
    });
    // The caller is itself the registered execution. Abort immediately after the
    // durable fence commits, but do not wait on its own settled promise.
    if (outcome.overrun) await abortBuildRunExecutions(buildRunId, 'Novel Build budget exceeded', 0);
    return toBuildTrace(outcome.trace);
  }

  async appendTrace(
    userId: string,
    projectId: string,
    buildRunId: string,
    input: AppendBuildTraceInput
  ): Promise<BuildTrace> {
    await this.access.assertPermission(userId, projectId, 'project:write');
    if (input.taskId) throw new HttpError(403, 'Task-bound traces must use the fenced startTrace/finishTrace lifecycle');
    const outcome = await this.builds.transaction(async (tx) => {
      const run = await this.builds.lockRun(tx, projectId, buildRunId);
      const existing = await tx.buildTrace.findUnique({ where: { buildRunId_idempotencyKey: { buildRunId, idempotencyKey: required(input.idempotencyKey, 'Idempotency key', 500) } } });
      const requestHash = stableHash(input);
      if (existing) {
        if (existing.requestHash && existing.requestHash !== requestHash) throw new HttpError(409, 'Trace idempotency key was reused with different input');
        return { trace: existing, overrun: false };
      }
      const task = null;
      for (const value of [input.modelParameters, input.skillVersions, input.toolSchemaVersions, input.inputs, input.toolCalls, input.toolResults, input.outputs, input.validatorResults]) {
        if (value !== null) assertJson(value);
      }
      const inputTokens = optionalInt(input.inputTokens, 0, 2_000_000_000, 'inputTokens');
      const outputTokens = optionalInt(input.outputTokens, 0, 2_000_000_000, 'outputTokens');
      const costMicros = optionalInt(input.costMicros, 0, 2_000_000_000, 'costMicros');
      const tokenDelta = (inputTokens ?? 0) + (outputTokens ?? 0);
      const overrun = (run.maxTokens !== null && run.tokensUsed + tokenDelta > run.maxTokens)
        || (run.maxCostMicros !== null && run.costMicrosUsed + (costMicros ?? 0) > run.maxCostMicros);
      const created = await tx.buildTrace.create({
        data: {
          projectId, buildRunId, taskId: input.taskId, idempotencyKey: input.idempotencyKey, requestHash,
          attempt: int(input.attempt, 0, 100_000, 'attempt'), status: toPrismaTraceStatus(input.status),
          provider: cleanNullable(input.provider, 500), model: cleanNullable(input.model, 500),
          modelParameters: jsonNullable(input.modelParameters), workflowVersion: required(input.workflowVersion, 'workflowVersion', 500),
          systemPromptVersion: cleanNullable(input.systemPromptVersion, 500),
          skillVersions: json(input.skillVersions), toolSchemaVersions: json(input.toolSchemaVersions), inputs: json(input.inputs),
          retrievedArtifactIds: unique(input.retrievedArtifactIds ?? []), contextTokenCount: optionalInt(input.contextTokenCount, 0, 2_000_000_000, 'contextTokenCount'),
          toolCalls: json(input.toolCalls), toolResults: json(input.toolResults), outputs: json(input.outputs), validatorResults: json(input.validatorResults),
          inputTokens, outputTokens, costMicros, latencyMs: optionalInt(input.latencyMs, 0, 2_000_000_000, 'latencyMs'),
          retries: int(input.retries, 0, 100_000, 'retries'), completionState: cleanNullable(input.completionState, 500), error: cleanNullable(input.error, 50_000),
          startedAt: date(input.startedAt, 'startedAt'), completedAt: input.completedAt ? date(input.completedAt, 'completedAt') : null
        }
      });
      await tx.buildRun.update({ where: { id: buildRunId }, data: {
        tokensUsed: { increment: tokenDelta }, costMicrosUsed: { increment: costMicros ?? 0 },
        ...(overrun ? { status: 'PAUSED' as const, pausedAt: new Date(), lastError: 'Novel Build budget exceeded; actual usage persisted.', executionGeneration: { increment: 1 } } : {}),
        revision: { increment: 1 }
      } });
      return { trace: created, overrun };
    });
    if (outcome.overrun) await abortBuildRunExecutions(buildRunId, 'Novel Build budget exceeded', 5_000);
    return toBuildTrace(outcome.trace);
  }

  async appendEvaluation(
    userId: string,
    projectId: string,
    buildRunId: string,
    input: AppendBuildEvaluationInput,
    options: { lease: BuildTaskLeaseInput }
  ): Promise<BuildEvaluationResult> {
    await this.access.assertPermission(userId, projectId, 'project:write');
    const evaluation = await this.builds.transaction(async (tx) => {
      const { task } = await this.builds.assertTaskLease(tx, projectId, buildRunId, options.lease);
      const key = required(input.idempotencyKey, 'Idempotency key', 500);
      const existing = await tx.buildEvaluationResult.findUnique({ where: { buildRunId_idempotencyKey: { buildRunId, idempotencyKey: key } } });
      const requestHash = stableHash(input);
      if (existing) {
        if (existing.requestHash && existing.requestHash !== requestHash) throw new HttpError(409, 'Evaluation idempotency key was reused with different input');
        return existing;
      }
      if (input.taskId !== task.id) throw new HttpError(403, 'Evaluation taskId must match the fenced lease');
      if (input.artifactId) {
        const artifact = await tx.storyArtifact.findFirst({ where: { id: input.artifactId, projectId, buildRunId } });
        if (!artifact) throw new HttpError(400, 'Evaluation artifact does not belong to this build');
      }
      [input.scores, input.checks, input.evidence].forEach((value) => { if (value !== null) assertJson(value); });
      const created = await tx.buildEvaluationResult.create({
        data: {
          projectId, buildRunId, taskId: input.taskId, artifactId: input.artifactId, idempotencyKey: key, requestHash,
          kind: toPrismaEvaluationKind(input.kind), rubric: required(input.rubric, 'Rubric', 500), rubricVersion: required(input.rubricVersion, 'Rubric version', 500),
          scores: json(input.scores), checks: json(input.checks), passed: input.passed === true,
          threshold: input.threshold === null ? null : optionalNumber(input.threshold, 0, 1, 'threshold'),
          feedback: cleanNullable(input.feedback, 100_000), evidence: jsonNullable(input.evidence)
        }
      });
      await tx.buildRun.update({ where: { id: buildRunId }, data: { revision: { increment: 1 } } });
      return created;
    });
    return toBuildEvaluation(evaluation);
  }

  async observability(
    userId: string,
    projectId: string,
    buildRunId: string,
    input: GetBuildObservabilityInput = {}
  ): Promise<BuildObservability> {
    await this.assertBuildAccess(userId, projectId, buildRunId);
    if (input.taskId) {
      const task = await this.prisma.buildTask.findFirst({ where: { id: input.taskId, buildRunId } });
      if (!task) throw new HttpError(404, 'Build task not found');
    }
    return this.repository.observability(projectId, buildRunId, input);
  }

  async search(
    userId: string,
    projectId: string,
    buildRunId: string,
    rawInput: SearchStoryInput
  ): Promise<StorySearchResult> {
    await this.assertBuildAccess(userId, projectId, buildRunId);
    if (typeof rawInput.query !== 'string' || rawInput.query.length > 500) throw new HttpError(400, 'Search query must be a string no larger than 500 characters');
    const filters = validateSearchFilters(rawInput.filters);
    let query = rawInput.query.trim();
    const syntax = parseSearchSyntax(query);
    query = syntax.query;
    for (const [key, values] of Object.entries(syntax.filters)) filters[key] = [...new Set([...(filters[key] ?? []), ...values])];
    if (!query && Object.keys(filters).length === 0) throw new HttpError(400, 'Search query or structured filters are required');
    const requestedStrategy = rawInput.strategy ?? 'hybrid';
    const warnings: string[] = [];
    const strategy = !query ? 'exact' : requestedStrategy === 'semantic' ? 'hybrid' : requestedStrategy;
    if (requestedStrategy === 'semantic') warnings.push(
      query
        ? 'Semantic retrieval is unavailable because no embedding index is configured; exact and full-text hybrid search was used.'
        : 'Semantic retrieval is unavailable because no embedding index is configured; structured exact filters were used.'
    );
    if (strategy === 'regex') validateRegex(query);
    const limit = rawInput.limit === undefined ? 50 : int(rawInput.limit, 1, 100, 'limit');
    if (rawInput.cursor !== undefined && rawInput.offset !== undefined) throw new HttpError(400, 'Use cursor or offset pagination, not both');
    const offset = rawInput.cursor === undefined ? (rawInput.offset === undefined ? 0 : int(rawInput.offset, 0, 1_000_000, 'offset')) : decodeSearchCursor(rawInput.cursor);
    const { hits, total } = await this.repository.search(projectId, buildRunId, { ...rawInput, query, filters, strategy, limit, offset });
    const nextOffset = offset + hits.length < total ? offset + hits.length : null;
    return { query, strategyUsed: strategy, warnings, hits, total, limit, offset, nextOffset, nextCursor: nextOffset === null ? null : encodeSearchCursor(nextOffset) };
  }

  async findReferences(
    userId: string,
    projectId: string,
    buildRunId: string,
    rawInput: FindStoryReferencesInput
  ): Promise<FindStoryReferencesResult> {
    await this.assertBuildAccess(userId, projectId, buildRunId);
    const refType = required(rawInput.refType, 'Reference type', 100);
    const refId = required(rawInput.refId, 'Reference id', 500);
    const limit = rawInput.limit === undefined ? 50 : int(rawInput.limit, 1, 100, 'limit');
    const offset = rawInput.offset === undefined ? 0 : int(rawInput.offset, 0, 10_000, 'offset');
    const { hits, total } = await this.repository.findReferences(projectId, buildRunId, { refType, refId, limit, offset });
    return { ref: { type: refType, id: refId }, hits, total, limit, offset, nextOffset: offset + hits.length < total ? offset + hits.length : null };
  }

  async diagnostics(userId: string, projectId: string, buildRunId: string): Promise<StoryDiagnosticsResult> {
    await this.assertBuildAccess(userId, projectId, buildRunId);
    const [state, artifacts, tasks, project, run, units] = await Promise.all([
      this.repository.snapshot(projectId, buildRunId),
      this.prisma.storyArtifact.findMany({ where: { projectId, buildRunId, invalidatedAt: null, status: { in: ['DRAFT', 'VALIDATED', 'ACCEPTED'] } } }),
      this.prisma.buildTask.findMany({ where: { buildRunId } }),
      this.prisma.project.findUniqueOrThrow({ where: { id: projectId }, include: getProjectInclude() }),
      this.prisma.buildRun.findUniqueOrThrow({ where: { id: buildRunId } }),
      this.prisma.buildManuscriptUnit.findMany({
        where: { projectId, buildRunId, invalidatedAt: null },
        orderBy: [{ kind: 'asc' }, { containerKey: 'asc' }, { order: 'asc' }],
        include: { branch: { include: { headVersion: true } } }
      })
    ]);
    const manuscript = toManuscriptProject(project);
    const sdkArtifacts = artifacts.map(toStoryArtifact);
    const chapters = units.some((unit) => unit.kind === 'CHAPTER')
      ? this.diagnosticChaptersFromUnits(units)
      : manuscript.chapters as DiagnosticChapterSnapshot[];
    const manifest = run.manifest as JsonObject;
    const target = isObject(manifest.target) ? manifest.target : {};
    const engineInput: StoryDiagnosticsInput = {
      ...state,
      buildRevision: run.revision,
      chapters,
      characters: manuscript.characters,
      locations: manuscript.locations,
      artifacts: sdkArtifacts,
      metadata: {
        planningMode: target.planningMode === 'pantser' || target.planningMode === 'planner' ? target.planningMode : 'hybrid',
        manuscriptComplete: run.status === 'COMPLETED' || run.currentPhase === 'completed' || run.currentPhase === 'finalizing',
        phase: run.status === 'PLANNING' ? 'planning' : run.status === 'DRAFTING' ? 'drafting' : run.status === 'REVISING' ? 'revising' : run.status === 'COMPLETED' ? 'completed' : 'drafting',
        branchName: run.branchName,
        generatedAt: new Date().toISOString()
      }
    };
    const engine = createStoryDiagnosticsResult(engineInput);
    const workflow = this.computeDiagnostics(state, sdkArtifacts, tasks);
    const diagnostics = [...new Map([...engine.diagnostics, ...workflow].map((item) => [item.id, item])).values()]
      .sort((a, b) => severityRank(b.severity) - severityRank(a.severity) || a.code.localeCompare(b.code));
    return { ...engine, diagnostics };
  }

  private diagnosticChaptersFromUnits(
    units: Array<Prisma.BuildManuscriptUnitGetPayload<{ include: { branch: { include: { headVersion: true } } } }>>
  ): DiagnosticChapterSnapshot[] {
    const chapters = units.filter((unit) => unit.kind === 'CHAPTER').sort((a, b) => (a.chapterNumber ?? a.order) - (b.chapterNumber ?? b.order));
    return chapters.map((chapter) => {
      const chapterBody = chapter.branch.headVersion?.body ?? '';
      const scenes: DiagnosticSceneSnapshot[] = units.filter((unit) => unit.kind === 'SCENE' && unit.parentUnitId === chapter.id)
        .sort((a, b) => a.order - b.order)
        .map((scene) => {
          const metadata = scene.metadata as JsonObject;
          const body = scene.branch.headVersion?.body ?? '';
          return {
            id: scene.id,
            chapterId: chapter.id,
            order: scene.order,
            title: scene.title,
            status: scene.status === 'ACCEPTED' ? 'final' : scene.status === 'REVIEW' ? 'review' : scene.status === 'DRAFTING' ? 'in-progress' : 'planned',
            povCharacterId: scene.povCharacterId,
            locationId: scene.locationId,
            storyDate: scene.storyDate,
            storyTime: scene.storyTime,
            estimatedWordCount: typeof metadata.targetWordCount === 'number' ? metadata.targetWordCount : null,
            actualWordCount: scene.branch.headVersion?.wordCount ?? 0,
            sceneFunction: stringValue(metadata.function), goal: stringValue(metadata.goal), obstacle: stringValue(metadata.obstacle),
            stakes: stringValue(metadata.stakes), conflict: stringValue(metadata.conflict), turn: stringValue(metadata.turn),
            revelation: stringArray(metadata.revelations).join('; '), outcome: stringValue(metadata.outcome),
            emotionalValueShift: stringValue(metadata.emotionalValueShift), tension: scene.tension,
            characterPresentIds: stringArray(metadata.characterPresentIds), characterReferencedIds: stringArray(metadata.characterReferencedIds),
            plotThreadIds: stringArray(metadata.plotThreadIds), setupPayoffIds: stringArray(metadata.setupPayoffIds),
            knowledgeDeltas: (metadata.knowledgeDeltas ?? null) as JsonValue, objectTransfers: (metadata.objectTransfers ?? null) as JsonValue,
            injuryStateChanges: (metadata.injuryStateChanges ?? null) as JsonValue, worldRuleRefs: (metadata.worldRuleRefs ?? null) as JsonValue,
            entryState: (metadata.entryState ?? null) as JsonValue, exitState: (metadata.exitState ?? null) as JsonValue,
            summary: stringValue(metadata.summary), writerNotes: '', aiNotes: '', content: body,
            createdAt: scene.createdAt.toISOString(), updatedAt: scene.updatedAt.toISOString(), revision: scene.revision,
            dependencyIds: stringArray(metadata.dependencies), sourceArtifactId: scene.planArtifactId, metadata
          };
        });
      return {
        id: chapter.id,
        number: chapter.chapterNumber ?? chapter.order + 1,
        title: chapter.title,
        status: chapter.status === 'ACCEPTED' ? 'final' : chapter.status === 'REVIEW' ? 'review' : 'draft',
        povCharacterId: chapter.povCharacterId ?? undefined,
        locationId: chapter.locationId ?? undefined,
        summary: stringValue((chapter.metadata as JsonObject).summary),
        wordCount: chapter.branch.headVersion?.wordCount ?? 0,
        content: chapterBody,
        publishedAt: null,
        scenes,
        sourceArtifactId: chapter.planArtifactId,
        branchId: chapter.branchId
      };
    });
  }

  private async applyArtifactOperation(
    tx: NovelBuildTx,
    projectId: string,
    buildRunId: string,
    allowedTypes: readonly StoryArtifactType[],
    operation: StoryArtifactBatchOperation,
    artifactIds: string[],
    linkIds: string[],
    replacementMap: Map<string, string>,
    allowTaskBinding: boolean,
    internalTask: { id: string; type: string; scopeUnitIds: string[]; inputArtifactIds: string[]; outputArtifactIds: string[]; executionPolicy: Prisma.JsonValue } | null
  ) {
    if (operation.op === 'create') {
      if (operation.artifact.taskId && !allowTaskBinding) throw new HttpError(403, 'Public artifact edits cannot bind outputs to worker tasks');
      if (internalTask && operation.artifact.taskId !== internalTask.id) throw new HttpError(403, 'Fenced artifact output must bind to the leased taskId');
      this.assertArtifactAllowed(allowedTypes, operation.artifact.type);
      const content = this.parseArtifactContent(operation.artifact.type, operation.artifact.content);
      if (internalTask) this.assertArtifactOutputScope(internalTask, operation.artifact.type, content, operation.artifact.bindings ?? []);
      await this.assertArtifactTask(tx, buildRunId, operation.artifact.taskId);
      const current = await tx.storyArtifact.findFirst({ where: { buildRunId, type: toPrismaArtifactType(operation.artifact.type), key: operation.artifact.key, status: { notIn: ['SUPERSEDED', 'INVALIDATED'] } } });
      if (current) throw new HttpError(409, `Active artifact '${operation.artifact.key}' already exists; use replace`);
      const last = await tx.storyArtifact.findFirst({ where: { buildRunId, type: toPrismaArtifactType(operation.artifact.type), key: operation.artifact.key }, orderBy: { version: 'desc' } });
      const status = operation.artifact.status ?? 'draft';
      const artifact = await tx.storyArtifact.create({ data: {
        projectId, buildRunId, taskId: operation.artifact.taskId ?? null, type: toPrismaArtifactType(operation.artifact.type),
        key: required(operation.artifact.key, 'Artifact key', 500), title: required(operation.artifact.title, 'Artifact title', 1_000),
        version: (last?.version ?? 0) + 1, schemaVersion: operation.artifact.schemaVersion ?? STORY_SCHEMA_VERSION,
        status: toPrismaArtifactStatus(status), content: content as Prisma.InputJsonValue, contentHash: stableHash(content),
        acceptedAt: status === 'accepted' ? new Date() : null
      } });
      artifactIds.push(artifact.id);
      await this.createArtifactBindings(tx, projectId, buildRunId, artifact.id, artifact.taskId, operation.artifact.bindings ?? []);
      await this.validateArtifactEntityContract(tx, projectId, buildRunId, artifact);
      return;
    }
    if (operation.op === 'replace') {
      if (operation.artifact.taskId && !allowTaskBinding) throw new HttpError(403, 'Public artifact edits cannot bind outputs to worker tasks');
      if (internalTask && (operation.artifact.taskId ?? internalTask.id) !== internalTask.id) throw new HttpError(403, 'Fenced replacement must bind to the leased taskId');
      const old = await this.artifactForUpdate(tx, projectId, buildRunId, operation.artifactId, operation.expectedVersion);
      await this.assertArtifactNotPinned(tx, buildRunId, old.id);
      const sdkType = operation.artifact.type;
      this.assertArtifactAllowed(allowedTypes, sdkType);
      if (toPrismaArtifactType(sdkType) !== old.type || operation.artifact.key !== old.key) throw new HttpError(400, 'Replacement artifact type and key must match the artifact it replaces');
      const content = this.parseArtifactContent(sdkType, operation.artifact.content);
      if (internalTask) this.assertArtifactOutputScope(internalTask, sdkType, content, operation.artifact.bindings ?? []);
      const replacementTaskId = internalTask?.id ?? (allowTaskBinding ? operation.artifact.taskId ?? old.taskId : null);
      await this.assertArtifactTask(tx, buildRunId, replacementTaskId);
      const status = operation.artifact.status ?? 'draft';
      const replacement = await tx.storyArtifact.create({ data: {
        projectId, buildRunId, taskId: replacementTaskId, type: old.type, key: old.key,
        title: required(operation.artifact.title, 'Artifact title', 1_000), version: old.version + 1,
        schemaVersion: operation.artifact.schemaVersion ?? STORY_SCHEMA_VERSION, status: toPrismaArtifactStatus(status),
        content: content as Prisma.InputJsonValue, contentHash: stableHash(content), replacesArtifactId: old.id,
        acceptedAt: status === 'accepted' ? new Date() : null
      } });
      await tx.storyArtifact.update({ where: { id: old.id }, data: { status: 'SUPERSEDED' } });
      artifactIds.push(old.id, replacement.id);
      await this.createArtifactBindings(tx, projectId, buildRunId, replacement.id, replacement.taskId, operation.artifact.bindings ?? []);
      await this.validateArtifactEntityContract(tx, projectId, buildRunId, replacement);
      replacementMap.set(old.id, replacement.id);
      return;
    }
    if (operation.op === 'set-status') {
      const artifact = await this.artifactForUpdate(tx, projectId, buildRunId, operation.artifactId, operation.expectedVersion);
      if (internalTask && artifact.taskId !== internalTask.id) throw new HttpError(403, 'Fenced task cannot change another task output');
      this.assertArtifactAllowed(allowedTypes, artifactType(artifact.type));
      const next = toPrismaArtifactStatus(operation.status);
      const allowed = artifact.status === 'DRAFT' ? ['DRAFT', 'VALIDATED'] : artifact.status === 'VALIDATED' ? ['DRAFT', 'VALIDATED', 'ACCEPTED'] : artifact.status === 'ACCEPTED' ? ['ACCEPTED'] : [];
      if (!allowed.includes(next)) throw new HttpError(409, `Artifact cannot transition from ${artifact.status.toLowerCase()} to ${operation.status}`);
      await tx.storyArtifact.update({ where: { id: artifact.id }, data: { status: next, acceptedAt: next === 'ACCEPTED' ? new Date() : artifact.acceptedAt } });
      artifactIds.push(artifact.id);
      return;
    }
    if (operation.op === 'invalidate') {
      const artifact = await this.artifactForUpdate(tx, projectId, buildRunId, operation.artifactId, operation.expectedVersion);
      if (internalTask && artifact.taskId !== internalTask.id) throw new HttpError(403, 'Fenced task cannot invalidate another task output');
      await this.assertArtifactNotPinned(tx, buildRunId, artifact.id);
      this.assertArtifactAllowed(allowedTypes, artifactType(artifact.type));
      await tx.storyArtifact.update({ where: { id: artifact.id }, data: { status: 'INVALIDATED', invalidatedAt: new Date() } });
      artifactIds.push(artifact.id);
      replacementMap.set(artifact.id, '');
      return;
    }
    if (operation.op === 'link') {
      const [from, to] = await Promise.all([
        tx.storyArtifact.findFirst({ where: { id: operation.fromArtifactId, projectId, buildRunId } }),
        tx.storyArtifact.findFirst({ where: { id: operation.toArtifactId, projectId, buildRunId } })
      ]);
      if (!from || !to) throw new HttpError(400, 'Artifact links cannot cross projects or builds');
      if (internalTask && (from.taskId !== internalTask.id || !new Set([...internalTask.inputArtifactIds, ...internalTask.outputArtifactIds, from.id]).has(to.id))) throw new HttpError(403, 'Fenced task can only link its output to declared task inputs/outputs');
      if (from.id === to.id) throw new HttpError(400, 'An artifact cannot link to itself');
      if (operation.metadata !== undefined) assertJson(operation.metadata);
      const link = await tx.storyArtifactLink.upsert({
        where: { fromArtifactId_toArtifactId_relationType: { fromArtifactId: from.id, toArtifactId: to.id, relationType: required(operation.relationType, 'Relation type', 500) } },
        create: { projectId, buildRunId, fromArtifactId: from.id, toArtifactId: to.id, relationType: operation.relationType, metadata: jsonNullable(operation.metadata) },
        update: { metadata: jsonNullable(operation.metadata) }
      });
      linkIds.push(link.id);
      return;
    }
    const link = await tx.storyArtifactLink.findFirst({ where: { projectId, buildRunId, fromArtifactId: operation.fromArtifactId, toArtifactId: operation.toArtifactId, relationType: operation.relationType } });
    if (internalTask && link) {
      const from = await tx.storyArtifact.findFirst({ where: { id: link.fromArtifactId, projectId, buildRunId }, select: { taskId: true } });
      if (from?.taskId !== internalTask.id) throw new HttpError(403, 'Fenced task cannot unlink another task output');
    }
    if (link) { await tx.storyArtifactLink.delete({ where: { id: link.id } }); linkIds.push(link.id); }
  }

  private async applyStateOperation(
    tx: NovelBuildTx,
    projectId: string,
    buildRunId: string,
    operation: StoryStateBatchOperation,
    provenance: { sourceTaskId: string | null; allowedUnitIds: string[] }
  ) {
    if (operation.op === 'invalidate') return this.invalidateState(tx, projectId, buildRunId, operation.entityKind, operation.key, provenance);
    if (operation.op === 'restore') return this.restoreState(tx, projectId, buildRunId, operation.entityKind, operation.key, operation.version, provenance);
    if (operation.op === 'upsert-canon-fact') {
      const value = operation.value;
      this.validateStateValue(value);
      const sourceUnitId = await this.assertSourceUnit(tx, projectId, buildRunId, value.sourceUnitId, provenance.allowedUnitIds);
      await this.assertStateSources(tx, projectId, buildRunId, value);
      const validFromOrder = value.validFromOrder ?? await this.storyOrderForScene(tx, projectId, buildRunId, value.validFromSceneId);
      const validToOrder = value.validToOrder ?? await this.storyOrderForScene(tx, projectId, buildRunId, value.validToSceneId);
      const key = required(value.key, 'Canon fact key', 500);
      const [current, last] = await Promise.all([
        tx.canonFact.findFirst({ where: { buildRunId, key, isCurrent: true } }),
        tx.canonFact.findFirst({ where: { buildRunId, key }, orderBy: { version: 'desc' } })
      ]);
      if (current) await tx.canonFact.update({ where: { id: current.id }, data: { isCurrent: false } });
      await tx.canonFact.create({ data: {
        projectId, buildRunId, sourceArtifactId: value.sourceArtifactId, sourceTaskId: provenance.sourceTaskId, sourceUnitId,
        supersedesFactId: current?.id ?? last?.id, key, version: (last?.version ?? 0) + 1, subjectType: required(value.subjectType, 'Subject type', 100),
        subjectId: required(value.subjectId, 'Subject id', 500), predicate: required(value.predicate, 'Predicate', 500), object: json(value.object),
        status: toPrismaCanonStatus(value.status), validFromSceneId: value.validFromSceneId, validToSceneId: value.validToSceneId,
        validFromOrder, validToOrder, sourceChapterId: value.sourceChapterId,
        sourceSceneId: value.sourceSceneId, sourceSpan: jsonNullable(value.sourceSpan as unknown as JsonValue | null), confidence: bounded(value.confidence, 0, 1, 'confidence')
      } });
      return;
    }
    if (operation.op === 'upsert-entity-state') {
      const value = operation.value;
      this.validateStateValue(value);
      const sourceUnitId = await this.assertSourceUnit(tx, projectId, buildRunId, value.sourceUnitId, provenance.allowedUnitIds);
      await this.assertStateSources(tx, projectId, buildRunId, value);
      const validFromOrder = value.validFromOrder ?? await this.storyOrderForScene(tx, projectId, buildRunId, value.validFromSceneId);
      const validToOrder = value.validToOrder ?? await this.storyOrderForScene(tx, projectId, buildRunId, value.validToSceneId);
      if (value.sourceFactId) await this.assertRecord(tx.canonFact.findFirst({ where: { id: value.sourceFactId, projectId, buildRunId, isCurrent: true } }), 'Source fact does not belong to this build');
      const key = required(value.key, 'Entity-state key', 500);
      const [current, last] = await Promise.all([
        tx.entityState.findFirst({ where: { buildRunId, key, isCurrent: true } }),
        tx.entityState.findFirst({ where: { buildRunId, key }, orderBy: { version: 'desc' } })
      ]);
      if (current) await tx.entityState.update({ where: { id: current.id }, data: { isCurrent: false } });
      await tx.entityState.create({ data: {
        projectId, buildRunId, sourceArtifactId: value.sourceArtifactId, sourceTaskId: provenance.sourceTaskId, sourceUnitId,
        sourceFactId: value.sourceFactId, supersedesStateId: current?.id ?? last?.id, key, version: (last?.version ?? 0) + 1,
        entityType: required(value.entityType, 'Entity type', 100), entityId: required(value.entityId, 'Entity id', 500), stateKey: required(value.stateKey, 'State key', 500),
        value: json(value.value), status: toPrismaEntityStateStatus(value.status), validFromSceneId: value.validFromSceneId, validToSceneId: value.validToSceneId,
        validFromOrder, validToOrder, storyOrder: value.storyOrder ?? validFromOrder,
        sourceSpan: jsonNullable(value.sourceSpan as unknown as JsonValue | null)
      } });
      return;
    }
    if (operation.op === 'upsert-timeline-event') {
      const value = operation.value;
      this.validateStateValue(value);
      const sourceUnitId = await this.assertSourceUnit(tx, projectId, buildRunId, value.sourceUnitId, provenance.allowedUnitIds);
      await this.assertStateSources(tx, projectId, buildRunId, value);
      const sortOrder = value.sortOrder ?? await this.storyOrderForScene(tx, projectId, buildRunId, value.sceneId);
      const key = required(value.key, 'Timeline key', 500);
      const [current, last] = await Promise.all([
        tx.timelineEvent.findFirst({ where: { buildRunId, key, isCurrent: true } }),
        tx.timelineEvent.findFirst({ where: { buildRunId, key }, orderBy: { version: 'desc' } })
      ]);
      if (current) await tx.timelineEvent.update({ where: { id: current.id }, data: { isCurrent: false } });
      await tx.timelineEvent.create({ data: {
        projectId, buildRunId, sourceArtifactId: value.sourceArtifactId, sourceTaskId: provenance.sourceTaskId, sourceUnitId,
        supersedesEventId: current?.id ?? last?.id, key, version: (last?.version ?? 0) + 1, title: required(value.title, 'Timeline title', 1_000),
        description: cleanNullable(value.description, 50_000), chronology: json(value.chronology), sortOrder,
        chapterId: value.chapterId, sceneId: value.sceneId, dependencyIds: unique(value.dependencyIds), participantRefs: json(value.participantRefs as unknown as JsonValue),
        sourceSpan: jsonNullable(value.sourceSpan as unknown as JsonValue | null)
      } });
      return;
    }
    if (operation.op === 'upsert-open-loop') {
      const value = operation.value;
      this.validateStateValue(value);
      const sourceUnitId = await this.assertSourceUnit(tx, projectId, buildRunId, value.sourceUnitId, provenance.allowedUnitIds);
      await this.assertStateSources(tx, projectId, buildRunId, { sourceArtifactId: value.introducedArtifactId, sourceChapterId: null, sourceSceneId: value.introducedSceneId });
      await this.assertStateSources(tx, projectId, buildRunId, { sourceArtifactId: value.resolvedArtifactId, sourceChapterId: null, sourceSceneId: value.resolvedSceneId });
      const key = required(value.key, 'Open-loop key', 500);
      const [current, last] = await Promise.all([
        tx.openLoop.findFirst({ where: { buildRunId, key, isCurrent: true } }),
        tx.openLoop.findFirst({ where: { buildRunId, key }, orderBy: { version: 'desc' } })
      ]);
      if (current) await tx.openLoop.update({ where: { id: current.id }, data: { isCurrent: false } });
      await tx.openLoop.create({ data: {
        projectId, buildRunId, sourceTaskId: provenance.sourceTaskId, sourceUnitId, supersedesLoopId: current?.id ?? last?.id,
        key, version: (last?.version ?? 0) + 1, kind: toPrismaOpenLoopKind(value.kind), status: toPrismaOpenLoopStatus(value.status),
        title: required(value.title, 'Open-loop title', 1_000), description: required(value.description, 'Open-loop description', 50_000),
        introducedSceneId: value.introducedSceneId, resolvedSceneId: value.resolvedSceneId, introducedArtifactId: value.introducedArtifactId,
        resolvedArtifactId: value.resolvedArtifactId, targetPayoff: cleanNullable(value.targetPayoff, 20_000), metadata: jsonNullable(value.metadata)
      } });
      return;
    }
    if (operation.op === 'upsert-setup-payoff') {
      const value = operation.value;
      this.validateStateValue(value);
      const sourceUnitId = await this.assertSourceUnit(tx, projectId, buildRunId, value.sourceUnitId, provenance.allowedUnitIds);
      await this.assertStateSources(tx, projectId, buildRunId, { sourceArtifactId: value.setupArtifactId, sourceChapterId: null, sourceSceneId: value.setupSceneId });
      await this.assertStateSources(tx, projectId, buildRunId, { sourceArtifactId: value.payoffArtifactId, sourceChapterId: null, sourceSceneId: value.payoffSceneId });
      if (value.plotThreadId) await this.assertRecord(tx.plotThread.findFirst({ where: { id: value.plotThreadId, projectId, buildRunId, isCurrent: true } }), 'Plot thread does not belong to this build');
      const key = required(value.key, 'Setup/payoff key', 500);
      const [current, last] = await Promise.all([
        tx.setupPayoffLink.findFirst({ where: { buildRunId, key, isCurrent: true } }),
        tx.setupPayoffLink.findFirst({ where: { buildRunId, key }, orderBy: { version: 'desc' } })
      ]);
      if (current) await tx.setupPayoffLink.update({ where: { id: current.id }, data: { isCurrent: false } });
      await tx.setupPayoffLink.create({ data: {
        projectId, buildRunId, sourceTaskId: provenance.sourceTaskId, sourceUnitId, supersedesLinkId: current?.id ?? last?.id,
        plotThreadId: value.plotThreadId, key, version: (last?.version ?? 0) + 1, title: required(value.title, 'Setup/payoff title', 1_000),
        description: required(value.description, 'Setup/payoff description', 50_000), status: toPrismaSetupPayoffStatus(value.status),
        setupSceneId: value.setupSceneId, payoffSceneId: value.payoffSceneId, reinforcementSceneIds: unique(value.reinforcementSceneIds),
        setupArtifactId: value.setupArtifactId, payoffArtifactId: value.payoffArtifactId, metadata: jsonNullable(value.metadata)
      } });
      return;
    }
    const value = operation.value;
    this.validateStateValue(value);
    const sourceUnitId = await this.assertSourceUnit(tx, projectId, buildRunId, value.sourceUnitId, provenance.allowedUnitIds);
    if (value.parentThreadId) await this.assertRecord(tx.plotThread.findFirst({ where: { id: value.parentThreadId, projectId, buildRunId, isCurrent: true } }), 'Parent plot thread does not belong to this build');
    await this.assertStateSources(tx, projectId, buildRunId, value);
    const key = required(value.key, 'Plot-thread key', 500);
    const [current, last] = await Promise.all([
      tx.plotThread.findFirst({ where: { buildRunId, key, isCurrent: true } }),
      tx.plotThread.findFirst({ where: { buildRunId, key }, orderBy: { version: 'desc' } })
    ]);
    if (current) await tx.plotThread.update({ where: { id: current.id }, data: { isCurrent: false } });
    await tx.plotThread.create({ data: {
      projectId, buildRunId, sourceArtifactId: value.sourceArtifactId, sourceTaskId: provenance.sourceTaskId, sourceUnitId,
      supersedesThreadId: current?.id ?? last?.id, parentThreadId: value.parentThreadId, key, version: (last?.version ?? 0) + 1,
      title: required(value.title, 'Plot-thread title', 1_000), kind: toPrismaPlotThreadKind(value.kind), status: toPrismaPlotThreadStatus(value.status),
      summary: required(value.summary, 'Plot-thread summary', 50_000), stakes: cleanNullable(value.stakes, 20_000), sceneIds: unique(value.sceneIds),
      introducedSceneId: value.introducedSceneId, resolvedSceneId: value.resolvedSceneId, metadata: jsonNullable(value.metadata)
    } });
  }

  private async assertSourceUnit(
    tx: NovelBuildTx,
    projectId: string,
    buildRunId: string,
    sourceUnitId: string | null | undefined,
    allowedUnitIds: string[]
  ): Promise<string | null> {
    if (allowedUnitIds.length && !sourceUnitId) throw new HttpError(403, 'Fenced story-state mutations require sourceUnitId provenance');
    if (!sourceUnitId) return null;
    const unit = await tx.buildManuscriptUnit.findFirst({ where: { id: sourceUnitId, projectId, buildRunId, invalidatedAt: null }, select: { id: true } });
    if (!unit) throw new HttpError(400, 'sourceUnitId does not belong to this build');
    if (allowedUnitIds.length && !allowedUnitIds.includes(sourceUnitId)) throw new HttpError(403, 'Task lease is not scoped to sourceUnitId');
    return unit.id;
  }

  private async storyOrderForScene(tx: NovelBuildTx, projectId: string, buildRunId: string, sceneId: string | null | undefined): Promise<number | null> {
    if (!sceneId) return null;
    const unit = await tx.buildManuscriptUnit.findFirst({
      where: { projectId, buildRunId, kind: 'SCENE', OR: [{ id: sceneId }, { sourceSceneId: sceneId }] },
      include: { parentUnit: { select: { order: true } } }
    });
    if (unit) return (unit.parentUnit?.order ?? 0) * 10_000 + unit.order;
    const scene = await tx.scene.findFirst({ where: { id: sceneId, chapter: { projectId, deletedAt: null } }, include: { chapter: { select: { number: true } } } });
    return scene ? scene.chapter.number * 10_000 + scene.order : null;
  }

  private async restoreState(
    tx: NovelBuildTx,
    projectId: string,
    buildRunId: string,
    kind: StoryStateEntityKind,
    key: string,
    version: number,
    provenance: { sourceTaskId: string | null; allowedUnitIds: string[] }
  ) {
    if (!Number.isInteger(version) || version < 1) throw new HttpError(400, 'History version must be a positive integer');
    const normalizedKey = required(key, 'Story-state key', 500);
    if (kind === 'canon-fact') {
      const [old, current, latest] = await Promise.all([
        tx.canonFact.findUnique({ where: { buildRunId_key_version: { buildRunId, key: normalizedKey, version } } }),
        tx.canonFact.findFirst({ where: { buildRunId, key: normalizedKey, isCurrent: true } }),
        tx.canonFact.findFirst({ where: { buildRunId, key: normalizedKey }, orderBy: { version: 'desc' } })
      ]);
      if (!old || old.projectId !== projectId) throw new HttpError(404, 'Canon fact history version not found');
      const sourceUnitId = await this.assertSourceUnit(tx, projectId, buildRunId, old.sourceUnitId, provenance.allowedUnitIds);
      if (current) await tx.canonFact.update({ where: { id: current.id }, data: { isCurrent: false } });
      const { id: _id, createdAt: _created, updatedAt: _updated, version: _version, isCurrent: _current, supersedesFactId: _supersedes, invalidatedAt: _invalidated, ...copy } = old;
      await tx.canonFact.create({ data: { ...copy, object: json(old.object as JsonValue), sourceSpan: jsonNullable(old.sourceSpan as JsonValue | null), sourceTaskId: provenance.sourceTaskId, sourceUnitId, version: (latest?.version ?? old.version) + 1, isCurrent: true, supersedesFactId: current?.id ?? latest?.id ?? old.id, invalidatedAt: null } });
      return;
    }
    if (kind === 'entity-state') {
      const [old, current, latest] = await Promise.all([
        tx.entityState.findUnique({ where: { buildRunId_key_version: { buildRunId, key: normalizedKey, version } } }),
        tx.entityState.findFirst({ where: { buildRunId, key: normalizedKey, isCurrent: true } }),
        tx.entityState.findFirst({ where: { buildRunId, key: normalizedKey }, orderBy: { version: 'desc' } })
      ]);
      if (!old || old.projectId !== projectId) throw new HttpError(404, 'Entity-state history version not found');
      const sourceUnitId = await this.assertSourceUnit(tx, projectId, buildRunId, old.sourceUnitId, provenance.allowedUnitIds);
      if (current) await tx.entityState.update({ where: { id: current.id }, data: { isCurrent: false } });
      const { id: _id, createdAt: _created, updatedAt: _updated, version: _version, isCurrent: _current, supersedesStateId: _supersedes, invalidatedAt: _invalidated, ...copy } = old;
      await tx.entityState.create({ data: { ...copy, value: json(old.value as JsonValue), sourceSpan: jsonNullable(old.sourceSpan as JsonValue | null), sourceTaskId: provenance.sourceTaskId, sourceUnitId, version: (latest?.version ?? old.version) + 1, isCurrent: true, supersedesStateId: current?.id ?? latest?.id ?? old.id, invalidatedAt: null } });
      return;
    }
    if (kind === 'timeline-event') {
      const [old, current, latest] = await Promise.all([
        tx.timelineEvent.findUnique({ where: { buildRunId_key_version: { buildRunId, key: normalizedKey, version } } }),
        tx.timelineEvent.findFirst({ where: { buildRunId, key: normalizedKey, isCurrent: true } }),
        tx.timelineEvent.findFirst({ where: { buildRunId, key: normalizedKey }, orderBy: { version: 'desc' } })
      ]);
      if (!old || old.projectId !== projectId) throw new HttpError(404, 'Timeline history version not found');
      const sourceUnitId = await this.assertSourceUnit(tx, projectId, buildRunId, old.sourceUnitId, provenance.allowedUnitIds);
      if (current) await tx.timelineEvent.update({ where: { id: current.id }, data: { isCurrent: false } });
      const { id: _id, createdAt: _created, updatedAt: _updated, version: _version, isCurrent: _current, supersedesEventId: _supersedes, invalidatedAt: _invalidated, ...copy } = old;
      await tx.timelineEvent.create({ data: { ...copy, chronology: json(old.chronology as JsonValue), participantRefs: json(old.participantRefs as JsonValue), sourceSpan: jsonNullable(old.sourceSpan as JsonValue | null), sourceTaskId: provenance.sourceTaskId, sourceUnitId, version: (latest?.version ?? old.version) + 1, isCurrent: true, supersedesEventId: current?.id ?? latest?.id ?? old.id, invalidatedAt: null } });
      return;
    }
    if (kind === 'open-loop') {
      const [old, current, latest] = await Promise.all([
        tx.openLoop.findUnique({ where: { buildRunId_key_version: { buildRunId, key: normalizedKey, version } } }),
        tx.openLoop.findFirst({ where: { buildRunId, key: normalizedKey, isCurrent: true } }),
        tx.openLoop.findFirst({ where: { buildRunId, key: normalizedKey }, orderBy: { version: 'desc' } })
      ]);
      if (!old || old.projectId !== projectId) throw new HttpError(404, 'Open-loop history version not found');
      const sourceUnitId = await this.assertSourceUnit(tx, projectId, buildRunId, old.sourceUnitId, provenance.allowedUnitIds);
      if (current) await tx.openLoop.update({ where: { id: current.id }, data: { isCurrent: false } });
      const { id: _id, createdAt: _created, updatedAt: _updated, version: _version, isCurrent: _current, supersedesLoopId: _supersedes, invalidatedAt: _invalidated, ...copy } = old;
      await tx.openLoop.create({ data: { ...copy, metadata: jsonNullable(old.metadata as JsonValue | null), sourceTaskId: provenance.sourceTaskId, sourceUnitId, version: (latest?.version ?? old.version) + 1, isCurrent: true, supersedesLoopId: current?.id ?? latest?.id ?? old.id, invalidatedAt: null } });
      return;
    }
    if (kind === 'setup-payoff') {
      const [old, current, latest] = await Promise.all([
        tx.setupPayoffLink.findUnique({ where: { buildRunId_key_version: { buildRunId, key: normalizedKey, version } } }),
        tx.setupPayoffLink.findFirst({ where: { buildRunId, key: normalizedKey, isCurrent: true } }),
        tx.setupPayoffLink.findFirst({ where: { buildRunId, key: normalizedKey }, orderBy: { version: 'desc' } })
      ]);
      if (!old || old.projectId !== projectId) throw new HttpError(404, 'Setup/payoff history version not found');
      const sourceUnitId = await this.assertSourceUnit(tx, projectId, buildRunId, old.sourceUnitId, provenance.allowedUnitIds);
      if (current) await tx.setupPayoffLink.update({ where: { id: current.id }, data: { isCurrent: false } });
      const { id: _id, createdAt: _created, updatedAt: _updated, version: _version, isCurrent: _current, supersedesLinkId: _supersedes, invalidatedAt: _invalidated, ...copy } = old;
      await tx.setupPayoffLink.create({ data: { ...copy, metadata: jsonNullable(old.metadata as JsonValue | null), sourceTaskId: provenance.sourceTaskId, sourceUnitId, version: (latest?.version ?? old.version) + 1, isCurrent: true, supersedesLinkId: current?.id ?? latest?.id ?? old.id, invalidatedAt: null } });
      return;
    }
    const [old, current, latest] = await Promise.all([
      tx.plotThread.findUnique({ where: { buildRunId_key_version: { buildRunId, key: normalizedKey, version } } }),
      tx.plotThread.findFirst({ where: { buildRunId, key: normalizedKey, isCurrent: true } }),
      tx.plotThread.findFirst({ where: { buildRunId, key: normalizedKey }, orderBy: { version: 'desc' } })
    ]);
    if (!old || old.projectId !== projectId) throw new HttpError(404, 'Plot-thread history version not found');
    const sourceUnitId = await this.assertSourceUnit(tx, projectId, buildRunId, old.sourceUnitId, provenance.allowedUnitIds);
    if (current) await tx.plotThread.update({ where: { id: current.id }, data: { isCurrent: false } });
    const { id: _id, createdAt: _created, updatedAt: _updated, version: _version, isCurrent: _current, supersedesThreadId: _supersedes, invalidatedAt: _invalidated, ...copy } = old;
    await tx.plotThread.create({ data: { ...copy, metadata: jsonNullable(old.metadata as JsonValue | null), sourceTaskId: provenance.sourceTaskId, sourceUnitId, version: (latest?.version ?? old.version) + 1, isCurrent: true, supersedesThreadId: current?.id ?? latest?.id ?? old.id, invalidatedAt: null } });
  }

  private async invalidateState(
    tx: NovelBuildTx,
    projectId: string,
    buildRunId: string,
    kind: StoryStateEntityKind,
    key: string,
    _provenance: { sourceTaskId: string | null; allowedUnitIds: string[] }
  ) {
    const where = { projectId, buildRunId, key: required(key, 'Story-state key', 500), isCurrent: true };
    const now = new Date();
    const result = kind === 'canon-fact' ? await tx.canonFact.updateMany({ where, data: { status: 'INVALIDATED', invalidatedAt: now, isCurrent: false } })
      : kind === 'entity-state' ? await tx.entityState.updateMany({ where, data: { status: 'INVALIDATED', invalidatedAt: now, isCurrent: false } })
      : kind === 'timeline-event' ? await tx.timelineEvent.updateMany({ where, data: { invalidatedAt: now, isCurrent: false } })
      : kind === 'open-loop' ? await tx.openLoop.updateMany({ where, data: { status: 'INVALIDATED', invalidatedAt: now, isCurrent: false } })
      : kind === 'setup-payoff' ? await tx.setupPayoffLink.updateMany({ where, data: { status: 'INVALIDATED', invalidatedAt: now, isCurrent: false } })
      : await tx.plotThread.updateMany({ where, data: { status: 'INVALIDATED', invalidatedAt: now, isCurrent: false } });
    if (!result.count) throw new HttpError(404, 'Story-state entity not found');
  }

  private async validateArtifactCrossLinks(tx: NovelBuildTx, projectId: string, buildRunId: string) {
    const artifacts = await tx.storyArtifact.findMany({
      where: { projectId, buildRunId, status: { in: ['DRAFT', 'VALIDATED', 'ACCEPTED'] }, invalidatedAt: null }
    });
    const briefs = new Set<string>();
    const scenes = new Set<string>();
    const characters = new Set<string>();
    for (const artifact of artifacts) {
      const content = artifact.content as JsonObject;
      if (artifact.type === 'CHAPTER_BRIEF') briefs.add(typeof content.chapterKey === 'string' ? content.chapterKey : artifact.key);
      if (artifact.type === 'SCENE_PLAN') scenes.add(typeof content.sceneKey === 'string' ? content.sceneKey : artifact.key);
      if (artifact.type === 'CHARACTER_BIBLE') characters.add(typeof content.characterKey === 'string' ? content.characterKey : artifact.key);
    }
    for (const artifact of artifacts) {
      const content = artifact.content as JsonObject;
      if (artifact.type === 'SCENE_PLAN') {
        if (typeof content.chapterKey !== 'string' || !briefs.has(content.chapterKey)) throw new HttpError(409, `Scene plan '${artifact.key}' references missing chapter brief '${String(content.chapterKey)}'`);
        for (const dependency of stringArray(content.dependencies)) if (!scenes.has(dependency)) throw new HttpError(409, `Scene plan '${artifact.key}' references missing dependency '${dependency}'`);
      }
      // Act architecture is produced before chapter briefs, so its declared chapter
      // keys are forward references. The planning quality gate validates that the
      // eventual brief set matches these declarations exactly and atomically.
      if (artifact.type === 'RELATIONSHIP_GRAPH') {
        for (const ref of collectReferences(content)) if (ref.type === 'character' && !characters.has(ref.id) && !characters.has(ref.key ?? '')) {
          const exists = await tx.character.findFirst({ where: { id: ref.id, projectId }, select: { id: true } });
          if (!exists) throw new HttpError(409, `Relationship graph references missing character '${ref.id}'`);
        }
      }
    }
    const links = await tx.storyArtifactLink.findMany({ where: { projectId, buildRunId }, include: { fromArtifact: { select: { buildRunId: true, projectId: true } }, toArtifact: { select: { buildRunId: true, projectId: true } } } });
    if (links.some((link) => link.fromArtifact.projectId !== projectId || link.toArtifact.projectId !== projectId || link.fromArtifact.buildRunId !== buildRunId || link.toArtifact.buildRunId !== buildRunId)) throw new HttpError(409, 'Artifact cross-link escaped its project or build');
  }

  private async validateStateCrossLinks(tx: NovelBuildTx, projectId: string, buildRunId: string) {
    const [facts, states, events, loops, setups, threads] = await Promise.all([
      tx.canonFact.findMany({ where: { projectId, buildRunId, isCurrent: true, invalidatedAt: null } }),
      tx.entityState.findMany({ where: { projectId, buildRunId, isCurrent: true, invalidatedAt: null } }),
      tx.timelineEvent.findMany({ where: { projectId, buildRunId, isCurrent: true, invalidatedAt: null } }),
      tx.openLoop.findMany({ where: { projectId, buildRunId, isCurrent: true, invalidatedAt: null } }),
      tx.setupPayoffLink.findMany({ where: { projectId, buildRunId, isCurrent: true, invalidatedAt: null } }),
      tx.plotThread.findMany({ where: { projectId, buildRunId, isCurrent: true, invalidatedAt: null } })
    ]);
    const ids = new Set(events.flatMap((event) => [event.id, event.key]));
    for (const event of events) for (const dependency of event.dependencyIds) if (!ids.has(dependency)) throw new HttpError(409, `Timeline event '${event.key}' references missing dependency '${dependency}'`);
    const threadIds = new Set(threads.map((thread) => thread.id));
    if (threads.some((thread) => thread.parentThreadId && !threadIds.has(thread.parentThreadId))) throw new HttpError(409, 'Plot-thread hierarchy contains a cross-build parent');
    if (setups.some((setup) => setup.plotThreadId && !threadIds.has(setup.plotThreadId))) throw new HttpError(409, 'Setup/payoff references a plot thread outside the build');
    const chapterIds = unique([
      ...facts.flatMap((fact) => [fact.sourceChapterId]),
      ...events.flatMap((event) => [event.chapterId])
    ].filter((id): id is string => Boolean(id)));
    const sceneIds = unique([
      ...facts.flatMap((fact) => [fact.validFromSceneId, fact.validToSceneId, fact.sourceSceneId]),
      ...states.flatMap((state) => [state.validFromSceneId, state.validToSceneId]),
      ...events.flatMap((event) => [event.sceneId]),
      ...loops.flatMap((loop) => [loop.introducedSceneId, loop.resolvedSceneId]),
      ...setups.flatMap((setup) => [setup.setupSceneId, setup.payoffSceneId, ...setup.reinforcementSceneIds]),
      ...threads.flatMap((thread) => [thread.introducedSceneId, thread.resolvedSceneId, ...thread.sceneIds])
    ].filter((id): id is string => Boolean(id)));
    const sourceSpans = [...facts, ...states, ...events]
      .map((record) => record.sourceSpan)
      .filter((span): span is Prisma.JsonObject => Boolean(span) && typeof span === 'object' && !Array.isArray(span));
    const allChapterIds = unique([...chapterIds, ...sourceSpans.flatMap((span) => typeof span.chapterId === 'string' ? [span.chapterId] : [])]);
    const allSceneIds = unique([...sceneIds, ...sourceSpans.flatMap((span) => typeof span.sceneId === 'string' ? [span.sceneId] : [])]);
    const artifactIds = unique([
      ...facts.map((fact) => fact.sourceArtifactId), ...states.map((state) => state.sourceArtifactId), ...events.map((event) => event.sourceArtifactId),
      ...loops.flatMap((loop) => [loop.introducedArtifactId, loop.resolvedArtifactId]),
      ...setups.flatMap((setup) => [setup.setupArtifactId, setup.payoffArtifactId]), ...threads.map((thread) => thread.sourceArtifactId),
      ...sourceSpans.flatMap((span) => typeof span.artifactId === 'string' ? [span.artifactId] : [])
    ].filter((id): id is string => Boolean(id)));
    const unitIds = unique([
      ...facts.map((fact) => fact.sourceUnitId), ...states.map((state) => state.sourceUnitId), ...events.map((event) => event.sourceUnitId),
      ...loops.map((loop) => loop.sourceUnitId), ...setups.map((setup) => setup.sourceUnitId), ...threads.map((thread) => thread.sourceUnitId),
      ...sourceSpans.flatMap((span) => typeof span.unitId === 'string' ? [span.unitId] : [])
    ].filter((id): id is string => Boolean(id)));
    const sourceFactIds = unique(states.map((state) => state.sourceFactId).filter((id): id is string => Boolean(id)));
    const [canonicalChapters, buildChapters, canonicalScenes, buildScenes, artifactCount, unitCount, sourceFactCount] = await Promise.all([
      allChapterIds.length ? tx.chapter.findMany({ where: { id: { in: allChapterIds }, projectId, deletedAt: null }, select: { id: true } }) : [],
      allChapterIds.length ? tx.buildManuscriptUnit.findMany({ where: { id: { in: allChapterIds }, projectId, buildRunId, kind: 'CHAPTER', invalidatedAt: null }, select: { id: true } }) : [],
      allSceneIds.length ? tx.scene.findMany({ where: { id: { in: allSceneIds }, chapter: { projectId, deletedAt: null } }, select: { id: true } }) : [],
      allSceneIds.length ? tx.buildManuscriptUnit.findMany({ where: { id: { in: allSceneIds }, projectId, buildRunId, kind: 'SCENE', invalidatedAt: null }, select: { id: true } }) : [],
      artifactIds.length ? tx.storyArtifact.count({ where: { id: { in: artifactIds }, projectId, buildRunId } }) : 0,
      unitIds.length ? tx.buildManuscriptUnit.count({ where: { id: { in: unitIds }, projectId, buildRunId, invalidatedAt: null } }) : 0,
      sourceFactIds.length ? tx.canonFact.count({ where: { id: { in: sourceFactIds }, projectId, buildRunId } }) : 0
    ]);
    const knownChapters = new Set([...canonicalChapters, ...buildChapters].map((value) => value.id));
    const knownScenes = new Set([...canonicalScenes, ...buildScenes].map((value) => value.id));
    if (allChapterIds.some((id) => !knownChapters.has(id))) throw new HttpError(409, 'Story state references a chapter outside the project/build');
    if (allSceneIds.some((id) => !knownScenes.has(id))) throw new HttpError(409, 'Story state references a scene outside the project/build');
    if (artifactCount !== artifactIds.length) throw new HttpError(409, 'Story state references an artifact outside the project/build');
    if (unitCount !== unitIds.length) throw new HttpError(409, 'Story-state provenance references a unit outside the project/build');
    if (sourceFactCount !== sourceFactIds.length) throw new HttpError(409, 'Entity state references a source fact outside the project/build');
    for (const fact of facts) if (fact.validFromOrder !== null && fact.validToOrder !== null && fact.validToOrder < fact.validFromOrder) throw new HttpError(409, `Canon fact '${fact.key}' has an inverted validity interval`);
    for (const state of states) if (state.validFromOrder !== null && state.validToOrder !== null && state.validToOrder < state.validFromOrder) throw new HttpError(409, `Entity state '${state.key}' has an inverted validity interval`);
    const structuredValues = [
      ...facts.map((fact) => fact.object), ...states.map((state) => state.value),
      ...events.flatMap((event) => [event.chronology, event.participantRefs]),
      ...loops.map((loop) => loop.metadata), ...setups.map((setup) => setup.metadata), ...threads.map((thread) => thread.metadata)
    ].filter((value): value is Prisma.JsonValue => value !== null);
    for (const ref of uniqueReferences(structuredValues.flatMap((value) => collectReferences(value as JsonValue)))) await this.assertTypedReference(tx, projectId, buildRunId, ref);
  }

  private async assertTypedReference(tx: NovelBuildTx, projectId: string, buildRunId: string, ref: StoryReference) {
    const exists = ref.type === 'character' ? await tx.character.findFirst({ where: { id: ref.id, projectId }, select: { id: true } }) ?? await tx.storyArtifact.findFirst({ where: { projectId, buildRunId, type: 'CHARACTER_BIBLE', invalidatedAt: null, OR: [{ id: ref.id }, { key: ref.id }, { content: { path: ['characterKey'], equals: ref.id } }] }, select: { id: true } })
      : ref.type === 'location' ? await tx.location.findFirst({ where: { id: ref.id, projectId }, select: { id: true } })
      : ref.type === 'chapter' ? await tx.chapter.findFirst({ where: { id: ref.id, projectId, deletedAt: null }, select: { id: true } }) ?? await tx.buildManuscriptUnit.findFirst({ where: { projectId, buildRunId, kind: 'CHAPTER', OR: [{ id: ref.id }, { key: ref.id }] }, select: { id: true } })
      : ref.type === 'scene' ? await tx.scene.findFirst({ where: { id: ref.id, chapter: { projectId, deletedAt: null } }, select: { id: true } }) ?? await tx.buildManuscriptUnit.findFirst({ where: { projectId, buildRunId, kind: 'SCENE', OR: [{ id: ref.id }, { key: ref.id }] }, select: { id: true } })
      : ref.type === 'artifact' ? await tx.storyArtifact.findFirst({ where: { id: ref.id, projectId, buildRunId }, select: { id: true } })
      : ref.type === 'build-unit' ? await tx.buildManuscriptUnit.findFirst({ where: { id: ref.id, projectId, buildRunId }, select: { id: true } })
      : ref.type === 'plot-thread' ? await tx.plotThread.findFirst({ where: { projectId, buildRunId, isCurrent: true, OR: [{ id: ref.id }, { key: ref.id }] }, select: { id: true } }) ?? await tx.storyArtifact.findFirst({ where: { projectId, buildRunId, type: 'PLOT_THREAD', invalidatedAt: null, OR: [{ id: ref.id }, { key: ref.id }, { content: { path: ['threadKey'], equals: ref.id } }] }, select: { id: true } })
      : ref.type === 'canon-fact' ? await tx.canonFact.findFirst({ where: { id: ref.id, projectId, buildRunId, isCurrent: true }, select: { id: true } })
      : ref.type === 'entity-state' ? await tx.entityState.findFirst({ where: { id: ref.id, projectId, buildRunId, isCurrent: true }, select: { id: true } })
      : ref.type === 'timeline-event' ? await tx.timelineEvent.findFirst({ where: { id: ref.id, projectId, buildRunId, isCurrent: true }, select: { id: true } })
      : ref.type === 'open-loop' ? await tx.openLoop.findFirst({ where: { id: ref.id, projectId, buildRunId, isCurrent: true }, select: { id: true } })
      : ref.type === 'setup-payoff' ? await tx.setupPayoffLink.findFirst({ where: { id: ref.id, projectId, buildRunId, isCurrent: true }, select: { id: true } })
      : await tx.storyArtifactBinding.findFirst({ where: { projectId, buildRunId, entityType: ref.type, entityId: ref.id }, select: { id: true } });
    if (!exists) throw new HttpError(409, `Structured reference '${ref.type}:${ref.id}' crosses the project/build boundary`);
  }

  private async rewireArtifactConsumers(tx: NovelBuildTx, buildRunId: string, replacements: Map<string, string>) {
    for (const [oldId, newId] of replacements) {
      const [oldArtifact, newArtifact, tasks] = await Promise.all([
        tx.storyArtifact.findFirst({ where: { id: oldId, buildRunId }, select: { taskId: true } }),
        newId ? tx.storyArtifact.findFirst({ where: { id: newId, buildRunId }, select: { taskId: true } }) : null,
        tx.buildTask.findMany({ where: { buildRunId } })
      ]);
      if (oldArtifact?.taskId) {
        const producer = tasks.find((task) => task.id === oldArtifact.taskId);
        if (producer) await tx.buildTask.update({
          where: { id: producer.id },
          data: {
            outputArtifactIds: producer.outputArtifactIds.flatMap((id) => id === oldId
              ? (newId && newArtifact?.taskId === producer.id ? [newId] : [])
              : [id]),
            revision: { increment: 1 }
          }
        });
      }
      const affectedIds = new Set<string>();
      for (const consumer of tasks.filter((task) => task.inputArtifactIds.includes(oldId))) {
        downstream(tasks, consumer.id).forEach((task) => affectedIds.add(task.id));
      }
      if (oldArtifact?.taskId) {
        downstream(tasks, oldArtifact.taskId).forEach((task) => {
          if (task.id !== oldArtifact.taskId) affectedIds.add(task.id);
        });
      }
      const affected = tasks.filter((task) => affectedIds.has(task.id));
      const running = affected.find((task) => task.status === 'RUNNING');
      if (running) throw new HttpError(409, `Cannot replace artifact while downstream task '${running.key}' is running`);
      const invalidatedArtifactIds = unique(affected.flatMap((task) => task.outputArtifactIds).filter((id) => id !== newId));
      const invalidatedStateSourceIds = unique([oldId, ...invalidatedArtifactIds]);
      const now = new Date();
      if (invalidatedArtifactIds.length) {
        await tx.storyArtifact.updateMany({ where: { id: { in: invalidatedArtifactIds }, buildRunId }, data: { status: 'INVALIDATED', invalidatedAt: now } });
      }
      if (invalidatedStateSourceIds.length) {
        await Promise.all([
          tx.canonFact.updateMany({ where: { buildRunId, sourceArtifactId: { in: invalidatedStateSourceIds }, isCurrent: true }, data: { status: 'INVALIDATED', invalidatedAt: now, isCurrent: false } }),
          tx.entityState.updateMany({ where: { buildRunId, sourceArtifactId: { in: invalidatedStateSourceIds }, isCurrent: true }, data: { status: 'INVALIDATED', invalidatedAt: now, isCurrent: false } }),
          tx.timelineEvent.updateMany({ where: { buildRunId, sourceArtifactId: { in: invalidatedStateSourceIds }, isCurrent: true }, data: { invalidatedAt: now, isCurrent: false } }),
          tx.plotThread.updateMany({ where: { buildRunId, sourceArtifactId: { in: invalidatedStateSourceIds }, isCurrent: true }, data: { status: 'INVALIDATED', invalidatedAt: now, isCurrent: false } }),
          tx.openLoop.updateMany({ where: { buildRunId, isCurrent: true, OR: [{ introducedArtifactId: { in: invalidatedStateSourceIds } }, { resolvedArtifactId: { in: invalidatedStateSourceIds } }] }, data: { status: 'INVALIDATED', invalidatedAt: now, isCurrent: false } }),
          tx.setupPayoffLink.updateMany({ where: { buildRunId, isCurrent: true, OR: [{ setupArtifactId: { in: invalidatedStateSourceIds } }, { payoffArtifactId: { in: invalidatedStateSourceIds } }] }, data: { status: 'INVALIDATED', invalidatedAt: now, isCurrent: false } })
        ]);
      }
      const affectedSet = new Set(affected.map((task) => task.id));
      for (const task of affected) {
        const outsideDependenciesDone = task.dependencyIds
          .filter((dependencyId) => !affectedSet.has(dependencyId))
          .every((dependencyId) => tasks.find((candidate) => candidate.id === dependencyId)?.status === 'DONE');
        await this.builds.transitionTask(tx, task, {
          status: task.dependencyIds.length === 0 && outsideDependenciesDone ? 'READY' : 'BLOCKED',
          idempotencyKey: `artifact-replacement:${oldId}:${newId || 'invalidated'}:${task.id}`,
          reason: newId ? `Input artifact ${oldId} was replaced by ${newId}` : `Input artifact ${oldId} was invalidated`,
          data: {
            inputArtifactIds: task.inputArtifactIds.flatMap((id) => id === oldId ? (newId ? [newId] : []) : [id]),
            outputArtifactIds: task.outputArtifactIds.filter((id) => !invalidatedArtifactIds.includes(id)),
            attempts: 0,
            progress: 0,
            leaseOwner: null,
            leaseExpiresAt: null,
            heartbeatAt: null,
            startedAt: null,
            completedAt: null,
            failedAt: null,
            invalidatedAt: now,
            lastError: null
          }
        });
      }
    }
  }

  private computeDiagnostics(state: StoryStateSnapshot, artifacts: StoryArtifact[], tasks: BuildTask[]): StoryDiagnostic[] {
    const diagnostics: StoryDiagnostic[] = [];
    const add = (value: Omit<StoryDiagnostic, 'id'>) => diagnostics.push({ id: stableHash(value).slice(0, 24), ...value });
    for (const artifact of artifacts) {
      try { validateArtifactContent(artifact.type, artifact.content); }
      catch (error) { add(diagnostic('schema-invalid', 'schema', 'error', `Artifact '${artifact.title}' is not valid ${artifact.schemaVersion}: ${error instanceof Error ? error.message : 'unknown validation error'}`, [{ artifactId: artifact.id }], [{ type: 'artifact', id: artifact.id, key: artifact.key, label: artifact.title }], 'Replace the artifact with schema-valid content.')); }
    }
    const chapterKeys = new Set(artifacts.filter((a) => a.type === 'chapter-brief' && a.status !== 'invalidated').map((a) => String((a.content as JsonObject).chapterKey ?? a.key)));
    const sceneKeys = new Set(artifacts.filter((a) => a.type === 'scene-plan' && a.status !== 'invalidated').map((a) => String((a.content as JsonObject).sceneKey ?? a.key)));
    for (const scene of artifacts.filter((a) => a.type === 'scene-plan' && a.status !== 'invalidated')) {
      const content = scene.content as JsonObject;
      const chapterKey = String(content.chapterKey ?? '');
      if (!chapterKeys.has(chapterKey)) add(diagnostic('missing-chapter-brief', 'cross-link', 'error', `Scene '${scene.title}' references missing chapter '${chapterKey}'.`, [{ artifactId: scene.id }], [{ type: 'artifact', id: scene.id, key: scene.key }], 'Create or relink the chapter brief.'));
      for (const dependency of stringArray(content.dependencies)) if (!sceneKeys.has(dependency)) add(diagnostic('missing-scene-dependency', 'cross-link', 'error', `Scene '${scene.title}' depends on missing scene '${dependency}'.`, [{ artifactId: scene.id }], [{ type: 'artifact', id: scene.id, key: scene.key }], 'Relink the scene dependency.'));
    }
    const factsBySlot = group(state.canonFacts.filter((f) => f.status === 'canonical'), (f) => `${f.subjectType}:${f.subjectId}:${f.predicate}`);
    for (const facts of factsBySlot.values()) {
      for (let left = 0; left < facts.length; left += 1) for (let right = left + 1; right < facts.length; right += 1) {
        const first = facts[left]; const second = facts[right];
        if (stableStringify(first.object) !== stableStringify(second.object) && storyIntervalsOverlap(first, second)) add(diagnostic('canon-conflict', 'continuity', 'error', `Conflicting canonical values exist for ${first.subjectId}.${first.predicate}.`, [first.sourceSpan, second.sourceSpan].filter((span): span is StorySourceSpan => Boolean(span)), [first, second].map((fact) => ({ type: 'canon-fact', id: fact.id, key: fact.key })), 'Reconcile or time-bound the conflicting facts.'));
      }
    }
    const statesBySlot = group(state.entityStates.filter((s) => s.status === 'active'), (s) => `${s.entityType}:${s.entityId}:${s.stateKey}`);
    for (const values of statesBySlot.values()) {
      for (let left = 0; left < values.length; left += 1) for (let right = left + 1; right < values.length; right += 1) {
        const first = values[left]; const second = values[right];
        if (stableStringify(first.value) !== stableStringify(second.value) && storyIntervalsOverlap(first, second)) add(diagnostic('entity-state-conflict', 'continuity', 'error', `Entity '${first.entityId}' has conflicting '${first.stateKey}' state at the same story point.`, [first.sourceSpan, second.sourceSpan].filter((span): span is StorySourceSpan => Boolean(span)), [first, second].map((value) => ({ type: 'entity-state', id: value.id, key: value.key })), 'Close the prior state interval or reconcile the values.'));
      }
    }
    for (const setup of state.setupPayoffs.filter((item) => item.status !== 'invalidated' && item.status !== 'abandoned')) {
      if (setup.status === 'paid-off' && !setup.setupSceneId && !setup.setupArtifactId) add(diagnostic('payoff-without-setup', 'setup-payoff', 'error', `Payoff '${setup.title}' has no setup evidence.`, [], [{ type: 'setup-payoff', id: setup.id, key: setup.key }], 'Link an earlier setup scene or artifact.'));
      if (['setup', 'reinforced'].includes(setup.status) && !setup.payoffSceneId && !setup.payoffArtifactId) add(diagnostic('unpaid-setup', 'setup-payoff', 'warning', `Setup '${setup.title}' has no planned payoff.`, [], [{ type: 'setup-payoff', id: setup.id, key: setup.key }], 'Plan and link a payoff.'));
    }
    for (const loop of state.openLoops.filter((item) => item.status === 'resolved')) if (!loop.resolvedSceneId && !loop.resolvedArtifactId) add(diagnostic('resolution-without-evidence', 'setup-payoff', 'error', `Resolved loop '${loop.title}' has no resolution evidence.`, [], [{ type: 'open-loop', id: loop.id, key: loop.key }], 'Link the resolving scene or artifact.'));
    const taskIds = new Set(tasks.map((task) => task.id));
    for (const task of tasks) for (const dependency of task.dependencyIds) if (!taskIds.has(dependency)) add(diagnostic('missing-task-dependency', 'workflow', 'error', `Task '${task.key}' references missing dependency '${dependency}'.`, [], [{ type: 'build-task', id: task.id, key: task.key }], 'Repair the persisted task graph.'));
    if (hasCycle(tasks)) add(diagnostic('task-cycle', 'workflow', 'error', 'The BuildTask dependency graph contains a cycle.', [], [], 'Remove the circular dependency before resuming the build.'));
    return diagnostics.sort((a, b) => severityRank(b.severity) - severityRank(a.severity) || a.code.localeCompare(b.code));
  }

  private parseArtifactContent(type: StoryArtifactType, value: unknown): JsonObject {
    try { return validateArtifactContent(type, value); }
    catch (error) { throw new HttpError(400, `Invalid ${type} artifact`, error instanceof Error ? { message: error.message } : error); }
  }

  private allowedTaskArtifactTypes(task: BuildTask, authorizedTypes: readonly StoryArtifactType[]): StoryArtifactType[] {
    const criteria = task.acceptanceCriteria as JsonObject;
    const requiredTypes = stringArray(criteria.requiredArtifactTypes).filter((type): type is StoryArtifactType => ARTIFACT_TYPES.includes(type as StoryArtifactType));
    if (!requiredTypes.length) return [];
    return requiredTypes.filter((type) => authorizedTypes.includes(type));
  }

  private assertArtifactOutputScope(
    task: { id: string; type: string; scopeUnitIds: string[]; executionPolicy: Prisma.JsonValue },
    type: StoryArtifactType,
    content: JsonObject,
    bindings: NonNullable<import('@opentales/sdk').CreateStoryArtifactInput['bindings']>
  ) {
    const policy = isObject(task.executionPolicy as JsonValue) ? task.executionPolicy as JsonObject : {};
    const chapterKey = typeof policy.chapterKey === 'string' ? policy.chapterKey : null;
    const sceneKey = typeof policy.sceneKey === 'string' ? policy.sceneKey : null;
    if (chapterKey && typeof content.chapterKey === 'string' && content.chapterKey !== chapterKey) throw new HttpError(403, `Task is scoped to chapter '${chapterKey}'`);
    if (sceneKey && typeof content.sceneKey === 'string' && content.sceneKey !== sceneKey) throw new HttpError(403, `Task is scoped to scene '${sceneKey}'`);
    if (task.scopeUnitIds.length && type !== 'chapter-draft') {
      const boundUnitIds = bindings.filter((binding) => binding.bindingKind === 'build-unit' && binding.unitId).map((binding) => binding.unitId!);
      if (!boundUnitIds.length || boundUnitIds.some((id) => !task.scopeUnitIds.includes(id))) throw new HttpError(403, 'Scoped task outputs require an exact build-unit binding');
    }
  }

  private async assertArtifactNotPinned(tx: NovelBuildTx, buildRunId: string, artifactId: string) {
    const directive = await tx.buildDirective.findFirst({ where: { buildRunId }, orderBy: { createdAt: 'desc' }, select: { pinnedArtifactIds: true } });
    if (directive?.pinnedArtifactIds.includes(artifactId)) throw new HttpError(409, 'Artifact is pinned by the active re-plan directive; explicitly unpin it first');
  }

  private async createArtifactBindings(
    tx: NovelBuildTx,
    projectId: string,
    buildRunId: string,
    artifactId: string,
    taskId: string | null,
    bindings: NonNullable<import('@opentales/sdk').CreateStoryArtifactInput['bindings']>
  ) {
    if (bindings.length > 1_000) throw new HttpError(400, 'Artifact has too many bindings');
    for (const binding of bindings) {
      const role = required(binding.role, 'Binding role', 500);
      const kind = binding.bindingKind === 'build-unit' ? 'BUILD_UNIT' : binding.bindingKind === 'entity' ? 'ENTITY' : binding.bindingKind === 'ledger' ? 'LEDGER' : null;
      if (!kind) throw new HttpError(400, 'Unsupported artifact binding kind');
      if (kind === 'BUILD_UNIT') {
        if (!binding.unitId || binding.entityId || binding.entityType) throw new HttpError(400, 'Build-unit bindings require only unitId');
        const unit = await tx.buildManuscriptUnit.findFirst({ where: { id: binding.unitId, projectId, buildRunId }, select: { id: true } });
        if (!unit) throw new HttpError(400, 'Artifact binding unit does not belong to this build');
      } else {
        if (!binding.entityType || !binding.entityId || binding.unitId) throw new HttpError(400, 'Entity/ledger bindings require entityType and entityId');
        const allowed = kind === 'ENTITY'
          ? ['character', 'location', 'chapter', 'scene', 'build-unit', 'artifact']
          : ['canon-fact', 'entity-state', 'timeline-event', 'open-loop', 'setup-payoff', 'plot-thread'];
        if (!allowed.includes(binding.entityType)) throw new HttpError(400, `Unsupported ${binding.bindingKind} binding entityType '${binding.entityType}'`);
        await this.assertTypedReference(tx, projectId, buildRunId, { type: binding.entityType, id: binding.entityId });
      }
      await tx.storyArtifactBinding.create({ data: {
        projectId, buildRunId, artifactId, taskId, unitId: binding.unitId ?? null, bindingKind: kind,
        entityType: binding.entityType ?? null, entityId: binding.entityId ?? null, role
      } });
    }
  }

  private async validateArtifactEntityContract(
    tx: NovelBuildTx,
    projectId: string,
    buildRunId: string,
    artifact: { id: string; type: PrismaStoryArtifactType; content: Prisma.JsonValue }
  ) {
    if (artifact.type === 'CHAPTER_DRAFT') {
      const content = artifact.content as JsonObject;
      const branchId = typeof content.writingBranchId === 'string' ? content.writingBranchId : '';
      const versionId = typeof content.writingVersionId === 'string' ? content.writingVersionId : '';
      const branch = await tx.writingBranch.findFirst({ where: { id: branchId, buildRunId, writing: { projectId } }, select: { id: true, headVersionId: true } });
      if (!branch || branch.headVersionId !== versionId) throw new HttpError(409, 'Chapter draft provenance does not reference the current isolated build branch head');
      const binding = await tx.storyArtifactBinding.findFirst({ where: { artifactId: artifact.id, buildRunId, bindingKind: 'BUILD_UNIT', unit: { kind: 'CHAPTER' } } });
      if (!binding) throw new HttpError(409, 'Chapter draft requires a typed chapter-unit binding');
    }
  }

  private assertArtifactAllowed(allowedTypes: readonly StoryArtifactType[], type: StoryArtifactType) {
    if (!ARTIFACT_TYPES.includes(type) || !allowedTypes.includes(type)) throw new HttpError(403, `Build scope does not authorize ${type} artifacts`);
  }

  private async artifactForUpdate(tx: NovelBuildTx, projectId: string, buildRunId: string, artifactId: string, expectedVersion: number) {
    const artifact = await tx.storyArtifact.findFirst({ where: { id: artifactId, projectId, buildRunId } });
    if (!artifact) throw new HttpError(404, 'Story artifact not found');
    if (artifact.version !== expectedVersion) throw new HttpError(409, 'Story artifact version is stale', { expected: expectedVersion, actual: artifact.version });
    return artifact;
  }

  private async assertArtifactTask(tx: NovelBuildTx, buildRunId: string, taskId?: string | null) {
    if (taskId) await this.builds.getTask(tx, buildRunId, taskId);
  }

  private async assertStateSources(tx: NovelBuildTx, projectId: string, buildRunId: string, value: { sourceArtifactId?: string | null; sourceChapterId?: string | null; sourceSceneId?: string | null }) {
    if (value.sourceArtifactId) await this.assertRecord(tx.storyArtifact.findFirst({ where: { id: value.sourceArtifactId, projectId, buildRunId } }), 'Source artifact does not belong to this build');
    if (value.sourceChapterId) {
      const [chapter, unit] = await Promise.all([
        tx.chapter.findFirst({ where: { id: value.sourceChapterId, projectId, deletedAt: null }, select: { id: true } }),
        tx.buildManuscriptUnit.findFirst({ where: { id: value.sourceChapterId, projectId, buildRunId, kind: 'CHAPTER', invalidatedAt: null }, select: { id: true } })
      ]);
      if (!chapter && !unit) throw new HttpError(400, 'Source chapter does not belong to this project/build');
    }
    if (value.sourceSceneId) {
      const [scene, unit] = await Promise.all([
        tx.scene.findFirst({ where: { id: value.sourceSceneId, chapter: { projectId, deletedAt: null } }, select: { id: true } }),
        tx.buildManuscriptUnit.findFirst({ where: { id: value.sourceSceneId, projectId, buildRunId, kind: 'SCENE', invalidatedAt: null }, select: { id: true } })
      ]);
      if (!scene && !unit) throw new HttpError(400, 'Source scene does not belong to this project/build');
    }
  }

  private async assertRecord<T>(promise: Promise<T | null>, message: string) { if (!await promise) throw new HttpError(400, message); }

  private validateStateValue(value: unknown) { try { assertJsonValue(value); } catch (error) { throw new HttpError(400, error instanceof Error ? error.message : 'Story state is not valid JSON'); } }

  private async assertBuildAccess(userId: string, projectId: string, buildRunId: string) {
    await this.access.assertProjectAccess(userId, projectId);
    const build = await this.prisma.buildRun.findFirst({ where: { id: buildRunId, projectId }, select: { id: true } });
    if (!build) throw new HttpError(404, 'Novel Build not found');
  }
}

function artifactType(value: PrismaStoryArtifactType): StoryArtifactType {
  return value.toLowerCase().replaceAll('_', '-') as StoryArtifactType;
}

function assertRevision(actual: number, expected: number) {
  if (!Number.isInteger(expected) || expected < 0) throw new HttpError(400, 'expectedBuildRevision must be a non-negative integer');
  if (actual !== expected) throw new HttpError(409, 'Build revision is stale', { expected, actual });
}

function assertScopeCurrent(expiresAt?: string | null) { if (expiresAt && new Date(expiresAt) <= new Date()) throw new HttpError(403, 'Build authorization has expired'); }

function required(value: unknown, label: string, max: number): string { if (typeof value !== 'string' || !value.trim()) throw new HttpError(400, `${label} is required`); if (value.trim().length > max) throw new HttpError(400, `${label} is too long`); return value.trim(); }
function cleanNullable(value: unknown, max: number): string | null { if (value === null || value === undefined || value === '') return null; return required(value, 'Text value', max); }
function int(value: unknown, min: number, max: number, label: string): number { if (!Number.isInteger(value) || (value as number) < min || (value as number) > max) throw new HttpError(400, `${label} must be an integer between ${min} and ${max}`); return value as number; }
function optionalInt(value: unknown, min: number, max: number, label: string): number | null { return value === null || value === undefined ? null : int(value, min, max, label); }
function optionalNumber(value: unknown, min: number, max: number, label: string): number | null { if (value === null || value === undefined) return null; if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) throw new HttpError(400, `${label} must be between ${min} and ${max}`); return value; }
function bounded(value: unknown, min: number, max: number, label: string): number { const result = optionalNumber(value, min, max, label); if (result === null) throw new HttpError(400, `${label} is required`); return result; }
function date(value: unknown, label: string): Date { if (typeof value !== 'string') throw new HttpError(400, `${label} must be an ISO date`); const parsed = new Date(value); if (Number.isNaN(parsed.valueOf())) throw new HttpError(400, `${label} must be an ISO date`); return parsed; }
function assertJson(value: unknown): asserts value is JsonValue { try { assertJsonValue(value); } catch (error) { throw new HttpError(400, error instanceof Error ? error.message : 'Value must be valid JSON'); } }
function json(value: JsonValue): Prisma.InputJsonValue | typeof Prisma.JsonNull {
  assertJson(value);
  return value === null ? Prisma.JsonNull : value as Prisma.InputJsonValue;
}
function jsonNullable(value: JsonValue | null | undefined): Prisma.InputJsonValue | typeof Prisma.JsonNull | undefined { if (value === undefined) return undefined; if (value === null) return Prisma.JsonNull; return json(value); }
function unique(values: string[]): string[] { return [...new Set(values)]; }
function stringArray(value: JsonValue | undefined): string[] { return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []; }
function stringValue(value: JsonValue | undefined): string { return typeof value === 'string' ? value : ''; }
function isObject(value: JsonValue): value is JsonObject { return value !== null && typeof value === 'object' && !Array.isArray(value); }
function collectReferences(value: JsonValue): StoryReference[] { const refs: StoryReference[] = []; const walk = (node: JsonValue) => { if (Array.isArray(node)) return node.forEach(walk); if (isObject(node)) { if (typeof node.type === 'string' && typeof node.id === 'string') refs.push({ type: node.type, id: node.id, key: typeof node.key === 'string' ? node.key : undefined, label: typeof node.label === 'string' ? node.label : undefined }); Object.values(node).forEach(walk); } }; walk(value); return refs; }
function uniqueReferences(values: StoryReference[]): StoryReference[] { return [...new Map(values.map((value) => [`${value.type}:${value.id}`, value])).values()]; }
function downstream(tasks: BuildTask[], rootId: string): BuildTask[] { const ids = new Set([rootId]); let changed = true; while (changed) { changed = false; for (const task of tasks) if (!ids.has(task.id) && task.dependencyIds.some((id) => ids.has(id))) { ids.add(task.id); changed = true; } } return tasks.filter((task) => ids.has(task.id)); }
function group<T>(values: T[], key: (value: T) => string): Map<string, T[]> { const result = new Map<string, T[]>(); for (const value of values) result.set(key(value), [...(result.get(key(value)) ?? []), value]); return result; }
function storyIntervalsOverlap(
  left: { validFromOrder: number | null; validToOrder: number | null; validFromSceneId: string | null; storyOrder?: number | null },
  right: { validFromOrder: number | null; validToOrder: number | null; validFromSceneId: string | null; storyOrder?: number | null }
): boolean {
  const leftStart = left.validFromOrder ?? left.storyOrder ?? null;
  const rightStart = right.validFromOrder ?? right.storyOrder ?? null;
  if (leftStart !== null || rightStart !== null || left.validToOrder !== null || right.validToOrder !== null) {
    return (leftStart ?? Number.NEGATIVE_INFINITY) <= (right.validToOrder ?? Number.POSITIVE_INFINITY)
      && (rightStart ?? Number.NEGATIVE_INFINITY) <= (left.validToOrder ?? Number.POSITIVE_INFINITY);
  }
  if (left.validFromSceneId && right.validFromSceneId) return left.validFromSceneId === right.validFromSceneId;
  return !left.validFromSceneId && !right.validFromSceneId;
}
function diagnostic(code: string, category: StoryDiagnostic['category'], severity: StoryDiagnostic['severity'], message: string, evidence: StorySourceSpan[], relatedRefs: StoryReference[], suggestedResolution: string | null): Omit<StoryDiagnostic, 'id'> { return { code, category, severity, message, evidence, relatedRefs, suggestedResolution }; }
function severityRank(value: StoryDiagnostic['severity']): number { return value === 'error' ? 3 : value === 'warning' ? 2 : 1; }
function hasCycle(tasks: BuildTask[]): boolean { const byId = new Map(tasks.map((task) => [task.id, task])); const visiting = new Set<string>(); const visited = new Set<string>(); const visit = (id: string): boolean => { if (visiting.has(id)) return true; if (visited.has(id)) return false; visiting.add(id); for (const dependency of byId.get(id)?.dependencyIds ?? []) if (visit(dependency)) return true; visiting.delete(id); visited.add(id); return false; }; return tasks.some((task) => visit(task.id)); }
const SEARCH_FILTER_KEYS = new Set(['type', 'kind', 'pov', 'status', 'thread', 'location', 'after', 'before', 'chapter', 'scene', 'scene.goal', 'entity', 'knows', 'setup', 'severity', 'category', 'pass']);
function validateSearchFilters(value: SearchStoryInput['filters']): Record<string, string[]> {
  if (value === undefined) return {};
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new HttpError(400, 'Search filters must be an object');
  const entries = Object.entries(value);
  if (entries.length > 20) throw new HttpError(400, 'Too many search filters');
  const result: Record<string, string[]> = {};
  for (const [key, values] of entries) {
    if (!SEARCH_FILTER_KEYS.has(key)) throw new HttpError(400, `Unsupported search filter '${key}'`);
    if (!Array.isArray(values) || values.length < 1 || values.length > 50) throw new HttpError(400, `Search filter '${key}' must contain between 1 and 50 values`);
    result[key] = [...new Set(values.map((item) => required(item, `Search filter '${key}'`, 500)))];
  }
  return result;
}
function validateRegex(pattern: string) {
  if (pattern.length > 200) throw new HttpError(400, 'Regex queries are limited to 200 characters');
  const nestedQuantifier = /\((?:[^()]|\\.)*(?:[*+?]|\{\d+(?:,\d*)?\}|\|)(?:[^()]|\\.)*\)(?:[*+?]|\{\d+(?:,\d*)?\})/;
  if (/\\[1-9]|\(\?|(?:\*|\+|\{|\?){2,}/.test(pattern) || nestedQuantifier.test(pattern)) {
    throw new HttpError(400, 'Regex contains a potentially pathological or unsupported construct');
  }
  try { new RegExp(pattern); } catch { throw new HttpError(400, 'Invalid regular expression'); }
}

function parseSearchSyntax(raw: string): { query: string; filters: Record<string, string[]> } {
  const filters: Record<string, string[]> = {};
  let query = raw.replace(/(?:^|\s)(@character|[a-z][a-z.-]*):(?:"([^"]+)"|([^\s]+))/gi, (match, rawKey: string, quoted: string | undefined, bare: string | undefined) => {
    const key = rawKey.toLocaleLowerCase() === '@character' ? 'entity' : rawKey.toLocaleLowerCase();
    if (!SEARCH_FILTER_KEYS.has(key)) return match;
    const value = (quoted ?? bare ?? '').trim();
    if (value) filters[key] = [...(filters[key] ?? []), value];
    return ' ';
  });
  query = query.replace(/(?:^|\s)@([\p{L}\p{N}_-]+)/gu, (_match, value: string) => {
    filters.entity = [...(filters.entity ?? []), value];
    return ' ';
  });
  return { query: query.replace(/\s+/g, ' ').trim(), filters };
}
function encodeSearchCursor(offset: number): string { return `story-search-v1:${offset}`; }
function decodeSearchCursor(value: string): number {
  const match = /^story-search-v1:(\d+)$/.exec(value);
  if (!match) throw new HttpError(400, 'Invalid story search cursor');
  return int(Number(match[1]), 0, 1_000_000, 'cursor offset');
}
