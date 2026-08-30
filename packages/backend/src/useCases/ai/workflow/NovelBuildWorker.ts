import { randomUUID } from 'node:crypto';
import type { BuildRun, BuildTask, Prisma, PrismaClient } from '@prisma/client';
import { hasToolCall, stepCountIs, streamText, tool, type ToolSet } from 'ai';
import { z } from 'zod';
import type { JsonValue } from '@opentales/sdk';
import type { BuildTaskLease } from '@opentales/sdk';
import { NovelBuildUseCase } from '../../novelBuild/NovelBuildUseCase.js';
import { StoryStateUseCase } from '../../novelBuild/StoryStateUseCase.js';
import { BuildManuscriptUseCase } from '../../novelBuild/BuildManuscriptUseCase.js';
import {
  ARTIFACT_CONTENT_SCHEMAS,
  stableHash,
  validateArtifactContent
} from '../../novelBuild/schemas.js';
import { loadAiSkillCatalog, loadAiSkillReferences, type AiSkillCatalogItem } from '../markdownCatalog.js';
import { loadAiModelForProject, providerOptionsForAiModel } from '../aiModel.js';
import { isCodexModelAllowed } from '../codexModels.js';
import { ContextAssembler, estimateTokens } from '../context/ContextAssembler.js';
import { renderInferenceLayers } from '../prompts/layeredInference.js';
import { serializeUntrustedData } from '../prompts/untrustedData.js';
import {
  evaluationDisposition,
  runtimeRoleSchema,
  stepLimitForTask,
  taskContractSchema,
  type RuntimeRole,
  type TaskContract
} from '../runtime/taskContract.js';
import {
  calculateModelCostMicros,
  loadModelPricing,
  lookupModelPrice,
  parseModelPricing,
  type ModelPrice,
  type ModelPricingTable
} from '../runtime/modelPricing.js';
import { buildAgentTools, type AgentMutatingToolName } from '../tools/index.js';
import { runStoryLint } from '../tools/storyIntelligence.js';
import { registerBuildExecution } from './BuildExecutionRegistry.js';

const workerResultSchema = z.object({
  status: z.enum(['complete', 'blocked', 'failed']),
  decisions: z.array(z.object({ decision: z.string(), reason: z.string() })).max(100).default([]),
  artifactIds: z.array(z.string()).max(10_000).default([]),
  evidence: z.array(z.object({ type: z.string(), id: z.string().optional(), summary: z.string() })).max(5_000).default([]),
  checks: z.record(z.string(), z.boolean()).default({}),
  quality: z.record(z.string(), z.number().min(0).max(1)).default({}),
  unresolvedQuestions: z.array(z.string()).max(30).default([])
});
const judgeResultSchema = z.object({
  scores: z.record(z.string(), z.number().min(0).max(1)).refine((scores) => Object.keys(scores).length > 0, 'At least one rubric score is required'),
  feedback: z.string(),
  evidence: z.array(z.object({ type: z.string(), id: z.string().optional(), summary: z.string() })).max(200).default([])
});
const AGGREGATE_ARTIFACT_TASK_TYPES = new Set([
  'create-character-bibles',
  'create-plot-threads',
  'create-beats',
  'create-chapter-briefs',
  'create-scene-plans'
]);

type WorkerResult = z.infer<typeof workerResultSchema>;

export interface NovelBuildWorkerOptions {
  workerId?: string;
  leaseMs?: number;
  pollIntervalMs?: number;
  maxTasksPerSweep?: number;
  modelExecutor?: BuildModelExecutor;
  judgeExecutor?: BuildJudgeExecutor;
  buildRunIds?: string[];
  modelPricing?: ModelPricingTable;
  modelPricingLoader?: () => Promise<ModelPricingTable>;
  modelRouting?: Partial<Record<'fast' | 'balanced' | 'strong' | 'judge', string[]>>;
}

export interface BuildModelExecutorInput {
  resolveModel: (modelOverride?: string | null) => Promise<Parameters<typeof streamText>[0]['model']>;
  system: string;
  prompt: string;
  tools: ToolSet;
  stepLimit: number;
  contract: TaskContract;
  abortSignal: AbortSignal;
  defaultModelId?: string | null;
}

export interface BuildModelExecutorOutput {
  result: WorkerResult;
  inputTokens: number;
  outputTokens: number;
  toolCalls: unknown[];
  toolResults: unknown[];
  modelId?: string | null;
  usageByModel?: MeasuredModelUsage[];
}

export interface MeasuredModelUsage {
  modelId: string;
  inputTokens: number;
  outputTokens: number;
}

export type BuildModelExecutor = (input: BuildModelExecutorInput) => Promise<BuildModelExecutorOutput>;

export interface BuildJudgeExecutorInput {
  resolveModel: (modelOverride?: string | null) => Promise<Parameters<typeof streamText>[0]['model']>;
  contract: TaskContract;
  observableResult: WorkerResult;
  deterministicChecks: Record<string, boolean>;
  rubric: string;
  evidencePack: JudgeEvidencePack;
  abortSignal: AbortSignal;
}

export interface JudgeEvidencePack {
  artifacts: Array<{ id: string; type: string; key: string; title?: string; version: number; status: string; contentHash: string; content: string }>;
  artifactCoverage?: {
    scope: 'task-artifacts' | 'complete-planning-corpus';
    requestedCount: number;
    includedCount: number;
    omittedCount: number;
    countsByType: Record<string, number>;
    contentTruncatedCount: number;
  };
  units: Array<{ id: string; key: string; kind: string; headVersionId: string | null; baselineHeadVersionId: string | null; wordCount: number; body: string }>;
  diagnostics: Array<{ code: string; severity: string; message: string; evidence: unknown; relatedRefs: unknown }>;
  toolEvidence: { calls: unknown[]; results: unknown[] };
  provenance: { taskId: string; taskKey: string; attempt: number; revisionIteration: number; inputArtifactIds: string[]; outputArtifactIds: string[] };
  truncated: boolean;
}

export interface BuildJudgeExecutorOutput {
  result: z.infer<typeof judgeResultSchema>;
  inputTokens: number;
  outputTokens: number;
  modelId?: string | null;
}

export type BuildJudgeExecutor = (input: BuildJudgeExecutorInput) => Promise<BuildJudgeExecutorOutput>;

export interface NovelBuildWorkerHandle {
  readonly workerId: string;
  isRunning(): boolean;
  runNow(): Promise<number>;
  stop(): Promise<void>;
}

interface ClaimedTask {
  run: BuildRun;
  task: BuildTask;
  lease: BuildTaskLease;
  scopeUnitIds: string[];
  baselineUnitHeads: Record<string, string | null>;
}

interface TaskExecution {
  result: WorkerResult;
  traceId: string;
  trace: PendingTrace;
  contextArtifactIds: string[];
  inputTokens: number;
  outputTokens: number;
  latencyMs: number;
  toolCalls: unknown[];
  toolResults: unknown[];
}

interface PendingTrace {
  id: string;
  claimed: ClaimedTask;
  provider: string | null;
  model: string | null;
  retrievedArtifactIds: string[];
  contextTokenCount: number;
  startedAt: Date;
  price: ModelPrice | null;
  usageByModel: MeasuredModelUsage[];
}

interface SkillProvenancePin {
  name: string;
  version: string;
  source: 'built-in' | 'project-override';
  publisher: string;
  trust: 'built-in' | 'project-owner';
  contentHash: string;
  manifestHash: string;
  capabilities: string[];
  references: Array<{ name: string; contentHash: string }>;
}

const activeWorkers = new WeakMap<PrismaClient, NovelBuildWorker>();

/** Idempotent, explicitly started worker entrypoint. No import-time side effects. */
export function startNovelBuildWorker(
  prisma: PrismaClient,
  options: NovelBuildWorkerOptions = {}
): NovelBuildWorkerHandle {
  const existing = activeWorkers.get(prisma);
  if (existing) return existing;
  const worker = new NovelBuildWorker(prisma, options, () => activeWorkers.delete(prisma));
  activeWorkers.set(prisma, worker);
  worker.start();
  return worker;
}

export async function resumeRunnableBuilds(
  prisma: PrismaClient,
  options: NovelBuildWorkerOptions = {}
): Promise<number> {
  const worker = new NovelBuildWorker(prisma, options);
  return worker.resumeRunnableBuilds(options.maxTasksPerSweep);
}

export class NovelBuildWorker implements NovelBuildWorkerHandle {
  readonly workerId: string;
  private readonly builds: NovelBuildUseCase;
  private readonly storyState: StoryStateUseCase;
  private readonly leaseMs: number;
  private readonly pollIntervalMs: number;
  private readonly maxTasksPerSweep: number;
  private readonly modelExecutor: BuildModelExecutor;
  private readonly judgeExecutor: BuildJudgeExecutor;
  private readonly buildRunIds: Set<string> | null;
  private modelPricing: ModelPricingTable;
  private readonly modelPricingLoader: (() => Promise<ModelPricingTable>) | null;
  private readonly modelRouting: Partial<Record<'fast' | 'balanced' | 'strong' | 'judge', string[]>>;
  private timer: NodeJS.Timeout | null = null;
  private stopped = false;
  private sweep: Promise<number> | null = null;
  private readonly pendingTraces = new Map<string, PendingTrace>();
  private readonly abortController = new AbortController();

  constructor(
    private readonly prisma: PrismaClient,
    options: NovelBuildWorkerOptions = {},
    private readonly onStop?: () => void
  ) {
    this.workerId = options.workerId ?? `novel-worker:${process.pid}:${randomUUID()}`;
    this.builds = new NovelBuildUseCase(prisma);
    this.storyState = new StoryStateUseCase(prisma);
    this.leaseMs = clamp(options.leaseMs ?? 20 * 60_000, 30_000, 30 * 60_000);
    this.pollIntervalMs = clamp(options.pollIntervalMs ?? 5_000, 250, 60_000);
    this.maxTasksPerSweep = clamp(options.maxTasksPerSweep ?? 25, 1, 1_000);
    this.modelExecutor = options.modelExecutor ?? defaultModelExecutor;
    this.judgeExecutor = options.judgeExecutor ?? defaultJudgeExecutor;
    this.buildRunIds = options.buildRunIds?.length ? new Set(options.buildRunIds) : null;
    this.modelPricing = options.modelPricing ?? parseModelPricing();
    this.modelPricingLoader = options.modelPricing
      ? null
      : options.modelPricingLoader ?? (() => loadModelPricing());
    this.modelRouting = options.modelRouting ?? parseModelRouting(process.env.AI_MODEL_ROUTING_JSON);
  }

  start(): void {
    if (this.stopped || this.timer) return;
    this.schedule(0);
  }

  isRunning(): boolean {
    return !this.stopped && Boolean(this.timer || this.sweep);
  }

  async runNow(): Promise<number> {
    if (this.stopped) return 0;
    if (this.sweep) return this.sweep;
    this.sweep = this.resumeRunnableBuilds(this.maxTasksPerSweep).finally(() => {
      this.sweep = null;
    });
    return this.sweep;
  }

  async stop(): Promise<void> {
    this.stopped = true;
    this.abortController.abort();
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    await this.sweep?.catch(() => undefined);
    this.onStop?.();
  }

  async resumeRunnableBuilds(maxTasks = this.maxTasksPerSweep): Promise<number> {
    await this.refreshModelPricing();
    await this.refreshResolvablePricingPauses();
    await this.recoverStaleBuilds();
    let completed = 0;
    while (!this.stopped && completed < maxTasks) {
      await this.refreshModelPricing();
      const claimed = await this.claimNextTask();
      if (!claimed) break;
      await this.executeClaimedTask(claimed);
      completed += 1;
    }
    return completed;
  }

  private async refreshModelPricing(): Promise<void> {
    if (!this.modelPricingLoader) return;
    this.modelPricing = await this.modelPricingLoader();
  }

  private async refreshResolvablePricingPauses(): Promise<void> {
    const runs = await this.prisma.buildRun.findMany({
      where: {
        status: 'PAUSED',
        lastError: { contains: 'pricing is unknown' },
        ...(this.buildRunIds ? { id: { in: [...this.buildRunIds] } } : {})
      },
      take: 50
    });
    for (const run of runs) {
      const task = await this.prisma.buildTask.findFirst({
        where: { buildRunId: run.id, status: 'READY' },
        orderBy: [{ priority: 'desc' }, { createdAt: 'asc' }]
      });
      if (!task || await this.costBudgetBlockReason(run, task)) continue;
      await this.prisma.buildRun.updateMany({
        where: { id: run.id, status: 'PAUSED', lastError: { contains: 'pricing is unknown' } },
        data: {
          lastError: `Pricing for task ${task.key} is now available from the refreshed models.dev catalog. Resume the build to continue.`
        }
      });
    }
  }

