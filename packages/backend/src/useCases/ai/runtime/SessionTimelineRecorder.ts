import { Prisma, type PrismaClient } from '@prisma/client';
import type {
  AiAgentMessage,
  AiAgentSessionPart,
  AiAgentSubtaskPart,
  AiAgentTimelineInfo,
  AiAgentToolCall
} from '@opentales/sdk';

export const SESSION_TIMELINE_PART_LIMIT = 1_000;
const TASK_OUTPUT_PREVIEW_BYTES = 16_384;

export interface StoredSessionPart {
  id: string;
  sessionId: string;
  promptId: string | null;
  messageId: string | null;
  toolCallId: string | null;
  kind: string;
  sequence: number;
  payload: Prisma.JsonValue;
  createdAt: Date;
  updatedAt: Date;
}

type AppendPartInput = {
  sessionId: string;
  promptId?: string | null;
  messageId?: string | null;
  toolCallId?: string | null;
  kind: 'message' | 'text' | 'tool-call' | 'tool-result' | 'task';
  payload: Prisma.InputJsonValue;
};

type WithoutSequence<T> = T extends unknown ? Omit<T, 'sequence'> : never;
type UnsequencedSessionPart = WithoutSequence<AiAgentSessionPart>;

export interface SessionTimelineBuildOptions {
  /** Maximum number of durable rows included in the returned window. */
  maxPersistedParts?: number;
  /** The source query omitted older rows even if this invocation has no overflow row. */
  hasMoreBefore?: boolean;
  /** Some source collection was truncated for a reason other than older timeline rows. */
  truncated?: boolean;
}

export interface SessionTimelineProjection {
  timeline: AiAgentSessionPart[];
  timelineInfo: AiAgentTimelineInfo;
}

interface LegacyCandidate {
  createdAt: string;
  rank: number;
  part: UnsequencedSessionPart;
  anchor?: { placement: 'before' | 'after'; sequence: number };
}

/** Durable session trace writer. The session row is the sequence allocator. */
export class SessionTimelineRecorder {
  constructor(private readonly prisma: PrismaClient) {}

  async append(input: AppendPartInput): Promise<StoredSessionPart> {
    return this.prisma.$transaction(async (tx) => {
      const session = await tx.projectAiAgentSession.update({
        where: { id: input.sessionId },
        data: { nextPartSequence: { increment: 1 } },
        select: { nextPartSequence: true }
      });
      return tx.aiAgentSessionPart.create({
        data: {
          sessionId: input.sessionId,
          promptId: input.promptId ?? null,
          messageId: input.messageId ?? null,
          toolCallId: input.toolCallId ?? null,
          kind: input.kind,
          sequence: session.nextPartSequence,
          payload: input.payload
        }
      });
    });
  }

  message(sessionId: string, promptId: string | null, messageId: string): Promise<StoredSessionPart> {
    return this.append({ sessionId, promptId, messageId, kind: 'message', payload: {} });
  }

  text(sessionId: string, promptId: string, messageId: string, content: string): Promise<StoredSessionPart> {
    return this.append({
      sessionId,
      promptId,
      messageId,
      kind: 'text',
      payload: { content, streaming: true }
    });
  }

  updateText(partId: string, content: string, streaming: boolean): Promise<StoredSessionPart> {
    return this.prisma.aiAgentSessionPart.update({
      where: { id: partId },
      data: { payload: { content, streaming } }
    });
  }

  async finishText(part: StoredSessionPart): Promise<StoredSessionPart> {
    if (!partStreaming(part)) return part;
    return this.updateText(part.id, partText(part), false);
  }

  async tool(
    sessionId: string,
    promptId: string | null,
    kind: 'tool-call' | 'tool-result',
    toolCallId: string
  ): Promise<StoredSessionPart> {
    const existing = await this.prisma.aiAgentSessionPart.findFirst({
      where: { sessionId, kind, toolCallId }
    });
    if (existing) return existing;
    try {
      return await this.append({
        sessionId,
        promptId,
        toolCallId,
        kind,
        payload: {}
      });
    } catch (error) {
      if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2002') throw error;
      return this.prisma.aiAgentSessionPart.findFirstOrThrow({
        where: { sessionId, kind, toolCallId }
      });
    }
  }

