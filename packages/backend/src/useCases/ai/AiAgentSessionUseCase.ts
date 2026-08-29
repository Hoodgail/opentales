import type { Response } from 'express';
import type { Prisma, PrismaClient } from '@prisma/client';
import type { ToolSet } from 'ai';
import type {
  AiAgentApprovalMode,
  AiAgentAttachment,
  AiAgentMessage,
  AiAgentQueuedPrompt,
  AiAgentSession,
  AiAgentSessionEvent,
  AiAgentSessionPart,
  AiAgentSubtaskPart,
  AiAgentSessionSummary,
  AiAgentToolCall,
  AiAgentTimelinePage,
  ApproveAiToolCallInput,
  ApproveAiToolCallsInput,
  AnswerAiQuestionInput,
  CreateAiAgentSessionInput,
  GetAiAgentTimelineInput,
  QueueAiAgentPromptInput,
  UpdateAiAgentSessionInput
} from '@opentales/sdk';
import { stepCountIs, streamText } from 'ai';
import { HttpError } from '../../http/HttpError.js';
import { ProjectAccessRepository } from '../../repositories/ProjectAccessRepository.js';
import { findAgent, loadAiAgents, subagentsForTask, type AiAgentInfo } from './agents.js';
import { loadAiSkillCatalog, loadAiSkillReferences } from './markdownCatalog.js';
import { loadAiModelForProject, providerOptionsForAiModel } from './aiModel.js';
import { renderSystemPrompt, renderUserContext } from './prompts/promptEngine.js';
import { buildRecentTranscript } from './prompts/conversationHistory.js';
import { renderInferenceLayers } from './prompts/layeredInference.js';
import { serializeUntrustedData } from './prompts/untrustedData.js';
import { ContextAssembler, type AssembledContextPack } from './context/ContextAssembler.js';
import {
  normalizeTaskContract,
  stepLimitForTask,
  type TaskContract
} from './runtime/taskContract.js';
import {
  SessionTimelineRecorder,
  SESSION_TIMELINE_PART_LIMIT,
  buildSessionTimelineProjection,
  hydrateSessionPart,
  partText as readPartText,
  toTextTimelinePart,
  type StoredSessionPart
} from './runtime/SessionTimelineRecorder.js';
import {
  agentMutatingToolNames,
  buildAgentTools,
  bodyOf,
  executeAgentMutationTool,
  type AgentMutatingToolName
} from './tools/index.js';
import type { TaskToolInput } from './tools/task.js';

interface RuntimeClient {
  res: Response;
  ready: boolean;
  closed: boolean;
  buffer: AiAgentSessionEvent[];
  heartbeat: NodeJS.Timeout;
  dispose: () => void;
}

interface RuntimeSession {
  clients: Set<RuntimeClient>;
  abortController: AbortController | null;
  drainPromise: Promise<void> | null;
  drainAgain: boolean;
  cancelPending: number;
}

interface PendingApproval {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  execute: () => Promise<unknown>;
  timeout: NodeJS.Timeout;
}

interface PendingQuestion {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timeout: NodeJS.Timeout;
}

const runtimes = new Map<string, RuntimeSession>();
const MUTATING_TOOLS = new Set<string>(agentMutatingToolNames);
const HANDLER_MANAGED_TOOLS = new Set<string>([...agentMutatingToolNames, 'askUser', 'task']);
const DURABLE_BUILD_OUTPUT_TYPES = new Set<string>([
  'story-brief',
  'narrative-contract',
  'character-bible',
  'relationship-graph',
  'world-bible',
  'plot-thread',
  'act-architecture',
  'chapter-brief',
  'scene-plan',
  'timeline',
  'setup-payoff-map',
  'research-questions',
  'open-questions',
  'beat',
  'chapter-draft',
  'revision-issue',
  'finale-plan',
  'export-manifest'
]);
const IDEMPOTENT_APPROVAL_RECOVERY_TOOLS = new Set<string>([
  'startNovelBuild',
  'applyArtifactBatch',
  'applyChapterPatch',
  'createCheckpoint',
  'commitCanonDelta',
  'linkSetupPayoff'
]);
const pendingApprovals = new Map<string, PendingApproval>();
const pendingQuestions = new Map<string, PendingQuestion>();
const APPROVAL_TIMEOUT_MS = Number(process.env.AI_APPROVAL_TIMEOUT_MS ?? 10 * 60 * 1000);
const QUESTION_TIMEOUT_MS = Number(process.env.AI_QUESTION_TIMEOUT_MS ?? APPROVAL_TIMEOUT_MS);
const DEFAULT_CONTEXT_WINDOW = Number(process.env.AI_CONTEXT_WINDOW_TOKENS ?? 128_000);
const TOOL_OUTPUT_SNAPSHOT_BYTES = Math.max(1_024, Number(process.env.AI_TOOL_OUTPUT_SNAPSHOT_BYTES ?? 16_384));

class AgentStreamAbort extends Error {}
class AgentStreamFailure extends Error {}
class HandledSubtaskError extends Error {}
class PromptClaimRaceError extends Error {}
class PromptCompletionRaceError extends Error {}

interface PromptPayload {
  prompt: string;
  model: string | null;
  attachments: AiAgentAttachment[];
  agent: string | null;
  taskContract: TaskContract | null;
  buildRunId: string | null;
  approvalMode: AiAgentApprovalMode;
}

interface UsagePayload {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  maxTokens: number;
  percentage: number;
  model: string | null;
}

export class AiAgentSessionUseCase {
  private readonly access: ProjectAccessRepository;
  private readonly timeline: SessionTimelineRecorder;

  constructor(private readonly prisma: PrismaClient) {
    this.access = new ProjectAccessRepository(prisma);
    this.timeline = new SessionTimelineRecorder(prisma);
  }

  async list(userId: string, projectId: string): Promise<AiAgentSessionSummary[]> {
    await this.access.assertProjectAccess(userId, projectId);
    await this.ensureDefaultSession(projectId);
    const sessions = await this.prisma.projectAiAgentSession.findMany({
      where: { projectId },
      orderBy: { updatedAt: 'desc' },
      include: { _count: { select: { messages: true } } }
    });
    return sessions.map((session) => ({
      id: session.id,
      projectId,
      title: session.title ?? defaultSessionTitle(session.createdAt),
      approvalMode: fromPrismaApprovalMode(session.approvalMode),
      status: toSessionStatus(session.status),
      messageCount: session._count.messages,
      createdAt: session.createdAt.toISOString(),
      updatedAt: session.updatedAt.toISOString()
    }));
  }

  async create(
    userId: string,
    projectId: string,
    input: CreateAiAgentSessionInput
  ): Promise<AiAgentSession> {
    await this.access.assertPermission(userId, projectId, 'project:write');
    const approvalMode = normalizeApprovalMode(input.approvalMode);
    if (approvalMode === 'auto') await this.access.assertPermission(userId, projectId, 'project:admin');
    const title = input.title?.trim() || 'New chat';
    const activeBuildRunId = await this.validateRequestedBuildRun(projectId, input.buildRunId);
    const session = await this.prisma.projectAiAgentSession.create({
      data: { projectId, title, activeBuildRunId, approvalMode: toPrismaApprovalMode(approvalMode) }
    });
    return this.snapshot(session.id, projectId);
  }

  async update(
    userId: string,
    projectId: string,
    sessionId: string,
    input: UpdateAiAgentSessionInput
  ): Promise<AiAgentSession> {
    if (input.approvalMode === undefined) throw new HttpError(400, 'approvalMode is required');
    const approvalMode = normalizeApprovalMode(input.approvalMode);
    await this.access.assertPermission(
      userId,
      projectId,
      approvalMode === 'auto' ? 'project:admin' : 'project:write'
    );
    const session = await this.getSession(projectId, sessionId);
    if (session.status === 'RUNNING') throw new HttpError(409, 'Execution mode cannot change while the agent is running');
    const queued = await this.prisma.aiAgentPrompt.count({
      where: { sessionId, status: { in: ['QUEUED', 'RUNNING'] } }
    });
    if (queued > 0) throw new HttpError(409, 'Execution mode cannot change while prompts are queued');
    await this.prisma.projectAiAgentSession.update({
      where: { id: sessionId },
      data: { approvalMode: toPrismaApprovalMode(approvalMode) }
    });
    const snapshot = await this.snapshot(sessionId, projectId);
    await this.broadcast(projectId, { type: 'session', session: snapshot, data: { approvalMode } });
    return snapshot;
  }

  async get(userId: string, projectId: string, sessionId?: string): Promise<AiAgentSession> {
    await this.access.assertProjectAccess(userId, projectId);
    const session = sessionId
      ? await this.getSession(projectId, sessionId)
      : await this.ensureDefaultSession(projectId);
    await this.recoverOrphanedInteractiveSession(session.id);
    return this.snapshot(session.id, projectId);
  }

  async getToolCall(
    userId: string,
    projectId: string,
    toolCallId: string,
    sessionId?: string
  ): Promise<AiAgentToolCall> {
    await this.access.assertProjectAccess(userId, projectId);
    const session = sessionId
      ? await this.getSession(projectId, sessionId)
      : await this.ensureDefaultSession(projectId);
    await this.recoverOrphanedInteractiveSession(session.id);
    const toolCall = await this.prisma.aiAgentToolCall.findFirst({
      where: { sessionId: session.id, OR: [{ id: toolCallId }, { toolCallId }] }
    });
    if (!toolCall) throw new HttpError(404, 'Tool call not found');
    return toToolCall(toolCall, { fullOutput: true, fullInput: true });
  }

  async getTimeline(
    userId: string,
    projectId: string,
    input: GetAiAgentTimelineInput = {},
    sessionId?: string
  ): Promise<AiAgentTimelinePage> {
    await this.access.assertProjectAccess(userId, projectId);
    const session = sessionId
      ? await this.getSession(projectId, sessionId)
      : await this.ensureDefaultSession(projectId);
    await this.recoverOrphanedInteractiveSession(session.id);
    const limit = Math.min(Math.max(input.limit ?? 100, 1), 200);
    const beforeSequence = typeof input.beforeSequence === 'number' && Number.isInteger(input.beforeSequence)
      ? input.beforeSequence
      : undefined;
    const rows = await this.prisma.aiAgentSessionPart.findMany({
      where: {
        sessionId: session.id,
        ...(beforeSequence === undefined ? {} : { sequence: { lt: beforeSequence } })
      },
      orderBy: { sequence: 'desc' },
      take: limit + 1
    });
    const selected = rows.slice(0, limit);
    if (selected.length) {
      const messageIds = [...new Set(selected.flatMap((part) => part.messageId ? [part.messageId] : []))];
      const toolCallIds = [...new Set(selected.flatMap((part) => part.toolCallId ? [part.toolCallId] : []))];
      const [messages, toolCalls, legacyMessage, legacyTool] = await Promise.all([
        messageIds.length ? this.prisma.aiAgentMessage.findMany({ where: { sessionId: session.id, id: { in: messageIds } } }) : [],
        toolCallIds.length ? this.prisma.aiAgentToolCall.findMany({ where: { sessionId: session.id, id: { in: toolCallIds } } }) : [],
        rows.length <= limit ? this.prisma.aiAgentMessage.findFirst({ where: { sessionId: session.id, parts: { none: {} } }, select: { id: true } }) : null,
        rows.length <= limit ? this.prisma.aiAgentToolCall.findFirst({ where: { sessionId: session.id, parts: { none: {} } }, select: { id: true } }) : null
      ]);
      const hasMore = rows.length > limit || Boolean(legacyMessage || legacyTool);
      const projection = buildSessionTimelineProjection(
        selected,
        messages.map(toMessage),
        toolCalls.map((toolCall) => toToolCall(toolCall)),
        { maxPersistedParts: limit, hasMoreBefore: hasMore }
      );
      return {
        parts: projection.timeline,
        timelineInfo: projection.timelineInfo,
        nextBeforeSequence: hasMore ? Math.min(...selected.map((part) => part.sequence)) : null,
        hasMore
      };
    }
    return this.legacyTimelinePage(session.id, beforeSequence, limit, input.legacyCursor);
  }

  async queuePrompt(
    userId: string,
    projectId: string,
    input: QueueAiAgentPromptInput,
    sessionId?: string
  ): Promise<AiAgentSession> {
    await this.access.assertPermission(userId, projectId, 'project:write');
    await loadAiModelForProject(this.prisma, projectId, input.model);

    const session = sessionId
      ? await this.getSession(projectId, sessionId)
      : await this.ensureDefaultSession(projectId);
    if (session.approvalMode === 'AUTO') {
      await this.access.assertPermission(userId, projectId, 'project:admin');
    }
    const prompt = input.prompt?.trim();
    if (!prompt) throw new HttpError(400, 'Prompt is required');
    const activeBuildRunId = await this.resolveActiveBuildRun(
      projectId,
      session.id,
      input.buildRunId
    );
    const payload = normalizePromptPayload({
      prompt,
      model: typeof input.model === 'string' ? input.model.trim() || null : null,
      attachments: sanitizeAttachments(input.attachments),
      agent: null,
      taskContract: null,
      buildRunId: activeBuildRunId,
      approvalMode: fromPrismaApprovalMode(session.approvalMode)
    });
    const runtime = getRuntime(session.id);
    if (input.interrupt && runtime.abortController) {
      runtime.abortController.abort();
      await this.prisma.$transaction(async (tx) => {
        await tx.aiAgentPrompt.updateMany({
          where: { sessionId: session.id, status: 'RUNNING' },
          data: { status: 'CANCELLED' }
        });
        await tx.projectAiAgentSession.update({
          where: { id: session.id },
          data: { status: 'CANCELLED', activePromptId: null }
        });
      });
    }

    const last = await this.prisma.aiAgentPrompt.findFirst({
      where: { sessionId: session.id },
      orderBy: { order: 'desc' },
      select: { order: true }
    });
    const queued = await this.prisma.aiAgentPrompt.create({
      data: {
        sessionId: session.id,
        prompt: serializePromptPayload(payload),
        order: input.interrupt ? -Date.now() : (last?.order ?? 0) + 1
      }
    });

    await this.broadcast(projectId, {
      type: 'prompt-queued',
      session: await this.snapshot(session.id, projectId),
      data: toQueuedPrompt(queued)
    });
    void this.drain(userId, projectId, session.id).catch(() => undefined);
    return this.snapshot(session.id, projectId);
  }

  async cancel(userId: string, projectId: string, sessionId?: string): Promise<AiAgentSession> {
    await this.access.assertPermission(userId, projectId, 'project:write');
    const session = sessionId
      ? await this.getSession(projectId, sessionId)
      : await this.ensureDefaultSession(projectId);
    const runtime = getRuntime(session.id);
    runtime.cancelPending += 1;
    runtime.abortController?.abort();
    try {
      await this.prisma.$transaction(async (tx) => {
        await tx.aiAgentPrompt.updateMany({
          where: { sessionId: session.id, status: { in: ['QUEUED', 'RUNNING'] } },
          data: { status: 'CANCELLED' }
        });
        await tx.projectAiAgentSession.update({
          where: { id: session.id },
          data: { status: 'CANCELLED', activePromptId: null, lastError: null }
        });
      });
    } finally {
      runtime.cancelPending = Math.max(0, runtime.cancelPending - 1);
    }
    const snapshot = await this.snapshot(session.id, projectId);
    await this.broadcast(projectId, { type: 'session', session: snapshot, data: { cancelled: true } });
    void this.drain(userId, projectId, session.id).catch(() => undefined);
    return snapshot;
  }

