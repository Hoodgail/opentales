import { z } from 'zod';

export const MODELS_DEV_PRICING_URL = 'https://models.dev/api.json';
const DEFAULT_CACHE_TTL_MS = 6 * 60 * 60_000;
const DEFAULT_RETRY_TTL_MS = 5 * 60_000;
const DEFAULT_FETCH_TIMEOUT_MS = 15_000;
const DEFAULT_MAX_RESPONSE_BYTES = 32 * 1024 * 1024;

export const modelPriceSchema = z.object({
  inputMicrosPerMillion: z.number().int().nonnegative(),
  outputMicrosPerMillion: z.number().int().nonnegative(),
  source: z.string().trim().min(1),
  version: z.string().trim().min(1),
  contextTiers: z.array(z.object({
    aboveInputTokens: z.number().int().nonnegative(),
    inputMicrosPerMillion: z.number().int().nonnegative(),
    outputMicrosPerMillion: z.number().int().nonnegative()
  }).strict()).optional()
}).strict();

export type ModelPrice = z.infer<typeof modelPriceSchema>;
export type ModelPricingTable = Record<string, ModelPrice>;

export interface ModelsDevPricingCacheOptions {
  url?: string;
  ttlMs?: number;
  retryTtlMs?: number;
  timeoutMs?: number;
  maxResponseBytes?: number;
  fetchFn?: typeof fetch;
  now?: () => number;
}

interface PricingSnapshot {
  table: ModelPricingTable;
  refreshAfter: number;
  etag: string | null;
  lastModified: string | null;
}

export function parseModelPricing(value = process.env.AI_MODEL_PRICING_JSON): ModelPricingTable {
  if (!value?.trim()) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch (error) {
    throw new Error(`AI_MODEL_PRICING_JSON is invalid JSON: ${error instanceof Error ? error.message : 'parse failed'}`);
  }
  return z.record(z.string().trim().min(1), modelPriceSchema).parse(parsed);
}

export function lookupModelPrice(table: ModelPricingTable, modelId: string | null | undefined): ModelPrice | null {
  if (!modelId) return null;
  return Object.hasOwn(table, modelId) ? table[modelId] : null;
}

export function calculateModelCostMicros(price: ModelPrice, inputTokens: number, outputTokens: number): number {
  const input = Math.max(0, Math.trunc(inputTokens));
  const output = Math.max(0, Math.trunc(outputTokens));
  const applicable = [...(price.contextTiers ?? [])]
    .sort((a, b) => a.aboveInputTokens - b.aboveInputTokens)
    .filter(tier => input > tier.aboveInputTokens).at(-1) ?? price;
  return Math.ceil((input * applicable.inputMicrosPerMillion + output * applicable.outputMicrosPerMillion) / 1_000_000);
}

export function parseModelsDevPricing(
  value: unknown,
  options: { source?: string; catalogVersion?: string } = {}
): ModelPricingTable {
  const root = objectRecord(value);
  const source = options.source ?? MODELS_DEV_PRICING_URL;
  const catalogVersion = options.catalogVersion?.trim() || 'unversioned';
  const table: ModelPricingTable = Object.create(null);
  const official: ModelPricingTable = Object.create(null);
  const qualified: ModelPricingTable = Object.create(null);
  const aliases: Array<[string, string]> = [];

  for (const [providerId, providerValue] of Object.entries(root)) {
    const models = objectRecord(objectRecord(providerValue).models);
    for (const [modelKey, rawModel] of Object.entries(models)) {
      const model = objectRecord(rawModel);
      const modelId = stringValue(model.id) ?? modelKey.trim();
      const cost = objectRecord(model.cost);
      const input = finiteNonnegative(cost.input);
      const output = finiteNonnegative(cost.output);
      if (!providerId.trim() || !modelId || input === null || output === null) continue;
      // A malformed entry must not discard every other model's valid prices.
      if (![input, output].every(value => Number.isSafeInteger(Math.ceil(value * 1_000_000)))) continue;
      const version = `${catalogVersion}; model=${stringValue(model.last_updated) ?? 'unknown'}`;
      const contextTiers = parseContextTiers(cost);
      const exact: ModelPrice = {
        inputMicrosPerMillion: dollarsPerMillionToMicros(input),
        outputMicrosPerMillion: dollarsPerMillionToMicros(output),
        source: `${source}#${encodeURIComponent(providerId)}/${encodeURIComponent(modelId)}`,
        version,
        ...(contextTiers.length ? { contextTiers } : {})
      };
      qualified[`${providerId}/${modelId}`] = exact;
      table[modelId] = mergeConservativePrice(table[modelId], exact, source, modelId);
      if (officialProvider(modelId) === providerId) official[modelId] = exact;
      // Only synthesize effort suffixes advertised by the catalog; never strip
      // arbitrary suffixes, dates, or provider namespaces from unknown IDs.
      for (const option of Array.isArray(model.reasoning_options) ? model.reasoning_options : []) {
        const reasoning = objectRecord(option);
        if (reasoning.type !== 'effort' || !Array.isArray(reasoning.values)) continue;
        for (const effort of reasoning.values) {
          if (typeof effort !== 'string' || !/^[a-z]+$/.test(effort)) continue;
          aliases.push([`${providerId}/${modelId}-${effort}`, `${providerId}/${modelId}`]);
          if (officialProvider(modelId) === providerId) aliases.push([`${modelId}-${effort}`, `${providerId}/${modelId}`]);
        }
      }
    }
  }

  Object.assign(table, qualified, official);
  for (const [alias, canonical] of aliases) table[alias] ??= table[canonical];
  return table;
}

