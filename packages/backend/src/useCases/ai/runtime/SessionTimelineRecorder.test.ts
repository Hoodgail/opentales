import type { PrismaClient } from '@prisma/client';
import type { AiAgentMessage, AiAgentToolCall } from '@opentales/sdk';
import { describe, expect, it, vi } from 'vitest';
import {
  SessionTimelineRecorder,
  buildSessionTimeline,
  buildSessionTimelineProjection,
  type StoredSessionPart
} from './SessionTimelineRecorder.js';

describe('SessionTimelineRecorder', () => {
  it('atomically allocates unique ordered sequences under concurrent appends', async () => {
    const fixture = fakeTimelinePrisma();
    const recorder = new SessionTimelineRecorder(fixture.prisma);
    const parts = await Promise.all(Array.from({ length: 32 }, (_, index) => recorder.task('session-1', 'prompt-1', {
      sessionId: `child-${index}`,
      description: `Task ${index}`,
      subagentType: 'general',
      status: 'running'
    })));

    expect(parts.map((part) => part.sequence).sort((a, b) => a - b)).toEqual(
      Array.from({ length: 32 }, (_, index) => index + 1)
    );
    expect(new Set(parts.map((part) => part.id)).size).toBe(32);
    expect(fixture.increment).toHaveBeenCalledTimes(32);
    expect(fixture.increment).toHaveBeenCalledWith(
      expect.objectContaining({ data: { nextPartSequence: { increment: 1 } } })
    );
  });

  it('coalesces contiguous text, deduplicates repeated SDK tool-call events, and splits text at the tool boundary', async () => {
    const fixture = fakeTimelinePrisma();
    const recorder = new SessionTimelineRecorder(fixture.prisma);
    let firstText = await recorder.text('session-1', 'prompt-1', 'assistant-1', 'Before');
    firstText = await recorder.updateText(firstText.id, 'Before the tool.', true);
    firstText = await recorder.finishText(firstText);
    const call = await recorder.tool('session-1', 'prompt-1', 'tool-call', 'tool-db-1');
    const duplicateCall = await recorder.tool('session-1', 'prompt-1', 'tool-call', 'tool-db-1');
    await recorder.tool('session-1', 'prompt-1', 'tool-result', 'tool-db-1');
    let secondText = await recorder.text('session-1', 'prompt-1', 'assistant-1', 'After');
    secondText = await recorder.updateText(secondText.id, 'After the tool.', false);

    expect(duplicateCall.id).toBe(call.id);
    expect(fixture.parts.filter((part) => part.kind === 'tool-call')).toHaveLength(1);

    const timeline = buildSessionTimeline(
      fixture.parts,
      [message('assistant-1', 'assistant', 'Before the tool.After the tool.', 1)],
      [toolCall('tool-db-1', 'provider-call-1', 'executed', 2)]
    );
    expect(timeline.map((part) => part.kind)).toEqual(['text', 'tool-call', 'tool-result', 'text']);
    expect(timeline.filter((part) => part.kind === 'text').map((part) => part.content)).toEqual([
      'Before the tool.',
      'After the tool.'
    ]);
    expect(timeline.map((part) => part.sequence)).toEqual([1, 2, 3, 4]);
  });

  it('keeps uncovered pre-migration history before newly persisted parts', async () => {
    const fixture = fakeTimelinePrisma();
    const recorder = new SessionTimelineRecorder(fixture.prisma);
    let current = await recorder.text('session-1', 'prompt-new', 'assistant-new', 'New turn');
    current = await recorder.finishText(current);
    const messages = [
      message('user-old', 'user', 'Old request', 1),
      message('assistant-old', 'assistant', 'Old response', 2),
      message('assistant-new', 'assistant', 'New turn', 10)
    ];
    const oldTool = toolCall('tool-old', 'provider-old', 'executed', 3);

    const projection = buildSessionTimelineProjection(fixture.parts, messages, [oldTool]);
    const timeline = projection.timeline;
    expect(timeline.map((part) => part.id)).toEqual([
      'legacy-message-user-old',
      'legacy-message-assistant-old',
      'legacy-tool-call-tool-old',
      'legacy-tool-result-tool-old',
      current.id
    ]);
    expect(timeline.slice(0, 4).every((part) => part.sequence < 0)).toBe(true);
    expect(timeline.at(-1)?.sequence).toBe(1);
    expect(projection.timelineInfo).toEqual({
      mode: 'mixed',
      truncated: false,
      earliestSequence: timeline[0]!.sequence,
      hasMoreBefore: false
    });
  });

  it('tracks tool-call and tool-result coverage independently', async () => {
    const fixture = fakeTimelinePrisma();
    const recorder = new SessionTimelineRecorder(fixture.prisma);
    const firstTool = toolCall('tool-first', 'provider-first', 'executed', 2);
    const secondTool = toolCall('tool-second', 'provider-second', 'executed', 3);
    const persistedCall = await recorder.tool('session-1', 'prompt-1', 'tool-call', firstTool.id);
    const persistedResult = await recorder.tool('session-1', 'prompt-1', 'tool-result', secondTool.id);

    const projection = buildSessionTimelineProjection(
      fixture.parts,
      [],
      [firstTool, secondTool]
    );

    expect(projection.timeline.map((part) => [part.kind, part.kind === 'tool-call' || part.kind === 'tool-result' ? part.toolCall.id : null])).toEqual([
      ['tool-call', firstTool.id],
      ['tool-result', firstTool.id],
      ['tool-call', secondTool.id],
      ['tool-result', secondTool.id]
    ]);
    expect(projection.timeline.find((part) => part.id === persistedCall.id)?.sequence).toBe(1);
    expect(projection.timeline.find((part) => part.id === persistedResult.id)?.sequence).toBe(2);
    expect(projection.timelineInfo.mode).toBe('mixed');
  });

  it('labels a fully synthesized legacy timeline as approximate', () => {
    const projection = buildSessionTimelineProjection(
      [],
      [message('legacy-user', 'user', 'Before durable parts', 1)],
      [toolCall('legacy-tool', 'provider-legacy', 'executed', 2)]
    );

    expect(projection.timeline.map((part) => part.kind)).toEqual([
      'message',
      'tool-call',
      'tool-result'
    ]);
    expect(projection.timelineInfo).toEqual({
      mode: 'approximate',
      truncated: false,
      earliestSequence: -3,
      hasMoreBefore: false
    });
  });

  it('does not claim exact history when a durable row cannot be hydrated', () => {
    const now = new Date('2026-08-25T00:00:00.000Z');
    const orphanedToolPart: StoredSessionPart = {
      id: 'part-with-unloaded-tool',
      sessionId: 'session-1',
      promptId: 'prompt-1',
      messageId: null,
      toolCallId: 'tool-not-loaded',
      kind: 'tool-call',
      sequence: 1,
      payload: {},
      createdAt: now,
      updatedAt: now
    };

    expect(buildSessionTimelineProjection([orphanedToolPart], [], []).timelineInfo).toEqual({
      mode: 'approximate',
      truncated: true,
      earliestSequence: null,
      hasMoreBefore: false
    });
  });

  it('bounds histories over 1,000 durable parts and reports the omitted prefix', () => {
    const createdAt = new Date('2026-08-25T00:00:00.000Z');
    const parts = Array.from({ length: 1_001 }, (_, index): StoredSessionPart => ({
      id: `part-${index + 1}`,
      sessionId: 'session-1',
      promptId: 'prompt-1',
      messageId: null,
      toolCallId: null,
      kind: 'task',
      sequence: index + 1,
      payload: {
        sessionId: `child-${index + 1}`,
        description: `Task ${index + 1}`,
        subagentType: 'general',
        status: 'completed'
      },
      createdAt,
      updatedAt: createdAt
    }));

    const projection = buildSessionTimelineProjection(parts, [], []);

    expect(projection.timeline).toHaveLength(1_000);
    expect(projection.timeline[0]).toMatchObject({ id: 'part-2', sequence: 2 });
    expect(projection.timelineInfo).toEqual({
      mode: 'exact',
      truncated: true,
      earliestSequence: 2,
      hasMoreBefore: true
    });
  });

  it('persists observable subtask start and finish lifecycle parts', async () => {
    const fixture = fakeTimelinePrisma();
    const recorder = new SessionTimelineRecorder(fixture.prisma);
    await recorder.task('session-1', 'prompt-1', {
      sessionId: 'child-1', toolCallId: 'provider-task-1', description: 'Inspect outline', subagentType: 'explore', status: 'running'
    });
    await recorder.task('session-1', 'prompt-1', {
      sessionId: 'child-1', toolCallId: 'provider-task-1', description: 'Inspect outline', subagentType: 'explore', status: 'cancelled'
    });
    const timeline = buildSessionTimeline(fixture.parts, [], []);
    expect(timeline).toMatchObject([
      { kind: 'task', task: { sessionId: 'child-1', toolCallId: 'provider-task-1', status: 'running' } },
      { kind: 'task', task: { sessionId: 'child-1', toolCallId: 'provider-task-1', status: 'cancelled' } }
    ]);
  });

  it('bounds parent-timeline subtask output while retaining child-session navigation', () => {
    const now = new Date('2026-08-25T00:00:00.000Z');
    const part: StoredSessionPart = {
      id: 'large-task', sessionId: 'parent', promptId: 'prompt', messageId: null, toolCallId: null,
      kind: 'task', sequence: 1, createdAt: now, updatedAt: now,
      payload: {
        sessionId: 'child-large', toolCallId: 'provider-large', description: 'Large result',
        subagentType: 'general', status: 'completed', output: { manuscript: 'x'.repeat(30_000) }
      }
    };

    const timeline = buildSessionTimeline([part], [], []);
    expect(timeline[0]).toMatchObject({
      kind: 'task',
      task: {
        sessionId: 'child-large', toolCallId: 'provider-large',
        outputTruncated: true, outputBytes: expect.any(Number),
        output: { type: 'opentales.truncatedTaskOutput' }
      }
    });
  });
});