  async approveToolCall(
    userId: string,
    projectId: string,
    toolCallId: string,
    input: ApproveAiToolCallInput,
    sessionId?: string
  ): Promise<AiAgentSession> {
    await this.access.assertPermission(userId, projectId, 'project:write');
    const session = sessionId
      ? await this.getSession(projectId, sessionId)
      : await this.ensureDefaultSession(projectId);
    const toolCall = await this.prisma.aiAgentToolCall.findFirst({
      where: {
        sessionId: session.id,
        AND: [
          { OR: [{ id: toolCallId }, { toolCallId }] },
          {
            OR: [
              { status: 'PENDING_APPROVAL' },
              { status: { in: ['APPROVED', 'RUNNING'] }, toolName: { in: [...agentMutatingToolNames] } }
            ]
          }
        ]
      }
    });
    if (!toolCall) throw new HttpError(404, 'Pending tool call not found');
    await this.applyToolCallApproval(userId, projectId, session.id, toolCall, input.approved);

    const snapshot = await this.snapshot(session.id, projectId);
    await this.broadcast(projectId, {
      type: 'tool-approval',
      session: snapshot,
      data: { toolCallId: toolCall.id, approved: input.approved }
    });
    return snapshot;
  }

  async approveToolCalls(
    userId: string,
    projectId: string,
    input: ApproveAiToolCallsInput,
    sessionId?: string
  ): Promise<AiAgentSession> {
    await this.access.assertPermission(userId, projectId, 'project:write');
    const session = sessionId
      ? await this.getSession(projectId, sessionId)
      : await this.ensureDefaultSession(projectId);
    const ids = [...new Set(Array.isArray(input.toolCallIds) ? input.toolCallIds.filter(Boolean) : [])];
    if (ids.length === 0) throw new HttpError(400, 'toolCallIds is required');

    const toolCalls = await this.prisma.aiAgentToolCall.findMany({
      where: {
        sessionId: session.id,
        AND: [
          { OR: [{ id: { in: ids } }, { toolCallId: { in: ids } }] },
          {
            OR: [
              { status: 'PENDING_APPROVAL' },
              { status: { in: ['APPROVED', 'RUNNING'] }, toolName: { in: [...agentMutatingToolNames] } }
            ]
          }
        ]
      },
      orderBy: { createdAt: 'asc' }
    });
    if (toolCalls.length !== ids.length) throw new HttpError(404, 'One or more pending tool calls were not found');

    for (const toolCall of toolCalls) {
      await this.applyToolCallApproval(userId, projectId, session.id, toolCall, input.approved);
    }

    const snapshot = await this.snapshot(session.id, projectId);
    await this.broadcast(projectId, {
      type: 'tool-approval',
      session: snapshot,
      data: { toolCallIds: toolCalls.map((toolCall) => toolCall.id), approved: input.approved }
    });
    return snapshot;
  }

  async answerQuestion(
    userId: string,
    projectId: string,
    toolCallId: string,
    input: AnswerAiQuestionInput,
    sessionId?: string
  ): Promise<AiAgentSession> {
    await this.access.assertPermission(userId, projectId, 'project:write');
    const session = sessionId
      ? await this.getSession(projectId, sessionId)
      : await this.ensureDefaultSession(projectId);
    const toolCall = await this.prisma.aiAgentToolCall.findFirst({
      where: {
        sessionId: session.id,
        toolName: 'askUser',
        status: 'PENDING_APPROVAL',
        OR: [{ id: toolCallId }, { toolCallId }]
      }
    });
    if (!toolCall) throw new HttpError(404, 'Pending question not found');

    const answers = normalizeQuestionAnswers(input.answers);
    validateQuestionAnswers(toolCall.input, answers);
    const output = questionOutput(toolCall.input, answers);
    const claimed = await this.prisma.aiAgentToolCall.updateMany({
      where: { id: toolCall.id, status: 'PENDING_APPROVAL' },
      data: {
        status: 'EXECUTED',
        output: output as Prisma.InputJsonValue,
        decidedAt: new Date(),
        decidedById: userId
      }
    });
    if (claimed.count !== 1) throw new HttpError(409, 'Question was already answered or dismissed');
    const answeredToolCall = await this.prisma.aiAgentToolCall.findUniqueOrThrow({ where: { id: toolCall.id } });
    const pending = pendingQuestions.get(toolCall.id);
    if (pending) {
      clearTimeout(pending.timeout);
      pendingQuestions.delete(toolCall.id);
      pending.resolve(output);
    } else {
      await this.failOrphanedInteractiveRun(
        session.id,
        toolCall.promptId,
        'The answer was recorded, but the interrupted model turn cannot continue after a backend restart. Send a new prompt to proceed.'
      );
    }
    const toolMessage = await this.prisma.aiAgentMessage.create({
      data: {
        sessionId: session.id,
        role: 'TOOL',
        content: questionToolMessage(output)
      }
    });
    const resultPart = await this.ensureToolTimelinePart(session.id, toolCall.promptId, 'tool-result', answeredToolCall.id);
    await this.createMessagePart(session.id, toolCall.promptId, toolMessage);

    const snapshot = await this.snapshot(session.id, projectId);
    await this.broadcast(projectId, {
      type: 'question-answered',
      session: snapshot,
      data: {
        toolCallId: toolCall.id,
        answers,
        part: await this.hydrateSinglePart(resultPart)
      }
    });
    return snapshot;
  }

  async subscribe(userId: string, projectId: string, res: Response, sessionId?: string): Promise<void> {
    await this.access.assertProjectAccess(userId, projectId);
    const session = sessionId
      ? await this.getSession(projectId, sessionId)
      : await this.ensureDefaultSession(projectId);
    await this.recoverOrphanedInteractiveSession(session.id);
    res.setHeader('content-type', 'text/event-stream');
    res.setHeader('cache-control', 'no-cache, no-transform');
    res.setHeader('connection', 'keep-alive');
    res.flushHeaders?.();
    const runtime = getRuntime(session.id);
    const client: RuntimeClient = {
      res,
      ready: false,
      closed: false,
      buffer: [],
      dispose: () => undefined,
      heartbeat: setInterval(() => {
        if (!client.ready || res.writableEnded) return;
        try {
          if (!res.write(': heartbeat\n\n')) client.ready = false;
        } catch {
          client.dispose();
        }
      }, 15_000)
    };
    client.dispose = () => {
      if (client.closed) return;
      client.closed = true;
      client.buffer.length = 0;
      clearInterval(client.heartbeat);
      runtime.clients.delete(client);
    };
    runtime.clients.add(client);
    res.on('drain', () => flushRuntimeClient(client));
    res.on('close', client.dispose);
    const initial = await this.snapshot(session.id, projectId);
    if (client.closed) return;
    const initialWritten = safeWriteRuntimeEvent(client, { type: 'session', session: initial });
    if (initialWritten === null) return;
    client.ready = initialWritten;
    if (client.ready) flushRuntimeClient(client);
  }

  private drain(userId: string, projectId: string, sessionId: string, upstreamAbortSignal?: AbortSignal): Promise<void> {
    const runtime = getRuntime(sessionId);
    if (runtime.drainPromise) {
      runtime.drainAgain = true;
      return runtime.drainPromise;
    }
    runtime.drainAgain = false;
    const abortFromUpstream = () => runtime.abortController?.abort();
    upstreamAbortSignal?.addEventListener('abort', abortFromUpstream);
    const promise = this.drainOwned(userId, projectId, sessionId, upstreamAbortSignal).finally(() => {
      upstreamAbortSignal?.removeEventListener('abort', abortFromUpstream);
      if (runtime.drainPromise === promise) runtime.drainPromise = null;
      const drainAgain = runtime.drainAgain;
      runtime.drainAgain = false;
      if (drainAgain) {
        queueMicrotask(() => {
          void this.drain(userId, projectId, sessionId, upstreamAbortSignal).catch(() => undefined);
        });
      }
    });
    runtime.drainPromise = promise;
    return promise;
  }

  private async drainOwned(
    userId: string,
    projectId: string,
    sessionId: string,
    upstreamAbortSignal?: AbortSignal
  ): Promise<void> {
    const runtime = getRuntime(sessionId);
    if (runtime.abortController || runtime.cancelPending) return;
    const controllerState = { current: new AbortController() };
    runtime.abortController = controllerState.current;
    if (upstreamAbortSignal?.aborted) controllerState.current.abort();
    try {
      await this.drainControlled(
        userId,
        projectId,
        sessionId,
        runtime,
        controllerState,
        upstreamAbortSignal
      );
    } finally {
      if (runtime.abortController === controllerState.current) {
        runtime.abortController = null;
      }
    }
  }

  private async drainControlled(
    userId: string,
    projectId: string,
    sessionId: string,
    runtime: RuntimeSession,
    controllerState: { current: AbortController },
    upstreamAbortSignal?: AbortSignal
  ): Promise<void> {
    const session = await this.getSession(projectId, sessionId);
    await this.recoverOrphanedInteractiveSession(session.id, true);

    while (true) {
      if (runtime.cancelPending || controllerState.current.signal.aborted) return;
      const queued = await this.prisma.aiAgentPrompt.findFirst({
        where: { sessionId: session.id, status: 'QUEUED' },
        orderBy: [{ order: 'asc' }, { createdAt: 'asc' }]
      });
      if (!queued) return;

      const claimed = await this.claimQueuedPrompt(session.id, queued.id);
      if (!claimed) return;
      const controller = controllerState.current;
      if (runtime.cancelPending || controller.signal.aborted) {
        await this.abandonClaimedPromptBeforeExecution(session.id, queued.id);
        return;
      }
      const activeUserMessage = await this.prisma.aiAgentMessage.create({
        data: { sessionId: session.id, role: 'USER', content: queued.prompt }
      });
      const assistantMessage = await this.prisma.aiAgentMessage.create({
        data: { sessionId: session.id, role: 'ASSISTANT', content: '' }
      });
      if (runtime.cancelPending || controller.signal.aborted) {
        await this.abandonClaimedPromptBeforeExecution(
          session.id,
          queued.id,
          [activeUserMessage.id, assistantMessage.id]
        );
        return;
      }
      await this.createMessagePart(session.id, queued.id, activeUserMessage);
      if (runtime.cancelPending || controller.signal.aborted) {
        await this.abandonClaimedPromptBeforeExecution(
          session.id,
          queued.id,
          [activeUserMessage.id, assistantMessage.id]
        );
        return;
      }

      await this.broadcast(projectId, {
        type: 'prompt-started',
        session: await this.snapshot(session.id, projectId),
        data: { promptId: queued.id }
      });

      let assistantText = '';
      let activeTextPart: StoredSessionPart | null = null;
      let pendingText = '';
      let lastTextFlushAt = Date.now();
      const outerOwnedToolCalls = new Set<string>();
      const flushText = async (force: boolean): Promise<void> => {
        if (!pendingText) return;
        if (!force && pendingText.length < 64 && (Date.now() - lastTextFlushAt < 250 || pendingText.length < 8)) return;
        const delta = pendingText;
        pendingText = '';
        await this.prisma.aiAgentMessage.update({
          where: { id: assistantMessage.id },
          data: { content: assistantText }
        });
        activeTextPart = activeTextPart
          ? await this.updateTextPart(activeTextPart, readPartText(activeTextPart) + delta, true)
          : await this.createTextPart(session.id, queued.id, assistantMessage.id, delta);
        lastTextFlushAt = Date.now();
        await this.broadcast(projectId, {
          type: 'text-delta',
          data: { promptId: queued.id, text: delta, part: toTextTimelinePart(activeTextPart) }
        }, session.id);
      };
      const promptPayload = parsePromptPayload(queued.prompt);
      try {
        if (controller.signal.aborted) {
          throw new AgentStreamAbort('Agent prompt was cancelled before execution');
        }
        const agents = await loadAiAgents(this.prisma, projectId);
        const activeAgent = promptPayload.agent ? findAgent(agents, promptPayload.agent) : undefined;
        const selectedModelId = activeAgent?.model ?? promptPayload.model;
        const model = await loadAiModelForProject(this.prisma, projectId, selectedModelId);
        const { systemPrompt, userPrompt, skillAllowedTools } = await this.buildPrompts(
          projectId,
          session.id,
          promptPayload.prompt,
          promptPayload.attachments,
          activeAgent,
          agents,
          activeUserMessage.id,
          assistantMessage.id,
          promptPayload.taskContract,
          promptPayload.buildRunId,
          promptPayload.approvalMode
        );
        const messagePrompt = modelContent(userPrompt, promptPayload.attachments);
        const messages = [{ role: 'user' as const, content: messagePrompt }] as NonNullable<Parameters<typeof streamText>[0]['messages']>;
        if (controller.signal.aborted) {
          throw new AgentStreamAbort('Agent prompt was cancelled before execution');
        }
        const result = streamText({
          model,
          abortSignal: controller.signal,
          tools: this.buildAgentTools(projectId, session.id, queued.id, userId, agents, activeAgent, promptPayload.taskContract, skillAllowedTools, promptPayload.buildRunId, promptPayload.approvalMode),
          stopWhen: stepCountIs(stepLimitForTask(promptPayload.taskContract)),
          system: systemPrompt,
          messages,
          providerOptions: providerOptionsForAiModel(model)
        });

        for await (const part of result.fullStream) {
          const type = String(part.type);
          const terminal = classifyAgentStreamTerminal(part);
          if (terminal?.kind === 'abort') throw new AgentStreamAbort(terminal.message);
          if (terminal?.kind === 'error') throw new AgentStreamFailure(terminal.message);
          if (type === 'text-delta') {
            const text = readTextDelta(part);
            if (!text) continue;
            assistantText += text;
            pendingText += text;
            await flushText(false);
          } else if (
            type === 'tool-call' ||
            type === 'tool-input-available' ||
            type === 'tool-approval-request'
          ) {
            await flushText(true);
            if (activeTextPart) {
              await this.finishTextPart(activeTextPart);
              activeTextPart = null;
            }
            const parsedTool = parseToolPart(part);
            const invalidToolCall = objectRecord(part)?.invalid === true;
            const handlerOwned = Boolean(parsedTool && isHandlerManagedTool(parsedTool.toolName) && !invalidToolCall);
            if (parsedTool && !shouldBroadcastOuterToolEvent(parsedTool.toolName, type, handlerOwned)) continue;
            const persisted = await this.persistToolCall(session.id, queued.id, part);
            if (parsedTool?.toolCallId && isHandlerManagedTool(parsedTool.toolName) && !handlerOwned) {
              outerOwnedToolCalls.add(parsedTool.toolCallId);
            }
            const timelinePart = persisted
              ? await this.ensureToolTimelinePart(session.id, queued.id, 'tool-call', persisted.id)
              : null;
            await this.broadcast(projectId, {
              type: 'tool-call',
              session: await this.snapshot(session.id, projectId),
              data: mergeEventPart(persisted ?? part, timelinePart ? await this.hydrateSinglePart(timelinePart) : null)
            });
          } else if (
            type === 'tool-result' ||
            type === 'tool-output-available' ||
            type === 'tool-error' ||
            type === 'tool-output-error' ||
            type === 'tool-input-error' ||
            type === 'tool-output-denied'
          ) {
            await flushText(true);
            if (activeTextPart) {
              await this.finishTextPart(activeTextPart);
              activeTextPart = null;
            }
            if (type === 'tool-input-error') await this.persistToolCall(session.id, queued.id, part);
            const parsedResult = parseToolResultPart(part);
            let handlerCall = parsedResult?.toolCallId
              ? await this.prisma.aiAgentToolCall.findFirst({
                  where: { sessionId: session.id, toolCallId: parsedResult.toolCallId },
                  select: { toolName: true }
                })
              : null;
            const eventToolName = stringValue(objectRecord(part)?.toolName) ?? handlerCall?.toolName ?? null;
            const handlerOwned = Boolean(handlerCall)
              && Boolean(parsedResult?.toolCallId)
              && !outerOwnedToolCalls.has(parsedResult!.toolCallId!);
            if (eventToolName && !shouldBroadcastOuterToolEvent(eventToolName, type, handlerOwned)) continue;
            if (!handlerCall && parsedResult?.toolCallId) {
              await this.persistToolCall(session.id, queued.id, part);
              handlerCall = await this.prisma.aiAgentToolCall.findFirst({
                where: { sessionId: session.id, toolCallId: parsedResult.toolCallId },
                select: { toolName: true }
              });
            }
            const persisted = await this.persistToolResult(
              session.id,
              part,
              type !== 'tool-result' && type !== 'tool-output-available'
            );
            if (parsedResult?.toolCallId) outerOwnedToolCalls.delete(parsedResult.toolCallId);
            const timelinePart = persisted
              ? await this.ensureToolTimelinePart(session.id, queued.id, 'tool-result', persisted.id)
              : null;
            await this.broadcast(projectId, {
              type: 'tool-result',
              session: await this.snapshot(session.id, projectId),
              data: mergeEventPart(persisted ?? part, timelinePart ? await this.hydrateSinglePart(timelinePart) : null)
            });
          } else if (type === 'finish' || type === 'finish-step') {
            const usage = usageFromPart(part, selectedModelId);
            if (usage) await this.saveContextUsage(session.id, usage);
          }
        }

        await flushText(true);
        if (activeTextPart) {
          await this.finishTextPart(activeTextPart);
          activeTextPart = null;
        }

        if (controller.signal.aborted) {
          throw new AgentStreamAbort('Agent prompt was cancelled before completion');
        }
        const completed = await this.completeClaimedPrompt(session.id, queued.id);
        if (!completed) {
          throw new AgentStreamAbort('Agent prompt was cancelled before completion');
        }
        await this.broadcast(projectId, {
          type: 'prompt-finished',
          session: await this.snapshot(session.id, projectId),
          data: { promptId: queued.id }
        });
      } catch (error) {
        await flushText(true);
        if (activeTextPart) await this.finishTextPart(activeTextPart);
        const aborted = controller.signal.aborted || error instanceof AgentStreamAbort;
        await this.failRunningToolCalls(session.id, queued.id, aborted ? 'Agent prompt was cancelled' : errorMessage(error));
        await this.prisma.aiAgentPrompt.updateMany({
          where: { id: queued.id, sessionId: session.id, status: 'RUNNING' },
          data: { status: aborted ? 'CANCELLED' : 'ERROR' }
        });
        await this.prisma.projectAiAgentSession.updateMany({
          where: { id: session.id, status: 'RUNNING', activePromptId: queued.id },
          data: {
            status: aborted ? 'CANCELLED' : 'ERROR',
            activePromptId: null,
            lastError: aborted
              ? null
              : mergeSessionMeta(null, {
                  error: errorMessage(error),
                  contextUsage: usageFromError(error, promptPayload.model)
                })
          }
        });
        const snapshot = await this.snapshot(session.id, projectId);
        await this.broadcast(projectId, {
          type: aborted ? 'session' : 'error',
          session: snapshot,
          data: {
            promptId: queued.id,
            message: snapshot.error ?? errorMessage(error),
            contextUsage: snapshot.contextUsage
          }
        });
      }
      if (!this.rotateDrainController(runtime, controllerState, upstreamAbortSignal)) return;
    }
  }

