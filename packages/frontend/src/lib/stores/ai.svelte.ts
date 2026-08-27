import {
  OpenTalesClient,
  type Asset,
  type AssetKind,
  type AiAgentSession,
  type AiAgentApprovalMode,
  type AiAgentSessionEvent,
  type AiAgentSessionPart,
  type AiAgentSessionSummary,
  type AiAgentTimelineInfo,
  type AiAgentToolCall,
  type AiAgentAttachmentInput,
  type AiCharacterDialogueSuggestion,
  type AiContinuityReview,
  type AiModelCatalog,
  type AiOutlineExpansion,
  type AiRewriteMode,
  type AiRewriteSuggestion,
  type AiToolManifest,
  type CreateProjectAiSkillInput,
  type CreateProjectFolderInput,
  type CreateProjectDocInput,
  type PaginatedProjectDocs,
  type PollCodexAuthResult,
  type PollGithubCopilotAuthResult,
  type ProjectAiSettings,
  type ProjectAiSkill,
  type ProjectDoc,
  type ProjectFileTree,
  type ProjectFolder,
  type ProjectDocKind,
  type StartCodexAuthResult,
  type StartGithubCopilotAuthResult,
  type UpdateProjectAiSkillInput,
  type UpdateProjectAiSettingsInput,
  type UpdateProjectAssetInput,
  type UpdateProjectFolderInput,
  type UpdateProjectDocInput
} from '@opentales/sdk';

const initialAiToken = browserLocalStorage().getItem('opentales.token') ?? undefined;
const api = new OpenTalesClient({
  baseUrl: import.meta.env.VITE_API_URL ?? 'http://localhost:4000',
  token: initialAiToken
});
let syncedAiToken = initialAiToken;

const STREAM_RECONNECT_BASE_MS = 500;
const STREAM_RECONNECT_MAX_MS = 8_000;
const STREAM_RECONNECT_MAX_ATTEMPTS = 5;

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

// Keep the SDK token in sync whenever the manuscript store changes it.
export function syncAiToken(token: string | undefined) {
  if (token === syncedAiToken) return;
  syncedAiToken = token;
  api.setToken(token);
  ai.reset();
}

export function syncAiProjectContext(projectId: string | null) {
  ai.setProjectContext(projectId);
}

export function reconnectDelayMs(attempt: number, random = Math.random): number {
  const exponential = Math.min(
    STREAM_RECONNECT_MAX_MS,
    STREAM_RECONNECT_BASE_MS * 2 ** Math.max(0, attempt)
  );
  return Math.min(
    STREAM_RECONNECT_MAX_MS,
    Math.round(exponential * (0.75 + Math.max(0, Math.min(1, random())) * 0.5))
  );
}

function abortableDelay(delayMs: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(Object.assign(new Error('Aborted'), { name: 'AbortError' }));
      return;
    }
    const onAbort = () => {
      clearTimeout(timeout);
      reject(Object.assign(new Error('Aborted'), { name: 'AbortError' }));
    };
    const timeout = setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    }, delayMs);
    signal.addEventListener('abort', onAbort, { once: true });
  });
}

