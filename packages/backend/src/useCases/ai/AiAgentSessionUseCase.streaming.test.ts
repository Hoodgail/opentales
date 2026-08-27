import type { PrismaClient } from '@prisma/client';
import { describe, expect, it, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import {
  AiAgentSessionUseCase,
  assertNoInteractiveBuildArtifactDelegation,
  hasUncoveredTruncatedCompatibility,
  projectToolInput,
  projectToolOutput,
  shouldBroadcastOuterToolEvent,
  toToolCall
} from './AiAgentSessionUseCase.js';
import type { AiAgentInfo } from './agents.js';
import type { StoredSessionPart } from './runtime/SessionTimelineRecorder.js';
import { normalizeTaskContract } from './runtime/taskContract.js';

describe('AiAgentSessionUseCase stream persistence', () => {
  it('rejects generic subagent delegation of persisted Novel Build artifacts', () => {
    const base = normalizeTaskContract({
      description: 'Create brief',
      objective: 'Create the build story brief',
      subagent_type: 'general'
    });
    const contract = {
      ...base,
      outputs: [{ type: 'story-brief', name: 'Story Brief', schemaVersion: 1 }],
      scope: { ...base.scope, buildRunId: 'build-1' }
    };
    expect(() => assertNoInteractiveBuildArtifactDelegation(contract)).toThrow(/durable worker/);
    expect(() => assertNoInteractiveBuildArtifactDelegation({
      ...contract,
      scope: { ...contract.scope, buildTaskId: 'task-1' }
    })).toThrow(/durable worker/);
    expect(() => assertNoInteractiveBuildArtifactDelegation({
      ...contract,
      outputs: [{ type: 'task-result', name: 'Analysis only', schemaVersion: 1 }]
    })).not.toThrow();
  });

  it('requires project-admin authority to enable Auto mode and persists it on an idle session', async () => {
    const update = vi.fn(async () => ({}));
    const permission = vi.fn(async () => undefined);
    const useCase = new AiAgentSessionUseCase({
      projectAiAgentSession: {
        findFirst: vi.fn(async () => ({ id: 'session-mode', projectId: 'project-1', status: 'IDLE' })),
        update
      },
      aiAgentPrompt: { count: vi.fn(async () => 0) }
    } as unknown as PrismaClient) as any;
    useCase.access = { assertPermission: permission };
    useCase.snapshot = vi.fn(async () => ({ ...sessionSnapshot('session-mode'), approvalMode: 'auto' }));
    useCase.broadcast = vi.fn(async () => undefined);

    const result = await useCase.update(
      'user-1', 'project-1', 'session-mode', { approvalMode: 'auto' }
    );

    expect(result.approvalMode).toBe('auto');
    expect(permission).toHaveBeenCalledWith('user-1', 'project-1', 'project:admin');
    expect(update).toHaveBeenCalledWith({
      where: { id: 'session-mode' }, data: { approvalMode: 'AUTO' }
    });
  });

  it('executes mutation tools immediately in Auto mode without creating an approval waiter', async () => {
    const tool = row({
      id: 'auto-call', sessionId: 'auto-session', promptId: 'auto-prompt',
      toolCallId: 'provider-auto', toolName: 'createChapter', status: 'RUNNING'
    });
    const useCase = new AiAgentSessionUseCase({} as PrismaClient) as any;
    useCase.createProviderToolCall = vi.fn(async () => tool);
    useCase.ensureToolTimelinePart = vi.fn(async () => storedPart({
      id: 'auto-call-part', sessionId: 'auto-session', promptId: 'auto-prompt',
      toolCallId: tool.id, kind: 'tool-call'
    }));
    useCase.hydrateSinglePart = vi.fn(async () => null);
    useCase.snapshot = vi.fn(async () => sessionSnapshot('auto-session'));
    useCase.broadcast = vi.fn(async () => undefined);
    useCase.finalizeHandlerToolCall = vi.fn(async () => undefined);
    const execute = vi.fn(async () => ({ id: 'chapter-1' }));

    await expect(useCase.handleApproval(
      'auto-session', 'auto-prompt', 'project-1', 'createChapter',
      { title: 'Immediate chapter' }, execute, 'provider-auto', undefined, 'auto'
    )).resolves.toEqual({ id: 'chapter-1' });

    expect(execute).toHaveBeenCalledOnce();
    expect(useCase.finalizeHandlerToolCall).toHaveBeenCalledWith(
      tool, 'project-1', 'EXECUTED', { id: 'chapter-1' }, null
    );
    expect(useCase.broadcast).toHaveBeenCalledTimes(1);
  });

  it('bounds snapshot tool output while preserving an explicit full-detail projection', () => {
    const value = { manuscript: 'x'.repeat(30_000) };
    expect(projectToolOutput(value, false)).toMatchObject({ truncated: true, bytes: expect.any(Number) });
    expect(projectToolOutput(value, true)).toEqual({ output: value, truncated: false, bytes: expect.any(Number) });
    expect(projectToolInput(value, false)).toMatchObject({ truncated: true, bytes: expect.any(Number) });
    expect(projectToolInput(value, true)).toEqual({ value, truncated: false, bytes: expect.any(Number) });
    const pending = toToolCall(row({ input: value, status: 'PENDING_APPROVAL' }) as any);
    expect(pending).toMatchObject({ status: 'pending-approval', inputTruncated: true, inputBytes: expect.any(Number) });
  });

  it('infers only resumable build states while still honoring an explicit historical ID', async () => {
    const findFirst = vi.fn(async ({ where }: { where: Record<string, unknown> }) =>
      where.id === 'failed-explicit' ? { id: 'failed-explicit' } : null
    );
    const useCase = new AiAgentSessionUseCase({ buildRun: { findFirst } } as unknown as PrismaClient) as any;

    await expect(useCase.validateRequestedBuildRun('project', undefined)).resolves.toBeNull();
    expect(findFirst).toHaveBeenNthCalledWith(1, expect.objectContaining({
      where: expect.objectContaining({ status: { in: ['PLANNING', 'DRAFTING', 'REVISING', 'PAUSED'] } })
    }));
    await expect(useCase.validateRequestedBuildRun('project', 'failed-explicit')).resolves.toBe('failed-explicit');
  });

  it('pages durable timeline parts strictly before a sequence cursor', async () => {
    const parts = [9, 8, 7].map((sequence) => storedPart({
      id: `page-${sequence}`, sequence, kind: 'task',
      payload: {
        sessionId: `child-${sequence}`, description: `Task ${sequence}`,
        subagentType: 'general', status: 'completed'
      }
    }));
    const findMany = vi.fn(async () => parts);
    const useCase = new AiAgentSessionUseCase({
      aiAgentSessionPart: { findMany }
    } as unknown as PrismaClient) as any;
    useCase.access.assertProjectAccess = vi.fn(async () => undefined);
    useCase.getSession = vi.fn(async () => ({ id: 'timeline-session' }));
    useCase.recoverOrphanedInteractiveSession = vi.fn(async () => false);

    const page = await useCase.getTimeline(
      'user', 'project', { beforeSequence: 10, limit: 2 }, 'timeline-session'
    );

    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { sessionId: 'timeline-session', sequence: { lt: 10 } },
      orderBy: { sequence: 'desc' },
      take: 3
    }));
    expect(page.parts.map((part: { sequence: number }) => part.sequence)).toEqual([8, 9]);
    expect(page).toMatchObject({ hasMore: true, nextBeforeSequence: 8 });
  });

  it('marks mixed history truncated when 201 uncovered legacy tools precede a durable part', () => {
    const durable = storedPart({ id: 'durable', kind: 'text', messageId: 'new-message', sequence: 1 });
    const legacyTools = Array.from({ length: 200 }, (_, index) => ({
      id: `legacy-tool-${index}`, status: 'EXECUTED'
    }));
    expect(hasUncoveredTruncatedCompatibility([durable], [], legacyTools, false, true)).toBe(true);

    const coveredParts = legacyTools.flatMap((tool, index) => [
      storedPart({ id: `call-${index}`, kind: 'tool-call', toolCallId: tool.id, sequence: index * 2 + 1 }),
      storedPart({ id: `result-${index}`, kind: 'tool-result', toolCallId: tool.id, sequence: index * 2 + 2 })
    ]);
    expect(hasUncoveredTruncatedCompatibility(coveredParts, [], legacyTools, false, true)).toBe(false);
  });

  it('advances through more than 200 pure-legacy records with a non-null opaque cursor', async () => {
    const rows = Array.from({ length: 205 }, (_, index) => ({
      id: `legacy-${String(index).padStart(3, '0')}`,
      sessionId: 'legacy-session',
      role: 'USER' as const,
      content: `Legacy ${index}`,
      createdAt: new Date(Date.UTC(2026, 0, 1, 0, 0, index))
    })).sort((left, right) => right.createdAt.getTime() - left.createdAt.getTime() || right.id.localeCompare(left.id));
    const findMessages = vi.fn(async ({ where, take }: { where: any; take: number }) => {
      const date = where.OR?.[0]?.createdAt?.lt as Date | undefined;
      const tieId = where.OR?.[1]?.id?.lt as string | undefined;
      return rows.filter((row) => !date
        || row.createdAt < date
        || (row.createdAt.getTime() === date.getTime() && Boolean(tieId) && row.id < tieId!))
        .slice(0, take);
    });
    const useCase = new AiAgentSessionUseCase({
      aiAgentMessage: { findMany: findMessages },
      aiAgentToolCall: { findMany: vi.fn(async () => []) }
    } as unknown as PrismaClient) as any;
    const ids = new Set<string>();
    const sequences = new Set<number>();
    let cursor: string | undefined;
    let beforeSequence: number | undefined;
    let previousEarliest = Number.POSITIVE_INFINITY;
    let pages = 0;
    do {
      const page = await useCase.legacyTimelinePage('legacy-session', beforeSequence, 10, cursor);
      pages += 1;
      if (page.parts.length) {
        expect(Math.max(...page.parts.map((part: { sequence: number }) => part.sequence))).toBeLessThan(previousEarliest);
        previousEarliest = Math.min(...page.parts.map((part: { sequence: number }) => part.sequence));
      }
      for (const part of page.parts) {
        expect(sequences.has(part.sequence)).toBe(false);
        sequences.add(part.sequence);
        if (part.kind === 'message') ids.add(part.message.id);
      }
      if (page.hasMore) {
        expect(page.nextBeforeSequence).toBe(page.parts[0]?.sequence);
        expect(page.nextLegacyCursor).toEqual(expect.any(String));
      }
      cursor = page.nextLegacyCursor ?? undefined;
      beforeSequence = page.nextBeforeSequence ?? undefined;
      if (!page.hasMore) break;
    } while (pages < 50);

    expect(pages).toBeGreaterThan(20);
    expect(ids.size).toBe(205);
    expect(sequences.size).toBe(205);
    expect(cursor).toBeUndefined();
  });

  it('keeps a legacy executed tool call/result indivisible when limit is one', async () => {
    const executed = row({
      id: 'legacy-executed', sessionId: 'legacy-tool-session', toolCallId: 'provider-legacy',
      toolName: 'readProject', status: 'EXECUTED', output: { ok: true },
      decidedAt: new Date('2026-08-26T00:00:01.000Z')
    });
    const useCase = new AiAgentSessionUseCase({
      aiAgentMessage: { findMany: vi.fn(async () => []) },
      aiAgentToolCall: { findMany: vi.fn(async () => [executed]) }
    } as unknown as PrismaClient) as any;

    const page = await useCase.legacyTimelinePage('legacy-tool-session', undefined, 1);

    expect(page.parts.map((part: { kind: string }) => part.kind)).toEqual(['tool-call', 'tool-result']);
    expect(page.hasMore).toBe(false);
    expect(page.nextBeforeSequence).toBeNull();
    expect(page.nextLegacyCursor).toBeNull();
  });

  it('deduplicates repeated SDK call events and keeps a call running until output', async () => {
    const rows: ToolRow[] = [];
    const prisma = toolPrisma(rows);
    const useCase = new AiAgentSessionUseCase(prisma as unknown as PrismaClient) as unknown as {
      persistToolCall(sessionId: string, promptId: string, part: unknown): Promise<unknown>;
    };

    await useCase.persistToolCall('session-a', 'prompt-a', {
      type: 'tool-input-available', toolCallId: 'provider-shared', toolName: 'readProject', input: {}
    });
    await useCase.persistToolCall('session-a', 'prompt-a', {
      type: 'tool-call', toolCallId: 'provider-shared', toolName: 'readProject', input: {}
    });

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ sessionId: 'session-a', status: 'RUNNING', output: null });
  });

  it('updates a reused provider toolCallId only inside the originating session', async () => {
    const rows: ToolRow[] = [
      row({ id: 'call-a', sessionId: 'session-a', toolCallId: 'provider-shared' }),
      row({ id: 'call-b', sessionId: 'session-b', toolCallId: 'provider-shared' })
    ];
    const prisma = toolPrisma(rows);
    const useCase = new AiAgentSessionUseCase(prisma as unknown as PrismaClient) as unknown as {
      persistToolResult(sessionId: string, part: unknown): Promise<unknown>;
    };

    await useCase.persistToolResult('session-a', {
      type: 'tool-output-available', toolCallId: 'provider-shared', output: { projectId: 'project-a' }
    });

    expect(rows.find((item) => item.id === 'call-a')).toMatchObject({
      status: 'EXECUTED', output: { projectId: 'project-a' }
    });
    expect(rows.find((item) => item.id === 'call-b')).toMatchObject({ status: 'RUNNING', output: null });
    expect(prisma.aiAgentToolCall.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: { sessionId: 'session-a', toolCallId: 'provider-shared' }
    }));
  });

  it('inherits the active build into a delegated contract and emits parent task lifecycle events', async () => {
    const broadcasts: Array<{ type: string; data?: unknown }> = [];
    const promptCreate = vi.fn(async ({ data }: { data: Record<string, unknown> }) => ({ id: 'child-prompt', ...data }));
    const childSessionUpdate = vi.fn(async () => ({}));
    const prisma = {
      buildRun: { findFirst: vi.fn(async () => ({ id: 'build-1' })) },
      projectAiAgentSession: {
        update: childSessionUpdate,
        findUniqueOrThrow: vi.fn(async () => ({ id: 'child-session', status: 'IDLE', lastError: null }))
      },
      aiAgentPrompt: {
        findFirst: vi.fn(async () => null),
        create: promptCreate,
        findUniqueOrThrow: vi.fn(async () => ({ id: 'child-prompt', status: 'COMPLETED' }))
      },
      aiAgentMessage: { findFirst: vi.fn(async () => ({ content: 'Subtask complete.' })) }
    };
    const useCase = new AiAgentSessionUseCase(prisma as unknown as PrismaClient) as any;
    useCase.getSession = vi.fn(async () => ({ id: 'child-session', projectId: 'project-1' }));
    useCase.drain = vi.fn(async () => undefined);
    useCase.snapshot = vi.fn(async (sessionId: string) => sessionSnapshot(sessionId));
    useCase.broadcast = vi.fn(async (_projectId: string, event: { type: string; data?: unknown }) => {
      broadcasts.push(event);
    });
    useCase.createProviderToolCall = vi.fn(async () => row({
      id: 'parent-task-call', sessionId: 'parent-session', promptId: 'parent-prompt',
      toolCallId: 'provider-task-1', toolName: 'task', status: 'RUNNING'
    }));
    useCase.ensureToolTimelinePart = vi.fn(async (_sessionId: string, promptId: string, kind: string) => storedPart({
      id: `${kind}-part`, sequence: kind === 'tool-call' ? 1 : 4, promptId, kind, toolCallId: 'parent-task-call'
    }));
    useCase.finalizeHandlerToolCall = vi.fn(async () => {
      broadcasts.push({ type: 'tool-result', data: { toolCallId: 'provider-task-1' } });
    });
    let sequence = 0;
    useCase.createTaskPart = vi.fn(async (_sessionId: string, promptId: string, task: Record<string, unknown>) => storedPart({
      id: `task-part-${++sequence}`, sequence, promptId, kind: 'task', payload: JSON.parse(JSON.stringify(task))
    }));
    useCase.hydrateSinglePart = vi.fn(async (part: StoredSessionPart) => ({
      id: part.id,
      sequence: part.sequence,
      promptId: part.promptId,
      kind: 'task',
      task: part.payload,
      createdAt: part.createdAt.toISOString(),
      updatedAt: part.updatedAt.toISOString()
    }));
    const agents: AiAgentInfo[] = [{
      name: 'general', description: 'General worker', mode: 'subagent', runtimeRole: 'creator'
    }];

    const result = await useCase.handleTask(
      'project-1',
      'parent-session',
      'parent-prompt',
      'user-1',
      { description: 'Initialize planning', objective: 'Plan the novel', subagent_type: 'general', task_id: 'child-session' },
      agents,
      undefined,
      null,
      'build-1',
      'provider-task-1',
      undefined,
      'auto'
    );

    expect(result).toMatchObject({ task_id: 'child-session' });
    expect(broadcasts.map((event) => event.type)).toEqual(['tool-call', 'subtask-started', 'subtask-finished', 'tool-result']);
    expect(broadcasts.filter((event) => event.type === 'tool-call')).toHaveLength(1);
    expect(broadcasts.filter((event) => event.type === 'tool-result')).toHaveLength(1);
    const forcedOuterFirst = ['tool-call', 'tool-result'].filter((eventType) =>
      shouldBroadcastOuterToolEvent('task', eventType, true)
    );
    expect(forcedOuterFirst).toEqual([]);
    expect(shouldBroadcastOuterToolEvent('task', 'tool-input-error')).toBe(true);
    expect(shouldBroadcastOuterToolEvent('task', 'tool-call', false)).toBe(true);
    expect((broadcasts[1]?.data as { part: { task: { status: string } } }).part.task.status).toBe('running');
    expect((broadcasts[2]?.data as { part: { task: { status: string } } }).part.task.status).toBe('completed');
    const persistedPayload = JSON.parse(promptCreate.mock.calls[0]![0].data.prompt as string) as {
      buildRunId: string;
      approvalMode: string;
      taskContract: { scope: { buildRunId: string } };
    };
    expect(persistedPayload.buildRunId).toBe('build-1');
    expect(persistedPayload.approvalMode).toBe('auto');
    expect(persistedPayload.taskContract.scope.buildRunId).toBe('build-1');
    expect(childSessionUpdate).toHaveBeenCalledWith(expect.objectContaining({
      data: { activeBuildRunId: 'build-1', approvalMode: 'AUTO' }
    }));
  });

  it('binds a newly approved Novel Build to the active session', async () => {
    const sessionUpdate = vi.fn(async (args: unknown) => args);
    const tool = row({
      id: 'approval-1',
      sessionId: 'session-a',
      promptId: 'prompt-a',
      toolCallId: null,
      toolName: 'startNovelBuild',
      status: 'PENDING_APPROVAL'
    });
    const prisma = {
      buildRun: { findFirst: vi.fn(async () => ({ id: 'build-new' })) },
      projectAiAgentSession: { update: sessionUpdate },
      aiAgentToolCall: {
        update: vi.fn(async ({ data }: { data: Partial<ToolRow> }) => Object.assign(tool, data)),
        updateMany: vi.fn(async ({ data }: { data: Partial<ToolRow> }) => {
          Object.assign(tool, data);
          return { count: 1 };
        }),
        findFirst: vi.fn(async () => null),
        findUniqueOrThrow: vi.fn(async () => tool),
        create: vi.fn(async () => tool)
      },
      aiAgentMessage: {
        create: vi.fn(async ({ data }: { data: { sessionId: string; role: ToolRow['status']; content: string } }) => ({
          id: 'tool-message', ...data, createdAt: new Date()
        }))
      }
    };
    const useCase = new AiAgentSessionUseCase(prisma as unknown as PrismaClient) as any;
    useCase.createProviderToolCall = vi.fn(async () => tool);
    useCase.ensureToolTimelinePart = vi.fn(async (_sessionId: string, promptId: string, kind: string) => storedPart({
      id: `${kind}-part`, sequence: kind === 'tool-call' ? 1 : 2, promptId, kind, toolCallId: tool.id
    }));
    useCase.createMessagePart = vi.fn(async () => storedPart({ id: 'message-part', sequence: 3, kind: 'message' }));
    useCase.hydrateSinglePart = vi.fn(async () => null);
    useCase.snapshot = vi.fn(async () => sessionSnapshot('session-a'));
    useCase.broadcast = vi.fn(async () => undefined);

    const execution = useCase.handleApproval(
      'session-a',
      'prompt-a',
      'project-a',
      'startNovelBuild',
      { idempotencyKey: 'start-1', brainstorm: 'A city forgets its maps.' },
      async () => ({ id: 'build-new', projectId: 'project-a' })
    );
    await vi.waitFor(() => expect(useCase.broadcast).toHaveBeenCalled());
    await useCase.applyToolCallApproval('user-a', 'project-a', 'session-a', tool, true);

    await expect(execution).resolves.toMatchObject({ id: 'build-new' });
    expect(sessionUpdate).toHaveBeenCalledWith({
      where: { id: 'session-a' },
      data: { activeBuildRunId: 'build-new' }
    });
    expect(tool.status).toBe('EXECUTED');
  });

  it('uses an atomic approval CAS so concurrent approvals execute exactly once', async () => {
    const tool = row({
      id: 'approval-cas', sessionId: 'session-cas', promptId: 'prompt-cas',
      toolCallId: 'provider-cas', toolName: 'createChapter', status: 'PENDING_APPROVAL'
    });
    const execute = vi.fn(async () => ({ id: 'chapter-1' }));
    const prisma = {
      aiAgentToolCall: {
        updateMany: vi.fn(async ({ where, data }: { where: { status?: ToolRow['status'] }; data: Partial<ToolRow> }) => {
          if (where.status && tool.status !== where.status) return { count: 0 };
          Object.assign(tool, data);
          return { count: 1 };
        }),
        update: vi.fn(async ({ data }: { data: Partial<ToolRow> }) => Object.assign(tool, data)),
        findUniqueOrThrow: vi.fn(async () => tool)
      },
      aiAgentMessage: { create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => ({ id: 'tool-message', ...data, createdAt: new Date() })) }
    };
    const useCase = new AiAgentSessionUseCase(prisma as unknown as PrismaClient) as any;
    useCase.createProviderToolCall = vi.fn(async () => tool);
    useCase.ensureToolTimelinePart = vi.fn(async (_sessionId: string, promptId: string, kind: string) => storedPart({ id: `${kind}-cas`, promptId, kind, toolCallId: tool.id }));
    useCase.createMessagePart = vi.fn(async () => storedPart({ id: 'message-cas', kind: 'message' }));
    useCase.hydrateSinglePart = vi.fn(async () => null);
    useCase.snapshot = vi.fn(async () => sessionSnapshot('session-cas'));
    useCase.broadcast = vi.fn(async () => undefined);

    const execution = useCase.handleApproval(
      'session-cas', 'prompt-cas', 'project-cas', 'createChapter', { title: 'Only once' }, execute, 'provider-cas'
    );
    await vi.waitFor(() => expect(useCase.broadcast).toHaveBeenCalled());
    const decisions = await Promise.allSettled([
      useCase.applyToolCallApproval('user-a', 'project-cas', 'session-cas', tool, true),
      useCase.applyToolCallApproval('user-a', 'project-cas', 'session-cas', tool, true)
    ]);

    expect(decisions.filter((decision) => decision.status === 'fulfilled')).toHaveLength(1);
    expect(decisions.filter((decision) => decision.status === 'rejected')).toHaveLength(1);
    await expect(execution).resolves.toEqual({ id: 'chapter-1' });
    expect(execute).toHaveBeenCalledTimes(1);
    expect(tool.status).toBe('EXECUTED');
  });

  it('marks an orphan RUNNING prompt actionable after restart instead of wedging the queue', async () => {
    const promptUpdate = vi.fn(async () => ({ count: 1 }));
    const sessionUpdate = vi.fn(async () => ({ count: 1 }));
    const prisma = {
      projectAiAgentSession: {
        findUniqueOrThrow: vi.fn(async () => ({
          status: 'RUNNING', activePromptId: 'orphan-prompt', lastError: null
        })),
        updateMany: sessionUpdate
      },
      aiAgentPrompt: {
        updateMany: promptUpdate
      },
      aiAgentToolCall: { findMany: vi.fn(async () => []) }
    };
    const useCase = new AiAgentSessionUseCase(prisma as unknown as PrismaClient) as any;
    useCase.access.assertProjectAccess = vi.fn(async () => undefined);
    useCase.getSession = vi.fn(async () => ({ id: 'restart-session', projectId: 'project-restart' }));
    useCase.snapshot = vi.fn(async () => sessionSnapshot('restart-session'));

    const snapshot = await useCase.get('user-restart', 'project-restart', 'restart-session');

    expect(snapshot.id).toBe('restart-session');
    expect(promptUpdate).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ id: 'orphan-prompt', status: 'RUNNING' }),
      data: { status: 'ERROR' }
    }));
    expect(sessionUpdate).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ id: 'restart-session', status: 'RUNNING' }),
      data: expect.objectContaining({ status: 'ERROR', activePromptId: null })
    }));
  });

  it('records a cancelled child as cancelled and never reports partial output completed', async () => {
    const lifecycle: Array<Record<string, unknown>> = [];
    const prisma = {
      projectAiAgentSession: {
        findUniqueOrThrow: vi.fn(async () => ({ status: 'CANCELLED', lastError: null }))
      },
      aiAgentPrompt: {
        findFirst: vi.fn(async () => null),
        create: vi.fn(async () => ({ id: 'cancelled-child-prompt' })),
        findUniqueOrThrow: vi.fn(async () => ({ status: 'CANCELLED' }))
      },
      aiAgentMessage: { findFirst: vi.fn(async () => ({ content: 'Partial, not complete.' })) }
    };
    const useCase = new AiAgentSessionUseCase(prisma as unknown as PrismaClient) as any;
    useCase.resolveActiveBuildRun = vi.fn(async () => null);
    useCase.getSession = vi.fn(async () => ({ id: 'cancelled-child', projectId: 'project-cancelled' }));
    useCase.drain = vi.fn(async () => undefined);
    useCase.createProviderToolCall = vi.fn(async () => row({
      id: 'cancelled-call', sessionId: 'parent-cancelled', promptId: 'parent-prompt',
      toolCallId: 'provider-cancelled', toolName: 'task', status: 'RUNNING'
    }));
    useCase.ensureToolTimelinePart = vi.fn(async (_sessionId: string, promptId: string, kind: string) => storedPart({ id: `${kind}-cancelled`, promptId, kind }));
    useCase.createTaskPart = vi.fn(async (_sessionId: string, promptId: string, task: Record<string, unknown>) => {
      lifecycle.push(task);
      return storedPart({ id: `task-${lifecycle.length}`, promptId, kind: 'task', payload: JSON.parse(JSON.stringify(task)) });
    });
    useCase.hydrateSinglePart = vi.fn(async () => null);
    useCase.snapshot = vi.fn(async () => sessionSnapshot('parent-cancelled'));
    useCase.broadcast = vi.fn(async () => undefined);
    useCase.finalizeHandlerToolCall = vi.fn(async () => undefined);
    const agents: AiAgentInfo[] = [{ name: 'general', description: 'General', mode: 'subagent', runtimeRole: 'creator' }];

    await expect(useCase.handleTask(
      'project-cancelled', 'parent-cancelled', 'parent-prompt', 'user-cancelled',
      { description: 'Cancelled task', objective: 'Do work', subagent_type: 'general', task_id: 'cancelled-child' },
      agents, undefined, null, null, 'provider-cancelled'
    )).rejects.toThrow(/cancelled/);

    expect(lifecycle.map((task) => task.status)).toEqual(['running', 'cancelled']);
    expect(useCase.finalizeHandlerToolCall).toHaveBeenCalledWith(
      expect.anything(), 'project-cancelled', 'ERROR', null, expect.stringMatching(/cancelled/)
    );
  });

  it('records an already-aborted parent task as cancelled after listener registration', async () => {
    const lifecycle: Array<Record<string, unknown>> = [];
    const useCase = new AiAgentSessionUseCase({} as PrismaClient) as any;
    useCase.resolveActiveBuildRun = vi.fn(async () => null);
    useCase.getSession = vi.fn(async () => ({ id: 'abort-child', projectId: 'project-abort' }));
    useCase.createProviderToolCall = vi.fn(async () => row({
      id: 'abort-call', sessionId: 'abort-parent', promptId: 'abort-prompt',
      toolCallId: 'provider-abort', toolName: 'task', status: 'RUNNING'
    }));
    useCase.ensureToolTimelinePart = vi.fn(async (_sessionId: string, promptId: string, kind: string) => storedPart({ id: `${kind}-abort`, promptId, kind }));
    useCase.createTaskPart = vi.fn(async (_sessionId: string, promptId: string, task: Record<string, unknown>) => {
      lifecycle.push(task);
      return storedPart({ id: `abort-task-${lifecycle.length}`, promptId, kind: 'task', payload: JSON.parse(JSON.stringify(task)) });
    });
    useCase.hydrateSinglePart = vi.fn(async () => null);
    useCase.snapshot = vi.fn(async () => sessionSnapshot('abort-parent'));
    useCase.broadcast = vi.fn(async () => undefined);
    useCase.finalizeHandlerToolCall = vi.fn(async () => undefined);
    useCase.drain = vi.fn(async () => { throw new Error('drain must not start'); });
    const controller = new AbortController();
    controller.abort('cancel before execute');
    const agents: AiAgentInfo[] = [{ name: 'general', description: 'General', mode: 'subagent', runtimeRole: 'creator' }];

    await expect(useCase.handleTask(
      'project-abort', 'abort-parent', 'abort-prompt', 'user-abort',
      { description: 'Abort task', objective: 'Do not run', subagent_type: 'general', task_id: 'abort-child' },
      agents, undefined, null, null, 'provider-abort', controller.signal
    )).rejects.toThrow(/cancelled/);

    expect(lifecycle.map((task) => task.status)).toEqual(['running', 'cancelled']);
    expect(lifecycle.some((task) => task.status === 'error')).toBe(false);
    expect(useCase.drain).not.toHaveBeenCalled();
  });

  it('does not hang approval or question handlers when abort happened before listener registration', async () => {
    const approval = row({ id: 'abort-approval', toolName: 'createChapter', status: 'PENDING_APPROVAL' });
    const question = row({ id: 'abort-question', toolName: 'askUser', status: 'PENDING_APPROVAL' });
    const useCase = new AiAgentSessionUseCase({} as PrismaClient) as any;
    useCase.createProviderToolCall = vi.fn(async (_session: string, _prompt: string, id: string) => id === 'provider-question' ? question : approval);
    useCase.ensureToolTimelinePart = vi.fn(async (_sessionId: string, promptId: string, kind: string) => storedPart({ id: `${kind}-preabort`, promptId, kind }));
    useCase.hydrateSinglePart = vi.fn(async () => null);
    useCase.snapshot = vi.fn(async () => sessionSnapshot('preabort-session'));
    useCase.broadcast = vi.fn(async () => undefined);
    useCase.finalizeHandlerToolCall = vi.fn(async () => undefined);
    const controller = new AbortController();
    controller.abort('already cancelled');

    await expect(useCase.handleApproval(
      'preabort-session', 'preabort-prompt', 'project', 'createChapter', { title: 'Never' },
      async () => ({}), 'provider-approval', controller.signal
    )).rejects.toThrow(/cancelled/);
    await expect(useCase.handleQuestion(
      'preabort-session', 'preabort-prompt', 'project', 'askUser', { questions: [] },
      'provider-question', controller.signal
    )).rejects.toThrow(/cancelled/);
    expect(useCase.finalizeHandlerToolCall).toHaveBeenCalledTimes(2);
  });

  it('replays an idempotent approved build mutation after restart but fails unsafe CRUD closed', async () => {
    const safe = row({ id: 'safe-approved', toolName: 'startNovelBuild', status: 'APPROVED' });
    const unsafe = row({ id: 'unsafe-pending', toolName: 'createChapter', status: 'PENDING_APPROVAL' });
    let current = safe;
    const prisma = {
      aiAgentToolCall: {
        updateMany: vi.fn(async ({ where, data }: { where: { status?: ToolRow['status'] }; data: Partial<ToolRow> }) => {
          if (where.status && current.status !== where.status) return { count: 0 };
          Object.assign(current, data);
          return { count: 1 };
        }),
        findUniqueOrThrow: vi.fn(async () => current)
      }
    };
    const useCase = new AiAgentSessionUseCase(prisma as unknown as PrismaClient) as any;
    useCase.recoverApprovedToolCall = vi.fn(async () => undefined);
    useCase.failOrphanedInteractiveRun = vi.fn(async () => undefined);

    await useCase.applyToolCallApproval('user', 'project', 'session-a', safe, true);
    expect(useCase.recoverApprovedToolCall).toHaveBeenCalledWith('user', 'project', 'session-a', safe);

    current = unsafe;
    await expect(useCase.applyToolCallApproval('user', 'project', 'session-a', unsafe, true)).rejects.toThrow(/cannot be replayed safely/);
    expect(useCase.failOrphanedInteractiveRun).toHaveBeenCalledWith(
      'session-a', unsafe.promptId, expect.stringMatching(/cannot be replayed safely/), unsafe.id
    );
  });

  it('requires complete question answers and unwedge-finalizes restart fallbacks', async () => {
    const question = row({
      id: 'question-restart', toolName: 'askUser', status: 'PENDING_APPROVAL',
      input: { questions: [{ question: 'Choose one' }] }
    });
    const prisma = {
      aiAgentToolCall: {
        findFirst: vi.fn(async () => question),
        updateMany: vi.fn(async ({ data }: { data: Partial<ToolRow> }) => {
          Object.assign(question, data);
          return { count: 1 };
        }),
        findUniqueOrThrow: vi.fn(async () => question)
      },
      aiAgentMessage: { create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => ({ id: 'question-message', ...data, createdAt: new Date() })) }
    };
    const useCase = new AiAgentSessionUseCase(prisma as unknown as PrismaClient) as any;
    useCase.access.assertPermission = vi.fn(async () => undefined);
    useCase.getSession = vi.fn(async () => ({ id: 'question-session' }));
    useCase.ensureToolTimelinePart = vi.fn(async () => storedPart({ id: 'question-result', kind: 'tool-result', toolCallId: question.id }));
    useCase.createMessagePart = vi.fn(async () => storedPart({ id: 'question-message-part', kind: 'message' }));
    useCase.hydrateSinglePart = vi.fn(async () => null);
    useCase.snapshot = vi.fn(async () => sessionSnapshot('question-session'));
    useCase.broadcast = vi.fn(async () => undefined);
    useCase.failOrphanedInteractiveRun = vi.fn(async () => undefined);

    await expect(useCase.answerQuestion('user', 'project', question.id, { answers: [[]] }, 'question-session'))
      .rejects.toThrow(/Every question requires/);
    expect(prisma.aiAgentToolCall.updateMany).not.toHaveBeenCalled();

    await useCase.answerQuestion('user', 'project', question.id, { answers: [['Proceed']] }, 'question-session');
    expect(useCase.failOrphanedInteractiveRun).toHaveBeenCalledWith(
      'question-session', question.promptId, expect.stringMatching(/cannot continue/)
    );
  });

  it('buffers live deltas until the initial SSE snapshot is written', async () => {
    let resolveSnapshot!: (value: ReturnType<typeof sessionSnapshot>) => void;
    const snapshotPromise = new Promise<ReturnType<typeof sessionSnapshot>>((resolve) => { resolveSnapshot = resolve; });
    const useCase = new AiAgentSessionUseCase({} as PrismaClient) as any;
    useCase.access.assertProjectAccess = vi.fn(async () => undefined);
    useCase.getSession = vi.fn(async () => ({ id: 'race-session' }));
    useCase.recoverOrphanedInteractiveSession = vi.fn(async () => false);
    useCase.snapshot = vi.fn(async () => snapshotPromise);
    const res = new FakeSseResponse();

    const subscribing = useCase.subscribe('user', 'project', res, 'race-session');
    await vi.waitFor(() => expect(res.flushed).toBe(true));
    await useCase.broadcast('project', { type: 'text-delta', data: { text: 'newer' } }, 'race-session');
    expect(res.writes).toHaveLength(0);
    resolveSnapshot(sessionSnapshot('race-session'));
    await subscribing;

    expect(res.writes).toHaveLength(2);
    expect(res.writes[0]).toContain('"type":"session"');
    expect(res.writes[1]).toContain('"type":"text-delta"');
    res.emit('close');
  });

  it('waits for drain after initial SSE backpressure and retires throwing clients', async () => {
    const useCase = new AiAgentSessionUseCase({} as PrismaClient) as any;
    useCase.access.assertProjectAccess = vi.fn(async () => undefined);
    useCase.getSession = vi.fn(async () => ({ id: 'pressure-session' }));
    useCase.recoverOrphanedInteractiveSession = vi.fn(async () => false);
    useCase.snapshot = vi.fn(async () => sessionSnapshot('pressure-session'));
    const pressured = new FakeSseResponse([false, true]);

    await useCase.subscribe('user', 'project', pressured, 'pressure-session');
    await useCase.broadcast('project', { type: 'text-delta', data: { text: 'buffered' } }, 'pressure-session');
    expect(pressured.writes).toHaveLength(1);
    pressured.emit('drain');
    expect(pressured.writes).toHaveLength(2);
    pressured.emit('close');

    useCase.getSession = vi.fn(async () => ({ id: 'throwing-session' }));
    useCase.snapshot = vi.fn(async () => sessionSnapshot('throwing-session'));
    const throwing = new FakeSseResponse([], true);
    await expect(useCase.subscribe('user', 'project', throwing, 'throwing-session')).resolves.toBeUndefined();
    await expect(useCase.broadcast('project', { type: 'text-delta', data: { text: 'ignored' } }, 'throwing-session'))
      .resolves.toBeUndefined();
    expect(throwing.writes).toHaveLength(0);
  });

  it('serializes per-session drains and database-claims a queued prompt once', async () => {
    let release!: () => void;
    const held = new Promise<void>((resolve) => { release = resolve; });
    const useCase = new AiAgentSessionUseCase({} as PrismaClient) as any;
    useCase.drainOwned = vi.fn(async () => held);

    const first = useCase.drain('user', 'project', 'mutex-session');
    const second = useCase.drain('user', 'project', 'mutex-session');
    expect(first).toBe(second);
    expect(useCase.drainOwned).toHaveBeenCalledTimes(1);
    release();
    await Promise.all([first, second]);
    await vi.waitFor(() => expect(useCase.drainOwned).toHaveBeenCalledTimes(2));

    let sessionStatus = 'IDLE';
    let activePromptId: string | null = null;
    let promptStatus = 'QUEUED';
    const tx = {
      projectAiAgentSession: {
        updateMany: vi.fn(async () => {
          if (sessionStatus === 'RUNNING' || activePromptId !== null) return { count: 0 };
          sessionStatus = 'RUNNING'; activePromptId = 'prompt-1'; return { count: 1 };
        })
      },
      aiAgentPrompt: {
        updateMany: vi.fn(async () => {
          if (promptStatus !== 'QUEUED') return { count: 0 };
          promptStatus = 'RUNNING'; return { count: 1 };
        })
      }
    };
    const claimUseCase = new AiAgentSessionUseCase({
      $transaction: async (callback: (client: typeof tx) => unknown) => callback(tx)
    } as unknown as PrismaClient) as any;
    expect(await claimUseCase.claimQueuedPrompt('mutex-session', 'prompt-1')).toBe(true);
    expect(await claimUseCase.claimQueuedPrompt('mutex-session', 'prompt-1')).toBe(false);
    expect(tx.aiAgentPrompt.updateMany).toHaveBeenCalledTimes(2);
    expect(tx.aiAgentPrompt.updateMany.mock.invocationCallOrder[0]).toBeLessThan(
      tx.projectAiAgentSession.updateMany.mock.invocationCallOrder[0]!
    );
  });

  it('installs cancellation before the first drain lookup and never claims work after a concurrent Stop', async () => {
    let resolveSession!: (value: { id: string; projectId: string }) => void;
    const sessionLookup = new Promise<{ id: string; projectId: string }>((resolve) => {
      resolveSession = resolve;
    });
    const findQueued = vi.fn(async () => ({ id: 'must-not-start', prompt: 'Do work' }));
    const cancelPromptUpdate = vi.fn(async () => ({ count: 1 }));
    const cancelSessionUpdate = vi.fn(async () => ({}));
    const tx = {
      aiAgentPrompt: { updateMany: cancelPromptUpdate },
      projectAiAgentSession: { update: cancelSessionUpdate }
    };
    const prisma = {
      aiAgentPrompt: { findFirst: findQueued },
      projectAiAgentSession: {
        findUniqueOrThrow: vi.fn(async () => ({
          status: 'IDLE', activePromptId: null, lastError: null
        }))
      },
      $transaction: vi.fn(async (callback: (client: typeof tx) => unknown) => callback(tx))
    };
    const useCase = new AiAgentSessionUseCase(prisma as unknown as PrismaClient) as any;
    useCase.access.assertPermission = vi.fn(async () => undefined);
    useCase.getSession = vi.fn(async () => sessionLookup);
    useCase.snapshot = vi.fn(async () => sessionSnapshot('cancel-race-session'));
    useCase.broadcast = vi.fn(async () => undefined);
    useCase.drain = vi.fn(async () => undefined);

    const draining = useCase.drainOwned('user', 'project', 'cancel-race-session');
    const cancelling = useCase.cancel('user', 'project', 'cancel-race-session');
    await vi.waitFor(() => expect(useCase.getSession).toHaveBeenCalledTimes(2));
    resolveSession({ id: 'cancel-race-session', projectId: 'project' });
    await Promise.all([draining, cancelling]);

    expect(findQueued).not.toHaveBeenCalled();
    expect(cancelPromptUpdate).toHaveBeenCalledWith({
      where: {
        sessionId: 'cancel-race-session',
        status: { in: ['QUEUED', 'RUNNING'] }
      },
      data: { status: 'CANCELLED' }
    });
    expect(cancelSessionUpdate).toHaveBeenCalledOnce();
    expect(cancelSessionUpdate).toHaveBeenCalledWith({
      where: { id: 'cancel-race-session' },
      data: { status: 'CANCELLED', activePromptId: null, lastError: null }
    });
    expect(useCase.drain).toHaveBeenCalledWith(
      'user', 'project', 'cancel-race-session'
    );
  });

  it('does not rotate to a fresh controller while a cancellation transaction is pending', () => {
    const current = new AbortController();
    current.abort();
    const controllerState = { current };
    const runtime = {
      clients: new Set(),
      abortController: current,
      drainPromise: null,
      drainAgain: false,
      cancelPending: 1
    };
    const useCase = new AiAgentSessionUseCase({} as PrismaClient) as any;

    expect(useCase.rotateDrainController(runtime, controllerState)).toBe(false);
    expect(controllerState.current).toBe(current);
    expect(runtime.abortController).toBe(current);
  });

  it('refuses to overwrite cancellation when terminal completion loses its conditional session claim', async () => {
    const promptUpdate = vi.fn(async () => ({ count: 1 }));
    const sessionUpdate = vi.fn(async () => ({ count: 0 }));
    const tx = {
      aiAgentPrompt: { updateMany: promptUpdate },
      projectAiAgentSession: { updateMany: sessionUpdate }
    };
    const useCase = new AiAgentSessionUseCase({
      $transaction: async (callback: (client: typeof tx) => unknown) => callback(tx)
    } as unknown as PrismaClient) as any;

    await expect(
      useCase.completeClaimedPrompt('completion-race-session', 'completion-race-prompt')
    ).resolves.toBe(false);
    expect(promptUpdate).toHaveBeenCalledWith({
      where: {
        id: 'completion-race-prompt',
        sessionId: 'completion-race-session',
        status: 'RUNNING'
      },
      data: { status: 'COMPLETED' }
    });
    expect(sessionUpdate).toHaveBeenCalledWith({
      where: {
        id: 'completion-race-session',
        status: 'RUNNING',
        activePromptId: 'completion-race-prompt'
      },
      data: { status: 'IDLE', activePromptId: null }
    });
  });
});

