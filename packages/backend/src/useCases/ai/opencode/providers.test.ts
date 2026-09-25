import type { PrismaClient } from '@prisma/client';
import { describe, expect, it, vi } from 'vitest';
import { encryptSecret } from '../../../utils/secretBox.js';
import { classifyCopilotBody, modelKey, normalizeOpenAiBaseUrl, providerConfigFor, providerTransportFor } from './providers.js';

describe('OpenCode provider mapping', () => {
  it('maps a Codex project to the Responses package with the bare allowed model id', () => {
    const config = providerConfigFor({ enabled: true, providerKind: 'CODEX', model: 'codex/gpt-5.4', baseUrl: null, apiKey: 'x' });
    expect(config.model).toBe('opentales/codex--gpt-5.4');
    expect(config.provider.package).toBe('@opencode/ai/providers/openai-compatible-responses');
    expect(config.provider.models['codex--gpt-5.4']).toEqual({ name: 'gpt-5.4', modelID: 'gpt-5.4' });
    expect(config.provider.settings.apiKey).not.toContain('x');
  });

  it('encodes gateway-style model ids and adds agent-specific models', () => {
    const config = providerConfigFor(
      { enabled: true, providerKind: 'GATEWAY', model: 'openai/gpt-5.4', baseUrl: null, apiKey: null },
      ['anthropic/claude-sonnet-5']
    );
    expect(Object.keys(config.provider.models)).toEqual(['openai--gpt-5.4', 'anthropic--claude-sonnet-5']);
    expect(modelKey('openai/gpt-5.4')).toBe('openai--gpt-5.4');
  });

  it('appends /v1 only to bare OpenAI-compatible origins', () => {
    expect(normalizeOpenAiBaseUrl('https://strata.yasui.io')).toBe('https://strata.yasui.io/v1');
    expect(normalizeOpenAiBaseUrl('https://llm.example.com/api/v2/')).toBe('https://llm.example.com/api/v2');
  });

  it('rejects Codex models outside the subscription allowlist before inference', async () => {
    await expect(providerTransportFor(prismaWith({ providerKind: 'CODEX', model: 'codex/gpt-5.5-pro', apiKey: 'encrypted' }), 'project-1'))
      .rejects.toMatchObject({ status: 400, message: 'Model is not available through Codex' });
  });

  it('injects the decrypted project key and strips SDK placeholders', async () => {
    const rewrite = await providerTransportFor(
      prismaWith({ providerKind: 'OPENAI_COMPATIBLE', model: 'gpt-6-luna', apiKey: encryptSecret('secret-key') }),
      'project-1'
    );
    const request = await rewrite(new Request('https://strata.yasui.io/v1/chat/completions', {
      method: 'POST',
      headers: { authorization: 'Bearer injected-by-opentales', 'x-api-key': 'placeholder' },
      body: '{}'
    }));
    expect(request.headers.get('authorization')).toBe('Bearer secret-key');
    expect(request.headers.has('x-api-key')).toBe(false);
  });

  it('classifies Copilot agent and vision turns', () => {
    expect(classifyCopilotBody(JSON.stringify({ messages: [{ role: 'user', content: 'hi' }] }))).toEqual({ isAgent: false, isVision: false });
    expect(classifyCopilotBody(JSON.stringify({ messages: [{ role: 'tool', content: 'x' }] }))).toMatchObject({ isAgent: true });
    expect(classifyCopilotBody(JSON.stringify({ messages: [{ role: 'user', content: [{ type: 'image_url' }] }] }))).toEqual({ isAgent: true, isVision: true });
  });
});

function prismaWith(settings: { providerKind: string; model: string; apiKey: string | null }): PrismaClient {
  return {
    projectAiSettings: {
      findUnique: vi.fn(async () => ({ enabled: true, baseUrl: null, ...settings }))
    }
  } as unknown as PrismaClient;
}
