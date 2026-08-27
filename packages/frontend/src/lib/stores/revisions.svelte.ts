import {
  ApiError,
  OpenTalesClient,
  type AcceptWritingSuggestionInput,
  type BranchFromNamedSnapshotResult,
  type CreateNamedSnapshotInput,
  type CreateWritingAnnotationInput,
  type ListWritingAnnotationsInput,
  type NamedSnapshot,
  type NamedSnapshotComparison,
  type RestoreNamedSnapshotResult,
  type SnapshotListFilter,
  type WritingAnnotationThread
} from '@opentales/sdk';

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

export function syncRevisionsToken(token: string | undefined) {
  api.setToken(token);
}

function requestKey(): string {
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

function message(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

function ambiguous(error: unknown): boolean {
  return !(error instanceof ApiError) || error.status === 409 || error.status >= 500;
}

export function createRevisionsStore() {
  const snapshots = $state<NamedSnapshot[]>([]);
  const annotations = $state<WritingAnnotationThread[]>([]);
  let projectId = $state<string | null>(null);
  let selectedSnapshot = $state<NamedSnapshot | null>(null);
  let comparison = $state<NamedSnapshotComparison | null>(null);
  let selectedAnnotationId = $state<string | null>(null);
  let loadingSnapshots = $state(false);
  let loadingAnnotations = $state(false);
  let mutating = $state(false);
  let error = $state<string | null>(null);
  let annotationError = $state<string | null>(null);
  let snapshotFilter = $state<SnapshotListFilter>({});
  let annotationFilter = $state<ListWritingAnnotationsInput>({});
  let annotationRequest = 0;
  const mutationKeys = new Map<string, string>();

  function stableMutationKey(operation: string, identity: unknown): string {
    const key = `${operation}:${stableValue(identity)}`;
    const existing = mutationKeys.get(key);
    if (existing) return existing;
    const created = requestKey();
    mutationKeys.set(key, created);
    return created;
  }

  function finishMutation(operation: string, identity: unknown) {
    mutationKeys.delete(`${operation}:${stableValue(identity)}`);
  }

  function reportAnnotationError(next: string | null) {
    annotationError = next;
  }

  function reset(nextProjectId: string | null = null) {
    projectId = nextProjectId;
    snapshots.splice(0, snapshots.length);
    annotations.splice(0, annotations.length);
    selectedSnapshot = null;
    selectedAnnotationId = null;
    comparison = null;
    loadingSnapshots = false;
    loadingAnnotations = false;
    mutating = false;
    error = null;
    annotationError = null;
    snapshotFilter = {};
    annotationFilter = {};
    annotationRequest += 1;
    mutationKeys.clear();
  }

  function upsertSnapshot(snapshot: NamedSnapshot) {
    const index = snapshots.findIndex((candidate) => candidate.id === snapshot.id);
    if (index >= 0) snapshots[index] = snapshot;
    else snapshots.unshift(snapshot);
    snapshots.sort((left, right) => right.createdAt.localeCompare(left.createdAt));
    if (selectedSnapshot?.id === snapshot.id) selectedSnapshot = snapshot;
  }

  function upsertAnnotation(thread: WritingAnnotationThread) {
    const index = annotations.findIndex((candidate) => candidate.id === thread.id);
    if (index >= 0) annotations[index] = thread;
    else annotations.unshift(thread);
    annotations.sort((left, right) => left.start - right.start || right.updatedAt.localeCompare(left.updatedAt));
  }

  async function loadSnapshots(nextProjectId: string, filter: SnapshotListFilter = {}) {
    if (projectId !== nextProjectId) reset(nextProjectId);
    loadingSnapshots = true;
    error = null;
    snapshotFilter = filter;
    try {
      const values = await api.listNamedSnapshots(nextProjectId, filter);
      snapshots.splice(0, snapshots.length, ...values);
      if (selectedSnapshot && !values.some((candidate) => candidate.id === selectedSnapshot?.id)) {
        selectedSnapshot = null;
        comparison = null;
      }
    } catch (caught) {
      error = message(caught, 'Failed to load snapshots');
    } finally {
      loadingSnapshots = false;
    }
  }

  async function selectSnapshot(nextProjectId: string, snapshotId: string) {
    if (projectId !== nextProjectId) reset(nextProjectId);
    loadingSnapshots = true;
    error = null;
    try {
      selectedSnapshot = await api.getNamedSnapshot(nextProjectId, snapshotId);
      upsertSnapshot(selectedSnapshot);
      comparison = await api.compareNamedSnapshots(nextProjectId, { leftSnapshotId: snapshotId, rightSnapshotId: null });
    } catch (caught) {
      error = message(caught, 'Failed to load snapshot');
    } finally {
      loadingSnapshots = false;
    }
  }

  async function createSnapshot(nextProjectId: string, input: Omit<CreateNamedSnapshotInput, 'idempotencyKey'>): Promise<NamedSnapshot | null> {
    const identity = { projectId: nextProjectId, ...input };
    const idempotencyKey = stableMutationKey('create-snapshot', identity);
    mutating = true;
    error = null;
    try {
      const created = await api.createNamedSnapshot(nextProjectId, { ...input, idempotencyKey });
      finishMutation('create-snapshot', identity);
      upsertSnapshot(created);
      await selectSnapshot(nextProjectId, created.id);
      return created;
    } catch (caught) {
      if (ambiguous(caught)) await loadSnapshots(nextProjectId, snapshotFilter).catch(() => undefined);
      error = message(caught, 'Failed to create snapshot');
      return null;
    } finally {
      mutating = false;
    }
  }

  async function compareSnapshots(nextProjectId: string, leftSnapshotId: string, rightSnapshotId: string | null = null) {
    error = null;
    try {
      comparison = await api.compareNamedSnapshots(nextProjectId, { leftSnapshotId, rightSnapshotId });
      return comparison;
    } catch (caught) {
      error = message(caught, 'Failed to compare snapshots');
      return null;
    }
  }

  async function restoreSnapshot(
    snapshot: NamedSnapshot,
    expectedHeads: Record<string, string | null>,
    expectedEntityRevisions: Record<string, number> = {}
  ): Promise<RestoreNamedSnapshotResult | null> {
    const identity = { snapshotId: snapshot.id, expectedHeads, expectedEntityRevisions };
    const idempotencyKey = stableMutationKey('restore-snapshot', identity);
    mutating = true;
    error = null;
    try {
      const result = await api.restoreNamedSnapshot(snapshot.projectId, snapshot.id, { idempotencyKey, confirm: true, expectedHeads, expectedEntityRevisions });
      finishMutation('restore-snapshot', identity);
      comparison = await api.compareNamedSnapshots(snapshot.projectId, { leftSnapshotId: snapshot.id, rightSnapshotId: null });
      return result;
    } catch (caught) {
      if (ambiguous(caught)) comparison = await api.compareNamedSnapshots(snapshot.projectId, { leftSnapshotId: snapshot.id, rightSnapshotId: null }).catch(() => comparison);
      error = message(caught, 'Failed to restore snapshot');
      return null;
    } finally {
      mutating = false;
    }
  }

  async function branchSnapshot(snapshot: NamedSnapshot, name: string): Promise<BranchFromNamedSnapshotResult | null> {
    const identity = { snapshotId: snapshot.id, name: name.trim() };
    const idempotencyKey = stableMutationKey('branch-snapshot', identity);
    mutating = true;
    error = null;
    try {
      const result = await api.branchFromNamedSnapshot(snapshot.projectId, snapshot.id, { idempotencyKey, name: name.trim() });
      finishMutation('branch-snapshot', identity);
      return result;
    } catch (caught) {
      error = message(caught, 'Failed to branch from snapshot');
      return null;
    } finally {
      mutating = false;
    }
  }

  async function deleteSnapshot(snapshot: NamedSnapshot): Promise<boolean> {
    mutating = true;
    error = null;
    try {
      await api.deleteNamedSnapshot(snapshot.projectId, snapshot.id);
      const index = snapshots.findIndex((candidate) => candidate.id === snapshot.id);
      if (index >= 0) snapshots.splice(index, 1);
      if (selectedSnapshot?.id === snapshot.id) {
        selectedSnapshot = null;
        comparison = null;
      }
      return true;
    } catch (caught) {
      error = message(caught, 'Failed to delete snapshot');
      return false;
    } finally {
      mutating = false;
    }
  }

  async function loadAnnotations(nextProjectId: string, filter: ListWritingAnnotationsInput = {}) {
    if (projectId !== nextProjectId) reset(nextProjectId);
    const request = ++annotationRequest;
    loadingAnnotations = true;
    annotationError = null;
    annotationFilter = filter;
    try {
      const values = await api.listWritingAnnotations(nextProjectId, filter);
      if (request !== annotationRequest) return;
      annotations.splice(0, annotations.length, ...values);
      if (selectedAnnotationId && !values.some((candidate) => candidate.id === selectedAnnotationId)) selectedAnnotationId = null;
    } catch (caught) {
      if (request === annotationRequest) annotationError = message(caught, 'Failed to load annotations');
    } finally {
      if (request === annotationRequest) loadingAnnotations = false;
    }
  }

  async function createAnnotation(nextProjectId: string, input: Omit<CreateWritingAnnotationInput, 'idempotencyKey'>): Promise<WritingAnnotationThread | null> {
    const identity = { projectId: nextProjectId, ...input };
    const idempotencyKey = stableMutationKey('create-annotation', identity);
    mutating = true;
    annotationError = null;
    try {
      const thread = await api.createWritingAnnotation(nextProjectId, { ...input, idempotencyKey });
      finishMutation('create-annotation', identity);
      upsertAnnotation(thread);
      selectedAnnotationId = thread.id;
      return thread;
    } catch (caught) {
      if (ambiguous(caught)) await loadAnnotations(nextProjectId, annotationFilter).catch(() => undefined);
      annotationError = message(caught, 'Failed to create annotation');
      return null;
    } finally {
      mutating = false;
    }
  }

  async function reply(thread: WritingAnnotationThread, body: string): Promise<WritingAnnotationThread | null> {
    const identity = { threadId: thread.id, body: body.trim() };
    const idempotencyKey = stableMutationKey('reply-annotation', identity);
    mutating = true;
    annotationError = null;
    try {
      const updated = await api.replyToWritingAnnotation(thread.projectId, thread.id, { idempotencyKey, body: body.trim() });
      finishMutation('reply-annotation', identity);
      upsertAnnotation(updated);
      return updated;
    } catch (caught) {
      annotationError = message(caught, 'Failed to reply');
      return null;
    } finally {
      mutating = false;
    }
  }

  async function setStatus(thread: WritingAnnotationThread, action: 'resolve' | 'reopen' | 'reject'): Promise<WritingAnnotationThread | null> {
    mutating = true;
    annotationError = null;
    try {
      const updated = action === 'resolve'
        ? await api.resolveWritingAnnotation(thread.projectId, thread.id, { expectedRevision: thread.revision })
        : action === 'reopen'
          ? await api.reopenWritingAnnotation(thread.projectId, thread.id, { expectedRevision: thread.revision })
          : await api.rejectWritingSuggestion(thread.projectId, thread.id, { expectedRevision: thread.revision });
      upsertAnnotation(updated);
      return updated;
    } catch (caught) {
      if (ambiguous(caught)) await loadAnnotations(thread.projectId, annotationFilter).catch(() => undefined);
      annotationError = message(caught, `Failed to ${action} annotation`);
      return null;
    } finally {
      mutating = false;
    }
  }

  async function acceptSuggestion(thread: WritingAnnotationThread, expectedHeadVersionId: string): Promise<WritingAnnotationThread | null> {
    const identity = { threadId: thread.id, revision: thread.revision, expectedHeadVersionId };
    const idempotencyKey = stableMutationKey('accept-suggestion', identity);
    const input: AcceptWritingSuggestionInput = { idempotencyKey, confirm: true, expectedRevision: thread.revision, expectedHeadVersionId };
    mutating = true;
    annotationError = null;
    try {
      const updated = await api.acceptWritingSuggestion(thread.projectId, thread.id, input);
      finishMutation('accept-suggestion', identity);
      upsertAnnotation(updated);
      return updated;
    } catch (caught) {
      if (ambiguous(caught)) await loadAnnotations(thread.projectId, annotationFilter).catch(() => undefined);
      annotationError = message(caught, 'Failed to accept suggestion');
      return null;
    } finally {
      mutating = false;
    }
  }

  return {
    get snapshots() { return snapshots; },
    get selectedSnapshot() { return selectedSnapshot; },
    get comparison() { return comparison; },
    get annotations() { return annotations; },
    get selectedAnnotationId() { return selectedAnnotationId; },
    get selectedAnnotation() { return annotations.find((thread) => thread.id === selectedAnnotationId) ?? null; },
    get loadingSnapshots() { return loadingSnapshots; },
    get loadingAnnotations() { return loadingAnnotations; },
    get mutating() { return mutating; },
    get error() { return error; },
    get annotationError() { return annotationError; },
    get snapshotFilter() { return snapshotFilter; },
    get annotationFilter() { return annotationFilter; },
    reportAnnotationError,
    reset,
    loadSnapshots,
    selectSnapshot,
    createSnapshot,
    compareSnapshots,
    restoreSnapshot,
    branchSnapshot,
    deleteSnapshot,
    loadAnnotations,
    selectAnnotation(id: string | null) { selectedAnnotationId = id; },
    createAnnotation,
    reply,
    resolve(thread: WritingAnnotationThread) { return setStatus(thread, 'resolve'); },
    reopen(thread: WritingAnnotationThread) { return setStatus(thread, 'reopen'); },
    rejectSuggestion(thread: WritingAnnotationThread) { return setStatus(thread, 'reject'); },
    acceptSuggestion
  };
}

export const revisions = createRevisionsStore();
