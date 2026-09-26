import type { Response } from 'express';
import type { PrismaClient } from '@prisma/client';
import type {
  AiAgentCapabilities,
  AiAgentMessage,
  AiAgentMessagePage,
  AiAgentSession,
  AiAgentSessionStatus,
  AiAgentSessionSummary,
  AiAgentStreamEvent,
  AnswerAiQuestionInput,
  CreateAiAgentSessionInput,
  ReplyAiPermissionInput,
  SendAiAgentPromptInput,
  UpdateAiAgentSessionInput
} from '@opentales/sdk';
import { z } from 'zod';
import { HttpError } from '../../http/HttpError.js';
import { ProjectAccessRepository } from '../../repositories/ProjectAccessRepository.js';
import { agentMutatingToolNames } from './tools/index.js';
import { opencodeRuntime, parseMetadata, type OpenCodeEvent, type OpencodeRuntime, type OpentalesSessionMetadata } from './opencode/host.js';
import {
  toMessage,
  toPermissionRequest,
  toQuestion,
  toSessionSummary,
  toTokens,
  toToolPart,
  toModelRef
} from './opencode/mapping.js';
import { OPENTALES_PRIMARY_AGENT, sessionPermissions, type ApprovalMode } from './opencode/permissions.js';
import { modelKey, OPENTALES_PROVIDER_ID } from './opencode/providers.js';

const INITIAL_MESSAGE_LIMIT = 60;
const MAX_ATTACHMENT_BYTES = 8 * 1024 * 1024;
const HEARTBEAT_MS = 15_000;
const HIDDEN_AGENTS = new Set(['compaction', 'title', 'summary', 'build', 'plan']);

type Json = Record<string, any>;

/**
 * Agent sessions backed by the embedded OpenCode V2 host. OpenCode owns the
 * agent loop, transcript, subagents, skills, questions, and permissions;
 * OpenTales owns identity, project authorization, tools, and approval UX.
 */
export class OpencodeAgentUseCase {
  private readonly access: ProjectAccessRepository;
  private readonly runtime: OpencodeRuntime;
  /** Live status per session, derived from OpenCode execution events. */
  private static readonly statuses = new Map<string, { status: AiAgentSessionStatus; error: string | null }>();

  constructor(private readonly prisma: PrismaClient, runtime?: OpencodeRuntime) {
    this.access = new ProjectAccessRepository(prisma);
    this.runtime = runtime ?? opencodeRuntime(prisma);
  }

  async list(userId: string, projectId: string): Promise<AiAgentSessionSummary[]> {
    await this.access.assertProjectAccess(userId, projectId);
    const workspace = await this.runtime.ensureProject(projectId);
    const host = await this.runtime.host();
    const sessions = await host.sessions.list({ directory: workspace.directory, parentID: null, limit: 100, order: 'desc' });
    return sessions.data
      .filter((info) => {
        const metadata = parseMetadata(info.metadata);
        return metadata?.opentalesProjectId === projectId && metadata.opentalesUserId === userId;
      })
      .map((info) => {
        this.runtime.rememberSession(info);
        return toSessionSummary(info, this.statusOf(info.id).status);
      });
  }

  async capabilities(userId: string, projectId: string): Promise<AiAgentCapabilities> {
    await this.access.assertProjectAccess(userId, projectId);
    const workspace = await this.runtime.ensureProject(projectId);
    const host = await this.runtime.host();
    const location = { location: { directory: workspace.directory } };
    const [agents, skills] = await Promise.all([host.agent.list(location), host.skill.list(location)]);
    const mutating = new Set<string>(agentMutatingToolNames);
    const { toolManifest } = await import('./opencode/toolManifest.js');
    return {
      agents: agents.data
        .filter((agent) => !HIDDEN_AGENTS.has(agent.id) && !agent.hidden)
        .map((agent) => ({
          id: agent.id,
          name: agent.name,
          description: agent.description ?? null,
          mode: agent.mode,
          color: typeof agent.color === 'string' ? agent.color : null
        })),
      skills: skills.data.map((skill: Json) => ({ id: String(skill.id), name: String(skill.name ?? skill.id), description: skill.description ?? null })),
      tools: toolManifest(this.prisma, projectId, userId).map((tool) => ({ ...tool, requiresApproval: mutating.has(tool.name) })),
      defaultAgent: OPENTALES_PRIMARY_AGENT,
      model: workspace.defaultModel
    };
  }

