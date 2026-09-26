import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createServer, type Server } from 'node:http';
import { Readable } from 'node:stream';
import { PrismaClient } from '@prisma/client';
import type { AiAgentStreamEvent } from '@opentales/sdk';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

/**
 * End-to-end check of the embedded OpenCode harness against a real
 * OpenAI-compatible model. Opt-in: requires a migrated database and a model
 * endpoint, e.g.
 *
 *   OPENCODE_LIVE_DATABASE_URL=postgresql://… \
 *   OPENCODE_LIVE_BASE_URL=https://strata.yasui.io \
 *   OPENCODE_LIVE_API_KEY=… OPENCODE_LIVE_MODEL=gpt-6-luna \
 *   pnpm vitest run src/useCases/ai/OpencodeAgentUseCase.live.test.ts
 */
const databaseUrl = process.env.OPENCODE_LIVE_DATABASE_URL;
const baseUrl = process.env.OPENCODE_LIVE_BASE_URL;
const apiKey = process.env.OPENCODE_LIVE_API_KEY;
const model = process.env.OPENCODE_LIVE_MODEL ?? 'gpt-6-luna';

describe.runIf(Boolean(databaseUrl && baseUrl && apiKey))('OpenCode agent harness (live)', () => {
  const prisma = new PrismaClient({ datasourceUrl: databaseUrl });
  const suffix = randomUUID().slice(0, 8);
  let userId: string;
  let projectId: string;
  let useCase: import('./OpencodeAgentUseCase.js').OpencodeAgentUseCase;
  let closeRuntime: () => Promise<void>;
  let dataDir: string;
  let proxy: Server;
  const modelRequests: Record<string, unknown>[] = [];

  beforeAll(async () => {
    dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'opentales-opencode-'));
    process.env.OPENCODE_DATA_DIR = dataDir;
    process.env.SECRET_BOX_KEY ??= 'test-secret-box-key-test-secret-box-key';
    const { encryptSecret } = await import('../../utils/secretBox.js');
    const { normalizeOpenAiBaseUrl } = await import('./opencode/providers.js');
    // Observe the actual wire request. OpenCode captures its fetch transport
    // during startup, so replacing global fetch cannot verify these overlays.
    proxy = createServer(async (request, response) => {
      try {
        const chunks: Buffer[] = [];
        for await (const chunk of request) chunks.push(Buffer.from(chunk));
        const body = Buffer.concat(chunks);
        if (request.url?.endsWith('/chat/completions')) {
          const parsed = JSON.parse(body.toString('utf8'));
          modelRequests.push({ model: parsed.model, effort: parsed.reasoning_effort, tier: parsed.service_tier });
        }
        const upstream = await fetch(`${normalizeOpenAiBaseUrl(baseUrl!)}${(request.url ?? '').replace(/^\/v1/, '')}`, {
          method: request.method,
          headers: { 'content-type': 'application/json', ...(request.headers.authorization ? { authorization: request.headers.authorization } : {}) },
          ...(body.length ? { body } : {})
        });
        response.writeHead(upstream.status, { 'content-type': upstream.headers.get('content-type') ?? 'application/json' });
        if (upstream.body) Readable.fromWeb(upstream.body as import('node:stream/web').ReadableStream).pipe(response);
        else response.end();
      } catch { response.writeHead(502); response.end('Test proxy upstream request failed'); }
    });
    await new Promise<void>((resolve) => proxy.listen(0, '127.0.0.1', resolve));
    const address = proxy.address() as import('node:net').AddressInfo;
    const user = await prisma.user.create({
      data: { username: `oc-${suffix}`, email: `oc-${suffix}@example.test`, passwordHash: 'test' }
    });
    userId = user.id;
    const org = await prisma.org.create({
      data: { slug: `oc-${suffix}`, name: 'OpenCode live', memberships: { create: { userId, role: 'OWNER' } } }
    });
    const project = await prisma.project.create({
      data: { orgId: org.id, slug: `oc-${suffix}`, title: 'The Lighthouse Keeper', genre: 'Literary mystery' }
    });
    projectId = project.id;
    await prisma.projectAiSettings.create({
      data: {
        projectId,
        enabled: true,
        providerKind: 'OPENAI_COMPATIBLE',
        model,
        baseUrl: `http://127.0.0.1:${address.port}/v1`,
        apiKey: encryptSecret(apiKey!)
      }
    });
    const { OpencodeAgentUseCase } = await import('./OpencodeAgentUseCase.js');
    const host = await import('./opencode/host.js');
    useCase = new OpencodeAgentUseCase(prisma);
    closeRuntime = host.closeOpencodeRuntime;
  }, 120_000);

  afterAll(async () => {
    await closeRuntime?.();
    proxy?.closeAllConnections();
    if (proxy) await new Promise<void>((resolve) => proxy.close(() => resolve()));
    await prisma.project.deleteMany({ where: { id: projectId } }).catch(() => undefined);
    await prisma.$disconnect();
    await fs.rm(dataDir, { recursive: true, force: true });
  });

  async function runUntilIdle(sessionId: string, act: () => Promise<unknown>, onEvent?: (event: AiAgentStreamEvent) => Promise<void> | void) {
    const events: AiAgentStreamEvent[] = [];
    const chunks: string[] = [];
    let resolveDone!: () => void;
    const done = new Promise<void>((resolve) => (resolveDone = resolve));
    const res = fakeSseResponse((line) => {
      chunks.push(line);
      const match = /^data: (.*)$/m.exec(line);
      if (!match) return;
      const event = JSON.parse(match[1]) as AiAgentStreamEvent;
      events.push(event);
      void onEvent?.(event);
      if (event.type === 'status' && event.sessionId === sessionId && (event.status === 'idle' || event.status === 'error')) resolveDone();
    });
    await useCase.stream(userId, projectId, res as never);
    await act();
    await Promise.race([done, new Promise((_, reject) => setTimeout(() => reject(new Error('timed out')), 150_000))]);
    res.emit('close');
    return events;
  }

  it.runIf(/gpt-6-luna/.test(model))('discovers models and sends persistent effort and speed choices through OpenCode', async () => {
    const { ProjectAiModelsUseCase } = await import('./ProjectAiModelsUseCase.js');
    const catalog = await new ProjectAiModelsUseCase(prisma).list(userId, projectId);
    const selected = catalog.providers.flatMap((provider) => provider.models).find((item) => item.id === model)!;
    expect(catalog.source).toBe('provider');
    expect(selected.reasoningEfforts).toContain('low');
    expect(selected.supportsFast).toBe(true);
    const session = await useCase.create(userId, projectId, { model, reasoningEffort: 'low', serviceTier: 'fast' });
    expect(session.model).toMatchObject({ model, reasoningEffort: 'low', serviceTier: 'fast' });
    await runUntilIdle(session.id, () => useCase.prompt(userId, projectId, session.id, { text: 'Reply with exactly OK. Do not call tools.' }));
    expect(modelRequests).toContainEqual({ model, effort: 'low', tier: 'priority' });
    expect((await useCase.get(userId, projectId, session.id)).model).toMatchObject({ reasoningEffort: 'low', serviceTier: 'fast' });
    await useCase.update(userId, projectId, session.id, { serviceTier: 'standard', reasoningEffort: null });
    await runUntilIdle(session.id, () => useCase.prompt(userId, projectId, session.id, { text: 'Reply with exactly OK again. Do not call tools.' }));
    expect(modelRequests).toContainEqual({ model, effort: undefined, tier: 'default' });
  }, 200_000);

  it('runs an OpenTales tool, gates a mutation on approval, and streams the transcript', async () => {
    const created = await useCase.create(userId, projectId, { title: 'Live test' });
    expect(created.approvalMode).toBe('manual');

    const events = await runUntilIdle(
      created.id,
      () => useCase.prompt(userId, projectId, created.id, {
        text: 'Use readProject to find the project title, then create a character named "Mara Quill" with role "protagonist" using createCharacter. Finally reply with the title in one short sentence.'
      }),
      async (event) => {
        if (event.type === 'permission.asked') {
          expect(event.request.toolName).toBe('createCharacter');
          await useCase.replyPermission(userId, projectId, event.request.sessionId, event.request.id, { decision: 'once' });
        }
      }
    );

    const toolNames = events.flatMap((event) => (event.type === 'tool.updated' ? [event.part.name] : []));
    expect(toolNames).toContain('readProject');
    expect(toolNames).toContain('createCharacter');
    expect(events.some((event) => event.type === 'permission.asked')).toBe(true);
    expect(events.some((event) => event.type === 'text.delta')).toBe(true);

    const character = await prisma.character.findFirst({ where: { projectId, name: 'Mara Quill' } });
    expect(character).not.toBeNull();

    const session = await useCase.get(userId, projectId, created.id);
    const assistantText = session.messages
      .flatMap((message) => (message.role === 'assistant' ? message.parts : []))
      .flatMap((part) => (part.type === 'text' ? [part.text] : []))
      .join(' ');
    expect(assistantText).toMatch(/Lighthouse Keeper/i);
    expect(session.permissions).toHaveLength(0);
  }, 200_000);

  it('rejecting an approval leaves project data unchanged', async () => {
    const created = await useCase.create(userId, projectId, { title: 'Reject test' });
    await runUntilIdle(
      created.id,
      () => useCase.prompt(userId, projectId, created.id, {
        text: 'Create a location named "Gull Rock" with createLocation. If the change is rejected, say so and stop.'
      }),
      async (event) => {
        if (event.type === 'permission.asked') {
          await useCase.replyPermission(userId, projectId, event.request.sessionId, event.request.id, { decision: 'reject', message: 'Not yet' });
        }
      }
    );
    const location = await prisma.location.findFirst({ where: { projectId, name: 'Gull Rock' } });
    expect(location).toBeNull();
  }, 200_000);

  it('lists only the caller\'s sessions and exposes OpenTales capabilities', async () => {
    const sessions = await useCase.list(userId, projectId);
    expect(sessions.length).toBeGreaterThanOrEqual(2);
    const capabilities = await useCase.capabilities(userId, projectId);
    expect(capabilities.agents.map((agent) => agent.id)).toContain('writer');
    expect(capabilities.tools.map((tool) => tool.name)).toContain('updateChapter');
    expect(capabilities.skills.map((skill) => skill.id)).toContain('novel-voice');
  }, 60_000);
});

function fakeSseResponse(onWrite: (chunk: string) => void) {
  const handlers = new Map<string, Array<() => void>>();
  return {
    writableEnded: false,
    status() { return this; },
    setHeader() {},
    flushHeaders() {},
    write(chunk: string) { onWrite(chunk); return true; },
    end() { this.writableEnded = true; },
    on(event: string, handler: () => void) {
      handlers.set(event, [...(handlers.get(event) ?? []), handler]);
      return this;
    },
    emit(event: string) {
      for (const handler of handlers.get(event) ?? []) handler();
    }
  };
}
