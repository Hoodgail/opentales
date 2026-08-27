import type {
  AiAgentMessage,
  AiAgentSession,
  AiAgentSessionPart,
  AiAgentSubtaskPart,
  AiAgentToolCall,
} from "@opentales/sdk";

export type AgentTaskActivity = AiAgentSubtaskPart;
export type AgentSessionPart = AiAgentSessionPart;

export type AgentTimelineItem =
  | {
      kind: "message";
      id: string;
      sequence: number;
      createdAt: string;
      message: AiAgentMessage;
    }
  | {
      kind: "text";
      id: string;
      sequence: number;
      promptId: string | null;
      createdAt: string;
      updatedAt: string;
      messageId: string;
      content: string;
      streaming: boolean;
    }
  | {
      kind: "tool";
      id: string;
      sequence: number;
      promptId: string | null;
      createdAt: string;
      updatedAt: string;
      toolCall: AiAgentToolCall;
    }
  | {
      kind: "task";
      id: string;
      sequence: number;
      promptId: string | null;
      createdAt: string;
      updatedAt: string;
      task: AgentTaskActivity;
      historicalStart: boolean;
    };

/**
 * Produce the visible execution trace. New sessions use the server's durable,
 * sequenced parts; legacy sessions retain the old timestamp-based projection.
 */
export function buildAgentTimeline(
  session: AiAgentSession | null,
): AgentTimelineItem[] {
  if (!session) return [];
  const parts = session.timeline;
  if (parts?.length) return timelineFromParts(parts);
  return legacyTimeline(session);
}

export function timelineRevision(session: AiAgentSession | null): string {
  if (!session) return "empty";
  const parts = session.timeline;
  if (parts?.length) {
    return parts
      .map((part) => `${part.id}:${part.updatedAt}:${partRevision(part)}`)
      .join("|");
  }
  return [
    ...session.messages.map(
      (message) => `${message.id}:${message.content.length}:${message.createdAt}`,
    ),
    ...session.toolCalls.map(
      (toolCall) =>
        `${toolCall.id}:${toolCall.status}:${toolCall.decidedAt ?? ""}:${toolCall.error ?? ""}`,
    ),
  ].join("|");
}

export function timelineFidelityNotice(session: AiAgentSession | null): string | null {
  if (!session) return null;
  const notices: string[] = [];
  if (session.timelineInfo?.mode === "mixed")
    notices.push(
      "Some older activity uses approximate chronology; newer activity is exact.",
    );
  else if (session.timelineInfo?.mode === "approximate")
    notices.push("This older session uses approximate chronology.");
  else if (
    !session.timeline?.length &&
    (session.messages.length || session.toolCalls.length)
  )
    notices.push("This older session uses approximate chronology.");
  if (session.timelineInfo?.truncated || session.timelineInfo?.hasMoreBefore)
    notices.push("Earlier session activity is not loaded.");
  return notices.length ? notices.join(" ") : null;
}

function timelineFromParts(parts: AgentSessionPart[]): AgentTimelineItem[] {
  const ordered = parts
    .map((part, index) => ({ part, index }))
    .sort(
      (left, right) =>
        left.part.sequence - right.part.sequence || left.index - right.index,
    )
    .map(({ part }) => part);

  const taskToolCallIds = new Set<string>();
  const taskSessionIds = new Set<string>();
  const latestTaskSequence = new Map<string, number>();
  for (const part of ordered) {
    if (part.kind !== "task") continue;
    if (part.task.toolCallId) taskToolCallIds.add(part.task.toolCallId);
    taskSessionIds.add(part.task.sessionId);
    latestTaskSequence.set(
      part.task.sessionId,
      Math.max(latestTaskSequence.get(part.task.sessionId) ?? -1, part.sequence),
    );
  }
  const items: AgentTimelineItem[] = [];
  const toolIndex = new Map<string, number>();

  for (const part of ordered) {
    if (part.kind === "message") {
      // Tool protocol messages are represented by the richer tool parts.
      if (part.message.role === "tool") continue;
      items.push({
        kind: "message",
        id: part.id,
        sequence: part.sequence,
        createdAt: part.createdAt,
        message: part.message,
      });
      continue;
    }
    if (part.kind === "text") {
      if (!part.content && !part.streaming) continue;
      items.push({ ...part });
      continue;
    }
    if (part.kind === "task") {
      items.push({
        ...part,
        historicalStart:
          part.task.status === "running" &&
          (latestTaskSequence.get(part.task.sessionId) ?? part.sequence) >
            part.sequence,
      });
      continue;
    }

    // Task lifecycle parts are more useful than the protocol-level task call.
    if (
      part.toolCall.toolName === "task" &&
      ((part.toolCall.toolCallId !== null &&
        taskToolCallIds.has(part.toolCall.toolCallId)) ||
        taskSessionIds.has(taskSessionIdFromTool(part.toolCall) ?? ""))
    ) {
      continue;
    }

    const identity = toolIdentity(part.toolCall);
    const existingIndex = toolIndex.get(identity);
    if (existingIndex !== undefined) {
      const existing = items[existingIndex];
      if (existing?.kind === "tool") {
        items[existingIndex] = {
          ...existing,
          updatedAt: part.updatedAt,
          toolCall: part.toolCall,
        };
      }
      continue;
    }

    toolIndex.set(identity, items.length);
    items.push({
      kind: "tool",
      id: part.id,
      sequence: part.sequence,
      promptId: part.promptId,
      createdAt: part.createdAt,
      updatedAt: part.updatedAt,
      toolCall: part.toolCall,
    });
  }

  return items;
}

function legacyTimeline(session: AiAgentSession): AgentTimelineItem[] {
  return [
    ...session.messages
      .filter((message) => message.role !== "tool")
      .map((message, index) => ({
        kind: "message" as const,
        id: `message-${message.id}`,
        sequence: index,
        createdAt: message.createdAt,
        message,
      })),
    ...session.toolCalls.map((toolCall, index) => ({
      kind: "tool" as const,
      id: `tool-${toolCall.id}`,
      sequence: session.messages.length + index,
      promptId: null,
      createdAt: toolCall.createdAt,
      updatedAt: toolCall.decidedAt ?? toolCall.createdAt,
      toolCall,
    })),
  ].sort((left, right) => {
    const byTime = Date.parse(left.createdAt) - Date.parse(right.createdAt);
    return byTime || left.sequence - right.sequence;
  });
}

function toolIdentity(toolCall: AiAgentToolCall): string {
  return toolCall.toolCallId ?? toolCall.id;
}

function taskSessionIdFromTool(toolCall: AiAgentToolCall): string | null {
  if (!toolCall.output || typeof toolCall.output !== "object" || Array.isArray(toolCall.output))
    return null;
  const output = toolCall.output as Record<string, unknown>;
  const value = output.task_id ?? output.sessionId;
  return typeof value === "string" ? value : null;
}

function partRevision(part: AgentSessionPart): string {
  if (part.kind === "text")
    return `${part.content.length}:${part.streaming ? "streaming" : "done"}`;
  if (part.kind === "tool-call" || part.kind === "tool-result")
    return `${part.toolCall.status}:${part.toolCall.error ?? ""}`;
  if (part.kind === "task")
    return `${part.task.status}:${part.task.error ?? ""}`;
  if (part.kind === "message")
    return `${part.message.role}:${part.message.content.length}`;
  return "unknown";
}