function fakeTimelinePrisma() {
  let sequence = 0;
  let id = 0;
  let clock = 0;
  const parts: StoredSessionPart[] = [];
  const increment = vi.fn(async () => ({ nextPartSequence: ++sequence }));
  const client = {
    $transaction: async (callback: (tx: unknown) => unknown) => callback(client),
    projectAiAgentSession: { update: increment },
    aiAgentSessionPart: {
      create: async ({ data }: { data: Omit<StoredSessionPart, 'id' | 'createdAt' | 'updatedAt'> }) => {
        const createdAt = new Date(Date.UTC(2026, 7, 26, 0, 0, ++clock));
        const part = { ...data, id: `part-${++id}`, createdAt, updatedAt: createdAt } as StoredSessionPart;
        parts.push(part);
        return part;
      },
      update: async ({ where, data }: { where: { id: string }; data: { payload: StoredSessionPart['payload'] } }) => {
        const index = parts.findIndex((part) => part.id === where.id);
        const updatedAt = new Date(Date.UTC(2026, 7, 26, 0, 0, ++clock));
        parts[index] = { ...parts[index]!, payload: data.payload, updatedAt };
        return parts[index]!;
      },
      findFirst: async ({ where }: { where: Partial<StoredSessionPart> }) => parts.find((part) =>
        Object.entries(where).every(([key, value]) => part[key as keyof StoredSessionPart] === value)
      ) ?? null,
      findFirstOrThrow: async ({ where }: { where: Partial<StoredSessionPart> }) => {
        const part = parts.find((candidate) => Object.entries(where).every(([key, value]) => candidate[key as keyof StoredSessionPart] === value));
        if (!part) throw new Error('Part not found');
        return part;
      }
    }
  };
  return { prisma: client as unknown as PrismaClient, parts, increment };
}

function message(id: string, role: AiAgentMessage['role'], content: string, second: number): AiAgentMessage {
  return { id, role, content, createdAt: new Date(Date.UTC(2026, 7, 25, 0, 0, second)).toISOString() };
}

function toolCall(
  id: string,
  providerId: string,
  status: AiAgentToolCall['status'],
  second: number
): AiAgentToolCall {
  const createdAt = new Date(Date.UTC(2026, 7, 25, 0, 0, second)).toISOString();
  return {
    id,
    toolCallId: providerId,
    toolName: 'readProject',
    input: {},
    status,
    output: status === 'executed' ? { ok: true } : null,
    error: null,
    createdAt,
    decidedAt: status === 'executed' ? createdAt : null
  };
}
