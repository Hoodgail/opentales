import type {
  BuildAutonomyMode as PrismaBuildAutonomyMode,
  BuildEvaluationKind as PrismaBuildEvaluationKind,
  BuildEvaluationResult as PrismaBuildEvaluationResult,
  BuildRunStatus as PrismaBuildRunStatus,
  BuildTaskStatus as PrismaBuildTaskStatus,
  BuildTrace as PrismaBuildTrace,
  BuildTraceStatus as PrismaBuildTraceStatus,
  CanonFact as PrismaCanonFact,
  CanonFactStatus as PrismaCanonFactStatus,
  EntityState as PrismaEntityState,
  EntityStateStatus as PrismaEntityStateStatus,
  OpenLoop as PrismaOpenLoop,
  OpenLoopKind as PrismaOpenLoopKind,
  OpenLoopStatus as PrismaOpenLoopStatus,
  PlotThread as PrismaPlotThread,
  PlotThreadKind as PrismaPlotThreadKind,
  PlotThreadStatus as PrismaPlotThreadStatus,
  Prisma,
  SetupPayoffLink as PrismaSetupPayoffLink,
  SetupPayoffStatus as PrismaSetupPayoffStatus,
  StoryArtifact as PrismaStoryArtifact,
  StoryArtifactLink as PrismaStoryArtifactLink,
  StoryArtifactStatus as PrismaStoryArtifactStatus,
  StoryArtifactType as PrismaStoryArtifactType,
  TimelineEvent as PrismaTimelineEvent
} from '@prisma/client';
import type {
  BuildAutonomyMode,
  BuildCheckpoint,
  BuildDirective,
  BuildEvaluationKind,
  BuildEvaluationResult,
  BuildManifest,
  BuildProgress,
  BuildRun,
  BuildRunStatus,
  BuildTask,
  BuildTaskStatus,
  BuildTrace,
  BuildTraceStatus,
  CanonFact,
  CanonFactStatus,
  EntityState,
  EntityStateStatus,
  JsonObject,
  JsonValue,
  OpenLoop,
  OpenLoopKind,
  OpenLoopStatus,
  PlotThread,
  PlotThreadKind,
  PlotThreadStatus,
  SetupPayoffLink,
  SetupPayoffStatus,
  StoryArtifact,
  StoryArtifactLink,
  StoryArtifactStatus,
  StoryArtifactType,
  StorySourceSpan,
  TimelineEvent
} from '@opentales/sdk';

export const buildRunInclude = {
  tasks: {
    orderBy: [{ priority: 'desc' }, { createdAt: 'asc' }],
    include: { transitions: { orderBy: { createdAt: 'asc' } } }
  },
  checkpoints: { orderBy: { sequence: 'desc' }, take: 1 },
  directives: { orderBy: { createdAt: 'desc' }, take: 1 }
} satisfies Prisma.BuildRunInclude;

export type BuildRunWithDetails = Prisma.BuildRunGetPayload<{ include: typeof buildRunInclude }>;
export type BuildTaskWithTransitions = BuildRunWithDetails['tasks'][number];

