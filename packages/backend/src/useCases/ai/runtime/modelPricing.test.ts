import { describe, expect, it, vi } from 'vitest';
import {
  ModelsDevPricingCache,
  calculateModelCostMicros,
  loadModelPricing,
  lookupModelPrice,
  parseModelPricing,
  parseModelsDevPricing
} from './modelPricing.js';

describe('model pricing', () => {
  const table = parseModelPricing(JSON.stringify({
    'provider/model': {
      inputMicrosPerMillion: 2_000_000,
      outputMicrosPerMillion: 8_000_000,
      source: 'provider price sheet',
      version: '2026-08-25'
    }
  }));

  it('calculates integer micro-cost from measured input and output usage', () => {
    const price = lookupModelPrice(table, 'provider/model');
    expect(price).not.toBeNull();
    expect(calculateModelCostMicros(price!, 1_000, 500)).toBe(6_000);
  });

  it('returns explicit unknown pricing instead of silently treating it as free', () => {
    expect(lookupModelPrice(table, 'provider/unknown')).toBeNull();
  });

  it('rejects malformed pricing configuration', () => {
    expect(() => parseModelPricing('{bad')).toThrow(/invalid JSON/);
    expect(() => parseModelPricing(JSON.stringify({ model: { inputMicrosPerMillion: -1 } }))).toThrow();
  });

  it('converts models.dev dollars-per-million and conservatively aggregates relay prices', () => {
    const table = parseModelsDevPricing({
      openai: { models: { 'gpt-5.6-terra': { id: 'gpt-5.6-terra', last_updated: '2026-07-09', cost: { input: 2, output: 12 } } } },
      relay: { models: { 'gpt-5.6-terra': { id: 'gpt-5.6-terra', last_updated: '2026-07-10', cost: { input: 2.5, output: 15 } } } }
    });
    expect(table['openai/gpt-5.6-terra']).toMatchObject({
      inputMicrosPerMillion: 2_000_000,
      outputMicrosPerMillion: 12_000_000,
      version: '2026-07-09'
    });
    expect(table['gpt-5.6-terra']).toMatchObject({
      inputMicrosPerMillion: 2_500_000,
      outputMicrosPerMillion: 15_000_000,
      version: '2026-07-10'
    });
    expect(table['gpt-5.6-terra']?.source).toContain('conservative provider maximum');
  });

  it('deduplicates fetches, honors TTL refresh, and reuses stale data on an outage', async () => {
    let now = 1_000;
    let input = 2;
    let fail = false;
    const fetchFn = vi.fn(async () => {
      if (fail) throw new Error('offline');
      return new Response(JSON.stringify({
        openai: { models: { model: { id: 'model', last_updated: `v${input}`, cost: { input, output: input * 2 } } } }
      }), { status: 200, headers: { etag: `etag-${input}` } });
    });
    const cache = new ModelsDevPricingCache({
      fetchFn: fetchFn as typeof fetch,
      now: () => now,
      ttlMs: 100,
      retryTtlMs: 20,
      timeoutMs: 1_000
    });

    const [first, same] = await Promise.all([cache.get(), cache.get()]);
    expect(first.model).toEqual(same.model);
    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(first.model?.inputMicrosPerMillion).toBe(2_000_000);

    now += 101;
    input = 3;
    expect((await cache.get()).model?.inputMicrosPerMillion).toBe(3_000_000);
    expect(fetchFn).toHaveBeenCalledTimes(2);

    now += 101;
    fail = true;
    expect((await cache.get()).model?.inputMicrosPerMillion).toBe(3_000_000);
    expect(fetchFn).toHaveBeenCalledTimes(3);
    now += 10;
    await cache.get();
    expect(fetchFn).toHaveBeenCalledTimes(3);
  });

  it('uses explicit configured pricing as the final override', async () => {
    const cache = new ModelsDevPricingCache({
      fetchFn: vi.fn(async () => new Response(JSON.stringify({
        provider: { models: { model: { cost: { input: 1, output: 2 }, last_updated: 'remote' } } }
      }))) as typeof fetch
    });
    const configured = parseModelPricing(JSON.stringify({
      model: {
        inputMicrosPerMillion: 9_000_000,
        outputMicrosPerMillion: 10_000_000,
        source: 'operator override',
        version: 'manual-v1'
      }
    }));
    expect((await loadModelPricing({ cache, configured })).model).toEqual(configured.model);
  });
});