  private claimQueuedPrompt(sessionId: string, promptId: string): Promise<boolean> {
    return this.prisma.$transaction(async (tx) => {
      const promptClaim = await tx.aiAgentPrompt.updateMany({
        where: { id: promptId, sessionId, status: 'QUEUED' },
        data: { status: 'RUNNING' }
      });
      if (promptClaim.count !== 1) return false;
      const sessionClaim = await tx.projectAiAgentSession.updateMany({
        where: { id: sessionId, status: { not: 'RUNNING' }, activePromptId: null },
        data: { status: 'RUNNING', activePromptId: promptId, lastError: null }
      });
      if (sessionClaim.count !== 1) throw new PromptClaimRaceError();
      return true;
    }).catch((error) => {
      if (error instanceof PromptClaimRaceError) return false;
      throw error;
    });
  }

  private completeClaimedPrompt(sessionId: string, promptId: string): Promise<boolean> {
    return this.prisma.$transaction(async (tx) => {
      const promptCompletion = await tx.aiAgentPrompt.updateMany({
        where: { id: promptId, sessionId, status: 'RUNNING' },
        data: { status: 'COMPLETED' }
      });
      if (promptCompletion.count !== 1) throw new PromptCompletionRaceError();
      const sessionCompletion = await tx.projectAiAgentSession.updateMany({
        where: { id: sessionId, status: 'RUNNING', activePromptId: promptId },
        data: { status: 'IDLE', activePromptId: null }
      });
      if (sessionCompletion.count !== 1) throw new PromptCompletionRaceError();
      return true;
    }).catch((error) => {
      if (error instanceof PromptCompletionRaceError) return false;
      throw error;
    });
  }

  private async abandonClaimedPromptBeforeExecution(
    sessionId: string,
    promptId: string,
    messageIds: string[] = []
  ): Promise<void> {
    if (messageIds.length) {
      await this.prisma.aiAgentSessionPart.deleteMany({
        where: { sessionId, promptId, messageId: { in: messageIds } }
      });
      await this.prisma.aiAgentMessage.deleteMany({
        where: { sessionId, id: { in: messageIds } }
      });
    }
    await this.prisma.$transaction(async (tx) => {
      await tx.aiAgentPrompt.updateMany({
        where: { id: promptId, sessionId, status: 'RUNNING' },
        data: { status: 'CANCELLED' }
      });
      await tx.projectAiAgentSession.updateMany({
        where: { id: sessionId, status: 'RUNNING', activePromptId: promptId },
        data: { status: 'CANCELLED', activePromptId: null, lastError: null }
      });
    });
  }

  private rotateDrainController(
    runtime: RuntimeSession,
    controllerState: { current: AbortController },
    upstreamAbortSignal?: AbortSignal
  ): boolean {
    if (runtime.cancelPending) return false;
    const nextController = new AbortController();
    if (upstreamAbortSignal?.aborted) nextController.abort();
    controllerState.current = nextController;
    runtime.abortController = nextController;
    return true;
  }

  private async ensureDefaultSession(projectId: string) {
    const existing = await this.prisma.projectAiAgentSession.findFirst({
      where: { projectId },
      orderBy: { createdAt: 'asc' }
    });
    if (existing) return existing;
    return this.prisma.projectAiAgentSession.create({
      data: { projectId, title: 'General' }
    });
  }

  private async getSession(projectId: string, sessionId: string) {
    const session = await this.prisma.projectAiAgentSession.findFirst({
      where: { id: sessionId, projectId }
    });
    if (!session) throw new HttpError(404, 'AI session not found');
    return session;
  }

  private async snapshot(sessionId: string, projectId: string): Promise<AiAgentSession> {
    const [session, messages, prompts, pendingToolCalls, recentToolCalls, parts] = await Promise.all([
      this.prisma.projectAiAgentSession.findUniqueOrThrow({ where: { id: sessionId } }),
      this.prisma.aiAgentMessage.findMany({
        where: { sessionId },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: 201
      }),
      this.prisma.aiAgentPrompt.findMany({
        where: { sessionId, status: { in: ['QUEUED', 'RUNNING'] } },
        orderBy: [{ order: 'asc' }, { createdAt: 'asc' }]
      }),
      this.prisma.aiAgentToolCall.findMany({
        where: { sessionId, status: 'PENDING_APPROVAL' },
        orderBy: { createdAt: 'asc' }
      }),
      this.prisma.aiAgentToolCall.findMany({
        where: { sessionId },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: 201
      }),
      this.prisma.aiAgentSessionPart.findMany({
        where: { sessionId },
        orderBy: { sequence: 'desc' },
        take: SESSION_TIMELINE_PART_LIMIT + 1
      })
    ]);
    const messagesTruncated = messages.length > 200;
    const toolsTruncated = recentToolCalls.length > 200;
    const recentMessages = messages.slice(0, 200);
    const recentTools = recentToolCalls.slice(0, 200);
    const messageIds = [...new Set(parts.flatMap((part) => part.messageId ? [part.messageId] : []))];
    const toolCallIds = [...new Set(parts.flatMap((part) => part.toolCallId ? [part.toolCallId] : []))];
    const [referencedMessages, referencedToolCalls] = await Promise.all([
      messageIds.length ? this.prisma.aiAgentMessage.findMany({ where: { sessionId, id: { in: messageIds } } }) : [],
      toolCallIds.length ? this.prisma.aiAgentToolCall.findMany({ where: { sessionId, id: { in: toolCallIds } } }) : []
    ]);
    const mappedMessages = [...recentMessages].reverse().map(toMessage);
    const mappedToolCalls = [...recentTools].reverse().map((toolCall) => toToolCall(toolCall));
    const hydrationMessages = dedupeById([...recentMessages, ...referencedMessages]).map(toMessage);
    const hydrationToolCalls = dedupeById([...recentTools, ...referencedToolCalls]).map((toolCall) => toToolCall(toolCall));
    const compatibilityHasMore = hasUncoveredTruncatedCompatibility(
      parts,
      messages,
      recentToolCalls,
      messagesTruncated,
      toolsTruncated
    );
    const projection = buildSessionTimelineProjection(parts, hydrationMessages, hydrationToolCalls, {
      maxPersistedParts: SESSION_TIMELINE_PART_LIMIT,
      hasMoreBefore: compatibilityHasMore
    });
    return {
      id: session.id,
      projectId,
      title: session.title ?? defaultSessionTitle(session.createdAt),
      approvalMode: fromPrismaApprovalMode(session.approvalMode),
      status: toSessionStatus(session.status),
      activePromptId: session.activePromptId,
      queue: prompts.map(toQueuedPrompt),
      messages: mappedMessages,
      toolCalls: mappedToolCalls,
      timeline: projection.timeline,
      timelineInfo: {
        ...projection.timelineInfo,
        legacyCursor: compatibilityHasMore
          ? legacyCursorForUncoveredCompatibility(parts, recentMessages, recentTools, projection.timelineInfo.earliestSequence ?? 0)
            ?? legacyCursorForCompatibilityBoundary(recentMessages, recentTools, projection.timelineInfo.earliestSequence ?? 0)
          : null
      },
      pendingToolCalls: pendingToolCalls.map((toolCall) => toToolCall(toolCall)),
      activeBuildRunId: session.activeBuildRunId,
      contextUsage: contextUsageFromSession(session.lastError),
      error: sessionErrorFromSession(session.lastError),
      updatedAt: session.updatedAt.toISOString()
    };
  }

  private async legacyTimelinePage(
    sessionId: string,
    beforeSequence: number | undefined,
    limit: number,
    legacyCursor?: string
  ): Promise<AiAgentTimelinePage> {
    const cursor = parseLegacyTimelineCursor(legacyCursor);
    const sourceLimit = Math.max(1, Math.floor(limit / 2));
    const cursorWhere = cursor
      ? {
          OR: [
            { createdAt: { lt: cursor.createdAt } },
            { createdAt: cursor.createdAt, id: { lt: cursor.id } }
          ]
        }
      : {};
    const [messageRows, toolRows] = await Promise.all([
      this.prisma.aiAgentMessage.findMany({
        where: { sessionId, parts: { none: {} }, ...cursorWhere },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: sourceLimit + 1
      }),
      this.prisma.aiAgentToolCall.findMany({
        where: { sessionId, parts: { none: {} }, ...cursorWhere },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: sourceLimit + 1
      })
    ]);
    const sources = [
      ...messageRows.map((row) => ({ kind: 'message' as const, id: row.id, createdAt: row.createdAt, row })),
      ...toolRows.map((row) => ({ kind: 'tool' as const, id: row.id, createdAt: row.createdAt, row }))
    ].sort((left, right) =>
      right.createdAt.getTime() - left.createdAt.getTime() || right.id.localeCompare(left.id)
    );
    const selectedSources = sources.slice(0, sourceLimit);
    const selectedMessageIds = new Set(selectedSources.filter((source) => source.kind === 'message').map((source) => source.id));
    const selectedToolIds = new Set(selectedSources.filter((source) => source.kind === 'tool').map((source) => source.id));
    const hasMore = sources.length > sourceLimit;
    const projection = buildSessionTimelineProjection(
      [],
      messageRows.filter((row) => selectedMessageIds.has(row.id)).reverse().map(toMessage),
      toolRows.filter((row) => selectedToolIds.has(row.id)).reverse().map((toolCall) => toToolCall(toolCall))
    );
    // A legacy tool source can project to both call and result. Keep that pair
    // indivisible even when the requested part limit is one.
    const rawParts = projection.timeline;
    const anchor = beforeSequence ?? cursor?.beforeSequence ?? 0;
    const parts = rawParts.map((part, index) => ({
      ...part,
      sequence: anchor - rawParts.length + index
    }));
    const oldestSource = selectedSources.at(-1);
    const nextLegacyCursor = hasMore && oldestSource
      ? serializeLegacyTimelineCursor(oldestSource.createdAt, oldestSource.id, parts[0]?.sequence ?? anchor)
      : null;
    return {
      parts,
      timelineInfo: {
        mode: 'approximate',
        truncated: hasMore,
        earliestSequence: parts[0]?.sequence ?? null,
        hasMoreBefore: hasMore,
        legacyCursor: nextLegacyCursor
      },
      nextBeforeSequence: hasMore && parts.length ? parts[0]!.sequence : null,
      nextLegacyCursor,
      hasMore,
      limitation: 'legacy-history-best-effort'
    };
  }

  private async broadcast(_projectId: string, event: AiAgentSessionEvent, sessionId = event.session?.id): Promise<void> {
    if (!sessionId) return;
    for (const client of getRuntime(sessionId).clients) queueRuntimeEvent(client, event);
  }

