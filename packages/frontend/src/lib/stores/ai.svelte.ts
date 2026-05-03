import {
  OpenTalesClient,
  type Asset,
  type AssetKind,
  type AiAgentSession,
  type AiAgentSessionEvent,
  type AiAgentSessionSummary,
  type AiAgentToolCall,
  type AiAgentAttachmentInput,
  type AiCharacterDialogueSuggestion,
  type AiContinuityReview,
  type AiOutlineExpansion,
  type AiRewriteMode,
  type AiRewriteSuggestion,
  type AiToolManifest,
  type CreateProjectAiSkillInput,
  type CreateProjectFolderInput,
  type CreateProjectDocInput,
  type PaginatedProjectDocs,
  type ProjectAiSettings,
  type ProjectAiSkill,
  type ProjectDoc,
  type ProjectFileTree,
  type ProjectFolder,
  type ProjectDocKind,
  type UpdateProjectAiSkillInput,
  type UpdateProjectAiSettingsInput,
  type UpdateProjectAssetInput,
  type UpdateProjectFolderInput,
  type UpdateProjectDocInput
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

// Keep the SDK token in sync whenever the manuscript store changes it.
export function syncAiToken(token: string | undefined) {
  api.setToken(token);
}

function createAiStore() {
  // ── AI settings ──────────────────────────────────────────────────────
  let settings = $state<ProjectAiSettings | null>(null);
  let settingsLoading = $state(false);
  let settingsError = $state<string | null>(null);

  async function loadSettings(projectId: string) {
    settingsLoading = true;
    settingsError = null;
    try {
      settings = await api.getProjectAiSettings(projectId);
    } catch (err) {
      settingsError = err instanceof Error ? err.message : 'Failed to load AI settings';
    } finally {
      settingsLoading = false;
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
    skillsLoading = true;
    skillsError = null;
    try {
      const result = await api.listProjectAiSkills(projectId);
      skills.splice(0, skills.length, ...result);
    } catch (err) {
      skillsError = err instanceof Error ? err.message : 'Failed to load AI skills';
    } finally {
      skillsLoading = false;
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
    docsLoading = true;
    docsError = null;
    try {
      const result: PaginatedProjectDocs = await api.listProjectDocs(projectId, opts);
      docs.splice(0, docs.length, ...result.items);
      fileTree.docs = result.items;
      docsTotal = result.total;
    } catch (err) {
      docsError = err instanceof Error ? err.message : 'Failed to load docs';
    } finally {
      docsLoading = false;
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
  let streamAbort: AbortController | null = null;

  // Accumulated streamed text for the current assistant turn
  let streamedText = $state('');

  function upsertSessionSummary(next: AiAgentSession) {
    const summary: AiAgentSessionSummary = {
      id: next.id,
      projectId: next.projectId,
      title: next.title,
      status: next.status,
      messageCount: next.messages.length,
      createdAt: next.updatedAt,
      updatedAt: next.updatedAt
    };
    const idx = sessions.findIndex((candidate) => candidate.id === next.id);
    if (idx >= 0) sessions[idx] = { ...sessions[idx], ...summary, createdAt: sessions[idx].createdAt };
    else sessions.unshift(summary);
  }

  async function loadSessions(projectId: string) {
    sessionError = null;
    try {
      const result = await api.listAiAgentSessions(projectId);
      sessions.splice(0, sessions.length, ...result);
      if (!activeSessionId && result[0]) activeSessionId = result[0].id;
    } catch (err) {
      sessionError = err instanceof Error ? err.message : 'Failed to load sessions';
    }
  }

  async function loadSession(projectId: string, sessionId = activeSessionId ?? undefined) {
    sessionLoading = true;
    sessionError = null;
    try {
      session = await api.getAiAgentSession(projectId, sessionId);
      activeSessionId = session.id;
      upsertSessionSummary(session);
    } catch (err) {
      sessionError = err instanceof Error ? err.message : 'Failed to load session';
    } finally {
      sessionLoading = false;
    }
  }

  function applyEvent(event: AiAgentSessionEvent) {
    // Every event carries the full session snapshot
    if (activeSessionId && event.session.id !== activeSessionId) return;
    session = event.session;
    activeSessionId = event.session.id;
    upsertSessionSummary(event.session);

    if (event.type === 'text-delta') {
      const delta = (event.data as { text?: string; textDelta?: string })?.text ?? (event.data as { textDelta?: string })?.textDelta ?? '';
      streamedText += delta;
    }
    if (event.type === 'prompt-started') {
      streamedText = '';
    }
    if (event.type === 'error') {
      sessionError = event.session.error ?? (event.data as { message?: string })?.message ?? 'Agent error';
    }
  }

  async function createSession(projectId: string, title?: string) {
    sessionLoading = true;
    sessionError = null;
    try {
      stopStream();
      session = await api.createAiAgentSession(projectId, { title });
      activeSessionId = session.id;
      streamedText = '';
      upsertSessionSummary(session);
      void startStream(projectId, session.id);
    } catch (err) {
      sessionError = err instanceof Error ? err.message : 'Failed to create session';
    } finally {
      sessionLoading = false;
    }
  }

  async function selectSession(projectId: string, sessionId: string) {
    if (activeSessionId === sessionId && session?.id === sessionId) return;
    stopStream();
    activeSessionId = sessionId;
    streamedText = '';
    await loadSession(projectId, sessionId);
    void startStream(projectId, sessionId);
  }

  async function startStream(projectId: string, sessionId = activeSessionId ?? session?.id) {
    if (!sessionId) return;
    if (streaming) return;
    stopStream();

    streaming = true;
    streamAbort = new AbortController();

    try {
      await api.streamAiAgentSession(projectId, sessionId, applyEvent, {
        signal: streamAbort.signal
      });
    } catch (err) {
      if ((err as Error).name !== 'AbortError') {
        sessionError = err instanceof Error ? err.message : 'Stream error';
      }
    } finally {
      streaming = false;
      streamAbort = null;
    }
  }

  function stopStream() {
    if (streamAbort) {
      streamAbort.abort();
      streamAbort = null;
    }
    streaming = false;
  }

  async function queuePrompt(
    projectId: string,
    prompt: string,
    interrupt = false,
    options: { model?: string; attachments?: AiAgentAttachmentInput[] } = {}
  ) {
    sessionError = null;
    try {
      session = await api.queueAiAgentPrompt(
        projectId,
        { prompt, interrupt, model: options.model, attachments: options.attachments },
        activeSessionId ?? undefined
      );
      activeSessionId = session.id;
      upsertSessionSummary(session);
    } catch (err) {
      sessionError = err instanceof Error ? err.message : 'Failed to queue prompt';
    }
  }

  async function cancelSession(projectId: string) {
    sessionError = null;
    try {
      session = await api.cancelAiAgentSession(projectId, activeSessionId ?? undefined);
      activeSessionId = session.id;
      upsertSessionSummary(session);
    } catch (err) {
      sessionError = err instanceof Error ? err.message : 'Failed to cancel';
    }
  }

  async function approveToolCall(projectId: string, toolCallId: string, approved: boolean, sessionId = activeSessionId ?? undefined) {
    sessionError = null;
    try {
      session = await api.approveAiToolCall(projectId, toolCallId, { approved }, sessionId);
      activeSessionId = session.id;
      upsertSessionSummary(session);
    } catch (err) {
      sessionError = err instanceof Error ? err.message : 'Failed to approve tool call';
    }
  }

  async function approveToolCalls(projectId: string, toolCallIds: string[], approved: boolean, sessionId = activeSessionId ?? undefined) {
    sessionError = null;
    try {
      session = await api.approveAiToolCalls(projectId, { toolCallIds, approved }, sessionId);
      activeSessionId = session.id;
      upsertSessionSummary(session);
    } catch (err) {
      sessionError = err instanceof Error ? err.message : 'Failed to approve tool calls';
    }
  }

  async function answerQuestion(projectId: string, toolCallId: string, answers: string[][], sessionId = activeSessionId ?? undefined) {
    sessionError = null;
    try {
      session = await api.answerAiQuestion(projectId, toolCallId, { answers }, sessionId);
      activeSessionId = session.id;
      upsertSessionSummary(session);
    } catch (err) {
      sessionError = err instanceof Error ? err.message : 'Failed to answer question';
    }
  }

  async function loadFileTree(projectId: string) {
    docsLoading = true;
    docsError = null;
    try {
      const result = await api.getProjectFileTree(projectId);
      fileTree = result;
      docs.splice(0, docs.length, ...result.docs);
      docsTotal = result.docs.length;
    } catch (err) {
      docsError = err instanceof Error ? err.message : 'Failed to load docs';
    } finally {
      docsLoading = false;
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
    try {
      toolManifest = await api.listAiTools(projectId);
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
  function reset() {
    settings = null;
    settingsError = null;
    skills.splice(0, skills.length);
    skillsError = null;
    docs.splice(0, docs.length);
    fileTree = { folders: [], docs: [], assets: [] };
    docsTotal = 0;
    docsError = null;
    stopStream();
    session = null;
    sessions.splice(0, sessions.length);
    activeSessionId = null;
    sessionError = null;
    streamedText = '';
    toolManifest = null;
    clearFeatureResults();
  }

  return {
    // settings
    get settings() { return settings; },
    get settingsLoading() { return settingsLoading; },
    get settingsError() { return settingsError; },
    loadSettings,
    updateSettings,

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
    get sessionLoading() { return sessionLoading; },
    get sessionError() { return sessionError; },
    get streaming() { return streaming; },
    get streamedText() { return streamedText; },
    loadSessions,
    loadSession,
    createSession,
    selectSession,
    startStream,
    stopStream,
    queuePrompt,
    cancelSession,
    approveToolCall,
    approveToolCalls,
    answerQuestion,
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
