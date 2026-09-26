import { createHash } from 'node:crypto';
import type { AiModelCatalog, AiModelCatalogModel } from '@opentales/sdk';
import { HttpError } from '../../http/HttpError.js';
import { normalizeOpenAiBaseUrl } from './opencode/providers.js';
import { normalizeModel, record, text } from './modelMetadata.js';

const TTL = 5 * 60_000;
const MAX_BYTES = 8 * 1024 * 1024;
const cache = new Map<string, { key: string; expires: number; catalog: Promise<AiModelCatalog> }>();

export function providerModelCatalog(scope: string, baseUrl: string, apiKey: string | null, fallback: () => Promise<AiModelCatalog>, refresh = false): Promise<AiModelCatalog> {
  const base = normalizeOpenAiBaseUrl(baseUrl);
  const key = createHash('sha256').update(JSON.stringify([base, apiKey])).digest('hex');
  const existing = cache.get(scope);
  if (!refresh && existing?.key === key && existing.expires > Date.now()) return existing.catalog;
  const catalog = Promise.all([fetchModels(base, apiKey), fallback()]).then(([raw, reference]) => normalizeProviderModels(raw, base, reference));
  const entry = { key, expires: Date.now() + TTL, catalog };
  if (cache.size >= 100) cache.delete(cache.keys().next().value!);
  cache.set(scope, entry);
  void catalog.catch(() => { if (cache.get(scope) === entry) cache.delete(scope); });
  return catalog;
}

async function fetchModels(baseUrl: string, apiKey: string | null): Promise<unknown> {
  try {
    const response = await fetch(`${baseUrl}/models`, {
      headers: { Accept: 'application/json', ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}) },
      signal: AbortSignal.timeout(10_000),
      // A redirect must never forward the project's credentials to another host.
      redirect: 'error'
    });
    if (!response.ok) throw new HttpError(502, `Provider model discovery failed (HTTP ${response.status}). Check the base URL and API key.`);
    if (Number(response.headers.get('content-length')) > MAX_BYTES) throw new Error('Response too large');
    const reader = response.body?.getReader();
    if (!reader) throw new Error('Empty response');
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > MAX_BYTES) throw new Error('Response too large');
        chunks.push(value);
      }
    } finally { await reader.cancel().catch(() => undefined); }
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch (error) {
    if (error instanceof HttpError) throw error;
    throw new HttpError(502, 'Could not load provider models. Check the base URL, API key, and that the provider supports /models.');
  }
}

export function normalizeProviderModels(raw: unknown, baseUrl: string, fallback: AiModelCatalog): AiModelCatalog {
  const data = record(raw).data;
  if (!Array.isArray(data)) throw new HttpError(502, 'The provider returned an invalid model list (expected a data array).');
  const models = new Map<string, AiModelCatalogModel>();
  for (const item of data) {
    const value = record(item);
    const id = text(value.id);
    if (!id || id.length > 200) continue;
    const reference = findReference(id, text(value.owned_by)?.toLowerCase() ?? null, fallback);
    const model = normalizeModel('openai-compatible', id, value, reference);
    // Discovery is authoritative for availability, regardless of catalog age.
    models.set(id, { ...model, api: { id, url: baseUrl, npm: null }, visible: true });
  }
  if (data.length && !models.size) throw new HttpError(502, 'The provider model list contains no valid model IDs.');
  return {
    source: 'provider',
    updatedAt: new Date().toISOString(),
    providers: [{ id: 'openai-compatible', name: new URL(baseUrl).host, api: baseUrl, npm: null, popular: false, models: [...models.values()].sort((a, b) => a.name.localeCompare(b.name)) }]
  };
}

function findReference(id: string, owner: string | null, catalog: AiModelCatalog): AiModelCatalogModel | undefined {
  const [namespace, ...rest] = id.split('/');
  const inferredVendor = /^(gpt-|o\d)/.test(id) ? 'openai' : id.startsWith('claude-') ? 'anthropic' : id.startsWith('gemini-') ? 'google' : undefined;
  const providerId = catalog.providers.some((provider) => provider.id === owner) ? owner : rest.length ? namespace : inferredVendor;
  const providers = catalog.providers.filter((provider) => provider.id !== 'codex');
  const preferred = providers.find((provider) => provider.id === providerId);
  const exact = (model: AiModelCatalogModel) => model.id === id || model.api.id === id;
  const qualified = (model: AiModelCatalogModel) => rest.length > 0 && (model.id === rest.join('/') || model.api.id === rest.join('/'));
  return preferred?.models.find((model) => exact(model) || qualified(model))
    ?? providers.flatMap((provider) => provider.models).find(exact)
    ?? providers.find((provider) => provider.id === namespace)?.models.find(qualified);
}