  private async buildPrompts(
    projectId: string,
    sessionId: string,
    prompt: string,
    attachments: AiAgentAttachment[],
    activeAgent: AiAgentInfo | undefined,
    agents: AiAgentInfo[],
    activeUserMessageId: string,
    activeAssistantMessageId: string,
    taskContract: TaskContract | null,
    activeBuildRunId: string | null,
    approvalMode: AiAgentApprovalMode
  ): Promise<{ systemPrompt: string; userPrompt: string; contextPack: AssembledContextPack; skillAllowedTools: string[] | null }> {
    const project = await this.prisma.project.findUnique({
      where: { id: projectId },
      select: {
        title: true,
        genre: true,
        tone: true,
        voice: true,
        perspective: true,
        pov: true,
        themes: true
      }
    });
    const instructionDocs = await this.prisma.projectDoc.findMany({
      where: { projectId, kind: 'INSTRUCTIONS' },
      orderBy: [{ order: 'asc' }, { createdAt: 'asc' }],
      take: 5,
      include: {
        bodyWriting: { include: { defaultBranch: { include: { headVersion: true } } } }
      }
    });
    const messages = await this.prisma.aiAgentMessage.findMany({
      where: { sessionId },
      orderBy: { createdAt: 'desc' },
      // The separately rendered active request and its empty assistant row are
      // removed by id below, leaving at most twenty genuine history messages.
      take: 22
    });
    const skills = await loadAiSkillCatalog(this.prisma, projectId);
    const transcript = serializeUntrustedData('conversation-history', buildRecentTranscript(messages.reverse(), [activeUserMessageId, activeAssistantMessageId], (content) => {
      const payload = parsePromptPayload(content);
      return {
        prompt: payload.prompt,
        attachmentLabels: payload.attachments.map(attachmentLabel)
      };
    }));

    const systemPrompt = renderSystemPrompt({
      project: {
        title: '', genre: '', tone: '', voice: '', perspective: '', pov: ''
      },
      themes: '',
      instructionDocs: [],
      // Catalog descriptions can be project-authored. The runtime discovers
      // them through bounded tools and activates full instructions only in C.
      skills: [],
      subagents: []
    });
    const activeSkills = selectActiveSkills(skills, taskContract, activeAgent);
    for (const skill of activeSkills) {
      if (!skill.manifest.runtimeRoles.includes(activeAgent?.runtimeRole ?? 'orchestrator')) {
        throw new Error(`Skill ${skill.name}@${skill.manifest.version} does not authorize runtime role ${activeAgent?.runtimeRole ?? 'orchestrator'}`);
      }
    }
    const contextPack = await new ContextAssembler(this.prisma).assemble({
      projectId,
      task: taskContract,
      tokenBudget: Math.min(
        taskContract?.budget.maxInputTokens ?? 24_000,
        ...activeSkills.map((skill) => skill.manifest.context.maxTokens),
        80_000
      ),
      sectionKinds: [...new Set(activeSkills.flatMap((skill) => skill.manifest.context.sections))]
    });
    const agentPrompt = activeAgent?.prompt?.trim();
    const finalSystemPrompt = renderInferenceLayers({
      role: activeAgent?.runtimeRole ?? 'orchestrator',
      task: taskContract,
      activeSkills: activeSkills.map((skill) => ({ manifest: skill.manifest, content: skill.content, references: loadAiSkillReferences(skill) })),
      contextPack,
      runtimeInstructions: systemPrompt,
      activeAgentInstructions: agentPrompt,
      activeBuildRunId,
      approvalMode,
      userAuthority: JSON.stringify({
        explicitOwnerInstructionDocs: instructionDocs.map((doc) => ({ title: doc.title, content: bodyOf(doc.bodyWriting) }))
      }, null, 2)
    });

    const attachmentContext = await this.buildAttachmentContext(projectId, attachments);
    const uploadAttachments = attachments.filter((attachment) => !attachment.reference);
    const userPrompt = renderUserContext({
      transcript,
      prompt: attachmentContext || uploadAttachments.length
        ? `${prompt}${uploadAttachments.length ? `\n\n${serializeUntrustedData('attachment-labels', uploadAttachments.map(attachmentLabel))}` : ''}${attachmentContext ? `\n\n${serializeUntrustedData('attachment-context', attachmentContext)}` : ''}`
        : prompt
    });

    return { systemPrompt: finalSystemPrompt, userPrompt, contextPack, skillAllowedTools: activeSkills.length ? [...new Set(activeSkills.flatMap((skill) => skill.manifest.allowedTools))] : null };
  }

  private async buildAttachmentContext(projectId: string, attachments: AiAgentAttachment[]): Promise<string> {
    const sections: string[] = [];
    for (const attachment of attachments) {
      const ref = attachment.reference;
      if (!ref) continue;
      const header = `### ${attachment.name}`;
      if (ref.type === 'doc') {
        const doc = await this.prisma.projectDoc.findFirst({
          where: { id: ref.id, projectId },
          include: { folder: { select: { path: true } }, bodyWriting: { include: { defaultBranch: { include: { headVersion: true } } } } }
        });
        if (!doc) continue;
        sections.push(`${header}\nType: project doc\nPath: ${ref.path ?? (doc.folder ? `${doc.folder.path}/${doc.title}` : doc.title)}\nKind: ${doc.kind}\n\n${referenceContent(bodyOf(doc.bodyWriting), ref)}`);
      } else if (ref.type === 'chapter') {
        const chapter = await this.prisma.chapter.findFirst({
          where: { id: ref.id, projectId, deletedAt: null },
          include: { bodyWriting: { include: { defaultBranch: { include: { headVersion: true } } } } }
        });
        if (!chapter) continue;
        sections.push(`${header}\nType: chapter\nNumber: ${chapter.number}\nStatus: ${chapter.status}\nSummary: ${chapter.summary ?? ''}\n\n${referenceContent(bodyOf(chapter.bodyWriting), ref)}`);
      } else if (ref.type === 'character') {
        const character = await this.prisma.character.findFirst({
          where: { id: ref.id, projectId },
          include: {
            descriptionWriting: { include: { defaultBranch: { include: { headVersion: true } } } },
            appearanceWriting: { include: { defaultBranch: { include: { headVersion: true } } } },
            motivationWriting: { include: { defaultBranch: { include: { headVersion: true } } } },
            arcWriting: { include: { defaultBranch: { include: { headVersion: true } } } }
          }
        });
        if (!character) continue;
        sections.push(`${header}\nType: character\nRole: ${character.role ?? ''}\nAge: ${character.age ?? ''}\nOccupation: ${character.occupation ?? ''}\nTraits: ${character.traits.join(', ')}\n\nDescription:\n${referenceContent(bodyOf(character.descriptionWriting), ref)}\n\nAppearance:\n${referenceContent(bodyOf(character.appearanceWriting), ref)}\n\nMotivation:\n${referenceContent(bodyOf(character.motivationWriting), ref)}\n\nArc:\n${referenceContent(bodyOf(character.arcWriting), ref)}`);
      } else if (ref.type === 'location') {
        const location = await this.prisma.location.findFirst({
          where: { id: ref.id, projectId },
          include: {
            descriptionWriting: { include: { defaultBranch: { include: { headVersion: true } } } },
            atmosphereWriting: { include: { defaultBranch: { include: { headVersion: true } } } },
            significanceWriting: { include: { defaultBranch: { include: { headVersion: true } } } },
            sensoryWriting: { include: { defaultBranch: { include: { headVersion: true } } } }
          }
        });
        if (!location) continue;
        sections.push(`${header}\nType: location\nLocation type: ${location.type ?? ''}\n\nDescription:\n${referenceContent(bodyOf(location.descriptionWriting), ref)}\n\nAtmosphere:\n${referenceContent(bodyOf(location.atmosphereWriting), ref)}\n\nSignificance:\n${referenceContent(bodyOf(location.significanceWriting), ref)}\n\nSensory details:\n${referenceContent(bodyOf(location.sensoryWriting), ref)}`);
      } else if (ref.type === 'folder') {
        const folder = await this.prisma.projectFolder.findFirst({ where: { id: ref.id, projectId } });
        if (!folder) continue;
        const [folders, docs, assets] = await Promise.all([
          this.prisma.projectFolder.findMany({ where: { projectId, parentFolderId: folder.id }, orderBy: [{ order: 'asc' }, { name: 'asc' }], select: { id: true, name: true, path: true } }),
          this.prisma.projectDoc.findMany({ where: { projectId, folderId: folder.id }, orderBy: [{ order: 'asc' }, { title: 'asc' }], select: { id: true, title: true, kind: true } }),
          this.prisma.asset.findMany({ where: { projectId, folderId: folder.id }, orderBy: [{ order: 'asc' }, { createdAt: 'asc' }], select: { id: true, name: true, kind: true, mimeType: true, sizeBytes: true } })
        ]);
        sections.push(`${header}\nType: folder\nPath: ${folder.path}\n\n${jsonBlock({ folders, docs, assets: assets.map((asset) => ({ ...asset, sizeBytes: Number(asset.sizeBytes) })) })}`);
      } else if (ref.type === 'asset') {
        const asset = await this.prisma.asset.findFirst({ where: { id: ref.id, projectId }, include: { attachments: true } });
        if (!asset) continue;
        sections.push(`${header}\nType: asset\n\n${jsonBlock({ id: asset.id, name: asset.name, kind: asset.kind, mimeType: asset.mimeType, sizeBytes: Number(asset.sizeBytes), url: attachment.url, attachments: asset.attachments })}`);
      } else if (ref.type === 'act') {
        const act = await this.prisma.act.findFirst({ where: { id: ref.id, projectId }, include: { chapters: { where: { deletedAt: null }, orderBy: { order: 'asc' }, select: { id: true, number: true, title: true, summary: true, status: true } } } });
        if (!act) continue;
        sections.push(`${header}\nType: act\n\n${jsonBlock(act)}`);
      } else if (ref.type === 'structure') {
        const project = await this.prisma.project.findFirst({
          where: { id: projectId },
          include: { storyStructure: { include: { loglineWriting: { include: { defaultBranch: { include: { headVersion: true } } } }, outlineWriting: { include: { defaultBranch: { include: { headVersion: true } } } }, climaxWriting: { include: { defaultBranch: { include: { headVersion: true } } } } } }, obstacles: { orderBy: { order: 'asc' }, include: { descriptionWriting: { include: { defaultBranch: { include: { headVersion: true } } } }, resolutionWriting: { include: { defaultBranch: { include: { headVersion: true } } } } } } }
        });
        if (!project?.storyStructure) continue;
        sections.push(`${header}\nType: story structure\nLogline:\n${referenceContent(bodyOf(project.storyStructure.loglineWriting), ref)}\n\nOutline:\n${referenceContent(bodyOf(project.storyStructure.outlineWriting), ref)}\n\nClimax:\n${referenceContent(bodyOf(project.storyStructure.climaxWriting), ref)}\n\nObstacles:\n${jsonBlock(project.obstacles.map((obstacle) => ({ id: obstacle.id, title: obstacle.title, type: obstacle.type, description: textExcerpt(bodyOf(obstacle.descriptionWriting)), resolution: textExcerpt(bodyOf(obstacle.resolutionWriting)) })))}`);
      } else if (ref.type === 'obstacle') {
        const obstacle = await this.prisma.obstacle.findFirst({ where: { id: ref.id, projectId }, include: { descriptionWriting: { include: { defaultBranch: { include: { headVersion: true } } } }, resolutionWriting: { include: { defaultBranch: { include: { headVersion: true } } } } } });
        if (!obstacle) continue;
        sections.push(`${header}\nType: obstacle\nObstacle type: ${obstacle.type}\n\nDescription:\n${referenceContent(bodyOf(obstacle.descriptionWriting), ref)}\n\nResolution:\n${referenceContent(bodyOf(obstacle.resolutionWriting), ref)}`);
      }
    }
    return sections.join('\n\n');
  }

  private buildAgentTools(
    projectId: string,
    sessionId: string,
    promptId: string,
    userId: string,
    agents: AiAgentInfo[],
    activeAgent: AiAgentInfo | undefined,
    taskContract: TaskContract | null,
    skillAllowedTools: readonly string[] | null,
    activeBuildRunId: string | null,
    approvalMode: AiAgentApprovalMode
  ): ToolSet {
    const delegated = Boolean(activeAgent && taskContract);
    return buildAgentTools(this.prisma, { projectId, userId }, {
      handleApproval: (toolName, input, execute, toolCallId, abortSignal) =>
        this.handleApproval(sessionId, promptId, projectId, toolName, input, execute, toolCallId, abortSignal, approvalMode)
    }, {
      handleQuestion: (toolName, input, toolCallId, abortSignal) =>
        this.handleQuestion(sessionId, promptId, projectId, toolName, input, toolCallId, abortSignal)
    }, {
      handleTask: (input, toolCallId, abortSignal) =>
        this.handleTask(projectId, sessionId, promptId, userId, input, agents, activeAgent, taskContract, activeBuildRunId, toolCallId, abortSignal, approvalMode)
    }, delegated ? [] : subagentsForTask(agents), {
      role: activeAgent?.runtimeRole ?? 'orchestrator',
      taskContract,
      primary: !delegated,
      skillAllowedTools,
      approvalMode
    }) as unknown as ToolSet;
  }

