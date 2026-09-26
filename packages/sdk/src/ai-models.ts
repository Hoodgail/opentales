import type { AiModelCatalog, AiModelCatalogModel, AiModelCatalogProvider, AiProviderKind } from './types.js';

export interface AiModelChoice {
  id: string;
  model: AiModelCatalogModel;
  provider: AiModelCatalogProvider;
}

/** Preserve endpoint IDs verbatim; gateway and Codex IDs have an explicit namespace. */
export function aiModelChoices(catalog: AiModelCatalog | null, kind: AiProviderKind): AiModelChoice[] {
  if (!catalog) return [];
  return catalog.providers.filter((provider) => {
    if (catalog.source === 'provider') return kind === 'openai-compatible';
    if (kind === 'openai-compatible') return provider.id === 'openai';
    if (kind === 'codex') return provider.id === 'codex';
    if (kind === 'github-copilot') return provider.id === 'github-copilot';
    return !['github-copilot', 'codex', 'vercel'].includes(provider.id);
  }).flatMap((provider) => provider.models.map((model) => ({
    id: kind === 'gateway' || kind === 'codex' ? `${provider.id}/${model.id}` : model.id,
    provider,
    model
  })));
}