const AUTONOMY_TO_SDK: Record<PrismaBuildAutonomyMode, BuildAutonomyMode> = {
  ASSIST: 'assist',
  PLAN_REVIEW: 'plan-review',
  AUTONOMOUS_DRAFT: 'autonomous-draft'
};
const AUTONOMY_TO_PRISMA: Record<BuildAutonomyMode, PrismaBuildAutonomyMode> = invert(AUTONOMY_TO_SDK);
const RUN_STATUS_TO_SDK: Record<PrismaBuildRunStatus, BuildRunStatus> = {
  PLANNING: 'planning',
  DRAFTING: 'drafting',
  REVISING: 'revising',
  PAUSED: 'paused',
  COMPLETED: 'completed',
  FAILED: 'failed',
  CANCELLED: 'cancelled'
};
const RUN_STATUS_TO_PRISMA: Record<BuildRunStatus, PrismaBuildRunStatus> = invert(RUN_STATUS_TO_SDK);
const TASK_STATUS_TO_SDK: Record<PrismaBuildTaskStatus, BuildTaskStatus> = {
  BLOCKED: 'blocked',
  READY: 'ready',
  RUNNING: 'running',
  REVIEW: 'review',
  DONE: 'done',
  FAILED: 'failed',
  CANCELLED: 'cancelled'
};
const TASK_STATUS_TO_PRISMA: Record<BuildTaskStatus, PrismaBuildTaskStatus> = invert(TASK_STATUS_TO_SDK);
const ARTIFACT_TYPE_TO_SDK: Record<PrismaStoryArtifactType, StoryArtifactType> = {
  STORY_BRIEF: 'story-brief',
  NARRATIVE_CONTRACT: 'narrative-contract',
  CHARACTER_BIBLE: 'character-bible',
  RELATIONSHIP_GRAPH: 'relationship-graph',
  WORLD_BIBLE: 'world-bible',
  PLOT_THREAD: 'plot-thread',
  ACT_ARCHITECTURE: 'act-architecture',
  CHAPTER_BRIEF: 'chapter-brief',
  SCENE_PLAN: 'scene-plan',
  TIMELINE: 'timeline',
  SETUP_PAYOFF_MAP: 'setup-payoff-map',
  RESEARCH_QUESTIONS: 'research-questions',
  OPEN_QUESTIONS: 'open-questions',
  BEAT: 'beat',
  CHAPTER_DRAFT: 'chapter-draft',
  REVISION_ISSUE: 'revision-issue'
  ,FINALE_PLAN: 'finale-plan'
  ,EXPORT_MANIFEST: 'export-manifest'
};
const ARTIFACT_TYPE_TO_PRISMA: Record<StoryArtifactType, PrismaStoryArtifactType> = invert(ARTIFACT_TYPE_TO_SDK);
const ARTIFACT_STATUS_TO_SDK: Record<PrismaStoryArtifactStatus, StoryArtifactStatus> = {
  DRAFT: 'draft',
  VALIDATED: 'validated',
  ACCEPTED: 'accepted',
  SUPERSEDED: 'superseded',
  INVALIDATED: 'invalidated'
};
const ARTIFACT_STATUS_TO_PRISMA: Record<StoryArtifactStatus, PrismaStoryArtifactStatus> = invert(ARTIFACT_STATUS_TO_SDK);
const CANON_STATUS_TO_SDK: Record<PrismaCanonFactStatus, CanonFactStatus> = {
  PROPOSED: 'proposed',
  CANONICAL: 'canonical',
  DISPUTED: 'disputed',
  RETRACTED: 'retracted',
  INVALIDATED: 'invalidated'
};
const CANON_STATUS_TO_PRISMA: Record<CanonFactStatus, PrismaCanonFactStatus> = invert(CANON_STATUS_TO_SDK);
const ENTITY_STATUS_TO_SDK: Record<PrismaEntityStateStatus, EntityStateStatus> = {
  PROPOSED: 'proposed',
  ACTIVE: 'active',
  SUPERSEDED: 'superseded',
  INVALIDATED: 'invalidated'
};
const ENTITY_STATUS_TO_PRISMA: Record<EntityStateStatus, PrismaEntityStateStatus> = invert(ENTITY_STATUS_TO_SDK);
const LOOP_KIND_TO_SDK: Record<PrismaOpenLoopKind, OpenLoopKind> = lowerHyphenMap(['PROMISE', 'QUESTION', 'CLUE', 'SETUP', 'MYSTERY', 'FORESHADOWING', 'OTHER']);
const LOOP_KIND_TO_PRISMA: Record<OpenLoopKind, PrismaOpenLoopKind> = invert(LOOP_KIND_TO_SDK);
const LOOP_STATUS_TO_SDK: Record<PrismaOpenLoopStatus, OpenLoopStatus> = lowerHyphenMap(['OPEN', 'REINFORCED', 'RESOLVED', 'ABANDONED', 'INVALIDATED']);
const LOOP_STATUS_TO_PRISMA: Record<OpenLoopStatus, PrismaOpenLoopStatus> = invert(LOOP_STATUS_TO_SDK);
const SETUP_STATUS_TO_SDK: Record<PrismaSetupPayoffStatus, SetupPayoffStatus> = {
  PLANNED: 'planned',
  SETUP: 'setup',
  REINFORCED: 'reinforced',
  PAID_OFF: 'paid-off',
  ABANDONED: 'abandoned',
  INVALIDATED: 'invalidated'
};
const SETUP_STATUS_TO_PRISMA: Record<SetupPayoffStatus, PrismaSetupPayoffStatus> = invert(SETUP_STATUS_TO_SDK);
const THREAD_KIND_TO_SDK: Record<PrismaPlotThreadKind, PlotThreadKind> = {
  MAIN: 'main',
  SUBPLOT: 'subplot',
  CHARACTER_ARC: 'character-arc',
  MYSTERY: 'mystery',
  ROMANCE: 'romance',
  THEMATIC: 'thematic',
  OTHER: 'other'
};
const THREAD_KIND_TO_PRISMA: Record<PlotThreadKind, PrismaPlotThreadKind> = invert(THREAD_KIND_TO_SDK);
const THREAD_STATUS_TO_SDK: Record<PrismaPlotThreadStatus, PlotThreadStatus> = lowerHyphenMap(['PLANNED', 'ACTIVE', 'RESOLVED', 'ABANDONED', 'INVALIDATED']);
const THREAD_STATUS_TO_PRISMA: Record<PlotThreadStatus, PrismaPlotThreadStatus> = invert(THREAD_STATUS_TO_SDK);
const TRACE_STATUS_TO_SDK: Record<PrismaBuildTraceStatus, BuildTraceStatus> = lowerHyphenMap(['STARTED', 'COMPLETED', 'FAILED']);
const TRACE_STATUS_TO_PRISMA: Record<BuildTraceStatus, PrismaBuildTraceStatus> = invert(TRACE_STATUS_TO_SDK);
const EVAL_KIND_TO_SDK: Record<PrismaBuildEvaluationKind, BuildEvaluationKind> = lowerHyphenMap(['DETERMINISTIC', 'MODEL', 'HUMAN']);
const EVAL_KIND_TO_PRISMA: Record<BuildEvaluationKind, PrismaBuildEvaluationKind> = invert(EVAL_KIND_TO_SDK);

