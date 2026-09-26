import { describe, expect, it, vi } from 'vitest';
import { OpenTalesClient } from './client.js';

describe('AI session SDK contracts', () => {
  it('starts and polls Codex device authorization through scoped project routes', async () => {
    const fetcher = vi.fn(async (_url: string, init?: RequestInit) => new Response(JSON.stringify(
      init?.body
        ? { status: 'pending', interval: 5 }
        : { deviceAuthId: 'device-1', userCode: 'ABCD', verificationUri: 'https://auth.openai.com/codex/device', expiresIn: 900, interval: 5 }
    ), { status: 200, headers: { 'content-type': 'application/json' } })) as unknown as typeof fetch;
    const client = new OpenTalesClient({ baseUrl: 'https://api.test', token: 'token', fetcher });

    await client.startCodexAuth('project-1');
    await client.pollCodexAuth('project-1', { deviceAuthId: 'device-1', userCode: 'ABCD' });

    expect(fetcher).toHaveBeenNthCalledWith(1,
      'https://api.test/projects/project-1/ai-settings/codex/auth/start',
      expect.objectContaining({ method: 'POST' })
    );
    expect(fetcher).toHaveBeenNthCalledWith(2,
      'https://api.test/projects/project-1/ai-settings/codex/auth/poll',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ deviceAuthId: 'device-1', userCode: 'ABCD' })
      })
    );
  });

  it('updates a named session execution mode', async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({
      id: 'session-1', projectId: 'project-1', title: 'Session', approvalMode: 'auto'
    }), { status: 200, headers: { 'content-type': 'application/json' } })) as unknown as typeof fetch;
    const client = new OpenTalesClient({ baseUrl: 'https://api.test', token: 'token', fetcher });

    await client.updateAiAgentSession('project-1', 'session-1', { approvalMode: 'auto' });

    expect(fetcher).toHaveBeenCalledWith(
      'https://api.test/projects/project-1/ai/agent-sessions/session-1',
      expect.objectContaining({ method: 'PATCH', body: JSON.stringify({ approvalMode: 'auto' }) })
    );
  });

  it('routes OpenCode session actions through project-scoped endpoints', async () => {
    const fetcher = vi.fn(async (_url: string | URL | Request, _init?: RequestInit) => new Response('{}', {
      status: 200,
      headers: { 'content-type': 'application/json' }
    }));
    const client = new OpenTalesClient({ baseUrl: 'https://api.test', token: 'secret-token', fetcher: fetcher as unknown as typeof fetch });

    await client.sendAiAgentPrompt('project-1', 'ses_1', { text: 'Draft chapter 2', delivery: 'queue' });
    await client.getAiAgentMessages('project-1', 'ses_1', { cursor: 'c1', limit: 50 });
    await client.replyAiPermission('project-1', 'ses_1', 'per_1', { decision: 'once' });
    await client.answerAiQuestion('project-1', 'ses_1', 'frm_1', { answers: { q0: 'Blue' } });
    await client.dismissAiQuestion('project-1', 'ses_1', 'frm_1');
    await client.interruptAiAgentSession('project-1', 'ses_1');
    await client.getAiAgentCapabilities('project-1');

    expect(fetcher.mock.calls.map((call) => [call[0], call[1]?.method])).toEqual([
      ['https://api.test/projects/project-1/ai/agent-sessions/ses_1/prompts', 'POST'],
      ['https://api.test/projects/project-1/ai/agent-sessions/ses_1/messages?cursor=c1&limit=50', 'GET'],
      ['https://api.test/projects/project-1/ai/agent-sessions/ses_1/permissions/per_1', 'POST'],
      ['https://api.test/projects/project-1/ai/agent-sessions/ses_1/questions/frm_1', 'POST'],
      ['https://api.test/projects/project-1/ai/agent-sessions/ses_1/questions/frm_1', 'DELETE'],
      ['https://api.test/projects/project-1/ai/agent-sessions/ses_1/interrupt', 'POST'],
      ['https://api.test/projects/project-1/ai/agent-capabilities', 'GET']
    ]);
    expect(fetcher.mock.calls[3]?.[1]?.body).toBe(JSON.stringify({ answers: { q0: 'Blue' } }));
    expect(new Headers(fetcher.mock.calls[0]?.[1]?.headers).get('authorization')).toBe('Bearer secret-token');
  });

  it('parses the project agent event stream', async () => {
    const body = [
      'data: {"type":"connected","sessions":[]}',
      '',
      'data: {"type":"text.delta","sessionId":"ses_1","messageId":"msg_1","index":0,"delta":"Hi"}',
      '',
      ''
    ].join('\n');
    const fetcher = vi.fn(async () => new Response(body, {
      status: 200,
      headers: { 'content-type': 'text/event-stream' }
    })) as unknown as typeof fetch;
    const client = new OpenTalesClient({ baseUrl: 'https://api.test', token: 'token', fetcher });
    const events: unknown[] = [];

    await client.streamAiAgentEvents('project-1', (event) => events.push(event));

    expect(vi.mocked(fetcher).mock.calls[0]?.[0]).toBe('https://api.test/projects/project-1/ai/agent-events');
    expect(events).toEqual([
      { type: 'connected', sessions: [] },
      { type: 'text.delta', sessionId: 'ses_1', messageId: 'msg_1', index: 0, delta: 'Hi' }
    ]);
  });

  it('manages project-scoped MCP API keys through authenticated project routes', async () => {
    const fetcher = vi.fn(async (_url: string | URL | Request, _init?: RequestInit) => new Response('{}', {
      status: 200,
      headers: { 'content-type': 'application/json' }
    }));
    const client = new OpenTalesClient({
      baseUrl: 'https://api.test',
      token: 'session-token',
      fetcher: fetcher as unknown as typeof fetch
    });

    await client.listProjectMcpApiKeys('project-1');
    await client.createProjectMcpApiKey('project-1', {
      name: 'Codex',
      permission: 'read-write',
      expiresAt: null
    });
    await client.revokeProjectMcpApiKey('project-1', 'key-1');

    expect(fetcher.mock.calls.map((call) => call[0])).toEqual([
      'https://api.test/projects/project-1/mcp-api-keys',
      'https://api.test/projects/project-1/mcp-api-keys',
      'https://api.test/projects/project-1/mcp-api-keys/key-1'
    ]);
    expect(fetcher.mock.calls.map((call) => call[1]?.method)).toEqual(['GET', 'POST', 'DELETE']);
    expect(fetcher.mock.calls[1]?.[1]?.body).toBe(JSON.stringify({
      name: 'Codex',
      permission: 'read-write',
      expiresAt: null
    }));
    for (const call of fetcher.mock.calls) {
      expect(new Headers(call[1]?.headers).get('authorization')).toBe('Bearer session-token');
    }
  });

  it('loads and approves an MCP OAuth request through authenticated consent routes', async () => {
    const fetcher = vi.fn(async (_url: string | URL | Request, _init?: RequestInit) => new Response('{}', {
      status: 200,
      headers: { 'content-type': 'application/json' }
    }));
    const client = new OpenTalesClient({
      baseUrl: 'https://api.test', token: 'session-token', fetcher: fetcher as unknown as typeof fetch
    });
    const request = {
      responseType: 'code', clientId: 'otclient_1', redirectUri: 'https://claude.ai/callback',
      codeChallenge: 'a'.repeat(43), codeChallengeMethod: 'S256', state: 'state-1'
    };

    await client.getMcpOAuthAuthorizationContext(request);
    await client.authorizeMcpOAuth({
      ...request, decision: 'approve', projectId: 'project-1', access: 'read-write'
    });

    expect(String(fetcher.mock.calls[0]?.[0])).toContain('/oauth/authorize/context?');
    expect(String(fetcher.mock.calls[0]?.[0])).toContain('clientId=otclient_1');
    expect(fetcher.mock.calls[1]?.[0]).toBe('https://api.test/oauth/authorize');
    expect(fetcher.mock.calls[1]?.[1]).toMatchObject({ method: 'POST' });
  });
});
describe('provider discovery and model options', () => {
  it('posts unsaved credentials in the body and carries session effort/speed choices', async () => {
    const fetcher = vi.fn(async () => new Response('{}', { headers: { 'content-type': 'application/json' } }));
    const client = new OpenTalesClient({ baseUrl: 'https://api.test', token: 'session-token', fetcher });
    await client.discoverAiModels('project', { baseUrl: 'https://provider.test', apiKey: 'provider-secret' });
    expect(fetcher.mock.calls[0]).toEqual(['https://api.test/projects/project/ai/models/discover', expect.objectContaining({ method: 'POST', body: JSON.stringify({ baseUrl: 'https://provider.test', apiKey: 'provider-secret' }) })]);
    await client.updateAiAgentSession('project', 'session', { reasoningEffort: 'high', serviceTier: 'fast' });
    expect(fetcher.mock.calls[1]).toEqual(['https://api.test/projects/project/ai/agent-sessions/session', expect.objectContaining({ method: 'PATCH', body: JSON.stringify({ reasoningEffort: 'high', serviceTier: 'fast' }) })]);
  });
});
