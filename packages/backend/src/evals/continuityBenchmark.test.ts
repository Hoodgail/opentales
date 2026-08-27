import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { gradeContinuityBenchmark, type BenchmarkCase } from './continuityBenchmark.js';

const bad: BenchmarkCase = {
  id: 'deliberate-continuity-defects',
  observations: [
    { id: 'alive', kind: 'state', entityId: 'mara', key: 'alive', value: false, order: 2 },
    { id: 'appears', kind: 'appearance', entityId: 'mara', order: 3 },
    { id: 'knowledge', kind: 'knowledge-use', entityId: 'elia', order: 4, metadata: { learnedAt: 8 } },
    { id: 'travel', kind: 'travel', order: 5, metadata: { distanceKm: 500, hours: 2, maxKph: 80 } },
    { id: 'payoff', kind: 'payoff', key: 'red-moth', order: 6 },
    { id: 'setup', kind: 'setup', key: 'black-key', order: 1, metadata: { major: true } },
    { id: 'pov', kind: 'pov', order: 7, metadata: { allowed: false } },
    { id: 'age', kind: 'age', value: 32, order: 8, metadata: { birthYear: 2000, storyYear: 2025 } },
    { id: 'thread', kind: 'thread', key: 'romance', order: 9, metadata: { chaptersSinceLastBeat: 12 } },
    { id: 'boundary', kind: 'scene-boundary', order: 10, metadata: { previousOutcome: 'injured', nextEntryState: 'unhurt' } },
    { id: 'rule', kind: 'world-rule', order: 11, metadata: { violated: true } }
  ],
  expectedCodes: [
    'continuity/dead-character-appears', 'knowledge/future-leak', 'chronology/impossible-travel',
    'setup-payoff/payoff-without-setup', 'setup-payoff/unpaid-setup', 'pov/forbidden-perspective',
    'chronology/age-contradiction', 'plot/dormant-thread', 'continuity/scene-boundary-contradiction',
    'world-rule/violation'
  ]
};

const clean: BenchmarkCase = {
  id: 'valid-causal-state',
  observations: [
    { id: 'alive', kind: 'state', entityId: 'mara', key: 'alive', value: true, order: 1 },
    { id: 'appears', kind: 'appearance', entityId: 'mara', order: 2 },
    { id: 'learned', kind: 'knowledge-use', entityId: 'mara', order: 4, metadata: { learnedAt: 3 } },
    { id: 'setup', kind: 'setup', key: 'moth', order: 2 },
    { id: 'payoff', kind: 'payoff', key: 'moth', order: 7 },
    { id: 'travel', kind: 'travel', order: 5, metadata: { distanceKm: 100, hours: 2, maxKph: 80 } },
    { id: 'boundary', kind: 'scene-boundary', order: 6, metadata: { previousOutcome: 'injured', nextEntryState: 'injured' } }
  ],
  expectedCodes: []
};

describe('synthetic continuity benchmark', () => {
  it('measures recall and false positives and emits a machine-readable report', async () => {
    const report = gradeContinuityBenchmark([bad, clean]);
    expect(report.recall).toBeGreaterThanOrEqual(0.95);
    expect(report.falsePositiveRate).toBeLessThanOrEqual(0.05);
    const directory = resolve(process.cwd(), 'test-results/evals');
    await mkdir(directory, { recursive: true });
    await writeFile(resolve(directory, 'continuity-benchmark.json'), JSON.stringify(report, null, 2));
  });
});
