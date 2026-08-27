import type { AiModelCatalogModel, AiModelCatalogProvider } from '@opentales/sdk';
import { describe, expect, it } from 'vitest';
import { createCodexCatalogProvider } from './ProjectAiModelsUseCase.js';
import {
  canonicalCodexModelId,
  isCodexModelAllowed
} from './codexModels.js';

describe('Codex subscription model catalog', () => {
  it('applies the documented allow and deny rules', () => {
    expect(isCodexModelAllowed('gpt-5.4')).toBe(true);
    expect(isCodexModelAllowed('codex/gpt-5.5')).toBe(true);
    expect(isCodexModelAllowed('gpt-5.5-pro')).toBe(false);
    expect(isCodexModelAllowed('gpt-5.6')).toBe(false);
    expect(isCodexModelAllowed('gpt-5.6-terra')).toBe(true);
    expect(isCodexModelAllowed('gpt-5.6-pro')).toBe(false);
    expect(isCodexModelAllowed('gpt-4.1')).toBe(false);
    expect(canonicalCodexModelId('gpt-5.4')).toBe('codex/gpt-5.4');
  });

  it('derives a zero-cost Codex provider from the OpenAI models.dev catalog', () => {
    const provider = createCodexCatalogProvider([openAiProvider([
      model('gpt-5.4'),
      model('gpt-5.5-pro'),
      model('gpt-5.6-terra', 1_000_000, 32_000),
      model('gpt-4.1')
    ])]);

    expect(provider?.id).toBe('codex');
    expect(provider?.models.map((item) => item.id)).toEqual(['gpt-5.4', 'gpt-5.6-terra']);
    expect(provider?.models[0]?.cost).toEqual({ input: 0, output: 0 });
    expect(provider?.models[1]).toMatchObject({
      context: 400_000,
      maxInput: 272_000,
      maxOutput: 128_000,
      visible: true
    });
  });
});

function openAiProvider(models: AiModelCatalogModel[]): AiModelCatalogProvider {
  return {
    id: 'openai',
    name: 'OpenAI',
    api: 'https://api.openai.com/v1',
    npm: '@ai-sdk/openai',
    popular: true,
    models
  };
}

function model(id: string, context = 128_000, maxOutput = 16_000): AiModelCatalogModel {
  return {
    id,
    providerId: 'openai',
    name: id,
    family: id,
    releaseDate: '2026-01-01',
    status: 'active',
    api: { id, url: 'https://api.openai.com/v1', npm: '@ai-sdk/openai' },
    cost: { input: 1, output: 2 },
    context,
    maxInput: context,
    maxOutput,
    supportsTools: true,
    supportsVision: false,
    latest: true,
    visible: true
  };
}