  private schedule(delay: number): void {
    if (this.stopped) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.runNow().catch(() => 0).finally(() => this.schedule(this.pollIntervalMs));
    }, delay);
    this.timer.unref?.();
  }

  private async recoverStaleBuilds(): Promise<void> {
    const runs = await this.prisma.buildRun.findMany({
      where: { status: { in: ['PLANNING', 'DRAFTING', 'REVISING'] }, ...(this.buildRunIds ? { id: { in: [...this.buildRunIds] } } : {}) },
      select: { id: true, projectId: true, authorizedById: true, createdById: true, revision: true }
    });
    for (const run of runs) {
      const userId = run.authorizedById ?? run.createdById;
      if (!userId) continue;
      await this.builds.recover(userId, run.projectId, run.id, {
        idempotencyKey: `startup-recovery:${this.workerId}:${run.revision}`
      }).catch((error) => {
        if (!isSerializableConflict(error) && !isBuildGoneOrTerminal(error)) throw error;
        // Another process recovered/refreshed the same locked run.
      });
    }
  }

  private async claimNextTask(): Promise<ClaimedTask | null> {
    const candidates = await this.prisma.buildRun.findMany({
      where: { status: { in: ['PLANNING', 'DRAFTING', 'REVISING'] }, authorizedAt: { not: null }, tasks: { some: { status: 'READY' } }, ...(this.buildRunIds ? { id: { in: [...this.buildRunIds] } } : {}) },
      orderBy: { updatedAt: 'asc' },
      take: 20
    });

    for (const run of candidates) {
      // Assist mode remains interactive. Durable unattended workers execute
      // only an explicitly authorized plan-review/autonomous branch.
      if (run.autonomyMode === 'ASSIST') continue;
      const userId = run.authorizedById ?? run.createdById;
      if (!userId) continue;
      let nextTask = await this.prisma.buildTask.findFirst({ where: { buildRunId: run.id, status: 'READY' }, orderBy: [{ priority: 'desc' }, { createdAt: 'asc' }] });
      if (!nextTask) continue;
      nextTask = await this.pinTaskSkillProvenance(run, nextTask);
      if (!nextTask) continue;
      const budgetBlock = await this.costBudgetBlockReason(run, nextTask);
      if (budgetBlock) {
        await this.builds.pause(userId, run.projectId, run.id, {
          idempotencyKey: `cost-budget-pause:${run.id}:${run.revision}`,
          expectedRevision: run.revision,
          reason: budgetBlock
        }).catch((error) => {
          if (!isSerializableConflict(error) && !isBuildGoneOrTerminal(error)) throw error;
        });
        await this.prisma.buildRun.updateMany({
          where: { id: run.id, status: 'PAUSED' },
          data: { lastError: budgetBlock }
        });
        continue;
      }
      const reservation = await this.taskReservation(run, nextTask);
      const claimed = await this.builds.claim(userId, run.projectId, run.id, {
        idempotencyKey: `worker-claim:${this.workerId}:${randomUUID()}`,
        workerId: this.workerId,
        leaseMs: this.leaseMs,
        reserveTokens: reservation.tokens,
        reserveCostMicros: reservation.costMicros
      }).catch((error) => {
        if (isSerializableConflict(error) || isBuildGoneOrTerminal(error) || isReservationConflict(error)) return null;
        throw error;
      });
      if (claimed) {
        if (!claimed.lease) throw new Error(`Claimed task ${claimed.task.id} did not return a fencing lease`);
        const [prismaRun, prismaTask] = await Promise.all([
          this.prisma.buildRun.findUniqueOrThrow({ where: { id: run.id } }),
          this.prisma.buildTask.findUniqueOrThrow({ where: { id: claimed.task.id } })
        ]);
        const taskPolicy = jsonRecord(prismaTask.executionPolicy);
        const scopeUnitIds = uniqueStrings([
          ...prismaTask.scopeUnitIds,
          ...stringArray(taskPolicy.manuscriptUnitIds),
          ...stringArray(taskPolicy.unitIds),
          ...(typeof taskPolicy.unitId === 'string' ? [taskPolicy.unitId] : [])
        ]);
        const scopeUnits = scopeUnitIds.length
          ? await this.prisma.buildManuscriptUnit.findMany({ where: { id: { in: scopeUnitIds }, buildRunId: run.id }, include: { branch: true } })
          : [];
        return {
          run: prismaRun,
          task: prismaTask,
          lease: claimed.lease,
          scopeUnitIds,
          baselineUnitHeads: Object.fromEntries(scopeUnits.map((unit) => [unit.id, unit.branch.headVersionId]))
        };
      }
    }
    return null;
  }

  private async pinTaskSkillProvenance(run: BuildRun, task: BuildTask): Promise<BuildTask | null> {
    const pauseForProvenance = async (reason: string) => {
      await this.builds.pause(requiredUserId(run), run.projectId, run.id, {
        idempotencyKey: `skill-provenance-pause:${task.id}:${task.revision}`,
        expectedRevision: run.revision,
        reason
      }).catch((error) => {
        if (!isSerializableConflict(error) && !isBuildGoneOrTerminal(error)) throw error;
      });
      await this.prisma.buildRun.updateMany({ where: { id: run.id, status: 'PAUSED' }, data: { lastError: reason } });
    };
    let pins: SkillProvenancePin[];
    let upgradedVersions: Record<string, string>;
    let upgrades: BuiltInSkillUpgrade[];
    try {
      const catalog = await loadAiSkillCatalog(this.prisma, run.projectId);
      const resolved = resolveUntouchedBuiltInSkillUpgrades(
        catalog,
        jsonRecord(task.skillVersions),
        task
      );
      upgradedVersions = resolved.versions;
      upgrades = resolved.upgrades;
      pins = skillProvenancePins(catalog, upgradedVersions, run.projectId);
    } catch (error) {
      await pauseForProvenance(error instanceof Error ? error.message : 'Pinned skill provenance could not be resolved');
      return null;
    }
    const policy = jsonRecord(task.executionPolicy);
    if (upgrades.length) {
      const history = Array.isArray(policy.skillUpgradeHistory) ? policy.skillUpgradeHistory : [];
      const updated = await this.prisma.buildTask.updateMany({
        where: {
          id: task.id,
          buildRunId: run.id,
          status: 'READY',
          revision: task.revision,
          attempts: 0,
          startedAt: null,
          outputArtifactIds: { isEmpty: true }
        },
        data: {
          skillVersions: jsonSafe(upgradedVersions) as Prisma.InputJsonValue,
          executionPolicy: jsonSafe({
            ...policy,
            skillProvenance: pins,
            skillUpgradeHistory: [
              ...history,
              {
                source: 'built-in-publish',
                upgrades,
                upgradedAt: new Date().toISOString()
              }
            ]
          }) as Prisma.InputJsonValue,
          revision: { increment: 1 }
        }
      });
      if (updated.count !== 1) return null;
      return this.prisma.buildTask.findUniqueOrThrow({ where: { id: task.id } });
    }
    const existing = Array.isArray(policy.skillProvenance) ? policy.skillProvenance : null;
    if (existing && stableHash(existing) !== stableHash(pins)) {
      const reason = `Pinned skill provenance changed for task ${task.key}; publish a new skill version before rerunning.`;
      await pauseForProvenance(reason);
      return null;
    }
    if (existing) return task;
    const updated = await this.prisma.buildTask.updateMany({
      where: { id: task.id, buildRunId: run.id, status: 'READY', revision: task.revision },
      data: { executionPolicy: jsonSafe({ ...policy, skillProvenance: pins }) as Prisma.InputJsonValue, revision: { increment: 1 } }
    });
    if (updated.count !== 1) return null;
    return this.prisma.buildTask.findUniqueOrThrow({ where: { id: task.id } });
  }

  private async costBudgetBlockReason(run: BuildRun, task: BuildTask): Promise<string | null> {
    if (deterministicTask(task)) return null;
    const reservation = await this.taskReservation(run, task);
    if (run.maxTokens !== null) {
      const remainingTokens = Math.max(0, run.maxTokens - run.tokensUsed);
      if (reservation.tokens > remainingTokens) return `Token budget paused before task ${task.key}: required reservation ${reservation.tokens} exceeds remaining ${remainingTokens}.`;
    }
    const taskPolicy = jsonRecord(task.executionPolicy);
    if (typeof taskPolicy.maxCostMicros === 'number' && reservation.costMicros > taskPolicy.maxCostMicros) {
      return `Task cost policy paused before ${task.key}: maximum authorized task cost ${reservation.costMicros}µ exceeds task ceiling ${taskPolicy.maxCostMicros}µ.`;
    }
    const settings = await this.prisma.projectAiSettings.findUnique({ where: { projectId: run.projectId }, select: { model: true, providerKind: true } });
    const route = this.modelRoute(task);
    const modelId = route.preferred ?? settings?.model ?? null;
    const candidateModels = uniqueStrings([...(modelId ? [modelId] : []), ...route.fallbacks]);
    const unknownModel = candidateModels.find((candidate) => !lookupExecutionModelPrice(this.modelPricing, settings?.providerKind, candidate));
    if (!candidateModels.length || unknownModel) return `Cost budget cannot safely authorize task ${task.key}: pricing is unknown for model ${unknownModel ?? modelId ?? '(unconfigured)'}. OpenTales refreshes models.dev automatically; AI_MODEL_PRICING_JSON is available as an explicit sourced/versioned override.`;
    const judgeRequired = typeof jsonRecord(task.acceptanceCriteria).rubric === 'string' || task.qualityThreshold !== null;
    const judgeModelId = judgeRequired ? process.env.AI_JUDGE_MODEL?.trim() || modelId : null;
    if (judgeRequired && !lookupExecutionModelPrice(this.modelPricing, settings?.providerKind, judgeModelId)) return `Cost budget cannot safely authorize task ${task.key}: pricing is unknown for judge model ${judgeModelId ?? '(unconfigured)'}. OpenTales refreshes models.dev automatically; AI_MODEL_PRICING_JSON is available as an explicit sourced/versioned override.`;
    if (run.maxCostMicros === null) return null;
    const maximumTaskCost = reservation.costMicros;
    const remaining = Math.max(0, run.maxCostMicros - run.costMicrosUsed);
    return maximumTaskCost > remaining
      ? `Cost budget paused before task ${task.key}: maximum authorized task cost ${maximumTaskCost}µ exceeds remaining ${remaining}µ.`
      : null;
  }

  private async taskReservation(run: BuildRun, task: BuildTask): Promise<{ tokens: number; costMicros: number }> {
    if (deterministicTask(task)) return { tokens: 0, costMicros: 0 };
    const policy = jsonRecord(task.executionPolicy);
    const defaults = defaultTaskBudget(task);
    const judgeRequired = typeof jsonRecord(task.acceptanceCriteria).rubric === 'string' || task.qualityThreshold !== null;
    const inputTokens = numeric(policy.maxInputTokens, defaults.maxInputTokens);
    const outputTokens = numeric(policy.maxOutputTokens, defaults.maxOutputTokens);
    const judgeInputTokens = judgeRequired ? numeric(policy.maxInputTokens, defaults.maxInputTokens) : 0;
    const judgeOutputTokens = judgeRequired ? Math.min(4_000, numeric(policy.maxOutputTokens, defaults.maxOutputTokens)) : 0;
    const settings = await this.prisma.projectAiSettings.findUnique({ where: { projectId: run.projectId }, select: { model: true, providerKind: true } });
    const route = this.modelRoute(task);
    const modelId = route.preferred ?? settings?.model ?? null;
    const executionModels = uniqueStrings([...(modelId ? [modelId] : []), ...route.fallbacks]);
    const modelAttempts = Math.min(clamp(numeric(policy.modelMaxAttempts, task.maxAttempts), 1, task.maxAttempts), executionModels.length);
    const executionPrices = executionModels.slice(0, modelAttempts).map((candidate) => lookupExecutionModelPrice(this.modelPricing, settings?.providerKind, candidate)).filter((price): price is ModelPrice => Boolean(price));
    const judgeModelId = judgeRequired ? process.env.AI_JUDGE_MODEL?.trim() || modelId : null;
    const judgePrice = judgeRequired ? lookupExecutionModelPrice(this.modelPricing, settings?.providerKind, judgeModelId) : null;
    return {
      tokens: (inputTokens + outputTokens) * Math.max(1, modelAttempts) + judgeInputTokens + judgeOutputTokens,
      costMicros: executionPrices.reduce((sum, price) => sum + calculateModelCostMicros(price, inputTokens, outputTokens), 0)
        + (judgePrice ? calculateModelCostMicros(judgePrice, judgeInputTokens, judgeOutputTokens) : 0)
    };
  }

  private modelRoute(task: BuildTask): { tier: 'fast' | 'balanced' | 'strong' | 'judge'; preferred?: string; fallbacks: string[] } {
    const policy = jsonRecord(task.executionPolicy);
    const requestedTier = typeof policy.modelTier === 'string' && ['fast', 'balanced', 'strong', 'judge'].includes(policy.modelTier)
      ? policy.modelTier as 'fast' | 'balanced' | 'strong' | 'judge'
      : roleForTask(task.assignedAgent) === 'critic' ? 'judge' : 'balanced';
    const routed = this.modelRouting[requestedTier] ?? [];
    const preferred = typeof policy.model === 'string' ? policy.model : routed[0];
    const explicitFallbacks = stringArray(policy.fallbackModels);
    return { tier: requestedTier, preferred, fallbacks: uniqueStrings([...explicitFallbacks, ...routed.slice(preferred ? 1 : 0)]).filter((model) => model !== preferred) };
  }

  private async executeClaimedTask(claimed: ClaimedTask): Promise<void> {
    const controller = new AbortController();
    const abortFromWorker = () => controller.abort(this.abortController.signal.reason);
    this.abortController.signal.addEventListener('abort', abortFromWorker, { once: true });
    const policy = jsonRecord(claimed.task.executionPolicy);
    const maxDurationMs = clamp(numeric(policy.maxDurationMs, 15 * 60_000), 1_000, 24 * 60 * 60_000);
    const durationTimer = setTimeout(() => controller.abort(new Error(`Task exceeded maxDurationMs=${maxDurationMs}`)), maxDurationMs);
    durationTimer.unref?.();
    let settle!: () => void;
    const settled = new Promise<void>((resolve) => { settle = resolve; });
    const unregister = registerBuildExecution(
      {
        buildRunId: claimed.run.id,
        taskId: claimed.task.id,
        workerId: this.workerId,
        leaseToken: claimed.lease.leaseToken,
        leaseGeneration: claimed.lease.leaseGeneration
      },
      controller,
      settled
    );
    const stopHeartbeat = this.startTaskHeartbeat(claimed, controller);
    try {
      const execution = await raceWithAbort(
        deterministicExecutionTask(claimed.task)
          ? this.executeDeterministicTask(claimed)
          : this.executeModelTask(claimed, controller.signal),
        controller.signal
      );
      if (controller.signal.aborted) throw controller.signal.reason ?? new Error('Build task interrupted');
      await raceWithAbort(this.finalizeExecution(claimed, execution, controller.signal, stopHeartbeat), controller.signal);
    } catch (error) {
      await this.failOrRetry(claimed, error);
    } finally {
      await stopHeartbeat();
      clearTimeout(durationTimer);
      this.abortController.signal.removeEventListener('abort', abortFromWorker);
      settle();
      unregister();
    }
  }

  private startTaskHeartbeat(claimed: ClaimedTask, controller: AbortController): () => Promise<void> {
    let stopped = false;
    let running: Promise<void> | null = null;
    let sequence = 0;
    const beat = () => {
      if (stopped || controller.signal.aborted || running) return;
      sequence += 1;
      running = this.builds.heartbeat(requiredUserId(claimed.run), claimed.run.projectId, claimed.run.id, claimed.task.id, {
        idempotencyKey: `worker-heartbeat:${claimed.task.id}:${claimed.task.revision}:${sequence}`,
        workerId: this.workerId,
        leaseToken: claimed.lease.leaseToken,
        leaseGeneration: claimed.lease.leaseGeneration,
        runGeneration: claimed.lease.runGeneration,
        expectedRevision: claimed.task.revision,
        leaseMs: this.leaseMs,
        progress: Math.min(90, 5 + sequence)
      }).then((result) => {
        claimed.task.revision = result.task.revision;
      }).catch((error) => {
        controller.abort(error);
      }).finally(() => {
        running = null;
      });
    };
    const interval = setInterval(beat, Math.max(1_000, Math.min(30_000, Math.floor(this.leaseMs / 3))));
    interval.unref?.();
    return async () => {
      stopped = true;
      clearInterval(interval);
      await running?.catch(() => undefined);
    };
  }

  private async executeDeterministicTask(claimed: ClaimedTask): Promise<TaskExecution> {
    const started = Date.now();
    const trace = await this.startTrace(claimed, null, null, [], 0);
    let result: WorkerResult;
    let toolCalls: unknown[] = [];
    let toolResults: unknown[] = [];
    if (claimed.task.type === 'assemble-chapter-context' || claimed.task.type === 'assemble-scene-context') {
      const contract = await this.contractFor(claimed);
      const pack = await new ContextAssembler(this.prisma).assemble({ projectId: claimed.run.projectId, task: contract });
      result = {
        status: 'complete',
        decisions: [],
        artifactIds: [],
        evidence: pack.sections.map((section) => ({ type: 'context-section', summary: `${section.kind}: ${section.estimatedTokens} estimated tokens` })),
        checks: { contextPackRequired: pack.estimatedTokens > 0 },
        quality: {},
        unresolvedQuestions: []
      };
      trace.retrievedArtifactIds = pack.identifiers;
      trace.contextTokenCount = pack.estimatedTokens;
      return { result, traceId: trace.id, trace, contextArtifactIds: pack.identifiers, inputTokens: 0, outputTokens: 0, latencyMs: Date.now() - started, toolCalls: [], toolResults: [] };
    }
    if (claimed.task.type === 'quality-gate') {
      const policy = jsonRecord(claimed.task.executionPolicy);
      const chapterIds = stringArray(policy.chapterIds);
      const lint = await runStoryLint(this.prisma, claimed.run.projectId, {
        buildRunId: claimed.run.id,
        chapterIds,
        userId: requiredUserId(claimed.run)
      });
      const toolCallId = `deterministic:${claimed.task.id}:runStoryLint`;
      toolCalls = [{
        toolCallId,
        toolName: 'runStoryLint',
        input: { buildRunId: claimed.run.id, ...(chapterIds.length ? { chapterIds } : {}) }
      }];
      toolResults = [{
        toolCallId,
        toolName: 'runStoryLint',
        output: { counts: lint.counts, issues: lint.issues.slice(0, 100) }
      }];
      result = {
        status: 'complete',
        decisions: [],
        artifactIds: [],
        evidence: [
          { type: 'diagnostic-summary', summary: `runStoryLint completed with ${lint.counts.error} error(s) and ${lint.counts.warning} warning(s).` },
          ...lint.issues.slice(0, 100).map((issue: { code: string; message: string; evidence: Array<{ id: string }> }) => ({
            type: 'diagnostic',
            id: issue.evidence[0]?.id,
            summary: `${issue.code}: ${issue.message}`
          }))
        ],
        checks: { runtimeCriticEvidenceRequired: true },
        quality: { deterministicEvidenceCollected: 1 },
        unresolvedQuestions: []
      };
    } else if (claimed.task.type === 'run-chapter-diagnostics' || claimed.task.type === 'run-scene-diagnostics') {
      const policy = jsonRecord(claimed.task.executionPolicy);
      const lint = await runStoryLint(this.prisma, claimed.run.projectId, { buildRunId: claimed.run.id, chapterIds: stringArray(policy.chapterIds), userId: requiredUserId(claimed.run) });
      result = {
        status: lint.counts.error > 0 ? 'blocked' : 'complete',
        decisions: [],
        artifactIds: [],
        evidence: lint.issues.slice(0, 100).map((issue: { code: string; message: string; evidence: Array<{ id: string }> }) => ({ type: 'diagnostic', id: issue.evidence[0]?.id, summary: `${issue.code}: ${issue.message}` })),
        checks: { deterministicValidationRequired: lint.counts.error === 0 },
        quality: { deterministic: lint.counts.error === 0 ? 1 : 0 },
        unresolvedQuestions: lint.counts.error ? [`${lint.counts.error} error diagnostic(s) require correction`] : []
      };
    } else if (claimed.task.type === 'drafting-complete-barrier') {
      const checkpointTasks = await this.prisma.buildTask.findMany({ where: { buildRunId: claimed.run.id, key: { startsWith: 'chapter:', endsWith: ':checkpoint' } } });
      const passed = checkpointTasks.length > 0 && checkpointTasks.every((task) => task.status === 'DONE');
      result = basicResult(passed, 'allChapterCheckpointsRequired', passed ? 'All chapter checkpoints completed.' : 'Drafting barrier is waiting for every chapter checkpoint.');
    } else if (claimed.task.type === 'checkpoint') {
      result = { ...basicResult(true, 'checkpoint', `Checkpoint ${checkpointLabel(claimed.task)} is ready to commit atomically with task completion.`), evidence: [{ type: 'checkpoint', summary: checkpointLabel(claimed.task) }] };
      if (claimed.task.key === 'final-checkpoint') result.checks.final = true;
    } else if (claimed.task.type === 'export-preparation') {
      const exportManifest = await this.prisma.storyArtifact.findFirst({
        where: { buildRunId: claimed.run.id, type: 'EXPORT_MANIFEST', status: { in: ['VALIDATED', 'ACCEPTED'] }, invalidatedAt: null, exportCompilations: { some: { buildRunId: claimed.run.id } } },
        orderBy: { createdAt: 'desc' }
      });
      result = exportManifest
        ? { ...basicResult(true, 'exportManifestRequired', `Verified export manifest ${exportManifest.id}.`), artifactIds: [exportManifest.id], evidence: [{ type: 'export-manifest', id: exportManifest.id, summary: 'Real persisted export assets verified' }] }
        : {
          ...basicResult(false, 'exportManifestRequired', 'A real export service must register verified DOCUMENT assets and a validated export-manifest before this task can complete.'),
          unresolvedQuestions: ['No verified export manifest exists; external export generation and registration are required.']
        };
    } else if (claimed.task.type === 'compile-chapter-unit') {
      const run = await this.prisma.buildRun.findUniqueOrThrow({ where: { id: claimed.run.id } });
      const compilation = await new BuildManuscriptUseCase(this.prisma).compile(requiredUserId(claimed.run), claimed.run.projectId, claimed.run.id, {
        idempotencyKey: `worker-compile:${claimed.task.id}:${claimed.task.attempts}`,
        expectedBuildRevision: run.revision,
        lease: {
          taskId: claimed.task.id,
          workerId: this.workerId,
          leaseToken: claimed.lease.leaseToken,
          leaseGeneration: claimed.lease.leaseGeneration,
          runGeneration: claimed.lease.runGeneration
        }
      });
      result = {
        ...basicResult(true, 'compiledChapterRequired', `Created build compilation ${compilation.id}.`),
        artifactIds: compilation.chapterDraftArtifactIds,
        evidence: [{ type: 'build-compilation', id: compilation.id, summary: `${compilation.units.length} units; ${compilation.totalWordCount} words` }]
      };
    } else {
      result = basicResult(true, 'deterministic', `${claimed.task.type} completed deterministically.`);
    }
    return { result, traceId: trace.id, trace, contextArtifactIds: [], inputTokens: 0, outputTokens: 0, latencyMs: Date.now() - started, toolCalls, toolResults };
  }

  private async executeModelTask(claimed: ClaimedTask, abortSignal: AbortSignal): Promise<TaskExecution> {
    const started = Date.now();
    const contract = await this.contractFor(claimed);
    const role = roleForTask(claimed.task.assignedAgent);
    const skills = await loadAiSkillCatalog(this.prisma, claimed.run.projectId);
    const activeSkills = Object.entries(contract.skillVersions).map(([name, version]) => {
      const skill = skills.find((candidate) => candidate.name === name);
      if (!skill) throw new Error(`Pinned skill ${name}@${version} is unavailable`);
      if (skill.manifest.version !== version) throw new Error(`Pinned skill ${name}@${version} resolved to ${skill.manifest.version}`);
      if (!skill.manifest.runtimeRoles.includes(role)) throw new Error(`Skill ${name}@${version} does not authorize runtime role ${role}`);
      return skill;
    });
    const expectedSkillProvenance = jsonRecord(claimed.task.executionPolicy).skillProvenance;
    const actualSkillProvenance = skillProvenancePins(activeSkills, contract.skillVersions, claimed.run.projectId);
    if (!Array.isArray(expectedSkillProvenance) || stableHash(expectedSkillProvenance) !== stableHash(actualSkillProvenance)) {
      throw new Error('Selected skill provenance no longer matches the immutable task pin; publish a new skill version');
    }
    const contextSections = [...new Set(activeSkills.flatMap((skill) => skill.manifest.context.sections))];
    const skillTokenCount = activeSkills.reduce((sum, skill) => sum + estimateTokens(skill.content) + loadAiSkillReferences(skill).reduce((referenceSum, reference) => referenceSum + estimateTokens(reference.content), 0), 0);
    const directive = await this.prisma.buildDirective.findFirst({ where: { buildRunId: claimed.run.id }, orderBy: { createdAt: 'desc' } });
    const brainstormData = serializeUntrustedData('build-brainstorm', {
      storyText: boundedText(claimed.run.brainstorm, Math.min(48_000, Math.max(8_000, contract.budget.maxInputTokens)))
    });
    const ownerAuthority = JSON.stringify({
      objective: claimed.run.objective,
      buildTarget: jsonRecord(claimed.run.manifest).target ?? null,
      activeReplanDirective: directive ? {
        id: directive.id,
        directive: directive.directive,
        pinnedArtifactIds: directive.pinnedArtifactIds
      } : null
    }, null, 2);
    const contextTokenBudget = Math.min(
      Math.max(2_000, contract.budget.maxInputTokens - skillTokenCount - estimateTokens(brainstormData) - estimateTokens(ownerAuthority) - 6_000),
      ...activeSkills.map((skill) => skill.manifest.context.maxTokens)
    );
    const pack = await new ContextAssembler(this.prisma).assemble({
      projectId: claimed.run.projectId,
      task: contract,
      tokenBudget: contextTokenBudget,
      sectionKinds: contextSections
    });
    const inferencePack = {
      ...pack,
      text: [brainstormData, pack.text].filter(Boolean).join('\n\n'),
      estimatedTokens: pack.estimatedTokens + estimateTokens(brainstormData),
      tokenBudget: contextTokenBudget + estimateTokens(brainstormData)
    };
    const proceduralSkills = activeSkills.filter((skill) => skill.manifest.kind !== 'workflow');
    const capabilitySkills = proceduralSkills.length ? proceduralSkills : activeSkills;
    const skillAllowedTools = [...new Set(capabilitySkills.flatMap((skill) => skill.manifest.allowedTools))];
    const system = [
      renderInferenceLayers({
        role,
        task: contract,
        activeSkills: activeSkills.map((skill) => ({ manifest: skill.manifest, content: skill.content, references: loadAiSkillReferences(skill) })),
        contextPack: inferencePack,
        runtimeInstructions: 'You are a scoped creative worker inside the OpenTales durable Novel Build workflow.',
        userAuthority: ownerAuthority
      })
    ].join('\n\n');
    const preferredModel = contract.modelPolicy.preferred;
    const estimatedInputTokens = estimateTokens(system) + estimateTokens(contract.objective);
    if (estimatedInputTokens > contract.budget.maxInputTokens) throw new Error(`Assembled inference input ${estimatedInputTokens} exceeds maxInputTokens=${contract.budget.maxInputTokens}`);
    const projectModel = await this.prisma.projectAiSettings.findUnique({ where: { projectId: claimed.run.projectId }, select: { model: true, providerKind: true } });
    const trace = await this.startTrace(claimed, projectModel?.providerKind ?? null, preferredModel ?? projectModel?.model ?? null, inferencePack.identifiers, inferencePack.estimatedTokens);
    const approval = {
      handleApproval: async (toolName: AgentMutatingToolName, input: unknown, execute: () => Promise<unknown>) => {
        assertAuthorizedTool(claimed.run, toolName, input);
        await this.assertTaskToolPolicy(claimed, toolName, input);
        return execute();
      }
    };
    const tools = buildAgentTools(
      this.prisma,
      { projectId: claimed.run.projectId, userId: requiredUserId(claimed.run) },
      approval,
      { handleQuestion: async () => { throw new Error('Build task requires author input'); } },
      { handleTask: async () => { throw new Error('Durable build tasks must be scheduled in the persisted dependency graph'); } },
      [],
      {
        role,
        taskContract: contract,
        primary: false,
        skillAllowedTools,
        strictSkillTools: true,
        executionLease: {
          taskId: claimed.task.id,
          workerId: this.workerId,
          leaseToken: claimed.lease.leaseToken,
          leaseGeneration: claimed.lease.leaseGeneration,
          runGeneration: claimed.lease.runGeneration
        }
      }
    );
    assertRequiredTaskCapabilities(tools as Record<string, unknown>, claimed.task);
    const guardedTools = guardWorkerTools(
      tools as unknown as ToolSet,
      contract.budget.maxToolCalls,
      abortSignal,
      () => this.assertCurrentLease(claimed)
    );

    const generation = await this.modelExecutor({
      resolveModel: (modelOverride) => loadAiModelForProject(this.prisma, claimed.run.projectId, modelOverride ?? preferredModel),
      system,
      prompt: contract.objective,
      tools: guardedTools,
      stepLimit: stepLimitForTask(contract),
      contract,
      abortSignal,
      defaultModelId: projectModel?.model ?? null
    });
    trace.model = generation.modelId ?? trace.model;
    trace.price = lookupExecutionModelPrice(this.modelPricing, trace.provider, trace.model);
    if (!trace.model || !trace.price) throw attachExecutionUsage(new Error(`Executed model pricing is unknown for ${trace.model ?? '(unconfigured)'}`), generation.inputTokens, generation.outputTokens, trace.model);
    trace.usageByModel = normalizeMeasuredUsage(generation.usageByModel, trace.model, generation.inputTokens, generation.outputTokens);
    const authorizedModels = new Set(uniqueStrings([...(projectModel?.model ? [projectModel.model] : []), ...(contract.modelPolicy.preferred ? [contract.modelPolicy.preferred] : []), ...contract.modelPolicy.fallbacks]));
    if (trace.usageByModel.some((usage) => !authorizedModels.has(usage.modelId))) throw new Error('Provider usage reported a model outside the reserved route');
    const overrun = trace.usageByModel.find((usage) =>
      usage.inputTokens > contract.budget.maxInputTokens || usage.outputTokens > contract.budget.maxOutputTokens
    );
    if (overrun) {
      throw new Error(
        `Provider usage exceeded the task invocation limit `
        + `(inputTokens=${overrun.inputTokens}/${contract.budget.maxInputTokens}, `
        + `outputTokens=${overrun.outputTokens}/${contract.budget.maxOutputTokens})`
      );
    }
    const result = workerResultSchema.parse(generation.result);
    const inputTokens = generation.inputTokens;
    const outputTokens = generation.outputTokens;
    const toolCalls = generation.toolCalls.map(compactToolCall);
    const toolResults = generation.toolResults.map(compactToolResult);
    return { result, traceId: trace.id, trace, contextArtifactIds: inferencePack.identifiers, inputTokens, outputTokens, latencyMs: Date.now() - started, toolCalls, toolResults };
  }

  private async assertCurrentLease(claimed: ClaimedTask): Promise<void> {
    const current = await this.prisma.buildTask.findFirst({
      where: {
        id: claimed.task.id,
        buildRunId: claimed.run.id,
        status: 'RUNNING',
        leaseOwner: this.workerId,
        leaseToken: claimed.lease.leaseToken,
        leaseGeneration: claimed.lease.leaseGeneration,
        runGeneration: claimed.lease.runGeneration,
        leaseExpiresAt: { gt: new Date() },
        buildRun: { executionGeneration: claimed.lease.runGeneration, status: { in: ['PLANNING', 'DRAFTING', 'REVISING'] } }
      },
      select: { id: true }
    });
    if (!current) throw new Error(`Lease fence rejected stale worker ${this.workerId} for task ${claimed.task.id}`);
  }

  private async assertTaskToolPolicy(
    claimed: ClaimedTask,
    toolName: AgentMutatingToolName,
    input: unknown
  ): Promise<void> {
    if (toolName !== 'applyArtifactBatch') return;
    const operations = Array.isArray(jsonRecord(input).operations)
      ? jsonRecord(input).operations as unknown[]
      : [];
    if (['create-scene-plans', 'create-scene-plan-shard'].includes(claimed.task.type)
      && jsonRecord(claimed.task.acceptanceCriteria).exactChapterSceneKeysRequired === true) {
      const policy = jsonRecord(claimed.task.executionPolicy);
      const chapterNumber = typeof policy.chapterNumber === 'number' ? Math.trunc(policy.chapterNumber) : null;
      const chapterBriefs = await this.prisma.storyArtifact.findMany({
        where: {
          id: { in: claimed.task.inputArtifactIds },
          buildRunId: claimed.run.id,
          type: 'CHAPTER_BRIEF',
          invalidatedAt: null,
          status: { in: ['VALIDATED', 'ACCEPTED'] }
        }
      });
      const expected = new Map(chapterBriefs.flatMap((artifact) => {
        const content = jsonRecord(artifact.content);
        const number = typeof content.number === 'number' ? Math.trunc(content.number) : null;
        if (chapterNumber !== null && number !== chapterNumber) return [];
        const chapterKey = typeof content.chapterKey === 'string' ? content.chapterKey : '';
        return stringArray(content.sceneKeys).map((sceneKey, index) => [sceneKey, { chapterKey, ordinal: index + 1 }] as const);
      }));
      const proposed = operations
        .map(jsonRecord)
        .filter((operation) => operation.action === 'upsert' && operation.type === 'scene-plan');
      for (const operation of proposed) {
        const content = jsonRecord(operation.content);
        const sceneKey = typeof content.sceneKey === 'string' ? content.sceneKey : '';
        const required = expected.get(sceneKey);
        if (!required || content.chapterKey !== required.chapterKey || content.ordinal !== required.ordinal) {
          throw new Error(
            `Scene-plan '${sceneKey || '(missing sceneKey)'}' must use an exact chapter-brief sceneKey, chapterKey, and chapter-local ordinal`
          );
        }
      }
      const existing = await this.prisma.storyArtifact.findMany({
        where: {
          buildRunId: claimed.run.id,
          taskId: claimed.task.id,
          type: 'SCENE_PLAN',
          invalidatedAt: null,
          status: { in: ['DRAFT', 'VALIDATED', 'ACCEPTED'] }
        },
        select: { content: true }
      });
      const combinedKeys = new Set([
        ...existing.map((artifact) => String(jsonRecord(artifact.content).sceneKey ?? '')),
        ...proposed.map((operation) => String(jsonRecord(operation.content).sceneKey ?? ''))
      ].filter(Boolean));
      if ([...combinedKeys].some((sceneKey) => !expected.has(sceneKey)) || combinedKeys.size > expected.size) {
        throw new Error(`Scene-plan task may persist only its ${expected.size} chapter-brief sceneKeys`);
      }
      return;
    }
    if (claimed.task.type !== 'create-character-bibles') return;
    if (operations.length > 3) {
      throw new Error('Character-bible batches may contain at most 3 artifact operations');
    }
    const specs = Array.isArray(jsonRecord(claimed.run.manifest).artifactSpecs)
      ? jsonRecord(claimed.run.manifest).artifactSpecs as unknown[]
      : [];
    const characterSpec = specs.map(jsonRecord).find((spec) => spec.type === 'character-bible');
    const maximum = typeof characterSpec?.maxCount === 'number'
      ? Math.max(1, Math.trunc(characterSpec.maxCount))
      : 1;
    const current = await this.prisma.storyArtifact.findMany({
      where: {
        buildRunId: claimed.run.id,
        taskId: claimed.task.id,
        type: 'CHARACTER_BIBLE',
        invalidatedAt: null,
        status: { in: ['DRAFT', 'VALIDATED', 'ACCEPTED'] }
      },
      select: { key: true }
    });
    const existingKeys = new Set(current.map((artifact) => artifact.key));
    const newKeys = new Set(
      operations
        .map(jsonRecord)
        .filter((operation) => operation.action === 'upsert' && operation.type === 'character-bible')
        .map((operation) => typeof operation.key === 'string' ? operation.key : '')
        .filter((key) => key && !existingKeys.has(key))
    );
    if (current.length + newKeys.size > maximum) {
      throw new Error(
        `Character-bible manifest allows exactly ${maximum}; ${Math.max(0, maximum - current.length)} new artifact(s) remain`
      );
    }
  }

  private async finalizeExecution(
    claimed: ClaimedTask,
    execution: TaskExecution,
    abortSignal: AbortSignal,
    stopHeartbeat: () => Promise<void>
  ): Promise<void> {
    const validation = await this.validateTaskResult(claimed, execution);
    const acceptance = jsonRecord(claimed.task.acceptanceCriteria);
    const rubric = typeof acceptance.rubric === 'string' ? acceptance.rubric : null;
    const judge = rubric || claimed.task.qualityThreshold !== null
      ? await this.runIndependentJudge(claimed, execution, validation, rubric ?? 'task-quality-v1', abortSignal)
      : null;
    const score = judge?.score ?? (validation.passed ? 1 : 0);
    const disposition = execution.result.status === 'complete'
      ? evaluationDisposition(await this.contractFor(claimed), score, claimed.task.revisionIteration, validation.passed)
      : execution.result.status === 'blocked' ? 'escalate' : 'revise';
    await this.storyState.appendEvaluation(requiredUserId(claimed.run), claimed.run.projectId, claimed.run.id, {
      taskId: claimed.task.id,
      artifactId: execution.result.artifactIds[0] ?? null,
      idempotencyKey: `worker-eval:${claimed.task.id}:${claimed.task.attempts}:${claimed.task.revisionIteration}`,
      kind: 'deterministic',
      rubric: validation.rubric,
      rubricVersion: '1',
      scores: { aggregate: validation.passed ? 1 : 0 },
      checks: validation.checks,
      passed: validation.passed,
      threshold: claimed.task.qualityThreshold,
      feedback: validation.passed ? null : validation.feedback,
      evidence: execution.result.evidence
    }, { lease: {
      taskId: claimed.task.id,
      workerId: this.workerId,
      leaseToken: claimed.lease.leaseToken,
      leaseGeneration: claimed.lease.leaseGeneration,
      runGeneration: claimed.lease.runGeneration
    } });
    if (claimed.task.type === 'finalization' && disposition === 'accept') {
      const run = await this.prisma.buildRun.findUniqueOrThrow({ where: { id: claimed.run.id } });
      const compilation = await new BuildManuscriptUseCase(this.prisma).compile(requiredUserId(claimed.run), claimed.run.projectId, claimed.run.id, {
        idempotencyKey: `worker-final-compilation:${claimed.task.id}:${claimed.task.attempts}`,
        expectedBuildRevision: run.revision,
        lease: {
          taskId: claimed.task.id,
          workerId: this.workerId,
          leaseToken: claimed.lease.leaseToken,
          leaseGeneration: claimed.lease.leaseGeneration,
          runGeneration: claimed.lease.runGeneration
        }
      });
      execution.result.evidence.push({ type: 'build-compilation', id: compilation.id, summary: `Final compilation ${compilation.totalWordCount} words` });
    }
    await stopHeartbeat();
    const totalInputTokens = execution.trace.usageByModel.reduce((sum, usage) => sum + usage.inputTokens, 0);
    const totalOutputTokens = execution.trace.usageByModel.reduce((sum, usage) => sum + usage.outputTokens, 0);
    const totalCostMicros = costForMeasuredUsage(this.modelPricing, execution.trace.usageByModel, execution.trace.provider);
    await this.storyState.finishTrace(requiredUserId(claimed.run), claimed.run.projectId, claimed.run.id, execution.traceId, {
      lease: {
        taskId: claimed.task.id,
        workerId: this.workerId,
        leaseToken: claimed.lease.leaseToken,
        leaseGeneration: claimed.lease.leaseGeneration,
        runGeneration: claimed.lease.runGeneration
      },
      requestHash: stableHash({ result: execution.result, validation, judge: judge?.result ?? null, toolCalls: execution.toolCalls, toolResults: execution.toolResults }),
      status: 'completed',
      provider: execution.trace.provider,
      model: execution.trace.model,
      modelParameters: traceModelParameters(execution.trace.claimed.task, execution.trace.price),
      toolCalls: jsonSafe(execution.toolCalls) as JsonValue,
      toolResults: jsonSafe(execution.toolResults) as JsonValue,
      outputs: jsonSafe({ candidate: execution.result, judge: judge?.result ?? null }) as JsonValue,
      validatorResults: jsonSafe(validation) as JsonValue,
      inputTokens: totalInputTokens,
      outputTokens: totalOutputTokens,
      costMicros: totalCostMicros,
      latencyMs: execution.latencyMs,
      retries: Math.max(0, claimed.task.attempts - 1),
      completionState: execution.result.status,
      error: null,
      completedAt: new Date().toISOString()
    });
    this.pendingTraces.delete(claimed.task.id);
    if (abortSignal.aborted) throw abortSignal.reason ?? new Error('Build task interrupted');
    if (execution.result.status === 'blocked') {
      const reason = execution.result.unresolvedQuestions.join('\n') || validation.feedback || 'Build task reached a true external blocker';
      const failed = await this.builds.fail(requiredUserId(claimed.run), claimed.run.projectId, claimed.run.id, claimed.task.id, {
        idempotencyKey: `worker-blocked:${claimed.task.id}:${claimed.task.attempts}`,
        workerId: this.workerId,
        leaseToken: claimed.lease.leaseToken,
        leaseGeneration: claimed.lease.leaseGeneration,
        runGeneration: claimed.lease.runGeneration,
        expectedRevision: claimed.task.revision,
        error: reason,
        retryable: true
      });
      await this.builds.pause(requiredUserId(claimed.run), claimed.run.projectId, claimed.run.id, {
        idempotencyKey: `worker-blocked-pause:${claimed.task.id}:${failed.buildRun.revision}`,
        expectedRevision: failed.buildRun.revision,
        reason
      });
      await this.prisma.buildRun.updateMany({ where: { id: claimed.run.id, status: 'PAUSED' }, data: { lastError: reason } });
      return;
    }
    if (claimed.task.type === 'quality-gate' && disposition !== 'accept') {
      const graph = await this.prisma.buildTask.findMany({ where: { buildRunId: claimed.run.id } });
      const byId = new Map(graph.map((task) => [task.id, task]));
      const ancestorIds = new Set<string>();
      const pending = [...claimed.task.dependencyIds];
      while (pending.length) {
        const id = pending.pop()!;
        if (ancestorIds.has(id)) continue;
        ancestorIds.add(id);
        pending.push(...(byId.get(id)?.dependencyIds ?? []));
      }
      const revisionTask = graph
        .filter((task) => ancestorIds.has(task.id) && /revision|revis/i.test(task.type) && task.scopeUnitIds.some((unitId) => claimed.task.scopeUnitIds.includes(unitId)))
        .sort((left, right) => right.createdAt.getTime() - left.createdAt.getTime())[0];
      if (revisionTask && revisionTask.revisionIteration < revisionTask.maxRevisionIterations) {
        const failed = await this.builds.fail(requiredUserId(claimed.run), claimed.run.projectId, claimed.run.id, claimed.task.id, {
          idempotencyKey: `quality-gate-revise:${claimed.task.id}:${claimed.task.attempts}`,
          workerId: this.workerId,
          leaseToken: claimed.lease.leaseToken,
          leaseGeneration: claimed.lease.leaseGeneration,
          runGeneration: claimed.lease.runGeneration,
          expectedRevision: claimed.task.revision,
          error: 'Independent judge requested the bounded revision task.',
          retryable: true
        });
        await this.builds.rerun(requiredUserId(claimed.run), claimed.run.projectId, claimed.run.id, revisionTask.id, {
          idempotencyKey: `quality-gate-rerun-revision:${revisionTask.id}:${revisionTask.revisionIteration}`,
          expectedRevision: failed.buildRun.revision,
          reason: 'Independent regrade requested bounded revision.'
        }, { waitForAbort: false });
        return;
      }
      await this.markTaskFailed(claimed, validation.feedback || judge?.result.feedback || 'Independent quality gate failed after exhausting the bounded revision budget');
      return;
    }
    // A critic stage records the independent score as its diagnostic output.
    // A low score is not accepted as quality: completing this diagnostic node
    // deliberately unblocks its downstream reviser, whose output is regraded at
    // the later quality gate. Quality-gate tasks themselves never use this path.
    const diagnosticCriticStage = roleForTask(claimed.task.assignedAgent) === 'critic'
      && claimed.task.type !== 'quality-gate'
      && validation.passed;
    if (disposition === 'accept' || diagnosticCriticStage) {
      await this.builds.complete(requiredUserId(claimed.run), claimed.run.projectId, claimed.run.id, claimed.task.id, {
        idempotencyKey: `worker-complete:${claimed.task.id}:${claimed.task.attempts}:${claimed.task.revisionIteration}`,
        workerId: this.workerId,
        leaseToken: claimed.lease.leaseToken,
        leaseGeneration: claimed.lease.leaseGeneration,
        runGeneration: claimed.lease.runGeneration,
        expectedRevision: claimed.task.revision,
        outputArtifactIds: execution.result.artifactIds,
        result: jsonSafe({ traceId: execution.traceId, evaluation: validation, result: execution.result }) as JsonValue,
        qualityScore: score
      });
      return;
    }

    if (disposition === 'revise' && claimed.task.revisionIteration < claimed.task.maxRevisionIterations) {
      await this.builds.fail(requiredUserId(claimed.run), claimed.run.projectId, claimed.run.id, claimed.task.id, {
        idempotencyKey: `worker-revise:${claimed.task.id}:${claimed.task.attempts}:${claimed.task.revisionIteration}`,
        workerId: this.workerId,
        leaseToken: claimed.lease.leaseToken,
        leaseGeneration: claimed.lease.leaseGeneration,
        runGeneration: claimed.lease.runGeneration,
        expectedRevision: claimed.task.revision,
        error: validation.feedback || 'Quality gate requested one bounded revision',
        retryable: true
      });
      return;
    }

    await this.markTaskFailed(claimed, validation.feedback || execution.result.unresolvedQuestions.join('\n') || 'Task did not pass its acceptance gate');
  }

  private async runIndependentJudge(
    claimed: ClaimedTask,
    execution: TaskExecution,
    validation: { passed: boolean; checks: Record<string, boolean>; rubric: string; feedback: string },
    rubric: string,
    abortSignal: AbortSignal
  ): Promise<{ score: number; inputTokens: number; outputTokens: number; modelId: string; result: z.infer<typeof judgeResultSchema> }> {
    const contract = await this.contractFor(claimed);
    const settings = await this.prisma.projectAiSettings.findUnique({ where: { projectId: claimed.run.projectId }, select: { model: true, providerKind: true } });
    const judgeModelId = process.env.AI_JUDGE_MODEL?.trim() || contract.modelPolicy.preferred || settings?.model || null;
    const configuredJudgePrice = lookupExecutionModelPrice(this.modelPricing, settings?.providerKind, judgeModelId);
    if (!judgeModelId || !configuredJudgePrice) {
      throw attachExecutionUsage(new Error(`Executed judge model pricing is unknown for ${judgeModelId ?? '(unconfigured)'}`), 0, 0, judgeModelId);
    }
    execution.trace.provider ??= settings?.providerKind ?? null;
    execution.trace.model ??= judgeModelId;
    execution.trace.price ??= configuredJudgePrice;
    const evidencePack = await this.buildJudgeEvidencePack(claimed, execution, contract.budget.maxInputTokens);
    let judged: BuildJudgeExecutorOutput;
    try {
      judged = await this.judgeExecutor({
        resolveModel: (modelOverride) => loadAiModelForProject(this.prisma, claimed.run.projectId, modelOverride ?? judgeModelId),
        contract,
        observableResult: { ...execution.result, checks: {}, quality: {} },
        deterministicChecks: validation.checks,
        rubric,
        evidencePack,
        abortSignal
      });
    } catch (error) {
      const usage = executionErrorUsage(error);
      throw attachExecutionUsage(error, usage.inputTokens ?? 0, usage.outputTokens ?? 0, usage.modelId ?? judgeModelId, usage.usageByModel);
    }
    const actualJudgeModelId = judged.modelId ?? judgeModelId;
    const actualJudgePrice = lookupExecutionModelPrice(this.modelPricing, settings?.providerKind, actualJudgeModelId);
    if (!actualJudgeModelId || !actualJudgePrice) {
      throw attachExecutionUsage(new Error(`Executed judge model pricing is unknown for ${actualJudgeModelId ?? '(unconfigured)'}`), judged.inputTokens, judged.outputTokens, actualJudgeModelId);
    }
    execution.trace.model = actualJudgeModelId;
    execution.trace.price = actualJudgePrice;
    const judgeUsage = normalizeMeasuredUsage(undefined, actualJudgeModelId, judged.inputTokens, judged.outputTokens)[0];
    execution.trace.usageByModel.push(judgeUsage);
    if (judgeUsage.inputTokens > contract.budget.maxInputTokens || judgeUsage.outputTokens > contract.budget.maxOutputTokens) {
      const error = new Error(
        `Independent judge usage exceeded the task invocation limit `
        + `(inputTokens=${judgeUsage.inputTokens}/${contract.budget.maxInputTokens}, `
        + `outputTokens=${judgeUsage.outputTokens}/${contract.budget.maxOutputTokens})`
      );
      Object.assign(error, { providerUsageComplete: true });
      throw error;
    }
    const parsed = judgeResultSchema.parse(judged.result);
    const requiredDimensions = rubricDimensions(rubric);
    const missingDimensions = requiredDimensions.filter((dimension) => parsed.scores[dimension] === undefined);
    if (missingDimensions.length) throw new Error(`Independent judge omitted rubric dimensions: ${missingDimensions.join(', ')}`);
    const score = average(requiredDimensions.map((dimension) => parsed.scores[dimension]));
    await this.storyState.appendEvaluation(requiredUserId(claimed.run), claimed.run.projectId, claimed.run.id, {
      taskId: claimed.task.id,
      artifactId: execution.result.artifactIds[0] ?? null,
      idempotencyKey: `worker-model-eval:${claimed.task.id}:${claimed.task.attempts}:${claimed.task.revisionIteration}`,
      kind: 'model',
      rubric,
      rubricVersion: '1',
      scores: { aggregate: score, ...parsed.scores },
      checks: validation.checks,
      passed: validation.passed && score >= (claimed.task.qualityThreshold ?? contract.qualityGate.minimumScore),
      threshold: claimed.task.qualityThreshold ?? contract.qualityGate.minimumScore,
      feedback: parsed.feedback,
      evidence: [...parsed.evidence, { type: 'trace', id: execution.traceId, summary: 'Candidate execution trace judged independently' }]
    }, { lease: {
      taskId: claimed.task.id,
      workerId: this.workerId,
      leaseToken: claimed.lease.leaseToken,
      leaseGeneration: claimed.lease.leaseGeneration,
      runGeneration: claimed.lease.runGeneration
    } });
    return { score, inputTokens: judgeUsage.inputTokens, outputTokens: judgeUsage.outputTokens, modelId: actualJudgeModelId, result: parsed };
  }

  private async buildJudgeEvidencePack(claimed: ClaimedTask, execution: TaskExecution, maxInputTokens: number): Promise<JudgeEvidencePack> {
    const completePlanningCorpus = claimed.task.key === 'planning-quality-gate';
    const artifactIds = uniqueStrings([...claimed.task.inputArtifactIds, ...execution.result.artifactIds]);
    const [artifacts, units, diagnostics] = await Promise.all([
      completePlanningCorpus
        ? this.prisma.storyArtifact.findMany({
          where: {
            buildRunId: claimed.run.id,
            invalidatedAt: null,
            status: { in: ['VALIDATED', 'ACCEPTED'] },
            task: { phase: 'planning', status: 'DONE' }
          },
          orderBy: [{ type: 'asc' }, { key: 'asc' }]
        })
        : artifactIds.length
        ? this.prisma.storyArtifact.findMany({ where: { id: { in: artifactIds }, buildRunId: claimed.run.id, invalidatedAt: null }, orderBy: [{ type: 'asc' }, { key: 'asc' }] })
        : Promise.resolve([]),
      claimed.task.scopeUnitIds.length
        ? this.prisma.buildManuscriptUnit.findMany({ where: { id: { in: claimed.task.scopeUnitIds }, buildRunId: claimed.run.id, invalidatedAt: null }, orderBy: [{ kind: 'asc' }, { containerKey: 'asc' }, { order: 'asc' }], include: { branch: { include: { headVersion: true } } } })
        : Promise.resolve([]),
      this.storyState.diagnostics(requiredUserId(claimed.run), claimed.run.projectId, claimed.run.id)
    ]);
    const maximumCharacters = judgeEvidenceCharacterBudget(maxInputTokens, completePlanningCorpus);
    const artifactCharacters = Math.floor(maximumCharacters * (completePlanningCorpus ? 0.78 : 0.3));
    const unitCharacters = Math.floor(maximumCharacters * (completePlanningCorpus ? 0 : 0.45));
    const diagnosticCharacters = Math.floor(maximumCharacters * 0.15);
    const toolCharacters = maximumCharacters - artifactCharacters - unitCharacters - diagnosticCharacters;
    const artifactLimit = perItemLimit(artifactCharacters, artifacts.length, 300, 8_000);
    const unitLimit = perItemLimit(unitCharacters, units.length, 300, 12_000);
    const diagnosticLimit = perItemLimit(diagnosticCharacters, diagnostics.diagnostics.length * 3, 200, 2_000);
    const toolLimit = perItemLimit(toolCharacters, execution.toolCalls.length + execution.toolResults.length, 200, 2_000);
    const artifactContent = artifacts.map((artifact) => ({
      artifact,
      serialized: JSON.stringify(artifact.content),
      limit: completePlanningCorpus ? completePlanningArtifactLimit(prismaArtifactType(artifact.type)) : artifactLimit
    }));
    const countsByType = Object.fromEntries([...new Set(artifacts.map((artifact) => prismaArtifactType(artifact.type)))].sort().map((type) => [
      type,
      artifacts.filter((artifact) => prismaArtifactType(artifact.type) === type).length
    ]));
    const pack: JudgeEvidencePack = {
      artifacts: artifactContent.map(({ artifact, serialized, limit }) => ({
        id: artifact.id,
        type: prismaArtifactType(artifact.type),
        key: artifact.key,
        title: artifact.title,
        version: artifact.version,
        status: artifact.status.toLowerCase(),
        contentHash: artifact.contentHash,
        content: boundedText(serialized, limit)
      })),
      artifactCoverage: {
        scope: completePlanningCorpus ? 'complete-planning-corpus' : 'task-artifacts',
        requestedCount: completePlanningCorpus ? artifacts.length : artifactIds.length,
        includedCount: artifacts.length,
        omittedCount: Math.max(0, (completePlanningCorpus ? artifacts.length : artifactIds.length) - artifacts.length),
        countsByType,
        contentTruncatedCount: artifactContent.filter(({ serialized, limit }) => serialized.length > limit).length
      },
      units: units.map((unit) => ({
        id: unit.id,
        key: unit.key,
        kind: unit.kind.toLowerCase(),
        headVersionId: unit.branch.headVersionId,
        baselineHeadVersionId: claimed.baselineUnitHeads[unit.id] ?? null,
        wordCount: unit.branch.headVersion?.wordCount ?? 0,
        body: boundedText(unit.branch.headVersion?.body ?? '', unitLimit)
      })),
      diagnostics: diagnostics.diagnostics.map((diagnostic) => ({
        code: diagnostic.code,
        severity: diagnostic.severity,
        message: boundedText(diagnostic.message, diagnosticLimit),
        evidence: observableValue(diagnostic.evidence, 0, diagnosticLimit),
        relatedRefs: observableValue(diagnostic.relatedRefs, 0, diagnosticLimit)
      })),
      toolEvidence: {
        calls: execution.toolCalls.slice(0, 1_000).map((value) => observableValue(value, 0, toolLimit)),
        results: execution.toolResults.slice(0, 1_000).map((value) => observableValue(value, 0, toolLimit))
      },
      provenance: {
        taskId: claimed.task.id,
        taskKey: claimed.task.key,
        attempt: claimed.task.attempts,
        revisionIteration: claimed.task.revisionIteration,
        inputArtifactIds: claimed.task.inputArtifactIds,
        outputArtifactIds: execution.result.artifactIds
      },
      truncated: artifactContent.some(({ serialized, limit }) => serialized.length > limit)
        || units.some((unit) => (unit.branch.headVersion?.body?.length ?? 0) > unitLimit)
        || diagnostics.diagnostics.some((diagnostic) => diagnostic.message.length > diagnosticLimit)
        || execution.toolCalls.length > 1_000
        || execution.toolResults.length > 1_000
    };
    return pack;
  }

  private async failOrRetry(claimed: ClaimedTask, error: unknown): Promise<void> {
    const failure = executionFailureDisposition(error);
    const message = failure.message;
    await this.failPendingTrace(claimed, message, error).catch(() => undefined);
    const current = await this.prisma.buildTask.findUnique({ where: { id: claimed.task.id } });
    if (!current || current.status !== 'RUNNING') return;
    await this.builds.fail(requiredUserId(claimed.run), claimed.run.projectId, claimed.run.id, current.id, {
      idempotencyKey: `worker-error:${current.id}:${current.attempts}:${current.revision}`,
      workerId: this.workerId,
      leaseToken: claimed.lease.leaseToken,
      leaseGeneration: claimed.lease.leaseGeneration,
      runGeneration: claimed.lease.runGeneration,
      expectedRevision: current.revision,
      error: message,
      retryable: failure.retryable && current.attempts < current.maxAttempts
    }).catch((failure) => {
      if (!isBuildGoneOrTerminal(failure)) throw failure;
    });
  }

  private async markTaskFailed(claimed: ClaimedTask, message: string): Promise<void> {
    const task = await this.prisma.buildTask.findUniqueOrThrow({ where: { id: claimed.task.id } });
    await this.builds.fail(requiredUserId(claimed.run), claimed.run.projectId, claimed.run.id, task.id, {
      idempotencyKey: `worker-failed:${task.id}:${task.attempts}:${task.revisionIteration}`,
      workerId: this.workerId,
      leaseToken: claimed.lease.leaseToken,
      leaseGeneration: claimed.lease.leaseGeneration,
      runGeneration: claimed.lease.runGeneration,
      expectedRevision: task.revision,
      error: message,
      retryable: false
    }).catch((failure) => {
      if (!isBuildGoneOrTerminal(failure)) throw failure;
    });
  }

  private async contractFor(claimed: ClaimedTask): Promise<TaskContract> {
    const policy = jsonRecord(claimed.task.executionPolicy);
    const acceptance = jsonRecord(claimed.task.acceptanceCriteria);
    const requiredArtifactTypes = stringArray(acceptance.requiredArtifactTypes);
    const directive = await this.prisma.buildDirective.findFirst({ where: { buildRunId: claimed.run.id }, orderBy: { createdAt: 'desc' } });
    const inputArtifactIds = uniqueStrings([...claimed.task.inputArtifactIds, ...(directive?.pinnedArtifactIds ?? [])]);
    const inputArtifacts = await this.prisma.storyArtifact.findMany({
      where: { id: { in: inputArtifactIds }, buildRunId: claimed.run.id },
      select: { id: true, type: true }
    });
    const runScope = jsonRecord(claimed.run.authorizationScope);
    const role = roleForTask(claimed.task.assignedAgent);
    const modelRoute = this.modelRoute(claimed.task);
    const configuredModel = !modelRoute.preferred && claimed.task.type === 'create-story-brief'
      ? await this.prisma.projectAiSettings.findUnique({
        where: { projectId: claimed.run.projectId },
        select: { providerKind: true, model: true }
      })
      : null;
    const preferredModel = preferredStoryIntakeModel(
      claimed.task.type,
      configuredModel?.providerKind ?? null,
      configuredModel?.model ?? null,
      modelRoute.preferred
    );
    const chapterIds = stringArray(policy.chapterIds).length
      ? stringArray(policy.chapterIds)
      : role === 'reviser' ? stringArray(runScope.chapterIds) : [];
    const sceneIds = stringArray(policy.sceneIds).length
      ? stringArray(policy.sceneIds)
      : role === 'reviser' ? stringArray(runScope.sceneIds) : [];
    const targetSceneUnit = claimed.scopeUnitIds.length === 1
      ? await this.prisma.buildManuscriptUnit.findFirst({
        where: { id: claimed.scopeUnitIds[0], buildRunId: claimed.run.id, kind: 'SCENE', invalidatedAt: null },
        include: { parentUnit: { select: { order: true } } }
      })
      : null;
    const criterionEntries = Object.entries(acceptance);
    const scopedContinuationRole = ['critic', 'reviser'].includes(role) && claimed.scopeUnitIds.length > 1;
    const defaults = defaultTaskBudget(claimed.task);
    const maxToolCalls = numeric(
      policy.maxToolCalls,
      scopedContinuationRole ? Math.min(1_000, claimed.scopeUnitIds.length + 32) : defaults.maxToolCalls
    );
    return taskContractSchema.parse({
      objective: typeof policy.objective === 'string'
        ? policy.objective
        : objectiveForTask(claimed.task, claimed.run.objective, claimed.run.manifest),
      dependencies: claimed.task.dependencyIds,
      inputs: inputArtifacts.map((artifact) => ({ type: prismaArtifactType(artifact.type), id: artifact.id })),
      outputs: requiredArtifactTypes.length
        ? requiredArtifactTypes.map((type, index) => ({ type, name: `${claimed.task.key}:${index + 1}`, schemaVersion: 1 }))
        : [{ type: outputTypeForTask(claimed.task), name: claimed.task.key, schemaVersion: 1 }],
      acceptanceCriteria: criterionEntries.length
        ? criterionEntries.map(([id, value]) => ({ id, description: criterionDescription(id, value), check: id === 'rubric' ? 'rubric' : 'deterministic' }))
        : [{ id: 'task-complete', description: `${claimed.task.type} completes with persisted evidence.` }],
      budget: {
        maxInputTokens: numeric(policy.maxInputTokens, defaults.maxInputTokens),
        maxOutputTokens: numeric(policy.maxOutputTokens, defaults.maxOutputTokens),
        maxToolCalls,
        maxDurationMs: numeric(policy.maxDurationMs, defaults.maxDurationMs),
        maxCostUsd: typeof policy.maxCostMicros === 'number' ? policy.maxCostMicros / 1_000_000 : undefined
      },
      modelPolicy: {
        preferred: preferredModel,
        fallbacks: modelRoute.fallbacks,
        tier: modelRoute.tier
      },
      retryPolicy: {
        maxAttempts: Math.min(claimed.task.maxAttempts, numeric(policy.modelMaxAttempts, claimed.task.maxAttempts)),
        backoffMs: numeric(policy.backoffMs, 1_000),
        retryOn: stringArray(policy.retryOn).filter((value): value is 'transient' | 'timeout' | 'validation' | 'quality' => ['transient', 'timeout', 'validation', 'quality'].includes(value)).length
          ? stringArray(policy.retryOn).filter((value): value is 'transient' | 'timeout' | 'validation' | 'quality' => ['transient', 'timeout', 'validation', 'quality'].includes(value))
          : ['transient']
      },
      qualityGate: {
        minimumScore: claimed.task.qualityThreshold ?? 0.8,
        maxRevisions: claimed.task.maxRevisionIterations,
        requiredChecks: criterionEntries.filter(([, value]) => value === true).map(([key]) => key)
      },
      scope: {
        buildRunId: claimed.run.id,
        buildTaskId: claimed.task.id,
        manuscriptUnitIds: claimed.scopeUnitIds,
        chapterIds,
        sceneIds,
        artifactIds: inputArtifactIds,
        allowSupportingArtifacts: true
      },
      skillVersions: jsonRecord(claimed.task.skillVersions),
      metadata: {
        taskKey: claimed.task.key,
        taskType: claimed.task.type,
        phase: claimed.task.phase,
        attempt: claimed.task.attempts,
        revisionIteration: claimed.task.revisionIteration,
        baselineUnitHeads: claimed.baselineUnitHeads,
        targetStoryOrder: targetSceneUnit ? (targetSceneUnit.parentUnit?.order ?? 0) * 10_000 + targetSceneUnit.order : null,
        unitContinuationBatches: scopedContinuationRole ? chunkStrings(claimed.scopeUnitIds, 12) : [],
        directiveId: directive?.id ?? null,
        pinnedArtifactIds: directive?.pinnedArtifactIds ?? [],
        skillProvenance: policy.skillProvenance ?? [],
        shard: {
          shardIndex: policy.shardIndex ?? null,
          startOrdinal: policy.startOrdinal ?? null,
          count: policy.count ?? null,
          total: policy.total ?? null,
          chapterNumber: policy.chapterNumber ?? null
        },
        artifactSchemas: Object.fromEntries(requiredArtifactTypes.map((type) => {
          const schema = ARTIFACT_CONTENT_SCHEMAS[type as keyof typeof ARTIFACT_CONTENT_SCHEMAS];
          return [type, schema ? z.toJSONSchema(schema) : null];
        }))
      }
    });
  }

  private async validateTaskResult(claimed: ClaimedTask, execution: TaskExecution) {
    const result = execution.result;
    const acceptance = jsonRecord(claimed.task.acceptanceCriteria);
    const requiredTypes = stringArray(acceptance.requiredArtifactTypes);
    const requiredKeys = stringArray(acceptance.requiredArtifactKeys);
    const artifacts = result.artifactIds.length ? await this.prisma.storyArtifact.findMany({ where: { id: { in: result.artifactIds }, buildRunId: claimed.run.id, invalidatedAt: null } }) : [];
    const checks: Record<string, boolean> = {};
    const runtimeCriticEvidenceRequired = roleForTask(claimed.task.assignedAgent) === 'critic' && !deterministicTask(claimed.task);
    if (runtimeCriticEvidenceRequired) {
      const evidenceTools = new Set(['searchStory', 'findReferences', 'getSceneContext', 'queryCanon', 'queryTimeline', 'queryEntityState', 'queryOpenLoops', 'getArcState', 'compareVersions', 'getBuildState', 'listBuildUnits', 'readBuildUnit', 'runStoryLint']);
      checks.runtimeCriticEvidenceRequired = hasRuntimeCriticEvidence(execution.toolCalls, execution.toolResults, evidenceTools);
    }
    if (requiredTypes.length) {
      for (const type of requiredTypes) {
        const matching = artifacts.filter((artifact) => prismaArtifactType(artifact.type) === type && (type === 'export-manifest' || artifact.taskId === claimed.task.id));
        checks[`artifact:${type}`] = matching.length > 0 && matching.every((artifact) => ['VALIDATED', 'ACCEPTED'].includes(artifact.status));
        for (const artifact of matching) {
          try {
            validateArtifactContent(type as Parameters<typeof validateArtifactContent>[0], artifact.content);
          } catch {
            checks[`schema:${artifact.id}`] = false;
          }
          if (type === 'chapter-draft') {
            const content = jsonRecord(artifact.content);
            const branchId = typeof content.writingBranchId === 'string' ? content.writingBranchId : null;
            const versionId = typeof content.writingVersionId === 'string' ? content.writingVersionId : null;
            checks[`writing-binding:${artifact.id}`] = Boolean(branchId && versionId && await this.prisma.writingVersion.findFirst({
              where: { id: versionId, branchId, branch: { buildRunId: claimed.run.id } },
              select: { id: true }
            }));
          }
        }
      }
    }
    const artifactSpecs = Array.isArray(jsonRecord(claimed.run.manifest).artifactSpecs)
      ? jsonRecord(claimed.run.manifest).artifactSpecs as unknown[]
      : [];
    for (const rawSpec of artifactSpecs) {
      const spec = jsonRecord(rawSpec);
      const type = typeof spec.type === 'string' ? spec.type : '';
      if (!requiredTypes.includes(type)) continue;
      const aggregateProducer = AGGREGATE_ARTIFACT_TASK_TYPES.has(claimed.task.type);
      const explicitMinimum = typeof acceptance.minOutputCount === 'number'
        ? Math.max(0, Math.trunc(acceptance.minOutputCount))
        : null;
      const minimum = explicitMinimum
        ?? (aggregateProducer && typeof spec.minCount === 'number' ? Math.max(0, Math.trunc(spec.minCount)) : 1);
      const explicitMaximum = typeof acceptance.maxOutputCount === 'number'
        ? Math.max(minimum, Math.trunc(acceptance.maxOutputCount))
        : null;
      const maximum = explicitMaximum
        ?? (aggregateProducer && typeof spec.maxCount === 'number' ? Math.max(minimum, Math.trunc(spec.maxCount)) : 1);
      const count = artifacts.filter((artifact) =>
        prismaArtifactType(artifact.type) === type &&
        (type === 'export-manifest' || artifact.taskId === claimed.task.id) &&
        ['VALIDATED', 'ACCEPTED'].includes(artifact.status)
      ).length;
      checks[`artifact-count:${type}`] = count >= minimum && count <= maximum;
    }
    for (const key of requiredKeys) checks[`artifact-key:${key}`] = artifacts.some((artifact) => artifact.key === key && artifact.taskId === claimed.task.id && ['VALIDATED', 'ACCEPTED'].includes(artifact.status));
    if (acceptance.exactChapterSceneKeysRequired === true) {
      const policy = jsonRecord(claimed.task.executionPolicy);
      const chapterNumber = typeof policy.chapterNumber === 'number' ? Math.trunc(policy.chapterNumber) : null;
      const chapterBriefs = await this.prisma.storyArtifact.findMany({
        where: {
          id: { in: claimed.task.inputArtifactIds },
          buildRunId: claimed.run.id,
          type: 'CHAPTER_BRIEF',
          invalidatedAt: null,
          status: { in: ['VALIDATED', 'ACCEPTED'] }
        }
      });
      const expectedScenes = chapterBriefs.flatMap((artifact) => {
        const content = jsonRecord(artifact.content);
        const number = typeof content.number === 'number' ? Math.trunc(content.number) : null;
        if (chapterNumber !== null && number !== chapterNumber) return [];
        const chapterKey = typeof content.chapterKey === 'string' ? content.chapterKey : '';
        return stringArray(content.sceneKeys).map((sceneKey, index) => ({ sceneKey, chapterKey, ordinal: index + 1 }));
      });
      const actualScenes = artifacts
        .filter((artifact) => artifact.type === 'SCENE_PLAN')
        .map((artifact) => {
          const content = jsonRecord(artifact.content);
          return {
            sceneKey: typeof content.sceneKey === 'string' ? content.sceneKey : '',
            chapterKey: typeof content.chapterKey === 'string' ? content.chapterKey : '',
            ordinal: typeof content.ordinal === 'number' ? Math.trunc(content.ordinal) : null
          };
        });
      const actualByKey = new Map(actualScenes.map((scene) => [scene.sceneKey, scene]));
      checks.exactChapterSceneKeysRequired = expectedScenes.length > 0
        && expectedScenes.length === actualScenes.length
        && new Set(actualScenes.map((scene) => scene.sceneKey)).size === actualScenes.length
        && expectedScenes.every((expected) => {
          const actual = actualByKey.get(expected.sceneKey);
          return actual?.chapterKey === expected.chapterKey && actual.ordinal === expected.ordinal;
        });
    }
    if (acceptance.requiresPassingEvaluation === true) {
      // The current task is independently judged after deterministic validation.
      // Completion additionally requires the persisted passing MODEL evaluation.
      checks.requiresPassingEvaluation = true;
    }
    if (acceptance.contextPackRequired === true) checks.contextPackRequired = execution.contextArtifactIds.length > 0;
    if (acceptance.checkpoint === true) checks.checkpoint = deterministicTask(claimed.task);
    if (acceptance.final === true) {
      checks.final = claimed.task.key === 'final-checkpoint' && await this.builds.repository.transaction(async (tx) => {
        try {
          await this.builds.validateBuildCompletenessInTransaction(tx, claimed.run.id, { requireExport: true });
          return true;
        } catch {
          return false;
        }
      });
    }
    if (acceptance.allChapterCheckpointsRequired === true) {
      const chapterCheckpoints = await this.prisma.buildTask.findMany({
        where: { buildRunId: claimed.run.id, key: { startsWith: 'chapter:', endsWith: ':checkpoint' } },
        select: { status: true }
      });
      checks.allChapterCheckpointsRequired = chapterCheckpoints.length > 0 && chapterCheckpoints.every((task) => task.status === 'DONE');
    }
    if (acceptance.deterministicValidationRequired === true) {
      if (['aggregate-beats', 'aggregate-scene-plans'].includes(claimed.task.type)) {
        checks.deterministicValidationRequired = await this.validatePlanningAggregateCandidate(claimed);
      } else {
        const policy = jsonRecord(claimed.task.executionPolicy);
        const lint = await runStoryLint(this.prisma, claimed.run.projectId, {
          buildRunId: claimed.run.id,
          chapterIds: stringArray(policy.chapterIds),
          userId: requiredUserId(claimed.run)
        });
        checks.deterministicValidationRequired = lint.counts.error === 0;
      }
    }
    if (acceptance.canonDeltaRequired === true) {
      const sourceUnitIds = claimed.task.scopeUnitIds;
      const [facts, states, events, loops] = await Promise.all([
        this.prisma.canonFact.count({ where: { buildRunId: claimed.run.id, sourceTaskId: claimed.task.id, isCurrent: true, invalidatedAt: null } }),
        this.prisma.entityState.count({ where: { buildRunId: claimed.run.id, sourceTaskId: claimed.task.id, isCurrent: true, invalidatedAt: null } }),
        this.prisma.timelineEvent.count({ where: { buildRunId: claimed.run.id, sourceTaskId: claimed.task.id, isCurrent: true, invalidatedAt: null } }),
        this.prisma.openLoop.count({ where: { buildRunId: claimed.run.id, sourceTaskId: claimed.task.id, isCurrent: true, invalidatedAt: null } })
      ]);
      checks.canonDeltaRequired = sourceUnitIds.length > 0 && facts + states + events + loops > 0;
    }
    if (acceptance.manuscriptUnitDraftRequired === true) {
      const units = await this.prisma.buildManuscriptUnit.findMany({
        where: { id: { in: claimed.task.scopeUnitIds }, buildRunId: claimed.run.id, invalidatedAt: null },
        include: { branch: { include: { headVersion: true } } }
      });
      checks.manuscriptUnitDraftRequired = units.length === claimed.task.scopeUnitIds.length
        && units.length > 0
        && units.every((unit) => Boolean(unit.branch.headVersionId && unit.branch.headVersion?.body?.trim() && unit.branch.headVersionId !== claimed.baselineUnitHeads[unit.id]));
    }
    const runtimeRevisionHeadChangeRequired = roleForTask(claimed.task.assignedAgent) === 'reviser' && claimed.task.scopeUnitIds.length > 0;
    if (acceptance.boundedRevision === true || acceptance.finalManuscriptRequired === true || runtimeRevisionHeadChangeRequired) {
      const units = claimed.task.scopeUnitIds.length
        ? await this.prisma.buildManuscriptUnit.findMany({ where: { id: { in: claimed.task.scopeUnitIds }, buildRunId: claimed.run.id, invalidatedAt: null }, include: { branch: true } })
        : [];
      const checkName = acceptance.finalManuscriptRequired === true ? 'finalManuscriptRequired' : acceptance.boundedRevision === true ? 'boundedRevision' : 'runtimeRevisionHeadChanged';
      checks[checkName] = units.length > 0 && units.every((unit) => unit.branch.headVersionId && unit.branch.headVersionId !== claimed.baselineUnitHeads[unit.id]);
    }
    if (acceptance.exportManifestRequired === true) {
      checks.exportManifestRequired = Boolean(await this.prisma.buildCompilation.findFirst({
        where: { buildRunId: claimed.run.id, exportManifestArtifactId: { not: null } },
        orderBy: { createdAt: 'desc' }
      }));
    }
    if (acceptance.compiledChapterRequired === true) {
      const compilation = await this.prisma.buildCompilation.findFirst({
        where: { buildRunId: claimed.run.id, units: { some: { unitId: { in: claimed.task.scopeUnitIds } } } },
        orderBy: { createdAt: 'desc' },
        include: { units: true }
      });
      const compiledUnitIds = new Set(compilation?.units.map((unit) => unit.unitId) ?? []);
      checks.compiledChapterRequired = claimed.task.scopeUnitIds.length > 0 && claimed.task.scopeUnitIds.every((unitId) => compiledUnitIds.has(unitId));
    }
    const requiredCheckNames = Object.entries(acceptance).filter(([, value]) => value === true).map(([key]) => key);
    const passed = result.status === 'complete'
      && requiredTypes.every((type) => checks[`artifact:${type}`] === true)
      && requiredKeys.every((key) => checks[`artifact-key:${key}`] === true)
      && (!runtimeRevisionHeadChangeRequired || Object.entries(checks).some(([name, value]) => ['finalManuscriptRequired', 'boundedRevision', 'runtimeRevisionHeadChanged'].includes(name) && value))
      && (!runtimeCriticEvidenceRequired || checks.runtimeCriticEvidenceRequired === true)
      && !Object.entries(checks).some(([name, value]) => name.startsWith('writing-binding:') && value === false)
      && !Object.entries(checks).some(([name, value]) => name.startsWith('artifact-count:') && value === false)
      && requiredCheckNames.every((name) => checks[name] === true)
      && !Object.entries(checks).some(([name, value]) => name.startsWith('schema:') && value === false);
    const failed = Object.entries(checks).filter(([, value]) => !value).map(([name]) => name);
    return {
      passed,
      checks,
      rubric: typeof acceptance.rubric === 'string' ? acceptance.rubric : 'task-contract-v1',
      feedback: failed.length ? `Failed checks: ${failed.join(', ')}` : result.unresolvedQuestions.join('\n')
    };
  }

  private async validatePlanningAggregateCandidate(claimed: ClaimedTask): Promise<boolean> {
    const run = await this.prisma.buildRun.findUniqueOrThrow({ where: { id: claimed.run.id }, select: { manifest: true } });
    const manifest = jsonRecord(run.manifest);
    const target = jsonRecord(manifest.target);
    const expected = typeof target.targetSceneCount === 'number' ? target.targetSceneCount : null;
    const artifactType = claimed.task.type === 'aggregate-beats' ? 'BEAT' : 'SCENE_PLAN';
    const artifacts = await this.prisma.storyArtifact.findMany({
      where: { buildRunId: claimed.run.id, type: artifactType, status: { in: ['VALIDATED', 'ACCEPTED'] }, invalidatedAt: null },
      select: { key: true, content: true }
    });
    if (expected !== null && artifacts.length !== expected) return false;
    const contentKey = claimed.task.type === 'aggregate-beats' ? 'beatKey' : 'sceneKey';
    const keys = artifacts.map((artifact) => jsonRecord(artifact.content)[contentKey]);
    return keys.every((key): key is string => typeof key === 'string' && key.length > 0) && new Set(keys).size === keys.length;
  }

  private async startTrace(claimed: ClaimedTask, provider: string | null, model: string | null, retrievedArtifactIds: string[], contextTokenCount: number): Promise<PendingTrace> {
    const idempotencyKey = `worker-trace:${claimed.task.id}:${claimed.task.attempts}:${claimed.task.revisionIteration}`;
    const startedAt = new Date();
    const price = lookupExecutionModelPrice(this.modelPricing, provider, model);
    const saved = await this.storyState.startTrace(
      requiredUserId(claimed.run),
      claimed.run.projectId,
      claimed.run.id,
      {
        taskId: claimed.task.id,
        workerId: this.workerId,
        leaseToken: claimed.lease.leaseToken,
        leaseGeneration: claimed.lease.leaseGeneration,
        runGeneration: claimed.lease.runGeneration
      },
      {
        taskId: claimed.task.id,
        idempotencyKey,
        attempt: claimed.task.attempts,
        provider,
        model,
        modelParameters: traceModelParameters(claimed.task, price, model),
        workflowVersion: claimed.run.workflowVersion,
        systemPromptVersion: 'layered-v1',
        skillVersions: jsonSafe({
          versions: jsonRecord(claimed.task.skillVersions),
          provenance: jsonRecord(claimed.task.executionPolicy).skillProvenance ?? []
        }) as JsonValue,
        toolSchemaVersions: { storyIntelligence: 2, buildWorkflow: 2 },
        inputs: { taskKey: claimed.task.key, taskType: claimed.task.type, dependencyIds: claimed.task.dependencyIds, inputArtifactIds: claimed.task.inputArtifactIds, scopeUnitIds: claimed.task.scopeUnitIds },
        retrievedArtifactIds,
        contextTokenCount,
        startedAt: startedAt.toISOString()
      }
    );
    const trace: PendingTrace = {
      id: saved.id,
      claimed,
      provider,
      model,
      retrievedArtifactIds,
      contextTokenCount,
      startedAt,
      price,
      usageByModel: []
    };
    this.pendingTraces.set(claimed.task.id, trace);
    return trace;
  }

  private async failPendingTrace(claimed: ClaimedTask, message: string, error: unknown): Promise<void> {
    const trace = this.pendingTraces.get(claimed.task.id);
    if (!trace) return;
    const usage = executionErrorUsage(error);
    const errorUsage = usage.usageByModel.length
      ? usage.usageByModel
      : usage.modelId && usage.inputTokens !== null && usage.outputTokens !== null
        ? normalizeMeasuredUsage(undefined, usage.modelId, usage.inputTokens, usage.outputTokens)
        : [];
    const measured = mergeMeasuredUsage(trace.usageByModel, errorUsage);
    let inputTokens = measured.reduce((sum, item) => sum + item.inputTokens, 0);
    const outputTokens = measured.reduce((sum, item) => sum + item.outputTokens, 0);
    const measuredTokens = inputTokens + outputTokens;
    const failure = executionFailureDisposition(error);
    const pessimisticTokenDelta = failure.mayHaveUnreportedUsage && trace.model && trace.price
      ? Math.max(0, claimed.task.reservedTokens - measuredTokens)
      : 0;
    inputTokens += pessimisticTokenDelta;
    let costMicros: number;
    try {
      costMicros = costForMeasuredUsage(this.modelPricing, measured, trace.provider);
    } catch {
      // Unknown provider pricing is an execution-contract violation. Charge the
      // full reserved ceiling rather than silently recording a free call; the
      // trace error remains explicit and the task is failed/fenced.
      costMicros = claimed.task.reservedCostMicros;
    }
    if (failure.mayHaveUnreportedUsage && trace.model && trace.price) {
      costMicros = Math.max(costMicros, claimed.task.reservedCostMicros);
    }
    await this.storyState.finishTrace(requiredUserId(claimed.run), claimed.run.projectId, claimed.run.id, trace.id, {
      lease: {
        taskId: claimed.task.id,
        workerId: this.workerId,
        leaseToken: claimed.lease.leaseToken,
        leaseGeneration: claimed.lease.leaseGeneration,
        runGeneration: claimed.lease.runGeneration
      },
      requestHash: stableHash({ status: 'failed', message, inputTokens, outputTokens, costMicros }),
      status: 'failed',
      model: trace.model,
      modelParameters: traceModelParameters(
        claimed.task,
        trace.price,
        trace.model,
        !trace.price || pessimisticTokenDelta > 0 || (failure.mayHaveUnreportedUsage && costMicros === claimed.task.reservedCostMicros)
      ),
      toolCalls: [],
      toolResults: [],
      outputs: {},
      validatorResults: {},
      inputTokens,
      outputTokens,
      costMicros,
      latencyMs: Date.now() - trace.startedAt.getTime(),
      retries: Math.max(0, claimed.task.attempts - 1),
      completionState: 'failed',
      error: message,
      completedAt: new Date().toISOString()
    });
    this.pendingTraces.delete(claimed.task.id);
  }
}