function officialProvider(modelId: string): string | null {
  if (/^(gpt-|o\d(?:-|$))/.test(modelId)) return 'openai';
  if (modelId.startsWith('gemini-')) return 'google';
  if (modelId.startsWith('claude-')) return 'anthropic';
  return null;
}

function parseContextTiers(cost: Record<string, unknown>): NonNullable<ModelPrice['contextTiers']> {
  const tiers: NonNullable<ModelPrice['contextTiers']> = [];
  for (const raw of Array.isArray(cost.tiers) ? cost.tiers : []) {
    const value = objectRecord(raw);
    const tier = objectRecord(value.tier);
    const size = finiteNonnegative(tier.size);
    const input = finiteNonnegative(value.input);
    const output = finiteNonnegative(value.output);
    if (tier.type !== 'context' || size === null || !Number.isSafeInteger(size) || input === null || output === null) continue;
    if (![input, output].every(price => Number.isSafeInteger(Math.ceil(price * 1_000_000)))) continue;
    tiers.push({ aboveInputTokens: size, inputMicrosPerMillion: dollarsPerMillionToMicros(input), outputMicrosPerMillion: dollarsPerMillionToMicros(output) });
  }
  // Older catalog entries expose only this legacy tier field.
  const legacy = objectRecord(cost.context_over_200k);
  const input = finiteNonnegative(legacy.input);
  const output = finiteNonnegative(legacy.output);
  if (!tiers.length && input !== null && output !== null && [input, output].every(price => Number.isSafeInteger(Math.ceil(price * 1_000_000)))) {
    tiers.push({ aboveInputTokens: 200_000, inputMicrosPerMillion: dollarsPerMillionToMicros(input), outputMicrosPerMillion: dollarsPerMillionToMicros(output) });
  }
  return tiers;
}

export class ModelsDevPricingCache {
  private readonly url: string;
  private readonly ttlMs: number;
  private readonly retryTtlMs: number;
  private readonly timeoutMs: number;
  private readonly maxResponseBytes: number;
  private readonly fetchFn: typeof fetch;
  private readonly now: () => number;
  private snapshot: PricingSnapshot | null = null;
  private inflight: Promise<ModelPricingTable> | null = null;
  private retryAfter = 0;
  private lastError: unknown;

  constructor(options: ModelsDevPricingCacheOptions = {}) {
    this.url = options.url ?? (process.env.AI_MODELS_DEV_PRICING_URL?.trim() || process.env.OPENTALES_MODELS_URL?.trim() || MODELS_DEV_PRICING_URL);
    this.ttlMs = boundedDuration(options.ttlMs ?? envDuration('AI_MODEL_PRICING_CACHE_TTL_MS', DEFAULT_CACHE_TTL_MS));
    this.retryTtlMs = boundedDuration(options.retryTtlMs ?? envDuration('AI_MODEL_PRICING_CACHE_RETRY_MS', DEFAULT_RETRY_TTL_MS));
    this.timeoutMs = boundedDuration(options.timeoutMs ?? envDuration('AI_MODEL_PRICING_FETCH_TIMEOUT_MS', DEFAULT_FETCH_TIMEOUT_MS));
    this.maxResponseBytes = Math.max(1_024, Math.trunc(options.maxResponseBytes ?? DEFAULT_MAX_RESPONSE_BYTES));
    this.fetchFn = options.fetchFn ?? fetch;
    this.now = options.now ?? Date.now;
  }

  async get(force = false): Promise<ModelPricingTable> {
    const now = this.now();
    if (!force && this.snapshot && now < this.snapshot.refreshAfter) return this.snapshot.table;
    if (this.inflight) return this.inflight;
    if (!force && !this.snapshot && now < this.retryAfter) throw this.lastError;
    this.inflight = this.refresh(now).finally(() => {
      this.inflight = null;
    });
    return this.inflight;
  }

