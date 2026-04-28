import type { Response } from 'express';
import type { Prisma, PrismaClient } from '@prisma/client';
import type {
  AiAgentMessage,
  AiAgentQueuedPrompt,
  AiAgentSession,
  AiAgentSessionEvent,
  AiAgentSessionSummary,
  AiAgentToolCall,
  ApproveAiToolCallInput,
  CreateAiAgentSessionInput,
  CreateChapterInput,
  CreateCharacterInput,
  QueueAiAgentPromptInput,
  UpdateChapterInput,
  UpdateCharacterInput
} from '@opentales/sdk';
import { stepCountIs, streamText, tool } from 'ai';
import { z } from 'zod';
import { HttpError } from '../../http/HttpError.js';
import { ProjectAccessRepository } from '../../repositories/ProjectAccessRepository.js';
import { CreateChapterUseCase } from '../projects/CreateChapterUseCase.js';
import { CreateCharacterUseCase } from '../projects/CreateCharacterUseCase.js';
import { UpdateChapterUseCase } from '../projects/UpdateChapterUseCase.js';
import { UpdateCharacterUseCase } from '../projects/UpdateCharacterUseCase.js';
import { loadAiModelForProject } from './aiModel.js';

interface RuntimeSession {
  clients: Set<Response>;
  abortController: AbortController | null;
}

