import type { PrismaClient } from '@prisma/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ProjectAccessRepository } from '../../repositories/ProjectAccessRepository.js';
import { encryptSecret } from '../../utils/secretBox.js';
import { normalizeCatalog, ProjectAiModelsUseCase } from './ProjectAiModelsUseCase.js';
import { normalizeProviderModels, providerModelCatalog } from './providerModels.js';

vi.mock('node:fs/promises', () => ({ default: {
  stat: vi.fn(async () => { throw new Error('No test disk cache'); }),
  mkdir: vi.fn(async () => undefined),
  writeFile: vi.fn(async () => undefined)
} }));

const reference = normalizeCatalog({
  openai: { name: 'OpenAI', models: {
    'gpt-6-luna': { name: 'GPT-6 Luna', cost: { input: 0.1, output: 0.5 }, limit: { context: 1_050_000, input: 922_000, output: 128_000 }, tool_call: true, modalities: { input: ['text', 'image'] }, reasoning_options: [{ type: 'effort', values: ['low', 'medium', 'high', 'xhigh', 'max'] }], experimental: { modes: { fast: { provider: { body: { service_tier: 'priority' } } } } } },
    'not-offered': { cost: { input: 99, output: 99 } }
  } }
});
const base = 'https://provider.example/v1';
const json = (value: unknown) => new Response(JSON.stringify(value), { headers: { 'content-type': 'application/json' } });
afterEach(() => vi.unstubAllGlobals());

describe('provider model discovery', () => {
  it('lists only advertised IDs, preserving namespaces and filling missing metadata', () => {
    const result = normalizeProviderModels({ data: [{ id: 'openai/gpt-6-luna', owned_by: 'openai' }, { id: 'local-new' }] }, base, reference);
    expect(result.source).toBe('provider');
    expect(result.providers[0].models).toHaveLength(2);
    const model = result.providers[0].models.find((item) => item.id === 'openai/gpt-6-luna')!;
    expect(model).toMatchObject({ name: 'GPT-6 Luna', api: { id: 'openai/gpt-6-luna', url: base }, context: 1_050_000, maxInput: 922_000, cost: { input: 0.1, output: 0.5 }, supportsTools: true, supportsVision: true, supportsFast: true, visible: true });
    expect(model.reasoningEfforts).toContain('max');
    expect(result.providers[0].models.find((item) => item.id === 'local-new')).toMatchObject({ cost: null, context: null, supportsTools: null, supportsVision: null, reasoningEfforts: [] });
  });

  it('merges per field without replacing false, zero, empty effort lists, or provider pricing', () => {
    const model = normalizeProviderModels({ data: [{ id: 'gpt-6-luna', owned_by: 'openai', name: 'My Luna', cost: { input: 0 }, limit: { input: 32000 }, tools: false, vision: false, reasoning_efforts: [], supports_fast: false }] }, base, reference).providers[0].models[0];
    expect(model).toMatchObject({ name: 'My Luna', cost: { input: 0, output: 0.5 }, context: 1_050_000, maxInput: 32000, supportsTools: false, supportsVision: false, supportsFast: false, reasoningEfforts: [] });
  });

  it('accepts common compatible-provider metadata and per-token pricing', () => {
    const model = normalizeProviderModels({ data: [{ id: 'custom', pricing: { prompt: '0.000002', completion: '0.000008' }, context_length: 65536, max_output_tokens: 8192, capabilities: { tools: true }, modalities: { input: ['text'] } }] }, base, reference).providers[0].models[0];
    expect(model).toMatchObject({ cost: { input: 2, output: 8 }, context: 65536, maxOutput: 8192, supportsVision: false, supportsTools: true });
  });

  it('prefers the model author over subscription pricing for generic endpoint ownership', () => {
    const fallback = { ...reference, providers: [{ ...reference.providers[0], id: 'github-copilot', models: reference.providers[0].models.map((model) => ({ ...model, cost: { input: 0, output: 0 } })) }, ...reference.providers] };
    const model = normalizeProviderModels({ data: [{ id: 'gpt-6-luna', owned_by: 'system' }] }, base, fallback).providers[0].models[0];
    expect(model.cost).toEqual({ input: 0.1, output: 0.5 });
  });

  it('authenticates discovery, respects explicit paths, coalesces calls, and invalidates on key changes', async () => {
    const fetcher = vi.fn(async () => json({ data: [{ id: 'gpt-6-luna' }] }));
    vi.stubGlobal('fetch', fetcher);
    const fallback = async () => reference;
    await Promise.all([providerModelCatalog('cache-test', 'https://provider.example/api/v2/', 'key-a', fallback), providerModelCatalog('cache-test', 'https://provider.example/api/v2/', 'key-a', fallback)]);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher).toHaveBeenCalledWith('https://provider.example/api/v2/models', expect.objectContaining({ headers: expect.objectContaining({ Authorization: 'Bearer key-a' }), redirect: 'error' }));
    await providerModelCatalog('cache-test', 'https://provider.example/api/v2', 'key-b', fallback);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('does not replace failed, malformed, or empty provider lists with catalog models', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('private diagnostic', { status: 401 })));
    await expect(providerModelCatalog('failure', base, 'secret', async () => reference)).rejects.toMatchObject({ status: 502, message: expect.stringContaining('HTTP 401') });
    expect(() => normalizeProviderModels({ error: 'bad' }, base, reference)).toThrow(/data array/);
    expect(normalizeProviderModels({ data: [] }, base, reference).providers[0].models).toEqual([]);
  });

  it('keeps discovery useful if models.dev is unavailable', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json({ data: [{ id: 'local', tool_call: true, limit: { context: 8192 } }] })));
    const result = await providerModelCatalog('no-fallback', base, null, async () => ({ providers: [], source: 'unavailable', updatedAt: '' }));
    expect(result.providers[0].models[0]).toMatchObject({ id: 'local', supportsTools: true, context: 8192 });
  });

  it('requires admin access for previews and never sends the saved key to an edited endpoint', async () => {
    const permission = vi.spyOn(ProjectAccessRepository.prototype, 'assertPermission').mockResolvedValue('OWNER');
    const requests: { url: string; authorization?: string }[] = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      requests.push({ url: String(url), authorization: (init?.headers as Record<string, string>)?.Authorization });
      return json(String(url).endsWith('/models') ? { data: [] } : {});
    }));
    const prisma = { projectAiSettings: { findUnique: vi.fn(async () => ({ providerKind: 'OPENAI_COMPATIBLE', baseUrl: base, apiKey: encryptSecret('saved-secret') })) } } as unknown as PrismaClient;
    const useCase = new ProjectAiModelsUseCase(prisma);
    await useCase.discover('author', 'preview-project', { baseUrl: 'https://different.example' });
    expect(permission).toHaveBeenCalledWith('author', 'preview-project', 'project:admin');
    expect(requests.find((request) => request.url === 'https://different.example/v1/models')?.authorization).toBeUndefined();
    await useCase.discover('author', 'preview-project', { baseUrl: base });
    expect(requests.find((request) => request.url === `${base}/models`)?.authorization).toBe('Bearer saved-secret');
    permission.mockRejectedValueOnce(new Error('Denied'));
    const count = requests.length;
    await expect(useCase.discover('reader', 'preview-project', { baseUrl: base })).rejects.toThrow('Denied');
    expect(requests).toHaveLength(count);
  });
});
