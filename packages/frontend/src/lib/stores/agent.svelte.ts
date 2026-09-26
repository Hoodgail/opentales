import type {
  CreateAiAgentSessionInput,
  UpdateAiAgentSessionInput,
  AiAgentCapabilities,
  AiAgentMessage,
  AiAgentPart,
  AiAgentPermissionRequest,
  AiAgentQuestion,
  AiAgentSession,
  AiAgentSessionStatus,
  AiAgentSessionSummary,
  AiAgentStreamEvent,
  AnswerAiQuestionInput,
  SendAiAgentPromptInput
} from '@opentales/sdk';
import { abortableDelay, api, reconnectDelayMs } from './ai.svelte';

type StreamStatus = 'disconnected' | 'connecting' | 'connected' | 'reconnecting';
type AssistantMessage = Extract<AiAgentMessage, { role: 'assistant' }>;
type ToolPart = Extract<AiAgentPart, { type: 'tool' }>;

const MAX_RECONNECT_ATTEMPTS = 6;

function storageKey(projectId: string) {
  return `opentales.agent.activeSession.${projectId}`;
}

function errorMessage(error: unknown, fallback: string) {
  return error instanceof Error && error.message ? error.message : fallback;
}

/**
 * Client state for the OpenCode agent harness.
 *
 * One SSE stream per project carries activity for every session the author
 * owns, including subagent child sessions, so the panel can render delegated
 * work live without extra connections. Per-session transcripts are cached and
 * patched incrementally from stream events.
 */