  private async handleTask(
    projectId: string,
    parentSessionId: string,
    parentPromptId: string,
    userId: string,
    input: TaskToolInput,
    agents: AiAgentInfo[],
    activeAgent: AiAgentInfo | undefined,
    parentTaskContract: TaskContract | null,
    activeBuildRunId: string | null,
    toolCallId: string,
    abortSignal?: AbortSignal,
    approvalMode: AiAgentApprovalMode = 'manual'
  ): Promise<unknown> {
    const parentToolCall = await this.createProviderToolCall(
      parentSessionId,
      parentPromptId,
      toolCallId,
      'task',
      input,
      'RUNNING'
    );
    const callPart = await this.ensureToolTimelinePart(parentSessionId, parentPromptId, 'tool-call', parentToolCall.id);
    await this.broadcast(projectId, {
      type: 'tool-call',
      session: await this.snapshot(parentSessionId, projectId),
      data: mergeEventPart(toToolCall(parentToolCall), await this.hydrateSinglePart(callPart))
    });
    const { agent, contract, session, payload } = await (async () => {
      if (activeAgent && parentTaskContract) throw new HttpError(403, 'Delegated workers cannot invoke other subagents');
      const selectedAgent = findAgent(agents, input.subagent_type);
      if (!selectedAgent || (selectedAgent.mode !== 'subagent' && selectedAgent.mode !== 'all')) {
        throw new HttpError(400, `Unknown subagent type: ${input.subagent_type}`);
      }
      const currentBuildRunId = await this.resolveActiveBuildRun(projectId, parentSessionId, undefined);
      const inheritedBuildRunId = currentBuildRunId ?? activeBuildRunId;
      const selectedContract = inheritBuildRun(input.contract ?? normalizeTaskContract(input), inheritedBuildRunId);
      if (selectedContract.scope.buildRunId) {
        await this.validateRequestedBuildRun(projectId, selectedContract.scope.buildRunId);
      }
      assertNoInteractiveBuildArtifactDelegation(selectedContract);
      const selectedSession = input.task_id
        ? await this.getSession(projectId, input.task_id)
        : await this.prisma.projectAiAgentSession.create({
            data: {
              projectId,
              activeBuildRunId: selectedContract.scope.buildRunId ?? inheritedBuildRunId,
              approvalMode: toPrismaApprovalMode(approvalMode),
              title: `${input.description} (@${selectedAgent.name} subagent)`
            }
          });
      const selectedPayload = normalizePromptPayload({
        prompt: selectedContract.objective,
        model: selectedContract.modelPolicy.preferred ?? selectedAgent.model ?? null,
        attachments: [],
        agent: selectedAgent.name,
        taskContract: selectedContract,
        buildRunId: selectedContract.scope.buildRunId ?? inheritedBuildRunId,
        approvalMode
      });
      return { agent: selectedAgent, contract: selectedContract, session: selectedSession, payload: selectedPayload };
    })().catch(async (error) => {
      await this.finalizeHandlerToolCall(parentToolCall, projectId, 'ERROR', null, errorMessage(error));
      throw error;
    });
    let parentAborted = abortSignal?.aborted ?? false;
    const abortChild = () => {
      parentAborted = true;
      getRuntime(session.id).abortController?.abort();
    };
    abortSignal?.addEventListener('abort', abortChild);
    if (abortSignal?.aborted) abortChild();
    const existingChildMode = fromPrismaApprovalMode(session.approvalMode ?? 'MANUAL');
    if (input.task_id && (payload.buildRunId || existingChildMode !== approvalMode)) {
      await this.prisma.projectAiAgentSession.update({
        where: { id: session.id },
        data: {
          activeBuildRunId: payload.buildRunId,
          approvalMode: toPrismaApprovalMode(approvalMode)
        }
      });
    }
    const startedPart = await this.createTaskPart(parentSessionId, parentPromptId, {
      sessionId: session.id,
      description: input.description,
      subagentType: agent.name,
      status: 'running',
      toolCallId
    } as AiAgentSubtaskPart);
    await this.broadcast(projectId, {
      type: 'subtask-started',
      session: await this.snapshot(parentSessionId, projectId),
      data: { taskId: session.id, part: await this.hydrateSinglePart(startedPart) }
    });
    try {
      if (parentAborted) throw new AgentStreamAbort('Parent agent prompt was cancelled');
      const last = await this.prisma.aiAgentPrompt.findFirst({
        where: { sessionId: session.id },
        orderBy: { order: 'desc' },
        select: { order: true }
      });
      const childPrompt = await this.prisma.aiAgentPrompt.create({
        data: {
          sessionId: session.id,
          prompt: serializePromptPayload(payload),
          order: (last?.order ?? 0) + 1
        }
      });
      await this.drain(userId, projectId, session.id, abortSignal);
      if (parentAborted || abortSignal?.aborted) throw new AgentStreamAbort('Parent agent prompt was cancelled');
      const [result, completedSession, completedPrompt] = await Promise.all([
        this.prisma.aiAgentMessage.findFirst({
          where: { sessionId: session.id, role: 'ASSISTANT' },
          orderBy: { createdAt: 'desc' },
          select: { content: true }
        }),
        this.prisma.projectAiAgentSession.findUniqueOrThrow({ where: { id: session.id } }),
        this.prisma.aiAgentPrompt.findUniqueOrThrow({ where: { id: childPrompt.id } })
      ]);
      if (completedSession.status === 'CANCELLED' || completedPrompt.status === 'CANCELLED') {
        const message = 'Subagent was cancelled before completing its assigned task';
        const cancelledPart = await this.createTaskPart(parentSessionId, parentPromptId, {
          sessionId: session.id,
          description: input.description,
          subagentType: agent.name,
          status: 'cancelled',
          error: message,
          toolCallId
        } as unknown as AiAgentSubtaskPart);
        await this.broadcast(projectId, {
          type: 'subtask-finished',
          session: await this.snapshot(parentSessionId, projectId),
          data: { taskId: session.id, cancelled: true, part: await this.hydrateSinglePart(cancelledPart) }
        });
        await this.finalizeHandlerToolCall(parentToolCall, projectId, 'ERROR', null, message);
        throw new HandledSubtaskError(message);
      }
      if (completedSession.status !== 'IDLE' || completedPrompt.status !== 'COMPLETED') {
        throw new Error(
          completedSession.status === 'ERROR' || completedPrompt.status === 'ERROR'
            ? sessionErrorFromSession(completedSession.lastError) ?? 'Subagent failed'
            : `Subagent did not reach terminal success (session ${completedSession.status}, prompt ${completedPrompt.status})`
        );
      }
      const taskResult = {
        title: input.description,
        task_id: session.id,
        contractVersion: contract.version,
        acceptanceCriteria: contract.acceptanceCriteria,
        output: [
          `task_id: ${session.id} (subagent session id; use only to resume this subtask)`,
          '',
          '<task_result>',
          result?.content ?? '',
          '</task_result>'
        ].join('\n')
      };
      const finishedPart = await this.createTaskPart(parentSessionId, parentPromptId, {
        sessionId: session.id,
        description: input.description,
        subagentType: agent.name,
        status: 'completed',
        output: taskResult,
        toolCallId
      } as AiAgentSubtaskPart);
      await this.broadcast(projectId, {
        type: 'subtask-finished',
        session: await this.snapshot(parentSessionId, projectId),
        data: { taskId: session.id, part: await this.hydrateSinglePart(finishedPart) }
      });
      await this.finalizeHandlerToolCall(parentToolCall, projectId, 'EXECUTED', taskResult, null);
      return taskResult;
    } catch (error) {
      if (error instanceof HandledSubtaskError) throw error;
      if (error instanceof AgentStreamAbort) {
        const message = error.message || 'Parent agent prompt was cancelled';
        const cancelledPart = await this.createTaskPart(parentSessionId, parentPromptId, {
          sessionId: session.id,
          description: input.description,
          subagentType: agent.name,
          status: 'cancelled',
          error: message,
          toolCallId
        });
        await this.broadcast(projectId, {
          type: 'subtask-finished',
          session: await this.snapshot(parentSessionId, projectId),
          data: { taskId: session.id, cancelled: true, part: await this.hydrateSinglePart(cancelledPart) }
        });
        await this.finalizeHandlerToolCall(parentToolCall, projectId, 'ERROR', null, message);
        throw new HandledSubtaskError(message);
      }
      const message = errorMessage(error);
      const failedPart = await this.createTaskPart(parentSessionId, parentPromptId, {
        sessionId: session.id,
        description: input.description,
        subagentType: agent.name,
        status: 'error',
        error: message,
        toolCallId
      } as AiAgentSubtaskPart);
      await this.broadcast(projectId, {
        type: 'subtask-finished',
        session: await this.snapshot(parentSessionId, projectId),
        data: { taskId: session.id, error: message, part: await this.hydrateSinglePart(failedPart) }
      });
      await this.finalizeHandlerToolCall(parentToolCall, projectId, 'ERROR', null, message);
      throw error;
    } finally {
      abortSignal?.removeEventListener('abort', abortChild);
    }
  }

  private async handleQuestion(
    sessionId: string,
    promptId: string,
    projectId: string,
    toolName: 'askUser',
    input: unknown,
    toolCallId: string,
    abortSignal?: AbortSignal
  ): Promise<unknown> {
    const toolCall = await this.createProviderToolCall(sessionId, promptId, toolCallId, toolName, input, 'PENDING_APPROVAL');
    const timelinePart = await this.ensureToolTimelinePart(sessionId, promptId, 'tool-call', toolCall.id);
    await this.broadcast(projectId, {
      type: 'question-asked',
      session: await this.snapshot(sessionId, projectId),
      data: mergeEventPart(toToolCall(toolCall), await this.hydrateSinglePart(timelinePart))
    });
    return new Promise((resolve, reject) => {
      let abortHandled = false;
      const cleanup = () => abortSignal?.removeEventListener('abort', onAbort);
      const resolveWithCleanup = (value: unknown) => { cleanup(); resolve(value); };
      const rejectWithCleanup = (error: Error) => { cleanup(); reject(error); };
      const onAbort = () => {
        if (abortHandled) return;
        abortHandled = true;
        const message = 'Question cancelled with the active agent prompt';
        clearTimeout(timeout);
        pendingQuestions.delete(toolCall.id);
        void this.finalizeHandlerToolCall(toolCall, projectId, 'ERROR', null, message);
        rejectWithCleanup(new AgentStreamAbort(message));
      };
      const timeout = setTimeout(() => {
        cleanup();
        pendingQuestions.delete(toolCall.id);
        void (async () => {
          const failedCall = await this.prisma.aiAgentToolCall.update({
            where: { id: toolCall.id },
            data: { status: 'ERROR', error: 'Question timed out' }
          });
          const resultPart = await this.ensureToolTimelinePart(sessionId, promptId, 'tool-result', failedCall.id);
          await this.broadcast(projectId, {
            type: 'error',
            session: await this.snapshot(sessionId, projectId),
            data: { toolCallId: toolCall.id, message: 'Question timed out', part: await this.hydrateSinglePart(resultPart) }
          });
        })();
        reject(new Error('Question timed out'));
      }, QUESTION_TIMEOUT_MS);
      abortSignal?.addEventListener('abort', onAbort, { once: true });
      pendingQuestions.set(toolCall.id, { resolve: resolveWithCleanup, reject: rejectWithCleanup, timeout });
      if (abortSignal?.aborted) onAbort();
    });
  }

  private async handleApproval(
    sessionId: string,
    promptId: string,
    projectId: string,
    toolName: AgentMutatingToolName,
    input: unknown,
    execute: () => Promise<unknown>,
    toolCallId: string,
    abortSignal?: AbortSignal,
    approvalMode: AiAgentApprovalMode = 'manual'
  ): Promise<unknown> {
    if (approvalMode === 'auto') {
      return this.executeAutomaticTool(
        sessionId,
        promptId,
        projectId,
        toolName,
        input,
        execute,
        toolCallId,
        abortSignal
      );
    }
    const toolCall = await this.createProviderToolCall(sessionId, promptId, toolCallId, toolName, input, 'PENDING_APPROVAL');
    const timelinePart = await this.ensureToolTimelinePart(sessionId, promptId, 'tool-call', toolCall.id);
    await this.broadcast(projectId, {
      type: 'tool-call',
      session: await this.snapshot(sessionId, projectId),
      data: mergeEventPart(toToolCall(toolCall), await this.hydrateSinglePart(timelinePart))
    });
    return new Promise((resolve, reject) => {
      let abortHandled = false;
      const cleanup = () => abortSignal?.removeEventListener('abort', onAbort);
      const resolveWithCleanup = (value: unknown) => { cleanup(); resolve(value); };
      const rejectWithCleanup = (error: Error) => { cleanup(); reject(error); };
      const onAbort = () => {
        if (abortHandled) return;
        abortHandled = true;
        const message = `${toolName} approval was cancelled with the active agent prompt`;
        clearTimeout(timeout);
        pendingApprovals.delete(toolCall.id);
        void this.finalizeHandlerToolCall(toolCall, projectId, 'ERROR', null, message);
        rejectWithCleanup(new AgentStreamAbort(message));
      };
      const timeout = setTimeout(() => {
        cleanup();
        pendingApprovals.delete(toolCall.id);
        void (async () => {
          const failedCall = await this.prisma.aiAgentToolCall.update({
            where: { id: toolCall.id },
            data: { status: 'ERROR', error: 'Approval timed out' }
          });
          const resultPart = await this.ensureToolTimelinePart(sessionId, promptId, 'tool-result', failedCall.id);
          await this.broadcast(projectId, {
            type: 'error',
            session: await this.snapshot(sessionId, projectId),
            data: { toolCallId: toolCall.id, message: 'Approval timed out', part: await this.hydrateSinglePart(resultPart) }
          });
        })();
        reject(new Error('Approval timed out'));
      }, APPROVAL_TIMEOUT_MS);
      abortSignal?.addEventListener('abort', onAbort, { once: true });
      pendingApprovals.set(toolCall.id, { resolve: resolveWithCleanup, reject: rejectWithCleanup, execute, timeout });
      if (abortSignal?.aborted) onAbort();
    });
  }

  private async executeAutomaticTool(
    sessionId: string,
    promptId: string,
    projectId: string,
    toolName: AgentMutatingToolName,
    input: unknown,
    execute: () => Promise<unknown>,
    toolCallId: string,
    abortSignal?: AbortSignal
  ): Promise<unknown> {
    abortSignal?.throwIfAborted();
    const toolCall = await this.createProviderToolCall(
      sessionId,
      promptId,
      toolCallId,
      toolName,
      input,
      'RUNNING'
    );
    const callPart = await this.ensureToolTimelinePart(sessionId, promptId, 'tool-call', toolCall.id);
    await this.broadcast(projectId, {
      type: 'tool-call',
      session: await this.snapshot(sessionId, projectId),
      data: mergeEventPart(toToolCall(toolCall), await this.hydrateSinglePart(callPart))
    });
    try {
      abortSignal?.throwIfAborted();
      const output = await execute();
      if (toolName === 'startNovelBuild') await this.bindStartedBuild(projectId, sessionId, output);
      await this.finalizeHandlerToolCall(toolCall, projectId, 'EXECUTED', output, null);
      return output;
    } catch (error) {
      const message = errorMessage(error);
      await this.finalizeHandlerToolCall(toolCall, projectId, 'ERROR', null, message);
      throw error;
    }
  }

  private async bindStartedBuild(projectId: string, sessionId: string, output: unknown): Promise<void> {
    const buildRunId = stringValue(objectRecord(output)?.id);
    if (!buildRunId) return;
    await this.validateRequestedBuildRun(projectId, buildRunId);
    await this.prisma.projectAiAgentSession.update({
      where: { id: sessionId },
      data: { activeBuildRunId: buildRunId }
    });
  }