export const toPrismaAutonomyMode = (value: BuildAutonomyMode) => AUTONOMY_TO_PRISMA[value];
export const toPrismaRunStatus = (value: BuildRunStatus) => RUN_STATUS_TO_PRISMA[value];
export const toPrismaTaskStatus = (value: BuildTaskStatus) => TASK_STATUS_TO_PRISMA[value];
export const toPrismaArtifactType = (value: StoryArtifactType) => ARTIFACT_TYPE_TO_PRISMA[value];
export const toPrismaArtifactStatus = (value: StoryArtifactStatus) => ARTIFACT_STATUS_TO_PRISMA[value];
export const toPrismaCanonStatus = (value: CanonFactStatus) => CANON_STATUS_TO_PRISMA[value];
export const toPrismaEntityStateStatus = (value: EntityStateStatus) => ENTITY_STATUS_TO_PRISMA[value];
export const toPrismaOpenLoopKind = (value: OpenLoopKind) => LOOP_KIND_TO_PRISMA[value];
export const toPrismaOpenLoopStatus = (value: OpenLoopStatus) => LOOP_STATUS_TO_PRISMA[value];
export const toPrismaSetupPayoffStatus = (value: SetupPayoffStatus) => SETUP_STATUS_TO_PRISMA[value];
export const toPrismaPlotThreadKind = (value: PlotThreadKind) => THREAD_KIND_TO_PRISMA[value];
export const toPrismaPlotThreadStatus = (value: PlotThreadStatus) => THREAD_STATUS_TO_PRISMA[value];
export const toPrismaTraceStatus = (value: BuildTraceStatus) => TRACE_STATUS_TO_PRISMA[value];
export const toPrismaEvaluationKind = (value: BuildEvaluationKind) => EVAL_KIND_TO_PRISMA[value];