type ToolRow = {
  id: string;
  sessionId: string;
  promptId: string | null;
  toolCallId: string | null;
  toolName: string;
  input: unknown;
  status: 'PENDING_APPROVAL' | 'APPROVED' | 'REJECTED' | 'RUNNING' | 'EXECUTED' | 'ERROR';
  output: unknown;
  error: string | null;
  createdAt: Date;
  decidedAt: Date | null;
  decidedById: string | null;
};

function row(overrides: Partial<ToolRow>): ToolRow {
  return {
    id: 'call-1', sessionId: 'session-a', promptId: 'prompt-a', toolCallId: 'provider-1',
    toolName: 'readProject', input: {}, status: 'RUNNING', output: null, error: null,
    createdAt: new Date('2026-08-26T00:00:00.000Z'), decidedAt: null, decidedById: null,
    ...overrides
  };
}

function toolPrisma(rows: ToolRow[]) {
  return {
    aiAgentToolCall: {
      findFirst: vi.fn(async ({ where }: { where: Partial<ToolRow> }) => rows.find((item) =>
        Object.entries(where).every(([key, value]) => item[key as keyof ToolRow] === value)
      ) ?? null),
      create: vi.fn(async ({ data }: { data: Partial<ToolRow> }) => {
        const created = row({ id: `call-${rows.length + 1}`, ...data });
        rows.push(created);
        return created;
      }),
      update: vi.fn(async ({ where, data }: { where: { id: string }; data: Partial<ToolRow> }) => {
        const target = rows.find((item) => item.id === where.id);
        if (!target) throw new Error('Missing tool call');
        Object.assign(target, data);
        return target;
      })
    }
  };
}

function storedPart(overrides: Partial<StoredSessionPart>): StoredSessionPart {
  const now = new Date('2026-08-26T00:00:00.000Z');
  return {
    id: 'part-1', sessionId: 'parent-session', promptId: null, messageId: null, toolCallId: null,
    kind: 'task', sequence: 1, payload: {}, createdAt: now, updatedAt: now,
    ...overrides
  };
}

function sessionSnapshot(id: string) {
  return {
    id, projectId: 'project-a', title: 'Session', status: 'running', activePromptId: 'prompt-a',
    queue: [], messages: [], toolCalls: [], pendingToolCalls: [], contextUsage: null, error: null,
    updatedAt: '2026-08-26T00:00:00.000Z'
  };
}

class FakeSseResponse extends EventEmitter {
  writes: string[] = [];
  flushed = false;
  writableEnded = false;
  constructor(private readonly results: boolean[] = [], private readonly throws = false) { super(); }
  setHeader() {}
  flushHeaders() { this.flushed = true; }
  write(value: string) {
    if (this.throws) throw new Error('socket closed');
    this.writes.push(value);
    return this.results.length ? this.results.shift()! : true;
  }
}
