import {
  ApiError,
  type AiAgentSession,
  type AiAgentSessionEvent,
  type AiCharacterDialogueSuggestion,
  type AiContinuityReview,
  type AiOutlineExpansion,
  type AiRewriteSuggestion,
  type AiToolDescriptor,
  type CreateAiCharacterDialogueInput,
  type CreateAiOutlineExpansionInput,
  type CreateAiRewriteSuggestionInput,
  type ProjectAiSettings,
  type UpdateProjectAiSettingsInput
} from '@opentales/sdk';
import { api } from '$lib/api';

function emptySession(projectId: string): AiAgentSession {
  return {
    projectId,
    status: 'idle',
    activePromptId: null,
    queue: [],
    messages: [],
    pendingToolCalls: [],
    updatedAt: new Date().toISOString()
  };
}

function createAiAgentStore() {
  let attachedProjectId = $state<string | null>(null);
  let session = $state<AiAgentSession | null>(null);
  let settings = $state<ProjectAiSettings | null>(null);
  let tools = $state<AiToolDescriptor[]>([]);
  let connecting = $state(false);
  let connected = $state(false);
  let error = $state<string | null>(null);
  let lastEventAt = $state<string | null>(null);
  let textBuffer = $state('');

  let abortController: AbortController | null = null;
  let panelOpen = $state(false);
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

  function applySession(next: AiAgentSession) {
    session = next;
    lastEventAt = next.updatedAt;
    // Reset live text buffer once a prompt is finished or never started.
    if (next.status !== 'running' && textBuffer) {
      textBuffer = '';
    }
  }

  function handleEvent(event: AiAgentSessionEvent) {
    applySession(event.session);
    if (event.type === 'text-delta') {
      const data = event.data as { text?: unknown } | undefined;
      if (data && typeof data.text === 'string') {
        textBuffer += data.text;
      }
    }
    if (event.type === 'prompt-started') {
      textBuffer = '';
    }
    if (event.type === 'prompt-finished' || event.type === 'error') {
      textBuffer = '';
    }
    if (event.type === 'error') {
      const data = event.data as { message?: unknown } | undefined;
      if (data && typeof data.message === 'string') error = data.message;
    }
  }

  async function attach(projectId: string) {
    if (attachedProjectId === projectId && (connected || connecting)) return;
    detach();
    attachedProjectId = projectId;
    error = null;
    connecting = true;

    // Hydrate session and settings before opening the stream so the panel
    // shows the persisted transcript even on slow networks.
    try {
      const [snapshot, projSettings] = await Promise.all([
        api.getAiAgentSession(projectId).catch((e) => {
          if (e instanceof ApiError && e.status === 400) return emptySession(projectId);
          throw e;
        }),
        api
          .getProjectAiSettings(projectId)
          .catch(() => null as ProjectAiSettings | null)
      ]);
      applySession(snapshot);
      settings = projSettings;
    } catch (caught) {
      error = caught instanceof Error ? caught.message : 'Failed to load AI session';
      session = emptySession(projectId);
    }

    void connect(projectId);
  }

  async function connect(projectId: string) {
    if (abortController) abortController.abort();
    abortController = new AbortController();
    connecting = true;
    try {
      await api.streamAiAgentSession(projectId, handleEvent, {
        signal: abortController.signal
      });
      connected = false;
    } catch (caught) {
      if ((caught as { name?: string } | null)?.name === 'AbortError') return;
      error = caught instanceof Error ? caught.message : 'AI stream disconnected';
      connected = false;
      // Best-effort reconnect after a short delay if still attached.
      if (attachedProjectId && attachedProjectId === projectId) {
        if (reconnectTimer) clearTimeout(reconnectTimer);
        reconnectTimer = setTimeout(() => {
          reconnectTimer = null;
          if (attachedProjectId === projectId) void connect(projectId);
        }, 2500);
      }
    } finally {
      connecting = false;
    }
  }

  function detach() {
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
    if (abortController) {
      abortController.abort();
      abortController = null;
    }
    attachedProjectId = null;
    session = null;
    settings = null;
    tools = [];
    connecting = false;
    connected = false;
    error = null;
    textBuffer = '';
  }

  async function refreshSettings(): Promise<ProjectAiSettings | null> {
    if (!attachedProjectId) return null;
    try {
      settings = await api.getProjectAiSettings(attachedProjectId);
      return settings;
    } catch (caught) {
      error = caught instanceof Error ? caught.message : 'Failed to load AI settings';
      return null;
    }
  }

  async function updateSettings(
    input: UpdateProjectAiSettingsInput
  ): Promise<ProjectAiSettings | null> {
    if (!attachedProjectId) return null;
    try {
      settings = await api.updateProjectAiSettings(attachedProjectId, input);
      return settings;
    } catch (caught) {
      error = caught instanceof Error ? caught.message : 'Failed to update AI settings';
      return null;
    }
  }

  async function loadTools() {
    if (!attachedProjectId) return;
    try {
      const manifest = await api.listAiTools(attachedProjectId);
      tools = manifest.tools;
    } catch {
      tools = [];
    }
  }

  function ensureEnabled(): boolean {
    if (!attachedProjectId) {
      error = 'No project loaded';
      return false;
    }
    if (settings && !settings.enabled) {
      error = 'Project AI is disabled. Enable it in Project Settings → AI.';
      return false;
    }
    return true;
  }

  async function queuePrompt(
    prompt: string,
    options: { interrupt?: boolean } = {}
  ): Promise<AiAgentSession | null> {
    if (!attachedProjectId) return null;
    if (!ensureEnabled()) return null;
    const trimmed = prompt.trim();
    if (!trimmed) return null;
    try {
      const next = await api.queueAiAgentPrompt(attachedProjectId, {
        prompt: trimmed,
        interrupt: options.interrupt
      });
      applySession(next);
      return next;
    } catch (caught) {
      error = caught instanceof Error ? caught.message : 'Failed to queue prompt';
      return null;
    }
  }

  async function cancel(): Promise<void> {
    if (!attachedProjectId) return;
    try {
      const next = await api.cancelAiAgentSession(attachedProjectId);
      applySession(next);
    } catch (caught) {
      error = caught instanceof Error ? caught.message : 'Failed to cancel session';
    }
  }

  async function approveToolCall(toolCallId: string, approved: boolean): Promise<void> {
    if (!attachedProjectId) return;
    try {
      const next = await api.approveAiToolCall(attachedProjectId, toolCallId, { approved });
      applySession(next);
    } catch (caught) {
      error =
        caught instanceof Error
          ? caught.message
          : `Failed to ${approved ? 'approve' : 'reject'} tool call`;
    }
  }

  async function runRewrite(
    input: CreateAiRewriteSuggestionInput
  ): Promise<AiRewriteSuggestion | null> {
    if (!attachedProjectId) return null;
    if (!ensureEnabled()) return null;
    try {
      return await api.createRewriteSuggestion(attachedProjectId, input);
    } catch (caught) {
      error = caught instanceof Error ? caught.message : 'Rewrite failed';
      return null;
    }
  }

  async function runDialogue(
    input: CreateAiCharacterDialogueInput
  ): Promise<AiCharacterDialogueSuggestion | null> {
    if (!attachedProjectId) return null;
    if (!ensureEnabled()) return null;
    try {
      return await api.createCharacterDialogueSuggestion(attachedProjectId, input);
    } catch (caught) {
      error = caught instanceof Error ? caught.message : 'Dialogue generation failed';
      return null;
    }
  }

  async function runOutlineExpansion(
    input: CreateAiOutlineExpansionInput
  ): Promise<AiOutlineExpansion | null> {
    if (!attachedProjectId) return null;
    if (!ensureEnabled()) return null;
    try {
      return await api.createOutlineExpansion(attachedProjectId, input);
    } catch (caught) {
      error = caught instanceof Error ? caught.message : 'Outline expansion failed';
      return null;
    }
  }

  async function runContinuityReview(submissionId: string): Promise<AiContinuityReview | null> {
    if (!attachedProjectId) return null;
    if (!ensureEnabled()) return null;
    try {
      return await api.runContinuityReview(attachedProjectId, submissionId);
    } catch (caught) {
      error = caught instanceof Error ? caught.message : 'Continuity review failed';
      return null;
    }
  }

  function clearError() {
    error = null;
  }

  function openPanel() {
    panelOpen = true;
  }

  function closePanel() {
    panelOpen = false;
  }

  function togglePanel() {
    panelOpen = !panelOpen;
  }

  return {
    get attachedProjectId() {
      return attachedProjectId;
    },
    get session() {
      return session;
    },
    get settings() {
      return settings;
    },
    get tools() {
      return tools;
    },
    get connecting() {
      return connecting;
    },
    get connected() {
      return connected;
    },
    get error() {
      return error;
    },
    get lastEventAt() {
      return lastEventAt;
    },
    get textBuffer() {
      return textBuffer;
    },
    get panelOpen() {
      return panelOpen;
    },
    get enabled() {
      return Boolean(settings?.enabled);
    },
    attach,
    detach,
    refreshSettings,
    updateSettings,
    loadTools,
    queuePrompt,
    cancel,
    approveToolCall,
    runRewrite,
    runDialogue,
    runOutlineExpansion,
    runContinuityReview,
    clearError,
    openPanel,
    closePanel,
    togglePanel
  };
}

export type AiAgentStore = ReturnType<typeof createAiAgentStore>;
export const aiAgent: AiAgentStore = createAiAgentStore();
