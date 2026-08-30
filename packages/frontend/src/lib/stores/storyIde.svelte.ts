import {
  ApiError,
  OpenTalesClient,
  type AuthorizeBuildRunInput,
  type ApplyStoryStateBatchResult,
  type BuildComparison,
  type BuildCompilation,
  type BuildEvaluationResult,
  type BuildManuscriptUnit,
  type BuildObservability,
  type BuildReview,
  type BuildRun,
  type BuildTask,
  type BuildTrace,
  type CanonFact,
  type CreateBuildReviewInput,
  type CreateBuildRunInput,
  type EntityState,
  type FindStoryReferencesInput,
  type FindStoryReferencesResult,
  type JsonValue,
  type OpenLoop,
  type PatchBuildManuscriptUnitInput,
  type PlotThread,
  type Scene,
  type SearchStoryInput,
  type SetupPayoffLink,
  type StoryArtifact,
  type StoryArtifactStatus,
  type StoryDiagnosticsResult,
  type StorySearchResult,
  type StoryStateBatchOperation,
  type StoryStateEntityKind,
  type StoryStateHistoryResult,
  type StoryStateSnapshot,
  type TimelineEvent,
  type UpdateSceneInput
} from '@opentales/sdk';
import type {
  ApplyRenameSymbolInput,
  ApplyRenameSymbolResult,
  RenameSymbolInput,
  RenameSymbolPreview
} from '$lib/rename-symbol-ui';

const api = new OpenTalesClient({
  baseUrl: import.meta.env.VITE_API_URL ?? 'http://localhost:4000',
  token: browserLocalStorage().getItem('opentales.token') ?? undefined
});

function browserLocalStorage(): Storage {
  if (typeof localStorage !== 'undefined') return localStorage;
  return {
    length: 0,
    clear: () => undefined,
    getItem: () => null,
    key: () => null,
    removeItem: () => undefined,
    setItem: () => undefined
  };
}

export function syncStoryIdeToken(token: string | undefined) {
  api.setToken(token);
}

function key(): string {
  return crypto.randomUUID();
}