export function preferredStoryIntakeModel(
  taskType: string,
  providerKind: string | null,
  configuredModel: string | null,
  routedModel?: string
): string | undefined {
  if (routedModel) return routedModel;
  return taskType === 'create-story-brief'
    && providerKind === 'CODEX'
    && configuredModel === 'codex/gpt-5.6-sol'
    ? 'codex/gpt-5.6-luna'
    : undefined;
}

interface BuiltInSkillUpgrade {
  name: string;
  from: string;
  to: string;
}

export function resolveUntouchedBuiltInSkillUpgrades(
  catalog: AiSkillCatalogItem[],
  versions: Record<string, unknown>,
  task: Pick<BuildTask, 'status' | 'attempts' | 'startedAt' | 'outputArtifactIds'>
): { versions: Record<string, string>; upgrades: BuiltInSkillUpgrade[] } {
  const resolved: Record<string, string> = {};
  const upgrades: BuiltInSkillUpgrade[] = [];
  const eligible =
    task.status === 'READY' &&
    task.attempts === 0 &&
    task.startedAt === null &&
    task.outputArtifactIds.length === 0;
  for (const [name, rawVersion] of Object.entries(versions)) {
    if (typeof rawVersion !== 'string') throw new Error(`Pinned skill version for ${name} is invalid`);
    const skill = catalog.find((candidate) => candidate.name === name);
    if (
      eligible &&
      skill?.native === true &&
      skill.manifest.version !== rawVersion &&
      isNewerSemver(skill.manifest.version, rawVersion)
    ) {
      resolved[name] = skill.manifest.version;
      upgrades.push({ name, from: rawVersion, to: skill.manifest.version });
    } else {
      resolved[name] = rawVersion;
    }
  }
  return { versions: resolved, upgrades };
}

