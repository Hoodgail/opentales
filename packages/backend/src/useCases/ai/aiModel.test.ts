import type { PrismaClient } from '@prisma/client';
import { describe, expect, it, vi } from 'vitest';
import { loadAiModelForProject, providerOptionsForAiModel } from './aiModel.js';

describe('Codex model resolution', () => {
  it('uses the OpenAI Responses provider with the bare allowed model id', async () => {
    const prisma = prismaWithModel('codex/gpt-5.4');
    const model = await loadAiModelForProject(prisma, 'project-1');

    expect(model).toMatchObject({
      specificationVersion: 'v3',
      provider: 'codex.responses',
      modelId: 'gpt-5.4'
    });
    expect(providerOptionsForAiModel(model)).toEqual({
      openai: { store: false, include: ['reasoning.encrypted_content'] }
    });
    expect(providerOptionsForAiModel('gateway/model')).toBeUndefined();
  });

  it('rejects models outside the Codex subscription allowlist before inference', async () => {
    await expect(loadAiModelForProject(prismaWithModel('codex/gpt-5.5-pro'), 'project-1'))
      .rejects.toMatchObject({ status: 400, message: 'Model is not available through Codex' });
  });
});

function prismaWithModel(model: string): PrismaClient {
  return {
    projectAiSettings: {
      findUnique: vi.fn(async () => ({
        enabled: true,
        providerKind: 'CODEX',
        model,
        apiKey: 'encrypted-credentials',
        baseUrl: null
      }))
    }
  } as unknown as PrismaClient;
}