export function toBuildRun(run: BuildRunWithDetails): BuildRun {
  const tasks = run.tasks.map(toBuildTask);
  return {
    id: run.id,
    projectId: run.projectId,
    objective: run.objective,
    brainstorm: run.brainstorm,
    manifest: run.manifest as unknown as BuildManifest,
    autonomyMode: AUTONOMY_TO_SDK[run.autonomyMode],
    status: RUN_STATUS_TO_SDK[run.status],
    currentPhase: run.currentPhase,
    workflowVersion: run.workflowVersion,
    branchName: run.branchName,
    authorizationScope: run.authorizationScope as unknown as BuildRun['authorizationScope'],
    maxTokens: run.maxTokens,
    tokensUsed: run.tokensUsed,
    tokensReserved: run.tokensReserved,
    maxCostMicros: run.maxCostMicros,
    costMicrosUsed: run.costMicrosUsed,
    costMicrosReserved: run.costMicrosReserved,
    revision: run.revision,
    executionGeneration: run.executionGeneration,
    lastError: run.lastError,
    authorizedAt: iso(run.authorizedAt),
    pausedAt: iso(run.pausedAt),
    completedAt: iso(run.completedAt),
    failedAt: iso(run.failedAt),
    cancelledAt: iso(run.cancelledAt),
    createdAt: run.createdAt.toISOString(),
    updatedAt: run.updatedAt.toISOString(),
    progress: buildProgress(tasks),
    tasks,
    latestCheckpoint: run.checkpoints[0] ? toBuildCheckpoint(run.checkpoints[0]) : null,
    activeDirective: run.directives[0] ? toBuildDirective(run.directives[0]) : null
  };
}

export function toBuildDirective(directive: Prisma.BuildDirectiveGetPayload<object>): BuildDirective {
  return {
    id: directive.id,
    projectId: directive.projectId,
    buildRunId: directive.buildRunId,
    fromTaskId: directive.fromTaskId,
    checkpointId: directive.checkpointId,
    directive: directive.directive,
    pinnedArtifactIds: directive.pinnedArtifactIds,
    createdAt: directive.createdAt.toISOString()
  };
}

export function toBuildTask(task: BuildTaskWithTransitions): BuildTask {
  return {
    id: task.id,
    buildRunId: task.buildRunId,
    key: task.key,
    type: task.type,
    phase: task.phase,
    status: TASK_STATUS_TO_SDK[task.status],
    dependencyIds: task.dependencyIds,
    inputArtifactIds: task.inputArtifactIds,
    outputArtifactIds: task.outputArtifactIds,
    scopeUnitIds: task.scopeUnitIds,
    assignedAgent: task.assignedAgent,
    skillVersions: task.skillVersions as unknown as JsonObject,
    acceptanceCriteria: task.acceptanceCriteria as unknown as JsonValue,
    executionPolicy: task.executionPolicy as unknown as JsonValue,
    attempts: task.attempts,
    maxAttempts: task.maxAttempts,
    revisionIteration: task.revisionIteration,
    maxRevisionIterations: task.maxRevisionIterations,
    qualityThreshold: task.qualityThreshold,
    priority: task.priority,
    progress: task.progress,
    revision: task.revision,
    leaseOwner: task.leaseOwner,
    leaseGeneration: task.leaseGeneration,
    runGeneration: task.runGeneration,
    reservedTokens: task.reservedTokens,
    reservedCostMicros: task.reservedCostMicros,
    leaseExpiresAt: iso(task.leaseExpiresAt),
    heartbeatAt: iso(task.heartbeatAt),
    startedAt: iso(task.startedAt),
    completedAt: iso(task.completedAt),
    failedAt: iso(task.failedAt),
    cancelledAt: iso(task.cancelledAt),
    invalidatedAt: iso(task.invalidatedAt),
    lastError: task.lastError,
    createdAt: task.createdAt.toISOString(),
    updatedAt: task.updatedAt.toISOString(),
    transitions: task.transitions.map((transition) => ({
      id: transition.id,
      taskId: transition.taskId,
      fromStatus: TASK_STATUS_TO_SDK[transition.fromStatus],
      toStatus: TASK_STATUS_TO_SDK[transition.toStatus],
      idempotencyKey: transition.idempotencyKey,
      reason: transition.reason,
      metadata: transition.metadata as unknown as JsonValue | null,
      createdAt: transition.createdAt.toISOString()
    }))
  };
}