  async create(userId: string, projectId: string, input: CreateAiAgentSessionInput = {}): Promise<AiAgentSession> {
    await this.access.assertProjectAccess(userId, projectId);
    const approvalMode = await this.resolveMode(userId, projectId, input.approvalMode ?? 'manual');
    const workspace = await this.runtime.ensureProject(projectId);
    const host = await this.runtime.host();
    const metadata: OpentalesSessionMetadata = { opentalesProjectId: projectId, opentalesUserId: userId, approvalMode };
    const info = await host.sessions.create({
      location: { directory: workspace.directory },
      title: input.title?.trim() || undefined,
      agent: input.agent ?? OPENTALES_PRIMARY_AGENT,
      metadata: { ...metadata },
      permissions: sessionPermissions(approvalMode)
    });
    this.runtime.setRootMetadata(info.id, metadata);
    this.runtime.rememberSession(info);
    return this.snapshot(info.id);
  }

  async get(userId: string, projectId: string, sessionId: string): Promise<AiAgentSession> {
    await this.authorize(userId, projectId, sessionId);
    return this.snapshot(sessionId);
  }

  async messages(
    userId: string,
    projectId: string,
    sessionId: string,
    input: { cursor?: string; limit?: number }
  ): Promise<AiAgentMessagePage> {
    await this.authorize(userId, projectId, sessionId);
    const host = await this.runtime.host();
    const limit = Math.min(Math.max(input.limit ?? INITIAL_MESSAGE_LIMIT, 1), 200);
    // A cursor already encodes its direction; OpenCode rejects cursor + order.
    const page = await host.message.list(
      input.cursor ? { sessionID: sessionId, limit, cursor: input.cursor } : { sessionID: sessionId, order: 'desc', limit }
    );
    return {
      messages: page.data.map((message) => toMessage(message)).filter((m): m is AiAgentMessage => Boolean(m)).reverse(),
      cursor: page.cursor.next ?? null,
      hasMore: Boolean(page.cursor.next) && page.data.length === limit
    };
  }

  async update(userId: string, projectId: string, sessionId: string, input: UpdateAiAgentSessionInput): Promise<AiAgentSession> {
    const { metadata } = await this.authorize(userId, projectId, sessionId);
    const host = await this.runtime.host();
    if (input.approvalMode && input.approvalMode !== metadata.approvalMode) {
      if (this.statusOf(sessionId).status === 'running') {
        throw new HttpError(409, 'Execution mode cannot change while the agent is running');
      }
      const approvalMode = await this.resolveMode(userId, projectId, input.approvalMode);
      const next: OpentalesSessionMetadata = { ...metadata, approvalMode };
      await host.sessions.update({ sessionID: sessionId, metadata: { ...next }, permissions: sessionPermissions(approvalMode) });
      this.runtime.setRootMetadata(sessionId, next);
    }
    if (input.title?.trim()) await host.sessions.update({ sessionID: sessionId, title: input.title.trim() });
    if (input.agent) await this.switchAgent(projectId, sessionId, input.agent);
    if (input.model) await this.switchModel(projectId, sessionId, input.model);
    return this.snapshot(sessionId);
  }

  async remove(userId: string, projectId: string, sessionId: string): Promise<void> {
    await this.authorize(userId, projectId, sessionId);
    const host = await this.runtime.host();
    await host.sessions.interrupt({ sessionID: sessionId }).catch(() => undefined);
    await host.sessions.remove({ sessionID: sessionId });
    OpencodeAgentUseCase.statuses.delete(sessionId);
  }

