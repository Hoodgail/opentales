import { cleanup, fireEvent, render, screen } from "@testing-library/svelte";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  send: vi.fn(async () => true),
  interrupt: vi.fn(async () => undefined),
  replyPermission: vi.fn(async () => true),
  updateSession: vi.fn(async () => true),
  state: {
    running: false,
    permissions: [] as unknown[],
  },
}));

function session() {
  return {
    id: "ses_1",
    projectId: "project-1",
    parentId: null,
    title: "Draft chapter two",
    agent: "writer",
    model: { providerId: "opentales", modelId: "gpt-6-luna", model: "gpt-6-luna" },
    approvalMode: "manual",
    status: mocks.state.running ? "running" : "idle",
    outcome: null,
    cost: 0,
    tokens: { input: 1200, output: 300, reasoning: 0, cacheRead: 0, cacheWrite: 0 },
    createdAt: "2026-09-25T00:00:00.000Z",
    updatedAt: "2026-09-25T00:00:00.000Z",
    messages: [
      { id: "m1", role: "user", text: "Plan chapter two", files: [], createdAt: "2026-09-25T00:00:00.000Z" },
      {
        id: "m2",
        role: "assistant",
        agent: "writer",
        model: null,
        parts: [{ type: "text", text: "Here is the plan." }],
        finish: "stop",
        error: null,
        cost: 0,
        tokens: null,
        createdAt: "2026-09-25T00:00:01.000Z",
        completedAt: "2026-09-25T00:00:02.000Z",
      },
    ],
    hasEarlierMessages: false,
    earlierCursor: null,
    permissions: mocks.state.permissions,
    questions: [],
    queue: [],
    error: null,
  };
}

vi.mock("$lib/stores/agent.svelte", () => ({
  agent: {
    get activeSession() { return session(); },
    get viewedSession() { return session(); },
    viewStack: [],
    rootSessions: [],
    activeSessionId: "ses_1",
    capabilities: {
      agents: [{ id: "writer", name: "writer", description: null, mode: "primary", color: null }],
      skills: [],
      tools: [],
      defaultAgent: "writer",
      model: "gpt-6-luna",
    },
    loading: false,
    error: null,
    streamStatus: "connected",
    sending: false,
    pendingActions: {},
    actionErrors: {},
    retryFor: () => null,
    initialize: vi.fn(async () => undefined),
    stopStream: vi.fn(),
    send: mocks.send,
    interrupt: mocks.interrupt,
    replyPermission: mocks.replyPermission,
    updateSession: mocks.updateSession,
    createSession: vi.fn(async () => null),
    openSession: vi.fn(async () => undefined),
    openChild: vi.fn(async () => undefined),
    closeChild: vi.fn(),
    loadEarlier: vi.fn(async () => undefined),
    clearError: vi.fn(),
    retryStream: vi.fn(),
  },
}));

vi.mock("$lib/stores/ai.svelte", () => ({
  ai: {
    settings: { enabled: true, model: "gpt-6-luna" },
    fileTree: { folders: [], docs: [], assets: [] },
    docs: [],
    setProjectContext: vi.fn(),
    loadSettings: vi.fn(async () => undefined),
    loadFileTree: vi.fn(async () => undefined),
  },
}));

vi.mock("$lib/stores/manuscript.svelte", () => ({
  manuscript: {
    projectId: "project-1",
    chapters: [{ id: "chapter-1", title: "Opening", number: 1, summary: "Arrival", content: "" }],
    characters: [],
    locations: [],
    acts: [],
    structure: { obstacles: [] },
    setActiveView: vi.fn(async () => undefined),
    refreshProject: vi.fn(async () => undefined),
    closeTab: vi.fn(async () => undefined),
    openTab: vi.fn(async () => undefined),
  },
}));

import AiAgentPanel from "./AiAgentPanel.svelte";

describe("AiAgentPanel (OpenCode)", () => {
  beforeEach(() => {
    mocks.state.running = false;
    mocks.state.permissions = [];
    vi.clearAllMocks();
  });
  afterEach(() => cleanup());

  it("renders the transcript and sends a prompt with Enter", async () => {
    render(AiAgentPanel);
    expect(screen.getByText("Plan chapter two")).toBeTruthy();
    expect(screen.getByText("Here is the plan.")).toBeTruthy();

    const input = screen.getByLabelText("Message the agent");
    await fireEvent.input(input, { target: { value: "Draft it now" } });
    await fireEvent.keyDown(input, { key: "Enter" });

    expect(mocks.send).toHaveBeenCalledWith(expect.objectContaining({ text: "Draft it now", delivery: "steer" }));
  });

  it("queues follow-ups while running and offers stop", async () => {
    mocks.state.running = true;
    render(AiAgentPanel);
    await fireEvent.click(screen.getByLabelText("Stop the agent"));
    expect(mocks.interrupt).toHaveBeenCalled();

    const input = screen.getByLabelText("Message the agent");
    await fireEvent.input(input, { target: { value: "Also fix the title" } });
    await fireEvent.keyDown(input, { key: "Enter" });
    expect(mocks.send).toHaveBeenCalledWith(expect.objectContaining({ delivery: "queue" }));
  });

  it("approves a proposed change from the approval slip", async () => {
    mocks.state.permissions = [
      { id: "per_1", sessionId: "ses_1", toolName: "createChapter", toolInput: { title: "Two" }, toolCallId: "c", messageId: "m", message: null },
    ];
    render(AiAgentPanel);
    expect(screen.getByText(/Proposed change/)).toBeTruthy();
    await fireEvent.click(screen.getByRole("button", { name: /^Approve$/ }));
    expect(mocks.replyPermission).toHaveBeenCalledWith(expect.objectContaining({ id: "per_1" }), "once");
  });
});