export function toBuildCheckpoint(checkpoint: Prisma.BuildCheckpointGetPayload<object>): BuildCheckpoint {
  return {
    id: checkpoint.id,
    projectId: checkpoint.projectId,
    buildRunId: checkpoint.buildRunId,
    taskId: checkpoint.taskId,
    sequence: checkpoint.sequence,
    label: checkpoint.label,
    phase: checkpoint.phase,
    stateSnapshot: checkpoint.stateSnapshot as unknown as JsonValue,
    contentHash: checkpoint.contentHash,
    createdAt: checkpoint.createdAt.toISOString()
  };
}

export function toStoryArtifact(artifact: PrismaStoryArtifact): StoryArtifact {
  return {
    id: artifact.id,
    projectId: artifact.projectId,
    buildRunId: artifact.buildRunId,
    taskId: artifact.taskId,
    type: ARTIFACT_TYPE_TO_SDK[artifact.type],
    key: artifact.key,
    title: artifact.title,
    version: artifact.version,
    schemaVersion: artifact.schemaVersion,
    status: ARTIFACT_STATUS_TO_SDK[artifact.status],
    content: artifact.content as unknown as StoryArtifact['content'],
    contentHash: artifact.contentHash,
    replacesArtifactId: artifact.replacesArtifactId,
    acceptedAt: iso(artifact.acceptedAt),
    invalidatedAt: iso(artifact.invalidatedAt),
    createdAt: artifact.createdAt.toISOString(),
    updatedAt: artifact.updatedAt.toISOString()
  };
}

export function toStoryArtifactLink(link: PrismaStoryArtifactLink): StoryArtifactLink {
  return { ...link, metadata: link.metadata as unknown as JsonValue | null, createdAt: link.createdAt.toISOString() };
}

export function toCanonFact(fact: PrismaCanonFact): CanonFact {
  return {
    ...fact,
    status: CANON_STATUS_TO_SDK[fact.status],
    object: fact.object as unknown as JsonValue,
    sourceSpan: fact.sourceSpan as unknown as StorySourceSpan | null,
    invalidatedAt: iso(fact.invalidatedAt),
    createdAt: fact.createdAt.toISOString(),
    updatedAt: fact.updatedAt.toISOString()
  };
}

export function toEntityState(state: PrismaEntityState): EntityState {
  return {
    ...state,
    status: ENTITY_STATUS_TO_SDK[state.status],
    value: state.value as unknown as JsonValue,
    sourceSpan: state.sourceSpan as unknown as StorySourceSpan | null,
    invalidatedAt: iso(state.invalidatedAt),
    createdAt: state.createdAt.toISOString(),
    updatedAt: state.updatedAt.toISOString()
  };
}

export function toTimelineEvent(event: PrismaTimelineEvent): TimelineEvent {
  return {
    ...event,
    chronology: event.chronology as unknown as JsonValue,
    participantRefs: event.participantRefs as unknown as TimelineEvent['participantRefs'],
    sourceSpan: event.sourceSpan as unknown as StorySourceSpan | null,
    invalidatedAt: iso(event.invalidatedAt),
    createdAt: event.createdAt.toISOString(),
    updatedAt: event.updatedAt.toISOString()
  };
}

