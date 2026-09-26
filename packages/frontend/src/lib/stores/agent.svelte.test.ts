import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  OpenTalesClient,
  type AiAgentSession,
  type AiAgentSessionSummary,
} from "@opentales/sdk";
import { createAgentStore } from "./agent.svelte";

const now = "2026-09-25T00:00:00.000Z";
const tokens = { input: 0, output: 0, reasoning: 0, cacheRead: 0, cacheWrite: 0 };

function summary(id: string, extra: Partial<AiAgentSessionSummary> = {}): AiAgentSessionSummary {
  return {
    id,
    projectId: "project-1",
    parentId: null,
    title: id,
    agent: "writer",
    model: null,
    approvalMode: "manual",
    status: "idle",
    outcome: null,
    cost: 0,
    tokens,
    createdAt: now,
    updatedAt: now,
    ...extra,
  };
}

function detail(id: string, extra: Partial<AiAgentSession> = {}): AiAgentSession {
  return {
    ...summary(id),
    messages: [],
    hasEarlierMessages: false,
    earlierCursor: null,
    permissions: [],
    questions: [],
    queue: [],
    error: null,
    ...extra,
  };
}

describe("agent store", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    localStorage.clear();
    vi.spyOn(OpenTalesClient.prototype, "getAiAgentCapabilities").mockResolvedValue({
      agents: [{ id: "writer", name: "writer", description: null, mode: "primary", color: null }],
      skills: [],
      tools: [],
      defaultAgent: "writer",
      model: "gpt-6-luna",
    });
    vi.spyOn(OpenTalesClient.prototype, "streamAiAgentEvents").mockImplementation(
      (_projectId, _onEvent, options) =>
        new Promise((_resolve, reject) =>
          options?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError"))),
        ),
    );
  });

  it("restores the remembered session and loads its transcript", async () => {
    localStorage.setItem("opentales.agent.activeSession.project-1", "ses_b");
    vi.spyOn(OpenTalesClient.prototype, "listAiAgentSessions").mockResolvedValue([summary("ses_a"), summary("ses_b")]);
    const get = vi.spyOn(OpenTalesClient.prototype, "getAiAgentSession").mockImplementation(async (_p, id) => detail(id));
    const store = createAgentStore();

    await store.initialize("project-1");

    expect(get).toHaveBeenCalledWith("project-1", "ses_b");
    expect(store.activeSessionId).toBe("ses_b");
    expect(store.viewedSession?.id).toBe("ses_b");
    store.stopStream();
  });

  it('preserves model, effort, and speed when creating the first session', async () => {
    vi.spyOn(OpenTalesClient.prototype, 'listAiAgentSessions').mockResolvedValue([]);
    const model = { providerId: 'opentales', modelId: 'gpt-6-luna', model: 'gpt-6-luna', reasoningEffort: 'high', serviceTier: 'fast' as const };
    const create = vi.spyOn(OpenTalesClient.prototype, 'createAiAgentSession').mockResolvedValue(detail('chosen', { model }));
    const store = createAgentStore();
    await store.initialize('project-1');
    await store.createSession({ model: 'gpt-6-luna', reasoningEffort: 'high', serviceTier: 'fast' });
    expect(create).toHaveBeenCalledWith('project-1', { model: 'gpt-6-luna', reasoningEffort: 'high', serviceTier: 'fast', approvalMode: 'manual' });
    expect(store.activeSession?.model).toEqual(model);
    store.stopStream();
  });

  it("streams text deltas and tool updates into the right assistant message", async () => {
    vi.spyOn(OpenTalesClient.prototype, "listAiAgentSessions").mockResolvedValue([summary("ses_a")]);
    vi.spyOn(OpenTalesClient.prototype, "getAiAgentSession").mockResolvedValue(detail("ses_a"));
    const store = createAgentStore();
    await store.initialize("project-1");

    store.applyEvent({ type: "status", sessionId: "ses_a", status: "running" });
    store.applyEvent({ type: "text.delta", sessionId: "ses_a", messageId: "msg_1", index: 0, delta: "Once " });
    store.applyEvent({ type: "text.delta", sessionId: "ses_a", messageId: "msg_1", index: 0, delta: "upon" });
    store.applyEvent({
      type: "tool.updated",
      sessionId: "ses_a",
      messageId: "msg_1",
      part: { type: "tool", id: "call_1", name: "readChapter", state: { status: "running", input: { chapterId: "c1" } }, childSessionId: null, startedAt: now, completedAt: null },
    });

    const message = store.viewedSession?.messages[0];
    expect(store.viewedSession?.status).toBe("running");
    expect(message?.role).toBe("assistant");
    if (message?.role !== "assistant") throw new Error("expected assistant");
    expect(message.parts[0]).toEqual({ type: "text", text: "Once upon" });
    expect(message.parts[1]).toMatchObject({ type: "tool", name: "readChapter" });
    store.stopStream();
  });

  it("surfaces subagent approvals on the root session and clears them after a decision", async () => {
    vi.spyOn(OpenTalesClient.prototype, "listAiAgentSessions").mockResolvedValue([summary("ses_root")]);
    vi.spyOn(OpenTalesClient.prototype, "getAiAgentSession").mockResolvedValue(detail("ses_root"));
    const reply = vi.spyOn(OpenTalesClient.prototype, "replyAiPermission").mockResolvedValue(undefined);
    const store = createAgentStore();
    await store.initialize("project-1");

    store.applyEvent({ type: "session.updated", session: summary("ses_child", { parentId: "ses_root" }) });
    const request = { id: "per_1", sessionId: "ses_child", toolName: "updateChapter", toolInput: { chapterId: "c1" }, toolCallId: "call_1", messageId: "msg_1", message: null };
    store.applyEvent({ type: "permission.asked", request });
    expect(store.activeSession?.permissions.map((p) => p.id)).toEqual(["per_1"]);

    await store.replyPermission(request, "once");
    expect(reply).toHaveBeenCalledWith("project-1", "ses_child", "per_1", { decision: "once", message: undefined });
    expect(store.activeSession?.permissions).toHaveLength(0);
    store.stopStream();
  });

  it("drops a stale project's responses after switching projects", async () => {
    let resolveList!: (value: AiAgentSessionSummary[]) => void;
    vi.spyOn(OpenTalesClient.prototype, "listAiAgentSessions").mockImplementation(async (projectId) =>
      projectId === "project-1" ? new Promise((resolve) => (resolveList = resolve)) : [summary("ses_x", { projectId: "project-2" })],
    );
    vi.spyOn(OpenTalesClient.prototype, "getAiAgentSession").mockImplementation(async (_p, id) => detail(id));
    const store = createAgentStore();

    const first = store.initialize("project-1");
    await store.initialize("project-2");
    resolveList([summary("ses_stale")]);
    await first;

    expect(store.projectId).toBe("project-2");
    expect(store.sessions.map((s) => s.id)).toEqual(["ses_x"]);
    store.stopStream();
  });
});