export function createAgentStore() {
  let projectId = $state<string | null>(null);
  let generation = 0;

  let capabilities = $state<AiAgentCapabilities | null>(null);
  let sessions = $state<AiAgentSessionSummary[]>([]);
  /** Transcripts, permissions, and questions keyed by session id (roots and children). */
  let details = $state<Record<string, AiAgentSession>>({});
  let activeSessionId = $state<string | null>(null);
  /** Stack of child sessions the author has drilled into from the active root. */
  let viewStack = $state<string[]>([]);

  let loading = $state(false);
  let error = $state<string | null>(null);
  let streamStatus = $state<StreamStatus>('disconnected');
  let reconnectAttempt = $state(0);
  let sending = $state(false);
  let pendingActions = $state<Record<string, 'approving' | 'rejecting' | 'answering' | 'dismissing'>>({});
  let actionErrors = $state<Record<string, string>>({});
  let retryInfo = $state<Record<string, { attempt: number; message: string } | null>>({});
  let streamAbort: AbortController | null = null;

  const current = (pid: string, gen: number) => projectId === pid && generation === gen;

  function setProject(next: string | null) {
    if (next === projectId) return;
    stopStream();
    generation += 1;
    projectId = next;
    capabilities = null;
    sessions = [];
    details = {};
    activeSessionId = null;
    viewStack = [];
    error = null;
    pendingActions = {};
    actionErrors = {};
    retryInfo = {};
    loading = false;
  }

  // ── Loading ────────────────────────────────────────────────────────────

  async function initialize(pid: string) {
    setProject(pid);
    const gen = generation;
    loading = true;
    error = null;
    try {
      const [caps, list] = await Promise.all([
        api.getAiAgentCapabilities(pid).catch(() => null),
        api.listAiAgentSessions(pid)
      ]);
      if (!current(pid, gen)) return;
      capabilities = caps;
      sessions = list;
      const remembered = localStorage.getItem(storageKey(pid));
      const target = list.find((s) => s.id === remembered)?.id ?? list[0]?.id ?? null;
      if (target) await openSession(target);
      void startStream(pid, gen);
    } catch (err) {
      if (current(pid, gen)) error = errorMessage(err, 'Failed to load the agent');
    } finally {
      if (current(pid, gen)) loading = false;
    }
  }

  async function refreshCapabilities() {
    const pid = projectId;
    if (!pid) return;
    const gen = generation;
    const caps = await api.getAiAgentCapabilities(pid).catch(() => null);
    if (caps && current(pid, gen)) capabilities = caps;
  }

  async function loadDetail(sessionId: string): Promise<AiAgentSession | null> {
    const pid = projectId;
    if (!pid) return null;
    const gen = generation;
    try {
      const detail = await api.getAiAgentSession(pid, sessionId);
      if (!current(pid, gen)) return null;
      mergeDetail(detail);
      return details[sessionId];
    } catch (err) {
      if (current(pid, gen)) error = errorMessage(err, 'Failed to load session');
      return null;
    }
  }

  async function openSession(sessionId: string) {
    const pid = projectId;
    if (!pid) return;
    activeSessionId = sessionId;
    viewStack = [];
    localStorage.setItem(storageKey(pid), sessionId);
    await loadDetail(sessionId);
  }

  /** Drill into a subagent's child session (stacked over the root view). */
  async function openChild(sessionId: string) {
    if (!details[sessionId]) await loadDetail(sessionId);
    viewStack = [...viewStack, sessionId];
  }

  function closeChild() {
    viewStack = viewStack.slice(0, -1);
  }

  async function loadEarlier(sessionId: string) {
    const pid = projectId;
    const detail = details[sessionId];
    if (!pid || !detail?.earlierCursor) return;
    const page = await api.getAiAgentMessages(pid, sessionId, { cursor: detail.earlierCursor, limit: 60 });
    const existing = new Set(detail.messages.map((m) => m.id));
    detail.messages = [...page.messages.filter((m) => !existing.has(m.id)), ...detail.messages];
    detail.earlierCursor = page.cursor;
    detail.hasEarlierMessages = page.hasMore;
  }

  // ── Session lifecycle ──────────────────────────────────────────────────

  async function createSession(input: CreateAiAgentSessionInput = {}) {
    const pid = projectId;
    if (!pid) return null;
    error = null;
    try {
      const created = await api.createAiAgentSession(pid, {
        ...input,
        approvalMode: input.approvalMode ?? activeRoot()?.approvalMode ?? 'manual',
      });
      details[created.id] = created;
      upsertSummary(created);
      activeSessionId = created.id;
      viewStack = [];
      localStorage.setItem(storageKey(pid), created.id);
      return created;
    } catch (err) {
      error = errorMessage(err, 'Failed to create session');
      return null;
    }
  }

  async function deleteSession(sessionId: string) {
    const pid = projectId;
    if (!pid) return;
    try {
      await api.deleteAiAgentSession(pid, sessionId);
      sessions = sessions.filter((s) => s.id !== sessionId);
      delete details[sessionId];
      if (activeSessionId === sessionId) {
        const next = sessions.find((s) => !s.parentId);
        activeSessionId = null;
        if (next) await openSession(next.id);
      }
    } catch (err) {
      error = errorMessage(err, 'Failed to delete session');
    }
  }

  async function updateSession(sessionId: string, input: UpdateAiAgentSessionInput) {
    const pid = projectId;
    if (!pid) return false;
    error = null;
    try {
      const next = await api.updateAiAgentSession(pid, sessionId, input);
      details[sessionId] = next;
      upsertSummary(next);
      if (input.model) void refreshCapabilities();
      return true;
    } catch (err) {
      error = errorMessage(err, 'Failed to update session');
      return false;
    }
  }

  async function send(input: SendAiAgentPromptInput) {
    const pid = projectId;
    if (!pid || sending) return false;
    sending = true;
    error = null;
    try {
      let sessionId = activeSessionId;
      if (!sessionId) sessionId = (await createSession({ agent: input.agent }))?.id ?? null;
      if (!sessionId) return false;
      setStatus(sessionId, 'running');
      const next = await api.sendAiAgentPrompt(pid, sessionId, input);
      mergeDetail(next);
      if (input.model) void refreshCapabilities();
      return true;
    } catch (err) {
      error = errorMessage(err, 'Failed to send prompt');
      if (activeSessionId) setStatus(activeSessionId, 'idle');
      return false;
    } finally {
      sending = false;
    }
  }

  async function interrupt(sessionId = activeSessionId) {
    const pid = projectId;
    if (!pid || !sessionId) return;
    try {
      const next = await api.interruptAiAgentSession(pid, sessionId);
      mergeDetail(next);
    } catch (err) {
      error = errorMessage(err, 'Failed to stop the agent');
    }
  }

  async function replyPermission(request: AiAgentPermissionRequest, decision: 'once' | 'always' | 'reject', message?: string) {
    const pid = projectId;
    if (!pid) return false;
    pendingActions[request.id] = decision === 'reject' ? 'rejecting' : 'approving';
    delete actionErrors[request.id];
    try {
      await api.replyAiPermission(pid, request.sessionId, request.id, { decision, message });
      removePermission(request.sessionId, request.id);
      return true;
    } catch (err) {
      actionErrors[request.id] = errorMessage(err, 'Failed to send decision');
      return false;
    } finally {
      delete pendingActions[request.id];
    }
  }

  async function answerQuestion(question: AiAgentQuestion, answers: AnswerAiQuestionInput['answers']) {
    const pid = projectId;
    if (!pid) return false;
    pendingActions[question.id] = 'answering';
    delete actionErrors[question.id];
    try {
      await api.answerAiQuestion(pid, question.sessionId, question.id, { answers });
      removeQuestion(question.sessionId, question.id);
      return true;
    } catch (err) {
      actionErrors[question.id] = errorMessage(err, 'Failed to send answer');
      return false;
    } finally {
      delete pendingActions[question.id];
    }
  }

  async function dismissQuestion(question: AiAgentQuestion) {
    const pid = projectId;
    if (!pid) return;
    pendingActions[question.id] = 'dismissing';
    try {
      await api.dismissAiQuestion(pid, question.sessionId, question.id);
      removeQuestion(question.sessionId, question.id);
    } catch (err) {
      actionErrors[question.id] = errorMessage(err, 'Failed to dismiss');
    } finally {
      delete pendingActions[question.id];
    }
  }

  // ── Streaming ──────────────────────────────────────────────────────────

  async function startStream(pid: string, gen: number) {
    stopStream();
    const controller = new AbortController();
    streamAbort = controller;
    let attempt = 0;
    while (!controller.signal.aborted && current(pid, gen)) {
      streamStatus = attempt === 0 ? 'connecting' : 'reconnecting';
      reconnectAttempt = attempt;
      try {
        await api.streamAiAgentEvents(pid, (event) => {
          if (!current(pid, gen)) return;
          if (streamStatus !== 'connected') {
            streamStatus = 'connected';
            attempt = 0;
            reconnectAttempt = 0;
          }
          applyEvent(event);
        }, { signal: controller.signal });
      } catch (err) {
        if (controller.signal.aborted || !current(pid, gen)) return;
        if (attempt >= MAX_RECONNECT_ATTEMPTS) {
          streamStatus = 'disconnected';
          error = errorMessage(err, 'Lost connection to the agent');
          return;
        }
      }
      if (controller.signal.aborted || !current(pid, gen)) return;
      attempt += 1;
      try {
        await abortableDelay(reconnectDelayMs(attempt), controller.signal);
      } catch {
        return;
      }
      // Resync state that may have changed while disconnected.
      if (activeSessionId) void loadDetail(activeSessionId);
    }
  }

  function stopStream() {
    streamAbort?.abort();
    streamAbort = null;
    streamStatus = 'disconnected';
  }

  function retryStream() {
    const pid = projectId;
    if (!pid) return;
    error = null;
    void startStream(pid, generation);
  }

  function applyEvent(event: AiAgentStreamEvent) {
    switch (event.type) {
      case 'connected':
        for (const summary of event.sessions) upsertSummary(summary);
        return;
      case 'session.updated':
        upsertSummary(event.session);
        if (details[event.session.id]) Object.assign(details[event.session.id], event.session);
        return;
      case 'session.deleted':
        sessions = sessions.filter((s) => s.id !== event.sessionId);
        delete details[event.sessionId];
        return;
      case 'message.updated':
        upsertMessage(event.sessionId, event.message);
        return;
      case 'text.delta':
      case 'reasoning.delta':
        appendDelta(event.sessionId, event.messageId, event.type === 'text.delta' ? 'text' : 'reasoning', event.index, event.delta);
        return;
      case 'tool.updated':
        upsertTool(event.sessionId, event.messageId, event.part);
        if (event.part.childSessionId && !details[event.part.childSessionId]) void loadDetail(event.part.childSessionId);
        return;
      case 'permission.asked': {
        const detail = details[event.request.sessionId] ?? rootDetailFor(event.request.sessionId);
        if (detail && !detail.permissions.some((p) => p.id === event.request.id)) detail.permissions.push(event.request);
        const root = rootDetailFor(event.request.sessionId);
        if (root && root !== detail && !root.permissions.some((p) => p.id === event.request.id)) root.permissions.push(event.request);
        return;
      }
      case 'permission.replied':
        removePermission(event.sessionId, event.requestId);
        return;
      case 'question.asked': {
        for (const detail of [details[event.question.sessionId], rootDetailFor(event.question.sessionId)]) {
          if (detail && !detail.questions.some((q) => q.id === event.question.id)) detail.questions.push(event.question);
        }
        return;
      }
      case 'question.closed':
        removeQuestion(event.sessionId, event.questionId);
        return;
      case 'status':
        setStatus(event.sessionId, event.status, event.error ?? null);
        retryInfo[event.sessionId] = event.status === 'retrying' ? event.retry ?? null : null;
        return;
      case 'usage': {
        const summary = sessions.find((s) => s.id === event.sessionId);
        if (summary) { summary.cost = event.cost; summary.tokens = event.tokens; }
        const detail = details[event.sessionId];
        if (detail) { detail.cost = event.cost; detail.tokens = event.tokens; }
        return;
      }
      default:
        return;
    }
  }

  // ── Mutation helpers ───────────────────────────────────────────────────

  function upsertSummary(next: AiAgentSessionSummary) {
    const summary: AiAgentSessionSummary = {
      id: next.id,
      projectId: next.projectId,
      parentId: next.parentId,
      title: next.title,
      agent: next.agent,
      model: next.model,
      approvalMode: next.approvalMode,
      status: next.status,
      outcome: next.outcome,
      cost: next.cost,
      tokens: next.tokens,
      createdAt: next.createdAt,
      updatedAt: next.updatedAt
    };
    const index = sessions.findIndex((s) => s.id === next.id);
    if (index >= 0) sessions[index] = { ...sessions[index], ...summary };
    else sessions = [summary, ...sessions];
  }

  /**
   * Snapshots can race the live stream (a prompt's response may arrive after
   * its own events), so keep any newer messages the stream already delivered.
   */
  function mergeDetail(next: AiAgentSession) {
    const existing = details[next.id];
    if (!existing) {
      details[next.id] = next;
      upsertSummary(next);
      return;
    }
    const known = new Set(next.messages.map((m) => m.id));
    const knownUserText = new Set(next.messages.filter((m) => m.role === 'user').map((m) => (m as { text: string }).text));
    const newest = next.messages.at(-1)?.createdAt ?? '';
    const extras = existing.messages.filter(
      (m) =>
        !known.has(m.id) &&
        m.createdAt >= newest &&
        !(m.role === 'user' && knownUserText.has(m.text))
    );
    details[next.id] = {
      ...next,
      messages: [...next.messages, ...extras],
      status: existing.status === 'running' && next.status === 'idle' ? 'running' : next.status
    };
    upsertSummary(details[next.id]);
  }

  function setStatus(sessionId: string, status: AiAgentSessionStatus, message: string | null = null) {
    const summary = sessions.find((s) => s.id === sessionId);
    if (summary) summary.status = status;
    const detail = details[sessionId];
    if (detail) {
      detail.status = status;
      detail.error = status === 'error' ? message : null;
      if (status !== 'running' && status !== 'retrying') {
        for (const message of detail.messages) {
          if (message.role !== 'assistant') continue;
          for (const part of message.parts) {
            if (part.type === 'tool' && (part.state.status === 'running' || part.state.status === 'streaming')) {
              // A finished run cannot have live tools; the next snapshot will reconcile.
              void loadDetail(sessionId);
              return;
            }
          }
        }
      }
    }
  }

  function upsertMessage(sessionId: string, message: AiAgentMessage) {
    const detail = details[sessionId];
    if (!detail) return;
    const index = detail.messages.findIndex((m) => m.id === message.id);
    if (index >= 0) detail.messages[index] = message;
    else if (message.role === 'user') {
      // The inbox echo and the persisted user message carry different ids;
      // collapse them by text among the most recent turns.
      const recent = detail.messages.slice(-4);
      const duplicate = recent.find((m) => m.role === 'user' && m.text === message.text);
      if (!duplicate) detail.messages.push(message);
    } else detail.messages.push(message);
  }

  function ensureAssistant(sessionId: string, messageId: string): AssistantMessage | null {
    const detail = details[sessionId];
    if (!detail) return null;
    let message = detail.messages.find((m) => m.id === messageId);
    if (!message) {
      message = {
        id: messageId,
        role: 'assistant',
        agent: detail.agent ?? '',
        model: detail.model,
        parts: [],
        finish: null,
        error: null,
        cost: 0,
        tokens: null,
        createdAt: new Date().toISOString(),
        completedAt: null
      };
      detail.messages.push(message);
      message = detail.messages[detail.messages.length - 1];
    }
    return message.role === 'assistant' ? (message as AssistantMessage) : null;
  }

  /** Deltas carry the ordinal of the text/reasoning block within the message. */
  function appendDelta(sessionId: string, messageId: string, kind: 'text' | 'reasoning', index: number, delta: string) {
    const message = ensureAssistant(sessionId, messageId);
    if (!message) return;
    const blocks = message.parts.filter((part) => part.type === kind);
    const target = blocks[index];
    if (target && (target.type === 'text' || target.type === 'reasoning')) target.text += delta;
    else message.parts.push({ type: kind, text: delta });
  }

  function upsertTool(sessionId: string, messageId: string, part: ToolPart) {
    const message = ensureAssistant(sessionId, messageId);
    if (!message) return;
    const index = message.parts.findIndex((p) => p.type === 'tool' && p.id === part.id);
    if (index >= 0) message.parts[index] = part;
    else message.parts.push(part);
  }

  function removePermission(sessionId: string, requestId: string) {
    for (const detail of [details[sessionId], rootDetailFor(sessionId)]) {
      if (detail) detail.permissions = detail.permissions.filter((p) => p.id !== requestId);
    }
  }

  function removeQuestion(sessionId: string, questionId: string) {
    for (const detail of [details[sessionId], rootDetailFor(sessionId)]) {
      if (detail) detail.questions = detail.questions.filter((q) => q.id !== questionId);
    }
  }

  function rootIdFor(sessionId: string): string {
    let id = sessionId;
    for (let depth = 0; depth < 8; depth += 1) {
      const parent = sessions.find((s) => s.id === id)?.parentId ?? details[id]?.parentId ?? null;
      if (!parent) return id;
      id = parent;
    }
    return id;
  }

  function rootDetailFor(sessionId: string): AiAgentSession | undefined {
    return details[rootIdFor(sessionId)];
  }

  function activeRoot(): AiAgentSession | null {
    return activeSessionId ? details[activeSessionId] ?? null : null;
  }

  return {
    get projectId() { return projectId; },
    get capabilities() { return capabilities; },
    get sessions() { return sessions; },
    get rootSessions() { return sessions.filter((s) => !s.parentId); },
    get activeSessionId() { return activeSessionId; },
    /** Session currently displayed (drilled-in child or the active root). */
    get viewedSession(): AiAgentSession | null {
      const id = viewStack[viewStack.length - 1] ?? activeSessionId;
      return id ? details[id] ?? null : null;
    },
    get activeSession() { return activeRoot(); },
    get viewStack() { return viewStack; },
    get loading() { return loading; },
    get error() { return error; },
    get streamStatus() { return streamStatus; },
    get reconnectAttempt() { return reconnectAttempt; },
    get sending() { return sending; },
    get pendingActions() { return pendingActions; },
    get actionErrors() { return actionErrors; },
    retryFor(sessionId: string) { return retryInfo[sessionId] ?? null; },
    session(sessionId: string) { return details[sessionId] ?? null; },
    childSessions(parentId: string) { return sessions.filter((s) => s.parentId === parentId); },
    clearError() { error = null; },
    setProject,
    initialize,
    refreshCapabilities,
    openSession,
    openChild,
    closeChild,
    loadEarlier,
    createSession,
    deleteSession,
    updateSession,
    send,
    interrupt,
    replyPermission,
    answerQuestion,
    dismissQuestion,
    retryStream,
    stopStream,
    applyEvent
  };
}

export type AgentStore = ReturnType<typeof createAgentStore>;
export const agent: AgentStore = createAgentStore();

export function resetAgentStore() {
  agent.setProject(null);
}