  task(
    sessionId: string,
    promptId: string,
    task: AiAgentSubtaskPart
  ): Promise<StoredSessionPart> {
    return this.append({
      sessionId,
      promptId,
      kind: 'task',
      payload: jsonPayload(task)
    });
  }
}

export function buildSessionTimeline(
  parts: StoredSessionPart[],
  messages: AiAgentMessage[],
  toolCalls: AiAgentToolCall[],
  options: SessionTimelineBuildOptions = {}
): AiAgentSessionPart[] {
  return buildSessionTimelineProjection(parts, messages, toolCalls, options).timeline;
}

/**
 * Builds the bounded timeline plus fidelity metadata. Persisted rows retain
 * exact database sequence ordering; synthesized legacy rows are inserted by
 * timestamps (or immediately around their persisted tool counterpart) and
 * therefore make the projection approximate or mixed.
 */
export function buildSessionTimelineProjection(
  parts: StoredSessionPart[],
  messages: AiAgentMessage[],
  toolCalls: AiAgentToolCall[],
  options: SessionTimelineBuildOptions = {}
): SessionTimelineProjection {
  const limit = normalizeTimelineLimit(options.maxPersistedParts);
  const orderedParts = [...parts].sort((left, right) =>
    left.sequence - right.sequence || left.id.localeCompare(right.id)
  );
  const overflow = orderedParts.length > limit;
  const windowedParts = overflow ? orderedParts.slice(-limit) : orderedParts;
  const messagesById = new Map(messages.map((message) => [message.id, message]));
  const toolsById = new Map(toolCalls.map((toolCall) => [toolCall.id, toolCall]));
  const persisted = windowedParts.flatMap((part) => {
    const hydrated = hydrateSessionPart(part, messagesById, toolsById);
    return hydrated ? [hydrated] : [];
  });
  const coveredMessages = new Set(persisted.flatMap((part) => {
    if (part.kind === 'message') return [part.message.id];
    if (part.kind === 'text') return [part.messageId];
    return [];
  }));
  const coveredToolCalls = new Set(persisted.flatMap((part) =>
    part.kind === 'tool-call' ? [part.toolCall.id] : []
  ));
  const coveredToolResults = new Set(persisted.flatMap((part) =>
    part.kind === 'tool-result' ? [part.toolCall.id] : []
  ));
  const persistedCalls = new Map(persisted.flatMap((part) =>
    part.kind === 'tool-call' ? [[part.toolCall.id, part] as const] : []
  ));
  const persistedResults = new Map(persisted.flatMap((part) =>
    part.kind === 'tool-result' ? [[part.toolCall.id, part] as const] : []
  ));

  const legacy: LegacyCandidate[] = [];
  for (const message of messages) {
    if (coveredMessages.has(message.id)) continue;
    const base = {
      id: `legacy-message-${message.id}`,
      promptId: null,
      createdAt: message.createdAt,
      updatedAt: message.createdAt
    };
    if (message.role === 'assistant') {
      legacy.push({
        createdAt: message.createdAt,
        rank: 1,
        part: { ...base, kind: 'text', messageId: message.id, content: message.content, streaming: false }
      });
    } else {
      legacy.push({
        createdAt: message.createdAt,
        rank: 0,
        part: { ...base, kind: 'message', message }
      });
    }
  }
  for (const toolCall of toolCalls) {
    const base = {
      promptId: null,
      createdAt: toolCall.createdAt,
      updatedAt: toolCall.decidedAt ?? toolCall.createdAt
    };
    if (!coveredToolCalls.has(toolCall.id)) {
      legacy.push({
        createdAt: toolCall.createdAt,
        rank: 2,
        part: { ...base, id: `legacy-tool-call-${toolCall.id}`, kind: 'tool-call', toolCall },
        ...(persistedResults.get(toolCall.id)
          ? { anchor: { placement: 'before' as const, sequence: persistedResults.get(toolCall.id)!.sequence } }
          : {})
      });
    }
    if (isSettledToolCall(toolCall) && !coveredToolResults.has(toolCall.id)) {
      legacy.push({
        createdAt: toolCall.decidedAt ?? toolCall.createdAt,
        rank: 3,
        part: { ...base, id: `legacy-tool-result-${toolCall.id}`, kind: 'tool-result', toolCall },
        ...(persistedCalls.get(toolCall.id)
          ? { anchor: { placement: 'after' as const, sequence: persistedCalls.get(toolCall.id)!.sequence } }
          : {})
      });
    }
  }
  const legacyParts = sequenceLegacyParts(legacy, persisted);
  const timeline = [...legacyParts, ...persisted].sort((left, right) =>
    left.sequence - right.sequence || left.id.localeCompare(right.id)
  );
  const sourceIncomplete = persisted.length !== windowedParts.length;
  const hasPersisted = persisted.length > 0;
  const hasApproximate = legacyParts.length > 0 || sourceIncomplete;
  const hasMoreBefore = overflow || options.hasMoreBefore === true;
  return {
    timeline,
    timelineInfo: {
      mode: hasApproximate ? (hasPersisted ? 'mixed' : 'approximate') : 'exact',
      truncated: overflow || sourceIncomplete || options.truncated === true || hasMoreBefore,
      earliestSequence: timeline[0]?.sequence ?? null,
      hasMoreBefore
    }
  };
}

