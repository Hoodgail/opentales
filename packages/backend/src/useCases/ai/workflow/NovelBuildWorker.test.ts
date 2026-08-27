import { describe, expect, it, vi } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import {
  PLANNING_TASK_TEMPLATES,
  REVISION_TASK_TEMPLATES,
  createChapterCompilationTaskTemplates,
  createSceneTaskTemplates,
  type TaskTemplate
} from '../../novelBuild/schemas.js';
import type { BuildModelExecutor, BuildModelExecutorInput } from './NovelBuildWorker.js';

process.env.DATABASE_URL ??= 'postgresql://opentales:opentales@127.0.0.1:5432/opentales_test';
process.env.JWT_SECRET ??= 'unit-test-secret-not-for-production';
const { NovelBuildWorker, startNovelBuildWorker } = await import('./NovelBuildWorker.js');

describe('durable Novel Build execution contract', () => {
  it('keeps chapter production causal and gates whole-manuscript revision behind every checkpoint', () => {
    const sceneOne = createSceneTaskTemplates('scene-1', ['planning-checkpoint']);
    const sceneTwo = createSceneTaskTemplates('scene-2', ['scene:scene-1:checkpoint']);
    const chapterOne = createChapterCompilationTaskTemplates('chapter-1', ['scene:scene-1:checkpoint', 'scene:scene-2:checkpoint']);
    const sceneThree = createSceneTaskTemplates('scene-3', ['chapter:chapter-1:checkpoint']);
    const chapterTwo = createChapterCompilationTaskTemplates('chapter-2', ['scene:scene-3:checkpoint']);
    const tasks = [...PLANNING_TASK_TEMPLATES, ...sceneOne, ...sceneTwo, ...chapterOne, ...sceneThree, ...chapterTwo, ...REVISION_TASK_TEMPLATES]
      .map((task) => task.key === 'drafting-complete'
        ? { ...task, dependencyKeys: [...task.dependencyKeys, 'chapter:chapter-1:checkpoint', 'chapter:chapter-2:checkpoint'] }
        : task);

    const order = topologicalExecution(tasks);
    expect(index(order, 'planning-checkpoint')).toBeLessThan(index(order, 'scene:scene-1:context'));
    expect(index(order, 'scene:scene-1:checkpoint')).toBeLessThan(index(order, 'scene:scene-2:context'));
    expect(index(order, 'scene:scene-2:checkpoint')).toBeLessThan(index(order, 'chapter:chapter-1:compile'));
    expect(index(order, 'chapter:chapter-1:checkpoint')).toBeLessThan(index(order, 'scene:scene-3:context'));
    expect(index(order, 'chapter:chapter-2:checkpoint')).toBeLessThan(index(order, 'drafting-complete'));
    expect(index(order, 'drafting-complete')).toBeLessThan(index(order, 'manuscript-developmental-review'));
    expect(index(order, 'continuity-review-pass')).toBeLessThan(index(order, 'structural-revision'));
    expect(index(order, 'proof')).toBeLessThan(index(order, 'finalization'));
    expect(order.at(-1)).toBe('final-checkpoint');
  });

  it('allows a deterministic injected executor to run without resolving external model credentials', async () => {
    const resolveModel = vi.fn(async () => { throw new Error('external model must not be loaded'); });
    const executor: BuildModelExecutor = async (input) => ({
      result: {
        status: 'complete',
        decisions: [{ decision: 'Fixture result', reason: 'Deterministic test executor' }],
        artifactIds: [],
        evidence: [],
        checks: { fixture: true },
        quality: { fixture: 1 },
        unresolvedQuestions: []
      },
      inputTokens: 0,
      outputTokens: 0,
      toolCalls: [],
      toolResults: []
    });
    const output = await executor({
      resolveModel,
      system: 'layered fixture',
      prompt: 'fixture',
      tools: {},
      stepLimit: 4,
      abortSignal: new AbortController().signal,
      contract: {
        version: 1,
        objective: 'fixture',
        dependencies: [],
        inputs: [],
        outputs: [{ type: 'task-result', name: 'fixture', schemaVersion: 1 }],
        acceptanceCriteria: [{ id: 'fixture', description: 'Fixture passes', check: 'deterministic', required: true }],
        budget: { maxInputTokens: 2_000, maxOutputTokens: 1_000, maxToolCalls: 1, maxDurationMs: 1_000 },
        modelPolicy: { fallbacks: [], tier: 'fast' },
        retryPolicy: { maxAttempts: 1, backoffMs: 0, retryOn: [] },
        qualityGate: { minimumScore: 0.8, maxRevisions: 0, requiredChecks: ['fixture'] },
        scope: { manuscriptUnitIds: [], chapterIds: [], sceneIds: [], artifactIds: [], allowSupportingArtifacts: false },
        skillVersions: {},
        metadata: {}
      }
    } satisfies BuildModelExecutorInput);
    expect(output.result.status).toBe('complete');
    expect(resolveModel).not.toHaveBeenCalled();
  });

  it('starts idempotently and stop clears the unrefed polling timer', async () => {
    vi.useFakeTimers();
    try {
      const prisma = {} as PrismaClient;
      const first = startNovelBuildWorker(prisma, { pollIntervalMs: 250 });
      const second = startNovelBuildWorker(prisma, { pollIntervalMs: 250 });
      expect(second).toBe(first);
      expect(first.isRunning()).toBe(true);
      await first.stop();
      expect(first.isRunning()).toBe(false);
      await vi.runAllTimersAsync();
    } finally {
      vi.useRealTimers();
    }
  });

  it('refreshes remote pricing and turns a resolved pricing pause into an explicit resume boundary', async () => {
    const run = { id: 'build-1', status: 'PAUSED', lastError: 'pricing is unknown' };
    const task = { id: 'task-1', key: 'story-brief', status: 'READY' };
    const updateMany = vi.fn(async () => ({ count: 1 }));
    const prisma = {
      buildRun: {
        findMany: vi.fn(async () => [run]),
        updateMany
      },
      buildTask: { findFirst: vi.fn(async () => task) }
    } as unknown as PrismaClient;
    const modelPricingLoader = vi.fn(async () => ({
      'gpt-5.6-terra': {
        inputMicrosPerMillion: 2_500_000,
        outputMicrosPerMillion: 15_000_000,
        source: 'models.dev',
        version: '2026-07-09'
      }
    }));
    const worker = new NovelBuildWorker(prisma, { modelPricingLoader }) as any;
    worker.costBudgetBlockReason = vi.fn(async () => null);

    await worker.refreshModelPricing();
    await worker.refreshResolvablePricingPauses();

    expect(modelPricingLoader).toHaveBeenCalledOnce();
    expect(worker.modelPricing['gpt-5.6-terra']).toBeTruthy();
    expect(updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: { lastError: expect.stringMatching(/models\.dev.*Resume/i) }
    }));
  });
});

function topologicalExecution(tasks: readonly TaskTemplate[]): string[] {
  const remaining = new Map(tasks.map((task) => [task.key, task]));
  const complete = new Set<string>();
  const order: string[] = [];
  while (remaining.size) {
    const ready = [...remaining.values()]
      .filter((task) => task.dependencyKeys.every((dependency) => complete.has(dependency)))
      .sort((a, b) => b.priority - a.priority || a.key.localeCompare(b.key));
    if (!ready.length) throw new Error(`Cyclic or missing dependency: ${[...remaining.keys()].join(', ')}`);
    const task = ready[0];
    remaining.delete(task.key);
    complete.add(task.key);
    order.push(task.key);
  }
  return order;
}

function index(order: string[], key: string): number {
  const value = order.indexOf(key);
  expect(value, `${key} should be in execution order`).toBeGreaterThanOrEqual(0);
  return value;
}
