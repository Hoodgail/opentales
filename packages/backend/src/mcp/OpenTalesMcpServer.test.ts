import type { AuthInfo } from '@modelcontextprotocol/server';
import { createMcpHandler } from '@modelcontextprotocol/server';
import type { PrismaClient } from '@prisma/client';
import { afterEach, describe, expect, it } from 'vitest';
import { createOpenTalesMcpServer } from './OpenTalesMcpServer.js';

const handlers: Array<ReturnType<typeof createMcpHandler>> = [];

afterEach(async () => {
  await Promise.all(handlers.splice(0).map((handler) => handler.close()));
});

describe('OpenTales MCP capability surface', () => {
  it('exposes every applicable workspace tool to read-write keys with accurate annotations', async () => {
    const result = await request(auth('read-write'), 'tools/list');
    const tools = result.tools as Array<{
      name: string;
      annotations?: { readOnlyHint?: boolean; destructiveHint?: boolean; idempotentHint?: boolean };
    }>;

    expect(tools.length).toBeGreaterThan(100);
    expect(tools.find((tool) => tool.name === 'readChapter')?.annotations?.readOnlyHint).toBe(true);
    expect(tools.find((tool) => tool.name === 'createChapter')?.annotations?.readOnlyHint).toBe(false);
    expect(tools.find((tool) => tool.name === 'deleteChapter')?.annotations?.destructiveHint).toBe(true);
    expect(tools.find((tool) => tool.name === 'rerunBuildTask')?.annotations?.readOnlyHint).toBe(false);
    expect(tools.find((tool) => tool.name === 'applyStoryPatch')?.annotations?.idempotentHint).toBe(true);
    expect(tools.find((tool) => tool.name === 'compileChapterFromScenes')?.annotations?.idempotentHint).toBe(true);
    expect(tools.find((tool) => tool.name === 'invalidateBuildUnit')?.annotations?.destructiveHint).toBe(true);
    expect(tools.find((tool) => tool.name === 'updateSubmission')?.annotations?.readOnlyHint).toBe(false);
    expect(tools.find((tool) => tool.name === 'readBuildReview')?.annotations?.readOnlyHint).toBe(true);
    expect(tools.find((tool) => tool.name === 'readBuildArtifact')?.annotations?.readOnlyHint).toBe(true);
    expect(tools.find((tool) => tool.name === 'mergeBuildReview')?.annotations?.destructiveHint).toBe(true);
    expect(tools.some((tool) => tool.name === 'task')).toBe(false);
    expect(tools.some((tool) => tool.name === 'askUser')).toBe(false);
    expect(tools.some((tool) => tool.name === 'applyBuildUnitPatch')).toBe(false);
  });

  it('removes all mutation tools for read-only keys', async () => {
    const result = await request(auth('read-only'), 'tools/list');
    const names = (result.tools as Array<{ name: string }>).map((tool) => tool.name);

    expect(names).toContain('readProject');
    expect(names).toContain('runStoryLint');
    expect(names).not.toContain('createChapter');
    expect(names).not.toContain('startNovelBuild');
    expect(names).not.toContain('rerunBuildTask');
    expect(names).not.toContain('commitCanonDelta');
    expect(names).not.toContain('applyStoryPatch');
    expect(names).not.toContain('updateSubmission');
    expect(names).not.toContain('mergeBuildReview');
  });

  it('publishes workspace, agent, and skill prompts plus project resource templates', async () => {
    const prompts = await request(auth('read-write'), 'prompts/list');
    expect((prompts.prompts as Array<{ name: string }>).map((prompt) => prompt.name)).toEqual([
      'opentales_workspace',
      'opentales_agent',
      'opentales_skill'
    ]);

    const templates = await request(auth('read-write'), 'resources/templates/list');
    const uriTemplates = (templates.resourceTemplates as Array<{ uriTemplate: string }>)
      .map((resource) => resource.uriTemplate);
    expect(uriTemplates).toEqual(expect.arrayContaining([
      'opentales://skills/{name}',
      'opentales://agents/{name}',
      'opentales://instructions/{id}'
    ]));
  });

  it('puts the project scope and progressive skill loading into server instructions', async () => {
    const result = await request(auth('read-write'), 'initialize', {
      protocolVersion: '2025-11-25',
      capabilities: {},
      clientInfo: { name: 'test-client', version: '1.0.0' }
    });
    expect(result.instructions).toContain('permanently scoped to project "The Lantern Book"');
    expect(result.instructions).toContain('readProjectAiSkill');
    expect(result.instructions).toContain('Mutations execute immediately');
  });
});

async function request(
  authInfo: AuthInfo,
  method: string,
  params?: Record<string, unknown>
): Promise<Record<string, unknown>> {
  const handler = createMcpHandler(
    ({ authInfo: requestAuth }) => createOpenTalesMcpServer({} as PrismaClient, requestAuth)
  );
  handlers.push(handler);
  const response = await handler.fetch(new Request('http://localhost/mcp', {
    method: 'POST',
    headers: {
      accept: 'application/json, text/event-stream',
      'content-type': 'application/json'
    },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, ...(params ? { params } : {}) })
  }), { authInfo });
  expect(response.status).toBe(200);
  const raw = await response.text();
  const data = raw
    .split('\n')
    .find((line) => line.startsWith('data: '))
    ?.slice('data: '.length) ?? raw;
  const payload = JSON.parse(data) as { result?: Record<string, unknown>; error?: unknown };
  expect(payload.error).toBeUndefined();
  return payload.result ?? {};
}

function auth(access: 'read-only' | 'read-write'): AuthInfo {
  return {
    token: 'test-secret',
    clientId: 'key-1',
    scopes: access === 'read-write'
      ? ['opentales:project:read', 'opentales:project:write']
      : ['opentales:project:read'],
    extra: {
      credentialId: 'key-1',
      credentialType: 'api-key',
      projectId: 'project-1',
      projectTitle: 'The Lantern Book',
      orgId: 'org-1',
      userId: 'user-1',
      role: 'OWNER',
      access
    }
  };
}
