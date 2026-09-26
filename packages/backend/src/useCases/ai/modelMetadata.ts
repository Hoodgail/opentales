import type { AiModelCatalogModel } from '@opentales/sdk';

export function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
export function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}
function number(...values: unknown[]): number | null {
  for (const value of values) {
    if (value === '' || value === null || value === undefined || typeof value === 'boolean') continue;
    const parsed = typeof value === 'string' ? Number(value) : value;
    if (typeof parsed === 'number' && Number.isFinite(parsed) && parsed >= 0) return parsed;
  }
  return null;
}
function boolean(...values: unknown[]): boolean | null {
  return values.find((value): value is boolean => typeof value === 'boolean') ?? null;
}
function strings(value: unknown): string[] | undefined {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : undefined;
}

/** Read metadata field by field: false and zero are authoritative provider values. */
export function normalizeModel(providerId: string, modelId: string, raw: unknown, fallback?: AiModelCatalogModel): AiModelCatalogModel {
  const value = record(raw);
  const provider = record(value.provider);
  const cost = record(value.cost);
  const pricing = record(value.pricing);
  const limit = record(value.limit ?? value.limits);
  const capabilities = record(value.capabilities);
  const modalities = record(value.modalities);
  const inputModalities = strings(modalities.input ?? capabilities.input);
  const reasoning = record(value.reasoning);
  const options = Array.isArray(value.reasoning_options) ? value.reasoning_options.map(record) : [];
  const efforts = strings(value.reasoning_efforts ?? value.supported_reasoning_efforts ?? reasoning.efforts ?? options.find((option) => option.type === 'effort')?.values);
  const modes = record(record(value.experimental).modes);
  const tiers = strings(value.service_tiers);
  const promptPrice = number(pricing.prompt);
  const completionPrice = number(pricing.completion);
  const inputCost = number(cost.input, pricing.input, promptPrice === null ? null : promptPrice * 1_000_000) ?? fallback?.cost?.input ?? null;
  const outputCost = number(cost.output, pricing.output, completionPrice === null ? null : completionPrice * 1_000_000) ?? fallback?.cost?.output ?? null;
  const supportsReasoning = boolean(value.reasoning, capabilities.reasoning);
  const vendor = (text(value.owned_by) ?? text(value.vendor) ?? fallback?.vendor ?? providerId).toLowerCase();

  return {
    id: modelId,
    providerId,
    name: text(value.name) ?? fallback?.name ?? modelId,
    family: text(value.family) ?? fallback?.family ?? modelId.split(/[\-._]/)[0],
    releaseDate: text(value.release_date) ?? text(value.releaseDate) ?? fallback?.releaseDate ?? null,
    status: text(value.status) ?? fallback?.status ?? 'active',
    api: { id: text(value.id) ?? modelId, url: text(provider.api), npm: text(provider.npm) },
    cost: inputCost === null && outputCost === null ? null : { input: inputCost, output: outputCost },
    context: number(value.context, value.context_length, value.context_window, limit.context) ?? fallback?.context ?? null,
    maxInput: number(value.max_input, value.max_input_tokens, value.input_token_limit, limit.input) ?? fallback?.maxInput ?? null,
    maxOutput: number(value.max_output, value.max_output_tokens, value.output_token_limit, limit.output) ?? fallback?.maxOutput ?? null,
    supportsTools: boolean(value.tool_call, value.tools, value.supports_tools, capabilities.tools, capabilities.tool_call) ?? fallback?.supportsTools ?? null,
    supportsVision: boolean(value.vision, value.supports_vision, capabilities.vision, inputModalities ? inputModalities.includes('image') : null, value.attachment) ?? fallback?.supportsVision ?? null,
    reasoningEfforts: supportsReasoning === false ? [] : (efforts ?? fallback?.reasoningEfforts ?? []).filter((effort) => /^[a-z][a-z0-9_-]{0,31}$/.test(effort)),
    supportsFast: boolean(value.supports_fast, capabilities.fast, modes.fast !== undefined ? Boolean(modes.fast) : null, tiers ? tiers.some((tier) => tier === 'priority' || tier === 'fast') : null) ?? fallback?.supportsFast ?? false,
    vendor,
    latest: fallback?.latest ?? false,
    visible: fallback?.visible ?? false
  };
}
