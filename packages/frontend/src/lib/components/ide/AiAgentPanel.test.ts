import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/svelte";
import type { AiAgentQueuedPrompt } from "@opentales/sdk";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  queuePrompt: vi.fn(),
  cancelSession: vi.fn(),
  setProjectContext: vi.fn(),
  updateSessionApprovalMode: vi.fn(),
  session: {
    id: "session-1",
    projectId: "project-1",
    title: "Session",
    approvalMode: "manual",
    status: "idle",
    activePromptId: null,
    queue: [] as AiAgentQueuedPrompt[],
    messages: [],
    toolCalls: [],
    timeline: [],
    pendingToolCalls: [],
    contextUsage: null,
    error: null,
    updatedAt: "2026-08-26T00:00:00.000Z",
  },
}));

vi.mock("$lib/stores/ai.svelte", () => ({
  ai: {
    session: mocks.session,
    sessions: [],
    activeSessionId: "session-1",
    sessionGeneration: 0,
    sessionLoading: false,
    sessionError: null,
    streaming: false,
    streamStatus: "disconnected",
    streamError: null,
    reconnectAttempt: 0,
    canRetryStream: false,
    settings: { enabled: true, model: "openai/gpt-5-mini" },
    fileTree: { folders: [], docs: [], assets: [] },
    docs: [],
    toolActionStates: {},
    toolActionErrors: {},
    canLoadEarlierTimeline: false,
    timelineLoadingEarlier: false,
    timelineEarlierError: null,
    setProjectContext: mocks.setProjectContext,
    loadSettings: vi.fn(async () => undefined),
    loadSessions: vi.fn(async () => null),
    loadSession: vi.fn(async () => null),
    loadToolManifest: vi.fn(async () => undefined),
    loadFileTree: vi.fn(async () => undefined),
    loadSkills: vi.fn(async () => undefined),
    startStream: vi.fn(async () => undefined),
    stopStream: vi.fn(),
    queuePrompt: mocks.queuePrompt,
    createSession: vi.fn(async () => null),
    updateSessionApprovalMode: mocks.updateSessionApprovalMode,
    selectSession: vi.fn(async () => false),
    cancelSession: mocks.cancelSession,
    approveToolCall: vi.fn(async () => false),
    approveToolCalls: vi.fn(async () => false),
    answerQuestion: vi.fn(async () => false),
    uploadAttachment: vi.fn(async () => null),
    loadToolCallDetail: vi.fn(),
    loadEarlierTimeline: vi.fn(async () => false),
    retryStream: vi.fn(async () => undefined),
  },
}));