  async prompt(userId: string, projectId: string, sessionId: string, input: SendAiAgentPromptInput): Promise<AiAgentSession> {
    const parsed = promptSchema.parse(input);
    await this.authorize(userId, projectId, sessionId);
    await this.runtime.ensureProject(projectId);
    const host = await this.runtime.host();
    if (parsed.agent) await this.switchAgent(projectId, sessionId, parsed.agent);
    if (parsed.model) await this.switchModel(projectId, sessionId, parsed.model);

    const files = (parsed.attachments ?? []).map((attachment) => {
      const bytes = Math.floor((attachment.base64.length * 3) / 4);
      if (bytes > MAX_ATTACHMENT_BYTES) throw new HttpError(413, `${attachment.name} is larger than 8 MB`);
      return { data: attachment.base64, mime: attachment.mimeType, name: attachment.name, source: { type: 'inline' as const } };
    });
    const text = withReferences(parsed.text, parsed.references ?? []);
    OpencodeAgentUseCase.statuses.set(sessionId, { status: 'running', error: null });
    await host.sessions.prompt({
      sessionID: sessionId,
      text,
      delivery: parsed.delivery ?? 'steer',
      ...(files.length ? { files } : {}),
      ...(parsed.skills?.length ? { skills: parsed.skills.map((id) => ({ id })) } : {}),
      metadata: { opentalesUserId: userId }
    } as Parameters<typeof host.sessions.prompt>[0]);
    return this.snapshot(sessionId);
  }

  async interrupt(userId: string, projectId: string, sessionId: string): Promise<AiAgentSession> {
    await this.authorize(userId, projectId, sessionId);
    const host = await this.runtime.host();
    await host.sessions.interrupt({ sessionID: sessionId });
    const children = await this.descendants(sessionId);
    await Promise.all(children.map((id) => host.sessions.interrupt({ sessionID: id }).catch(() => undefined)));
    return this.snapshot(sessionId);
  }

  async replyPermission(userId: string, projectId: string, sessionId: string, requestId: string, input: ReplyAiPermissionInput): Promise<void> {
    const decision = z.enum(['once', 'always', 'reject']).parse(input?.decision);
    const target = await this.ownedDescendant(userId, projectId, sessionId);
    await this.access.assertPermission(userId, projectId, 'project:write');
    const host = await this.runtime.host();
    const pending = await host.permission.list({ sessionID: target });
    if (!pending.some((request) => request.id === requestId)) throw new HttpError(404, 'Approval request not found or already decided');
    await host.permission.reply({
      sessionID: target,
      requestID: requestId,
      decision,
      ...(input.message?.trim() ? { message: input.message.trim().slice(0, 2000) } : {})
    });
  }

  async answerQuestion(userId: string, projectId: string, sessionId: string, questionId: string, input: AnswerAiQuestionInput): Promise<void> {
    const target = await this.ownedDescendant(userId, projectId, sessionId);
    const answers = z.record(z.string(), z.union([z.string().max(4000), z.array(z.string().max(4000)).max(50), z.boolean(), z.number()])).parse(input?.answers);
    const host = await this.runtime.host();
    await host.session.form.reply({ sessionID: target, formID: questionId, answer: answers });
  }

  async dismissQuestion(userId: string, projectId: string, sessionId: string, questionId: string): Promise<void> {
    const target = await this.ownedDescendant(userId, projectId, sessionId);
    const host = await this.runtime.host();
    await host.session.form.cancel({ sessionID: target, formID: questionId });
  }

  /**
   * Stream every agent event for the caller's sessions in a project. Child
   * (subagent) sessions are included so the panel can render nested work.
   */
  async stream(userId: string, projectId: string, res: Response): Promise<void> {
    await this.access.assertProjectAccess(userId, projectId);
    const sessions = await this.list(userId, projectId);
    res.status(200);
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders?.();

    const write = (event: AiAgentStreamEvent) => {
      if (!res.writableEnded) res.write(`data: ${JSON.stringify(event)}\n\n`);
    };
    write({ type: 'connected', sessions });

    const owned = new Map<string, boolean>();
    const isOwned = async (sessionID: string) => {
      const known = owned.get(sessionID);
      if (known !== undefined) return known;
      const result = await this.runtime
        .rootOf(sessionID)
        .then(({ metadata }) => metadata.opentalesUserId === userId && metadata.opentalesProjectId === projectId)
        .catch(() => false);
      owned.set(sessionID, result);
      return result;
    };

    let chain = Promise.resolve();
    const unsubscribe = this.runtime.subscribe(projectId, (event) => {
      chain = chain
        .then(async () => {
          const sessionID = eventSessionId(event);
          if (!sessionID || !(await isOwned(sessionID))) return;
          for (const out of await this.translate(event)) write(out);
        })
        .catch((error) => console.warn('[opencode] stream translate failed', error));
    });
    const heartbeat = setInterval(() => {
      if (!res.writableEnded) res.write(': heartbeat\n\n');
    }, HEARTBEAT_MS);
    res.on('close', () => {
      clearInterval(heartbeat);
      unsubscribe();
    });
  }

