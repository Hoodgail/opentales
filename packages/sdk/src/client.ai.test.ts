import { describe, expect, it, vi } from 'vitest';
import { OpenTalesClient } from './client.js';
import type { AiAgentTimelinePage } from './types.js';

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

  it('serializes authenticated timeline pagination for named and default sessions', async () => {
    const timelinePage = {
      parts: [],
      timelineInfo: {
        mode: 'approximate',
        truncated: false,
        earliestSequence: null,
        hasMoreBefore: false
      },
      nextBeforeSequence: null,
      hasMore: false,
      limitation: 'legacy-history-best-effort'
    } satisfies AiAgentTimelinePage;
    const fetcher = vi.fn(async () => new Response(JSON.stringify(timelinePage), {
      status: 200,
      headers: { 'content-type': 'application/json' }
    })) as unknown as typeof fetch;
    const client = new OpenTalesClient({ baseUrl: 'https://api.test', token: 'secret-token', fetcher });

    await client.getAiAgentTimeline(
      'project-1',
      { beforeSequence: 1_001, limit: 125, legacyCursor: 'cursor-token' },
      'session-1'
    );
    await client.getAiAgentTimeline('project-1', {});

    expect(fetcher).toHaveBeenNthCalledWith(1,
      'https://api.test/projects/project-1/ai/agent-sessions/session-1/timeline?beforeSequence=1001&limit=125&legacyCursor=cursor-token',
      expect.objectContaining({ method: 'GET' })
    );
    expect(fetcher).toHaveBeenNthCalledWith(2,
      'https://api.test/projects/project-1/ai/agent-session/timeline',
      expect.objectContaining({ method: 'GET' })
    );
    const firstHeaders = new Headers(vi.mocked(fetcher).mock.calls[0]?.[1]?.headers);
    expect(firstHeaders.get('authorization')).toBe('Bearer secret-token');
  });

  it('fetches full tool output through the scoped detail route', async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ id: 'tool-1', output: { full: true } }), {
      status: 200,
      headers: { 'content-type': 'application/json' }
    })) as unknown as typeof fetch;
    const client = new OpenTalesClient({ baseUrl: 'https://api.test', token: 'token', fetcher });

    await client.getAiAgentToolCall('project-1', 'tool-1', 'session-1');
    await client.getAiAgentToolCall('project-1', 'tool-2');

    expect(fetcher).toHaveBeenNthCalledWith(1,
      'https://api.test/projects/project-1/ai/agent-sessions/session-1/tool-calls/tool-1',
      expect.objectContaining({ method: 'GET' })
    );
    expect(fetcher).toHaveBeenNthCalledWith(2,
      'https://api.test/projects/project-1/ai/agent-session/tool-calls/tool-2',
      expect.objectContaining({ method: 'GET' })
    );
  });
});