  private async applyToolCallApproval(
    userId: string,
    projectId: string,
    sessionId: string,
    toolCall: { id: string; promptId: string | null; toolName: string; input: unknown },
    approved: boolean
  ): Promise<void> {
    const pendingRuntime = pendingApprovals.get(toolCall.id);
    const claimed = await this.prisma.aiAgentToolCall.updateMany({
      where: { id: toolCall.id, status: 'PENDING_APPROVAL' },
      data: {
        status: approved ? 'APPROVED' : 'REJECTED',
        decidedAt: new Date(),
        decidedById: userId
      }
    });
    if (claimed.count !== 1) {
      const current = await this.prisma.aiAgentToolCall.findUniqueOrThrow({ where: { id: toolCall.id } });
      if (
        approved
        && !pendingRuntime
        && (current.status === 'APPROVED' || current.status === 'RUNNING')
        && IDEMPOTENT_APPROVAL_RECOVERY_TOOLS.has(current.toolName)
      ) {
        await this.recoverApprovedToolCall(userId, projectId, sessionId, current);
        return;
      }
      if (!pendingRuntime && (current.status === 'APPROVED' || current.status === 'RUNNING')) {
        const message = `${current.toolName} was interrupted after approval and cannot be replayed safely. Submit the action again in a new prompt.`;
        await this.failOrphanedInteractiveRun(sessionId, current.promptId, message, current.id);
      }
      throw new HttpError(409, `Tool call was already ${current.status.toLowerCase().replaceAll('_', ' ')}`);
    }

    if (!approved) {
      const rejectedCall = await this.prisma.aiAgentToolCall.findUniqueOrThrow({ where: { id: toolCall.id } });
      const pendingQuestion = pendingQuestions.get(toolCall.id);
      if (pendingQuestion) {
        clearTimeout(pendingQuestion.timeout);
        pendingQuestions.delete(toolCall.id);
        pendingQuestion.reject(new Error(`Rejected ${toolCall.toolName}`));
      }
      const pending = pendingApprovals.get(toolCall.id);
      if (pending) {
        clearTimeout(pending.timeout);
        pendingApprovals.delete(toolCall.id);
        pending.reject(new Error(`Rejected ${toolCall.toolName}`));
      }
      const toolMessage = await this.prisma.aiAgentMessage.create({
        data: {
          sessionId,
          role: 'TOOL',
          content: `Rejected ${toolCall.toolName}`
        }
      });
      const resultPart = await this.ensureToolTimelinePart(sessionId, toolCall.promptId, 'tool-result', rejectedCall.id);
      await this.createMessagePart(sessionId, toolCall.promptId, toolMessage);
      await this.broadcast(projectId, {
        type: 'tool-result',
        session: await this.snapshot(sessionId, projectId),
        data: mergeEventPart(toToolCall(rejectedCall), await this.hydrateSinglePart(resultPart))
      });
      if (!pendingRuntime) {
        await this.failOrphanedInteractiveRun(
          sessionId,
          toolCall.promptId,
          `${toolCall.toolName} was rejected, but the interrupted model turn cannot continue after a backend restart. Send a new prompt to proceed.`
        );
      }
      return;
    }

    if (!pendingRuntime) {
      const approvedCall = await this.prisma.aiAgentToolCall.findUniqueOrThrow({ where: { id: toolCall.id } });
      if (IDEMPOTENT_APPROVAL_RECOVERY_TOOLS.has(approvedCall.toolName)) {
        await this.recoverApprovedToolCall(userId, projectId, sessionId, approvedCall);
        return;
      }
      const message = `${approvedCall.toolName} was approved after its model turn was interrupted, but it cannot be replayed safely. Submit the action again in a new prompt.`;
      await this.failOrphanedInteractiveRun(sessionId, approvedCall.promptId, message, approvedCall.id);
      throw new HttpError(409, message);
    }

    const pending = pendingRuntime;
    try {
      if (pending) {
        clearTimeout(pending.timeout);
      }
      const output = pending
        ? await pending.execute()
        : await executeAgentMutationTool(this.prisma, { projectId, userId }, toolCall.toolName, inputRecord(toolCall.input as Prisma.JsonValue));
      if (toolCall.toolName === 'startNovelBuild') {
        const result = objectRecord(output);
        const buildRunId = stringValue(result?.id);
        if (buildRunId) {
          await this.validateRequestedBuildRun(projectId, buildRunId);
          await this.prisma.projectAiAgentSession.update({
            where: { id: sessionId },
            data: { activeBuildRunId: buildRunId }
          });
        }
      }
      const executedCall = await this.prisma.aiAgentToolCall.update({
        where: { id: toolCall.id },
        data: { status: 'EXECUTED', output: output as Prisma.InputJsonValue }
      });
      pendingApprovals.delete(toolCall.id);
      pending?.resolve(output);
      const toolMessage = await this.prisma.aiAgentMessage.create({
        data: {
          sessionId,
          role: 'TOOL',
          content: `${toolCall.toolName} approved and executed.`
        }
      });
      const resultPart = await this.ensureToolTimelinePart(sessionId, toolCall.promptId, 'tool-result', executedCall.id);
      await this.createMessagePart(sessionId, toolCall.promptId, toolMessage);
      await this.broadcast(projectId, {
        type: 'tool-result',
        session: await this.snapshot(sessionId, projectId),
        data: mergeEventPart(toToolCall(executedCall), await this.hydrateSinglePart(resultPart))
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Tool execution failed';
      const failedCall = await this.prisma.aiAgentToolCall.update({
        where: { id: toolCall.id },
        data: {
          status: 'ERROR',
          error: message
        }
      });
      if (pending) {
        clearTimeout(pending.timeout);
        pendingApprovals.delete(toolCall.id);
        pending.reject(error instanceof Error ? error : new Error(message));
      }
      const toolMessage = await this.prisma.aiAgentMessage.create({
        data: {
          sessionId,
          role: 'TOOL',
          content: `${toolCall.toolName} approval failed: ${message}`
        }
      });
      const resultPart = await this.ensureToolTimelinePart(sessionId, toolCall.promptId, 'tool-result', failedCall.id);
      await this.createMessagePart(sessionId, toolCall.promptId, toolMessage);
      await this.broadcast(projectId, {
        type: 'tool-result',
        session: await this.snapshot(sessionId, projectId),
        data: mergeEventPart(toToolCall(failedCall), await this.hydrateSinglePart(resultPart))
      });
      throw new HttpError(400, `${toolCall.toolName} approval failed: ${message}`);
    }
  }

  private async createProviderToolCall(
    sessionId: string,
    promptId: string,
    toolCallId: string,
    toolName: string,
    input: unknown,
    status: 'PENDING_APPROVAL' | 'RUNNING'
  ) {
    const existing = await this.prisma.aiAgentToolCall.findFirst({
      where: { sessionId, toolCallId }
    });
    if (existing) {
      if (existing.promptId !== promptId || existing.toolName !== toolName) {
        throw new HttpError(409, `Provider tool call ${toolCallId} is already bound to another invocation`);
      }
      return this.prisma.aiAgentToolCall.update({
        where: { id: existing.id },
        data: { input: input as Prisma.InputJsonValue }
      });
    }
    try {
      return await this.prisma.aiAgentToolCall.create({
        data: {
          sessionId,
          promptId,
          toolCallId,
          toolName,
          input: input as Prisma.InputJsonValue,
          status
        }
      });
    } catch (error) {
      if (!isUniqueConstraintError(error)) throw error;
      const raced = await this.prisma.aiAgentToolCall.findFirst({ where: { sessionId, toolCallId } });
      if (!raced || raced.promptId !== promptId || raced.toolName !== toolName) throw error;
      return raced;
    }
  }

  private async recoverApprovedToolCall(
    userId: string,
    projectId: string,
    sessionId: string,
    toolCall: {
      id: string;
      promptId: string | null;
      toolName: string;
      input: Prisma.JsonValue;
    }
  ): Promise<void> {
    try {
      const output = await executeAgentMutationTool(
        this.prisma,
        { projectId, userId },
        toolCall.toolName,
        inputRecord(toolCall.input)
      );
      const executed = await this.prisma.aiAgentToolCall.update({
        where: { id: toolCall.id },
        data: { status: 'EXECUTED', output: output as Prisma.InputJsonValue, error: null }
      });
      if (toolCall.toolName === 'startNovelBuild') {
        const buildRunId = stringValue(objectRecord(output)?.id);
        if (buildRunId) {
          await this.validateRequestedBuildRun(projectId, buildRunId);
          await this.prisma.projectAiAgentSession.update({
            where: { id: sessionId },
            data: { activeBuildRunId: buildRunId }
          });
        }
      }
      const resultPart = await this.ensureToolTimelinePart(sessionId, toolCall.promptId, 'tool-result', executed.id);
      const message = `${toolCall.toolName} completed after backend recovery, but the interrupted model turn cannot continue. Send a new prompt to proceed.`;
      await this.failOrphanedInteractiveRun(sessionId, toolCall.promptId, message);
      await this.broadcast(projectId, {
        type: 'tool-result',
        session: await this.snapshot(sessionId, projectId),
        data: mergeEventPart(toToolCall(executed), await this.hydrateSinglePart(resultPart))
      });
    } catch (error) {
      const message = `${toolCall.toolName} recovery failed: ${errorMessage(error)}`;
      await this.failOrphanedInteractiveRun(sessionId, toolCall.promptId, message, toolCall.id);
      throw new HttpError(409, message);
    }
  }

  private async failOrphanedInteractiveRun(
    sessionId: string,
    promptId: string | null,
    message: string,
    toolCallId?: string
  ): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      if (toolCallId) {
        await tx.aiAgentToolCall.updateMany({
          where: { id: toolCallId, status: { in: ['APPROVED', 'RUNNING'] } },
          data: { status: 'ERROR', error: message, decidedAt: new Date() }
        });
      }
      if (promptId) {
        await tx.aiAgentPrompt.updateMany({
          where: { id: promptId, sessionId, status: 'RUNNING' },
          data: { status: 'ERROR' }
        });
      }
      const session = await tx.projectAiAgentSession.findUnique({
        where: { id: sessionId },
        select: { lastError: true }
      });
      await tx.projectAiAgentSession.update({
        where: { id: sessionId },
        data: {
          status: 'ERROR',
          activePromptId: null,
          lastError: mergeSessionMeta(session?.lastError ?? null, { error: message })
        }
      });
    });
  }

  private async finalizeHandlerToolCall(
    toolCall: { id: string; sessionId: string; promptId: string | null },
    projectId: string,
    status: 'EXECUTED' | 'ERROR',
    output: unknown,
    error: string | null
  ): Promise<void> {
    const updated = await this.prisma.aiAgentToolCall.update({
      where: { id: toolCall.id },
      data: {
        status,
        output: status === 'EXECUTED' ? output as Prisma.InputJsonValue : undefined,
        error,
        decidedAt: new Date()
      }
    });
    const resultPart = await this.ensureToolTimelinePart(
      toolCall.sessionId,
      toolCall.promptId,
      'tool-result',
      toolCall.id
    );
    await this.broadcast(projectId, {
      type: 'tool-result',
      session: await this.snapshot(toolCall.sessionId, projectId),
      data: mergeEventPart(toToolCall(updated), await this.hydrateSinglePart(resultPart))
    });
  }

  private createMessagePart(
    sessionId: string,
    promptId: string | null,
    message: { id: string }
  ): Promise<StoredSessionPart> {
    return this.timeline.message(sessionId, promptId, message.id);
  }

  private createTextPart(
    sessionId: string,
    promptId: string,
    messageId: string,
    content: string
  ): Promise<StoredSessionPart> {
    return this.timeline.text(sessionId, promptId, messageId, content);
  }

  private updateTextPart(
    part: StoredSessionPart,
    content: string,
    streaming: boolean
  ): Promise<StoredSessionPart> {
    return this.timeline.updateText(part.id, content, streaming);
  }

  private finishTextPart(part: StoredSessionPart): Promise<StoredSessionPart> {
    return this.timeline.finishText(part);
  }

  private ensureToolTimelinePart(
    sessionId: string,
    promptId: string | null,
    kind: 'tool-call' | 'tool-result',
    toolCallId: string
  ): Promise<StoredSessionPart> {
    return this.timeline.tool(sessionId, promptId, kind, toolCallId);
  }

  private createTaskPart(
    sessionId: string,
    promptId: string,
    task: AiAgentSubtaskPart
  ): Promise<StoredSessionPart> {
    return this.timeline.task(sessionId, promptId, task);
  }

  private async hydrateSinglePart(part: StoredSessionPart): Promise<AiAgentSessionPart | null> {
    const [message, toolCall] = await Promise.all([
      part.messageId
        ? this.prisma.aiAgentMessage.findUnique({ where: { id: part.messageId } })
        : null,
      part.toolCallId
        ? this.prisma.aiAgentToolCall.findUnique({ where: { id: part.toolCallId } })
        : null
    ]);
    return hydrateSessionPart(
      part,
      new Map(message ? [[message.id, toMessage(message)]] : []),
      new Map(toolCall ? [[toolCall.id, toToolCall(toolCall)]] : [])
    );
  }

  private async validateRequestedBuildRun(
    projectId: string,
    requested: string | null | undefined
  ): Promise<string | null> {
    if (requested === null) return null;
    if (typeof requested === 'string' && requested.trim()) {
      const buildRunId = requested.trim();
      const exists = await this.prisma.buildRun.findFirst({
        where: { id: buildRunId, projectId },
        select: { id: true }
      });
      if (!exists) throw new HttpError(404, 'Novel Build not found for this project');
      return exists.id;
    }
    const active = await this.prisma.buildRun.findFirst({
      where: { projectId, status: { in: ['PLANNING', 'DRAFTING', 'REVISING', 'PAUSED'] } },
      orderBy: { updatedAt: 'desc' },
      select: { id: true }
    });
    return active?.id ?? null;
  }

  private async resolveActiveBuildRun(
    projectId: string,
    sessionId: string,
    requested: string | null | undefined
  ): Promise<string | null> {
    if (requested === null) {
      await this.prisma.projectAiAgentSession.update({
        where: { id: sessionId },
        data: { activeBuildRunId: null }
      });
      return null;
    }
    if (typeof requested === 'string' && requested.trim()) {
      const buildRunId = await this.validateRequestedBuildRun(projectId, requested);
      await this.prisma.projectAiAgentSession.update({
        where: { id: sessionId },
        data: { activeBuildRunId: buildRunId }
      });
      return buildRunId;
    }
    const session = await this.prisma.projectAiAgentSession.findUniqueOrThrow({
      where: { id: sessionId },
      select: { activeBuildRunId: true }
    });
    if (session.activeBuildRunId) {
      const current = await this.prisma.buildRun.findFirst({
        where: {
          id: session.activeBuildRunId,
          projectId,
          status: { in: ['PLANNING', 'DRAFTING', 'REVISING', 'PAUSED'] }
        },
        select: { id: true }
      });
      if (current) return current.id;
    }
    const inferred = await this.validateRequestedBuildRun(projectId, undefined);
    if (inferred !== session.activeBuildRunId) {
      await this.prisma.projectAiAgentSession.update({
        where: { id: sessionId },
        data: { activeBuildRunId: inferred }
      });
    }
    return inferred;
  }

  private async recoverOrphanedInteractiveSession(
    sessionId: string,
    ignoreRuntimeController = false
  ): Promise<boolean> {
    const current = await this.prisma.projectAiAgentSession.findUniqueOrThrow({
      where: { id: sessionId },
      select: { status: true, activePromptId: true, lastError: true }
    });
    if (
      current.status !== 'RUNNING'
      || (!ignoreRuntimeController && getRuntime(sessionId).abortController)
    ) return false;
    const message = 'The previous interactive model turn was interrupted by a backend restart. Its persisted trace is available; send or continue with a new prompt.';
    if (current.activePromptId) {
      await this.failRunningToolCalls(sessionId, current.activePromptId, message);
      await this.prisma.aiAgentPrompt.updateMany({
        where: { id: current.activePromptId, sessionId, status: 'RUNNING' },
        data: { status: 'ERROR' }
      });
    }
    const recovered = await this.prisma.projectAiAgentSession.updateMany({
      where: { id: sessionId, status: 'RUNNING', activePromptId: current.activePromptId },
      data: {
        status: 'ERROR',
        activePromptId: null,
        lastError: mergeSessionMeta(current.lastError, { error: message })
      }
    });
    return recovered.count === 1;
  }

  private async persistToolCall(sessionId: string, promptId: string, part: unknown) {
    const parsed = parseToolPart(part);
    if (!parsed?.toolCallId) return null;
    const approvalRequired = MUTATING_TOOLS.has(parsed.toolName) || parsed.toolName === 'askUser';
    return toToolCall(await this.createProviderToolCall(
      sessionId,
      promptId,
      parsed.toolCallId,
      parsed.toolName,
      parsed.input,
      approvalRequired ? 'PENDING_APPROVAL' : 'RUNNING'
    ));
  }

  private async persistToolResult(sessionId: string, part: unknown, failed = false) {
    const parsed = parseToolResultPart(part);
    if (!parsed?.toolCallId) return null;
    const existing = await this.prisma.aiAgentToolCall.findFirst({
      where: { sessionId, toolCallId: parsed.toolCallId },
      orderBy: { createdAt: 'desc' }
    });
    if (!existing) return null;
    const updated = await this.prisma.aiAgentToolCall.update({
      where: { id: existing.id },
      data: {
        status: failed ? 'ERROR' : 'EXECUTED',
        output: failed ? undefined : parsed.output as Prisma.InputJsonValue,
        error: failed ? parsed.error ?? errorMessage(parsed.output) : null,
        decidedAt: existing.decidedAt ?? new Date()
      }
    });
    return toToolCall(updated);
  }

  private async failRunningToolCalls(sessionId: string, promptId: string, message: string): Promise<void> {
    const running = await this.prisma.aiAgentToolCall.findMany({
      where: { sessionId, promptId, status: 'RUNNING' },
      select: { id: true }
    });
    for (const toolCall of running) {
      await this.prisma.aiAgentToolCall.update({
        where: { id: toolCall.id },
        data: { status: 'ERROR', error: message, decidedAt: new Date() }
      });
      await this.ensureToolTimelinePart(sessionId, promptId, 'tool-result', toolCall.id);
    }
  }

  private async saveContextUsage(sessionId: string, usage: UsagePayload): Promise<void> {
    const session = await this.prisma.projectAiAgentSession.findUnique({
      where: { id: sessionId },
      select: { lastError: true }
    });
    await this.prisma.projectAiAgentSession.update({
      where: { id: sessionId },
      data: { lastError: mergeSessionMeta(session?.lastError ?? null, { contextUsage: usage }) }
    });
  }

}