  // ─── internals ──────────────────────────────────────────────────────────

  private async translate(event: OpenCodeEvent): Promise<AiAgentStreamEvent[]> {
    const data = (event as { data?: Json }).data ?? {};
    const sessionId = String(data.sessionID ?? data.form?.sessionID ?? '');
    const host = await this.runtime.host();
    const summary = async () => {
      const info = await host.sessions.get({ sessionID: sessionId });
      this.runtime.rememberSession(info);
      const root = info.parentID ? (await this.runtime.rootOf(sessionId).catch(() => null))?.metadata : undefined;
      return toSessionSummary(info, this.statusOf(sessionId).status, root);
    };
    const message = async (messageID: string) => {
      const raw = await host.sessions.message.get({ sessionID: sessionId, messageID }).catch(() => null);
      const mapped = raw ? toMessage(raw) : null;
      return mapped ? [{ type: 'message.updated' as const, sessionId, message: mapped }] : [];
    };

    switch (event.type) {
      case 'session.created':
      case 'session.renamed':
      case 'session.metadata.updated':
      case 'session.agent.selected':
      case 'session.model.selected':
        return [{ type: 'session.updated', session: await summary() }];
      case 'session.deleted':
        return [{ type: 'session.deleted', sessionId }];
      case 'session.execution.started':
        OpencodeAgentUseCase.statuses.set(sessionId, { status: 'running', error: null });
        return [{ type: 'status', sessionId, status: 'running', error: null }];
      case 'session.execution.succeeded':
      case 'session.execution.interrupted':
        OpencodeAgentUseCase.statuses.set(sessionId, { status: 'idle', error: null });
        return [{ type: 'status', sessionId, status: 'idle', error: null }, { type: 'session.updated', session: await summary() }];
      case 'session.execution.failed': {
        const error = friendlyError(data.error);
        OpencodeAgentUseCase.statuses.set(sessionId, { status: 'error', error });
        return [{ type: 'status', sessionId, status: 'error', error }, { type: 'session.updated', session: await summary() }];
      }
      case 'session.retry.scheduled':
        OpencodeAgentUseCase.statuses.set(sessionId, { status: 'retrying', error: null });
        return [{ type: 'status', sessionId, status: 'retrying', retry: { attempt: Number(data.attempt ?? 1), message: friendlyError(data.error) } }];
      case 'session.inbox.enqueued':
        if (data.item?.type === 'user') {
          return [{
            type: 'message.updated',
            sessionId,
            message: { id: String(data.inboxID), role: 'user', text: String(data.item.payload?.text ?? ''), files: [], createdAt: new Date(event.created).toISOString() }
          }];
        }
        return [];
      case 'session.step.started':
      case 'session.step.ended':
      case 'session.step.failed':
      case 'session.text.ended':
      case 'session.reasoning.ended':
        return message(String(data.assistantMessageID));
      case 'session.text.delta':
        return [{ type: 'text.delta', sessionId, messageId: String(data.assistantMessageID), index: Number(data.ordinal ?? 0), delta: String(data.delta ?? '') }];
      case 'session.reasoning.delta':
        return [{ type: 'reasoning.delta', sessionId, messageId: String(data.assistantMessageID), index: Number(data.ordinal ?? 0), delta: String(data.delta ?? '') }];
      case 'session.tool.input.started':
      case 'session.tool.called':
      case 'session.tool.progress':
      case 'session.tool.success':
      case 'session.tool.failed': {
        const raw = await host.sessions.message.get({ sessionID: sessionId, messageID: String(data.assistantMessageID) }).catch(() => null);
        const part = (raw as Json | null)?.content?.find((item: Json) => item.type === 'tool' && item.id === data.id);
        if (part) return [{ type: 'tool.updated', sessionId, messageId: String(data.assistantMessageID), part: toToolPart(part) }];
        if (event.type === 'session.tool.input.started') {
          return [{
            type: 'tool.updated',
            sessionId,
            messageId: String(data.assistantMessageID),
            part: { type: 'tool', id: String(data.id), name: String(data.name), state: { status: 'streaming', input: '' }, childSessionId: null, startedAt: new Date(event.created).toISOString(), completedAt: null }
          }];
        }
        return message(String(data.assistantMessageID));
      }
      case 'session.usage.updated':
        return [{ type: 'usage', sessionId, cost: Number(data.cost ?? 0), tokens: toTokens(data.tokens) }];
      case 'permission.asked':
        return [{ type: 'permission.asked', request: toPermissionRequest(data) }];
      case 'permission.replied':
        return [{ type: 'permission.replied', sessionId, requestId: String(data.requestID), decision: String(data.reply) }];
      case 'form.created':
        return [{ type: 'question.asked', question: toQuestion(data.form) }];
      case 'form.replied':
      case 'form.cancelled':
        return [{ type: 'question.closed', sessionId, questionId: String(data.id) }];
      default:
        return [];
    }
  }