  private async refresh(now: number): Promise<ModelPricingTable> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(new Error('models.dev pricing fetch timed out')), this.timeoutMs);
    try {
      const headers = new Headers({ accept: 'application/json', 'user-agent': 'OpenTales model pricing cache' });
      if (this.snapshot?.etag) headers.set('if-none-match', this.snapshot.etag);
      if (this.snapshot?.lastModified) headers.set('if-modified-since', this.snapshot.lastModified);
      const response = await this.fetchFn(this.url, { headers, signal: controller.signal });
      if (response.status === 304 && this.snapshot) {
        this.snapshot.refreshAfter = now + this.ttlMs;
        return this.snapshot.table;
      }
      if (!response.ok) throw new Error(`models.dev pricing request failed with HTTP ${response.status}`);
      const declaredLength = Number(response.headers.get('content-length') ?? 0);
      if (Number.isFinite(declaredLength) && declaredLength > this.maxResponseBytes) {
        throw new Error('models.dev pricing response exceeded the configured size limit');
      }
      const body = await response.text();
      if (new TextEncoder().encode(body).byteLength > this.maxResponseBytes) {
        throw new Error('models.dev pricing response exceeded the configured size limit');
      }
      const catalogVersion =
        response.headers.get('etag') ??
        response.headers.get('last-modified') ??
        new Date(now).toISOString();
      const table = parseModelsDevPricing(JSON.parse(body), {
        source: this.url,
        catalogVersion
      });
      if (!Object.keys(table).length) throw new Error('models.dev pricing response contained no usable prices');
      this.snapshot = {
        table,
        refreshAfter: now + this.ttlMs,
        etag: response.headers.get('etag'),
        lastModified: response.headers.get('last-modified')
      };
      return table;
    } catch (error) {
      this.lastError = error;
      this.retryAfter = now + this.retryTtlMs;
      if (!this.snapshot) throw error;
      this.snapshot.refreshAfter = now + this.retryTtlMs;
      return this.snapshot.table;
    } finally {
      clearTimeout(timeout);
    }
  }
}

let sharedModelsDevCache: ModelsDevPricingCache | null = null;

export async function loadModelPricing(options: {
  cache?: ModelsDevPricingCache;
  configured?: ModelPricingTable;
} = {}): Promise<ModelPricingTable> {
  const configured = options.configured ?? parseModelPricing();
  const cache = options.cache ?? (sharedModelsDevCache ??= new ModelsDevPricingCache());
  let remote: ModelPricingTable = {};
  try {
    remote = await cache.get();
  } catch {
    // Unknown prices still fail closed in the worker. Explicit configuration
    // remains available when models.dev is temporarily unreachable.
  }
  const resolved = { ...remote };
  // Canonical overrides also apply to derived aliases. Exact overrides win last.
  for (const [id, price] of Object.entries(configured)) {
    if (!Object.hasOwn(remote, id)) continue;
    const canonical = remote[id].source.split('#')[1]?.split('/').map(decodeURIComponent).join('/');
    if (id !== canonical && id !== canonical?.split('/').slice(1).join('/')) continue;
    for (const [alias, remotePrice] of Object.entries(remote)) {
      if (remotePrice === remote[id]) resolved[alias] = price;
    }
  }
  return { ...resolved, ...configured };
}

function mergeConservativePrice(
  current: ModelPrice | undefined,
  incoming: ModelPrice,
  source: string,
  modelId: string
): ModelPrice {
  if (!current) return incoming;
  return {
    inputMicrosPerMillion: Math.max(current.inputMicrosPerMillion, incoming.inputMicrosPerMillion, ...(current.contextTiers ?? []).map(tier => tier.inputMicrosPerMillion), ...(incoming.contextTiers ?? []).map(tier => tier.inputMicrosPerMillion)),
    outputMicrosPerMillion: Math.max(current.outputMicrosPerMillion, incoming.outputMicrosPerMillion, ...(current.contextTiers ?? []).map(tier => tier.outputMicrosPerMillion), ...(incoming.contextTiers ?? []).map(tier => tier.outputMicrosPerMillion)),
    source: `${source}#model=${encodeURIComponent(modelId)} (conservative provider maximum)`,
    version: [current.version, incoming.version].sort().at(-1) ?? incoming.version
  };
}

function dollarsPerMillionToMicros(value: number): number {
  const micros = Math.ceil(value * 1_000_000);
  if (!Number.isSafeInteger(micros)) throw new Error('models.dev price exceeds the supported numeric range');
  return micros;
}

function objectRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function stringValue(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function finiteNonnegative(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
}

function envDuration(name: string, fallback: number): number {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function boundedDuration(value: number): number {
  return Math.max(1, Math.min(24 * 60 * 60_000, Math.trunc(value)));
}
