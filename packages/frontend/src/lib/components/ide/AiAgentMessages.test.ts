import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/svelte";
import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  AiAgentMessage,
  AiAgentSession,
  AiAgentToolCall,
} from "@opentales/sdk";
import type { AgentSessionPart } from "$lib/ai-agent-timeline";
import AiAgentMessages from "./AiAgentMessages.svelte";

afterEach(() => cleanup());

const timestamp = "2026-08-25T01:35:47.730Z";

function toolCall(): AiAgentToolCall {
  return {
    id: "tool-db",
    toolCallId: "tool-sdk",
    toolName: "listProjectAiSkills",
    input: { projectId: "project-1" },
    status: "executed",
    output: { count: 4 },
    error: null,
    createdAt: timestamp,
    decidedAt: timestamp,
  };
}

function timelineSession(parts: AgentSessionPart[]): AiAgentSession {
  return {
    id: "session-1",
    projectId: "project-1",
    title: "Agent session",
    status: "idle",
    activePromptId: null,
    activeBuildRunId: null,
    queue: [],
    messages: [],
    toolCalls: [],
    pendingToolCalls: [],
    contextUsage: null,
    error: null,
    updatedAt: timestamp,
    timeline: parts,
  } as AiAgentSession;
}

function base(id: string, sequence: number) {
  return {
    id,
    sequence,
    promptId: "prompt-1",
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

const userMessage: AiAgentMessage = {
  id: "message-user",
  role: "user",
  content: "Inspect the skills",
  createdAt: timestamp,
};

describe("AiAgentMessages", () => {
  it("renders prose and tools in the persisted chronological order", async () => {
    const session = timelineSession([
      {
        ...base("user", 1),
        kind: "message",
        message: userMessage,
      },
      {
        ...base("text-before", 2),
        kind: "text",
        messageId: "assistant",
        content: "I’ll inspect the catalog.",
        streaming: false,
      },
      {
        ...base("tool", 3),
        kind: "tool-call",
        toolCall: toolCall(),
      },
      {
        ...base("text-after", 4),
        kind: "text",
        messageId: "assistant",
        content: "Four skills are available.",
        streaming: false,
      },
    ]);

    const { container } = render(AiAgentMessages, {
      session,
      isRunning: false,
      toolLabel: () => "List skills",
      toolStatusLabel: () => "executed",
    });
    const nodes = Array.from(
      container.querySelectorAll<HTMLElement>("[data-timeline-kind]"),
    );

    expect(nodes.map((node) => node.dataset.timelineKind)).toEqual([
      "message",
      "text",
      "tool",
      "text",
    ]);
    expect(nodes.map((node) => node.textContent)).toEqual([
      expect.stringContaining("Inspect the skills"),
      expect.stringContaining("I’ll inspect the catalog."),
      expect.stringContaining("List skills"),
      expect.stringContaining("Four skills are available."),
    ]);

    const disclosure = screen.getByRole("button", {
      name: /List skills, executed\. Show details/,
    });
    expect(disclosure.getAttribute("aria-expanded")).toBe("false");
    await fireEvent.click(disclosure);
    expect(disclosure.getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByText("Input")).toBeTruthy();
    expect(screen.getByText("Result")).toBeTruthy();
  });

  it("shows delegated agent activity as a distinct lifecycle node", async () => {
    const openSession = vi.fn();
    const session = timelineSession([
      {
        ...base("task", 1),
        kind: "task",
        task: {
          sessionId: "child-session-1",
          description: "Inspect session streaming",
          subagentType: "explore",
          status: "completed",
          output: "Verified event order",
          outputTruncated: true,
        },
      },
    ]);

    render(AiAgentMessages, {
      session,
      isRunning: false,
      toolLabel: (name) => name,
      toolStatusLabel: (status) => status,
      onOpenSession: openSession,
    });

    const disclosure = screen.getByRole("button", {
      name: /Inspect session streaming, completed by explore/,
    });
    expect(disclosure.textContent).toContain("@explore");
    expect(disclosure.textContent).toContain("Verified event order");
    expect(disclosure.textContent).toContain("preview truncated");
    await fireEvent.click(disclosure);
    expect(screen.getByText("child-session-1")).toBeTruthy();
    expect(screen.getByText(/Open the task session for the full result/)).toBeTruthy();
    await fireEvent.click(
      screen.getByRole("button", { name: "Open task session" }),
    );
    expect(openSession).toHaveBeenCalledWith("child-session-1");
  });

  it("labels a settled task start as started while keeping completion in place", () => {
    const session = timelineSession([
      {
        ...base("task-start", 1),
        kind: "task",
        task: {
          toolCallId: "task-call",
          sessionId: "child-session",
          description: "Inspect streaming",
          subagentType: "explore",
          status: "running",
        },
      },
      {
        ...base("task-finish", 3),
        kind: "task",
        task: {
          toolCallId: "task-call",
          sessionId: "child-session",
          description: "Inspect streaming",
          subagentType: "explore",
          status: "completed",
        },
      },
    ]);
    render(AiAgentMessages, {
      session,
      isRunning: false,
      toolLabel: (name) => name,
      toolStatusLabel: (status) => status,
    });

    expect(
      screen.getByRole("button", { name: /Inspect streaming, started by explore/ }),
    ).toBeTruthy();
    expect(
      screen.getByRole("button", {
        name: /Inspect streaming, completed by explore/,
      }),
    ).toBeTruthy();
  });

  it("shows a parent-aborted subtask as cancelled", () => {
    const session = timelineSession([
      {
        ...base("task-cancelled", 1),
        kind: "task",
        task: {
          toolCallId: "task-call",
          sessionId: "child-session",
          description: "Inspect streaming",
          subagentType: "explore",
          status: "cancelled",
        },
      },
    ]);
    render(AiAgentMessages, {
      session,
      isRunning: false,
      toolLabel: (name) => name,
      toolStatusLabel: (status) => status,
    });

    expect(
      screen.getByRole("button", {
        name: /Inspect streaming, cancelled by explore/,
      }),
    ).toBeTruthy();
  });

  it("marks the activity log busy and avoids a duplicate working row while text streams", () => {
    const session = timelineSession([
      {
        ...base("text", 1),
        kind: "text",
        messageId: "assistant",
        content: "Still writing",
        streaming: true,
      },
    ]);

    const { container } = render(AiAgentMessages, {
      session,
      isRunning: true,
      toolLabel: (name) => name,
      toolStatusLabel: (status) => status,
    });

    expect(
      screen
        .getByRole("list", { name: "Agent activity" })
        .getAttribute("aria-busy"),
    ).toBe("true");
    expect(
      container.querySelector('[data-timeline-kind="working"]'),
    ).toBeNull();
  });

  it("keeps approval controls on the tool node", async () => {
    const approve = vi.fn();
    const reject = vi.fn();
    const openApproval = vi.fn();
    const pending = {
      ...toolCall(),
      status: "pending-approval" as const,
      output: null,
      decidedAt: null,
    };
    const session = timelineSession([
      {
        ...base("pending-tool", 1),
        kind: "tool-call",
        toolCall: pending,
      },
    ]);

    const { container } = render(AiAgentMessages, {
      session,
      isRunning: true,
      toolLabel: () => "List skills",
      toolStatusLabel: () => "pending",
      onApproveTool: approve,
      onRejectTool: reject,
      onOpenApproval: openApproval,
    });
    const toolNode = container.querySelector('[data-timeline-kind="tool"]');
    expect(toolNode?.contains(screen.getByRole("button", { name: "Approve" }))).toBe(
      true,
    );
    await fireEvent.click(screen.getByRole("button", { name: "Review change" }));
    await fireEvent.click(screen.getByRole("button", { name: "Reject" }));
    await fireEvent.click(screen.getByRole("button", { name: "Approve" }));

    expect(openApproval).toHaveBeenCalledWith(pending);
    expect(reject).toHaveBeenCalledWith("tool-db");
    expect(approve).toHaveBeenCalledWith("tool-db");
  });

  it("loads the full bounded input before opening approval review", async () => {
    let resolveDetail!: (detail: AiAgentToolCall) => void;
    const detailRequest = new Promise<AiAgentToolCall>((resolve) => {
      resolveDetail = resolve;
    });
    const openApproval = vi.fn();
    const loadDetail = vi.fn(() => detailRequest);
    const bounded: AiAgentToolCall = {
      ...toolCall(),
      toolName: "updateChapter",
      status: "pending-approval",
      input: { preview: "bounded" },
      inputTruncated: true,
      output: null,
      decidedAt: null,
    };
    const session = timelineSession([
      {
        ...base("bounded-approval", 1),
        kind: "tool-call",
        toolCall: bounded,
      },
    ]);
    render(AiAgentMessages, {
      session,
      isRunning: true,
      toolLabel: () => "Update chapter",
      toolStatusLabel: () => "pending",
      onApproveTool: vi.fn(),
      onRejectTool: vi.fn(),
      onOpenApproval: openApproval,
      onLoadToolDetail: loadDetail,
    });

    await fireEvent.click(screen.getByRole("button", { name: "Review change" }));
    expect(loadDetail).toHaveBeenCalledWith(bounded);
    expect(
      (screen.getByRole("button", {
        name: "Loading proposal…",
      }) as HTMLButtonElement).disabled,
    ).toBe(true);
    expect(openApproval).not.toHaveBeenCalled();

    const full = {
      ...bounded,
      input: { chapterId: "chapter-1", content: "Full proposal" },
      inputTruncated: false,
    };
    resolveDetail(full);
    await waitFor(() => expect(openApproval).toHaveBeenCalledWith(full));
    expect(openApproval).not.toHaveBeenCalledWith(bounded);
  });

  it("renders agent questions inline at their chronological tool position", async () => {
    const submitQuestion = vi.fn();
    const reject = vi.fn();
    const questionCall: AiAgentToolCall = {
      ...toolCall(),
      toolName: "askUser",
      status: "pending-approval",
      output: null,
      decidedAt: null,
      input: {
        questions: [
          {
            header: "Scope",
            question: "Which branch should the agent inspect?",
            options: [{ label: "Current build" }, { label: "Main" }],
            custom: false,
          },
        ],
      },
    };
    const session = timelineSession([
      {
        ...base("question", 1),
        kind: "tool-call",
        toolCall: questionCall,
      },
    ]);

    const { container } = render(AiAgentMessages, {
      session,
      isRunning: true,
      toolLabel: () => "Ask user",
      toolStatusLabel: () => "pending",
      onSubmitQuestion: submitQuestion,
      onRejectTool: reject,
    });
    const toolNode = container.querySelector('[data-timeline-kind="tool"]');
    const submit = screen.getByRole("button", { name: "Submit answer" });
    expect((submit as HTMLButtonElement).disabled).toBe(true);
    const option = screen.getByRole("radio", { name: /Current build/ });
    expect(toolNode?.contains(option)).toBe(true);
    await fireEvent.click(option);
    expect(option.getAttribute("aria-checked")).toBe("true");
    expect((submit as HTMLButtonElement).disabled).toBe(false);
    await fireEvent.click(submit);

    expect(submitQuestion).toHaveBeenCalledWith(questionCall, [
      ["Current build"],
    ]);
  });

  it("loads a truncated tool result on first expansion", async () => {
    let resolveDetail!: (toolCall: AiAgentToolCall) => void;
    const detail = new Promise<AiAgentToolCall>((resolve) => {
      resolveDetail = resolve;
    });
    const truncated = {
      ...toolCall(),
      output: { preview: true },
      inputTruncated: true,
      outputTruncated: true,
    };
    const session = timelineSession([
      {
        ...base("truncated", 1),
        kind: "tool-call",
        toolCall: truncated,
      },
    ]);
    const loadDetail = vi.fn(() => detail);
    render(AiAgentMessages, {
      session,
      isRunning: false,
      toolLabel: () => "List skills",
      toolStatusLabel: () => "executed",
      onLoadToolDetail: loadDetail,
    });

    await fireEvent.click(
      screen.getByRole("button", { name: /List skills, executed\. Show details/ }),
    );
    expect(screen.getByText(/Loading full result/)).toBeTruthy();
    expect(loadDetail).toHaveBeenCalledWith(truncated);
    resolveDetail({
      ...truncated,
      output: { fullResult: "All four skills" },
      outputTruncated: false,
    });

    await waitFor(() =>
      expect(screen.getByText(/All four skills/)).toBeTruthy(),
    );
    expect(screen.queryByText("Result preview truncated.")).toBeNull();
  });

  it("offers earlier activity without hiding mixed chronology fidelity", async () => {
    const loadEarlier = vi.fn();
    const session = timelineSession([
      {
        ...base("text", 5),
        kind: "text",
        messageId: "assistant",
        content: "Recent activity",
        streaming: false,
      },
    ]);
    session.timelineInfo = {
      mode: "mixed",
      truncated: true,
      earliestSequence: 5,
      hasMoreBefore: true,
    };
    render(AiAgentMessages, {
      session,
      isRunning: false,
      toolLabel: (name) => name,
      toolStatusLabel: (status) => status,
      canLoadEarlier: true,
      onLoadEarlier: loadEarlier,
    });

    expect(screen.getByRole("note").textContent).toContain(
      "newer activity is exact",
    );
    expect(screen.getByRole("note").textContent).toContain(
      "Earlier session activity is not loaded",
    );
    await fireEvent.click(
      screen.getByRole("button", { name: "Load earlier activity" }),
    );
    expect(loadEarlier).toHaveBeenCalledOnce();
  });
});
