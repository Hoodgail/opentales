import type { PrismaClient } from '@prisma/client';
import { createOpenAI } from '@ai-sdk/openai';
import { generateText } from 'ai';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { decryptSecret } from '../../utils/secretBox.js';
import {
  clearCodexRefreshesForTests,
  createCodexFetch,
  encryptedCodexCredentials,
  extractAccountIdFromToken,
  extractResidency,
  parseCodexCredentials,
  pollCodexDeviceAuthorization,
  startCodexDeviceAuthorization,
  type CodexCredentials
} from './codexProvider.js';
import {
  CODEX_API_ENDPOINT,
  CODEX_CLIENT_ID,
  CODEX_DEVICE_VERIFICATION_URL,
  CODEX_ISSUER
} from './codexModels.js';

describe('Codex OAuth provider', () => {
  beforeEach(() => clearCodexRefreshesForTests());

  it('starts the OpenAI device flow with the official Codex client', async () => {
    const fetchFn = vi.fn(async () => jsonResponse({
      device_auth_id: 'device-auth-1',
      user_code: 'ABCD-EFGH',
      interval: '7',
      expires_in: 600
    })) as unknown as typeof fetch;

    await expect(startCodexDeviceAuthorization(fetchFn)).resolves.toEqual({
      deviceAuthId: 'device-auth-1',
      userCode: 'ABCD-EFGH',
      verificationUri: CODEX_DEVICE_VERIFICATION_URL,
      expiresIn: 600,
      interval: 7
    });
    expect(fetchFn).toHaveBeenCalledOnce();
    expect(fetchFn).toHaveBeenCalledWith(
      `${CODEX_ISSUER}/api/accounts/deviceauth/usercode`,
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ client_id: CODEX_CLIENT_ID })
      })
    );
  });

  it('maps device-auth transport failures to an actionable upstream error', async () => {
    const fetchFn = vi.fn(async () => { throw new TypeError('network down'); }) as unknown as typeof fetch;
    await expect(startCodexDeviceAuthorization(fetchFn)).rejects.toMatchObject({
      status: 502,
      message: 'Codex authorization service is unavailable'
    });
  });

  it('treats 403 and 404 device-token responses as pending', async () => {
    const fetchFn = vi.fn(async () => jsonResponse({ interval: 9 }, 403)) as unknown as typeof fetch;
    await expect(pollCodexDeviceAuthorization('device', 'CODE', fetchFn)).resolves.toEqual({
      status: 'pending',
      interval: 9
    });
    expect(fetchFn).toHaveBeenCalledOnce();
  });

  it('exchanges an approved device code and derives account routing claims', async () => {
    const access = jwt({
      'https://api.openai.com/auth': {
        chatgpt_account_id: 'account-1',
        chatgpt_compute_residency: 'eu'
      }
    });
    const fetchFn = vi.fn(async (input: Parameters<typeof fetch>[0]) => {
      const url = String(input);
      if (url.endsWith('/api/accounts/deviceauth/token')) {
        return jsonResponse({ authorization_code: 'authorization-code', code_verifier: 'verifier' });
      }
      return jsonResponse({ access_token: access, refresh_token: 'refresh-1', expires_in: 3600 });
    }) as unknown as typeof fetch;

    const result = await pollCodexDeviceAuthorization('device', 'CODE', fetchFn, () => 10_000);
    expect(result).toMatchObject({
      status: 'authorized',
      credentials: {
        kind: 'codex-oauth',
        access,
        refresh: 'refresh-1',
        expires: 3_610_000,
        accountId: 'account-1'
      }
    });
    const tokenExchange = new URLSearchParams(String(vi.mocked(fetchFn).mock.calls[1]?.[1]?.body));
    expect(tokenExchange.get('redirect_uri')).toBe(`${CODEX_ISSUER}/deviceauth/callback`);
    expect(tokenExchange.get('code_verifier')).toBe('verifier');
    expect(extractAccountIdFromToken(access)).toBe('account-1');
    expect(extractResidency(access)).toBe('eu');
  });

  it('rewrites Responses requests, replaces SDK auth, and enforces Codex request parameters', async () => {
    const credentials = futureCredentials({
      access: jwt({
        chatgpt_account_id: 'account-2',
        chatgpt_compute_residency: 'us'
      }),
      accountId: 'account-2'
    });
    const prisma = prismaFor(credentials);
    const transport = vi.fn(async () => jsonResponse({ ok: true })) as unknown as typeof fetch;
    const codexFetch = createCodexFetch(prisma, 'project-1', transport, () => 1000);

    await codexFetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: { Authorization: 'Bearer sdk-key', 'x-api-key': 'sdk-key' },
      body: JSON.stringify({ model: 'gpt-5.4', input: [], max_output_tokens: 123, store: true, stream: true })
    });

    const [url, init] = vi.mocked(transport).mock.calls[0]!;
    expect(String(url)).toBe(CODEX_API_ENDPOINT);
    const headers = new Headers(init?.headers);
    expect(headers.get('authorization')).toBe(`Bearer ${credentials.access}`);
    expect(headers.get('chatgpt-account-id')).toBe('account-2');
    expect(headers.get('x-openai-internal-codex-residency')).toBe('us');
    expect(headers.get('x-api-key')).toBeNull();
    expect(headers.get('originator')).toBe('opentales');
    expect(headers.get('session-id')).toMatch(/^[0-9a-f-]{36}$/);
    expect(JSON.parse(String(init?.body))).toEqual({
      model: 'gpt-5.4', input: [], store: false, stream: true,
      include: ['reasoning.encrypted_content']
    });
  });

  it('runs a normal AI SDK text task through the Codex Responses transport', async () => {
    const prisma = prismaFor(futureCredentials());
    const transport = vi.fn(async () => jsonResponse({
      id: 'resp-1',
      created_at: 1,
      model: 'gpt-5.4',
      output: [{
        type: 'message',
        role: 'assistant',
        id: 'message-1',
        content: [{ type: 'output_text', text: 'A clean response.', annotations: [] }]
      }],
      usage: {
        input_tokens: 4,
        input_tokens_details: { cached_tokens: 0 },
        output_tokens: 3,
        output_tokens_details: { reasoning_tokens: 0 }
      }
    })) as unknown as typeof fetch;
    const provider = createOpenAI({
      name: 'codex',
      apiKey: 'sdk-dummy',
      fetch: createCodexFetch(prisma, 'project-sdk', transport, () => 1000)
    });

    const result = await generateText({
      model: provider.responses('gpt-5.4'),
      prompt: 'Reply cleanly.',
      maxOutputTokens: 100
    });

    expect(result.text).toBe('A clean response.');
    expect(result.usage).toMatchObject({ inputTokens: 4, outputTokens: 3 });
    const [url, init] = vi.mocked(transport).mock.calls[0]!;
    expect(String(url)).toBe(CODEX_API_ENDPOINT);
    expect(JSON.parse(String(init?.body))).not.toHaveProperty('max_output_tokens');
    expect(JSON.parse(String(init?.body))).toHaveProperty('store', false);
    expect(JSON.parse(String(init?.body))).toHaveProperty('include', ['reasoning.encrypted_content']);
  });

  it('deduplicates concurrent refreshes and persists rotated credentials atomically', async () => {
    const current = futureCredentials({ access: jwt({ chatgpt_account_id: 'old-account' }), expires: 0 });
    const encrypted = encryptedCodexCredentials(current);
    const findUnique = vi.fn(async () => ({ providerKind: 'CODEX', apiKey: encrypted }));
    const updateMany = vi.fn(async (_args: { data: { apiKey: string } }) => ({ count: 1 }));
    const prisma = { projectAiSettings: { findUnique, updateMany } } as unknown as PrismaClient;
    let refreshCalls = 0;
    const transport = vi.fn(async (input: Parameters<typeof fetch>[0]) => {
      const url = String(input);
      if (url === `${CODEX_ISSUER}/oauth/token`) {
        refreshCalls += 1;
        await Promise.resolve();
        return jsonResponse({
          access_token: jwt({ chatgpt_account_id: 'new-account' }),
          refresh_token: 'refresh-2',
          expires_in: 3600
        });
      }
      return jsonResponse({ ok: true });
    }) as unknown as typeof fetch;
    const codexFetch = createCodexFetch(prisma, 'project-refresh', transport, () => 1000);

    await Promise.all([
      codexFetch('https://api.openai.com/v1/responses', { method: 'POST', body: '{}' }),
      codexFetch('https://api.openai.com/v1/responses', { method: 'POST', body: '{}' })
    ]);

    expect(refreshCalls).toBe(1);
    expect(updateMany).toHaveBeenCalledOnce();
    const encryptedNext = vi.mocked(updateMany).mock.calls[0]?.[0]?.data?.apiKey;
    expect(typeof encryptedNext).toBe('string');
    expect(parseCodexCredentials(decryptSecret(String(encryptedNext)))).toMatchObject({
      access: expect.any(String),
      refresh: 'refresh-2',
      accountId: 'new-account'
    });
  });
});

function futureCredentials(overrides: Partial<CodexCredentials> = {}): CodexCredentials {
  return {
    kind: 'codex-oauth',
    version: 1,
    access: jwt({ chatgpt_account_id: 'account' }),
    refresh: 'refresh',
    expires: 100_000,
    accountId: 'account',
    ...overrides
  };
}

function prismaFor(credentials: CodexCredentials): PrismaClient {
  return {
    projectAiSettings: {
      findUnique: vi.fn(async () => ({
        providerKind: 'CODEX',
        apiKey: encryptedCodexCredentials(credentials)
      })),
      updateMany: vi.fn(async () => ({ count: 1 }))
    }
  } as unknown as PrismaClient;
}

function jwt(claims: Record<string, unknown>): string {
  return `header.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.signature`;
}

function jsonResponse(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'content-type': 'application/json' }
  });
}
