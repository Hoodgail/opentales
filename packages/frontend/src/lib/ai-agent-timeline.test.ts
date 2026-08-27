import { describe, expect, it } from "vitest";
import type {
  AiAgentMessage,
  AiAgentSession,
  AiAgentToolCall,
} from "@opentales/sdk";
import {
  buildAgentTimeline,
  timelineFidelityNotice,
  timelineRevision,
  type AgentSessionPart,
} from "./ai-agent-timeline";

const start = "2026-08-25T01:35:47.730Z";

function message(
  id: string,
  role: AiAgentMessage["role"],
  content: string,
  createdAt = start,
): AiAgentMessage {
  return { id, role, content, createdAt };
}

function toolCall(
  status: AiAgentToolCall["status"],
  output: unknown = null,
): AiAgentToolCall {
  return {
    id: "db-tool-1",
    toolCallId: "sdk-tool-1",
    toolName: "listProjectAiSkills",
    input: { projectId: "project-1" },
    status,
    output,
    error: null,
    createdAt: "2026-08-25T01:35:53.000Z",
    decidedAt:
      status === "executed" ? "2026-08-25T01:35:54.000Z" : null,
  };
}

function session(
  input: Partial<AiAgentSession> & { timeline?: AgentSessionPart[] } = {},
): AiAgentSession {
  return {
    id: "session-1",
    projectId: "project-1",
    title: "Recent session",
    status: "idle",
    activePromptId: null,
    activeBuildRunId: null,
    queue: [],
    messages: [],
    toolCalls: [],
    timeline: [],
    pendingToolCalls: [],
    contextUsage: null,
    error: null,
    updatedAt: start,
    ...input,
  } as AiAgentSession;
}

function basePart(
  id: string,
  sequence: number,
): Pick<
  AgentSessionPart,
  "id" | "sequence" | "promptId" | "createdAt" | "updatedAt"
> {
  return {
    id,
    sequence,
    promptId: "prompt-1",
    createdAt: start,
    updatedAt: start,
  };
}