export function hydrateSessionPart(
  part: StoredSessionPart,
  messagesById: ReadonlyMap<string, AiAgentMessage>,
  toolsById: ReadonlyMap<string, AiAgentToolCall>
): AiAgentSessionPart | null {
  const base = {
    id: part.id,
    sequence: part.sequence,
    promptId: part.promptId,
    createdAt: part.createdAt.toISOString(),
    updatedAt: part.updatedAt.toISOString()
  };
  if (part.kind === 'message') {
    const message = part.messageId ? messagesById.get(part.messageId) : null;
    return message ? { ...base, kind: 'message', message } : null;
  }
  if (part.kind === 'text') {
    if (!part.messageId) return null;
    return {
      ...base,
      kind: 'text',
      messageId: part.messageId,
      content: partText(part),
      streaming: partStreaming(part)
    };
  }
  if (part.kind === 'tool-call' || part.kind === 'tool-result') {
    const toolCall = part.toolCallId ? toolsById.get(part.toolCallId) : null;
    return toolCall ? { ...base, kind: part.kind, toolCall } : null;
  }
  if (part.kind === 'task') {
    const task = taskPayload(part.payload);
    return task ? { ...base, kind: 'task', task } : null;
  }
  return null;
}

export function toTextTimelinePart(part: StoredSessionPart): Extract<AiAgentSessionPart, { kind: 'text' }> {
  if (!part.messageId) throw new Error('Text session part is missing messageId');
  return {
    id: part.id,
    sequence: part.sequence,
    promptId: part.promptId,
    createdAt: part.createdAt.toISOString(),
    updatedAt: part.updatedAt.toISOString(),
    kind: 'text',
    messageId: part.messageId,
    content: partText(part),
    streaming: partStreaming(part)
  };
}

export function partText(part: StoredSessionPart): string {
  const payload = objectPayload(part.payload);
  return typeof payload.content === 'string' ? payload.content : '';
}

function partStreaming(part: StoredSessionPart): boolean {
  return objectPayload(part.payload).streaming === true;
}

function taskPayload(value: Prisma.JsonValue): AiAgentSubtaskPart | null {
  const payload = objectPayload(value);
  const status = payload.status;
  if (
    typeof payload.sessionId !== 'string'
    || typeof payload.description !== 'string'
    || typeof payload.subagentType !== 'string'
    || (status !== 'running' && status !== 'completed' && status !== 'cancelled' && status !== 'error')
  ) return null;
  const output = boundedTaskOutput(payload.output);
  return {
    sessionId: payload.sessionId,
    ...(typeof payload.toolCallId === 'string' || payload.toolCallId === null
      ? { toolCallId: payload.toolCallId }
      : {}),
    description: payload.description,
    subagentType: payload.subagentType,
    status,
    ...(payload.output === undefined ? {} : {
      output: output.value,
      outputTruncated: output.truncated,
      outputBytes: output.bytes
    }),
    error: typeof payload.error === 'string' ? payload.error : null
  };
}

