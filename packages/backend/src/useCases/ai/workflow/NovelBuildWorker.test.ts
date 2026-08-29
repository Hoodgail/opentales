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
const {
  NovelBuildWorker,
  defaultTaskBudget,
  deterministicExecutionTask,
  executionFailureDisposition,
  extractJudgeResult,
  extractWorkerResult,
  hasRuntimeCriticEvidence,
  judgeEvidenceCharacterBudget,
  lookupExecutionModelPrice,
  measuredInvocationUsage,
  normalizeJudgeResultCandidate,
  objectiveForTask,
  outputTypeForTask,
  parseJudgeResult,
  preferredStoryIntakeModel,
  prepareStoryBriefStep,
  resolveUntouchedBuiltInSkillUpgrades,
  startNovelBuildWorker
} = await import('./NovelBuildWorker.js');

describe('durable Novel Build execution contract', () => {
  it('treats quality gates as report-only contracts without fake artifact requirements', () => {
    const task = {
      key: 'planning-quality-gate',
      type: 'quality-gate',
      acceptanceCriteria: { rubric: 'complete-book-plan-v1' }
    } as any;
    expect(outputTypeForTask(task)).toBe('task-result');
    const objective = objectiveForTask(task, 'Build the requested plan.', {
      artifactSpecs: [{ type: 'revision-issue', minCount: 1, maxCount: 1 }]
    } as any);
    expect(objective).toContain('requires no artifact output');
    expect(objective).not.toContain('Persist every required structured artifact');
  });

  it('uses deterministic quality-gate candidates and parses locally validated judge JSON', () => {
    expect(deterministicExecutionTask({ type: 'quality-gate', executionPolicy: {} } as any)).toBe(true);
    expect(deterministicExecutionTask({ type: 'create-world-bible', executionPolicy: {} } as any)).toBe(false);
    expect(hasRuntimeCriticEvidence(
      [{ toolCallId: 'lint-1', toolName: 'runStoryLint', input: {} }],
      [{ toolCallId: 'lint-1', toolName: 'runStoryLint', output: { counts: { error: 0 } } }]
    )).toBe(true);
    expect(hasRuntimeCriticEvidence(
      [{ toolCallId: 'lint-1', toolName: 'runStoryLint', input: {} }],
      [{ toolCallId: 'other', toolName: 'runStoryLint', output: { counts: { error: 0 } } }]
    )).toBe(false);
    expect(parseJudgeResult(`Judge result:\n\`\`\`json\n${JSON.stringify({
      scores: { coherence: 0.9, causality: 0.8 },
      feedback: 'Observable planning evidence passes.',
      evidence: [{ type: 'artifact', id: 'artifact-1', summary: 'Validated brief' }]
    })}\n\`\`\``)).toMatchObject({
      scores: { coherence: 0.9, causality: 0.8 },
      feedback: 'Observable planning evidence passes.'
    });
    expect(() => parseJudgeResult('No JSON here.')).toThrow(/schema-valid JSON/);
    expect(normalizeJudgeResultCandidate({
      scores: {
        Completeness: { score: 0.9, reason: 'All required artifacts exist.' },
        causality: { value: 0.85 },
        coherence: '0.88',
        contract: 0.95
      },
      feedback: { summary: 'The plan is complete and internally consistent.' },
      evidence: ['All manifest outputs are validated.']
    })).toEqual({
      scores: { completeness: 0.9, causality: 0.85, coherence: 0.88, contract: 0.95 },
      feedback: 'The plan is complete and internally consistent.',
      evidence: [{ type: 'judge', summary: 'All manifest outputs are validated.' }]
    });
    expect(extractJudgeResult([], [{
      toolName: 'reportJudgeResult',
      input: {
        scores: { completeness: 90, causality: 85, coherence: 88, contract: 95 },
        feedback: 'Recovered from the provider tool-call arguments.',
        evidence: []
      }
    }], '')).toMatchObject({
      scores: { completeness: 0.9, causality: 0.85, coherence: 0.88, contract: 0.95 },
      feedback: 'Recovered from the provider tool-call arguments.'
    });
    expect(judgeEvidenceCharacterBudget(96_000)).toBe(80_000);
    expect(judgeEvidenceCharacterBudget(12_000)).toBe(16_000);
  });

  it('gives aggregate planning tasks a bounded large-context invocation envelope', () => {
    expect(defaultTaskBudget({ type: 'create-beats' } as any)).toMatchObject({
      maxInputTokens: 256_000,
      maxOutputTokens: 48_000,
      maxToolCalls: 16
    });
    expect(defaultTaskBudget({ type: 'create-scene-plans' } as any)).toMatchObject({
      maxInputTokens: 256_000,
      maxOutputTokens: 48_000
    });
    expect(defaultTaskBudget({ type: 'create-story-brief' } as any)).toMatchObject({
      maxInputTokens: 96_000,
      maxOutputTokens: 12_000
    });
  });

  it('keeps multi-step provider usage separate for per-invocation limits', () => {
    const usage = measuredInvocationUsage([
      { usage: { inputTokens: 52_000, outputTokens: 5_200 } },
      { usage: { inputTokens: 48_000, outputTokens: 5_400 } },
      { usage: { inputTokens: 52_692, outputTokens: 6_026 } }
    ], 'codex/gpt-5.6-sol', 152_692, 16_626);

    expect(usage).toHaveLength(3);
    expect(usage.reduce((sum, item) => sum + item.inputTokens, 0)).toBe(152_692);
    expect(usage.reduce((sum, item) => sum + item.outputTokens, 0)).toBe(16_626);
    expect(usage.every((item) => item.inputTokens <= 96_000 && item.outputTokens <= 12_000)).toBe(true);
    expect(measuredInvocationUsage([
      { usage: { inputTokens: 96_001, outputTokens: 1 } }
    ], 'codex/gpt-5.6-sol', 96_001, 1)[0]).toMatchObject({ inputTokens: 96_001 });
  });

  it('forces the single story-brief mutation before its terminal report', () => {
    expect(prepareStoryBriefStep([])).toEqual({
      activeTools: ['applyArtifactBatch'],
      toolChoice: 'auto'
    });
    expect(prepareStoryBriefStep([{
      toolResults: [{ toolName: 'applyArtifactBatch', output: { ok: false } }]
    }])).toEqual({
      activeTools: ['applyArtifactBatch'],
      toolChoice: 'auto'
    });
    expect(prepareStoryBriefStep([{
      toolResults: [{ toolName: 'applyArtifactBatch', output: { ok: true } }]
    }])).toEqual({
      activeTools: ['reportTaskResult'],
      toolChoice: { type: 'tool', toolName: 'reportTaskResult' }
    });
  });

  it('routes only unpinned Sol story intake through the bounded Luna tier', () => {
    expect(preferredStoryIntakeModel(
      'create-story-brief', 'CODEX', 'codex/gpt-5.6-sol'
    )).toBe('codex/gpt-5.6-luna');
    expect(preferredStoryIntakeModel(
      'create-story-brief', 'CODEX', 'codex/gpt-5.6-sol', 'codex/gpt-5.5'
    )).toBe('codex/gpt-5.5');
    expect(preferredStoryIntakeModel(
      'create-world-bible', 'CODEX', 'codex/gpt-5.6-sol'
    )).toBeUndefined();
    expect(preferredStoryIntakeModel(
      'create-story-brief', 'GATEWAY', 'codex/gpt-5.6-sol'
    )).toBeUndefined();
  });

  it('surfaces provider validation details without retrying or charging an unreported reservation', () => {
    const error = Object.assign(new Error('Bad Request'), {
      name: 'AI_APICallError',
      statusCode: 400,
      isRetryable: false,
      responseBody: JSON.stringify({ detail: 'Store must be set to false' })
    });

    expect(executionFailureDisposition(error)).toEqual({
      message: 'Bad Request: Store must be set to false',
      retryable: false,
      mayHaveUnreportedUsage: false
    });
    expect(executionFailureDisposition(new Error('Provider disconnected'))).toEqual({
      message: 'Provider disconnected',
      retryable: true,
      mayHaveUnreportedUsage: true
    });
    expect(executionFailureDisposition(Object.assign(new Error('Invalid observable result'), {
      providerUsageComplete: true
    }))).toEqual({
      message: 'Invalid observable result',
      retryable: true,
      mayHaveUnreportedUsage: false
    });
  });

  it('accounts Codex subscription models at zero without making other providers free', () => {
    expect(lookupExecutionModelPrice({}, 'CODEX', 'codex/gpt-5.6-terra')).toMatchObject({
      inputMicrosPerMillion: 0,
      outputMicrosPerMillion: 0,
      version: 'codex-oauth-v1'
    });
    expect(lookupExecutionModelPrice({}, 'CODEX', 'gpt-5.5-pro')).toBeNull();
    expect(lookupExecutionModelPrice({}, 'GATEWAY', 'codex/gpt-5.6-terra')).toBeNull();
  });

  it('accepts Terra-compatible reportTaskResult output without provider structured-output mode', () => {
    const observable = {
      status: 'complete',
      decisions: [],
      artifactIds: ['artifact-1'],
      evidence: [{ type: 'artifact', id: 'artifact-1', summary: 'Persisted' }],
      checks: { persisted: true },
      quality: { schema: 1 },
      unresolvedQuestions: []
    };
    expect(extractWorkerResult([{
      toolName: 'reportTaskResult',
      output: { observableResult: observable }
    }], '')).toEqual(observable);
    expect(extractWorkerResult([], JSON.stringify(observable))).toEqual(observable);
    expect(extractWorkerResult([{
      toolName: 'applyArtifactBatch',
      output: {
        ok: true,
        results: [{ action: 'created', id: 'artifact-1', type: 'story-brief' }]
      }
    }], 'Finished.')).toMatchObject({
      status: 'complete',
      artifactIds: ['artifact-1'],
      checks: { persistedToolResult: true }
    });
    expect(() => extractWorkerResult([], 'prose only')).toThrow(/reportTaskResult/);
  });

  it('enforces character batch and manifest cardinality at the fenced tool boundary', async () => {
    const findMany = vi.fn(async () => Array.from({ length: 9 }, (_, index) => ({ key: `character-${index}` })));
    const worker = new NovelBuildWorker({
      storyArtifact: { findMany }
    } as unknown as PrismaClient, { modelPricing: {} }) as any;
    const claimed = {
      run: {
        id: 'build-1',
        manifest: { artifactSpecs: [{ type: 'character-bible', minCount: 11, maxCount: 11 }] }
      },
      task: { id: 'task-1', type: 'create-character-bibles' }
    };
    const operation = (key: string) => ({ action: 'upsert', type: 'character-bible', key });

    await expect(worker.assertTaskToolPolicy(
      claimed,
      'applyArtifactBatch',
      { operations: [operation('a'), operation('b'), operation('c'), operation('d')] }
    )).rejects.toThrow(/at most 3/);
    await expect(worker.assertTaskToolPolicy(
      claimed,
      'applyArtifactBatch',
      { operations: [operation('a'), operation('b'), operation('c')] }
    )).rejects.toThrow(/2 new artifact/);
    await expect(worker.assertTaskToolPolicy(
      claimed,
      'applyArtifactBatch',
      { operations: [operation('a'), operation('b')] }
    )).resolves.toBeUndefined();
  });


  it('upgrades only untouched tasks to a newer published built-in skill', () => {
    const catalog = [{
      name: 'novel-build',
      native: true,
      manifest: { version: '1.1.0' }
    }] as any;
    const untouched = {
      status: 'READY', attempts: 0, startedAt: null, outputArtifactIds: []
    } as any;
    expect(resolveUntouchedBuiltInSkillUpgrades(
      catalog,
      { 'novel-build': '1.0.0' },
      untouched
    )).toEqual({
      versions: { 'novel-build': '1.1.0' },
      upgrades: [{ name: 'novel-build', from: '1.0.0', to: '1.1.0' }]
    });
    expect(resolveUntouchedBuiltInSkillUpgrades(
      catalog,
      { 'novel-build': '1.0.0' },
      { ...untouched, attempts: 1 }
    )).toEqual({
      versions: { 'novel-build': '1.0.0' },
      upgrades: []
    });
    expect(resolveUntouchedBuiltInSkillUpgrades(
      [{ ...catalog[0], native: false }],
      { 'novel-build': '1.0.0' },
      untouched
    ).upgrades).toEqual([]);
  });

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
