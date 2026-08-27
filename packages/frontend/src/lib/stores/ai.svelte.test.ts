import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  OpenTalesClient,
  type AiAgentSession,
  type AiAgentSessionEvent,
  type AiAgentSessionPart,
  type AiAgentSessionSummary,
} from "@opentales/sdk";
import { createAiStore, reconnectDelayMs } from "./ai.svelte";

const now = "2026-08-25T00:00:00.000Z";

function agentSession(
  id: string,
  projectId: string,
  timeline: AiAgentSessionPart[] = [],
): AiAgentSession {
  return {
    id,
    projectId,
    title: id,
    status: "idle",
    activePromptId: null,
    activeBuildRunId: null,
    queue: [],
    messages: [],
    toolCalls: [],
    timeline,
    timelineInfo: {
      mode: "exact",
      truncated: false,
      earliestSequence: timeline[0]?.sequence ?? null,
      hasMoreBefore: false,
    },
    pendingToolCalls: [],
    contextUsage: null,
    error: null,
    updatedAt: now,
  };
}

function summary(id: string, projectId: string): AiAgentSessionSummary {
  return {
    id,
    projectId,
    title: id,
    status: "idle",
    messageCount: 0,
    createdAt: now,
    updatedAt: now,
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((nextResolve, nextReject) => {
    resolve = nextResolve;
    reject = nextReject;
  });
  return { promise, resolve, reject };
}

describe("AI session store lifecycle", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    localStorage.clear();
  });

  it("drops stale project responses and clears the previous transcript immediately", async () => {
    const projectA = deferred<AiAgentSessionSummary[]>();
    vi.spyOn(OpenTalesClient.prototype, "listAiAgentSessions").mockImplementation(
      async (projectId) => {
        if (projectId === "project-a") return projectA.promise;
        return [summary("session-b", "project-b")];
      },
    );
    vi.spyOn(OpenTalesClient.prototype, "getAiAgentSession").mockResolvedValue(
      agentSession("session-a", "project-a"),
    );
    const store = createAiStore();
    store.setProjectContext("project-a");
    await store.loadSession("project-a", "session-a");
    expect(store.session?.id).toBe("session-a");

    const staleLoad = store.loadSessions("project-a");
    store.setProjectContext("project-b");
    expect(store.session).toBeNull();
    await store.loadSessions("project-b");
    projectA.resolve([summary("stale-session", "project-a")]);
    await staleLoad;

    expect(store.sessions.map((item) => item.id)).toEqual(["session-b"]);
    expect(store.activeSessionId).toBe("session-b");
  });

  it("restores the active session independently for each project", async () => {
    localStorage.setItem("opentales.ai.activeSession.project-a", "session-a-2");
    vi.spyOn(OpenTalesClient.prototype, "listAiAgentSessions").mockResolvedValue([
      summary("session-a-1", "project-a"),
      summary("session-a-2", "project-a"),
    ]);
    const store = createAiStore();

    expect(await store.loadSessions("project-a")).toBe("session-a-2");
    expect(store.activeSessionId).toBe("session-a-2");
  });

  it("persists a session execution mode and applies the returned snapshot", async () => {
    const manual = { ...agentSession("session-1", "project-1"), approvalMode: "manual" as const };
    const auto = { ...manual, approvalMode: "auto" as const };
    vi.spyOn(OpenTalesClient.prototype, "getAiAgentSession").mockResolvedValue(manual);
    const update = vi
      .spyOn(OpenTalesClient.prototype, "updateAiAgentSession")
      .mockResolvedValue(auto);
    const store = createAiStore();
    await store.loadSession("project-1", "session-1");

    expect(await store.updateSessionApprovalMode("project-1", "auto")).toBe(true);
    expect(update).toHaveBeenCalledWith("project-1", "session-1", {
      approvalMode: "auto",
    });
    expect(store.session?.approvalMode).toBe("auto");
  });

  it("never lets a delayed default session overwrite a newer session in the same project", async () => {
    const general = deferred<AiAgentSession>();
    vi.spyOn(OpenTalesClient.prototype, "getAiAgentSession").mockReturnValueOnce(
      general.promise,
    );
    vi.spyOn(OpenTalesClient.prototype, "createAiAgentSession").mockResolvedValue(
      agentSession("new-chat", "project-1"),
    );
    vi.spyOn(OpenTalesClient.prototype, "streamAiAgentSession").mockImplementation(
      async (_projectId, _sessionId, _onEvent, options) =>
        new Promise<void>((resolve) =>
          options?.signal?.addEventListener("abort", () => resolve(), {
            once: true,
          }),
        ),
    );
    const store = createAiStore();

    const delayed = store.loadSession("project-1");
    await store.createSession("project-1", "New chat");
    general.resolve(agentSession("general", "project-1"));
    expect(await delayed).toBeNull();
    expect(store.session?.id).toBe("new-chat");
    store.stopStream();
  });

  it("prepends and deduplicates earlier activity while combining fidelity notices", async () => {
    const latest = agentSession("session-1", "project-1", [
      {
        id: "part-3",
        sequence: 3,
        kind: "text",
        promptId: "prompt-1",
        messageId: "message-1",
        content: "Latest",
        streaming: false,
        createdAt: now,
        updatedAt: now,
      },
    ]);
    latest.timelineInfo = {
      mode: "exact",
      truncated: true,
      earliestSequence: 3,
      hasMoreBefore: true,
    };
    vi.spyOn(OpenTalesClient.prototype, "getAiAgentSession").mockResolvedValue(
      latest,
    );
    vi.spyOn(OpenTalesClient.prototype, "getAiAgentTimeline").mockResolvedValue({
      parts: [
        {
          id: "part-1",
          sequence: 1,
          kind: "text",
          promptId: "legacy",
          messageId: "legacy-message",
          content: "Earlier",
          streaming: false,
          createdAt: now,
          updatedAt: now,
        },
        latest.timeline![0]!,
      ],
      timelineInfo: {
        mode: "approximate",
        truncated: false,
        earliestSequence: 1,
        hasMoreBefore: false,
      },
      nextBeforeSequence: null,
      hasMore: false,
      limitation: "legacy-history-best-effort",
    });
    const store = createAiStore();
    await store.loadSession("project-1", "session-1");

    expect(await store.loadEarlierTimeline("project-1", "session-1")).toBe(
      true,
    );
    expect(store.session?.timeline?.map((part) => part.id)).toEqual([
      "part-1",
      "part-3",
    ]);
    expect(store.session?.timelineInfo).toMatchObject({
      mode: "mixed",
      hasMoreBefore: false,
      earliestSequence: 1,
    });
    expect(store.canLoadEarlierTimeline).toBe(false);
  });

  it("switches from durable sequence paging to opaque legacy cursors without stalling", async () => {
    const latest = agentSession("session-1", "project-1", [
      {
        id: "durable-latest",
        sequence: 300,
        kind: "text",
        promptId: "prompt-3",
        messageId: "message-3",
        content: "Latest",
        streaming: false,
        createdAt: now,
        updatedAt: now,
      },
    ]);
    latest.timelineInfo = {
      mode: "mixed",
      truncated: true,
      earliestSequence: 300,
      hasMoreBefore: true,
      legacyCursor: "snapshot-legacy-cursor",
    };
    vi.spyOn(OpenTalesClient.prototype, "getAiAgentSession").mockResolvedValue(
      latest,
    );
    const inputs: Array<Record<string, unknown>> = [];
    vi.spyOn(OpenTalesClient.prototype, "getAiAgentTimeline").mockImplementation(
      async (_projectId, input) => {
        inputs.push(input as Record<string, unknown>);
        const page = inputs.length;
        const legacyPart = {
          id: `legacy-page-${page}`,
          sequence: 300 - page,
          kind: "text" as const,
          promptId: `legacy-${page}`,
          messageId: `legacy-message-${page}`,
          content: `Legacy page ${page}`,
          streaming: false,
          createdAt: now,
          updatedAt: now,
        };
        return {
          // The second includes a duplicate of the durable edge to prove
          // cross-mode deduping.
          parts:
            page === 2
              ? [legacyPart, latest.timeline![0]!]
              : [legacyPart],
          timelineInfo: {
            mode: "approximate" as const,
            truncated: page < 3,
            earliestSequence: 300 - page,
            hasMoreBefore: page < 3,
            legacyCursor: page < 3 ? `legacy-cursor-${page}` : null,
          },
          nextBeforeSequence: 300 - page,
          nextLegacyCursor: page < 3 ? `legacy-cursor-${page}` : null,
          hasMore: page < 3,
          limitation: "legacy-history-best-effort" as const,
        };
      },
    );
    const store = createAiStore();
    await store.loadSession("project-1", "session-1");

    expect(await store.loadEarlierTimeline("project-1", "session-1")).toBe(true);
    expect(await store.loadEarlierTimeline("project-1", "session-1")).toBe(true);
    expect(await store.loadEarlierTimeline("project-1", "session-1")).toBe(true);
    expect(await store.loadEarlierTimeline("project-1", "session-1")).toBe(false);

    expect(inputs).toEqual([
      {
        legacyCursor: "snapshot-legacy-cursor",
        beforeSequence: 300,
        limit: 200,
      },
      { legacyCursor: "legacy-cursor-1", beforeSequence: 299, limit: 200 },
      { legacyCursor: "legacy-cursor-2", beforeSequence: 298, limit: 200 },
    ]);
    expect(store.session?.timeline?.map((part) => part.id)).toEqual([
      "legacy-page-3",
      "legacy-page-2",
      "legacy-page-1",
      "durable-latest",
    ]);
    expect(store.canLoadEarlierTimeline).toBe(false);
    expect(store.session?.timelineInfo?.mode).toBe("mixed");
  });

  it("reconnects with backoff, rehydrates a snapshot, and applies incremental parts", async () => {
    vi.useFakeTimers();
    vi.spyOn(Math, "random").mockReturnValue(0);
    const hydratedPart: AiAgentSessionPart = {
      id: "text-1",
      sequence: 1,
      kind: "text",
      promptId: "prompt-1",
      messageId: "message-1",
      content: "Persisted",
      streaming: true,
      createdAt: now,
      updatedAt: now,
    };
    const livePart: AiAgentSessionPart = {
      ...hydratedPart,
      content: "Persisted and live",
      updatedAt: "2026-08-25T00:00:01.000Z",
    };
    const getSession = vi
      .spyOn(OpenTalesClient.prototype, "getAiAgentSession")
      .mockResolvedValue(agentSession("session-1", "project-1", [hydratedPart]));
    const stream = vi
      .spyOn(OpenTalesClient.prototype, "streamAiAgentSession")
      .mockRejectedValueOnce(new Error("connection dropped"))
      .mockImplementationOnce(async (_projectId, _sessionId, onEvent, options) => {
        onEvent({ type: "text-delta", data: { part: livePart } } as AiAgentSessionEvent);
        await new Promise<void>((resolve) =>
          options?.signal?.addEventListener("abort", () => resolve(), { once: true }),
        );
      });
    const store = createAiStore();
    store.setProjectContext("project-1");
    await store.loadSession("project-1", "session-1");

    const running = store.startStream("project-1", "session-1");
    await vi.advanceTimersByTimeAsync(reconnectDelayMs(0, () => 0));
    await vi.waitFor(() => expect(stream).toHaveBeenCalledTimes(2));

    expect(getSession).toHaveBeenCalledTimes(2);
    expect(store.streamStatus).toBe("connected");
    expect(store.session?.timeline?.[0]).toMatchObject({
      id: "text-1",
      content: "Persisted and live",
    });
    store.stopStream();
    await running;
    vi.useRealTimers();
  });

  it("exposes an explicit retry after bounded reconnect attempts", async () => {
    vi.useFakeTimers();
    vi.spyOn(Math, "random").mockReturnValue(0);
    vi.spyOn(OpenTalesClient.prototype, "getAiAgentSession").mockResolvedValue(
      agentSession("session-1", "project-1"),
    );
    let calls = 0;
    const stream = vi
      .spyOn(OpenTalesClient.prototype, "streamAiAgentSession")
      .mockImplementation(async (_projectId, _sessionId, onEvent, options) => {
        calls += 1;
        if (calls <= 6) throw new Error("offline");
        onEvent({
          type: "session",
          session: agentSession("session-1", "project-1"),
        });
        await new Promise<void>((resolve) =>
          options?.signal?.addEventListener("abort", () => resolve(), { once: true }),
        );
      });
    const store = createAiStore();
    await store.loadSession("project-1", "session-1");

    const exhausted = store.startStream("project-1", "session-1");
    await vi.advanceTimersByTimeAsync(30_000);
    await exhausted;
    expect(stream).toHaveBeenCalledTimes(6);
    expect(store.canRetryStream).toBe(true);
    expect(store.streamError).toContain("Retry the connection");

    const retrying = store.retryStream();
    await vi.waitFor(() => expect(store.streamStatus).toBe("connected"));
    expect(stream).toHaveBeenCalledTimes(7);
    store.stopStream();
    await retrying;
    vi.useRealTimers();
  });

  it("prevents repeated tool decisions and reports the failed action on its node", async () => {
    vi.spyOn(OpenTalesClient.prototype, "getAiAgentSession").mockResolvedValue(
      agentSession("session-1", "project-1"),
    );
    const decision = deferred<AiAgentSession>();
    const approve = vi
      .spyOn(OpenTalesClient.prototype, "approveAiToolCall")
      .mockReturnValueOnce(decision.promise)
      .mockRejectedValueOnce(new Error("approval failed"));
    const store = createAiStore();
    await store.loadSession("project-1", "session-1");

    const first = store.approveToolCall("project-1", "tool-1", true);
    expect(store.toolActionStates["tool-1"]).toBe("approving");
    expect(await store.approveToolCall("project-1", "tool-1", true)).toBe(false);
    expect(approve).toHaveBeenCalledTimes(1);
    decision.resolve(agentSession("session-1", "project-1"));
    expect(await first).toBe(true);
    expect(store.toolActionStates["tool-1"]).toBeUndefined();

    expect(await store.approveToolCall("project-1", "tool-2", true)).toBe(false);
    expect(store.toolActionErrors["tool-2"]).toBe("approval failed");
  });

  it("ignores a delayed action response after selecting another session", async () => {
    vi.spyOn(OpenTalesClient.prototype, "getAiAgentSession").mockImplementation(
      async (_projectId, sessionId) =>
        agentSession(sessionId ?? "session-1", "project-1"),
    );
    const decision = deferred<AiAgentSession>();
    vi.spyOn(OpenTalesClient.prototype, "approveAiToolCall").mockReturnValue(
      decision.promise,
    );
    vi.spyOn(OpenTalesClient.prototype, "streamAiAgentSession").mockImplementation(
      async (_projectId, _sessionId, _onEvent, options) =>
        new Promise<void>((resolve) =>
          options?.signal?.addEventListener("abort", () => resolve(), {
            once: true,
          }),
        ),
    );
    const store = createAiStore();
    await store.loadSession("project-1", "session-1");
    const pending = store.approveToolCall("project-1", "tool-1", true);
    await store.selectSession("project-1", "session-2");
    decision.resolve(agentSession("session-1", "project-1"));

    expect(await pending).toBe(false);
    expect(store.session?.id).toBe("session-2");
    store.stopStream();
  });

  it("keeps a newer cancellation snapshot when an older queue request returns late", async () => {
    const idle = agentSession("session-1", "project-1");
    const running = {
      ...idle,
      status: "running" as const,
      activePromptId: "prompt-1",
    };
    const cancelled = {
      ...idle,
      status: "cancelled" as const,
    };
    vi.spyOn(OpenTalesClient.prototype, "getAiAgentSession").mockResolvedValue(
      idle,
    );
    const queued = deferred<AiAgentSession>();
    vi.spyOn(OpenTalesClient.prototype, "queueAiAgentPrompt").mockReturnValue(
      queued.promise,
    );
    vi.spyOn(
      OpenTalesClient.prototype,
      "cancelAiAgentSession",
    ).mockResolvedValue(cancelled);
    const store = createAiStore();
    await store.loadSession("project-1", "session-1");

    const queueing = store.queuePrompt("project-1", "Long-running request");
    expect(await store.cancelSession("project-1")).toBe(true);
    queued.resolve(running);

    expect(await queueing).toBe(false);
    expect(store.session?.status).toBe("cancelled");
    expect(store.session?.activePromptId).toBeNull();
  });

  it("does not let a queue response overwrite cancellation streamed from another client", async () => {
    const idle = agentSession("session-1", "project-1");
    const running = {
      ...idle,
      status: "running" as const,
      activePromptId: "prompt-remote-race",
    };
    const cancelled = {
      ...idle,
      status: "cancelled" as const,
    };
    vi.spyOn(OpenTalesClient.prototype, "getAiAgentSession").mockResolvedValue(
      idle,
    );
    const queued = deferred<AiAgentSession>();
    vi.spyOn(OpenTalesClient.prototype, "queueAiAgentPrompt").mockReturnValue(
      queued.promise,
    );
    vi.spyOn(
      OpenTalesClient.prototype,
      "streamAiAgentSession",
    ).mockImplementation(async (_projectId, _sessionId, onEvent, options) => {
      onEvent({
        type: "session",
        session: cancelled,
        data: { cancelled: true },
      });
      await new Promise<void>((resolve) =>
        options?.signal?.addEventListener("abort", () => resolve(), {
          once: true,
        }),
      );
    });
    const store = createAiStore();
    await store.loadSession("project-1", "session-1");

    const queueing = store.queuePrompt("project-1", "Request from this tab");
    const streaming = store.startStream("project-1", "session-1");
    await vi.waitFor(() => expect(store.session?.status).toBe("cancelled"));
    queued.resolve(running);

    expect(await queueing).toBe(false);
    expect(store.session?.status).toBe("cancelled");
    store.stopStream();
    await streaming;
  });
});

describe("reconnectDelayMs", () => {
  it("uses bounded jittered exponential backoff", () => {
    expect(reconnectDelayMs(0, () => 0)).toBe(375);
    expect(reconnectDelayMs(1, () => 0.5)).toBe(1_000);
    expect(reconnectDelayMs(20, () => 1)).toBeLessThanOrEqual(8_000);
  });
});
