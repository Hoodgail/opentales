import {
  OpenTalesClient,
  type Asset,
  type AssetKind,
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
import { agent, resetAgentStore } from './agent.svelte';

const initialAiToken = browserLocalStorage().getItem('opentales.token') ?? undefined;
export const api = new OpenTalesClient({
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
  resetAgentStore();
}

export function syncAiProjectContext(projectId: string | null) {
  ai.setProjectContext(projectId);
  agent.setProject(projectId);
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

export function abortableDelay(delayMs: number, signal: AbortSignal): Promise<void> {
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
  let modelCatalogRequest = 0;

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
    const generation = ensureProjectContext(projectId);
    settingsError = null;
    try {
      const next = await api.updateProjectAiSettings(projectId, input);
      if (!isCurrentContext(projectId, generation)) return;
      settings = next;
      modelCatalog = null;
      await loadModelCatalog(projectId);
      return next;
    } catch (err) {
      if (!isCurrentContext(projectId, generation)) return;
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
    const request = ++modelCatalogRequest;
    modelCatalogLoading = true;
    modelCatalogError = null;
    try {
      const next = await api.listAiModels(projectId);
      if (!isCurrentContext(projectId, generation) || request !== modelCatalogRequest) return;
      modelCatalog = next;
    } catch (err) {
      if (!isCurrentContext(projectId, generation) || request !== modelCatalogRequest) return;
      modelCatalog = null;
      modelCatalogError = err instanceof Error ? err.message : 'Failed to load AI models';
    } finally {
      if (isCurrentContext(projectId, generation) && request === modelCatalogRequest) modelCatalogLoading = false;
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
    return api.uploadAsset(projectId, file, options);
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
    toolManifest = null;
    clearFeatureResults();
  }

  function setProjectContext(projectId: string | null): number {
    if (projectContextId === projectId) return contextGeneration;
    projectContextId = projectId;
    contextGeneration += 1;
    clearProjectState();
    return contextGeneration;
  }

  function reset() {
    projectContextId = null;
    contextGeneration += 1;
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

    setProjectContext,
    // agent attachments
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