export function toOpenLoop(loop: PrismaOpenLoop): OpenLoop {
  return {
    ...loop,
    kind: LOOP_KIND_TO_SDK[loop.kind],
    status: LOOP_STATUS_TO_SDK[loop.status],
    metadata: loop.metadata as unknown as JsonValue | null,
    invalidatedAt: iso(loop.invalidatedAt),
    createdAt: loop.createdAt.toISOString(),
    updatedAt: loop.updatedAt.toISOString()
  };
}

export function toSetupPayoff(link: PrismaSetupPayoffLink): SetupPayoffLink {
  return {
    ...link,
    status: SETUP_STATUS_TO_SDK[link.status],
    metadata: link.metadata as unknown as JsonValue | null,
    invalidatedAt: iso(link.invalidatedAt),
    createdAt: link.createdAt.toISOString(),
    updatedAt: link.updatedAt.toISOString()
  };
}

export function toPlotThread(thread: PrismaPlotThread): PlotThread {
  return {
    ...thread,
    kind: THREAD_KIND_TO_SDK[thread.kind],
    status: THREAD_STATUS_TO_SDK[thread.status],
    metadata: thread.metadata as unknown as JsonValue | null,
    invalidatedAt: iso(thread.invalidatedAt),
    createdAt: thread.createdAt.toISOString(),
    updatedAt: thread.updatedAt.toISOString()
  };
}

export function toBuildTrace(trace: PrismaBuildTrace): BuildTrace {
  return {
    ...trace,
    status: TRACE_STATUS_TO_SDK[trace.status],
    modelParameters: trace.modelParameters as unknown as JsonValue | null,
    skillVersions: trace.skillVersions as unknown as JsonValue,
    toolSchemaVersions: trace.toolSchemaVersions as unknown as JsonValue,
    inputs: trace.inputs as unknown as JsonValue,
    toolCalls: trace.toolCalls as unknown as JsonValue,
    toolResults: trace.toolResults as unknown as JsonValue,
    outputs: trace.outputs as unknown as JsonValue,
    validatorResults: trace.validatorResults as unknown as JsonValue,
    startedAt: trace.startedAt.toISOString(),
    completedAt: iso(trace.completedAt)
  };
}

export function toBuildEvaluation(result: PrismaBuildEvaluationResult): BuildEvaluationResult {
  return {
    ...result,
    kind: EVAL_KIND_TO_SDK[result.kind],
    scores: result.scores as unknown as JsonValue,
    checks: result.checks as unknown as JsonValue,
    evidence: result.evidence as unknown as JsonValue | null,
    createdAt: result.createdAt.toISOString()
  };
}

function buildProgress(tasks: BuildTask[]): BuildProgress {
  const counts: Record<BuildTaskStatus, number> = {
    blocked: 0,
    ready: 0,
    running: 0,
    review: 0,
    done: 0,
    failed: 0,
    cancelled: 0
  };
  tasks.forEach((task) => { counts[task.status] += 1; });
  const total = tasks.length;
  const weighted = tasks.reduce((sum, task) => sum + (task.status === 'done' ? 100 : task.progress), 0);
  return { percent: total ? Math.round(weighted / total) : 0, total, ...counts };
}

function iso(value: Date | null): string | null {
  return value ? value.toISOString() : null;
}

function invert<K extends string, V extends string>(map: Record<K, V>): Record<V, K> {
  return Object.fromEntries(Object.entries(map).map(([key, value]) => [value, key])) as Record<V, K>;
}

function lowerHyphenMap<T extends string>(values: readonly T[]): Record<T, Lowercase<T>> {
  return Object.fromEntries(values.map((value) => [value, value.toLowerCase().replaceAll('_', '-')])) as Record<T, Lowercase<T>>;
}