describe("buildAgentTimeline", () => {
  it("uses durable sequence order for text → tool → text interleaving", () => {
    const timeline: AgentSessionPart[] = [
      {
        ...basePart("user", 1),
        kind: "message",
        message: message("user-message", "user", "Inspect the agents."),
      },
      {
        ...basePart("text-1", 2),
        kind: "text",
        messageId: "assistant-message",
        content: "I’ll inspect the skills first.",
        streaming: false,
      },
      {
        ...basePart("tool-call", 3),
        kind: "tool-call",
        toolCall: toolCall("approved"),
      },
      {
        ...basePart("tool-result", 4),
        kind: "tool-result",
        toolCall: toolCall("executed", { count: 4 }),
      },
      {
        ...basePart("text-2", 5),
        kind: "text",
        messageId: "assistant-message",
        content: "Four skills are available.",
        streaming: false,
      },
    ];

    const result = buildAgentTimeline(session({ timeline }));

    expect(result.map((item) => item.kind)).toEqual([
      "message",
      "text",
      "tool",
      "text",
    ]);
    expect(result.map((item) => item.id)).toEqual([
      "user",
      "text-1",
      "tool-call",
      "text-2",
    ]);
    expect(result[2]).toMatchObject({
      kind: "tool",
      toolCall: { status: "executed", output: { count: 4 } },
    });
  });

  it("keeps task start and finish at their real sequence and suppresses exact protocol duplicates", () => {
    const taskInput = {
      description: "Inspect session streaming",
      subagent_type: "explore",
    };
    const genericTaskCall: AiAgentToolCall = {
      ...toolCall("executed", { task_id: "child-session" }),
      id: "task-tool",
      toolCallId: "task-sdk-call",
      toolName: "task",
      input: taskInput,
    };
    const timeline: AgentSessionPart[] = [
      {
        ...basePart("task-call", 1),
        kind: "tool-call",
        toolCall: { ...genericTaskCall, status: "approved", output: null },
      },
      {
        ...basePart("task-running", 2),
        kind: "task",
        task: {
          toolCallId: "task-sdk-call",
          sessionId: "child-session",
          description: "Inspect session streaming",
          subagentType: "explore",
          status: "running",
        },
      },
      {
        ...basePart("between", 3),
        kind: "text",
        messageId: "assistant",
        content: "The delegated worker is checking the stream.",
        streaming: false,
      },
      {
        ...basePart("task-result", 4),
        kind: "tool-result",
        toolCall: genericTaskCall,
      },
      {
        ...basePart("task-finished", 5),
        kind: "task",
        task: {
          toolCallId: "task-sdk-call",
          sessionId: "child-session",
          description: "Inspect session streaming",
          subagentType: "explore",
          status: "completed",
          output: "Verified",
        },
      },
    ];

    const result = buildAgentTimeline(session({ timeline }));
    expect(result.map((item) => item.id)).toEqual([
      "task-running",
      "between",
      "task-finished",
    ]);
    expect(result[0]).toMatchObject({
      kind: "task",
      historicalStart: true,
      task: { status: "running" },
    });
    expect(result[2]).toMatchObject({
      kind: "task",
      historicalStart: false,
      task: { status: "completed", output: "Verified" },
    });
  });

  it("does not suppress an unrelated task call from the same prompt", () => {
    const genericTaskCall: AiAgentToolCall = {
      ...toolCall("approved"),
      id: "unmatched-task",
      toolCallId: "unmatched-sdk-call",
      toolName: "task",
      input: { description: "A different invocation" },
    };
    const timeline: AgentSessionPart[] = [
      {
        ...basePart("unmatched-call", 1),
        kind: "tool-call",
        toolCall: genericTaskCall,
      },
      {
        ...basePart("known-task", 2),
        kind: "task",
        task: {
          toolCallId: "known-sdk-call",
          sessionId: "known-child",
          description: "Known invocation",
          subagentType: "explore",
          status: "running",
        },
      },
    ];

    expect(buildAgentTimeline(session({ timeline })).map((item) => item.kind)).toEqual([
      "tool",
      "task",
    ]);
  });

  it("keeps a timestamp-ordered fallback for pre-timeline sessions", () => {
    const user = message("user", "user", "Hello", "2026-01-01T00:00:00Z");
    const assistant = message(
      "assistant",
      "assistant",
      "Legacy answer",
      "2026-01-01T00:00:01Z",
    );
    const legacyTool = {
      ...toolCall("executed", { ok: true }),
      createdAt: "2026-01-01T00:00:02Z",
    };

    expect(
      buildAgentTimeline(
        session({ messages: [user, assistant], toolCalls: [legacyTool] }),
      ).map((item) => item.kind),
    ).toEqual(["message", "message", "tool"]);
  });

  it("changes the revision for streaming text and task status updates", () => {
    const textPart: AgentSessionPart = {
      ...basePart("text", 1),
      kind: "text",
      messageId: "assistant",
      content: "Draft",
      streaming: true,
    };
    const before = timelineRevision(session({ timeline: [textPart] }));
    const after = timelineRevision(
      session({
        timeline: [
          {
            ...textPart,
            content: "Draft complete",
            streaming: false,
            updatedAt: "2026-08-25T01:35:48.000Z",
          },
        ],
      }),
    );

    expect(after).not.toBe(before);
  });

  it("labels legacy and mixed chronology without warning for exact history", () => {
    const legacy = session({
      timeline: [],
      messages: [message("legacy", "assistant", "Older response")],
    });
    expect(timelineFidelityNotice(legacy)).toContain("approximate chronology");

    const mixed = session({
      timelineInfo: {
        mode: "mixed",
        truncated: true,
        earliestSequence: 1,
        hasMoreBefore: true,
      },
    });
    expect(timelineFidelityNotice(mixed)).toContain("newer activity is exact");
    expect(timelineFidelityNotice(mixed)).toContain(
      "Earlier session activity is not loaded",
    );

    const exact = session({
      timelineInfo: {
        mode: "exact",
        truncated: false,
        earliestSequence: null,
        hasMoreBefore: false,
      },
    });
    expect(timelineFidelityNotice(exact)).toBeNull();
  });
});