const runtimes = new Map<string, RuntimeSession>();
const MUTATING_TOOLS = new Set([
  'updateCharacter',
  'createCharacter',
  'updateChapter',
  'createChapter',
  'createProjectDoc',
  'updateProjectDoc'
]);

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
    await loadAiModelForProject(this.prisma, projectId);

    const prompt = input.prompt?.trim();
    if (!prompt) throw new HttpError(400, 'Prompt is required');

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
        prompt,
        order: input.interrupt ? -Date.now() : (last?.order ?? 0) + 1
      }
    });

    await this.broadcast(projectId, {
      type: 'prompt-queued',
      session: await this.snapshot(session.id, projectId),
      data: toQueuedPrompt(queued)
    });
    void this.drain(projectId, session.id);
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

    if (!input.approved) {
      await this.prisma.aiAgentToolCall.update({
        where: { id: toolCall.id },
        data: { status: 'REJECTED', decidedAt: new Date(), decidedById: userId }
      });
      await this.prisma.aiAgentMessage.create({
        data: {
          sessionId: session.id,
          role: 'TOOL',
          content: `Rejected ${toolCall.toolName}`
        }
      });
    } else {
      await this.prisma.aiAgentToolCall.update({
        where: { id: toolCall.id },
        data: { status: 'APPROVED', decidedAt: new Date(), decidedById: userId }
      });
      try {
        const output = await this.executeApprovedTool(userId, projectId, toolCall.toolName, toolCall.input);
        await this.prisma.aiAgentToolCall.update({
          where: { id: toolCall.id },
          data: { status: 'EXECUTED', output: output as Prisma.InputJsonValue }
        });
        await this.prisma.aiAgentMessage.create({
          data: {
            sessionId: session.id,
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
        await this.prisma.aiAgentMessage.create({
          data: {
            sessionId: session.id,
            role: 'TOOL',
            content: `${toolCall.toolName} approval failed: ${message}`
          }
        });
        throw new HttpError(400, `${toolCall.toolName} approval failed: ${message}`);
      }
    }

    const snapshot = await this.snapshot(session.id, projectId);
    await this.broadcast(projectId, {
      type: 'tool-approval',
      session: snapshot,
      data: { toolCallId: toolCall.id, approved: input.approved }
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

  private async drain(projectId: string, sessionId: string): Promise<void> {
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
        const model = await loadAiModelForProject(this.prisma, projectId);
        const result = streamText({
          model,
          abortSignal: runtime.abortController.signal,
          tools: this.buildAgentTools(projectId),
          stopWhen: stepCountIs(8),
          system:
            'You are the OpenTales project assistant. Use grep/list/read tools to inspect project data before giving specific advice. Prefer summaries, grep, and bounded reads. Read full chapter text only when the user explicitly asks or when a bounded read is insufficient. Ask for approval before mutating project data.',
          prompt: await this.buildPrompt(projectId, session.id, queued.prompt)
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
    const [session, messages, prompts, toolCalls] = await Promise.all([
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
      pendingToolCalls: toolCalls.map(toToolCall),
      updatedAt: session.updatedAt.toISOString()
    };
  }

  private async broadcast(_projectId: string, event: AiAgentSessionEvent): Promise<void> {
    for (const client of getRuntime(event.session.id).clients) writeEvent(client, event);
  }

  private async buildPrompt(projectId: string, sessionId: string, prompt: string): Promise<string> {
    const project = await this.prisma.project.findUnique({
      where: { id: projectId },
      select: { title: true, genre: true, tone: true, voice: true, themes: true }
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
      take: 12
    });
    const transcript = messages
      .reverse()
      .map((message) => `${toMessageRole(message.role)}: ${message.content}`)
      .join('\n');
    return [
      `Project: ${project?.title ?? projectId}`,
      `Genre: ${project?.genre ?? ''}`,
      `Tone: ${project?.tone ?? ''}`,
      `Voice: ${project?.voice ?? ''}`,
      `Themes: ${project?.themes.join(', ') ?? ''}`,
      '',
      'Project instruction docs:',
      instructionDocs.length
        ? instructionDocs.map((doc) => `## ${doc.title}\n${bodyOf(doc.bodyWriting)}`).join('\n\n')
        : '(none)',
      '',
      'Tool guidance:',
      '- Use list/grep tools before reading long content.',
      '- Use readChapter with bounded ranges unless the user explicitly asks for the full chapter.',
      '- Mutating tools are proposals. They require backend approval before execution.',
      '',
      'Recent session transcript:',
      transcript || '(none)',
      '',
      'Current user prompt:',
      prompt
    ].join('\n');
  }

  private buildAgentTools(projectId: string) {
    return {
      listCharacters: tool({
        description: 'List characters in the active project.',
        inputSchema: z.object({}),
        execute: async () =>
          this.prisma.character.findMany({
            where: { projectId },
            orderBy: { createdAt: 'asc' },
            select: { id: true, name: true, role: true, traits: true }
          })
      }),
      readCharacter: tool({
        description: 'Read a character profile, including description, appearance, motivation, and arc.',
        inputSchema: z.object({ characterId: z.string() }),
        execute: async ({ characterId }) => {
          const character = await this.prisma.character.findFirst({
            where: { id: characterId, projectId },
            include: {
              descriptionWriting: { include: { defaultBranch: { include: { headVersion: true } } } },
              appearanceWriting: { include: { defaultBranch: { include: { headVersion: true } } } },
              motivationWriting: { include: { defaultBranch: { include: { headVersion: true } } } },
              arcWriting: { include: { defaultBranch: { include: { headVersion: true } } } }
            }
          });
          if (!character) throw new HttpError(404, 'Character not found');
          return {
            id: character.id,
            name: character.name,
            role: character.role,
            age: character.age,
            occupation: character.occupation,
            traits: character.traits,
            description: bodyOf(character.descriptionWriting),
            appearance: bodyOf(character.appearanceWriting),
            motivation: bodyOf(character.motivationWriting),
            arc: bodyOf(character.arcWriting)
          };
        }
      }),
      listChapters: tool({
        description: 'List chapter metadata and summaries. Prefer this before reading full chapter bodies.',
        inputSchema: z.object({}),
        execute: async () =>
          this.prisma.chapter.findMany({
            where: { projectId, deletedAt: null },
            orderBy: { number: 'asc' },
            select: {
              id: true,
              number: true,
              title: true,
              status: true,
              summary: true,
              povCharacterId: true,
              locationId: true
            }
          })
      }),
      grepChapter: tool({
        description: 'Search one chapter body for a text or regex pattern and return matching line snippets.',
        inputSchema: z.object({
          chapterId: z.string(),
          query: z.string(),
          regex: z.boolean().optional(),
          caseSensitive: z.boolean().optional(),
          limit: z.number().int().min(1).max(50).optional()
        }),
        execute: async (input) => this.grepChapters(projectId, { ...input, chapterIds: [input.chapterId] })
      }),
      grepChapters: tool({
        description: 'Search all or selected chapter bodies for a text or regex pattern and return matching line snippets.',
        inputSchema: z.object({
          query: z.string(),
          chapterIds: z.array(z.string()).optional(),
          regex: z.boolean().optional(),
          caseSensitive: z.boolean().optional(),
          limit: z.number().int().min(1).max(100).optional()
        }),
        execute: async (input) => this.grepChapters(projectId, input)
      }),
      readChapter: tool({
        description:
          'Read a bounded chapter body range. Use startLine/endLine for line ranges or offset/length for character ranges. Pass full:true only when the user explicitly requests the full chapter or bounded reads are insufficient.',
        inputSchema: z.object({
          chapterId: z.string(),
          startLine: z.number().int().min(1).optional(),
          endLine: z.number().int().min(1).optional(),
          offset: z.number().int().min(0).optional(),
          length: z.number().int().min(1).max(20000).optional(),
          full: z.boolean().optional()
        }),
        execute: async (input) => this.readChapter(projectId, input)
      }),
      listLocations: tool({
        description: 'List locations in the active project.',
        inputSchema: z.object({}),
        execute: async () =>
          this.prisma.location.findMany({
            where: { projectId },
            orderBy: { createdAt: 'asc' },
            select: { id: true, name: true, type: true }
          })
      }),
      readLocation: tool({
        description: 'Read a location profile, including description, atmosphere, significance, and sensory details.',
        inputSchema: z.object({ locationId: z.string() }),
        execute: async ({ locationId }) => {
          const location = await this.prisma.location.findFirst({
            where: { id: locationId, projectId },
            include: {
              descriptionWriting: { include: { defaultBranch: { include: { headVersion: true } } } },
              atmosphereWriting: { include: { defaultBranch: { include: { headVersion: true } } } },
              significanceWriting: { include: { defaultBranch: { include: { headVersion: true } } } },
              sensoryWriting: { include: { defaultBranch: { include: { headVersion: true } } } }
            }
          });
          if (!location) throw new HttpError(404, 'Location not found');
          return {
            id: location.id,
            name: location.name,
            type: location.type,
            description: bodyOf(location.descriptionWriting),
            atmosphere: bodyOf(location.atmosphereWriting),
            significance: bodyOf(location.significanceWriting),
            sensoryDetails: bodyOf(location.sensoryWriting)
          };
        }
      }),
      listProjectDocs: tool({
        description: 'List project notes, brainstorms, instructions, and reference docs with pagination.',
        inputSchema: z.object({
          limit: z.number().int().min(1).max(100).optional(),
          offset: z.number().int().min(0).optional(),
          kind: z.enum(['note', 'brainstorm', 'instructions', 'reference', 'other']).optional()
        }),
        execute: async ({ limit = 50, offset = 0, kind }) => {
          const where = { projectId, ...(kind ? { kind: toPrismaDocKind(kind) } : {}) };
          const [total, items] = await this.prisma.$transaction([
            this.prisma.projectDoc.count({ where }),
            this.prisma.projectDoc.findMany({
              where,
              orderBy: [{ order: 'asc' }, { createdAt: 'asc' }],
              skip: offset,
              take: limit,
              select: { id: true, title: true, kind: true, updatedAt: true }
            })
          ]);
          return { items, total, limit, offset, nextOffset: offset + items.length < total ? offset + items.length : null };
        }
      }),
      readProjectDoc: tool({
        description: 'Read a project note, brainstorm, instruction, or reference doc.',
        inputSchema: z.object({ docId: z.string() }),
        execute: async ({ docId }) => {
          const doc = await this.prisma.projectDoc.findFirst({
            where: { id: docId, projectId },
            include: {
              bodyWriting: { include: { defaultBranch: { include: { headVersion: true } } } }
            }
          });
          if (!doc) throw new HttpError(404, 'Project document not found');
          return {
            id: doc.id,
            title: doc.title,
            kind: doc.kind,
            content: bodyOf(doc.bodyWriting),
            updatedAt: doc.updatedAt.toISOString()
          };
        }
      }),
      readStoryStructure: tool({
        description: 'Read high-level project structure: genre, premise, outline, climax, themes, obstacles.',
        inputSchema: z.object({}),
        execute: async () => this.readStoryStructure(projectId)
      }),
      ...approvalTools
    };
  }

  private async readChapter(
    projectId: string,
    input: {
      chapterId: string;
      startLine?: number;
      endLine?: number;
      offset?: number;
      length?: number;
      full?: boolean;
    }
  ) {
    const chapter = await this.prisma.chapter.findFirst({
      where: { id: input.chapterId, projectId, deletedAt: null },
      include: {
        bodyWriting: { include: { defaultBranch: { include: { headVersion: true } } } }
      }
    });
    if (!chapter) throw new HttpError(404, 'Chapter not found');
    const content = bodyOf(chapter.bodyWriting);
    const lines = content.split(/\r?\n/);
    if (input.full) {
      return this.chapterReadResult(chapter, content, {
        mode: 'full',
        startLine: 1,
        endLine: lines.length,
        offset: 0,
        length: content.length
      });
    }
    if (input.startLine !== undefined || input.endLine !== undefined) {
      const startLine = Math.max(input.startLine ?? 1, 1);
      const endLine = Math.min(input.endLine ?? startLine + 80, lines.length);
      return this.chapterReadResult(chapter, lines.slice(startLine - 1, endLine).join('\n'), {
        mode: 'lines',
        startLine,
        endLine,
        offset: null,
        length: null
      });
    }
    const offset = Math.max(input.offset ?? 0, 0);
    const length = Math.min(input.length ?? 8000, 20000);
    return this.chapterReadResult(chapter, content.slice(offset, offset + length), {
      mode: 'offset',
      startLine: null,
      endLine: null,
      offset,
      length
    });
  }

  private chapterReadResult(
    chapter: { id: string; number: number; title: string; summary: string | null },
    content: string,
    range: Record<string, unknown>
  ) {
    return {
      id: chapter.id,
      number: chapter.number,
      title: chapter.title,
      summary: chapter.summary,
      range,
      content
    };
  }

  private async grepChapters(
    projectId: string,
    input: {
      query: string;
      chapterId?: string;
      chapterIds?: string[];
      regex?: boolean;
      caseSensitive?: boolean;
      limit?: number;
    }
  ) {
    const query = input.query.trim();
    if (!query) throw new HttpError(400, 'grep query is required');
    const limit = Math.min(input.limit ?? 50, 100);
    const chapters = await this.prisma.chapter.findMany({
      where: {
        projectId,
        deletedAt: null,
        ...(input.chapterIds?.length ? { id: { in: input.chapterIds } } : {})
      },
      orderBy: { number: 'asc' },
      include: {
        bodyWriting: { include: { defaultBranch: { include: { headVersion: true } } } }
      }
    });
    const matcher = makeMatcher(query, Boolean(input.regex), Boolean(input.caseSensitive));
    const matches: Array<{
      chapterId: string;
      chapterNumber: number;
      chapterTitle: string;
      line: number;
      text: string;
    }> = [];
    for (const chapter of chapters) {
      const lines = bodyOf(chapter.bodyWriting).split(/\r?\n/);
      for (const [index, line] of lines.entries()) {
        if (matcher(line)) {
          matches.push({
            chapterId: chapter.id,
            chapterNumber: chapter.number,
            chapterTitle: chapter.title,
            line: index + 1,
            text: line
          });
          if (matches.length >= limit) return { query, matches, truncated: true };
        }
      }
    }
    return { query, matches, truncated: false };
  }

  private async readStoryStructure(projectId: string) {
    const project = await this.prisma.project.findUnique({
      where: { id: projectId },
      include: {
        storyStructure: {
          include: {
            loglineWriting: { include: { defaultBranch: { include: { headVersion: true } } } },
            outlineWriting: { include: { defaultBranch: { include: { headVersion: true } } } },
            climaxWriting: { include: { defaultBranch: { include: { headVersion: true } } } }
          }
        },
        obstacles: {
          orderBy: { order: 'asc' },
          include: {
            descriptionWriting: { include: { defaultBranch: { include: { headVersion: true } } } },
            resolutionWriting: { include: { defaultBranch: { include: { headVersion: true } } } }
          }
        }
      }
    });
    if (!project) throw new HttpError(404, 'Project not found');
    return {
      title: project.title,
      genre: project.genre,
      perspective: project.perspective,
      pov: project.pov,
      voice: project.voice,
      tone: project.tone,
      themes: project.themes,
      logline: project.storyStructure ? bodyOf(project.storyStructure.loglineWriting) : '',
      outline: project.storyStructure ? bodyOf(project.storyStructure.outlineWriting) : '',
      climax: project.storyStructure ? bodyOf(project.storyStructure.climaxWriting) : '',
      obstacles: project.obstacles.map((obstacle) => ({
        id: obstacle.id,
        title: obstacle.title,
        type: obstacle.type,
        description: bodyOf(obstacle.descriptionWriting),
        resolution: bodyOf(obstacle.resolutionWriting)
      }))
    };
  }

  private async persistToolCall(sessionId: string, promptId: string, part: unknown) {
    const parsed = parseToolPart(part);
    if (!parsed) return null;
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

  private async executeApprovedTool(
    userId: string,
    projectId: string,
    toolName: string,
    input: Prisma.JsonValue
  ): Promise<unknown> {
    const data = input && typeof input === 'object' ? (input as Record<string, unknown>) : {};
    if (toolName === 'createProjectDoc') {
      const title = String(data.title ?? '').trim();
      if (!title) throw new HttpError(400, 'Document title is required');
      return this.createProjectDoc(userId, projectId, {
        title,
        kind: typeof data.kind === 'string' ? data.kind : 'note',
        content: typeof data.content === 'string' ? data.content : ''
      });
    }
    if (toolName === 'updateProjectDoc') {
      const docId = String(data.docId ?? '');
      if (!docId) throw new HttpError(400, 'docId is required');
      return this.updateProjectDoc(userId, projectId, docId, data);
    }
    if (toolName === 'updateChapter') {
      const chapterId = String(data.chapterId ?? '');
      if (!chapterId) throw new HttpError(400, 'chapterId is required');
      return new UpdateChapterUseCase(this.prisma).execute(userId, projectId, chapterId, {
        title: stringOrUndefined(data.title),
        summary: stringOrUndefined(data.summary),
        content: stringOrUndefined(data.content),
        status: chapterStatusOrUndefined(data.status),
        povCharacterId: stringOrUndefined(data.povCharacterId),
        locationId: stringOrUndefined(data.locationId)
      });
    }
    if (toolName === 'createChapter') {
      const title = String(data.title ?? '').trim();
      if (!title) throw new HttpError(400, 'Chapter title is required');
      const input: CreateChapterInput = {
        title,
        actId: stringOrUndefined(data.actId),
        status: chapterStatusOrUndefined(data.status),
        povCharacterId: stringOrUndefined(data.povCharacterId),
        locationId: stringOrUndefined(data.locationId),
        summary: stringOrUndefined(data.summary),
        content: stringOrUndefined(data.content)
      };
      return new CreateChapterUseCase(this.prisma).execute(userId, projectId, input);
    }
    if (toolName === 'createCharacter') {
      const name = String(data.name ?? '').trim();
      if (!name) throw new HttpError(400, 'Character name is required');
      const input: CreateCharacterInput = {
        name,
        role: stringOrUndefined(data.role),
        age: stringOrUndefined(data.age),
        occupation: stringOrUndefined(data.occupation),
        traits: stringArrayOrUndefined(data.traits),
        description: stringOrUndefined(data.description),
        appearance: stringOrUndefined(data.appearance),
        motivation: stringOrUndefined(data.motivation),
        arc: stringOrUndefined(data.arc)
      };
      return new CreateCharacterUseCase(this.prisma).execute(userId, projectId, input);
    }
    if (toolName === 'updateCharacter') {
      const characterId = String(data.characterId ?? '');
      if (!characterId) throw new HttpError(400, 'characterId is required');
      const input: UpdateCharacterInput = {
        name: stringOrUndefined(data.name),
        role: stringOrUndefined(data.role),
        age: stringOrUndefined(data.age),
        occupation: stringOrUndefined(data.occupation),
        traits: stringArrayOrUndefined(data.traits),
        description: stringOrUndefined(data.description),
        appearance: stringOrUndefined(data.appearance),
        motivation: stringOrUndefined(data.motivation),
        arc: stringOrUndefined(data.arc)
      };
      return new UpdateCharacterUseCase(this.prisma).execute(userId, projectId, characterId, input);
    }
    throw new HttpError(400, `Approval execution for ${toolName} is not implemented yet`);
  }

  private async createProjectDoc(
    userId: string,
    projectId: string,
    input: { title: string; kind: string; content: string }
  ) {
    const last = await this.prisma.projectDoc.findFirst({
      where: { projectId },
      orderBy: { order: 'desc' },
      select: { order: true }
    });
    return this.prisma.$transaction(async (tx) => {
      const writing = await tx.writing.create({ data: { projectId, kind: 'NOTE' } });
      const branch = await tx.writingBranch.create({
        data: { writingId: writing.id, name: 'main' }
      });
      const version = await tx.writingVersion.create({
        data: {
          branchId: branch.id,
          body: input.content,
          wordCount: countWords(input.content),
          authorId: userId,
          message: 'Create project document from AI approval'
        }
      });
      await tx.writingBranch.update({ where: { id: branch.id }, data: { headVersionId: version.id } });
      await tx.writing.update({ where: { id: writing.id }, data: { defaultBranchId: branch.id } });
      return tx.projectDoc.create({
        data: {
          projectId,
          title: input.title,
          kind: toPrismaDocKind(input.kind),
          bodyWritingId: writing.id,
          order: (last?.order ?? -1) + 1
        },
        select: { id: true, title: true, kind: true }
      });
    });
  }

  private async updateProjectDoc(
    userId: string,
    projectId: string,
    docId: string,
    input: Record<string, unknown>
  ) {
    const doc = await this.prisma.projectDoc.findFirst({
      where: { id: docId, projectId },
      select: { id: true, bodyWritingId: true }
    });
    if (!doc) throw new HttpError(404, 'Project document not found');
    return this.prisma.$transaction(async (tx) => {
      await tx.projectDoc.update({
        where: { id: docId },
        data: {
          title: typeof input.title === 'string' ? input.title : undefined,
          kind: typeof input.kind === 'string' ? toPrismaDocKind(input.kind) : undefined
        }
      });
      if (typeof input.content === 'string') {
        const writing = await tx.writing.findUniqueOrThrow({
          where: { id: doc.bodyWritingId },
          include: { defaultBranch: true }
        });
        if (!writing.defaultBranch) throw new Error(`Writing ${doc.bodyWritingId} has no default branch`);
        const version = await tx.writingVersion.create({
          data: {
            branchId: writing.defaultBranch.id,
            parentVersionId: writing.defaultBranch.headVersionId,
            body: input.content,
            wordCount: countWords(input.content),
            authorId: userId,
            message: 'Update project document from AI approval'
          }
        });
        await tx.writingBranch.update({
          where: { id: writing.defaultBranch.id },
          data: { headVersionId: version.id }
        });
      }
      return tx.projectDoc.findUnique({
        where: { id: docId },
        select: { id: true, title: true, kind: true }
      });
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
  return {
    id: prompt.id,
    prompt: prompt.prompt,
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
  return {
    id: message.id,
    role: toMessageRole(message.role),
    content: message.content,
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

function bodyOf(writing: {
  defaultBranch: { headVersion: { body: string | null } | null } | null;
}): string {
  return writing.defaultBranch?.headVersion?.body ?? '';
}

function makeMatcher(query: string, regex: boolean, caseSensitive: boolean): (line: string) => boolean {
  if (regex) {
    const expression = new RegExp(query, caseSensitive ? '' : 'i');
    return (line) => expression.test(line);
  }
  const needle = caseSensitive ? query : query.toLowerCase();
  return (line) => (caseSensitive ? line : line.toLowerCase()).includes(needle);
}

function toPrismaDocKind(kind: string): 'NOTE' | 'BRAINSTORM' | 'INSTRUCTIONS' | 'REFERENCE' | 'OTHER' {
  const map = {
    note: 'NOTE',
    brainstorm: 'BRAINSTORM',
    instructions: 'INSTRUCTIONS',
    reference: 'REFERENCE',
    other: 'OTHER'
  } as const;
  return map[kind as keyof typeof map] ?? 'NOTE';
}

function countWords(value: string): number {
  return value.trim().split(/\s+/).filter(Boolean).length;
}

function stringOrUndefined(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
}

function stringArrayOrUndefined(value: unknown): string[] | undefined {
  return Array.isArray(value) && value.every((item) => typeof item === 'string') ? value : undefined;
}

function chapterStatusOrUndefined(value: unknown): UpdateChapterInput['status'] {
  if (
    value === 'draft' ||
    value === 'in-progress' ||
    value === 'review' ||
    value === 'final'
  ) {
    return value;
  }
  return undefined;
}

const approvalTools = {
  updateCharacter: tool({
    description:
      'Propose changes to an existing character profile. Requires explicit backend approval before execution.',
    inputSchema: z.object({
      characterId: z.string(),
      name: z.string().optional(),
      role: z.string().optional(),
      age: z.string().optional(),
      occupation: z.string().optional(),
      traits: z.array(z.string()).optional(),
      description: z.string().optional(),
      appearance: z.string().optional(),
      motivation: z.string().optional(),
      arc: z.string().optional()
    }),
    needsApproval: true,
    execute: async () => ({ status: 'pending-approval' })
  }),
  createCharacter: tool({
    description: 'Propose a new character. Requires explicit backend approval before execution.',
    inputSchema: z.object({
      name: z.string(),
      role: z.string().optional(),
      age: z.string().optional(),
      occupation: z.string().optional(),
      traits: z.array(z.string()).optional(),
      description: z.string().optional(),
      appearance: z.string().optional(),
      motivation: z.string().optional(),
      arc: z.string().optional()
    }),
    needsApproval: true,
    execute: async () => ({ status: 'pending-approval' })
  }),
  updateChapter: tool({
    description: 'Propose chapter metadata changes. Requires explicit backend approval before execution.',
    inputSchema: z.object({
      chapterId: z.string(),
      title: z.string().optional(),
      summary: z.string().optional(),
      content: z.string().optional(),
      status: z.enum(['draft', 'in-progress', 'review', 'final']).optional(),
      povCharacterId: z.string().optional(),
      locationId: z.string().optional()
    }),
    needsApproval: true,
    execute: async () => ({ status: 'pending-approval' })
  }),
  createChapter: tool({
    description: 'Propose a new chapter. Requires explicit backend approval before execution.',
    inputSchema: z.object({
      title: z.string(),
      actId: z.string().optional(),
      summary: z.string().optional(),
      content: z.string().optional(),
      status: z.enum(['draft', 'in-progress', 'review', 'final']).optional(),
      povCharacterId: z.string().optional(),
      locationId: z.string().optional()
    }),
    needsApproval: true,
    execute: async () => ({ status: 'pending-approval' })
  }),
  createProjectDoc: tool({
    description:
      'Propose a new project note, brainstorm, instruction, or reference doc. Requires explicit backend approval before execution.',
    inputSchema: z.object({
      title: z.string(),
      kind: z.enum(['note', 'brainstorm', 'instructions', 'reference', 'other']).optional(),
      content: z.string().optional()
    }),
    needsApproval: true,
    execute: async () => ({ status: 'pending-approval' })
  }),
  updateProjectDoc: tool({
    description:
      'Propose changes to an existing project note, brainstorm, instruction, or reference doc. Requires explicit backend approval before execution.',
    inputSchema: z.object({
      docId: z.string(),
      title: z.string().optional(),
      kind: z.enum(['note', 'brainstorm', 'instructions', 'reference', 'other']).optional(),
      content: z.string().optional()
    }),
    needsApproval: true,
    execute: async () => ({ status: 'pending-approval' })
  })
};