function getRuntime(sessionId: string): RuntimeSession {
  const existing = runtimes.get(sessionId);
  if (existing) return existing;
  const runtime: RuntimeSession = {
    clients: new Set(),
    abortController: null,
    drainPromise: null,
    drainAgain: false,
    cancelPending: 0
  };
  runtimes.set(sessionId, runtime);
  return runtime;
}

export function assertNoInteractiveBuildArtifactDelegation(contract: TaskContract): void {
  if (
    contract.scope.buildRunId &&
    contract.outputs.some((output) => DURABLE_BUILD_OUTPUT_TYPES.has(output.type))
  ) {
    throw new HttpError(
      409,
      'Persisted Novel Build tasks must run through the authorized durable worker; do not delegate them through the generic task tool.'
    );
  }
}

function defaultSessionTitle(createdAt: Date): string {
  return `Chat ${createdAt.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`;
}

function writeEvent(res: Response, event: AiAgentSessionEvent): boolean {
  return res.write(`data: ${JSON.stringify(event)}\n\n`);
}

function safeWriteRuntimeEvent(client: RuntimeClient, event: AiAgentSessionEvent): boolean | null {
  try {
    return writeEvent(client.res, event);
  } catch {
    client.dispose();
    return null;
  }
}

function queueRuntimeEvent(client: RuntimeClient, event: AiAgentSessionEvent): void {
  if (client.closed) return;
  if (!client.ready) {
    if (client.buffer.length >= 256) {
      const deltaIndex = client.buffer.findIndex((candidate) => candidate.type === 'text-delta');
      client.buffer.splice(deltaIndex >= 0 ? deltaIndex : 0, 1);
    }
    client.buffer.push(event);
    return;
  }
  const written = safeWriteRuntimeEvent(client, event);
  if (written !== true) client.ready = false;
}

function flushRuntimeClient(client: RuntimeClient): void {
  if (client.closed) return;
  client.ready = true;
  while (client.ready && client.buffer.length) {
    const event = client.buffer.shift()!;
    const written = safeWriteRuntimeEvent(client, event);
    if (written !== true) client.ready = false;
  }
}

function toQueuedPrompt(prompt: {
  id: string;
  prompt: string;
  status: 'QUEUED' | 'RUNNING' | 'COMPLETED' | 'CANCELLED' | 'ERROR';
  createdAt: Date;
}): AiAgentQueuedPrompt {
  const payload = parsePromptPayload(prompt.prompt);
  return {
    id: prompt.id,
    prompt: payload.prompt,
    model: payload.model,
    attachments: payload.attachments,
    status: toPromptStatus(prompt.status),
    createdAt: prompt.createdAt.toISOString()
  };
}

function toMessage(message: {
  id: string;
  role: 'USER' | 'ASSISTANT' | 'SYSTEM' | 'TOOL';
  content: string;
  createdAt: Date;
}): AiAgentMessage {
  const role = toMessageRole(message.role);
  const payload = role === 'user' ? parsePromptPayload(message.content) : null;
  return {
    id: message.id,
    role,
    content: payload?.prompt ?? message.content,
    model: payload?.model,
    attachments: payload?.attachments,
    createdAt: message.createdAt.toISOString()
  };
}

export function toToolCall(toolCall: {
  id: string;
  toolCallId: string | null;
  toolName: string;
  input: Prisma.JsonValue;
  status: 'PENDING_APPROVAL' | 'APPROVED' | 'REJECTED' | 'RUNNING' | 'EXECUTED' | 'ERROR';
  output: Prisma.JsonValue | null;
  error: string | null;
  createdAt: Date;
  decidedAt: Date | null;
}, options: { fullOutput?: boolean; fullInput?: boolean } = {}): AiAgentToolCall {
  const projectedInput = projectToolInput(toolCall.input, options.fullInput === true);
  const projected = projectToolOutput(toolCall.output, options.fullOutput === true);
  return {
    id: toolCall.id,
    toolCallId: toolCall.toolCallId,
    toolName: toolCall.toolName,
    input: projectedInput.value,
    inputTruncated: projectedInput.truncated,
    inputBytes: projectedInput.bytes,
    status: toToolCallStatus(toolCall.status),
    output: projected.output,
    outputTruncated: projected.truncated,
    outputBytes: projected.bytes,
    error: toolCall.error,
    createdAt: toolCall.createdAt.toISOString(),
    decidedAt: toolCall.decidedAt ? toolCall.decidedAt.toISOString() : null
  };
}

export function projectToolOutput(output: Prisma.JsonValue | null | undefined, full: boolean): {
  output: unknown;
  truncated: boolean;
  bytes: number;
} {
  if (output == null) return { output: null, truncated: false, bytes: 0 };
  const serialized = JSON.stringify(output);
  const bytes = Buffer.byteLength(serialized, 'utf8');
  if (full || bytes <= TOOL_OUTPUT_SNAPSHOT_BYTES) return { output, truncated: false, bytes };
  return {
    output: {
      type: 'opentales.truncatedToolOutput',
      preview: serialized.slice(0, TOOL_OUTPUT_SNAPSHOT_BYTES),
      message: `Tool output truncated in session snapshots (${bytes} bytes). Fetch tool-call detail for the full output.`
    },
    truncated: true,
    bytes
  };
}

export function projectToolInput(input: Prisma.JsonValue, full: boolean): {
  value: unknown;
  truncated: boolean;
  bytes: number;
} {
  return projectToolValue(input, full, 'input');
}

function projectToolValue(
  value: Prisma.JsonValue,
  full: boolean,
  label: 'input' | 'output'
): { value: unknown; truncated: boolean; bytes: number } {
  const serialized = JSON.stringify(value);
  const bytes = Buffer.byteLength(serialized, 'utf8');
  if (full || bytes <= TOOL_OUTPUT_SNAPSHOT_BYTES) return { value, truncated: false, bytes };
  return {
    value: {
      type: `opentales.truncatedTool${label === 'input' ? 'Input' : 'Output'}`,
      preview: serialized.slice(0, TOOL_OUTPUT_SNAPSHOT_BYTES),
      message: `Tool ${label} truncated in session snapshots (${bytes} bytes). Fetch tool-call detail for the full value.`
    },
    truncated: true,
    bytes
  };
}

function toSessionStatus(status: 'IDLE' | 'RUNNING' | 'CANCELLED' | 'ERROR'): AiAgentSession['status'] {
  return status === 'RUNNING'
    ? 'running'
    : status === 'CANCELLED'
      ? 'cancelled'
      : status === 'ERROR'
        ? 'error'
        : 'idle';
}

function toPromptStatus(status: 'QUEUED' | 'RUNNING' | 'COMPLETED' | 'CANCELLED' | 'ERROR') {
  return status === 'RUNNING'
    ? 'running'
    : status === 'COMPLETED'
      ? 'completed'
      : status === 'CANCELLED'
        ? 'cancelled'
        : status === 'ERROR'
          ? 'error'
          : 'queued';
}

function toToolCallStatus(
  status: 'PENDING_APPROVAL' | 'APPROVED' | 'REJECTED' | 'RUNNING' | 'EXECUTED' | 'ERROR'
): AiAgentToolCall['status'] {
  const map = {
    PENDING_APPROVAL: 'pending-approval',
    APPROVED: 'approved',
    REJECTED: 'rejected',
    RUNNING: 'running',
    EXECUTED: 'executed',
    ERROR: 'error'
  } as const;
  return map[status];
}

function toMessageRole(role: 'USER' | 'ASSISTANT' | 'SYSTEM' | 'TOOL'): AiAgentMessage['role'] {
  const map = {
    USER: 'user',
    ASSISTANT: 'assistant',
    SYSTEM: 'system',
    TOOL: 'tool'
  } as const;
  return map[role];
}

function readTextDelta(part: unknown): string {
  if (!part || typeof part !== 'object') return '';
  const record = part as { text?: unknown; textDelta?: unknown; delta?: unknown };
  if (typeof record.text === 'string') return record.text;
  if (typeof record.textDelta === 'string') return record.textDelta;
  if (typeof record.delta === 'string') return record.delta;
  return '';
}

function parseToolPart(part: unknown):
  | { toolCallId: string | null; toolName: string; input: unknown }
  | null {
  if (!part || typeof part !== 'object') return null;
  const record = part as Record<string, unknown>;
  if (record.type === 'tool-approval-request' && record.toolCall && typeof record.toolCall === 'object') {
    const toolCall = record.toolCall as Record<string, unknown>;
    const toolName = toolCall.toolName ?? toolCall.name;
    if (typeof toolName !== 'string') return null;
    const approvalId = typeof record.approvalId === 'string' ? record.approvalId : null;
    const toolCallId = typeof toolCall.toolCallId === 'string' ? toolCall.toolCallId : approvalId;
    const input = toolCall.input ?? toolCall.args ?? {};
    return { toolCallId, toolName, input };
  }
  const toolName = record.toolName ?? record.name;
  if (typeof toolName !== 'string') return null;
  const toolCallId = typeof record.toolCallId === 'string' ? record.toolCallId : null;
  const input = record.input ?? record.args ?? {};
  return { toolCallId, toolName, input };
}

export function parseToolResultPart(part: unknown): { toolCallId: string | null; output: unknown; error: string | null } | null {
  if (!part || typeof part !== 'object') return null;
  const record = part as Record<string, unknown>;
  const toolCallId = typeof record.toolCallId === 'string' ? record.toolCallId : null;
  const output = record.output ?? record.result ?? null;
  const error = stringValue(record.errorText)
    ?? (record.error instanceof Error ? record.error.message : stringValue(record.error))
    ?? stringValue(objectRecord(record.error)?.message)
    ?? (record.type === 'tool-output-denied' ? 'Tool output was denied' : null);
  return { toolCallId, output, error };
}

function inputRecord(input: Prisma.JsonValue): Record<string, unknown> {
  return input && typeof input === 'object' && !Array.isArray(input) ? (input as Record<string, unknown>) : {};
}

function dedupeById<T extends { id: string }>(items: T[]): T[] {
  return [...new Map(items.map((item) => [item.id, item])).values()];
}

export function hasUncoveredTruncatedCompatibility(
  parts: StoredSessionPart[],
  messages: Array<{ id: string }>,
  toolCalls: Array<{ id: string; status: string }>,
  messagesTruncated: boolean,
  toolsTruncated: boolean
): boolean {
  const coveredMessages = new Set(parts.flatMap((part) => part.messageId ? [part.messageId] : []));
  const coveredCalls = new Set(parts.flatMap((part) => part.kind === 'tool-call' && part.toolCallId ? [part.toolCallId] : []));
  const coveredResults = new Set(parts.flatMap((part) => part.kind === 'tool-result' && part.toolCallId ? [part.toolCallId] : []));
  const uncoveredMessage = messages.some((message) => !coveredMessages.has(message.id));
  const uncoveredTool = toolCalls.some((toolCall) =>
    !coveredCalls.has(toolCall.id)
    || (!['RUNNING', 'PENDING_APPROVAL', 'APPROVED'].includes(toolCall.status) && !coveredResults.has(toolCall.id))
  );
  return (messagesTruncated && uncoveredMessage) || (toolsTruncated && uncoveredTool);
}

function legacyCursorForUncoveredCompatibility(
  parts: StoredSessionPart[],
  messages: Array<{ id: string; createdAt: Date }>,
  toolCalls: Array<{ id: string; status: string; createdAt: Date }>,
  beforeSequence: number
): string | null {
  const coveredMessages = new Set(parts.flatMap((part) => part.messageId ? [part.messageId] : []));
  const coveredCalls = new Set(parts.flatMap((part) => part.kind === 'tool-call' && part.toolCallId ? [part.toolCallId] : []));
  const coveredResults = new Set(parts.flatMap((part) => part.kind === 'tool-result' && part.toolCallId ? [part.toolCallId] : []));
  const sources = [
    ...messages.filter((message) => !coveredMessages.has(message.id)).map((message) => ({ id: message.id, createdAt: message.createdAt })),
    ...toolCalls.filter((toolCall) =>
      !coveredCalls.has(toolCall.id)
      || (!['RUNNING', 'PENDING_APPROVAL', 'APPROVED'].includes(toolCall.status) && !coveredResults.has(toolCall.id))
    ).map((toolCall) => ({ id: toolCall.id, createdAt: toolCall.createdAt }))
  ].sort((left, right) => left.createdAt.getTime() - right.createdAt.getTime() || left.id.localeCompare(right.id));
  const oldest = sources[0];
  return oldest ? serializeLegacyTimelineCursor(oldest.createdAt, oldest.id, beforeSequence) : null;
}

function legacyCursorForCompatibilityBoundary(
  messages: Array<{ id: string; createdAt: Date }>,
  toolCalls: Array<{ id: string; createdAt: Date }>,
  beforeSequence: number
): string | null {
  const oldest = [...messages, ...toolCalls]
    .map((item) => ({ id: item.id, createdAt: item.createdAt }))
    .sort((left, right) => left.createdAt.getTime() - right.createdAt.getTime() || left.id.localeCompare(right.id))[0];
  return oldest ? serializeLegacyTimelineCursor(oldest.createdAt, oldest.id, beforeSequence) : null;
}

function serializeLegacyTimelineCursor(createdAt: Date, id: string, beforeSequence: number): string {
  return Buffer.from(JSON.stringify({ v: 1, createdAt: createdAt.toISOString(), id, beforeSequence }), 'utf8').toString('base64url');
}

function parseLegacyTimelineCursor(value: string | undefined): { createdAt: Date; id: string; beforeSequence: number | null } | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(Buffer.from(value, 'base64url').toString('utf8')) as Record<string, unknown>;
    const createdAt = typeof parsed.createdAt === 'string' ? new Date(parsed.createdAt) : null;
    const id = typeof parsed.id === 'string' ? parsed.id : '';
    if (parsed.v !== 1 || !createdAt || Number.isNaN(createdAt.getTime()) || !id) throw new Error('invalid');
    const beforeSequence = typeof parsed.beforeSequence === 'number' && Number.isSafeInteger(parsed.beforeSequence)
      ? parsed.beforeSequence
      : null;
    return { createdAt, id, beforeSequence };
  } catch {
    throw new HttpError(400, 'legacyCursor is invalid');
  }
}

function mergeEventPart(value: unknown, part: AiAgentSessionPart | null): Record<string, unknown> {
  const record = value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : { value };
  return part ? { ...record, part } : record;
}

function normalizeQuestionAnswers(value: unknown): string[][] {
  if (!Array.isArray(value)) return [];
  return value.map((answer) => {
    if (!Array.isArray(answer)) return [];
    return answer
      .filter((item): item is string => typeof item === 'string')
      .map((item) => item.trim())
      .filter(Boolean);
  });
}

