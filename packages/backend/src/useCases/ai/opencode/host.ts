import fs from 'node:fs/promises';
import type { PrismaClient } from '@prisma/client';
import type { OpenCodeClient, OpenCodeEvent } from '@opencode/client';
import { HttpError } from '../../../http/HttpError.js';
import { isolateOpencodeEnvironment, opencodeDatabasePath, opencodeRoot, projectIdFromWorkspace } from './paths.js';
import { opentalesPlugin, type OpentalesHostBridge } from './plugin.js';
import { OPENTALES_PRIMARY_AGENT, WRITE_ACTION, type ApprovalMode } from './permissions.js';
import { syncProjectWorkspace, type ProjectWorkspace } from './workspace.js';

/**
 * `@opencode/sdk`'s published declarations use extensionless relative imports,
 * which NodeNext resolution cannot follow, so the host is typed through the
 * (correctly published) client it wraps.
 */
export type OpencodeHost = Omit<OpenCodeClient, 'plugin'> & {
  readonly sessions: OpenCodeClient['session'];
  readonly events: OpenCodeClient['event'];
  readonly close: () => Promise<void>;
};
export type { OpenCodeEvent };

/** Metadata OpenTales stores on every root OpenCode session. */
export interface OpentalesSessionMetadata {
  opentalesProjectId: string;
  opentalesUserId: string;
  approvalMode: ApprovalMode;
}

type Listener = (event: OpenCodeEvent) => void;

interface PendingPermission {
  resolve: () => void;
  reject: (error: Error) => void;
}

/**
 * Process-wide embedded OpenCode runtime. OpenCode runs in memory (no network
 * listener); each OpenTales project maps to one workspace directory and so to
 * one OpenCode instance, with its own agents, skills, provider, and plugin
 * instance. Session state is persisted by OpenCode in `opencode.db`.
 */
export class OpencodeRuntime {
  private hostPromise: Promise<OpencodeHost> | null = null;
  private readonly listeners = new Map<string, Set<Listener>>();
  private readonly sessionProjects = new Map<string, string>();
  private readonly sessionParents = new Map<string, string | null>();
  private readonly rootMetadata = new Map<string, OpentalesSessionMetadata>();
  private readonly fingerprints = new Map<string, string>();
  private readonly pendingPermissions = new Map<string, PendingPermission>();
  private eventLoop: Promise<void> | null = null;
  private closed = false;

  constructor(private readonly prisma: PrismaClient) {}

  async host(): Promise<OpencodeHost> {
    if (this.closed) throw new HttpError(503, 'Agent runtime is shutting down');
    this.hostPromise ??= this.start().catch((error) => {
      this.hostPromise = null;
      throw error;
    });
    return this.hostPromise;
  }

  private async start(): Promise<OpencodeHost> {
    isolateOpencodeEnvironment();
    await fs.mkdir(opencodeRoot, { recursive: true });
    const { OpenCode } = await import('@opencode/sdk');
    const bridge: OpentalesHostBridge = {
      sessionOwner: (sessionID) => this.sessionOwner(sessionID),
      approvalMode: async (sessionID) => (await this.rootOf(sessionID)).metadata.approvalMode,
      authorizeMutation: (input) => this.authorizeMutation(input)
    };
    const create = OpenCode.create as unknown as (options: Record<string, unknown>) => Promise<OpencodeHost>;
    const host = await create({
      app: { name: 'opentales', channel: 'embedded' },
      database: { path: opencodeDatabasePath },
      plugins: [opentalesPlugin(this.prisma, bridge)],
      fs: { filewatcher: false }
    });
    this.eventLoop = this.pumpEvents(host);
    return host;
  }

  async close(): Promise<void> {
    this.closed = true;
    for (const pending of this.pendingPermissions.values()) pending.reject(new Error('Agent runtime is shutting down'));
    this.pendingPermissions.clear();
    const host = await this.hostPromise?.catch(() => null);
    await host?.close().catch(() => undefined);
    await this.eventLoop?.catch(() => undefined);
  }