function stableValue(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableValue).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([name, child]) => `${JSON.stringify(name)}:${stableValue(child)}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

function isAmbiguousMutationError(error: unknown): boolean {
  return !(error instanceof ApiError) || error.status >= 500 || error.status === 409;
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

function uniqueById<T extends { id: string }>(values: T[]): T[] {
  return [...new Map(values.map((value) => [value.id, value])).values()];
}

function currentOnly<T extends { isCurrent?: boolean; invalidatedAt?: string | null }>(values: T[]): T[] {
  return values.filter((value) => value.isCurrent !== false && !value.invalidatedAt);
}

export type StoryIdeConnection = 'idle' | 'syncing' | 'connected' | 'reconnecting' | 'stale';

export function createStoryIdeStore() {
  const runs = $state<BuildRun[]>([]);
  let projectId = $state<string | null>(null);
  let selectedRunId = $state<string | null>(null);
  let selectedRun = $state<BuildRun | null>(null);
  const artifacts = $state<StoryArtifact[]>([]);
  let snapshot = $state<StoryStateSnapshot | null>(null);
  const traces = $state<BuildTrace[]>([]);
  const evaluations = $state<BuildEvaluationResult[]>([]);
  const units = $state<BuildManuscriptUnit[]>([]);
  const reviews = $state<BuildReview[]>([]);
  let histories = $state<Record<string, StoryStateHistoryResult>>({});
  let observability = $state<BuildObservability | null>(null);
  let compilation = $state<BuildCompilation | null>(null);
  let comparison = $state<BuildComparison | null>(null);
  let diagnostics = $state<StoryDiagnosticsResult | null>(null);
  let searchResult = $state<StorySearchResult | null>(null);
  let referencesResult = $state<FindStoryReferencesResult | null>(null);
  let loadingRuns = $state(false);
  let loadingDetails = $state(false);
  let searching = $state(false);
  let mutating = $state(false);
  let error = $state<string | null>(null);
  let detailWarning = $state<string | null>(null);
  let connection = $state<StoryIdeConnection>('idle');
  let consecutivePollFailures = $state(0);
  let lastUpdatedAt = $state<string | null>(null);
  let detailsRevision = -1;
  let searchRequest = 0;
  let referenceRequest = 0;
  const mutationKeys = new Map<string, string>();

  function stableMutationKey(operation: string, payload: unknown): string {
    const identity = `${operation}:${stableValue(payload)}`;
    const existing = mutationKeys.get(identity);
    if (existing) return existing;
    const created = key();
    mutationKeys.set(identity, created);
    return created;
  }

  function finishMutation(operation: string, payload: unknown) {
    mutationKeys.delete(`${operation}:${stableValue(payload)}`);
  }

  function setRun(run: BuildRun) {
    selectedRun = run;
    selectedRunId = run.id;
    const index = runs.findIndex((candidate) => candidate.id === run.id);
    if (index >= 0) runs[index] = run;
    else runs.unshift(run);
  }

  function clearDetails() {
    artifacts.splice(0, artifacts.length);
    snapshot = null;
    traces.splice(0, traces.length);
    evaluations.splice(0, evaluations.length);
    units.splice(0, units.length);
    reviews.splice(0, reviews.length);
    histories = {};
    observability = null;
    compilation = null;
    comparison = null;
    diagnostics = null;
    searchResult = null;
    referencesResult = null;
    detailsRevision = -1;
    searchRequest += 1;
    referenceRequest += 1;
  }

  function reset(nextProjectId: string | null = null) {
    projectId = nextProjectId;
    runs.splice(0, runs.length);
    selectedRunId = null;
    selectedRun = null;
    clearDetails();
    error = null;
    detailWarning = null;
    connection = nextProjectId ? 'idle' : 'idle';
    consecutivePollFailures = 0;
    lastUpdatedAt = null;
    mutationKeys.clear();
  }

  async function reconcileMutationFailure(caught: unknown, fallback: string) {
    const message = errorMessage(caught, fallback);
    if (isAmbiguousMutationError(caught) && projectId && selectedRunId) {
      detailsRevision = -1;
      await loadDetails(projectId, selectedRunId, true).catch(() => undefined);
    }
    error = message;
  }

  async function loadRuns(nextProjectId: string, force = false) {
    if (loadingRuns) return;
    if (projectId !== nextProjectId) reset(nextProjectId);
    if (!force && runs.length) return;
    loadingRuns = true;
    error = null;
    try {
      const result = await api.listBuildRuns(nextProjectId);
      runs.splice(0, runs.length, ...result);
      if (selectedRunId) {
        const current = result.find((run) => run.id === selectedRunId);
        if (current) selectedRun = current;
      }
    } catch (caught) {
      error = errorMessage(caught, 'Failed to load Novel Builds');
    } finally {
      loadingRuns = false;
    }
  }

  async function loadEveryArtifact(nextProjectId: string, buildRunId: string): Promise<StoryArtifact[]> {
    const result: StoryArtifact[] = [];
    let offset = 0;
    for (let page = 0; page < 100; page += 1) {
      const response = await api.listStoryArtifacts(nextProjectId, buildRunId, { limit: 500, offset });
      result.push(...response.items);
      if (response.nextOffset === null) break;
      offset = response.nextOffset;
    }
    return uniqueById(result);
  }

  async function loadEveryObservation(nextProjectId: string, buildRunId: string): Promise<BuildObservability> {
    const combined: BuildObservability = {
      projectId: nextProjectId,
      buildRunId,
      traces: [],
      evaluations: [],
      checkpoints: [],
      directives: []
    };
    const limit = 500;
    for (let offset = 0, page = 0; page < 100; page += 1, offset += limit) {
      const response = await api.getBuildObservability(nextProjectId, buildRunId, { limit, offset });
      combined.traces.push(...response.traces);
      combined.evaluations.push(...response.evaluations);
      combined.checkpoints.push(...response.checkpoints);
      combined.directives.push(...response.directives);
      if (Math.max(response.traces.length, response.evaluations.length, response.checkpoints.length, response.directives.length) < limit) break;
    }
    combined.traces = uniqueById(combined.traces);
    combined.evaluations = uniqueById(combined.evaluations);
    combined.checkpoints = uniqueById(combined.checkpoints);
    combined.directives = uniqueById(combined.directives);
    return combined;
  }

  async function loadEveryStoryState(nextProjectId: string, buildRunId: string): Promise<StoryStateSnapshot> {
    const result: StoryStateSnapshot = {
      projectId: nextProjectId,
      buildRunId,
      canonFacts: [],
      entityStates: [],
      timelineEvents: [],
      openLoops: [],
      setupPayoffs: [],
      plotThreads: []
    };
    let offset = 0;
    for (let page = 0; page < 100; page += 1) {
      const response = await api.getStoryStateDelta(nextProjectId, buildRunId, { limit: 500, offset });
      result.canonFacts.push(...response.canonFacts);
      result.entityStates.push(...response.entityStates);
      result.timelineEvents.push(...response.timelineEvents);
      result.openLoops.push(...response.openLoops);
      result.setupPayoffs.push(...response.setupPayoffs);
      result.plotThreads.push(...response.plotThreads);
      if (response.nextOffset === null) break;
      offset = response.nextOffset;
    }
    result.canonFacts = currentOnly(uniqueById(result.canonFacts));
    result.entityStates = currentOnly(uniqueById(result.entityStates));
    result.timelineEvents = currentOnly(uniqueById(result.timelineEvents));
    result.openLoops = currentOnly(uniqueById(result.openLoops));
    result.setupPayoffs = currentOnly(uniqueById(result.setupPayoffs));
    result.plotThreads = currentOnly(uniqueById(result.plotThreads));
    return result;
  }

  async function loadSupportingDetails(nextProjectId: string, buildRunId: string, runRevision: number) {
    const [artifactResult, stateResult, observationResult, diagnosticsResult, unitResult, reviewResult, comparisonResult] = await Promise.allSettled([
      loadEveryArtifact(nextProjectId, buildRunId),
      loadEveryStoryState(nextProjectId, buildRunId),
      loadEveryObservation(nextProjectId, buildRunId),
      api.getStoryDiagnostics(nextProjectId, buildRunId),
      api.listBuildManuscriptUnits(nextProjectId, buildRunId),
      api.listBuildReviews(nextProjectId, buildRunId),
      api.compareBuildManuscript(nextProjectId, buildRunId)
    ]);
    if (selectedRunId !== buildRunId) return;
    const warnings: string[] = [];
    if (artifactResult.status === 'fulfilled') artifacts.splice(0, artifacts.length, ...artifactResult.value);
    else { artifacts.splice(0, artifacts.length); warnings.push(errorMessage(artifactResult.reason, 'Artifacts unavailable')); }
    if (stateResult.status === 'fulfilled') snapshot = stateResult.value;
    else { snapshot = null; warnings.push(errorMessage(stateResult.reason, 'Story state unavailable')); }
    if (observationResult.status === 'fulfilled') {
      observability = observationResult.value;
      traces.splice(0, traces.length, ...observationResult.value.traces);
      evaluations.splice(0, evaluations.length, ...observationResult.value.evaluations);
    } else {
      observability = null;
      traces.splice(0, traces.length);
      evaluations.splice(0, evaluations.length);
      warnings.push(errorMessage(observationResult.reason, 'Build observability unavailable'));
    }
    if (diagnosticsResult.status === 'fulfilled') diagnostics = diagnosticsResult.value;
    else { diagnostics = null; warnings.push(errorMessage(diagnosticsResult.reason, 'Story diagnostics unavailable')); }
    if (unitResult.status === 'fulfilled') units.splice(0, units.length, ...unitResult.value);
    else { units.splice(0, units.length); warnings.push(errorMessage(unitResult.reason, 'Build manuscript unavailable')); }
    if (reviewResult.status === 'fulfilled') reviews.splice(0, reviews.length, ...reviewResult.value);
    else { reviews.splice(0, reviews.length); warnings.push(errorMessage(reviewResult.reason, 'Build reviews unavailable')); }
    if (comparisonResult.status === 'fulfilled') comparison = comparisonResult.value;
    else { comparison = null; warnings.push(errorMessage(comparisonResult.reason, 'Build comparison unavailable')); }
    const compilationId = reviewResult.status === 'fulfilled'
      ? reviewResult.value[0]?.compilationId ?? (comparisonResult.status === 'fulfilled' ? comparisonResult.value.compilationId : null)
      : comparisonResult.status === 'fulfilled' ? comparisonResult.value.compilationId : null;
    if (compilationId) {
      try {
        compilation = await api.getBuildCompilation(nextProjectId, buildRunId, compilationId);
      } catch (caught) {
        compilation = null;
        warnings.push(errorMessage(caught, 'Build compilation unavailable'));
      }
    } else {
      compilation = null;
    }
    if (selectedRunId !== buildRunId) return;
    detailWarning = warnings.length ? warnings.join(' · ') : null;
    detailsRevision = runRevision;
  }

  async function loadDetails(nextProjectId: string, buildRunId: string, quiet = false) {
    if (!quiet) loadingDetails = true;
    if (!quiet) error = null;
    connection = quiet ? 'syncing' : 'syncing';
    try {
      const run = await api.getBuildRun(nextProjectId, buildRunId);
      if (selectedRunId && selectedRunId !== buildRunId) return;
      setRun(run);
      if (!quiet || detailsRevision !== run.revision || detailWarning) {
        await loadSupportingDetails(nextProjectId, buildRunId, run.revision);
      }
      consecutivePollFailures = 0;
      connection = 'connected';
      error = null;
      lastUpdatedAt = new Date().toISOString();
    } catch (caught) {
      consecutivePollFailures += 1;
      connection = consecutivePollFailures >= 3 ? 'stale' : 'reconnecting';
      error = errorMessage(caught, 'Failed to refresh Novel Build');
    } finally {
      if (!quiet) loadingDetails = false;
    }
  }

  async function selectRun(nextProjectId: string, buildRunId: string) {
    if (projectId !== nextProjectId) reset(nextProjectId);
    if (selectedRunId !== buildRunId) clearDetails();
    selectedRunId = buildRunId;
    const summary = runs.find((run) => run.id === buildRunId);
    if (summary) selectedRun = summary;
    await loadDetails(nextProjectId, buildRunId);
  }

  async function refreshSelected(quiet = false) {
    if (!projectId || !selectedRunId) return;
    await loadDetails(projectId, selectedRunId, quiet);
  }

  function beginNew() {
    selectedRunId = null;
    selectedRun = null;
    clearDetails();
    error = null;
    detailWarning = null;
    connection = 'idle';
  }

  async function createRun(nextProjectId: string, input: CreateBuildRunInput): Promise<BuildRun | null> {
    mutating = true;
    error = null;
    try {
      const run = await api.createBuildRun(nextProjectId, input);
      setRun(run);
      await loadDetails(nextProjectId, run.id);
      return run;
    } catch (caught) {
      error = errorMessage(caught, 'Failed to start Novel Build');
      return null;
    } finally {
      mutating = false;
    }
  }

  async function mutateRun(
    operationName: string,
    payload: (run: BuildRun) => unknown,
    operation: (run: BuildRun, idempotencyKey: string) => Promise<BuildRun>,
    fallback: string
  ) {
    if (!selectedRun) return;
    const run = selectedRun;
    const identity = payload(run);
    const idempotencyKey = stableMutationKey(operationName, identity);
    mutating = true;
    error = null;
    try {
      setRun(await operation(run, idempotencyKey));
      finishMutation(operationName, identity);
      await refreshSelected(true);
    } catch (caught) {
      await reconcileMutationFailure(caught, fallback);
    } finally {
      mutating = false;
    }
  }

  async function authorizeRun(
    run: BuildRun,
    authorization?: Pick<AuthorizeBuildRunInput, 'authorizationScope' | 'maxTokens' | 'maxCostMicros'>
  ) {
    const requested = {
      authorizationScope: authorization?.authorizationScope ?? run.authorizationScope,
      maxTokens: authorization?.maxTokens === undefined ? run.maxTokens : authorization.maxTokens,
      maxCostMicros: authorization?.maxCostMicros === undefined ? run.maxCostMicros : authorization.maxCostMicros
    };
    await mutateRun(
      'authorize-run',
      (current) => ({ runId: current.id, revision: current.revision, ...requested }),
      (current, idempotencyKey) => api.authorizeBuildRun(current.projectId, current.id, {
        idempotencyKey,
        expectedRevision: current.revision,
        ...requested
      }),
      'Failed to authorize Novel Build'
    );
  }

  async function pauseRun() {
    await mutateRun('pause-run', (run) => ({ runId: run.id, revision: run.revision }), (run, idempotencyKey) => api.pauseBuildRun(run.projectId, run.id, { idempotencyKey, expectedRevision: run.revision, reason: 'Paused by writer' }), 'Failed to pause Novel Build');
  }

  async function resumeRun() {
    await mutateRun('resume-run', (run) => ({ runId: run.id, revision: run.revision }), (run, idempotencyKey) => api.resumeBuildRun(run.projectId, run.id, { idempotencyKey, expectedRevision: run.revision, reason: 'Resumed by writer' }), 'Failed to resume Novel Build');
  }

  async function cancelRun() {
    await mutateRun('cancel-run', (run) => ({ runId: run.id, revision: run.revision }), (run, idempotencyKey) => api.cancelBuildRun(run.projectId, run.id, { idempotencyKey, expectedRevision: run.revision, reason: 'Cancelled by writer' }), 'Failed to cancel Novel Build');
  }

  async function retryTask(task: BuildTask) {
    if (!selectedRun) return;
    const identity = { runId: selectedRun.id, runRevision: selectedRun.revision, taskId: task.id, taskRevision: task.revision };
    const idempotencyKey = stableMutationKey('retry-task', identity);
    mutating = true;
    error = null;
    try {
      const result = await api.retryBuildTask(selectedRun.projectId, selectedRun.id, task.id, { idempotencyKey, expectedRevision: selectedRun.revision, reason: 'Retry requested by writer' });
      setRun(result.buildRun);
      finishMutation('retry-task', identity);
      await refreshSelected(true);
    } catch (caught) {
      await reconcileMutationFailure(caught, 'Failed to retry task');
    } finally {
      mutating = false;
    }
  }

  async function rerunTask(task: BuildTask, reason?: string) {
    if (!selectedRun) return;
    const identity = { runId: selectedRun.id, runRevision: selectedRun.revision, taskId: task.id, taskRevision: task.revision, reason: reason ?? null };
    const idempotencyKey = stableMutationKey('rerun-task', identity);
    mutating = true;
    error = null;
    try {
      const result = await api.rerunBuildTask(selectedRun.projectId, selectedRun.id, task.id, { idempotencyKey, expectedRevision: selectedRun.revision, reason });
      setRun(result.buildRun);
      finishMutation('rerun-task', identity);
      await refreshSelected(true);
    } catch (caught) {
      await reconcileMutationFailure(caught, 'Failed to rerun task');
    } finally {
      mutating = false;
    }
  }

  async function replanTask(
    task: BuildTask,
    directive: string,
    checkpointId: string | null,
    pinnedArtifactIds: string[]
  ) {
    if (!selectedRun) return;
    const identity = { runId: selectedRun.id, runRevision: selectedRun.revision, taskId: task.id, directive: directive.trim(), checkpointId, pinnedArtifactIds };
    const idempotencyKey = stableMutationKey('replan-task', identity);
    mutating = true;
    error = null;
    try {
      const result = await api.replanBuildRun(selectedRun.projectId, selectedRun.id, {
        idempotencyKey,
        expectedRevision: selectedRun.revision,
        fromTaskId: task.id,
        checkpointId,
        directive: directive.trim(),
        pinnedArtifactIds
      });
      setRun(result.buildRun);
      finishMutation('replan-task', identity);
      await refreshSelected();
    } catch (caught) {
      await reconcileMutationFailure(caught, 'Failed to re-plan Novel Build');
      throw caught;
    } finally {
      mutating = false;
    }
  }

  async function checkpoint(label = 'Writer checkpoint') {
    if (!selectedRun) return;
    const identity = { runId: selectedRun.id, runRevision: selectedRun.revision, label, phase: selectedRun.currentPhase };
    const idempotencyKey = stableMutationKey('checkpoint', identity);
    mutating = true;
    error = null;
    try {
      await api.createBuildCheckpoint(selectedRun.projectId, selectedRun.id, {
        idempotencyKey,
        expectedBuildRevision: selectedRun.revision,
        label,
        phase: selectedRun.currentPhase
      });
      finishMutation('checkpoint', identity);
      await refreshSelected(true);
    } catch (caught) {
      await reconcileMutationFailure(caught, 'Failed to create checkpoint');
    } finally {
      mutating = false;
    }
  }

  async function replaceArtifact(
    artifact: StoryArtifact,
    content: StoryArtifact['content'],
    status?: Extract<StoryArtifactStatus, 'draft' | 'validated' | 'accepted'>
  ) {
    if (!selectedRun) return;
    const activeStatus: Extract<StoryArtifactStatus, 'draft' | 'validated' | 'accepted'> = status
      ?? (artifact.status === 'validated' || artifact.status === 'accepted' ? artifact.status : 'draft');
    const identity = { runId: selectedRun.id, runRevision: selectedRun.revision, artifactId: artifact.id, artifactVersion: artifact.version, status: activeStatus, content };
    const idempotencyKey = stableMutationKey('replace-artifact', identity);
    mutating = true;
    error = null;
    try {
      const result = await api.applyStoryArtifactBatch(selectedRun.projectId, selectedRun.id, {
        idempotencyKey,
        expectedBuildRevision: selectedRun.revision,
        operations: [{
          op: 'replace',
          artifactId: artifact.id,
          expectedVersion: artifact.version,
          artifact: {
            type: artifact.type,
            key: artifact.key,
            title: artifact.title,
            schemaVersion: artifact.schemaVersion,
            status: activeStatus,
            content,
            bindings: artifact.bindings?.map((binding) => ({
              bindingKind: binding.bindingKind,
              unitId: binding.unitId,
              entityType: binding.entityType,
              entityId: binding.entityId,
              role: binding.role
            }))
          }
        }]
      });
      finishMutation('replace-artifact', identity);
      await refreshSelected(true);
      return result.artifacts.find((candidate) => candidate.replacesArtifactId === artifact.id)
        ?? artifacts.find((candidate) => candidate.type === artifact.type && candidate.key === artifact.key && !['superseded', 'invalidated'].includes(candidate.status))
        ?? null;
    } catch (caught) {
      await reconcileMutationFailure(caught, 'Failed to save story artifact');
      const authoritative = artifacts.find((candidate) => candidate.type === artifact.type && candidate.key === artifact.key && !['superseded', 'invalidated'].includes(candidate.status));
      if (authoritative && authoritative.version > artifact.version) {
        finishMutation('replace-artifact', identity);
        error = null;
        return authoritative;
      }
      throw caught;
    } finally {
      mutating = false;
    }
  }

  async function applyState(operation: StoryStateBatchOperation, fallback: string): Promise<ApplyStoryStateBatchResult | null> {
    if (!selectedRun) return null;
    const identity = { runId: selectedRun.id, runRevision: selectedRun.revision, operation };
    const idempotencyKey = stableMutationKey('story-state', identity);
    mutating = true;
    error = null;
    try {
      const result = await api.applyStoryStateBatch(selectedRun.projectId, selectedRun.id, {
        idempotencyKey,
        expectedBuildRevision: selectedRun.revision,
        operations: [operation]
      });
      finishMutation('story-state', identity);
      snapshot = result;
      await refreshSelected(true);
      return result;
    } catch (caught) {
      await reconcileMutationFailure(caught, fallback);
      if (snapshot && selectedRun && selectedRun.revision > identity.runRevision) {
        finishMutation('story-state', identity);
        error = null;
        return { ...snapshot, buildRevision: selectedRun.revision };
      }
      throw caught;
    } finally {
      mutating = false;
    }
  }

  async function updateFact(fact: CanonFact, update: { object: CanonFact['object']; status: CanonFact['status'] }) {
    const result = await applyState({ op: 'upsert-canon-fact', value: {
      sourceArtifactId: fact.sourceArtifactId,
      sourceUnitId: fact.sourceUnitId,
      key: fact.key,
      subjectType: fact.subjectType,
      subjectId: fact.subjectId,
      predicate: fact.predicate,
      object: update.object,
      status: update.status,
      validFromSceneId: fact.validFromSceneId,
      validToSceneId: fact.validToSceneId,
      validFromOrder: fact.validFromOrder,
      validToOrder: fact.validToOrder,
      sourceChapterId: fact.sourceChapterId,
      sourceSceneId: fact.sourceSceneId,
      sourceSpan: fact.sourceSpan,
      confidence: fact.confidence
    } }, 'Failed to save canon fact');
    return result?.canonFacts.find((candidate) => candidate.key === fact.key && candidate.isCurrent) ?? null;
  }

  async function updateEntityState(entity: EntityState, update: { value: EntityState['value']; status: EntityState['status'] }) {
    const result = await applyState({ op: 'upsert-entity-state', value: {
      sourceArtifactId: entity.sourceArtifactId,
      sourceUnitId: entity.sourceUnitId,
      sourceFactId: entity.sourceFactId,
      key: entity.key,
      entityType: entity.entityType,
      entityId: entity.entityId,
      stateKey: entity.stateKey,
      value: update.value,
      status: update.status,
      validFromSceneId: entity.validFromSceneId,
      validToSceneId: entity.validToSceneId,
      validFromOrder: entity.validFromOrder,
      validToOrder: entity.validToOrder,
      storyOrder: entity.storyOrder,
      sourceSpan: entity.sourceSpan
    } }, 'Failed to save entity state');
    return result?.entityStates.find((candidate) => candidate.key === entity.key && candidate.isCurrent) ?? null;
  }

  async function updateLoop(loop: OpenLoop, update: { description: string; targetPayoff: string | null; status: OpenLoop['status'] }) {
    const result = await applyState({ op: 'upsert-open-loop', value: {
      sourceUnitId: loop.sourceUnitId,
      key: loop.key,
      kind: loop.kind,
      status: update.status,
      title: loop.title,
      description: update.description,
      introducedSceneId: loop.introducedSceneId,
      resolvedSceneId: loop.resolvedSceneId,
      introducedArtifactId: loop.introducedArtifactId,
      resolvedArtifactId: loop.resolvedArtifactId,
      targetPayoff: update.targetPayoff,
      metadata: loop.metadata
    } }, 'Failed to save open loop');
    return result?.openLoops.find((candidate) => candidate.key === loop.key && candidate.isCurrent) ?? null;
  }

  async function updateTimeline(event: TimelineEvent, update: Partial<Pick<TimelineEvent, 'title' | 'description' | 'chronology' | 'sortOrder' | 'chapterId' | 'sceneId' | 'dependencyIds' | 'participantRefs'>>) {
    const result = await applyState({ op: 'upsert-timeline-event', value: {
      sourceArtifactId: event.sourceArtifactId,
      sourceUnitId: event.sourceUnitId,
      key: event.key,
      title: update.title ?? event.title,
      description: update.description ?? event.description,
      chronology: update.chronology ?? event.chronology,
      sortOrder: update.sortOrder ?? event.sortOrder,
      chapterId: update.chapterId ?? event.chapterId,
      sceneId: update.sceneId ?? event.sceneId,
      dependencyIds: update.dependencyIds ?? event.dependencyIds,
      participantRefs: update.participantRefs ?? event.participantRefs,
      sourceSpan: event.sourceSpan
    } }, 'Failed to save timeline event');
    return result?.timelineEvents.find((candidate) => candidate.key === event.key && candidate.isCurrent) ?? null;
  }

  async function updateSetupPayoff(link: SetupPayoffLink, update: Partial<Pick<SetupPayoffLink, 'title' | 'description' | 'status' | 'setupSceneId' | 'payoffSceneId' | 'reinforcementSceneIds' | 'plotThreadId'>>) {
    const result = await applyState({ op: 'upsert-setup-payoff', value: {
      sourceUnitId: link.sourceUnitId,
      plotThreadId: update.plotThreadId ?? link.plotThreadId,
      key: link.key,
      title: update.title ?? link.title,
      description: update.description ?? link.description,
      status: update.status ?? link.status,
      setupSceneId: update.setupSceneId ?? link.setupSceneId,
      payoffSceneId: update.payoffSceneId ?? link.payoffSceneId,
      reinforcementSceneIds: update.reinforcementSceneIds ?? link.reinforcementSceneIds,
      setupArtifactId: link.setupArtifactId,
      payoffArtifactId: link.payoffArtifactId,
      metadata: link.metadata
    } }, 'Failed to save setup/payoff');
    return result?.setupPayoffs.find((candidate) => candidate.key === link.key && candidate.isCurrent) ?? null;
  }

  async function markSceneAsSetup(sceneId: string, title: string) {
    const existing = snapshot?.setupPayoffs.find((item) => item.setupSceneId === sceneId && item.isCurrent);
    if (existing) return existing;
    await applyState({ op: 'upsert-setup-payoff', value: {
      sourceUnitId: units.find((unit) => unit.sourceSceneId === sceneId || unit.id === sceneId)?.id ?? null,
      plotThreadId: null,
      key: `setup:${sceneId}`,
      title,
      description: `Setup introduced in ${title}.`,
      status: 'setup',
      setupSceneId: sceneId,
      payoffSceneId: null,
      reinforcementSceneIds: [],
      setupArtifactId: null,
      payoffArtifactId: null,
      metadata: null
    } }, 'Failed to mark scene as setup');
    return snapshot?.setupPayoffs.find((item) => item.setupSceneId === sceneId && item.isCurrent) ?? null;
  }

  async function linkPayoff(link: SetupPayoffLink, sceneId: string) {
    await updateSetupPayoff(link, { payoffSceneId: sceneId, status: 'paid-off' });
  }

  async function updatePlotThread(thread: PlotThread, update: Partial<Pick<PlotThread, 'title' | 'kind' | 'status' | 'summary' | 'stakes' | 'sceneIds' | 'parentThreadId'>>) {
    const result = await applyState({ op: 'upsert-plot-thread', value: {
      sourceArtifactId: thread.sourceArtifactId,
      sourceUnitId: thread.sourceUnitId,
      parentThreadId: update.parentThreadId ?? thread.parentThreadId,
      key: thread.key,
      title: update.title ?? thread.title,
      kind: update.kind ?? thread.kind,
      status: update.status ?? thread.status,
      summary: update.summary ?? thread.summary,
      stakes: update.stakes ?? thread.stakes,
      sceneIds: update.sceneIds ?? thread.sceneIds,
      introducedSceneId: thread.introducedSceneId,
      resolvedSceneId: thread.resolvedSceneId,
      metadata: thread.metadata
    } }, 'Failed to save plot thread');
    return result?.plotThreads.find((candidate) => candidate.key === thread.key && candidate.isCurrent) ?? null;
  }

  async function loadStateHistory(entityKind: StoryStateEntityKind, recordKey: string): Promise<StoryStateHistoryResult | null> {
    if (!selectedRun) return null;
    const run = selectedRun;
    const historyKey = `${entityKind}:${recordKey}`;
    try {
      const result = await api.getStoryStateHistory(run.projectId, run.id, entityKind, recordKey);
      if (selectedRunId !== run.id) return null;
      histories = { ...histories, [historyKey]: result };
      return result;
    } catch (caught) {
      error = errorMessage(caught, 'Failed to load story-state history');
      return null;
    }
  }

  async function restoreState(entityKind: StoryStateEntityKind, recordKey: string, version: number) {
    const result = await applyState({ op: 'restore', entityKind, key: recordKey, version }, 'Failed to restore story-state version');
    await loadStateHistory(entityKind, recordKey);
    const collection = entityKind === 'canon-fact' ? result?.canonFacts
      : entityKind === 'entity-state' ? result?.entityStates
      : entityKind === 'timeline-event' ? result?.timelineEvents
      : entityKind === 'open-loop' ? result?.openLoops
      : entityKind === 'setup-payoff' ? result?.setupPayoffs
      : result?.plotThreads;
    return collection?.find((candidate) => candidate.key === recordKey && candidate.isCurrent) ?? null;
  }

  async function updateScene(scene: Scene, input: Omit<UpdateSceneInput, 'expectedRevision'>): Promise<Scene | null> {
    if (!projectId) return null;
    mutating = true;
    error = null;
    try {
      return await api.updateScene(projectId, scene.chapterId, scene.id, { ...input, expectedRevision: scene.revision });
    } catch (caught) {
      await reconcileMutationFailure(caught, 'Failed to save scene metadata');
      throw caught;
    } finally {
      mutating = false;
    }
  }

  async function patchUnit(unit: BuildManuscriptUnit, input: Omit<PatchBuildManuscriptUnitInput, 'idempotencyKey' | 'expectedBuildRevision' | 'expectedUnitRevision' | 'expectedHeadVersionId'>): Promise<BuildManuscriptUnit | null> {
    if (!selectedRun) return null;
    const identity = { runId: selectedRun.id, runRevision: selectedRun.revision, unitId: unit.id, unitRevision: unit.revision, headVersionId: unit.headVersionId, input };
    const idempotencyKey = stableMutationKey('patch-unit', identity);
    mutating = true;
    error = null;
    try {
      const updated = await api.patchBuildManuscriptUnit(selectedRun.projectId, selectedRun.id, unit.id, {
        idempotencyKey,
        expectedBuildRevision: selectedRun.revision,
        expectedUnitRevision: unit.revision,
        expectedHeadVersionId: unit.headVersionId,
        ...input
      });
      const index = units.findIndex((candidate) => candidate.id === updated.id);
      if (index >= 0) units[index] = updated;
      finishMutation('patch-unit', identity);
      await refreshSelected(true);
      return updated;
    } catch (caught) {
      await reconcileMutationFailure(caught, 'Failed to save build manuscript');
      const authoritative = units.find((candidate) => candidate.id === unit.id);
      if (authoritative && authoritative.revision > unit.revision) {
        finishMutation('patch-unit', identity);
        error = null;
        return authoritative;
      }
      throw caught;
    } finally {
      mutating = false;
    }
  }

  async function reorderUnits(parentUnitId: string, unitIds: string[]): Promise<BuildManuscriptUnit[]> {
    if (!selectedRun) return [];
    const siblings = units.filter((unit) => unit.parentUnitId === parentUnitId && !unit.invalidatedAt);
    const expectedUnitRevisions = Object.fromEntries(siblings.map((unit) => [unit.id, unit.revision]));
    const identity = { runId: selectedRun.id, runRevision: selectedRun.revision, parentUnitId, unitIds, expectedUnitRevisions };
    const idempotencyKey = stableMutationKey('reorder-units', identity);
    mutating = true;
    error = null;
    try {
      const reordered = await api.reorderBuildManuscriptUnits(selectedRun.projectId, selectedRun.id, {
        idempotencyKey,
        expectedBuildRevision: selectedRun.revision,
        parentUnitId,
        unitIds,
        expectedUnitRevisions
      });
      finishMutation('reorder-units', identity);
      const byId = new Map(reordered.map((unit) => [unit.id, unit]));
      for (let index = 0; index < units.length; index += 1) {
        const replacement = byId.get(units[index].id);
        if (replacement) units[index] = replacement;
      }
      await refreshSelected(true);
      return reordered;
    } catch (caught) {
      await reconcileMutationFailure(caught, 'Failed to reorder build scenes');
      const authoritative = units
        .filter((unit) => unit.parentUnitId === parentUnitId && !unit.invalidatedAt)
        .sort((left, right) => left.order - right.order);
      if (authoritative.map((unit) => unit.id).join('\0') === unitIds.join('\0')) {
        finishMutation('reorder-units', identity);
        error = null;
        return authoritative;
      }
      throw caught;
    } finally {
      mutating = false;
    }
  }

  async function compileManuscript(checkpointId?: string | null): Promise<BuildCompilation | null> {
    if (!selectedRun) return null;
    const previousCompilationId = compilation?.id ?? null;
    const identity = { runId: selectedRun.id, runRevision: selectedRun.revision, checkpointId: checkpointId ?? null };
    const idempotencyKey = stableMutationKey('compile-manuscript', identity);
    mutating = true;
    error = null;
    try {
      compilation = await api.compileBuildManuscript(selectedRun.projectId, selectedRun.id, {
        idempotencyKey,
        expectedBuildRevision: selectedRun.revision,
        checkpointId: checkpointId ?? undefined
      });
      finishMutation('compile-manuscript', identity);
      comparison = await api.compareBuildManuscript(selectedRun.projectId, selectedRun.id);
      await refreshSelected(true);
      return compilation;
    } catch (caught) {
      await reconcileMutationFailure(caught, 'Failed to compile build manuscript');
      if (compilation && compilation.id !== previousCompilationId) {
        finishMutation('compile-manuscript', identity);
        error = null;
        return compilation;
      }
      throw caught;
    } finally {
      mutating = false;
    }
  }

  async function refreshComparison(): Promise<BuildComparison | null> {
    if (!selectedRun) return null;
    try {
      comparison = await api.compareBuildManuscript(selectedRun.projectId, selectedRun.id);
      return comparison;
    } catch (caught) {
      error = errorMessage(caught, 'Failed to compare build manuscript');
      return null;
    }
  }

  async function createReview(input: Omit<CreateBuildReviewInput, 'idempotencyKey'>): Promise<BuildReview | null> {
    if (!selectedRun) return null;
    const identity = { runId: selectedRun.id, runRevision: selectedRun.revision, input };
    const idempotencyKey = stableMutationKey('create-review', identity);
    mutating = true;
    error = null;
    try {
      const review = await api.createBuildReview(selectedRun.projectId, selectedRun.id, { ...input, idempotencyKey });
      finishMutation('create-review', identity);
      reviews.unshift(review);
      return review;
    } catch (caught) {
      await reconcileMutationFailure(caught, 'Failed to create build review');
      const authoritative = reviews.find((candidate) => candidate.compilationId === input.compilationId && candidate.title === input.title);
      if (authoritative) {
        finishMutation('create-review', identity);
        error = null;
        return authoritative;
      }
      throw caught;
    } finally {
      mutating = false;
    }
  }

  async function approveReview(review: BuildReview): Promise<BuildReview | null> {
    if (!selectedRun) return null;
    const identity = { runId: selectedRun.id, reviewId: review.id, reviewRevision: review.revision, confirm: true };
    const idempotencyKey = stableMutationKey('approve-review', identity);
    mutating = true;
    error = null;
    try {
      const updated = await api.approveBuildReview(selectedRun.projectId, selectedRun.id, review.id, { idempotencyKey, expectedRevision: review.revision, confirm: true });
      finishMutation('approve-review', identity);
      const index = reviews.findIndex((candidate) => candidate.id === updated.id);
      if (index >= 0) reviews[index] = updated;
      return updated;
    } catch (caught) {
      await reconcileMutationFailure(caught, 'Failed to approve build review');
      const authoritative = reviews.find((candidate) => candidate.id === review.id);
      if (authoritative && ['approved', 'merged'].includes(authoritative.status) && authoritative.revision > review.revision) {
        finishMutation('approve-review', identity);
        error = null;
        return authoritative;
      }
      throw caught;
    } finally {
      mutating = false;
    }
  }

  async function mergeReview(review: BuildReview): Promise<BuildReview | null> {
    if (!selectedRun) return null;
    const identity = { runId: selectedRun.id, reviewId: review.id, reviewRevision: review.revision, confirm: true };
    const idempotencyKey = stableMutationKey('merge-review', identity);
    mutating = true;
    error = null;
    try {
      const updated = await api.mergeBuildReview(selectedRun.projectId, selectedRun.id, review.id, { idempotencyKey, expectedRevision: review.revision, confirm: true });
      finishMutation('merge-review', identity);
      const index = reviews.findIndex((candidate) => candidate.id === updated.id);
      if (index >= 0) reviews[index] = updated;
      await refreshSelected();
      return updated;
    } catch (caught) {
      await reconcileMutationFailure(caught, 'Failed to merge build review');
      const authoritative = reviews.find((candidate) => candidate.id === review.id);
      if (authoritative?.status === 'merged' && authoritative.revision > review.revision) {
        finishMutation('merge-review', identity);
        error = null;
        return authoritative;
      }
      throw caught;
    } finally {
      mutating = false;
    }
  }

  async function rejectReview(review: BuildReview, reason: string): Promise<BuildReview | null> {
    if (!selectedRun) return null;
    const trimmedReason = reason.trim();
    const identity = { runId: selectedRun.id, reviewId: review.id, reviewRevision: review.revision, confirm: true, reason: trimmedReason };
    const idempotencyKey = stableMutationKey('reject-review', identity);
    mutating = true;
    error = null;
    try {
      const updated = await api.rejectBuildReview(selectedRun.projectId, selectedRun.id, review.id, { idempotencyKey, expectedRevision: review.revision, confirm: true, reason: trimmedReason });
      finishMutation('reject-review', identity);
      const index = reviews.findIndex((candidate) => candidate.id === updated.id);
      if (index >= 0) reviews[index] = updated;
      await refreshSelected(true);
      return updated;
    } catch (caught) {
      await reconcileMutationFailure(caught, 'Failed to reject build review');
      const authoritative = reviews.find((candidate) => candidate.id === review.id);
      if (authoritative?.status === 'rejected' && authoritative.revision > review.revision) {
        finishMutation('reject-review', identity);
        error = null;
        return authoritative;
      }
      throw caught;
    } finally {
      mutating = false;
    }
  }

  async function search(input: SearchStoryInput, append = false) {
    if (!selectedRun) return;
    const request = ++searchRequest;
    referenceRequest += 1;
    const runId = selectedRun.id;
    searching = true;
    error = null;
    referencesResult = null;
    try {
      const result = await api.searchStory(selectedRun.projectId, runId, input);
      if (request !== searchRequest || selectedRunId !== runId) return;
      searchResult = append && searchResult
        ? { ...result, hits: uniqueById([...searchResult.hits, ...result.hits]), offset: 0, total: result.total }
        : result;
    } catch (caught) {
      if (request === searchRequest) error = errorMessage(caught, 'Project search failed');
    } finally {
      if (request === searchRequest) searching = false;
    }
  }

  async function findReferences(input: FindStoryReferencesInput, append = false) {
    if (!selectedRun) return;
    const request = ++referenceRequest;
    searchRequest += 1;
    const runId = selectedRun.id;
    searching = true;
    error = null;
    try {
      const result = await api.findStoryReferences(selectedRun.projectId, runId, input);
      if (request !== referenceRequest || selectedRunId !== runId) return;
      referencesResult = append && referencesResult
        ? { ...result, hits: uniqueById([...referencesResult.hits, ...result.hits]), offset: 0, total: result.total }
        : result;
    } catch (caught) {
      if (request === referenceRequest) error = errorMessage(caught, 'Reference search failed');
    } finally {
      if (request === referenceRequest) searching = false;
    }
  }

  function clearSearch() {
    searchRequest += 1;
    referenceRequest += 1;
    searching = false;
    searchResult = null;
    referencesResult = null;
  }

  async function previewRenameSymbol(nextProjectId: string, input: RenameSymbolInput): Promise<RenameSymbolPreview> {
    error = null;
    try {
      return await api.previewRenameSymbol(nextProjectId, input);
    } catch (caught) {
      error = errorMessage(caught, 'Rename preview failed');
      throw caught;
    }
  }

  async function applyRenameSymbol(nextProjectId: string, input: ApplyRenameSymbolInput): Promise<ApplyRenameSymbolResult> {
    error = null;
    try {
      return await api.applyRenameSymbol(nextProjectId, input);
    } catch (caught) {
      error = errorMessage(caught, 'Rename failed');
      throw caught;
    }
  }

  return {
    get projectId() { return projectId; },
    get runs() { return runs; },
    get selectedRunId() { return selectedRunId; },
    get selectedRun() { return selectedRun; },
    get artifacts() { return artifacts; },
    get snapshot() { return snapshot; },
    get traces() { return traces; },
    get evaluations() { return evaluations; },
    get units() { return units; },
    get reviews() { return reviews; },
    get histories() { return histories; },
    get observability() { return observability; },
    get compilation() { return compilation; },
    get comparison() { return comparison; },
    get diagnostics() { return diagnostics; },
    get searchResult() { return searchResult; },
    get referencesResult() { return referencesResult; },
    get loadingRuns() { return loadingRuns; },
    get loadingDetails() { return loadingDetails; },
    get searching() { return searching; },
    get mutating() { return mutating; },
    get error() { return error; },
    get detailWarning() { return detailWarning; },
    get connection() { return connection; },
    get consecutivePollFailures() { return consecutivePollFailures; },
    get nextPollDelayMs() { return Math.min(30_000, 4_000 * 2 ** Math.min(consecutivePollFailures, 3)); },
    get lastUpdatedAt() { return lastUpdatedAt; },
    get activeArtifacts() { return currentOnly(artifacts.filter((artifact) => !['superseded', 'invalidated'].includes(artifact.status))); },
    reset,
    loadRuns,
    selectRun,
    refreshSelected,
    beginNew,
    createRun,
    authorizeRun,
    pauseRun,
    resumeRun,
    cancelRun,
    retryTask,
    rerunTask,
    replanTask,
    checkpoint,
    replaceArtifact,
    updateFact,
    updateEntityState,
    updateLoop,
    updateTimeline,
    updateSetupPayoff,
    markSceneAsSetup,
    linkPayoff,
    updatePlotThread,
    loadStateHistory,
    restoreState,
    updateScene,
    patchUnit,
    reorderUnits,
    compileManuscript,
    refreshComparison,
    createReview,
    approveReview,
    mergeReview,
    rejectReview,
    search,
    findReferences,
    clearSearch,
    previewRenameSymbol,
    applyRenameSymbol
  };
}

export type StoryIdeStore = ReturnType<typeof createStoryIdeStore>;
export const storyIde: StoryIdeStore = createStoryIdeStore();