function isNewerSemver(candidate: string, current: string): boolean {
  const parse = (value: string) => {
    const match = /^(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/.exec(value);
    return match ? [Number(match[1]), Number(match[2]), Number(match[3])] : null;
  };
  const next = parse(candidate);
  const previous = parse(current);
  if (!next || !previous) return false;
  for (let index = 0; index < 3; index += 1) {
    if (next[index] !== previous[index]) return next[index]! > previous[index]!;
  }
  return false;
}

function deterministicTask(task: BuildTask): boolean {
  const policy = jsonRecord(task.executionPolicy);
  return policy.deterministic === true || ['checkpoint', 'drafting-complete-barrier', 'export-preparation', 'assemble-chapter-context', 'assemble-scene-context', 'run-chapter-diagnostics', 'run-scene-diagnostics'].includes(task.type);
}

export function deterministicExecutionTask(task: BuildTask): boolean {
  return deterministicTask(task) || task.type === 'quality-gate';
}

export function hasRuntimeCriticEvidence(
  toolCalls: unknown[],
  toolResults: unknown[],
  evidenceTools = new Set(['searchStory', 'findReferences', 'getSceneContext', 'queryCanon', 'queryTimeline', 'queryEntityState', 'queryOpenLoops', 'getArcState', 'compareVersions', 'getBuildState', 'listBuildUnits', 'readBuildUnit', 'runStoryLint'])
): boolean {
  const evidenceCallIds = new Set(toolCalls.flatMap((call) => {
    const value = jsonRecord(call);
    if (!evidenceTools.has(String(value.toolName ?? ''))) return [];
    return typeof value.toolCallId === 'string' ? [value.toolCallId] : [''];
  }));
  return toolResults.some((result) => {
    const value = jsonRecord(result);
    if (!evidenceTools.has(String(value.toolName ?? ''))) return false;
    return typeof value.toolCallId === 'string'
      ? evidenceCallIds.has(value.toolCallId)
      : evidenceCallIds.has('');
  });
}

export function defaultTaskBudget(task: BuildTask): {
  maxInputTokens: number;
  maxOutputTokens: number;
  maxToolCalls: number;
  maxDurationMs: number;
} {
  if (AGGREGATE_ARTIFACT_TASK_TYPES.has(task.type)) {
    return {
      maxInputTokens: 256_000,
      maxOutputTokens: 48_000,
      maxToolCalls: 16,
      maxDurationMs: 15 * 60_000
    };
  }
  if (task.type === 'create-relationship-graph') {
    return {
      maxInputTokens: 320_000,
      maxOutputTokens: 32_000,
      maxToolCalls: 12,
      maxDurationMs: 15 * 60_000
    };
  }
  return {
    maxInputTokens: 96_000,
    maxOutputTokens: 12_000,
    maxToolCalls: 16,
    maxDurationMs: 15 * 60_000
  };
}

function roleForTask(assignedAgent: string): RuntimeRole {
  const direct = runtimeRoleSchema.safeParse(assignedAgent);
  if (direct.success) return direct.data;
  if (/critic|diagnostic|proof|continuity/i.test(assignedAgent)) return 'critic';
  if (/draft|chapter-writer/i.test(assignedAgent)) return 'drafter';
  if (/revis|edit/i.test(assignedAgent)) return 'reviser';
  if (/librar|canon/i.test(assignedAgent)) return 'librarian';
  if (/research/i.test(assignedAgent)) return 'researcher';
  return 'creator';
}

export function objectiveForTask(task: BuildTask, buildObjective: string, manifestValue: Prisma.JsonValue): string {
  const manifest = jsonRecord(manifestValue);
  const requiredTypes = stringArray(jsonRecord(task.acceptanceCriteria).requiredArtifactTypes);
  const cardinality = (Array.isArray(manifest.artifactSpecs) ? manifest.artifactSpecs : [])
    .map(jsonRecord)
    .filter((spec) => typeof spec.type === 'string' && requiredTypes.includes(spec.type))
    .map((spec) => {
      const minimum = typeof spec.minCount === 'number' ? Math.trunc(spec.minCount) : 0;
      const maximum = typeof spec.maxCount === 'number' ? Math.trunc(spec.maxCount) : minimum;
      return `${spec.type}: exactly ${minimum === maximum ? minimum : `${minimum}-${maximum}`}`;
    });
  return [
    `Complete durable task ${task.key} (${task.type}) for this build objective: ${buildObjective}.`,
    cardinality.length
      ? `Manifest artifact cardinality is authoritative and overrides conflicting suggestions in input artifacts: ${cardinality.join(', ')}.`
      : '',
    requiredTypes.length
      ? 'Persist every required structured artifact with status VALIDATED using scoped tools before reporting its ID.'
      : 'This task requires no artifact output. Report observable checks and evaluation evidence directly.',
    task.type === 'create-finale-plan'
      ? 'Set mainThreadKey to the main plot-thread content.threadKey; the build validator also accepts that plot-thread artifact\'s exact stable key.'
      : '',
    ['create-scene-plans', 'create-scene-plan-shard'].includes(task.type)
      ? 'Use exactly the chapter briefs\' declared sceneKeys. Preserve each declared chapterKey and set ordinal to its 1-based position within that chapter; never redistribute scenes or use a book-global ordinal.'
      : '',
    requiredTypes.length
      ? 'Every typed reference must use an exact stable id or key from a persisted input artifact or a sibling output; do not invent namespaced aliases such as character:name, thread:name, setup:name, or location:name.'
      : '',
    'Report only observable decisions, artifact IDs, validator evidence, checks, and quality scores.'
  ].filter(Boolean).join(' ');
}

export function outputTypeForTask(task: BuildTask): string {
  if (task.type === 'quality-gate') return 'task-result';
  if (/critic|review|diagnostic|quality|proof/i.test(task.type)) return 'revision-issue';
  if (/draft|chapter/i.test(task.type)) return 'chapter-draft';
  return 'task-result';
}

function criterionDescription(id: string, value: unknown): string {
  return `${id} must be satisfied${value === true ? '' : `: ${typeof value === 'string' ? value : JSON.stringify(value)}`}`;
}

function prismaArtifactType(value: string): string {
  return value.toLowerCase().replace(/_/g, '-');
}

function checkpointLabel(task: BuildTask): string {
  if (task.key === 'planning-checkpoint') return 'Planning complete';
  if (task.key === 'final-checkpoint') return 'Novel Build final';
  const match = task.key.match(/^chapter:([^:]+):checkpoint$/);
  return match ? `Chapter ${match[1]} accepted` : task.key;
}

function requiredUserId(run: BuildRun): string {
  const userId = run.authorizedById ?? run.createdById;
  if (!userId) throw new Error('Novel Build has no authorizing user');
  return userId;
}

function assertAuthorizedTool(run: BuildRun, toolName: string, input: unknown): void {
  const scope = jsonRecord(run.authorizationScope);
  if (scope.expiresAt && new Date(String(scope.expiresAt)).getTime() < Date.now()) throw new Error('Novel Build authorization expired');
  if (toolName === 'applyArtifactBatch' && scope.allowPlanningArtifacts !== true) throw new Error('Build is not authorized to write planning artifacts');
  if (toolName === 'applyChapterPatch' && scope.allowChapterWrites !== true) throw new Error('Build is not authorized to write chapters');
  if ((toolName === 'commitCanonDelta' || toolName === 'linkSetupPayoff') && scope.allowCanonWrites !== true) throw new Error('Build is not authorized to write canon');
  if (toolName === 'runStoryLint' && scope.allowDiagnostics !== true) throw new Error('Build is not authorized to run diagnostics');
  const record = jsonRecord(input);
  if (record.buildRunId && record.buildRunId !== run.id) throw new Error('Tool attempted to target a different build');
}

function assertRequiredTaskCapabilities(tools: Record<string, unknown>, task: BuildTask): void {
  const required = new Set<string>();
  const acceptance = jsonRecord(task.acceptanceCriteria);
  if (stringArray(acceptance.requiredArtifactTypes).length) required.add('applyArtifactBatch');
  if (['draft-scene-unit', 'revise-scene-unit', 'structural-revision', 'line-edit', 'copy-edit', 'finalization'].includes(task.type)) required.add('applyBuildUnitPatch');
  if (task.type.includes('canon')) required.add('commitCanonDelta');
  if (roleForTask(task.assignedAgent) === 'critic') required.add('runStoryLint');
  const missing = [...required].filter((name) => !tools[name]);
  if (missing.length) throw new Error(`Pinned skill permissions omit required task capabilities: ${missing.join(', ')}`);
}

function basicResult(passed: boolean, check: string, summary: string): WorkerResult {
  return { status: passed ? 'complete' : 'blocked', decisions: [], artifactIds: [], evidence: [{ type: 'deterministic', summary }], checks: { [check]: passed }, quality: { deterministic: passed ? 1 : 0 }, unresolvedQuestions: passed ? [] : [summary] };
}

function compactToolCall(value: unknown): Record<string, unknown> {
  const record = jsonRecord(value);
  return { toolCallId: record.toolCallId, toolName: record.toolName, input: observableValue(record.input) };
}

function compactToolResult(value: unknown): Record<string, unknown> {
  const record = jsonRecord(value);
  const output = jsonRecord(record.output);
  return { toolCallId: record.toolCallId, toolName: record.toolName, ok: output.ok, ids: collectIds(output), output: observableValue(record.output) };
}

function observableValue(value: unknown, depth = 0, maxStringLength = 2_000): unknown {
  if (depth > 5) return '[depth truncated]';
  if (typeof value === 'string') return boundedText(value, maxStringLength);
  if (Array.isArray(value)) return value.slice(0, 100).map((item) => observableValue(item, depth + 1, maxStringLength));
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value as Record<string, unknown>).slice(0, 100).map(([key, item]) => [key, observableValue(item, depth + 1, maxStringLength)]));
  return value;
}