  /**
   * Regenerate a project's OpenCode workspace from OpenTales data and reload
   * the instance when anything (settings, agents, skills) changed.
   */
  async ensureProject(projectId: string): Promise<ProjectWorkspace> {
    const workspace = await syncProjectWorkspace(this.prisma, projectId);
    const previous = this.fingerprints.get(projectId);
    if (previous !== workspace.fingerprint) {
      const host = await this.host();
      if (previous !== undefined) {
        await host.location.reload({ headers: { 'x-opencode-directory': workspace.directory } }).catch(() => undefined);
      }
      await this.waitForInstance(workspace.directory);
      this.fingerprints.set(projectId, workspace.fingerprint);
    }
    return workspace;
  }

  /**
   * OpenCode boots a location's instance lazily: the first request starts it
   * and catalog reads return only built-ins until the project config loads.
   * Poll until the OpenTales primary agent from our config is present.
   */
  private async waitForInstance(directory: string): Promise<void> {
    const host = await this.host();
    const deadline = Date.now() + 15_000;
    let delay = 50;
    while (Date.now() < deadline) {
      const agents = await host.agent.list({ location: { directory } }).catch(() => null);
      if (agents?.data.some((agent) => agent.id === OPENTALES_PRIMARY_AGENT)) return;
      await new Promise((resolve) => setTimeout(resolve, delay));
      delay = Math.min(delay * 2, 500);
    }
    console.warn(`[opencode] instance for ${directory} did not load its OpenTales config within 15s`);
  }

  /** Subscribe to every OpenCode event that belongs to a project's sessions. */
  subscribe(projectId: string, listener: Listener): () => void {
    let set = this.listeners.get(projectId);
    if (!set) {
      set = new Set();
      this.listeners.set(projectId, set);
    }
    set.add(listener);
    void this.host().catch(() => undefined);
    return () => {
      set?.delete(listener);
      if (set?.size === 0) this.listeners.delete(projectId);
    };
  }

  rememberSession(session: { id: string; parentID?: string; location?: { directory: string }; metadata?: Record<string, unknown> }) {
    const projectId = session.location ? projectIdFromWorkspace(session.location.directory) : null;
    if (projectId) this.sessionProjects.set(session.id, projectId);
    this.sessionParents.set(session.id, session.parentID ?? null);
    const metadata = parseMetadata(session.metadata);
    if (metadata) this.rootMetadata.set(session.id, metadata);
  }

  /** Walk to the root session and return the OpenTales owner metadata. */
  async rootOf(sessionID: string): Promise<{ rootID: string; metadata: OpentalesSessionMetadata }> {
    const host = await this.host();
    let current = sessionID;
    for (let depth = 0; depth < 16; depth += 1) {
      const cached = this.rootMetadata.get(current);
      if (cached && !this.sessionParents.get(current)) return { rootID: current, metadata: cached };
      let parent = this.sessionParents.get(current);
      if (parent === undefined || (!cached && parent === null)) {
        const info = await host.sessions.get({ sessionID: current });
        this.rememberSession(info);
        parent = info.parentID ?? null;
        const metadata = parseMetadata(info.metadata);
        if (!parent) {
          if (!metadata) throw new HttpError(404, 'Agent session not found');
          return { rootID: current, metadata };
        }
      }
      if (!parent) break;
      current = parent;
    }
    throw new HttpError(404, 'Agent session not found');
  }

  setRootMetadata(sessionID: string, metadata: OpentalesSessionMetadata) {
    this.rootMetadata.set(sessionID, metadata);
    this.sessionParents.set(sessionID, null);
  }

  private async sessionOwner(sessionID: string) {
    const { metadata } = await this.rootOf(sessionID);
    return { userId: metadata.opentalesUserId, projectId: metadata.opentalesProjectId };
  }