  private async snapshot(sessionId: string): Promise<AiAgentSession> {
    const host = await this.runtime.host();
    const [info, page, permissions, forms, inbox] = await Promise.all([
      host.sessions.get({ sessionID: sessionId }),
      host.message.list({ sessionID: sessionId, order: 'desc', limit: INITIAL_MESSAGE_LIMIT }),
      this.collectPermissions(sessionId),
      this.collectQuestions(sessionId),
      host.sessions.inbox.list({ sessionID: sessionId }).catch(() => [])
    ]);
    this.runtime.rememberSession(info);
    const live = this.statusOf(sessionId);
    const pendingUserMessages: AiAgentMessage[] = (inbox as Json[])
      .filter((item) => item.type === 'user')
      .map((item) => ({
        id: String(item.id),
        role: 'user',
        text: String(item.payload?.text ?? ''),
        files: [],
        createdAt: new Date(Number(item.time?.created ?? Date.now())).toISOString()
      }));
    const lastAssistant = page.data.find((message) => message.type === 'assistant') as Json | undefined;
    return {
      ...toSessionSummary(info, live.status),
      messages: [
        ...page.data.map((message) => toMessage(message)).filter((m): m is AiAgentMessage => Boolean(m)).reverse(),
        ...pendingUserMessages
      ],
      hasEarlierMessages: Boolean(page.cursor.next) && page.data.length === INITIAL_MESSAGE_LIMIT,
      earlierCursor: page.cursor.next ?? null,
      permissions,
      questions: forms,
      queue: (inbox as Json[])
        .filter((item) => item.type === 'user')
        .map((item) => ({ id: String(item.id), text: String(item.payload?.text ?? ''), delivery: item.delivery === 'queue' ? 'queue' : 'steer' })),
      error: live.error ?? (info.outcome === 'failed' ? friendlyError(lastAssistant?.error) : null)
    };
  }

  /** Pending approvals for a session and every subagent session under it. */
  private async collectPermissions(sessionId: string) {
    const host = await this.runtime.host();
    const ids = [sessionId, ...(await this.descendants(sessionId))];
    const lists = await Promise.all(ids.map((id) => host.permission.list({ sessionID: id }).catch(() => [])));
    return lists.flat().map((request) => toPermissionRequest(request));
  }

  private async collectQuestions(sessionId: string) {
    const host = await this.runtime.host();
    const ids = [sessionId, ...(await this.descendants(sessionId))];
    const lists = await Promise.all(ids.map((id) => host.session.form.list({ sessionID: id }).catch(() => [])));
    return lists.flat().map((form) => toQuestion(form));
  }

  private async descendants(sessionId: string, depth = 0): Promise<string[]> {
    if (depth > 4) return [];
    const host = await this.runtime.host();
    const info = await host.sessions.get({ sessionID: sessionId });
    const children = await host.sessions.list({ directory: info.location.directory, parentID: sessionId, limit: 50 }).catch(() => ({ data: [] as Json[] }));
    const nested = await Promise.all(children.data.map((child: Json) => this.descendants(String(child.id), depth + 1)));
    return [...children.data.map((child: Json) => String(child.id)), ...nested.flat()];
  }

  private async authorize(userId: string, projectId: string, sessionId: string) {
    await this.access.assertProjectAccess(userId, projectId);
    const root = await this.runtime.rootOf(sessionId).catch(() => {
      throw new HttpError(404, 'Agent session not found');
    });
    if (root.metadata.opentalesProjectId !== projectId || root.metadata.opentalesUserId !== userId) {
      throw new HttpError(404, 'Agent session not found');
    }
    return root;
  }