function perItemLimit(totalCharacters: number, itemCount: number, minimum: number, maximum: number): number {
  if (!itemCount) return maximum;
  return Math.max(minimum, Math.min(maximum, Math.floor(totalCharacters / itemCount)));
}

export function judgeEvidenceCharacterBudget(maxInputTokens: number, completePlanningCorpus = false): number {
  return Math.max(
    12_000,
    Math.min(completePlanningCorpus ? 220_000 : 80_000, Math.max(0, maxInputTokens - 8_000) * (completePlanningCorpus ? 3 : 2))
  );
}

export function completePlanningArtifactLimit(type: string): number {
  if (type === 'scene-plan') return 700;
  if (type === 'beat') return 450;
  if (type === 'chapter-brief') return 900;
  if (type === 'character-bible' || type === 'plot-thread') return 1_400;
  return 6_000;
}

function boundedText(value: string, maximumCharacters: number): string {
  return value.length > maximumCharacters
    ? `${value.slice(0, Math.max(0, maximumCharacters - 32))}\n[${value.length - maximumCharacters} chars truncated]`
    : value;
}

function collectIds(value: unknown, result: string[] = []): string[] {
  if (Array.isArray(value)) for (const item of value) collectIds(item, result);
  else if (value && typeof value === 'object') for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    if ((key === 'id' || key.endsWith('Id')) && typeof item === 'string') result.push(item);
    else collectIds(item, result);
  }
  return [...new Set(result)].slice(0, 10_000);
}

function jsonRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values)];
}

function chunkStrings(values: string[], size: number): string[][] {
  const chunks: string[][] = [];
  for (let index = 0; index < values.length; index += size) chunks.push(values.slice(index, index + size));
  return chunks;
}

function numeric(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function average(values: number[]): number {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : Number.NaN;
}

function rubricDimensions(rubric: string): string[] {
  if (rubric === 'complete-book-plan-v1') return ['completeness', 'causality', 'coherence', 'contract'];
  if (rubric === 'scene-quality-v1') return ['causality', 'continuity', 'character', 'prose'];
  if (rubric === 'manuscript-developmental-v1') return ['structure', 'causality', 'character', 'payoff'];
  if (rubric === 'character-continuity-v1') return ['arc', 'motivation', 'knowledge', 'continuity'];
  if (rubric === 'continuity-v1') return ['temporal', 'knowledge', 'state', 'worldRules'];
  if (rubric === 'pacing-v1') return ['escalation', 'variation', 'tension', 'momentum'];
  if (rubric === 'proof-v1') return ['mechanics', 'consistency', 'formatting', 'cleanliness'];
  return ['correctness', 'completeness', 'evidence'];
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function isSerializableConflict(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const record = error as { code?: string; message?: string; meta?: { code?: string; message?: string } };
  return record.code === 'P2034'
    || record.meta?.code === '40001'
    || /could not serialize access|write conflict|deadlock/i.test(`${record.message ?? ''} ${record.meta?.message ?? ''}`);
}

function isBuildGoneOrTerminal(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const record = error as { status?: number; message?: string };
  return record.status === 404
    || (record.status === 409 && /cancel|completed|terminal|not leased|not runnable|paused|cannot claim work/i.test(record.message ?? ''));
}

function isReservationConflict(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const record = error as { status?: number; message?: string };
  return record.status === 409 && /insufficient unreserved (token|cost) budget/i.test(record.message ?? '');
}

function guardWorkerTools(
  tools: ToolSet,
  maxToolCalls: number,
  abortSignal: AbortSignal,
  assertLease: () => Promise<void>
): ToolSet {
  let calls = 0;
  return Object.fromEntries(Object.entries(tools).map(([name, toolDefinition]) => {
    const definition = toolDefinition as typeof toolDefinition & { execute?: (...args: unknown[]) => unknown };
    if (!definition.execute) return [name, definition];
    const execute = definition.execute;
    return [name, {
      ...definition,
      execute: async (...args: unknown[]) => {
        if (abortSignal.aborted) throw abortSignal.reason ?? new Error('Build task interrupted');
        await assertLease();
        calls += 1;
        if (calls > maxToolCalls) throw new Error(`Task exceeded maxToolCalls=${maxToolCalls}`);
        const result = await execute(...args);
        await assertLease();
        if (abortSignal.aborted) throw abortSignal.reason ?? new Error('Build task interrupted');
        return result;
      }
    }];
  })) as ToolSet;
}

async function defaultModelExecutor(input: BuildModelExecutorInput): Promise<BuildModelExecutorOutput> {
  const candidates: Array<string | null | undefined> = input.contract.modelPolicy.preferred
    ? [input.contract.modelPolicy.preferred, ...input.contract.modelPolicy.fallbacks]
    : [undefined, ...input.contract.modelPolicy.fallbacks];
  const attempts = Math.min(input.contract.retryPolicy.maxAttempts, candidates.length);
  let lastError: unknown;
  let cumulativeInputTokens = 0;
  let cumulativeOutputTokens = 0;
  const usageByModel: MeasuredModelUsage[] = [];
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const modelId = candidates[attempt];
    const actualModelId = modelId ?? input.defaultModelId ?? input.contract.modelPolicy.preferred ?? null;
    try {
      const model = await input.resolveModel(modelId);
      let streamError: unknown;
      const generation = streamText({
        model,
        system: input.system,
        prompt: input.prompt,
        tools: input.tools,
        stopWhen: [hasToolCall('reportTaskResult'), stepCountIs(input.stepLimit)],
        abortSignal: input.abortSignal,
        maxOutputTokens: input.contract.budget.maxOutputTokens,
        providerOptions: providerOptionsForAiModel(
          model,
          input.contract.metadata.taskType === 'create-story-brief'
            ? { reasoningEffort: 'low', textVerbosity: 'low' }
            : {}
        ),
        prepareStep: input.contract.metadata.taskType === 'create-story-brief'
          ? ({ steps }) => prepareStoryBriefStep(steps)
          : undefined,
        onError: ({ error }) => { streamError ??= error; }
      });
      const [usage, text, steps] = await Promise.all([
        generation.totalUsage,
        generation.text,
        generation.steps
      ]);
      if (streamError) {
        const partialUsage = actualModelId
          ? measuredInvocationUsage(
            steps,
            actualModelId,
            usage?.inputTokens ?? 0,
            usage?.outputTokens ?? 0
          )
          : [];
        throw attachExecutionUsage(
          streamError,
          usage?.inputTokens ?? 0,
          usage?.outputTokens ?? 0,
          actualModelId,
          partialUsage
        );
      }
      cumulativeInputTokens += usage?.inputTokens ?? 0;
      cumulativeOutputTokens += usage?.outputTokens ?? 0;
      if (actualModelId) {
        usageByModel.push(...measuredInvocationUsage(
          steps,
          actualModelId,
          usage?.inputTokens ?? 0,
          usage?.outputTokens ?? 0
        ));
      }
      let result: WorkerResult;
      try {
        result = extractWorkerResult(
          steps.flatMap((step) => step.toolResults ?? []),
          text
        );
      } catch (error) {
        if (error && typeof error === 'object') Object.assign(error, { providerUsageComplete: true });
        throw error;
      }
      return {
        result,
        inputTokens: cumulativeInputTokens,
        outputTokens: cumulativeOutputTokens,
        toolCalls: steps.flatMap((step) => step.toolCalls ?? []),
        toolResults: steps.flatMap((step) => step.toolResults ?? []),
        modelId: actualModelId,
        usageByModel
      };
    } catch (error) {
      lastError = error;
      const usage = executionErrorUsage(error);
      cumulativeInputTokens += usage.inputTokens ?? 0;
      cumulativeOutputTokens += usage.outputTokens ?? 0;
      if (usage.usageByModel.length) usageByModel.push(...usage.usageByModel);
      else if (actualModelId && usage.inputTokens !== null && usage.outputTokens !== null) usageByModel.push(...normalizeMeasuredUsage(undefined, actualModelId, usage.inputTokens, usage.outputTokens));
      if (input.abortSignal.aborted) throw attachExecutionUsage(input.abortSignal.reason ?? error, cumulativeInputTokens, cumulativeOutputTokens, actualModelId, usageByModel);
      const category = classifyRetry(error);
      if (!input.contract.retryPolicy.retryOn.includes(category) || attempt + 1 >= attempts) throw attachExecutionUsage(error, cumulativeInputTokens, cumulativeOutputTokens, actualModelId, usageByModel);
      await abortableDelay(input.contract.retryPolicy.backoffMs * (attempt + 1), input.abortSignal);
    }
  }
  throw attachExecutionUsage(lastError, cumulativeInputTokens, cumulativeOutputTokens, null, usageByModel);
}

export function prepareStoryBriefStep(steps: Array<{ toolResults?: unknown[] }>) {
  const artifactPersisted = steps.some((step) => (step.toolResults ?? []).some((value) => {
    const result = jsonRecord(value);
    return result.toolName === 'applyArtifactBatch' && jsonRecord(result.output).ok === true;
  }));
  const toolName = artifactPersisted ? 'reportTaskResult' : 'applyArtifactBatch';
  return {
    activeTools: [toolName],
    toolChoice: artifactPersisted
      ? { type: 'tool' as const, toolName }
      : 'auto' as const
  };
}

async function defaultJudgeExecutor(input: BuildJudgeExecutorInput): Promise<BuildJudgeExecutorOutput> {
  const modelId = process.env.AI_JUDGE_MODEL?.trim() || input.contract.modelPolicy.preferred || null;
  const model = await input.resolveModel(modelId);
  let streamError: unknown;
  const scoreShape = Object.fromEntries(
    rubricDimensions(input.rubric).map((dimension) => [dimension, z.number().describe(`Score ${dimension} from 0 to 1`)] as const)
  );
  const reportJudgeResult = tool({
    description: 'Submit every required rubric score from 0 to 1, concise feedback, and observable evidence.',
    inputSchema: z.object({
      scores: z.object(scoreShape),
      feedback: z.string().default(''),
      evidence: z.array(z.object({
        type: z.string().default('judge'),
        id: z.string().optional(),
        summary: z.string()
      })).max(200).default([])
    }),
    execute: async (value) => value
  });
  const generation = streamText({
    model,
    system: [
      'You are an independent fiction-quality evaluator. You have diagnostics-only authority and cannot mutate or self-certify the candidate.',
      'Score only the supplied rubric and observable evidence. Do not expose hidden reasoning.',
      'A bounded artifact body may be truncated for transport; use artifactCoverage to determine whether the required corpus is complete and do not fail solely because individual bodies are bounded.',
      'For planning review, declared open questions are review surfaces, not automatic defects; lower scores only when an unresolved item prevents causal execution or violates the owner contract.',
      'A runStoryLint call with buildRunId and omitted or empty chapterIds is build-wide.',
      'You are producing the required independent evaluation now; never require a pre-existing MODEL evaluation.',
      'Call reportJudgeResult exactly once with every required score dimension, concise feedback, and observable evidence.'
    ].join('\n'),
    prompt: renderJudgePrompt(input),
    tools: { reportJudgeResult },
    toolChoice: { type: 'tool', toolName: 'reportJudgeResult' },
    stopWhen: hasToolCall('reportJudgeResult'),
    abortSignal: input.abortSignal,
    maxOutputTokens: Math.min(4_000, input.contract.budget.maxOutputTokens),
    providerOptions: providerOptionsForAiModel(model, { reasoningEffort: 'low', textVerbosity: 'low' }),
    onError: ({ error }) => { streamError ??= error; }
  });
  const [usage, text, steps, finishReason] = await Promise.all([
    generation.totalUsage,
    generation.text,
    generation.steps,
    generation.finishReason
  ]);
  if (streamError) {
    throw attachExecutionUsage(
      streamError,
      usage?.inputTokens ?? 0,
      usage?.outputTokens ?? 0,
      modelId,
      modelId ? normalizeMeasuredUsage(undefined, modelId, usage?.inputTokens ?? 0, usage?.outputTokens ?? 0) : []
    );
  }
  const toolCalls = steps.flatMap((step) => step.toolCalls ?? []);
  const toolResults = steps.flatMap((step) => step.toolResults ?? []);
  let result: z.infer<typeof judgeResultSchema>;
  try {
    result = extractJudgeResult(toolResults, toolCalls, text);
  } catch (error) {
    const failure = new Error(
      `${error instanceof Error ? error.message : 'Independent judge result was invalid'} `
      + `(finishReason=${finishReason}, toolCalls=${toolCalls.length}, toolResults=${toolResults.length}, textCharacters=${text.length})`
    );
    Object.assign(failure, { providerUsageComplete: true });
    throw attachExecutionUsage(
      failure,
      usage?.inputTokens ?? 0,
      usage?.outputTokens ?? 0,
      modelId,
      modelId ? normalizeMeasuredUsage(undefined, modelId, usage?.inputTokens ?? 0, usage?.outputTokens ?? 0) : []
    );
  }
  return {
    result,
    inputTokens: usage?.inputTokens ?? 0,
    outputTokens: usage?.outputTokens ?? 0,
    modelId
  };
}

export function extractJudgeResult(toolResults: unknown[], toolCalls: unknown[], text: string): z.infer<typeof judgeResultSchema> {
  const candidates = [
    ...[...toolResults].reverse().flatMap((value) => {
      const result = jsonRecord(value);
      return result.toolName === 'reportJudgeResult' ? [result.output] : [];
    }),
    ...[...toolCalls].reverse().flatMap((value) => {
      const call = jsonRecord(value);
      return call.toolName === 'reportJudgeResult' ? [call.input ?? call.args ?? call.arguments] : [];
    })
  ];
  for (const candidate of candidates) {
    try {
      return normalizeJudgeResultCandidate(candidate);
    } catch {
      // Try the next observable provider representation.
    }
  }
  return parseJudgeResult(text);
}

export function parseJudgeResult(text: string): z.infer<typeof judgeResultSchema> {
  const trimmed = text.trim();
  const fenced = [...trimmed.matchAll(/```(?:json)?\s*([\s\S]*?)```/gi)]
    .map((match) => match[1]?.trim() ?? '')
    .filter(Boolean);
  const firstBrace = trimmed.indexOf('{');
  const lastBrace = trimmed.lastIndexOf('}');
  const embedded = firstBrace >= 0 && lastBrace > firstBrace
    ? trimmed.slice(firstBrace, lastBrace + 1)
    : '';
  for (const candidate of [trimmed, ...fenced, embedded].filter(Boolean)) {
    try {
      return normalizeJudgeResultCandidate(JSON.parse(candidate));
    } catch {
      // Try the next observable JSON candidate.
    }
  }
  throw new Error('Independent judge did not return schema-valid JSON');
}

export function normalizeJudgeResultCandidate(value: unknown): z.infer<typeof judgeResultSchema> {
  const candidate = jsonRecord(value);
  const scores: Record<string, number> = {};
  const rawScores = candidate.scores;
  const addScore = (rawKey: unknown, rawValue: unknown) => {
    if (typeof rawKey !== 'string' || !rawKey.trim()) return;
    const detail = jsonRecord(rawValue);
    const score = typeof rawValue === 'number'
      ? rawValue
      : typeof rawValue === 'string' && rawValue.trim() !== ''
        ? Number(rawValue)
        : [detail.score, detail.value, detail.rating].find((item) => typeof item === 'number');
    if (typeof score !== 'number' || !Number.isFinite(score)) return;
    const normalizedScore = score > 1 && score <= 100 ? score / 100 : score;
    const key = rawKey.trim().replace(/[\s_-]+(.)/g, (_match, letter: string) => letter.toUpperCase());
    scores[key.charAt(0).toLowerCase() + key.slice(1)] = normalizedScore;
  };
  if (Array.isArray(rawScores)) {
    for (const item of rawScores) {
      const score = jsonRecord(item);
      addScore(score.dimension ?? score.name ?? score.id ?? score.key, score.score ?? score.value ?? score.rating);
    }
  } else {
    for (const [key, score] of Object.entries(jsonRecord(rawScores))) addScore(key, score);
  }
  const feedbackValue = candidate.feedback;
  const feedbackRecord = jsonRecord(feedbackValue);
  const feedback = typeof feedbackValue === 'string'
    ? feedbackValue
    : Array.isArray(feedbackValue)
      ? feedbackValue.filter((item): item is string => typeof item === 'string').join('\n')
      : [feedbackRecord.summary, feedbackRecord.message, feedbackRecord.feedback]
        .find((item): item is string => typeof item === 'string') ?? '';
  const evidence = (Array.isArray(candidate.evidence) ? candidate.evidence : []).flatMap((item) => {
    if (typeof item === 'string' && item.trim()) return [{ type: 'judge', summary: item.trim() }];
    const record = jsonRecord(item);
    const summary = [record.summary, record.reason, record.description, record.evidence]
      .find((entry): entry is string => typeof entry === 'string' && entry.trim().length > 0);
    if (!summary) return [];
    return [{
      type: typeof record.type === 'string' && record.type.trim() ? record.type.trim() : 'judge',
      ...(typeof record.id === 'string' && record.id.trim() ? { id: record.id.trim() } : {}),
      summary: summary.trim()
    }];
  });
  return judgeResultSchema.parse({ scores, feedback, evidence });
}

export function renderJudgePrompt(input: Pick<BuildJudgeExecutorInput, 'rubric' | 'contract' | 'deterministicChecks' | 'observableResult' | 'evidencePack'>): string {
  const requiresCurrentEvaluation = input.contract.acceptanceCriteria.some((criterion) => criterion.id === 'requiresPassingEvaluation');
  return [
    JSON.stringify({
      rubric: input.rubric,
      requiredScoreDimensions: rubricDimensions(input.rubric),
      objective: input.contract.objective,
      acceptanceCriteria: input.contract.acceptanceCriteria.filter((criterion) => criterion.id !== 'requiresPassingEvaluation'),
      deterministicChecks: Object.fromEntries(Object.entries(input.deterministicChecks).filter(([name]) => name !== 'requiresPassingEvaluation')),
      ...(requiresCurrentEvaluation ? {
        evaluationBoundary: 'This response is the required independent evaluation; do not look for a pre-existing evaluation artifact or row.'
      } : {})
    }, null, 2),
    serializeUntrustedData('judge-candidate-evidence', {
      observableCandidateResult: input.observableResult,
      evidencePack: input.evidencePack
    })
  ].join('\n\n');
}

function classifyRetry(error: unknown): 'transient' | 'timeout' | 'validation' | 'quality' {
  const failure = executionFailureDisposition(error);
  const message = failure.message;
  if (/timeout|timed out|deadline/i.test(message)) return 'timeout';
  if (!failure.retryable) return 'validation';
  if (error instanceof z.ZodError || /schema|validation|invalid output/i.test(message)) return 'validation';
  return 'transient';
}

export function executionFailureDisposition(error: unknown): {
  message: string;
  retryable: boolean;
  mayHaveUnreportedUsage: boolean;
} {
  const value = jsonRecord(error);
  const cause = jsonRecord(value.cause);
  const statusCode = numericStatus(value.statusCode) ?? numericStatus(cause.statusCode);
  const rejectedBeforeExecution = statusCode !== null
    && statusCode >= 400
    && statusCode < 500
    && ![408, 409, 425, 429].includes(statusCode);
  const explicitlyNonRetryable = value.isRetryable === false || cause.isRetryable === false;
  const providerUsageComplete = value.providerUsageComplete === true || cause.providerUsageComplete === true;
  const baseMessage = error instanceof Error && error.message.trim()
    ? error.message.trim()
    : 'Novel Build task failed';
  const detail = providerErrorDetail(value.responseBody) ?? providerErrorDetail(cause.responseBody);
  return {
    message: detail && !baseMessage.toLowerCase().includes(detail.toLowerCase())
      ? `${baseMessage}: ${detail}`
      : baseMessage,
    retryable: !rejectedBeforeExecution && !explicitlyNonRetryable,
    mayHaveUnreportedUsage: !rejectedBeforeExecution && !providerUsageComplete
  };
}

function numericStatus(value: unknown): number | null {
  return typeof value === 'number' && Number.isInteger(value) ? value : null;
}

function providerErrorDetail(value: unknown): string | null {
  let parsed = value;
  if (typeof parsed === 'string') {
    try { parsed = JSON.parse(parsed); } catch { return null; }
  }
  const response = jsonRecord(parsed);
  const nested = jsonRecord(response.error);
  const detail = [response.detail, nested.message, response.message]
    .find((candidate): candidate is string => typeof candidate === 'string' && candidate.trim().length > 0);
  return detail ? boundedText(detail.trim(), 1_000) : null;
}

export function extractWorkerResult(toolResults: unknown[], text: string): WorkerResult {
  for (const value of [...toolResults].reverse()) {
    const result = jsonRecord(value);
    if (result.toolName !== 'reportTaskResult') continue;
    const output = jsonRecord(result.output);
    const parsed = workerResultSchema.safeParse(output.observableResult ?? output.result ?? output);
    if (parsed.success) return parsed.data;
  }
  const candidates = [
    text.trim(),
    ...[...text.matchAll(/```(?:json)?\s*([\s\S]*?)```/gi)].map((match) => match[1]?.trim() ?? '')
  ].filter(Boolean);
  for (const candidate of candidates) {
    try {
      const parsed = workerResultSchema.safeParse(JSON.parse(candidate));
      if (parsed.success) return parsed.data;
    } catch {
      // Try the next observable candidate.
    }
  }
  const persistedArtifactIds: string[] = [];
  const persistedEvidence: WorkerResult['evidence'] = [];
  for (const value of toolResults) {
    const result = jsonRecord(value);
    const toolName = typeof result.toolName === 'string' ? result.toolName : '';
    const output = jsonRecord(result.output);
    if (toolName !== 'applyArtifactBatch' || output.ok !== true) continue;
    for (const item of Array.isArray(output.results) ? output.results : []) {
      const id = jsonRecord(item).id;
      if (typeof id === 'string') persistedArtifactIds.push(id);
    }
    persistedEvidence.push({
      type: 'persisted-tool-result',
      summary: `${toolName} completed successfully with independently validated backend output.`
    });
  }
  if (persistedEvidence.length) {
    return {
      status: 'complete',
      decisions: [],
      artifactIds: [...new Set(persistedArtifactIds)],
      evidence: persistedEvidence,
      checks: { persistedToolResult: true },
      quality: {},
      unresolvedQuestions: []
    };
  }
  throw new Error('Build task did not call reportTaskResult with a schema-valid observable result');
}

async function abortableDelay(ms: number, signal: AbortSignal): Promise<void> {
  if (ms <= 0) return;
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    timer.unref?.();
    signal.addEventListener('abort', () => {
      clearTimeout(timer);
      reject(signal.reason ?? new Error('Build task interrupted'));
    }, { once: true });
  });
}