function boundedTaskOutput(value: Prisma.JsonValue | undefined): {
  value: unknown;
  truncated: boolean;
  bytes: number;
} {
  if (value === undefined) return { value: undefined, truncated: false, bytes: 0 };
  const serialized = JSON.stringify(value);
  const bytes = Buffer.byteLength(serialized, 'utf8');
  if (bytes <= TASK_OUTPUT_PREVIEW_BYTES) return { value, truncated: false, bytes };
  return {
    value: {
      type: 'opentales.truncatedTaskOutput',
      preview: serialized.slice(0, TASK_OUTPUT_PREVIEW_BYTES),
      message: `Subtask output truncated in the parent timeline (${bytes} bytes). Open the child session for the full result.`
    },
    truncated: true,
    bytes
  };
}

function objectPayload(value: Prisma.JsonValue): Record<string, Prisma.JsonValue | undefined> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, Prisma.JsonValue | undefined>
    : {};
}

function jsonPayload(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

function normalizeTimelineLimit(value: number | undefined): number {
  if (value === undefined) return SESSION_TIMELINE_PART_LIMIT;
  if (!Number.isFinite(value)) return SESSION_TIMELINE_PART_LIMIT;
  return Math.max(1, Math.floor(value));
}

function isSettledToolCall(toolCall: AiAgentToolCall): boolean {
  return toolCall.status !== 'running'
    && toolCall.status !== 'pending-approval'
    && toolCall.status !== 'approved';
}

function sequenceLegacyParts(
  candidates: LegacyCandidate[],
  persisted: AiAgentSessionPart[]
): AiAgentSessionPart[] {
  if (!candidates.length) return [];
  const compareLegacy = (left: LegacyCandidate, right: LegacyCandidate) =>
    timelineTime(left.createdAt) - timelineTime(right.createdAt)
    || left.rank - right.rank
    || left.part.id.localeCompare(right.part.id);
  const exact = [...persisted].sort((left, right) =>
    left.sequence - right.sequence || left.id.localeCompare(right.id)
  );
  if (!exact.length) {
    const ordered = [...candidates].sort(compareLegacy);
    return ordered.map(({ part }, index) => ({
      ...part,
      sequence: index - ordered.length
    } as AiAgentSessionPart));
  }

  const gaps = Array.from({ length: exact.length + 1 }, () => [] as LegacyCandidate[]);
  for (const candidate of candidates) {
    const anchorIndex = candidate.anchor
      ? exact.findIndex((part) => part.sequence === candidate.anchor!.sequence)
      : -1;
    if (anchorIndex >= 0) {
      gaps[anchorIndex + (candidate.anchor!.placement === 'after' ? 1 : 0)]!.push(candidate);
      continue;
    }
    const candidateTime = timelineTime(candidate.createdAt);
    const nextIndex = exact.findIndex((part) => candidateTime < timelineTime(part.createdAt));
    gaps[nextIndex < 0 ? exact.length : nextIndex]!.push(candidate);
  }

  const sequenced: AiAgentSessionPart[] = [];
  for (let gapIndex = 0; gapIndex < gaps.length; gapIndex += 1) {
    const gap = gaps[gapIndex]!.sort(compareLegacy);
    if (!gap.length) continue;
    const previous = exact[gapIndex - 1];
    const next = exact[gapIndex];
    for (let index = 0; index < gap.length; index += 1) {
      let sequence: number;
      if (!previous && next) {
        sequence = Math.min(next.sequence, 0) - gap.length + index;
      } else if (previous && next) {
        sequence = previous.sequence
          + ((next.sequence - previous.sequence) * (index + 1)) / (gap.length + 1);
      } else if (previous) {
        sequence = previous.sequence + (index + 1) / (gap.length + 1);
      } else {
        sequence = index - gap.length;
      }
      sequenced.push({ ...gap[index]!.part, sequence } as AiAgentSessionPart);
    }
  }
  return sequenced;
}

function timelineTime(value: string): number {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}