  /** Allow actions on a subagent session when the caller owns its root. */
  private async ownedDescendant(userId: string, projectId: string, sessionId: string): Promise<string> {
    await this.authorize(userId, projectId, sessionId);
    return sessionId;
  }

  private async resolveMode(userId: string, projectId: string, mode: ApprovalMode): Promise<ApprovalMode> {
    if (mode === 'auto') await this.access.assertPermission(userId, projectId, 'project:admin');
    return mode;
  }

  private async switchAgent(projectId: string, sessionId: string, agent: string) {
    const workspace = await this.runtime.ensureProject(projectId);
    const host = await this.runtime.host();
    const agents = await host.agent.list({ location: { directory: workspace.directory } });
    const found = agents.data.find((candidate) => candidate.id === agent && candidate.mode !== 'subagent' && !HIDDEN_AGENTS.has(candidate.id));
    if (!found) throw new HttpError(400, `Agent ${agent} is not available`);
    await host.sessions.switchAgent({ sessionID: sessionId, agent });
  }

  private async switchModel(projectId: string, sessionId: string, model: string) {
    const settings = await this.prisma.projectAiSettings.findUnique({ where: { projectId } });
    if (!settings?.enabled) throw new HttpError(400, 'AI is not enabled for this project');
    const trimmed = model.trim();
    if (!trimmed || trimmed.length > 200) throw new HttpError(400, 'Invalid model');
    if (trimmed !== settings.model) {
      // Persist as the project model so the workspace provider lists it.
      await this.prisma.projectAiSettings.update({ where: { projectId }, data: { model: trimmed } });
    }
    await this.runtime.ensureProject(projectId);
    const host = await this.runtime.host();
    await host.sessions.switchModel({ sessionID: sessionId, model: { providerID: OPENTALES_PROVIDER_ID, id: modelKey(trimmed) } });
  }

  private statusOf(sessionId: string) {
    return OpencodeAgentUseCase.statuses.get(sessionId) ?? { status: 'idle' as const, error: null };
  }
}

const promptSchema = z.object({
  text: z.string().trim().min(1, 'Prompt is required').max(100_000),
  agent: z.string().trim().min(1).max(64).optional(),
  model: z.string().trim().min(1).max(200).optional(),
  delivery: z.enum(['steer', 'queue']).optional(),
  skills: z.array(z.string().trim().min(1).max(128)).max(10).optional(),
  attachments: z.array(z.object({
    name: z.string().trim().min(1).max(255),
    mimeType: z.string().trim().min(1).max(200),
    base64: z.string().min(1)
  })).max(10).optional(),
  references: z.array(z.object({
    type: z.enum(['folder', 'doc', 'asset', 'chapter', 'character', 'location', 'act', 'structure', 'obstacle']),
    id: z.string().trim().min(1).max(200),
    path: z.string().max(1000).optional(),
    label: z.string().max(300).optional(),
    startLine: z.number().int().min(1).optional(),
    endLine: z.number().int().min(1).optional()
  })).max(25).optional()
});

/** Mentions become a compact, machine-readable list the agent resolves with read tools. */
function withReferences(text: string, references: z.infer<typeof promptSchema>['references'] & object): string {
  if (!references.length) return text;
  const lines = references.map((ref) => {
    const range = ref.startLine ? ` lines ${ref.startLine}-${ref.endLine ?? ref.startLine}` : '';
    const label = ref.label ?? ref.path ?? ref.id;
    return `- ${ref.type} "${label}" (id: ${ref.id}${ref.path ? `, path: ${ref.path}` : ''})${range}`;
  });
  return `${text}\n\n<referenced_project_items>\nThe author referenced these items. Read them with OpenTales tools before relying on their contents.\n${lines.join('\n')}\n</referenced_project_items>`;
}

function eventSessionId(event: OpenCodeEvent): string | null {
  const data = (event as { data?: Json }).data ?? {};
  if (typeof data.sessionID === 'string') return data.sessionID;
  if (typeof data.form?.sessionID === 'string') return data.form.sessionID;
  return null;
}

function friendlyError(error: unknown): string {
  const value = (error ?? {}) as Json;
  const message = typeof value.message === 'string' ? value.message : 'The agent run failed';
  if (value.type === 'provider.auth') return `${message}. Check the API key or reconnect the provider in AI settings.`;
  if (value.status === 429) return `${message}. The provider is rate limiting requests.`;
  return message;
}

export { toModelRef };
