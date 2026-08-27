import { streamText, stepCountIs } from 'ai';
import { MockLanguageModelV3, simulateReadableStream } from 'ai/test';
import { describe, expect, it, vi } from 'vitest';
import {
  AiAgentSessionUseCase,
  classifyAgentStreamTerminal,
  isHandlerManagedTool,
  parseToolResultPart,
  shouldBroadcastOuterToolEvent
} from '../AiAgentSessionUseCase.js';
import type { AiAgentInfo } from '../agents.js';
import { taskTool } from '../tools/task.js';
import { buildWorkflowTools } from '../tools/buildTools.js';
import { mutationTools } from '../tools/mutations.js';
import type { PrismaClient } from '@prisma/client';

const agents: AiAgentInfo[] = [{
  name: 'general', description: 'General worker', mode: 'subagent', runtimeRole: 'creator'
}];

describe('AI SDK stream protocol integration', () => {
  it('propagates exact provider IDs for parallel same-name calls and exposes one call/result pair each', async () => {
    const invocations: Array<{ id: string; description: string }> = [];
    const order: string[] = [];
    const handler = vi.fn(async (input: { description: string }, toolCallId: string) => {
      order.push(`execute:${toolCallId}`);
      invocations.push({ id: toolCallId, description: input.description });
      return { task_id: `child-${toolCallId}`, output: input.description };
    });
    const model = modelWithChunks([
      { type: 'stream-start', warnings: [] },
      { type: 'tool-call', toolCallId: 'provider-call-a', toolName: 'task', input: JSON.stringify({ description: 'First', objective: 'First objective', subagent_type: 'general' }) },
      { type: 'tool-call', toolCallId: 'provider-call-b', toolName: 'task', input: JSON.stringify({ description: 'Second', objective: 'Second objective', subagent_type: 'general' }) },
      finish('tool-calls')
    ]);
    const result = streamText({
      model,
      messages: [{ role: 'user', content: 'Delegate both.' }],
      tools: { task: taskTool(agents, { handleTask: handler }) },
      stopWhen: stepCountIs(1)
    });
    const parts: Array<{ type: string; toolCallId?: string }> = [];
    for await (const part of result.fullStream) {
      const streamed = part as { type: string; toolCallId?: string };
      parts.push(streamed);
      order.push(`stream:${streamed.type}:${streamed.toolCallId ?? ''}`);
    }

    expect(invocations).toEqual(expect.arrayContaining([
      { id: 'provider-call-a', description: 'First' },
      { id: 'provider-call-b', description: 'Second' }
    ]));
    expect(new Set(invocations.map((invocation) => invocation.id)).size).toBe(2);
    expect(parts.filter((part) => part.type === 'tool-call').map((part) => part.toolCallId).sort()).toEqual([
      'provider-call-a', 'provider-call-b'
    ]);
    expect(parts.filter((part) => part.type === 'tool-result').map((part) => part.toolCallId).sort()).toEqual([
      'provider-call-a', 'provider-call-b'
    ]);
    expect(order.indexOf('execute:provider-call-a')).toBeLessThan(order.indexOf('stream:tool-call:provider-call-a'));
    expect(order.indexOf('execute:provider-call-b')).toBeLessThan(order.indexOf('stream:tool-call:provider-call-b'));
  });

  it('keeps parallel same-name mutation approvals distinct by provider invocation ID', async () => {
    const approvals: Array<{ title: string; toolCallId: string }> = [];
    const tools = mutationTools(
      {} as PrismaClient,
      { projectId: 'project-1', userId: 'user-1' },
      {
        handleApproval: async (_name, input, _execute, toolCallId) => {
          approvals.push({ title: String((input as { title?: unknown }).title), toolCallId });
          return { approved: true };
        }
      },
      { handleQuestion: async () => ({}) }
    );
    const model = modelWithChunks([
      { type: 'stream-start', warnings: [] },
      { type: 'tool-call', toolCallId: 'chapter-call-a', toolName: 'createChapter', input: JSON.stringify({ title: 'Chapter A' }) },
      { type: 'tool-call', toolCallId: 'chapter-call-b', toolName: 'createChapter', input: JSON.stringify({ title: 'Chapter B' }) },
      finish('tool-calls')
    ]);
    const result = streamText({
      model,
      messages: [{ role: 'user', content: 'Create both chapters.' }],
      tools: { createChapter: tools.createChapter },
      stopWhen: stepCountIs(1)
    });
    for await (const _part of result.fullStream) { /* consume */ }

    expect(approvals).toEqual(expect.arrayContaining([
      { title: 'Chapter A', toolCallId: 'chapter-call-a' },
      { title: 'Chapter B', toolCallId: 'chapter-call-b' }
    ]));
    expect(new Set(approvals.map((approval) => approval.toolCallId)).size).toBe(2);
  });

  it('outer-persists and exposes one ERROR call/result when an invalid task never reaches its handler', async () => {
    const handler = vi.fn(async () => ({ task_id: 'never' }));
    const model = modelWithChunks([
      { type: 'stream-start', warnings: [] },
      { type: 'tool-call', toolCallId: 'invalid-task-call', toolName: 'task', input: JSON.stringify({ description: 'Missing objective', subagent_type: 'general' }) },
      finish('tool-calls')
    ]);
    const result = streamText({
      model,
      messages: [{ role: 'user', content: 'Delegate invalid work.' }],
      tools: { task: taskTool(agents, { handleTask: handler }) },
      stopWhen: stepCountIs(1),
      onError: () => undefined
    });
    const streamed: any[] = [];
    for await (const part of result.fullStream) streamed.push(part);
    expect(handler).not.toHaveBeenCalled();
    const invalidCall = streamed.find((part) => part.type === 'tool-call');
    const invalidResult = streamed.find((part) => part.type === 'tool-error');
    expect(invalidCall).toMatchObject({ toolCallId: 'invalid-task-call', toolName: 'task', invalid: true });
    expect(invalidResult).toMatchObject({ toolCallId: 'invalid-task-call', toolName: 'task' });

    const rows: any[] = [];
    const prisma = outerToolPrisma(rows);
    const useCase = new AiAgentSessionUseCase(prisma as unknown as PrismaClient) as any;
    const evidence: string[] = [];
    const outerOwned = new Set<string>();
    const handlerOwned = isHandlerManagedTool('task') && invalidCall.invalid !== true;
    if (shouldBroadcastOuterToolEvent('task', 'tool-call', handlerOwned)) {
      await useCase.persistToolCall('session', 'prompt', invalidCall);
      outerOwned.add(invalidCall.toolCallId);
      evidence.push('tool-call');
    }
    if (shouldBroadcastOuterToolEvent('task', 'tool-error', !outerOwned.has(invalidResult.toolCallId))) {
      await useCase.persistToolResult('session', invalidResult, true);
      evidence.push('tool-result');
    }

    expect(evidence).toEqual(['tool-call', 'tool-result']);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ toolCallId: 'invalid-task-call', toolName: 'task', status: 'ERROR' });
  });

  it('classifies the generic error part emitted by a real streamText pipeline with its exact message', async () => {
    const model = modelWithChunks([
      { type: 'stream-start', warnings: [] },
      { type: 'error', error: new Error('provider database exploded') }
    ]);
    const result = streamText({ model, messages: [{ role: 'user', content: 'Fail.' }], onError: () => undefined });
    const terminals: Array<{ kind: string; message: string }> = [];
    for await (const part of result.fullStream) {
      const terminal = classifyAgentStreamTerminal(part);
      if (terminal) terminals.push(terminal);
    }
    expect(terminals[0]).toEqual({ kind: 'error', message: 'provider database exploded' });
    expect(terminals.at(-1)).toEqual({ kind: 'error', message: 'Model stream finished with an error' });
  });

  it('defaults agent-started Novel Builds to plan-review and propagates the provider call ID', async () => {
    const approvals: Array<{ input: Record<string, unknown>; toolCallId: string }> = [];
    const tools = buildWorkflowTools(
      {} as PrismaClient,
      { projectId: 'project-1', userId: 'user-1' },
      {
        handleApproval: async (_name, input, _execute, toolCallId) => {
          approvals.push({ input: input as Record<string, unknown>, toolCallId });
          return { pending: true };
        }
      },
      null,
      null
    );
    const model = modelWithChunks([
      { type: 'stream-start', warnings: [] },
      { type: 'tool-call', toolCallId: 'provider-build-start', toolName: 'startNovelBuild', input: JSON.stringify({ idempotencyKey: 'build-start-1', brainstorm: 'A city forgets its maps.' }) },
      finish('tool-calls')
    ]);
    const result = streamText({
      model,
      messages: [{ role: 'user', content: 'Begin the novel build.' }],
      tools: { startNovelBuild: tools.startNovelBuild },
      stopWhen: stepCountIs(1)
    });
    for await (const _part of result.fullStream) { /* consume tool execution */ }

    expect(approvals).toEqual([{
      toolCallId: 'provider-build-start',
      input: expect.objectContaining({ autonomyMode: 'plan-review' })
    }]);
  });

  it('keeps build discovery bounded to summaries instead of returning brainstorms and task graphs', async () => {
    const findMany = vi.fn(async () => [{
      id: 'build-1', objective: 'D'.repeat(600), status: 'PLANNING', _count: { tasks: 29 }
    }]);
    const count = vi.fn(async () => 11);
    const tools = buildWorkflowTools(
      { buildRun: { findMany, count } } as unknown as PrismaClient,
      { projectId: 'project-1', userId: 'user-1' },
      { handleApproval: async () => ({}) },
      null,
      null
    );
    const execute = tools.listBuildRuns.execute as unknown as (input: unknown, options?: unknown) => Promise<unknown>;
    const result = await execute({ page: 2, limit: 5 }, { toolCallId: 'list-builds' });

    expect(result).toMatchObject({
      total: 11, page: 2, limit: 5, nextPage: 3,
      items: [{ id: 'build-1', objectiveTruncated: true, taskCount: 29 }]
    });
    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({
      skip: 5,
      take: 5,
      select: expect.not.objectContaining({ brainstorm: true, tasks: true })
    }));
  });

  it('classifies abort and error finish events as terminal rather than successful completion', () => {
    expect(classifyAgentStreamTerminal({ type: 'abort', reason: 'user cancelled' })).toEqual({
      kind: 'abort', message: 'user cancelled'
    });
    expect(classifyAgentStreamTerminal({ type: 'finish', finishReason: 'error' })).toEqual({
      kind: 'error', message: 'Model stream finished with an error'
    });
  });

  it('observes a real streamText abort as a cancelled terminal event', async () => {
    const controller = new AbortController();
    const model = new MockLanguageModelV3({
      doStream: {
        stream: simulateReadableStream({
          chunks: [
            { type: 'stream-start', warnings: [] },
            { type: 'text-start', id: 'text-1' },
            { type: 'text-delta', id: 'text-1', delta: 'partial' },
            { type: 'text-delta', id: 'text-1', delta: ' should not finish' },
            { type: 'text-end', id: 'text-1' },
            finish('stop')
          ] as any[],
          initialDelayInMs: 0,
          chunkDelayInMs: 10
        })
      }
    });
    const result = streamText({
      model,
      messages: [{ role: 'user', content: 'Cancel.' }],
      abortSignal: controller.signal,
      onError: () => undefined
    });
    const terminals: Array<{ kind: string; message: string }> = [];
    for await (const part of result.fullStream) {
      if (part.type === 'text-delta') controller.abort('test cancellation');
      const terminal = classifyAgentStreamTerminal(part);
      if (terminal) terminals.push(terminal);
    }
    expect(terminals.some((terminal) => terminal.kind === 'abort')).toBe(true);
  });

  it('preserves exact SDK tool errors and denial terminal messages', () => {
    expect(parseToolResultPart({ type: 'tool-output-error', toolCallId: 'a', errorText: 'database exploded' }))
      .toMatchObject({ toolCallId: 'a', error: 'database exploded' });
    expect(parseToolResultPart({ type: 'tool-error', toolCallId: 'b', error: new Error('worker failed') }))
      .toMatchObject({ toolCallId: 'b', error: 'worker failed' });
    expect(parseToolResultPart({ type: 'tool-output-denied', toolCallId: 'c' }))
      .toMatchObject({ toolCallId: 'c', error: 'Tool output was denied' });
  });
});

function modelWithChunks(chunks: unknown[]) {
  return new MockLanguageModelV3({
    doStream: {
      stream: simulateReadableStream({ chunks: chunks as any[], initialDelayInMs: null, chunkDelayInMs: null })
    }
  });
}

function finish(reason: 'stop' | 'tool-calls' | 'error') {
  return {
    type: 'finish',
    finishReason: { unified: reason, raw: undefined },
    usage: {
      inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 },
      outputTokens: { total: 1, text: 1, reasoning: 0 }
    }
  };
}

function outerToolPrisma(rows: any[]) {
  return {
    aiAgentToolCall: {
      findFirst: vi.fn(async ({ where }: { where: Record<string, unknown> }) => rows.find((row) =>
        row.sessionId === where.sessionId && row.toolCallId === where.toolCallId
      ) ?? null),
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        const row = {
          id: `row-${rows.length + 1}`, output: null, error: null, decidedAt: null, decidedById: null,
          createdAt: new Date('2026-08-26T00:00:00.000Z'), ...data
        };
        rows.push(row);
        return row;
      }),
      update: vi.fn(async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
        const row = rows.find((candidate) => candidate.id === where.id);
        Object.assign(row, data);
        return row;
      })
    }
  };
}
