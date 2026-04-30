import type { Response } from 'express';
import type { Prisma, PrismaClient } from '@prisma/client';
import type { ToolSet } from 'ai';
import type {
  AiAgentAttachment,
  AiAgentMessage,
  AiAgentQueuedPrompt,
  AiAgentSession,
  AiAgentSessionEvent,
  AiAgentSessionSummary,
  AiAgentToolCall,
  ApproveAiToolCallInput,
  ApproveAiToolCallsInput,
  CreateAiAgentSessionInput,
  QueueAiAgentPromptInput
} from '@opentales/sdk';
import { stepCountIs, streamText } from 'ai';
import { HttpError } from '../../http/HttpError.js';
import { ProjectAccessRepository } from '../../repositories/ProjectAccessRepository.js';
import { loadAiModelForProject } from './aiModel.js';
import { renderSystemPrompt, renderUserContext } from './prompts/promptEngine.js';
import { buildAgentTools, bodyOf, executeMutationTool, mutatingToolNames, type MutatingToolName } from './tools/index.js';

interface RuntimeSession {
  clients: Set<Response>;
  abortController: AbortController | null;
}

interface PendingApproval {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  execute: () => Promise<unknown>;
  timeout: NodeJS.Timeout;
}

const runtimes = new Map<string, RuntimeSession>();
const MUTATING_TOOLS = new Set<string>(mutatingToolNames);
const pendingApprovals = new Map<string, PendingApproval>();
const APPROVAL_TIMEOUT_MS = Number(process.env.AI_APPROVAL_TIMEOUT_MS ?? 10 * 60 * 1000);
const DEFAULT_CONTEXT_WINDOW = Number(process.env.AI_CONTEXT_WINDOW_TOKENS ?? 128_000);

interface PromptPayload {
  prompt: string;
  model: string | null;
  attachments: AiAgentAttachment[];
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

  constructor(private readonly prisma: PrismaClient) {
    this.access = new ProjectAccessRepository(prisma);
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
    const title = input.title?.trim() || 'New chat';
    const session = await this.prisma.projectAiAgentSession.create({
      data: { projectId, title }
    });
    return this.snapshot(session.id, projectId);
  }

  async get(userId: string, projectId: string, sessionId?: string): Promise<AiAgentSession> {
    await this.access.assertProjectAccess(userId, projectId);
    const session = sessionId
      ? await this.getSession(projectId, sessionId)
      : await this.ensureDefaultSession(projectId);
    return this.snapshot(session.id, projectId);
  }