export function createAiStore() {
  let projectContextId: string | null = null;
  let contextGeneration = 0;

  function ensureProjectContext(projectId: string): number {
    if (projectContextId !== projectId) setProjectContext(projectId);
    return contextGeneration;
  }

  function isCurrentContext(projectId: string, generation: number): boolean {
    return projectContextId === projectId && contextGeneration === generation;
  }
  // ── AI settings ──────────────────────────────────────────────────────
  let settings = $state<ProjectAiSettings | null>(null);
  let settingsLoading = $state(false);
  let settingsError = $state<string | null>(null);
  let modelCatalog = $state<AiModelCatalog | null>(null);
  let modelCatalogLoading = $state(false);
  let modelCatalogError = $state<string | null>(null);

  async function loadSettings(projectId: string) {
    const generation = ensureProjectContext(projectId);
    settingsLoading = true;
    settingsError = null;
    try {
      const next = await api.getProjectAiSettings(projectId);
      if (!isCurrentContext(projectId, generation)) return;
      settings = next;
    } catch (err) {
      if (!isCurrentContext(projectId, generation)) return;
      settingsError = err instanceof Error ? err.message : 'Failed to load AI settings';
    } finally {
      if (isCurrentContext(projectId, generation)) settingsLoading = false;
    }
  }

  async function updateSettings(projectId: string, input: UpdateProjectAiSettingsInput) {
    settingsError = null;
    try {
      settings = await api.updateProjectAiSettings(projectId, input);
    } catch (err) {
      settingsError = err instanceof Error ? err.message : 'Failed to update AI settings';
    }
  }

  // ── Project AI skills ────────────────────────────────────────────────
  let skills = $state<ProjectAiSkill[]>([]);
  let skillsLoading = $state(false);
  let skillsError = $state<string | null>(null);

  async function loadSkills(projectId: string) {
    const generation = ensureProjectContext(projectId);
    skillsLoading = true;
    skillsError = null;
    try {
      const result = await api.listProjectAiSkills(projectId);
      if (!isCurrentContext(projectId, generation)) return;
      skills.splice(0, skills.length, ...result);
    } catch (err) {
      if (!isCurrentContext(projectId, generation)) return;
      skillsError = err instanceof Error ? err.message : 'Failed to load AI skills';
    } finally {
      if (isCurrentContext(projectId, generation)) skillsLoading = false;
    }
  }

  async function createSkill(projectId: string, input: CreateProjectAiSkillInput): Promise<ProjectAiSkill | null> {
    skillsError = null;
    try {
      const skill = await api.createProjectAiSkill(projectId, input);
      skills.push(skill);
      skills.sort((a, b) => a.name.localeCompare(b.name));
      return skill;
    } catch (err) {
      skillsError = err instanceof Error ? err.message : 'Failed to create AI skill';
      return null;
    }
  }

  async function updateSkill(projectId: string, skillId: string, input: UpdateProjectAiSkillInput): Promise<ProjectAiSkill | null> {
    skillsError = null;
    try {
      const skill = await api.updateProjectAiSkill(projectId, skillId, input);
      const idx = skills.findIndex((candidate) => candidate.id === skillId);
      if (idx >= 0) skills[idx] = skill;
      else skills.push(skill);
      skills.sort((a, b) => a.name.localeCompare(b.name));
      return skill;
    } catch (err) {
      skillsError = err instanceof Error ? err.message : 'Failed to update AI skill';
      return null;
    }
  }

  async function deleteSkill(projectId: string, skillId: string) {
    skillsError = null;
    try {
      await api.deleteProjectAiSkill(projectId, skillId);
      const idx = skills.findIndex((skill) => skill.id === skillId);
      if (idx >= 0) skills.splice(idx, 1);
    } catch (err) {
      skillsError = err instanceof Error ? err.message : 'Failed to delete AI skill';
    }
  }

  // ── Project docs ─────────────────────────────────────────────────────
  let docs = $state<ProjectDoc[]>([]);
  let fileTree = $state<ProjectFileTree>({ folders: [], docs: [], assets: [] });
  let docsTotal = $state(0);
  let docsLoading = $state(false);
  let docsError = $state<string | null>(null);

  async function loadDocs(projectId: string, opts: { limit?: number; offset?: number; kind?: ProjectDocKind } = {}) {
    const generation = ensureProjectContext(projectId);
    docsLoading = true;
    docsError = null;
    try {
      const result: PaginatedProjectDocs = await api.listProjectDocs(projectId, opts);
      if (!isCurrentContext(projectId, generation)) return;
      docs.splice(0, docs.length, ...result.items);
      fileTree.docs = result.items;
      docsTotal = result.total;
    } catch (err) {
      if (!isCurrentContext(projectId, generation)) return;
      docsError = err instanceof Error ? err.message : 'Failed to load docs';
    } finally {
      if (isCurrentContext(projectId, generation)) docsLoading = false;
    }
  }

  async function createDoc(projectId: string, input: CreateProjectDocInput): Promise<ProjectDoc | null> {
    docsError = null;
    try {
      const doc = await api.createProjectDoc(projectId, input);
      docs.push(doc);
      fileTree.docs.push(doc);
      docsTotal += 1;
      return doc;
    } catch (err) {
      docsError = err instanceof Error ? err.message : 'Failed to create doc';
      return null;
    }
  }

  async function getDoc(projectId: string, docId: string): Promise<ProjectDoc | null> {
    try {
      return await api.getProjectDoc(projectId, docId);
    } catch (err) {
      docsError = err instanceof Error ? err.message : 'Failed to load doc';
      return null;
    }
  }

  async function updateDoc(projectId: string, docId: string, input: UpdateProjectDocInput): Promise<ProjectDoc | null> {
    docsError = null;
    try {
      const updated = await api.updateProjectDoc(projectId, docId, input);
      const idx = docs.findIndex((d) => d.id === docId);
      if (idx >= 0) docs[idx] = updated;
      const treeIdx = fileTree.docs.findIndex((d) => d.id === docId);
      if (treeIdx >= 0) fileTree.docs[treeIdx] = updated;
      return updated;
    } catch (err) {
      docsError = err instanceof Error ? err.message : 'Failed to update doc';
      return null;
    }
  }

  async function deleteDoc(projectId: string, docId: string) {
    docsError = null;
    try {
      await api.deleteProjectDoc(projectId, docId);
      const idx = docs.findIndex((d) => d.id === docId);
      if (idx >= 0) {
        docs.splice(idx, 1);
        docsTotal -= 1;
      }
      const treeIdx = fileTree.docs.findIndex((d) => d.id === docId);
      if (treeIdx >= 0) fileTree.docs.splice(treeIdx, 1);
    } catch (err) {
      docsError = err instanceof Error ? err.message : 'Failed to delete doc';
    }
  }

  async function createFolder(projectId: string, input: CreateProjectFolderInput): Promise<ProjectFolder | null> {
    docsError = null;
    try {
      const folder = await api.createProjectFolder(projectId, input);
      fileTree.folders.push(folder);
      return folder;
    } catch (err) {
      docsError = err instanceof Error ? err.message : 'Failed to create folder';
      return null;
    }
  }

  async function updateFolder(projectId: string, folderId: string, input: UpdateProjectFolderInput): Promise<ProjectFolder | null> {
    docsError = null;
    try {
      const folder = await api.updateProjectFolder(projectId, folderId, input);
      const idx = fileTree.folders.findIndex((f) => f.id === folderId);
      if (idx >= 0) fileTree.folders[idx] = folder;
      await loadFileTree(projectId);
      return folder;
    } catch (err) {
      docsError = err instanceof Error ? err.message : 'Failed to update folder';
      return null;
    }
  }

  async function deleteFolder(projectId: string, folderId: string) {
    docsError = null;
    try {
      await api.deleteProjectFolder(projectId, folderId);
      await loadFileTree(projectId);
    } catch (err) {
      docsError = err instanceof Error ? err.message : 'Failed to delete folder';
    }
  }

  async function updateAsset(projectId: string, assetId: string, input: UpdateProjectAssetInput): Promise<Asset | null> {
    docsError = null;
    try {
      const asset = await api.updateProjectAsset(projectId, assetId, input);
      await loadFileTree(projectId);
      return asset;
    } catch (err) {
      docsError = err instanceof Error ? err.message : 'Failed to update asset';
      return null;
    }
  }

  async function deleteAsset(projectId: string, assetId: string) {
    docsError = null;
    try {
      await api.deleteProjectAsset(projectId, assetId);
      await loadFileTree(projectId);
    } catch (err) {
      docsError = err instanceof Error ? err.message : 'Failed to delete asset';
    }
  }

  // ── Agent session ────────────────────────────────────────────────────
  let session = $state<AiAgentSession | null>(null);
  let sessions = $state<AiAgentSessionSummary[]>([]);
  let activeSessionId = $state<string | null>(null);
  let sessionLoading = $state(false);
  let sessionError = $state<string | null>(null);
  let streaming = $state(false);
  let streamStatus = $state<'disconnected' | 'connecting' | 'connected' | 'reconnecting'>('disconnected');
  let streamError = $state<string | null>(null);
  let reconnectAttempt = $state(0);
  let streamAbort: AbortController | null = null;
  let streamGeneration = 0;
  let sessionRequestGeneration = 0;
  let promptMutationGeneration = 0;
  let pendingCancellationMutations = 0;
  let sessionListRequestGeneration = 0;
  let toolActionStates = $state<Record<string, 'approving' | 'rejecting' | 'answering'>>({});
  let toolActionErrors = $state<Record<string, string>>({});
  let timelineLoadingEarlier = $state(false);
  let timelineEarlierError = $state<string | null>(null);
  let earlierTimelineParts: AiAgentSessionPart[] = [];
  let timelineBeforeSequence: number | null = null;
  let timelineLegacyCursor: string | null = null;
  let timelineHasMoreBefore = false;

  // Accumulated streamed text for the current assistant turn
  let streamedText = $state('');

  function activeSessionStorageKey(projectId: string): string {
    return `opentales.ai.activeSession.${projectId}`;
  }

  function rememberActiveSession(projectId: string, sessionId: string | null) {
    activeSessionId = sessionId;
    if (sessionId) browserLocalStorage().setItem(activeSessionStorageKey(projectId), sessionId);
    else browserLocalStorage().removeItem(activeSessionStorageKey(projectId));
  }

  function applySessionSnapshot(next: AiAgentSession) {
    const sameSession = session?.id === next.id;
    if (!sameSession) {
      earlierTimelineParts = [];
      timelineEarlierError = null;
      timelineHasMoreBefore = Boolean(next.timelineInfo?.hasMoreBefore);
      timelineBeforeSequence =
        next.timelineInfo?.earliestSequence ?? earliestSequence(next.timeline ?? []);
      timelineLegacyCursor = next.timelineInfo?.legacyCursor ?? null;
    }
    const timeline = mergeTimelineParts(earlierTimelineParts, next.timeline ?? []);
    const timelineInfo = mergeTimelineInfo(
      sameSession ? session?.timelineInfo : undefined,
      next.timelineInfo,
      timeline,
      timelineHasMoreBefore,
    );
    session = { ...next, timeline, timelineInfo };
  }

  function mergeTimelineParts(
    earlier: AiAgentSessionPart[],
    current: AiAgentSessionPart[],
  ): AiAgentSessionPart[] {
    const byId = new Map<string, AiAgentSessionPart>();
    for (const part of [...earlier, ...current]) byId.set(part.id, part);
    return [...byId.values()].sort((left, right) => left.sequence - right.sequence);
  }

  function earliestSequence(parts: AiAgentSessionPart[]): number | null {
    return parts.length ? Math.min(...parts.map((part) => part.sequence)) : null;
  }

  function mergeTimelineInfo(
    previous: AiAgentTimelineInfo | undefined,
    incoming: AiAgentTimelineInfo | undefined,
    parts: AiAgentSessionPart[],
    hasMoreBefore: boolean,
  ): AiAgentTimelineInfo | undefined {
    const mode = combineTimelineModes(previous?.mode, incoming?.mode);
    if (!mode && !parts.length) return incoming;
    return {
      mode: mode ?? 'exact',
      truncated: hasMoreBefore,
      earliestSequence: earliestSequence(parts),
      hasMoreBefore,
      legacyCursor: timelineLegacyCursor,
    };
  }

  function combineTimelineModes(
    left: AiAgentTimelineInfo['mode'] | undefined,
    right: AiAgentTimelineInfo['mode'] | undefined,
  ): AiAgentTimelineInfo['mode'] | undefined {
    if (!left) return right;
    if (!right || left === right) return left;
    return 'mixed';
  }

  function upsertSessionSummary(next: AiAgentSession) {
    const summary: AiAgentSessionSummary = {
      id: next.id,
      projectId: next.projectId,
      title: next.title,
      approvalMode: next.approvalMode ?? 'manual',
      status: next.status,
      messageCount: next.messages.length,
      createdAt: next.updatedAt,
      updatedAt: next.updatedAt
    };
    const idx = sessions.findIndex((candidate) => candidate.id === next.id);
    if (idx >= 0) sessions[idx] = { ...sessions[idx], ...summary, createdAt: sessions[idx].createdAt };
    else sessions.unshift(summary);
  }

  async function loadSessions(projectId: string): Promise<string | null> {
    const generation = ensureProjectContext(projectId);
    const request = ++sessionListRequestGeneration;
    const sessionGenerationAtStart = sessionRequestGeneration;
    sessionError = null;
    try {
      const result = await api.listAiAgentSessions(projectId);
      if (
        !isCurrentContext(projectId, generation) ||
        request !== sessionListRequestGeneration ||
        sessionGenerationAtStart !== sessionRequestGeneration
      ) return null;
      sessions.splice(0, sessions.length, ...result);
      const remembered = browserLocalStorage().getItem(activeSessionStorageKey(projectId));
      const selected =
        result.find((candidate) => candidate.id === activeSessionId)?.id ??
        result.find((candidate) => candidate.id === remembered)?.id ??
        result[0]?.id ??
        null;
      rememberActiveSession(projectId, selected);
      return selected;
    } catch (err) {
      if (
        !isCurrentContext(projectId, generation) ||
        request !== sessionListRequestGeneration ||
        sessionGenerationAtStart !== sessionRequestGeneration
      ) return null;
      sessionError = err instanceof Error ? err.message : 'Failed to load sessions';
      return null;
    }
  }

  async function loadSession(
    projectId: string,
    sessionId = activeSessionId ?? undefined
  ): Promise<AiAgentSession | null> {
    const generation = ensureProjectContext(projectId);
    const request = ++sessionRequestGeneration;
    clearToolActions();
    sessionLoading = true;
    sessionError = null;
    try {
      const next = await api.getAiAgentSession(projectId, sessionId);
      if (!isCurrentSessionRequest(projectId, generation, request)) return null;
      applySessionSnapshot(next);
      rememberActiveSession(projectId, next.id);
      upsertSessionSummary(next);
      return next;
    } catch (err) {
      if (!isCurrentSessionRequest(projectId, generation, request)) return null;
      sessionError = err instanceof Error ? err.message : 'Failed to load session';
      return null;
    } finally {
      if (isCurrentSessionRequest(projectId, generation, request)) sessionLoading = false;
    }
  }

  function applyEvent(event: AiAgentSessionEvent) {
    const snapshot = event.session;
    if (snapshot) {
      if (snapshot.projectId !== projectContextId) return;
      if (activeSessionId && snapshot.id !== activeSessionId) return;
      const eventData = event.data as { cancelled?: boolean } | undefined;
      if (
        event.type === 'session' &&
        eventData?.cancelled === true &&
        pendingCancellationMutations === 0
      ) {
        promptMutationGeneration += 1;
      }
      applySessionSnapshot(snapshot);
      rememberActiveSession(snapshot.projectId, snapshot.id);
      upsertSessionSummary(snapshot);
    }

    const part = (event.data as { part?: AiAgentSessionPart } | undefined)?.part;
    if (part && session) {
      const timeline = [...(session.timeline ?? [])];
      const index = timeline.findIndex((candidate) => candidate.id === part.id);
      if (index >= 0) timeline[index] = part;
      else timeline.push(part);
      timeline.sort((left, right) => left.sequence - right.sequence);
      session = { ...session, timeline, updatedAt: part.updatedAt };
    }

    if (event.type === 'text-delta') {
      if (part?.kind === 'text') streamedText = part.content;
    }
    if (event.type === 'prompt-started') {
      streamedText = '';
    }
    if (event.type === 'error') {
      sessionError = snapshot?.error ?? (event.data as { message?: string })?.message ?? 'Agent error';
    }
  }

  async function createSession(
    projectId: string,
    title?: string,
    approvalMode: AiAgentApprovalMode = 'manual'
  ): Promise<AiAgentSession | null> {
    const generation = ensureProjectContext(projectId);
    const request = ++sessionRequestGeneration;
    clearToolActions();
    sessionLoading = true;
    sessionError = null;
    try {
      stopStream();
      session = null;
      const next = await api.createAiAgentSession(projectId, { title, approvalMode });
      if (!isCurrentSessionRequest(projectId, generation, request)) return null;
      applySessionSnapshot(next);
      rememberActiveSession(projectId, next.id);
      streamedText = '';
      upsertSessionSummary(next);
      void startStream(projectId, next.id);
      return next;
    } catch (err) {
      if (!isCurrentSessionRequest(projectId, generation, request)) return null;
      sessionError = err instanceof Error ? err.message : 'Failed to create session';
      return null;
    } finally {
      if (isCurrentSessionRequest(projectId, generation, request)) sessionLoading = false;
    }
  }

  async function updateSessionApprovalMode(
    projectId: string,
    approvalMode: AiAgentApprovalMode
  ): Promise<boolean> {
    if (!activeSessionId || !session) return false;
    const generation = ensureProjectContext(projectId);
    const request = sessionRequestGeneration;
    const targetSessionId = activeSessionId;
    sessionError = null;
    try {
      const next = await api.updateAiAgentSession(projectId, targetSessionId, { approvalMode });
      if (!isCurrentSessionMutation(projectId, generation, request, targetSessionId)) return false;
      applySessionSnapshot(next);
      upsertSessionSummary(next);
      return true;
    } catch (err) {
      if (!isCurrentSessionMutation(projectId, generation, request, targetSessionId)) return false;
      sessionError = err instanceof Error ? err.message : 'Failed to update execution mode';
      return false;
    }
  }

  async function selectSession(projectId: string, sessionId: string): Promise<boolean> {
    const generation = ensureProjectContext(projectId);
    if (activeSessionId === sessionId && session?.id === sessionId) return true;
    const request = ++sessionRequestGeneration;
    clearToolActions();
    stopStream();
    rememberActiveSession(projectId, sessionId);
    session = null;
    streamedText = '';
    sessionLoading = true;
    sessionError = null;
    let loaded: AiAgentSession;
    try {
      loaded = await api.getAiAgentSession(projectId, sessionId);
    } catch (err) {
      if (isCurrentSessionRequest(projectId, generation, request)) {
        sessionError = err instanceof Error ? err.message : 'Failed to load session';
        sessionLoading = false;
      }
      return false;
    }
    if (!isCurrentSessionRequest(projectId, generation, request)) return false;
    applySessionSnapshot(loaded);
    rememberActiveSession(projectId, loaded.id);
    upsertSessionSummary(loaded);
    sessionLoading = false;
    void startStream(projectId, sessionId);
    return true;
  }

  function isCurrentSessionRequest(
    projectId: string,
    projectGeneration: number,
    requestGeneration: number
  ): boolean {
    return (
      isCurrentContext(projectId, projectGeneration) &&
      sessionRequestGeneration === requestGeneration
    );
  }

  function isCurrentSessionMutation(
    projectId: string,
    projectGeneration: number,
    requestGeneration: number,
    targetSessionId: string | null
  ): boolean {
    return (
      isCurrentContext(projectId, projectGeneration) &&
      sessionRequestGeneration === requestGeneration &&
      activeSessionId === targetSessionId
    );
  }

  async function startStream(projectId: string, sessionId = activeSessionId ?? session?.id) {
    if (!sessionId || projectContextId !== projectId) return;
    stopStream();
    const handle = ++streamGeneration;
    const contextAtStart = contextGeneration;
    const controller = new AbortController();
    streamAbort = controller;
    streaming = true;
    streamStatus = 'connecting';
    streamError = null;
    reconnectAttempt = 0;
    let lastError = 'Agent stream disconnected';

    for (let attempt = 0; attempt <= STREAM_RECONNECT_MAX_ATTEMPTS; attempt += 1) {
      if (!isCurrentStream(handle, projectId, sessionId, contextAtStart)) break;
      if (attempt > 0) {
        streamStatus = 'reconnecting';
        reconnectAttempt = attempt;
        try {
          const snapshot = await api.getAiAgentSession(projectId, sessionId);
          if (!isCurrentStream(handle, projectId, sessionId, contextAtStart)) break;
          applySessionSnapshot(snapshot);
          upsertSessionSummary(snapshot);
        } catch (err) {
          lastError = err instanceof Error ? err.message : 'Failed to restore agent session';
        }
      }

      try {
        await api.streamAiAgentSession(
          projectId,
          sessionId,
          (event) => {
            if (!isCurrentStream(handle, projectId, sessionId, contextAtStart)) return;
            streamStatus = 'connected';
            applyEvent(event);
          },
          { signal: controller.signal }
        );
        if (controller.signal.aborted) break;
        lastError = 'Agent stream closed unexpectedly';
      } catch (err) {
        if (controller.signal.aborted || (err as Error).name === 'AbortError') break;
        lastError = err instanceof Error ? err.message : 'Agent stream disconnected';
      }

      if (attempt >= STREAM_RECONNECT_MAX_ATTEMPTS) {
        if (isCurrentStream(handle, projectId, sessionId, contextAtStart)) {
          streamError = `${lastError}. Retry the connection.`;
        }
        break;
      }

      streamStatus = 'reconnecting';
      reconnectAttempt = attempt + 1;
      try {
        await abortableDelay(reconnectDelayMs(attempt), controller.signal);
      } catch {
        break;
      }
    }

    if (handle === streamGeneration) {
      streaming = false;
      streamStatus = 'disconnected';
      reconnectAttempt = 0;
      if (streamAbort === controller) streamAbort = null;
    }
  }

  function isCurrentStream(
    handle: number,
    projectId: string,
    sessionId: string,
    generation: number
  ): boolean {
    return (
      handle === streamGeneration &&
      !streamAbort?.signal.aborted &&
      isCurrentContext(projectId, generation) &&
      activeSessionId === sessionId
    );
  }

  async function retryStream(): Promise<void> {
    if (!projectContextId || !activeSessionId) return;
    await startStream(projectContextId, activeSessionId);
  }

  function stopStream() {
    streamGeneration += 1;
    if (streamAbort) {
      streamAbort.abort();
      streamAbort = null;
    }
    streaming = false;
    streamStatus = 'disconnected';
    reconnectAttempt = 0;
  }

  async function queuePrompt(
    projectId: string,
    prompt: string,
    interrupt = false,
    options: { model?: string; attachments?: AiAgentAttachmentInput[] } = {}
  ) {
    const generation = ensureProjectContext(projectId);
    const request = sessionRequestGeneration;
    const mutation = ++promptMutationGeneration;
    const targetSessionId = activeSessionId;
    sessionError = null;
    try {
      const next = await api.queueAiAgentPrompt(
        projectId,
        { prompt, interrupt, model: options.model, attachments: options.attachments },
        activeSessionId ?? undefined
      );
      if (
        mutation !== promptMutationGeneration ||
        !isCurrentSessionMutation(projectId, generation, request, targetSessionId)
      ) return false;
      applySessionSnapshot(next);
      rememberActiveSession(projectId, next.id);
      upsertSessionSummary(next);
      return true;
    } catch (err) {
      if (
        mutation !== promptMutationGeneration ||
        !isCurrentSessionMutation(projectId, generation, request, targetSessionId)
      ) return false;
      sessionError = err instanceof Error ? err.message : 'Failed to queue prompt';
      return false;
    }
  }

  async function cancelSession(projectId: string) {
    const generation = ensureProjectContext(projectId);
    const request = sessionRequestGeneration;
    const mutation = ++promptMutationGeneration;
    const targetSessionId = activeSessionId;
    sessionError = null;
    pendingCancellationMutations += 1;
    try {
      const next = await api.cancelAiAgentSession(projectId, activeSessionId ?? undefined);
      if (
        mutation !== promptMutationGeneration ||
        !isCurrentSessionMutation(projectId, generation, request, targetSessionId)
      ) return false;
      applySessionSnapshot(next);
      rememberActiveSession(projectId, next.id);
      upsertSessionSummary(next);
      return true;
    } catch (err) {
      if (
        mutation !== promptMutationGeneration ||
        !isCurrentSessionMutation(projectId, generation, request, targetSessionId)
      ) return false;
      sessionError = err instanceof Error ? err.message : 'Failed to cancel';
      return false;
    } finally {
      pendingCancellationMutations = Math.max(0, pendingCancellationMutations - 1);
    }
  }

  async function approveToolCall(
    projectId: string,
    toolCallId: string,
    approved: boolean,
    sessionId = activeSessionId ?? undefined
  ): Promise<boolean> {
    const generation = ensureProjectContext(projectId);
    const request = sessionRequestGeneration;
    const targetSessionId = sessionId ?? null;
    if (!beginToolActions([toolCallId], approved ? 'approving' : 'rejecting')) return false;
    sessionError = null;
    try {
      const next = await api.approveAiToolCall(projectId, toolCallId, { approved }, sessionId);
      if (!isCurrentSessionMutation(projectId, generation, request, targetSessionId)) return false;
      applySessionSnapshot(next);
      rememberActiveSession(projectId, next.id);
      upsertSessionSummary(next);
      return true;
    } catch (err) {
      if (!isCurrentSessionMutation(projectId, generation, request, targetSessionId)) return false;
      const message = err instanceof Error ? err.message : 'Failed to update tool approval';
      sessionError = message;
      setToolActionError([toolCallId], message);
      return false;
    } finally {
      if (isCurrentSessionMutation(projectId, generation, request, targetSessionId))
        finishToolActions([toolCallId]);
    }
  }

  async function approveToolCalls(
    projectId: string,
    toolCallIds: string[],
    approved: boolean,
    sessionId = activeSessionId ?? undefined
  ): Promise<boolean> {
    const generation = ensureProjectContext(projectId);
    const request = sessionRequestGeneration;
    const targetSessionId = sessionId ?? null;
    if (!beginToolActions(toolCallIds, approved ? 'approving' : 'rejecting')) return false;
    sessionError = null;
    try {
      const next = await api.approveAiToolCalls(projectId, { toolCallIds, approved }, sessionId);
      if (!isCurrentSessionMutation(projectId, generation, request, targetSessionId)) return false;
      applySessionSnapshot(next);
      rememberActiveSession(projectId, next.id);
      upsertSessionSummary(next);
      return true;
    } catch (err) {
      if (!isCurrentSessionMutation(projectId, generation, request, targetSessionId)) return false;
      const message = err instanceof Error ? err.message : 'Failed to update tool approvals';
      sessionError = message;
      setToolActionError(toolCallIds, message);
      return false;
    } finally {
      if (isCurrentSessionMutation(projectId, generation, request, targetSessionId))
        finishToolActions(toolCallIds);
    }
  }

  function beginToolActions(
    toolCallIds: string[],
    state: 'approving' | 'rejecting' | 'answering'
  ): boolean {
    if (toolCallIds.some((id) => toolActionStates[id])) return false;
    const nextStates = { ...toolActionStates };
    const nextErrors = { ...toolActionErrors };
    for (const id of toolCallIds) {
      nextStates[id] = state;
      delete nextErrors[id];
    }
    toolActionStates = nextStates;
    toolActionErrors = nextErrors;
    return true;
  }

  function finishToolActions(toolCallIds: string[]) {
    const next = { ...toolActionStates };
    for (const id of toolCallIds) delete next[id];
    toolActionStates = next;
  }

  function setToolActionError(toolCallIds: string[], message: string) {
    const next = { ...toolActionErrors };
    for (const id of toolCallIds) next[id] = message;
    toolActionErrors = next;
  }

  function clearToolActions() {
    toolActionStates = {};
    toolActionErrors = {};
  }

  async function startGithubCopilotAuth(projectId: string): Promise<StartGithubCopilotAuthResult | null> {
    settingsError = null;
    try {
      return await api.startGithubCopilotAuth(projectId);
    } catch (err) {
      settingsError = err instanceof Error ? err.message : 'Failed to start GitHub Copilot auth';
      return null;
    }
  }

  async function pollGithubCopilotAuth(projectId: string, deviceCode: string): Promise<PollGithubCopilotAuthResult | null> {
    settingsError = null;
    try {
      const result = await api.pollGithubCopilotAuth(projectId, { deviceCode });
      if (result.settings) settings = result.settings;
      return result;
    } catch (err) {
      settingsError = err instanceof Error ? err.message : 'Failed to finish GitHub Copilot auth';
      return null;
    }
  }

  async function startCodexAuth(projectId: string): Promise<StartCodexAuthResult | null> {
    settingsError = null;
    try {
      return await api.startCodexAuth(projectId);
    } catch (err) {
      settingsError = err instanceof Error ? err.message : 'Failed to start Codex auth';
      return null;
    }
  }

  async function pollCodexAuth(
    projectId: string,
    deviceAuthId: string,
    userCode: string
  ): Promise<PollCodexAuthResult | null> {
    settingsError = null;
    try {
      const result = await api.pollCodexAuth(projectId, { deviceAuthId, userCode });
      if (result.settings) settings = result.settings;
      return result;
    } catch (err) {
      settingsError = err instanceof Error ? err.message : 'Failed to finish Codex auth';
      return null;
    }
  }

  async function loadModelCatalog(projectId: string) {
    const generation = ensureProjectContext(projectId);
    modelCatalogLoading = true;
    modelCatalogError = null;
    try {
      const next = await api.listAiModels(projectId);
      if (!isCurrentContext(projectId, generation)) return;
      modelCatalog = next;
    } catch (err) {
      if (!isCurrentContext(projectId, generation)) return;
      modelCatalogError = err instanceof Error ? err.message : 'Failed to load AI models';
    } finally {
      if (isCurrentContext(projectId, generation)) modelCatalogLoading = false;
    }
  }

  async function answerQuestion(
    projectId: string,
    toolCallId: string,
    answers: string[][],
    sessionId = activeSessionId ?? undefined
  ): Promise<boolean> {
    const generation = ensureProjectContext(projectId);
    const request = sessionRequestGeneration;
    const targetSessionId = sessionId ?? null;
    if (!beginToolActions([toolCallId], 'answering')) return false;
    sessionError = null;
    try {
      const next = await api.answerAiQuestion(projectId, toolCallId, { answers }, sessionId);
      if (!isCurrentSessionMutation(projectId, generation, request, targetSessionId)) return false;
      applySessionSnapshot(next);
      rememberActiveSession(projectId, next.id);
      upsertSessionSummary(next);
      return true;
    } catch (err) {
      if (!isCurrentSessionMutation(projectId, generation, request, targetSessionId)) return false;
      const message = err instanceof Error ? err.message : 'Failed to answer question';
      sessionError = message;
      setToolActionError([toolCallId], message);
      return false;
    } finally {
      if (isCurrentSessionMutation(projectId, generation, request, targetSessionId))
        finishToolActions([toolCallId]);
    }
  }

  async function loadToolCallDetail(
    projectId: string,
    toolCallId: string,
    sessionId = activeSessionId ?? undefined
  ): Promise<AiAgentToolCall> {
    const generation = ensureProjectContext(projectId);
    const request = sessionRequestGeneration;
    const targetSessionId = sessionId ?? null;
    try {
      const detail = await api.getAiAgentToolCall(projectId, toolCallId, sessionId);
      if (!isCurrentSessionMutation(projectId, generation, request, targetSessionId))
        throw new Error('The active project changed before the tool result loaded');
      return detail;
    } catch (err) {
      if (isCurrentSessionMutation(projectId, generation, request, targetSessionId)) {
        sessionError = err instanceof Error ? err.message : 'Failed to load the full tool result';
      }
      throw err;
    }
  }

  async function loadEarlierTimeline(
    projectId: string,
    sessionId = activeSessionId ?? undefined,
  ): Promise<boolean> {
    if (!sessionId || !session || timelineLoadingEarlier || !timelineHasMoreBefore)
      return false;
    const beforeSequence =
      timelineBeforeSequence ??
      session.timelineInfo?.earliestSequence ??
      earliestSequence(session.timeline ?? []);
    if (beforeSequence === null && timelineLegacyCursor === null) return false;
    const generation = ensureProjectContext(projectId);
    const request = sessionRequestGeneration;
    const targetSessionId = sessionId;
    timelineLoadingEarlier = true;
    timelineEarlierError = null;
    try {
      const page = await api.getAiAgentTimeline(
        projectId,
        timelineLegacyCursor !== null
          ? {
              legacyCursor: timelineLegacyCursor,
              beforeSequence: beforeSequence ?? undefined,
              limit: 200,
            }
          : { beforeSequence: beforeSequence ?? undefined, limit: 200 },
        sessionId,
      );
      if (!isCurrentSessionMutation(projectId, generation, request, targetSessionId))
        return false;
      earlierTimelineParts = mergeTimelineParts(page.parts, earlierTimelineParts);
      if (
        page.limitation === 'legacy-history-best-effort' &&
        page.hasMore &&
        !page.nextLegacyCursor
      ) {
        timelineHasMoreBefore = false;
        timelineEarlierError = 'Earlier activity returned no continuation cursor.';
      } else {
        timelineHasMoreBefore = page.hasMore;
      }
      if (page.limitation === 'legacy-history-best-effort') {
        timelineLegacyCursor = page.nextLegacyCursor ?? null;
        timelineBeforeSequence = page.nextBeforeSequence;
      } else {
        timelineLegacyCursor = null;
        timelineBeforeSequence = page.nextBeforeSequence;
      }
      const timeline = mergeTimelineParts(earlierTimelineParts, session.timeline ?? []);
      session = {
        ...session,
        timeline,
        timelineInfo: {
          mode:
            combineTimelineModes(session.timelineInfo?.mode, page.timelineInfo.mode) ??
            page.timelineInfo.mode,
          truncated: timelineHasMoreBefore,
          earliestSequence: earliestSequence(timeline),
          hasMoreBefore: timelineHasMoreBefore,
          legacyCursor: timelineLegacyCursor,
        },
      };
      return true;
    } catch (err) {
      if (!isCurrentSessionMutation(projectId, generation, request, targetSessionId))
        return false;
      timelineEarlierError =
        err instanceof Error ? err.message : 'Failed to load earlier activity';
      return false;
    } finally {
      if (isCurrentSessionMutation(projectId, generation, request, targetSessionId))
        timelineLoadingEarlier = false;
    }
  }

  async function loadFileTree(projectId: string) {
    const generation = ensureProjectContext(projectId);
    docsLoading = true;
    docsError = null;
    try {
      const result = await api.getProjectFileTree(projectId);
      if (!isCurrentContext(projectId, generation)) return;
      fileTree = result;
      docs.splice(0, docs.length, ...result.docs);
      docsTotal = result.docs.length;
    } catch (err) {
      if (!isCurrentContext(projectId, generation)) return;
      docsError = err instanceof Error ? err.message : 'Failed to load docs';
    } finally {
      if (isCurrentContext(projectId, generation)) docsLoading = false;
    }
  }

  async function uploadAttachment(projectId: string, file: Blob, options: { kind?: AssetKind; filename?: string } = {}): Promise<Asset | null> {
    sessionError = null;
    try {
      return await api.uploadAsset(projectId, file, options);
    } catch (err) {
      sessionError = err instanceof Error ? err.message : 'Failed to upload attachment';
      return null;
    }
  }

  // ── Tool manifest ───────────────────────────────────────────────────
  let toolManifest = $state<AiToolManifest | null>(null);

  async function loadToolManifest(projectId: string) {
    const generation = ensureProjectContext(projectId);
    try {
      const next = await api.listAiTools(projectId);
      if (!isCurrentContext(projectId, generation)) return;
      toolManifest = next;
    } catch {
      // non-critical
    }
  }

  // ── One-shot AI features ────────────────────────────────────────────
  let featureLoading = $state(false);
  let featureError = $state<string | null>(null);

  let rewriteResult = $state<AiRewriteSuggestion | null>(null);
  let dialogueResult = $state<AiCharacterDialogueSuggestion | null>(null);
  let outlineResult = $state<AiOutlineExpansion | null>(null);
  let continuityResult = $state<AiContinuityReview | null>(null);

  async function createRewrite(
    projectId: string,
    text: string,
    mode: AiRewriteMode,
    context?: string
  ) {
    featureLoading = true;
    featureError = null;
    rewriteResult = null;
    try {
      rewriteResult = await api.createRewriteSuggestion(projectId, { text, mode, context });
    } catch (err) {
      featureError = err instanceof Error ? err.message : 'Rewrite failed';
    } finally {
      featureLoading = false;
    }
  }

  async function createDialogue(
    projectId: string,
    characterId: string,
    situation: string,
    count?: number
  ) {
    featureLoading = true;
    featureError = null;
    dialogueResult = null;
    try {
      dialogueResult = await api.createCharacterDialogueSuggestion(projectId, {
        characterId,
        situation,
        count
      });
    } catch (err) {
      featureError = err instanceof Error ? err.message : 'Dialogue generation failed';
    } finally {
      featureLoading = false;
    }
  }

  async function createOutline(
    projectId: string,
    synopsis: string,
    targetLength?: 'short' | 'medium' | 'long',
    povCharacterId?: string,
    locationId?: string
  ) {
    featureLoading = true;
    featureError = null;
    outlineResult = null;
    try {
      outlineResult = await api.createOutlineExpansion(projectId, {
        synopsis,
        targetLength,
        povCharacterId,
        locationId
      });
    } catch (err) {
      featureError = err instanceof Error ? err.message : 'Outline expansion failed';
    } finally {
      featureLoading = false;
    }
  }

  async function runContinuityReview(projectId: string, submissionId: string) {
    featureLoading = true;
    featureError = null;
    continuityResult = null;
    try {
      continuityResult = await api.runContinuityReview(projectId, submissionId);
    } catch (err) {
      featureError = err instanceof Error ? err.message : 'Continuity review failed';
    } finally {
      featureLoading = false;
    }
  }

  function clearFeatureResults() {
    rewriteResult = null;
    dialogueResult = null;
    outlineResult = null;
    continuityResult = null;
    featureError = null;
  }

  // ── Reset on project switch ─────────────────────────────────────────
  function clearProjectState() {
    settings = null;
    settingsLoading = false;
    settingsError = null;
    modelCatalog = null;
    modelCatalogLoading = false;
    modelCatalogError = null;
    skills.splice(0, skills.length);
    skillsLoading = false;
    skillsError = null;
    docs.splice(0, docs.length);
    fileTree = { folders: [], docs: [], assets: [] };
    docsTotal = 0;
    docsLoading = false;
    docsError = null;
    stopStream();
    session = null;
    sessions.splice(0, sessions.length);
    activeSessionId = null;
    sessionLoading = false;
    sessionError = null;
    streamError = null;
    toolActionStates = {};
    toolActionErrors = {};
    timelineLoadingEarlier = false;
    timelineEarlierError = null;
    earlierTimelineParts = [];
    timelineBeforeSequence = null;
    timelineLegacyCursor = null;
    timelineHasMoreBefore = false;
    streamedText = '';
    toolManifest = null;
    clearFeatureResults();
  }

  function setProjectContext(projectId: string | null): number {
    if (projectContextId === projectId) return contextGeneration;
    projectContextId = projectId;
    contextGeneration += 1;
    sessionRequestGeneration += 1;
    sessionListRequestGeneration += 1;
    clearProjectState();
    return contextGeneration;
  }

  function reset() {
    projectContextId = null;
    contextGeneration += 1;
    sessionRequestGeneration += 1;
    sessionListRequestGeneration += 1;
    clearProjectState();
  }

  return {
    // settings
    get settings() { return settings; },
    get settingsLoading() { return settingsLoading; },
    get settingsError() { return settingsError; },
    get modelCatalog() { return modelCatalog; },
    get modelCatalogLoading() { return modelCatalogLoading; },
    get modelCatalogError() { return modelCatalogError; },
    loadSettings,
    updateSettings,
    loadModelCatalog,
    startGithubCopilotAuth,
    pollGithubCopilotAuth,
    startCodexAuth,
    pollCodexAuth,

    // skills
    get skills() { return skills; },
    get skillsLoading() { return skillsLoading; },
    get skillsError() { return skillsError; },
    loadSkills,
    createSkill,
    updateSkill,
    deleteSkill,

    // docs
    get docs() { return docs; },
    get fileTree() { return fileTree; },
    get docsTotal() { return docsTotal; },
    get docsLoading() { return docsLoading; },
    get docsError() { return docsError; },
    loadDocs,
    loadFileTree,
    createDoc,
    getDoc,
    updateDoc,
    deleteDoc,
    createFolder,
    updateFolder,
    deleteFolder,
    updateAsset,
    deleteAsset,

    // agent session
    get session() { return session; },
    get sessions() { return sessions; },
    get activeSessionId() { return activeSessionId; },
    get sessionGeneration() { return sessionRequestGeneration; },
    get sessionLoading() { return sessionLoading; },
    get sessionError() { return sessionError; },
    get streaming() { return streaming; },
    get streamStatus() { return streamStatus; },
    get streamError() { return streamError; },
    get reconnectAttempt() { return reconnectAttempt; },
    get canRetryStream() { return Boolean(streamError && projectContextId && activeSessionId); },
    get toolActionStates() { return toolActionStates; },
    get toolActionErrors() { return toolActionErrors; },
    get timelineLoadingEarlier() { return timelineLoadingEarlier; },
    get timelineEarlierError() { return timelineEarlierError; },
    get canLoadEarlierTimeline() { return timelineHasMoreBefore; },
    get streamedText() { return streamedText; },
    setProjectContext,
    loadSessions,
    loadSession,
    createSession,
    updateSessionApprovalMode,
    selectSession,
    startStream,
    retryStream,
    stopStream,
    queuePrompt,
    cancelSession,
    approveToolCall,
    approveToolCalls,
    answerQuestion,
    loadToolCallDetail,
    loadEarlierTimeline,
    uploadAttachment,

    // tool manifest
    get toolManifest() { return toolManifest; },
    loadToolManifest,

    // features
    get featureLoading() { return featureLoading; },
    get featureError() { return featureError; },
    get rewriteResult() { return rewriteResult; },
    get dialogueResult() { return dialogueResult; },
    get outlineResult() { return outlineResult; },
    get continuityResult() { return continuityResult; },
    createRewrite,
    createDialogue,
    createOutline,
    runContinuityReview,
    clearFeatureResults,

    reset
  };
}

export type AiStore = ReturnType<typeof createAiStore>;
export const ai: AiStore = createAiStore();