  private async authorizeMutation(input: Parameters<OpentalesHostBridge['authorizeMutation']>[0]): Promise<void> {
    const { metadata } = await this.rootOf(input.sessionID);
    if (metadata.approvalMode === 'auto') return;
    const host = await this.host();
    const request = await host.permission.create({
      sessionID: input.sessionID,
      action: WRITE_ACTION,
      resources: [input.toolName],
      save: [input.toolName],
      metadata: { tool: input.toolName, input: input.toolInput as never },
      source: { type: 'tool', messageID: input.messageID, id: input.callID },
      agent: input.agent
    });
    if (request.effect === 'allow') return;
    if (request.effect === 'deny') throw new HttpError(403, `${input.toolName} is not permitted for this agent`);
    await new Promise<void>((resolve, reject) => {
      const onAbort = () => {
        this.pendingPermissions.delete(request.id);
        reject(new Error('Run cancelled before the change was approved'));
      };
      if (input.signal.aborted) return onAbort();
      input.signal.addEventListener('abort', onAbort, { once: true });
      this.pendingPermissions.set(request.id, {
        resolve: () => {
          input.signal.removeEventListener('abort', onAbort);
          resolve();
        },
        reject: (error) => {
          input.signal.removeEventListener('abort', onAbort);
          reject(error);
        }
      });
    });
  }

  private async pumpEvents(host: OpencodeHost): Promise<void> {
    while (!this.closed) {
      try {
        for await (const event of host.events.subscribe()) {
          if (this.closed) return;
          await this.dispatch(event).catch((error) => {
            console.warn('[opencode] event dispatch failed', error);
          });
        }
      } catch (error) {
        if (this.closed) return;
        console.warn('[opencode] event stream ended; reconnecting', error);
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }
    }
  }

  private async dispatch(event: OpenCodeEvent): Promise<void> {
    const data = (event as { data?: Record<string, unknown> }).data ?? {};

    if (event.type === 'permission.replied') {
      const requestID = String(data.requestID ?? '');
      const pending = this.pendingPermissions.get(requestID);
      if (pending) {
        this.pendingPermissions.delete(requestID);
        if (data.reply === 'reject') {
          const message = typeof data.message === 'string' && data.message ? `: ${data.message}` : '';
          pending.reject(new Error(`The author rejected this change${message}`));
        } else pending.resolve();
      }
    }
    if (event.type === 'session.created') {
      this.sessionParents.set(String(data.sessionID), (data.parentID as string | undefined) ?? null);
      const metadata = parseMetadata(data.metadata);
      if (metadata) this.rootMetadata.set(String(data.sessionID), metadata);
    }

    const projectId = await this.projectOf(event, data);
    if (!projectId) return;
    const listeners = this.listeners.get(projectId);
    if (!listeners?.size) return;
    for (const listener of listeners) listener(event);
  }

  private async projectOf(event: OpenCodeEvent, data: Record<string, unknown>): Promise<string | null> {
    const location = (event as { location?: { directory?: string } }).location
      ?? (data.location as { directory?: string } | undefined);
    if (location?.directory) {
      const projectId = projectIdFromWorkspace(location.directory);
      const sessionID = sessionIdOf(data);
      if (projectId && sessionID) this.sessionProjects.set(sessionID, projectId);
      if (projectId) return projectId;
    }
    const sessionID = sessionIdOf(data);
    if (!sessionID) return null;
    const known = this.sessionProjects.get(sessionID);
    if (known) return known;
    try {
      const host = await this.host();
      const info = await host.sessions.get({ sessionID });
      this.rememberSession(info);
      return this.sessionProjects.get(sessionID) ?? null;
    } catch {
      return null;
    }
  }
}

function sessionIdOf(data: Record<string, unknown>): string | null {
  if (typeof data.sessionID === 'string') return data.sessionID;
  const form = data.form as { sessionID?: unknown } | undefined;
  return typeof form?.sessionID === 'string' ? form.sessionID : null;
}

export function parseMetadata(value: unknown): OpentalesSessionMetadata | null {
  if (!value || typeof value !== 'object') return null;
  const record = value as Record<string, unknown>;
  if (typeof record.opentalesProjectId !== 'string' || typeof record.opentalesUserId !== 'string') return null;
  return {
    opentalesProjectId: record.opentalesProjectId,
    opentalesUserId: record.opentalesUserId,
    approvalMode: record.approvalMode === 'auto' ? 'auto' : 'manual'
  };
}

let runtime: OpencodeRuntime | null = null;

export function opencodeRuntime(prisma: PrismaClient): OpencodeRuntime {
  runtime ??= new OpencodeRuntime(prisma);
  return runtime;
}

export async function closeOpencodeRuntime(): Promise<void> {
  await runtime?.close();
  runtime = null;
}