  async queuePrompt(
    userId: string,
    projectId: string,
    input: QueueAiAgentPromptInput,
    sessionId?: string
  ): Promise<AiAgentSession> {
    await this.access.assertPermission(userId, projectId, 'project:write');
    await loadAiModelForProject(this.prisma, projectId, input.model);

    const prompt = input.prompt?.trim();
    if (!prompt) throw new HttpError(400, 'Prompt is required');
    const payload = normalizePromptPayload({
      prompt,
      model: typeof input.model === 'string' ? input.model.trim() || null : null,
      attachments: sanitizeAttachments(input.attachments)
    });

    const session = sessionId
      ? await this.getSession(projectId, sessionId)
      : await this.ensureDefaultSession(projectId);
    const runtime = getRuntime(session.id);
    if (input.interrupt && runtime.abortController) {
      runtime.abortController.abort();
      await this.prisma.aiAgentPrompt.updateMany({
        where: { sessionId: session.id, status: 'RUNNING' },
        data: { status: 'CANCELLED' }
      });
      await this.prisma.projectAiAgentSession.update({
        where: { id: session.id },
        data: { status: 'CANCELLED', activePromptId: null }
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
    void this.drain(userId, projectId, session.id);
    return this.snapshot(session.id, projectId);
  }

  async cancel(userId: string, projectId: string, sessionId?: string): Promise<AiAgentSession> {
    await this.access.assertPermission(userId, projectId, 'project:write');
    const session = sessionId
      ? await this.getSession(projectId, sessionId)
      : await this.ensureDefaultSession(projectId);
    const runtime = getRuntime(session.id);
    if (runtime.abortController) runtime.abortController.abort();
    await this.prisma.aiAgentPrompt.updateMany({
      where: { sessionId: session.id, status: { in: ['QUEUED', 'RUNNING'] } },
      data: { status: 'CANCELLED' }
    });
    await this.prisma.projectAiAgentSession.update({
      where: { id: session.id },
      data: { status: 'CANCELLED', activePromptId: null }
    });
    const snapshot = await this.snapshot(session.id, projectId);
    await this.broadcast(projectId, { type: 'session', session: snapshot, data: { cancelled: true } });
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
        status: 'PENDING_APPROVAL',
        OR: [{ id: toolCallId }, { toolCallId }]
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
        status: 'PENDING_APPROVAL',
        OR: [{ id: { in: ids } }, { toolCallId: { in: ids } }]
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

  async subscribe(userId: string, projectId: string, res: Response, sessionId?: string): Promise<void> {
    await this.access.assertProjectAccess(userId, projectId);
    const session = sessionId
      ? await this.getSession(projectId, sessionId)
      : await this.ensureDefaultSession(projectId);
    res.setHeader('content-type', 'text/event-stream');
    res.setHeader('cache-control', 'no-cache, no-transform');
    res.setHeader('connection', 'keep-alive');
    res.flushHeaders?.();
    const runtime = getRuntime(session.id);
    runtime.clients.add(res);
    writeEvent(res, { type: 'session', session: await this.snapshot(session.id, projectId) });
    res.on('close', () => runtime.clients.delete(res));
  }

  private async drain(userId: string, projectId: string, sessionId: string): Promise<void> {
    const session = await this.getSession(projectId, sessionId);
    const current = await this.prisma.projectAiAgentSession.findUniqueOrThrow({
      where: { id: session.id },
      select: { status: true }
    });
    if (current.status === 'RUNNING') return;

    while (true) {
      const queued = await this.prisma.aiAgentPrompt.findFirst({
        where: { sessionId: session.id, status: 'QUEUED' },
        orderBy: [{ order: 'asc' }, { createdAt: 'asc' }]
      });
      if (!queued) return;

      const runtime = getRuntime(session.id);
      runtime.abortController = new AbortController();
      await this.prisma.aiAgentPrompt.update({
        where: { id: queued.id },
        data: { status: 'RUNNING' }
      });
      await this.prisma.projectAiAgentSession.update({
        where: { id: session.id },
        data: { status: 'RUNNING', activePromptId: queued.id, lastError: null }
      });
      await this.prisma.aiAgentMessage.create({
        data: { sessionId: session.id, role: 'USER', content: queued.prompt }
      });
      const assistantMessage = await this.prisma.aiAgentMessage.create({
        data: { sessionId: session.id, role: 'ASSISTANT', content: '' }
      });

      await this.broadcast(projectId, {
        type: 'prompt-started',
        session: await this.snapshot(session.id, projectId),
        data: { promptId: queued.id }
      });

      let assistantText = '';
      try {
        const promptPayload = parsePromptPayload(queued.prompt);
        const model = await loadAiModelForProject(this.prisma, projectId, promptPayload.model);
        const { systemPrompt, userPrompt } = await this.buildPrompts(
          projectId,
          session.id,
          promptPayload.prompt,
          promptPayload.attachments
        );
        const messagePrompt = modelContent(userPrompt, promptPayload.attachments);
        const messages = [{ role: 'user' as const, content: messagePrompt }] as NonNullable<Parameters<typeof streamText>[0]['messages']>;
        const result = streamText({
          model,
          abortSignal: runtime.abortController.signal,
          tools: this.buildAgentTools(projectId, session.id, queued.id, userId),
          stopWhen: stepCountIs(8),
          system: systemPrompt,
          messages
        });

        for await (const part of result.fullStream) {
          const type = String(part.type);
          if (type === 'text-delta') {
            const text = readTextDelta(part);
            if (!text) continue;
            assistantText += text;
            await this.prisma.aiAgentMessage.update({
              where: { id: assistantMessage.id },
              data: { content: assistantText }
            });
            await this.broadcast(projectId, {
              type: 'text-delta',
              session: await this.snapshot(session.id, projectId),
              data: { promptId: queued.id, text }
            });
          } else if (
            type === 'tool-call' ||
            type === 'tool-input-available' ||
            type === 'tool-approval-request'
          ) {
            const persisted = await this.persistToolCall(session.id, queued.id, part);
            await this.broadcast(projectId, {
              type: 'tool-call',
              session: await this.snapshot(session.id, projectId),
              data: persisted ?? part
            });
          } else if (type === 'tool-result' || type === 'tool-output-available') {
            await this.persistToolResult(part);
            await this.broadcast(projectId, {
              type: 'tool-result',
              session: await this.snapshot(session.id, projectId),
              data: part
            });
          } else if (type === 'finish' || type === 'finish-step') {
            const usage = usageFromPart(part, promptPayload.model);
            if (usage) await this.saveContextUsage(session.id, usage);
          }
        }

        await this.prisma.aiAgentPrompt.update({
          where: { id: queued.id },
          data: { status: 'COMPLETED' }
        });
        await this.prisma.projectAiAgentSession.update({
          where: { id: session.id },
          data: { status: 'IDLE', activePromptId: null }
        });
        runtime.abortController = null;
        await this.broadcast(projectId, {
          type: 'prompt-finished',
          session: await this.snapshot(session.id, projectId),
          data: { promptId: queued.id }
        });
      } catch (error) {
        const aborted = runtime.abortController?.signal.aborted;
        runtime.abortController = null;
        await this.prisma.aiAgentPrompt.update({
          where: { id: queued.id },
          data: { status: aborted ? 'CANCELLED' : 'ERROR' }
        });
        await this.prisma.projectAiAgentSession.update({
          where: { id: session.id },
          data: {
            status: aborted ? 'CANCELLED' : 'ERROR',
            activePromptId: null,
            lastError: error instanceof Error ? error.message : 'AI agent failed'
          }
        });
        await this.broadcast(projectId, {
          type: aborted ? 'session' : 'error',
          session: await this.snapshot(session.id, projectId),
          data: {
            promptId: queued.id,
            message: error instanceof Error ? error.message : 'AI agent failed'
          }
        });
      }
    }
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
    const [session, messages, prompts, pendingToolCalls, recentToolCalls] = await Promise.all([
      this.prisma.projectAiAgentSession.findUniqueOrThrow({ where: { id: sessionId } }),
      this.prisma.aiAgentMessage.findMany({
        where: { sessionId },
        orderBy: { createdAt: 'asc' },
        take: 200
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
        orderBy: { createdAt: 'asc' },
        take: 200
      })
    ]);
    return {
      id: session.id,
      projectId,
      title: session.title ?? defaultSessionTitle(session.createdAt),
      status: toSessionStatus(session.status),
      activePromptId: session.activePromptId,
      queue: prompts.map(toQueuedPrompt),
      messages: messages.map(toMessage),
      toolCalls: recentToolCalls.map(toToolCall),
      pendingToolCalls: pendingToolCalls.map(toToolCall),
      contextUsage: contextUsageFromSession(session.lastError),
      updatedAt: session.updatedAt.toISOString()
    };
  }

  private async broadcast(_projectId: string, event: AiAgentSessionEvent): Promise<void> {
    for (const client of getRuntime(event.session.id).clients) writeEvent(client, event);
  }

  private async buildPrompts(
    projectId: string,
    sessionId: string,
    prompt: string,
    attachments: AiAgentAttachment[]
  ): Promise<{ systemPrompt: string; userPrompt: string }> {
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
      take: 20
    });
    const transcript = messages
      .reverse()
      .map((message) => {
        const role = toMessageRole(message.role);
        const payload = role === 'user' ? parsePromptPayload(message.content) : null;
        const suffix = payload?.attachments.length ? `\nAttachments: ${payload.attachments.map(attachmentLabel).join(', ')}` : '';
        return `${role}: ${payload?.prompt ?? message.content}${suffix}`;
      })
      .join('\n');

    const systemPrompt = renderSystemPrompt({
      project: {
        title: project?.title ?? '',
        genre: project?.genre ?? '',
        tone: project?.tone ?? '',
        voice: project?.voice ?? '',
        perspective: project?.perspective ?? '',
        pov: project?.pov ?? ''
      },
      themes: project?.themes?.join(', ') ?? '',
      instructionDocs: instructionDocs.map((doc) => ({
        title: doc.title,
        content: bodyOf(doc.bodyWriting)
      }))
    });

    const userPrompt = renderUserContext({
      transcript,
      prompt: attachments.length
        ? `${prompt}\n\nAttached files:\n${attachments.map((attachment) => `- ${attachmentLabel(attachment)}`).join('\n')}`
        : prompt
    });

    return { systemPrompt, userPrompt };
  }

  private buildAgentTools(projectId: string, sessionId: string, promptId: string, userId: string): ToolSet {
    return buildAgentTools(this.prisma, { projectId, userId }, {
      handleApproval: (toolName, input, execute) =>
        this.handleApproval(sessionId, promptId, projectId, toolName, input, execute)
    }) as unknown as ToolSet;
  }

  private async handleApproval(
    sessionId: string,
    promptId: string,
    projectId: string,
    toolName: MutatingToolName,
    input: unknown,
    execute: () => Promise<unknown>
  ): Promise<unknown> {
    const toolCall = await this.prisma.aiAgentToolCall.create({
      data: {
        sessionId,
        promptId,
        toolName,
        input: input as Prisma.InputJsonValue,
        status: 'PENDING_APPROVAL'
      }
    });
    await this.broadcast(projectId, {
      type: 'tool-call',
      session: await this.snapshot(sessionId, projectId),
      data: toToolCall(toolCall)
    });
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        pendingApprovals.delete(toolCall.id);
        void (async () => {
          await this.prisma.aiAgentToolCall.update({
            where: { id: toolCall.id },
            data: { status: 'ERROR', error: 'Approval timed out' }
          });
          await this.broadcast(projectId, {
            type: 'error',
            session: await this.snapshot(sessionId, projectId),
            data: { toolCallId: toolCall.id, message: 'Approval timed out' }
          });
        })();
        reject(new Error('Approval timed out'));
      }, APPROVAL_TIMEOUT_MS);
      pendingApprovals.set(toolCall.id, { resolve, reject, execute, timeout });
    });
  }

  private async applyToolCallApproval(
    userId: string,
    projectId: string,
    sessionId: string,
    toolCall: { id: string; toolName: string; input: unknown },
    approved: boolean
  ): Promise<void> {
    if (!approved) {
      await this.prisma.aiAgentToolCall.update({
        where: { id: toolCall.id },
        data: { status: 'REJECTED', decidedAt: new Date(), decidedById: userId }
      });
      const pending = pendingApprovals.get(toolCall.id);
      if (pending) {
        clearTimeout(pending.timeout);
        pendingApprovals.delete(toolCall.id);
        pending.reject(new Error(`Rejected ${toolCall.toolName}`));
      }
      await this.prisma.aiAgentMessage.create({
        data: {
          sessionId,
          role: 'TOOL',
          content: `Rejected ${toolCall.toolName}`
        }
      });
      return;
    }

    await this.prisma.aiAgentToolCall.update({
      where: { id: toolCall.id },
      data: { status: 'APPROVED', decidedAt: new Date(), decidedById: userId }
    });
    try {
      const pending = pendingApprovals.get(toolCall.id);
      if (pending) {
        clearTimeout(pending.timeout);
        pendingApprovals.delete(toolCall.id);
      }
      const output = pending
        ? await pending.execute()
        : await executeMutationTool(this.prisma, { projectId, userId }, toolCall.toolName, inputRecord(toolCall.input as Prisma.JsonValue));
      await this.prisma.aiAgentToolCall.update({
        where: { id: toolCall.id },
        data: { status: 'EXECUTED', output: output as Prisma.InputJsonValue }
      });
      pending?.resolve(output);
      await this.prisma.aiAgentMessage.create({
        data: {
          sessionId,
          role: 'TOOL',
          content: `${toolCall.toolName} approved and executed.`
        }
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Tool execution failed';
      await this.prisma.aiAgentToolCall.update({
        where: { id: toolCall.id },
        data: {
          status: 'ERROR',
          error: message
        }
      });
      const pending = pendingApprovals.get(toolCall.id);
      if (pending) {
        clearTimeout(pending.timeout);
        pendingApprovals.delete(toolCall.id);
        pending.reject(error instanceof Error ? error : new Error(message));
      }
      await this.prisma.aiAgentMessage.create({
        data: {
          sessionId,
          role: 'TOOL',
          content: `${toolCall.toolName} approval failed: ${message}`
        }
      });
      throw new HttpError(400, `${toolCall.toolName} approval failed: ${message}`);
    }
  }

  private async persistToolCall(sessionId: string, promptId: string, part: unknown) {
    const parsed = parseToolPart(part);
    if (!parsed) return null;
    if (MUTATING_TOOLS.has(parsed.toolName)) return null;
    const status = MUTATING_TOOLS.has(parsed.toolName) ? 'PENDING_APPROVAL' : 'EXECUTED';
    const existing = parsed.toolCallId
      ? await this.prisma.aiAgentToolCall.findFirst({
          where: { sessionId, toolCallId: parsed.toolCallId }
        })
      : null;
    if (existing) {
      const updated = await this.prisma.aiAgentToolCall.update({
        where: { id: existing.id },
        data: {
          input: parsed.input as Prisma.InputJsonValue,
          status: MUTATING_TOOLS.has(parsed.toolName) ? 'PENDING_APPROVAL' : existing.status
        }
      });
      return toToolCall(updated);
    }
    const created = await this.prisma.aiAgentToolCall.create({
      data: {
        sessionId,
        promptId,
        toolCallId: parsed.toolCallId,
        toolName: parsed.toolName,
        input: parsed.input as Prisma.InputJsonValue,
        status
      }
    });
    return toToolCall(created);
  }

  private async persistToolResult(part: unknown): Promise<void> {
    const parsed = parseToolResultPart(part);
    if (!parsed?.toolCallId) return;
    await this.prisma.aiAgentToolCall.updateMany({
      where: { toolCallId: parsed.toolCallId },
      data: {
        status: 'EXECUTED',
        output: parsed.output as Prisma.InputJsonValue
      }
    });
  }

  private async saveContextUsage(sessionId: string, usage: UsagePayload): Promise<void> {
    const session = await this.prisma.projectAiAgentSession.findUnique({
      where: { id: sessionId },
      select: { lastError: true }
    });
    await this.prisma.projectAiAgentSession.update({
      where: { id: sessionId },
      data: { lastError: mergeContextUsage(session?.lastError ?? null, usage) }
    });
  }

}

function getRuntime(sessionId: string): RuntimeSession {
  const existing = runtimes.get(sessionId);
  if (existing) return existing;
  const runtime: RuntimeSession = { clients: new Set(), abortController: null };
  runtimes.set(sessionId, runtime);
  return runtime;
}

function defaultSessionTitle(createdAt: Date): string {
  return `Chat ${createdAt.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`;
}

function writeEvent(res: Response, event: AiAgentSessionEvent): void {
  res.write(`data: ${JSON.stringify(event)}\n\n`);
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

function toToolCall(toolCall: {
  id: string;
  toolCallId: string | null;
  toolName: string;
  input: Prisma.JsonValue;
  status: 'PENDING_APPROVAL' | 'APPROVED' | 'REJECTED' | 'EXECUTED' | 'ERROR';
  output: Prisma.JsonValue | null;
  error: string | null;
  createdAt: Date;
  decidedAt: Date | null;
}): AiAgentToolCall {
  return {
    id: toolCall.id,
    toolCallId: toolCall.toolCallId,
    toolName: toolCall.toolName,
    input: toolCall.input,
    status: toToolCallStatus(toolCall.status),
    output: toolCall.output,
    error: toolCall.error,
    createdAt: toolCall.createdAt.toISOString(),
    decidedAt: toolCall.decidedAt ? toolCall.decidedAt.toISOString() : null
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
  status: 'PENDING_APPROVAL' | 'APPROVED' | 'REJECTED' | 'EXECUTED' | 'ERROR'
): AiAgentToolCall['status'] {
  const map = {
    PENDING_APPROVAL: 'pending-approval',
    APPROVED: 'approved',
    REJECTED: 'rejected',
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

function parseToolResultPart(part: unknown): { toolCallId: string | null; output: unknown } | null {
  if (!part || typeof part !== 'object') return null;
  const record = part as Record<string, unknown>;
  const toolCallId = typeof record.toolCallId === 'string' ? record.toolCallId : null;
  const output = record.output ?? record.result ?? null;
  return { toolCallId, output };
}

function inputRecord(input: Prisma.JsonValue): Record<string, unknown> {
  return input && typeof input === 'object' && !Array.isArray(input) ? (input as Record<string, unknown>) : {};
}

function normalizePromptPayload(payload: PromptPayload): PromptPayload {
  return {
    prompt: payload.prompt.trim(),
    model: payload.model?.trim() || null,
    attachments: sanitizeAttachments(payload.attachments)
  };
}

function serializePromptPayload(payload: PromptPayload): string {
  if (!payload.model && payload.attachments.length === 0) return payload.prompt;
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
      attachments: sanitizeAttachments(parsed.attachments)
    });
  } catch {
    return { prompt: value, model: null, attachments: [] };
  }
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
      assetId: typeof record.assetId === 'string' ? record.assetId : undefined
    } satisfies AiAgentAttachment];
  });
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
  const inputTokens = numberValue(usage.inputTokens) ?? numberValue(usage.promptTokens) ?? 0;
  const outputTokens = numberValue(usage.outputTokens) ?? numberValue(usage.completionTokens) ?? 0;
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

function mergeContextUsage(lastError: string | null, usage: UsagePayload): string {
  const payload = { type: 'opentales.aiSessionMeta', version: 1, contextUsage: usage };
  if (!lastError) return JSON.stringify(payload);
  try {
    const parsed = JSON.parse(lastError) as Record<string, unknown>;
    if (parsed.type === 'opentales.aiSessionMeta') return JSON.stringify({ ...parsed, contextUsage: usage });
  } catch {
    // Keep real error strings intact by replacing metadata only when no error is present.
  }
  return lastError;
}

function contextUsageFromSession(lastError: string | null): UsagePayload | null {
  if (!lastError) return null;
  try {
    const parsed = JSON.parse(lastError) as Record<string, unknown>;
    if (parsed.type !== 'opentales.aiSessionMeta') return null;
    const usage = objectRecord(parsed.contextUsage);
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
  } catch {
    return null;
  }
}