function validateQuestionAnswers(input: unknown, answers: string[][]): void {
  const questions = inputRecord(input as Prisma.JsonValue).questions;
  const expected = Array.isArray(questions) ? questions.length : 0;
  if (expected === 0) throw new HttpError(400, 'Question payload is malformed and cannot be answered');
  if (answers.length !== expected || answers.some((answer) => answer.length === 0)) {
    throw new HttpError(400, 'Every question requires at least one answer');
  }
}

function questionOutput(input: unknown, answers: string[][]): Prisma.JsonObject {
  const questions = inputRecord(input as Prisma.JsonValue).questions;
  const questionList = Array.isArray(questions) ? questions : [];
  const formatted = questionList
    .map((question, index) => {
      const record = question && typeof question === 'object' && !Array.isArray(question) ? question as Record<string, unknown> : {};
      const label = typeof record.question === 'string' ? record.question : `Question ${index + 1}`;
      const answer = answers[index]?.length ? answers[index].join(', ') : 'Unanswered';
      return `"${label}"="${answer}"`;
    })
    .join(', ');
  return {
    ok: true,
    tool: 'askUser',
    answers,
    message: `User answered: ${formatted || 'No answers provided'}`
  };
}

function questionToolMessage(output: Prisma.JsonObject): string {
  return typeof output.message === 'string'
    ? output.message
    : 'User answered the question.';
}

function normalizePromptPayload(payload: PromptPayload): PromptPayload {
  return {
    prompt: payload.prompt.trim(),
    model: payload.model?.trim() || null,
    attachments: sanitizeAttachments(payload.attachments),
    agent: payload.agent?.trim() || null,
    taskContract: payload.taskContract,
    buildRunId: payload.buildRunId?.trim() || null,
    approvalMode: normalizeApprovalMode(payload.approvalMode)
  };
}

function serializePromptPayload(payload: PromptPayload): string {
  if (!payload.model && !payload.agent && !payload.taskContract && !payload.buildRunId && payload.approvalMode === 'manual' && payload.attachments.length === 0) return payload.prompt;
  return JSON.stringify({
    type: 'opentales.aiPrompt',
    version: 1,
    ...payload
  });
}

function parsePromptPayload(value: string): PromptPayload {
  try {
    const parsed = JSON.parse(value) as Record<string, unknown>;
    if (parsed.type !== 'opentales.aiPrompt') throw new Error('Not an AI prompt payload');
    return normalizePromptPayload({
      prompt: typeof parsed.prompt === 'string' ? parsed.prompt : value,
      model: typeof parsed.model === 'string' ? parsed.model : null,
      attachments: sanitizeAttachments(parsed.attachments),
      agent: typeof parsed.agent === 'string' ? parsed.agent : null,
      taskContract: parseTaskContract(parsed.taskContract),
      buildRunId: typeof parsed.buildRunId === 'string' ? parsed.buildRunId : null,
      approvalMode: parsed.approvalMode === 'auto' ? 'auto' : 'manual'
    });
  } catch {
    return { prompt: value, model: null, attachments: [], agent: null, taskContract: null, buildRunId: null, approvalMode: 'manual' };
  }
}

function normalizeApprovalMode(value: unknown): AiAgentApprovalMode {
  if (value === undefined || value === null || value === 'manual') return 'manual';
  if (value === 'auto') return 'auto';
  throw new HttpError(400, 'approvalMode must be manual or auto');
}

function toPrismaApprovalMode(value: AiAgentApprovalMode): 'MANUAL' | 'AUTO' {
  return value === 'auto' ? 'AUTO' : 'MANUAL';
}

function fromPrismaApprovalMode(value: 'MANUAL' | 'AUTO'): AiAgentApprovalMode {
  return value === 'AUTO' ? 'auto' : 'manual';
}

function parseTaskContract(value: unknown): TaskContract | null {
  if (value === null || value === undefined) return null;
  try {
    return normalizeTaskContract({
      description: 'Persisted task',
      subagent_type: 'persisted',
      contract: value
    });
  } catch {
    return null;
  }
}

function inheritBuildRun(contract: TaskContract, activeBuildRunId: string | null): TaskContract {
  if (!activeBuildRunId || contract.scope.buildRunId) return contract;
  return normalizeTaskContract({
    description: 'Build-scoped delegated task',
    subagent_type: 'inherited',
    contract: {
      ...contract,
      scope: { ...contract.scope, buildRunId: activeBuildRunId }
    }
  });
}

function selectActiveSkills<T extends { name: string; manifest: { version: string; kind?: string } }>(
  skills: T[],
  task: TaskContract | null,
  agent: AiAgentInfo | undefined
): T[] {
  const declared = Object.entries(task?.skillVersions ?? {});
  if (declared.length) return declared.map(([name, version]) => {
    const skill = skills.find((candidate) => candidate.name === name);
    if (!skill) throw new Error(`Pinned skill ${name}@${version} is unavailable`);
    if (skill.manifest.version !== version) throw new Error(`Pinned skill ${name}@${version} resolved to ${skill.manifest.version}`);
    return skill;
  });
  const inferred = agentSkillName(agent?.name);
  const skill = inferred ? skills.find((candidate) => candidate.name === inferred) : undefined;
  return skill ? [skill] : [];
}

function agentSkillName(agentName: string | undefined): string | null {
  if (!agentName) return null;
  if (agentName.includes('chapter-writer') || agentName.includes('chapter-continuity')) return 'novel-chapters';
  if (agentName.includes('critic')) return 'novel-critic';
  const match = agentName.match(/^(idea|characters|settings|perspective|voice|obstacles|outline|climax)-runner$/);
  return match ? `novel-${match[1]}` : null;
}

function sanitizeAttachments(value: unknown): AiAgentAttachment[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item, index) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return [];
    const record = item as Record<string, unknown>;
    const name = typeof record.name === 'string' ? record.name.trim() : '';
    const mimeType = typeof record.mimeType === 'string' ? record.mimeType.trim() : '';
    const url = typeof record.url === 'string' ? record.url : undefined;
    if (!name || !mimeType) return [];
    const kind = record.kind === 'audio' || record.kind === 'video' || record.kind === 'document' ? record.kind : 'image';
    return [{
      id: typeof record.id === 'string' && record.id ? record.id : `attachment-${index}`,
      name,
      mimeType,
      kind,
      sizeBytes: typeof record.sizeBytes === 'number' && Number.isFinite(record.sizeBytes) ? record.sizeBytes : 0,
      url,
      assetId: typeof record.assetId === 'string' ? record.assetId : undefined,
      reference: sanitizeProjectReference(record.reference)
    } satisfies AiAgentAttachment];
  });
}

function sanitizeProjectReference(value: unknown): AiAgentAttachment['reference'] {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const record = value as Record<string, unknown>;
  const type = typeof record.type === 'string' ? record.type : '';
  const validTypes = new Set(['folder', 'doc', 'asset', 'chapter', 'character', 'location', 'act', 'structure', 'obstacle']);
  const id = typeof record.id === 'string' ? record.id.trim() : '';
  if (!validTypes.has(type) || !id) return undefined;
  return {
    type: type as NonNullable<AiAgentAttachment['reference']>['type'],
    id,
    path: typeof record.path === 'string' ? record.path.trim() || undefined : undefined,
    startLine: positiveInteger(record.startLine),
    endLine: positiveInteger(record.endLine)
  };
}

function positiveInteger(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : undefined;
}

function referenceContent(content: string, ref: NonNullable<AiAgentAttachment['reference']>): string {
  if (ref.startLine !== undefined || ref.endLine !== undefined) {
    const lines = content.split(/\r?\n/);
    const startLine = Math.max(ref.startLine ?? 1, 1);
    const endLine = Math.min(ref.endLine ?? startLine + 80, lines.length);
    return lines.slice(startLine - 1, endLine).join('\n');
  }
  return textExcerpt(content);
}

function textExcerpt(content: string, limit = 12000): string {
  return content.length > limit ? `${content.slice(0, limit)}\n\n[truncated]` : content;
}

function jsonBlock(value: unknown): string {
  return `\`\`\`json\n${JSON.stringify(value, null, 2)}\n\`\`\``;
}

function attachmentLabel(attachment: AiAgentAttachment): string {
  return `${attachment.name} (${attachment.mimeType}, ${formatBytes(attachment.sizeBytes)})`;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

type AgentModelContent = string | Array<
  | { type: 'text'; text: string }
  | { type: 'image'; image: string; mimeType: string }
  | { type: 'file'; data: string; mimeType: string; filename: string }
>;

function modelContent(prompt: string, attachments: AiAgentAttachment[]): AgentModelContent {
  if (attachments.length === 0) return prompt;
  const parts: Exclude<AgentModelContent, string> = [{ type: 'text', text: prompt }];
  for (const attachment of attachments) {
    if (!attachment.url) continue;
    if (attachment.mimeType.startsWith('image/')) {
      parts.push({ type: 'image', image: attachment.url, mimeType: attachment.mimeType });
    } else if (attachment.mimeType === 'application/pdf') {
      parts.push({ type: 'file', data: attachment.url, mimeType: attachment.mimeType, filename: attachment.name });
    }
  }
  return parts;
}

function usageFromPart(part: unknown, model: string | null): UsagePayload | null {
  if (!part || typeof part !== 'object') return null;
  const record = part as Record<string, unknown>;
  const usage = objectRecord(record.totalUsage) ?? objectRecord(record.usage);
  if (!usage) return null;
  const inputTokens = numberValue(usage.inputTokens)
    ?? numberValue(objectRecord(usage.inputTokens)?.total)
    ?? numberValue(usage.promptTokens)
    ?? 0;
  const outputTokens = numberValue(usage.outputTokens)
    ?? numberValue(objectRecord(usage.outputTokens)?.total)
    ?? numberValue(usage.completionTokens)
    ?? 0;
  const totalTokens = numberValue(usage.totalTokens) ?? inputTokens + outputTokens;
  const maxTokens = contextWindowForModel(model);
  return {
    inputTokens,
    outputTokens,
    totalTokens,
    maxTokens,
    percentage: Math.min(100, Math.round((totalTokens / maxTokens) * 1000) / 10),
    model
  };
}

function streamPartError(part: unknown): string | null {
  const record = objectRecord(part);
  if (!record) return null;
  return stringValue(record.reason)
    ?? stringValue(record.errorText)
    ?? (record.error instanceof Error ? record.error.message : stringValue(record.error))
    ?? stringValue(objectRecord(record.error)?.message);
}

function finishReason(part: unknown): string | null {
  return stringValue(objectRecord(part)?.finishReason);
}

export function classifyAgentStreamTerminal(part: unknown): { kind: 'abort' | 'error'; message: string } | null {
  const type = stringValue(objectRecord(part)?.type);
  if (type === 'abort') return { kind: 'abort', message: streamPartError(part) ?? 'Model stream aborted' };
  if (type === 'error') return { kind: 'error', message: streamPartError(part) ?? 'Model stream failed' };
  if (type === 'finish' && finishReason(part) === 'error') {
    return { kind: 'error', message: 'Model stream finished with an error' };
  }
  return null;
}

export function isHandlerManagedTool(toolName: string): boolean {
  return HANDLER_MANAGED_TOOLS.has(toolName);
}

export function shouldBroadcastOuterToolEvent(
  toolName: string,
  eventType?: string,
  handlerOwned = false
): boolean {
  if (eventType === 'tool-input-error') return true;
  return !isHandlerManagedTool(toolName) || !handlerOwned;
}

function isUniqueConstraintError(error: unknown): boolean {
  return Boolean(error && typeof error === 'object' && (error as { code?: unknown }).code === 'P2002');
}

function objectRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function numberValue(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function contextWindowForModel(model: string | null): number {
  const id = model?.toLowerCase() ?? '';
  if (id.includes('gpt-5') || id.includes('gpt-4.1') || id.includes('gemini')) return 1_000_000;
  if (id.includes('claude') || id.includes('gpt-4o')) return 200_000;
  return DEFAULT_CONTEXT_WINDOW;
}

function errorMessage(error: unknown): string {
  if (typeof error === 'string' && error.trim()) return error;
  if (!error || typeof error !== 'object') return error instanceof Error ? error.message : 'AI agent failed';
  const record = error as Record<string, unknown>;
  const data = objectRecord(record.data);
  const dataError = objectRecord(data?.error);
  const responseBody = typeof record.responseBody === 'string' ? parseJsonRecord(record.responseBody) : null;
  const bodyError = objectRecord(responseBody?.error);
  const message = stringValue(dataError?.message) ?? stringValue(bodyError?.message) ?? (error instanceof Error ? error.message : null);
  return message ?? 'AI agent failed';
}

function usageFromError(error: unknown, model: string | null): UsagePayload | null {
  const message = errorMessage(error);
  const match = message.match(/Prompt tokens limit exceeded:\s*(\d+)\s*>\s*(\d+)/i);
  if (!match) return null;
  const inputTokens = Number(match[1]);
  const maxTokens = Number(match[2]);
  if (!Number.isFinite(inputTokens) || !Number.isFinite(maxTokens) || maxTokens <= 0) return null;
  return {
    inputTokens,
    outputTokens: 0,
    totalTokens: inputTokens,
    maxTokens,
    percentage: Math.round((inputTokens / maxTokens) * 1000) / 10,
    model
  };
}

function mergeSessionMeta(
  lastError: string | null,
  update: { contextUsage?: UsagePayload | null; error?: string | null }
): string | null {
  const existing = sessionMetaRecord(lastError);
  const next = {
    type: 'opentales.aiSessionMeta',
    version: 1,
    contextUsage: update.contextUsage === undefined ? contextUsageFromSession(lastError) : update.contextUsage,
    error: update.error === undefined ? sessionErrorFromSession(lastError) : update.error
  };
  if (existing) Object.assign(next, existing, update);
  if (!next.contextUsage && !next.error) return null;
  return JSON.stringify(next);
}

function sessionMetaRecord(value: string | null): Record<string, unknown> | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value) as Record<string, unknown>;
    return parsed.type === 'opentales.aiSessionMeta' ? parsed : null;
  } catch {
    return null;
  }
}

function contextUsageFromSession(lastError: string | null): UsagePayload | null {
  const usage = objectRecord(sessionMetaRecord(lastError)?.contextUsage);
  if (!usage) return null;
  const inputTokens = numberValue(usage.inputTokens) ?? 0;
  const outputTokens = numberValue(usage.outputTokens) ?? 0;
  const totalTokens = numberValue(usage.totalTokens) ?? inputTokens + outputTokens;
  const maxTokens = numberValue(usage.maxTokens) ?? DEFAULT_CONTEXT_WINDOW;
  return {
    inputTokens,
    outputTokens,
    totalTokens,
    maxTokens,
    percentage: numberValue(usage.percentage) ?? Math.min(100, Math.round((totalTokens / maxTokens) * 1000) / 10),
    model: typeof usage.model === 'string' ? usage.model : null
  };
}

function sessionErrorFromSession(lastError: string | null): string | null {
  if (!lastError) return null;
  const metaError = sessionMetaRecord(lastError)?.error;
  if (typeof metaError === 'string') return metaError;
  return sessionMetaRecord(lastError) ? null : lastError;
}

function parseJsonRecord(value: string): Record<string, unknown> | null {
  try {
    return objectRecord(JSON.parse(value));
  } catch {
    return null;
  }
}

function stringValue(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value : null;
}