async function raceWithAbort<T>(operation: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) throw signal.reason ?? new Error('Build task interrupted');
  let onAbort!: () => void;
  const aborted = new Promise<never>((_resolve, reject) => {
    onAbort = () => reject(signal.reason ?? new Error('Build task interrupted'));
    signal.addEventListener('abort', onAbort, { once: true });
  });
  try {
    return await Promise.race([operation, aborted]);
  } finally {
    signal.removeEventListener('abort', onAbort);
  }
}

function executionErrorUsage(error: unknown): { inputTokens: number | null; outputTokens: number | null; modelId: string | null; usageByModel: MeasuredModelUsage[] } {
  if (!error || typeof error !== 'object') return { inputTokens: null, outputTokens: null, modelId: null, usageByModel: [] };
  const record = error as Record<string, unknown>;
  const usage = record.usage && typeof record.usage === 'object' && !Array.isArray(record.usage)
    ? record.usage as Record<string, unknown>
    : record;
  const usageByModel = Array.isArray(record.usageByModel)
    ? record.usageByModel.flatMap((value) => {
      if (!value || typeof value !== 'object' || Array.isArray(value)) return [];
      const item = value as Record<string, unknown>;
      return typeof item.modelId === 'string' && typeof item.inputTokens === 'number' && typeof item.outputTokens === 'number'
        ? normalizeMeasuredUsage(undefined, item.modelId, item.inputTokens, item.outputTokens)
        : [];
    })
    : [];
  return {
    inputTokens: typeof usage.inputTokens === 'number' ? usage.inputTokens : null,
    outputTokens: typeof usage.outputTokens === 'number' ? usage.outputTokens : null,
    modelId: typeof record.modelId === 'string' ? record.modelId : null,
    usageByModel
  };
}

