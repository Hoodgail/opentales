import type { PrismaClient } from '@prisma/client';
import { aiModelChoices } from '@opentales/sdk';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ProjectAccessRepository } from '../../repositories/ProjectAccessRepository.js';
import * as catalogs from './ProjectAiModelsUseCase.js';
import { normalizeProviderModels } from './providerModels.js';
import { OpencodeAgentUseCase } from './OpencodeAgentUseCase.js';
import type { OpencodeRuntime } from './opencode/host.js';
import { providerConfigFor } from './opencode/providers.js';

const catalog = normalizeProviderModels({ data: [{ id: 'gpt-6-luna', cost: { input: 0.1, output: 0.5 }, limit: { context: 1_050_000, input: 922_000, output: 128_000 }, tools: true, vision: true, reasoning_efforts: ['low', 'medium', 'high', 'max'], supports_fast: true }, { id: 'plain-model' }] }, 'https://provider.example/v1', { providers: [], updatedAt: '', source: 'unavailable' });

function fixture() {
  const metadata = { opentalesUserId: 'user', opentalesProjectId: 'project', approvalMode: 'manual' };
  let model: { id: string; providerID: string; variant?: string } = { id: 'gpt-6-luna', providerID: 'opentales' };
  const info = () => ({ id: 'session', metadata, model, location: { directory: '/project' }, time: { created: Date.now() } });
  const host = {
    sessions: { get: vi.fn(async () => info()), create: vi.fn(async () => info()), list: vi.fn(async () => ({ data: [] })), switchModel: vi.fn(async (input) => { model = input.model; }), inbox: { list: vi.fn(async () => []) } },
    message: { list: vi.fn(async () => ({ data: [], cursor: {} })) },
    permission: { list: vi.fn(async () => []) },
    session: { form: { list: vi.fn(async () => []) } }
  };
  const settings = { enabled: true, providerKind: 'OPENAI_COMPATIBLE' as const, model: 'gpt-6-luna', baseUrl: 'https://provider.example/v1', apiKey: null };
  const prisma = { projectAiSettings: { findUnique: vi.fn(async () => settings), update: vi.fn() } } as unknown as PrismaClient;
  const runtime = { rootOf: vi.fn(async () => ({ rootID: 'session', metadata })), host: vi.fn(async () => host), ensureProject: vi.fn(async () => ({ directory: '/project' })), rememberSession: vi.fn(), setRootMetadata: vi.fn() };
  return { useCase: new OpencodeAgentUseCase(prisma, runtime as unknown as OpencodeRuntime), host, runtime, prisma, settings };
}

beforeEach(() => {
  vi.spyOn(ProjectAccessRepository.prototype, 'assertProjectAccess').mockResolvedValue(undefined);
  vi.spyOn(catalogs, 'loadProjectCatalog').mockResolvedValue(catalog);
});

describe('session model choices', () => {
  it('persists independent effort/speed variants and restores them on reopen', async () => {
    const { useCase, host } = fixture();
    const created = await useCase.create('user', 'project', { model: 'gpt-6-luna', reasoningEffort: 'high', serviceTier: 'fast' });
    expect(created.model).toMatchObject({ reasoningEffort: 'high', serviceTier: 'fast' });
    expect(host.sessions.switchModel).toHaveBeenLastCalledWith({ sessionID: 'session', model: { providerID: 'opentales', id: 'gpt-6-luna', variant: 'ot-high-fast' } });
    await useCase.update('user', 'project', 'session', { reasoningEffort: 'low' });
    expect((await useCase.get('user', 'project', 'session')).model).toMatchObject({ reasoningEffort: 'low', serviceTier: 'fast' });
    await useCase.update('user', 'project', 'session', { serviceTier: 'standard', reasoningEffort: null });
    expect((await useCase.get('user', 'project', 'session')).model).toMatchObject({ reasoningEffort: null, serviceTier: 'standard' });
  });

  it('switches only the session model and clears options unsupported by the new model', async () => {
    const { useCase, prisma, runtime } = fixture();
    await useCase.update('user', 'project', 'session', { serviceTier: 'fast', reasoningEffort: 'max' });
    const switched = await useCase.update('user', 'project', 'session', { model: 'plain-model' });
    expect(switched.model).toMatchObject({ model: 'plain-model', reasoningEffort: null, serviceTier: 'standard' });
    expect(prisma.projectAiSettings.update).not.toHaveBeenCalled();
    expect(runtime.ensureProject).toHaveBeenCalledWith('project', ['plain-model']);
  });

  it('rejects unadvertised models and unsupported efforts or speed', async () => {
    const { useCase, host } = fixture();
    for (const input of [{ model: 'unknown' }, { reasoningEffort: 'ultra' }, { model: 'plain-model', serviceTier: 'fast' as const }]) {
      await expect(useCase.update('user', 'project', 'session', input)).rejects.toMatchObject({ status: 400 });
    }
    expect(host.sessions.switchModel).not.toHaveBeenCalled();
  });

  it('carries provider costs, limits, capabilities, and request fields into OpenCode', () => {
    const { settings } = fixture();
    const config = providerConfigFor(settings, [], aiModelChoices(catalog, 'openai-compatible'));
    const model = config.provider.models['gpt-6-luna'];
    expect(model).toMatchObject({ cost: { input: 0.1, output: 0.5 }, limit: { context: 1_050_000, input: 922_000, output: 128_000 }, capabilities: { tools: true, input: ['text', 'image'] } });
    expect(model.variants).toContainEqual({ id: 'ot-high-fast', body: { reasoning_effort: 'high', service_tier: 'priority' } });
    expect(model.variants).toContainEqual({ id: 'ot-high', body: { reasoning_effort: 'high', service_tier: 'default' } });
    expect(model.variants).toContainEqual({ id: 'ot-default', body: { service_tier: 'default' } });
    const codex = providerConfigFor({ ...settings, providerKind: 'CODEX', model: 'codex/gpt-6-luna' }, [], [{ ...aiModelChoices(catalog, 'openai-compatible')[0], id: 'codex/gpt-6-luna', model: catalog.providers[0].models.find((item) => item.id === 'gpt-6-luna')! }]);
    expect(codex.provider.models['codex--gpt-6-luna'].variants).toContainEqual({ id: 'ot-high-fast', body: { reasoning: { effort: 'high' }, service_tier: 'priority' } });
  });
});