vi.mock("$lib/stores/manuscript.svelte", () => ({
  manuscript: {
    projectId: "project-1",
    chapters: [
      { id: "chapter-1", title: "Opening", number: 1, summary: "Arrival" },
    ],
    characters: [
      { id: "character-1", name: "Mara", role: "Lead", traits: ["curious"] },
    ],
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

afterEach(() => cleanup());

beforeEach(() => {
  vi.clearAllMocks();
  mocks.queuePrompt.mockResolvedValue(true);
  mocks.cancelSession.mockResolvedValue(true);
  mocks.updateSessionApprovalMode.mockResolvedValue(true);
  mocks.session.status = "idle";
  mocks.session.approvalMode = "manual";
  mocks.session.queue = [];
});

describe("AiAgentPanel composer", () => {
  it("requires an explicit confirmation before enabling Auto mode", async () => {
    render(AiAgentPanel);
    const mode = screen.getByRole("group", { name: "Agent execution mode" });
    const manual = screen.getByRole("button", { name: "Manual" });
    const auto = screen.getByRole("button", { name: "Auto" });
    expect(mode).toBeTruthy();
    expect(manual.getAttribute("aria-pressed")).toBe("true");

    await fireEvent.click(auto);
    expect(screen.getByText("Enable Auto mode?")).toBeTruthy();
    await fireEvent.click(screen.getByRole("button", { name: "Enable Auto" }));

    expect(mocks.updateSessionApprovalMode).toHaveBeenCalledWith("project-1", "auto");
    await waitFor(() => expect(screen.queryByText("Enable Auto mode?")).toBeNull());
  });

  it("exposes project references as a keyboard-operated combobox", async () => {
    render(AiAgentPanel);
    const input = screen.getByRole("combobox", { name: "Message the AI agent" });
    await fireEvent.input(input, { target: { value: "@" } });

    const listbox = screen.getByRole("listbox", { name: "Project context" });
    const options = screen.getAllByRole("option");
    expect(input.getAttribute("aria-expanded")).toBe("true");
    expect(input.getAttribute("aria-controls")).toBe(listbox.id);
    expect(options[0]?.getAttribute("aria-selected")).toBe("true");
    expect(input.getAttribute("aria-activedescendant")).toBe(options[0]?.id);

    await fireEvent.keyDown(input, { key: "ArrowDown" });
    expect(options[1]?.getAttribute("aria-selected")).toBe("true");
    expect(input.getAttribute("aria-activedescendant")).toBe(options[1]?.id);
    await fireEvent.keyDown(input, { key: "Escape" });
    expect(input.getAttribute("aria-expanded")).toBe("false");
  });

  it("keeps the prompt draft until queueing succeeds and disables repeat submission", async () => {
    let resolveQueue!: (value: boolean) => void;
    mocks.queuePrompt.mockReturnValueOnce(
      new Promise<boolean>((resolve) => {
        resolveQueue = resolve;
      }),
    );
    render(AiAgentPanel);
    const input = screen.getByRole("combobox", {
      name: "Message the AI agent",
    }) as HTMLTextAreaElement;
    await fireEvent.input(input, { target: { value: "Keep this draft" } });
    const send = screen.getByRole("button", { name: "Send" });
    await fireEvent.click(send);
    expect(input.disabled).toBe(true);
    expect(input.value).toBe("Keep this draft");
    expect((send as HTMLButtonElement).disabled).toBe(true);

    resolveQueue(false);
    await waitFor(() => expect(input.disabled).toBe(false));
    expect(input.value).toBe("Keep this draft");
    expect(mocks.queuePrompt).toHaveBeenCalledOnce();
  });

  it("turns the primary composer action into Stop while the agent is running", async () => {
    mocks.session.status = "running";
    render(AiAgentPanel);

    const stop = screen.getByRole("button", { name: "Stop agent" });
    expect((stop as HTMLButtonElement).disabled).toBe(false);
    await fireEvent.click(stop);

    expect(mocks.cancelSession).toHaveBeenCalledOnce();
    expect(mocks.cancelSession).toHaveBeenCalledWith("project-1");
    expect(mocks.queuePrompt).not.toHaveBeenCalled();
  });

  it("offers a working Stop for queued work before the session enters running state", async () => {
    mocks.session.queue = [
      {
        id: "prompt-1",
        prompt: "Queued work",
        status: "queued",
        createdAt: "2026-08-26T00:00:00.000Z",
      },
    ];
    render(AiAgentPanel);

    await fireEvent.click(screen.getByRole("button", { name: "Stop agent" }));
    expect(mocks.cancelSession).toHaveBeenCalledWith("project-1");
  });

  it("turns Stop back into Send and queues a follow-up when a running agent has a draft", async () => {
    mocks.session.status = "running";
    render(AiAgentPanel);
    const input = screen.getByRole("combobox", {
      name: "Message the AI agent",
    });
    await fireEvent.input(input, { target: { value: "Check the next scene" } });

    expect(screen.queryByRole("button", { name: "Stop agent" })).toBeNull();
    await fireEvent.click(
      screen.getByRole("button", { name: "Queue follow-up" }),
    );

    expect(mocks.queuePrompt).toHaveBeenCalledOnce();
    expect(mocks.queuePrompt).toHaveBeenCalledWith(
      "project-1",
      "Check the next scene",
      false,
      {
        model: "openai/gpt-5-mini",
        attachments: [],
      },
    );
    expect(mocks.cancelSession).not.toHaveBeenCalled();
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Stop agent" })).toBeTruthy(),
    );
    expect(
      screen.queryByRole("button", { name: "Interrupt and send" }),
    ).toBeNull();
  });

  it("does not enqueue or cancel twice while Stop is still in flight", async () => {
    let resolveCancel!: (value: boolean) => void;
    mocks.session.status = "running";
    mocks.cancelSession.mockReturnValueOnce(
      new Promise<boolean>((resolve) => {
        resolveCancel = resolve;
      }),
    );
    render(AiAgentPanel);
    const input = screen.getByRole("combobox", {
      name: "Message the AI agent",
    });
    const stop = screen.getByRole("button", { name: "Stop agent" });

    await fireEvent.click(stop);
    const stopping = screen.getByRole("button", { name: "Stopping agent" });
    expect((stopping as HTMLButtonElement).disabled).toBe(true);
    await fireEvent.click(stopping);
    await fireEvent.input(input, { target: { value: "Wait until stopped" } });
    await fireEvent.keyDown(input, { key: "Enter" });

    expect(mocks.cancelSession).toHaveBeenCalledOnce();
    expect(mocks.queuePrompt).not.toHaveBeenCalled();
    resolveCancel(true);
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Queue follow-up" }),
      ).toBeTruthy(),
    );
  });

  it("keeps Stop available while an active follow-up queue request resolves", async () => {
    let resolveQueue!: (value: boolean) => void;
    mocks.queuePrompt.mockReturnValueOnce(
      new Promise<boolean>((resolve) => {
        resolveQueue = resolve;
      }),
    );
    mocks.session.queue = [
      {
        id: "prompt-already-running",
        prompt: "Existing work",
        status: "running",
        createdAt: "2026-08-26T00:00:00.000Z",
      },
    ];
    render(AiAgentPanel);
    const input = screen.getByRole("combobox", {
      name: "Message the AI agent",
    });
    await fireEvent.input(input, { target: { value: "Start a long task" } });
    await fireEvent.click(
      screen.getByRole("button", { name: "Queue follow-up" }),
    );
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Stop agent" })).toBeTruthy(),
    );
    await fireEvent.click(screen.getByRole("button", { name: "Stop agent" }));

    expect(mocks.cancelSession).toHaveBeenCalledWith("project-1");
    resolveQueue(true);
    await waitFor(() =>
      expect((input as HTMLTextAreaElement).disabled).toBe(false),
    );
  });

  it("queues Enter as a follow-up but leaves Shift+Enter to the textarea", async () => {
    mocks.session.status = "running";
    render(AiAgentPanel);
    const input = screen.getByRole("combobox", {
      name: "Message the AI agent",
    });
    await fireEvent.input(input, { target: { value: "First line" } });

    expect(await fireEvent.keyDown(input, { key: "Enter", shiftKey: true })).toBe(
      true,
    );
    expect(mocks.queuePrompt).not.toHaveBeenCalled();
    await fireEvent.keyDown(input, { key: "Enter" });

    expect(mocks.queuePrompt).toHaveBeenCalledWith(
      "project-1",
      "First line",
      false,
      expect.any(Object),
    );
  });

  it("does not submit Enter while an IME composition is active", async () => {
    mocks.session.status = "running";
    render(AiAgentPanel);
    const input = screen.getByRole("combobox", {
      name: "Message the AI agent",
    });
    await fireEvent.input(input, { target: { value: "未完成" } });

    expect(
      await fireEvent.keyDown(input, { key: "Enter", isComposing: true }),
    ).toBe(true);
    expect(mocks.queuePrompt).not.toHaveBeenCalled();
  });
});