function attachExecutionUsage(error: unknown, inputTokens: number, outputTokens: number, modelId: string | null, usageByModel: MeasuredModelUsage[] = []): Error {
  const wrapped = error instanceof Error ? error : new Error(String(error ?? 'Model execution failed'));
  Object.assign(wrapped, { inputTokens, outputTokens, modelId, usageByModel });
  return wrapped;
}

function normalizeMeasuredUsage(
  provided: MeasuredModelUsage[] | undefined,
  fallbackModelId: string,
  expectedInputTokens: number,
  expectedOutputTokens: number
): MeasuredModelUsage[] {
  const measuredInput = tokenCount(expectedInputTokens, 'inputTokens');
  const measuredOutput = tokenCount(expectedOutputTokens, 'outputTokens');
  const values = provided?.length ? provided : [{ modelId: fallbackModelId, inputTokens: measuredInput, outputTokens: measuredOutput }];
  const normalized = values.map((usage) => ({
    modelId: typeof usage.modelId === 'string' && usage.modelId.trim() ? usage.modelId.trim() : (() => { throw new Error('Measured model usage requires modelId'); })(),
    inputTokens: tokenCount(usage.inputTokens, 'usageByModel.inputTokens'),
    outputTokens: tokenCount(usage.outputTokens, 'usageByModel.outputTokens')
  }));
  if (normalized.reduce((sum, usage) => sum + usage.inputTokens, 0) !== measuredInput || normalized.reduce((sum, usage) => sum + usage.outputTokens, 0) !== measuredOutput) {
    throw new Error('usageByModel totals do not match measured provider token usage');
  }
  return normalized;
}

export function measuredInvocationUsage(
  steps: Array<{ usage?: { inputTokens?: number; outputTokens?: number } }>,
  modelId: string,
  totalInputTokens: number,
  totalOutputTokens: number
): MeasuredModelUsage[] {
  const perStep = steps.map((step) => ({
    modelId,
    inputTokens: step.usage?.inputTokens,
    outputTokens: step.usage?.outputTokens
  }));
  if (perStep.length > 0 && perStep.every((usage) =>
    typeof usage.inputTokens === 'number' && typeof usage.outputTokens === 'number'
  )) {
    return normalizeMeasuredUsage(
      perStep as MeasuredModelUsage[],
      modelId,
      totalInputTokens,
      totalOutputTokens
    );
  }
  return normalizeMeasuredUsage(undefined, modelId, totalInputTokens, totalOutputTokens);
}

function tokenCount(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value < 0 || value > 2_000_000_000) throw new Error(`${label} must be a non-negative safe integer`);
  return value;
}

function mergeMeasuredUsage(...groups: MeasuredModelUsage[][]): MeasuredModelUsage[] {
  const merged = new Map<string, MeasuredModelUsage>();
  for (const usage of groups.flat()) {
    const current = merged.get(usage.modelId) ?? { modelId: usage.modelId, inputTokens: 0, outputTokens: 0 };
    current.inputTokens += usage.inputTokens;
    current.outputTokens += usage.outputTokens;
    merged.set(usage.modelId, current);
  }
  return [...merged.values()];
}

function costForMeasuredUsage(
  pricing: ModelPricingTable,
  usage: MeasuredModelUsage[],
  provider?: string | null
): number {
  return usage.reduce((sum, item) => {
    const price = lookupExecutionModelPrice(pricing, provider, item.modelId);
    if (!price) throw new Error(`Cannot account model usage because pricing is unknown for ${item.modelId}`);
    return sum + calculateModelCostMicros(price, item.inputTokens, item.outputTokens);
  }, 0);
}

export function lookupExecutionModelPrice(
  pricing: ModelPricingTable,
  provider: string | null | undefined,
  modelId: string | null | undefined
): ModelPrice | null {
  if (provider === 'CODEX') {
    if (!modelId || !isCodexModelAllowed(modelId)) return null;
    return {
      inputMicrosPerMillion: 0,
      outputMicrosPerMillion: 0,
      source: 'OpenAI ChatGPT subscription through Codex OAuth',
      version: 'codex-oauth-v1'
    };
  }
  return lookupModelPrice(pricing, modelId);
}

function traceModelParameters(task: BuildTask, price: ModelPrice | null, model?: string | null, chargedReservedCeiling = false): JsonValue {
  const policy = jsonRecord(task.executionPolicy);
  const defaults = defaultTaskBudget(task);
  return jsonSafe({
    modelTier: policy.modelTier ?? null,
    maxInputTokens: policy.maxInputTokens ?? defaults.maxInputTokens,
    maxOutputTokens: policy.maxOutputTokens ?? defaults.maxOutputTokens,
    maxToolCalls: policy.maxToolCalls ?? defaults.maxToolCalls,
    maxDurationMs: policy.maxDurationMs ?? defaults.maxDurationMs,
    fallbackModels: stringArray(policy.fallbackModels),
    retryOn: stringArray(policy.retryOn),
    pricing: price
      ? { status: 'configured', source: price.source, version: price.version }
      : { status: model ? 'unknown' : 'not-applicable', chargedReservedCeiling }
  }) as JsonValue;
}

function skillProvenancePins(catalog: AiSkillCatalogItem[], versions: Record<string, unknown>, projectId: string): SkillProvenancePin[] {
  return Object.entries(versions).map(([name, rawVersion]): SkillProvenancePin => {
    if (typeof rawVersion !== 'string') throw new Error(`Pinned skill version for ${name} is invalid`);
    const skill = catalog.find((candidate) => candidate.name === name);
    if (!skill) throw new Error(`Pinned skill ${name}@${rawVersion} is unavailable`);
    if (skill.manifest.version !== rawVersion) throw new Error(`Pinned skill ${name}@${rawVersion} resolved to ${skill.manifest.version}`);
    const builtIn = skill.native === true;
    const references = loadAiSkillReferences(skill).map((reference) => ({ name: reference.name, contentHash: stableHash(reference.content) }));
    return {
      name,
      version: rawVersion,
      source: builtIn ? 'built-in' : 'project-override',
      publisher: builtIn ? 'opentales' : `project:${projectId}`,
      trust: builtIn ? 'built-in' : 'project-owner',
      contentHash: stableHash(skill.content),
      manifestHash: stableHash(skill.manifest),
      capabilities: [...skill.manifest.allowedTools].sort(),
      references
    };
  }).sort((left, right) => left.name.localeCompare(right.name));
}

function jsonSafe(value: unknown): unknown {
  return JSON.parse(JSON.stringify(value));
}

function parseModelRouting(value: string | undefined): Partial<Record<'fast' | 'balanced' | 'strong' | 'judge', string[]>> {
  if (!value?.trim()) return {};
  let parsed: unknown;
  try { parsed = JSON.parse(value); } catch { throw new Error('AI_MODEL_ROUTING_JSON must be valid JSON'); }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('AI_MODEL_ROUTING_JSON must be an object');
  const result: Partial<Record<'fast' | 'balanced' | 'strong' | 'judge', string[]>> = {};
  for (const tier of ['fast', 'balanced', 'strong', 'judge'] as const) {
    const models = (parsed as Record<string, unknown>)[tier];
    if (models === undefined) continue;
    if (!Array.isArray(models) || models.some((model) => typeof model !== 'string' || !model.trim())) throw new Error(`AI_MODEL_ROUTING_JSON.${tier} must be a non-empty model-id array`);
    result[tier] = uniqueStrings(models as string[]);
  }
  return result;
}
