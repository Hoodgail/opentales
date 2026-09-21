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

  it('converts dollars-per-million and prefers official pricing over relay duplicates', () => {
    const table = parseModelsDevPricing({
      openai: { models: { 'gpt-5.6-terra': { id: 'gpt-5.6-terra', last_updated: '2026-07-09', cost: { input: 2, output: 12 } } } },
      relay: { models: { 'gpt-5.6-terra': { id: 'gpt-5.6-terra', last_updated: '2026-07-10', cost: { input: 2.5, output: 15 } } } }
    });
    expect(table['openai/gpt-5.6-terra']).toMatchObject({
      inputMicrosPerMillion: 2_000_000,
      outputMicrosPerMillion: 12_000_000,
      version: 'unversioned; model=2026-07-09'
    });
    expect(table['gpt-5.6-terra']).toEqual(table['openai/gpt-5.6-terra']);
    expect(table['relay/gpt-5.6-terra'].inputMicrosPerMillion).toBe(2_500_000);
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


describe('official models and reasoning aliases', () => {
  const catalog = {
    google: { models: { 'gemini-3.8-flash': {
      cost: { input: 0.75, output: 3.75 },
      reasoning_options: [{ type: 'effort', values: ['low', 'medium', 'high'] }]
    } } },
    openai: { models: { 'gpt-5.6-luna': {
      cost: { input: 0.2, output: 1.2, tiers: [{ input: 0.4, output: 1.8, tier: { type: 'context', size: 272000 } }] }
    } } },
    relay: { models: { 'gpt-5.6-luna': { cost: { input: 10, output: 20 } } } }
  };

  it('resolves both requested models, canonical IDs and only advertised effort aliases', () => {
    const prices = parseModelsDevPricing(catalog, { catalogVersion: 'etag-v1' });
    expect(lookupModelPrice(prices, 'gemini-3.8-flash-high')).toBe(prices['google/gemini-3.8-flash']);
    expect(lookupModelPrice(prices, 'google/gemini-3.8-flash-high')).toBe(prices['google/gemini-3.8-flash']);
    expect(lookupModelPrice(prices, 'gpt-5.6-luna')).toBe(prices['openai/gpt-5.6-luna']);
    expect(calculateModelCostMicros(prices['gemini-3.8-flash-high'], 1000, 500)).toBe(2625);
    expect(calculateModelCostMicros(prices['gpt-5.6-luna'], 1000, 500)).toBe(800);
    for (const id of ['gemini-3.8-flash-ultra', 'custom/gemini-3.8-flash-high', 'gpt-unknown', 'constructor', '__proto__']) {
      expect(lookupModelPrice(prices, id)).toBeNull();
    }
    expect(prices['gpt-5.6-luna'].version).toContain('etag-v1');
    const collision = parseModelsDevPricing({ ...catalog, other: { models: {
      'google/gemini-3.8-flash': { cost: { input: 10, output: 20 } }
    } } });
    expect(collision['google/gemini-3.8-flash'].inputMicrosPerMillion).toBe(750000);
    expect(collision['gemini-3.8-flash-high'].inputMicrosPerMillion).toBe(750000);
  });

  it('honors exact catalog IDs before synthetic aliases, independent of provider order', () => {
    const exact = { models: { 'gemini-3.8-flash-high': { cost: { input: 7, output: 9 } } } };
    for (const data of [{ relayExact: exact, ...catalog }, { ...catalog, relayExact: exact }]) {
      expect(parseModelsDevPricing(data)['gemini-3.8-flash-high'].inputMicrosPerMillion).toBe(7000000);
    }
  });

  it('selects published long-context tiers without double counting the legacy field', () => {
    const prices = parseModelsDevPricing(catalog);
    const price = prices['gpt-5.6-luna'];
    expect(calculateModelCostMicros(price, 272000, 1000)).toBe(55600);
    expect(calculateModelCostMicros(price, 300000, 1000)).toBe(121800);
    const legacy = parseModelsDevPricing({ test: { models: { m: { cost: { input: 1, output: 2, context_over_200k: { input: 2, output: 4 } } } } } });
    expect(calculateModelCostMicros(legacy.m, 250000, 1000)).toBe(504000);
  });

  it('propagates canonical overrides to aliases, with an exact alias override winning', async () => {
    const cache = new ModelsDevPricingCache({ fetchFn: vi.fn(async () => new Response(JSON.stringify(catalog))) as typeof fetch });
    const override = { inputMicrosPerMillion: 1, outputMicrosPerMillion: 2, source: 'operator', version: '1' };
    const prices = await loadModelPricing({ cache, configured: { 'google/gemini-3.8-flash': override } });
    expect(prices['gemini-3.8-flash-high']).toEqual(override);
    const exact = { ...override, inputMicrosPerMillion: 3 };
    const both = await loadModelPricing({ cache, configured: { 'google/gemini-3.8-flash': override, 'gemini-3.8-flash-high': exact } });
    expect(both['gemini-3.8-flash-high']).toEqual(exact);
    expect(both['gemini-3.8-flash-low']).toEqual(override);
  });

  it('retains conservative pricing for ambiguous nonofficial IDs and skips invalid prices', () => {
    const prices = parseModelsDevPricing({
      a: { models: { m: { cost: { input: 1, output: 2 } }, invalid: { cost: { input: 1e20, output: 1 } } } },
      b: { models: { m: { cost: { input: 2, output: 1 } }, missing: {} } }
    });
    expect(prices.m).toMatchObject({ inputMicrosPerMillion: 2000000, outputMicrosPerMillion: 2000000 });
    expect(prices.m.source).toContain('conservative provider maximum');
    expect(prices.invalid).toBeUndefined();
    expect(prices.missing).toBeUndefined();
  });

  it('revalidates the cached catalog with ETag and Last-Modified on 304', async () => {
    let now = 1000;
    const fetchFn = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify(catalog), { headers: { etag: 'v1', 'last-modified': 'date' } }))
      .mockResolvedValueOnce(new Response(null, { status: 304 }));
    const cache = new ModelsDevPricingCache({ fetchFn, now: () => now, ttlMs: 100 });
    const first = await cache.get();
    now += 101;
    expect(await cache.get()).toBe(first);
    const headers = fetchFn.mock.calls[1][1].headers as Headers;
    expect(headers.get('if-none-match')).toBe('v1');
    expect(headers.get('if-modified-since')).toBe('date');
    await cache.get();
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });

  it('backs off cold-start outages and recovers without treating unknown models as free', async () => {
    let now = 1000;
    const fetchFn = vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValue(new Response(JSON.stringify(catalog)));
    const cache = new ModelsDevPricingCache({ fetchFn, now: () => now, retryTtlMs: 100 });
    expect(await loadModelPricing({ cache, configured: {} })).toEqual({});
    expect(await loadModelPricing({ cache, configured: {} })).toEqual({});
    expect(fetchFn).toHaveBeenCalledOnce();
    now += 101;
    expect(lookupModelPrice(await cache.get(), 'gemini-3.8-flash-high')).not.toBeNull();
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });
  it('preserves valid snapshots after HTTP, malformed, empty, and oversized refreshes', async () => {
    const fetchFn = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify(catalog)))
      .mockResolvedValueOnce(new Response('unavailable', { status: 503 }))
      .mockResolvedValueOnce(new Response('{invalid'))
      .mockResolvedValueOnce(new Response('{}'))
      .mockResolvedValueOnce(new Response('{}', { headers: { 'content-length': '99999999' } }))
      .mockResolvedValueOnce(new Response(' '.repeat(2048)));
    const cache = new ModelsDevPricingCache({ fetchFn, maxResponseBytes: 1024 });
    const first = await cache.get();
    for (let i = 0; i < 5; i++) expect(await cache.get(true)).toBe(first);
    expect(fetchFn).toHaveBeenCalledTimes(6);
  });

  it('aborts a stalled pricing request within the configured deadline', async () => {
    const fetchFn: typeof fetch = async (_url, init) => new Promise((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(init.signal?.reason), { once: true });
    });
    const cache = new ModelsDevPricingCache({ fetchFn, timeoutMs: 10 });
    await expect(cache.get()).rejects.toThrow('timed out');
  });

  it('orders multiple context tiers and reserves the highest ambiguous relay rate', () => {
    const prices = parseModelsDevPricing({
      a: { models: { shared: { cost: { input: 1, output: 2, tiers: [
        { input: 5, output: 10, tier: { type: 'context', size: 400000 } },
        { input: 3, output: 6, tier: { type: 'context', size: 200000 } }
      ] } } } },
      b: { models: { shared: { cost: { input: 2, output: 3, tiers: [
        { input: 4, output: 12, tier: { type: 'context', size: 300000 } }
      ] } } } }
    });
    expect(calculateModelCostMicros(prices['a/shared'], 250000, 1000)).toBe(756000);
    expect(calculateModelCostMicros(prices['a/shared'], 500000, 1000)).toBe(2510000);
    expect(prices.shared).toMatchObject({ inputMicrosPerMillion: 5000000, outputMicrosPerMillion: 12000000 });
  });

});


it('caches official model windows and preserves them through effort aliases and price-only overrides', async () => {
  const fetchFn = vi.fn(async () => new Response(JSON.stringify({ google: { models: {
    'gemini-3.8-flash': { cost: { input: 1, output: 2 }, limit: { context: 1048576, output: 65536 }, reasoning_options: [{ type: 'effort', values: ['high'] }] }
  } } })));
  const cache = new ModelsDevPricingCache({ fetchFn: fetchFn as typeof fetch });
  const catalog = await cache.get();
  expect(catalog['gemini-3.8-flash-high'].limits).toEqual({ context: 1048576, output: 65536 });
  const configured = { 'google/gemini-3.8-flash': { inputMicrosPerMillion: 3, outputMicrosPerMillion: 4, source: 'relay', version: 'v1' } };
  const merged = await loadModelPricing({ cache, configured });
  expect(fetchFn).toHaveBeenCalledTimes(1);
  expect(merged['gemini-3.8-flash-high'].limits).toEqual(catalog['google/gemini-3.8-flash'].limits);
  expect(merged['google/gemini-3.8-flash'].inputMicrosPerMillion).toBe(3);
});
