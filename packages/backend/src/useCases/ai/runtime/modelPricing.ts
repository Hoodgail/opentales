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
  version: z.string().trim().min(1)
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
  return table[modelId] ?? null;
}

export function calculateModelCostMicros(price: ModelPrice, inputTokens: number, outputTokens: number): number {
  const input = Math.max(0, Math.trunc(inputTokens));
  const output = Math.max(0, Math.trunc(outputTokens));
  return Math.ceil((input * price.inputMicrosPerMillion + output * price.outputMicrosPerMillion) / 1_000_000);
}

export function parseModelsDevPricing(
  value: unknown,
  options: { source?: string; catalogVersion?: string } = {}
): ModelPricingTable {
  const root = objectRecord(value);
  const source = options.source ?? MODELS_DEV_PRICING_URL;
  const catalogVersion = options.catalogVersion?.trim() || 'unversioned';
  const table: ModelPricingTable = {};

  for (const [providerId, providerValue] of Object.entries(root)) {
    const models = objectRecord(objectRecord(providerValue).models);
    for (const [modelKey, rawModel] of Object.entries(models)) {
      const model = objectRecord(rawModel);
      const modelId = stringValue(model.id) ?? modelKey.trim();
      const cost = objectRecord(model.cost);
      const input = finiteNonnegative(cost.input);
      const output = finiteNonnegative(cost.output);
      if (!providerId.trim() || !modelId || input === null || output === null) continue;
      const version = stringValue(model.last_updated) ?? catalogVersion;
      const exact: ModelPrice = {
        inputMicrosPerMillion: dollarsPerMillionToMicros(input),
        outputMicrosPerMillion: dollarsPerMillionToMicros(output),
        source: `${source}#${encodeURIComponent(providerId)}/${encodeURIComponent(modelId)}`,
        version
      };
      table[`${providerId}/${modelId}`] = exact;
      table[modelId] = mergeConservativePrice(table[modelId], exact, source, modelId);
    }
  }

  return table;
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

  constructor(options: ModelsDevPricingCacheOptions = {}) {
    this.url = options.url ?? (process.env.AI_MODELS_DEV_PRICING_URL?.trim() || MODELS_DEV_PRICING_URL);
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
    this.inflight = this.refresh(now).finally(() => {
      this.inflight = null;
    });
    return this.inflight;
  }

  private async refresh(now: number): Promise<ModelPricingTable> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(new Error('models.dev pricing fetch timed out')), this.timeoutMs);
    timeout.unref?.();
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
  return { ...remote, ...configured };
}

function mergeConservativePrice(
  current: ModelPrice | undefined,
  incoming: ModelPrice,
  source: string,
  modelId: string
): ModelPrice {
  if (!current) return incoming;
  return {
    inputMicrosPerMillion: Math.max(current.inputMicrosPerMillion, incoming.inputMicrosPerMillion),
    outputMicrosPerMillion: Math.max(current.outputMicrosPerMillion, incoming.outputMicrosPerMillion),
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
