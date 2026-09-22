import { describe, expect, it, vi } from 'vitest';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { PrismaClient } from '@prisma/client';
import {
  PLANNING_TASK_TEMPLATES,
  ARTIFACT_CONTENT_SCHEMAS,
  REVISION_TASK_TEMPLATES,
  createChapterCompilationTaskTemplates,
  createPlanningTaskTemplates,
  createSceneTaskTemplates,
  type TaskTemplate
} from '../../novelBuild/schemas.js';
import { ModelsDevPricingCache, loadModelPricing } from '../runtime/modelPricing.js';
import type { BuildModelExecutor, BuildModelExecutorInput } from './NovelBuildWorker.js';

process.env.DATABASE_URL ??= 'postgresql://opentales:opentales@127.0.0.1:5432/opentales_test';
process.env.JWT_SECRET ??= 'unit-test-secret-not-for-production';
const {
  NovelBuildWorker,
  completePlanningArtifactLimit,
  defaultTaskBudget,
  deterministicExecutionTask,
  executionFailureDisposition,
  extractJudgeResult,
  extractWorkerResult,
  hasRuntimeCriticEvidence,
  hasCurrentUnitRead,
  hasSuccessfulTaskReport,
  guardWorkerTools,
  validateBeatShardOperations,
  validateBeatReferences,
  judgeEvidenceCharacterBudget,
  resolveContextWindow,
  taskOutputTokenLimit,
  collectStepToolResults,
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
const { isLegacyLogicalReference, referenceVariants } = await import('../../novelBuild/NovelBuildUseCase.js');

describe('durable Novel Build execution contract', () => {
  it('preserves chapter genre and illustration allocations required by an illustrated serial', () => {
    const chapter = { chapterKey: 'chapter-1', number: 1, title: 'Night Shift', purpose: 'Open the diner.', sceneKeys: ['scene-1'], threadRefs: [], entryState: {}, exitState: {}, genre: 'noir', illustrationDirections: ['Wide low-angle view of the counter; two workers lean over a map under blue dawn light.'] };
    expect(ARTIFACT_CONTENT_SCHEMAS['chapter-brief'].parse(chapter)).toEqual(chapter);
    expect(ARTIFACT_CONTENT_SCHEMAS['chapter-brief'].safeParse({ ...chapter, illustrationDirections: [''] }).success).toBe(false);
    const planner = PLANNING_TASK_TEMPLATES.find(task => task.key === 'chapter-briefs')!;
    expect(objectiveForTask(planner as any, 'Write an illustrated serial.', { target: {} })).toContain('illustrationDirections');
    expect(objectiveForTask({ ...planner, type: 'draft-scene-unit' } as any, 'Write an illustrated serial.', { target: {} })).toContain('Only in its final declared scene');
  });

  it('uses a bounded manuscript-sized deadline in the actual worker and honors explicit overrides', async () => {
    const task = { id: 'deadline-task', type: 'line-edit', assignedAgent: 'reviser', scopeUnitIds: Array.from({ length: 110 }, (_, i) => `scene-${i}`), executionPolicy: {} };
    expect(defaultTaskBudget(task as any).maxDurationMs).toBe(110 * 45_000);
    expect(defaultTaskBudget({ ...task, scopeUnitIds: ['scene-1'] } as any).maxDurationMs).toBe(15 * 60_000);
    expect(defaultTaskBudget({ ...task, scopeUnitIds: Array(500).fill('unit') } as any).maxDurationMs).toBe(2 * 60 * 60_000);
    const timer = vi.spyOn(globalThis, 'setTimeout');
    try {
      const worker = new NovelBuildWorker({} as PrismaClient) as any;
      worker.startTaskHeartbeat = () => async () => {};
      worker.executeModelTask = vi.fn().mockResolvedValue({});
      worker.finalizeExecution = vi.fn().mockResolvedValue(undefined);
      worker.failOrRetry = vi.fn();
      const claimed = { run: { id: 'deadline-run' }, task, lease: { leaseToken: 'deadline-lease', leaseGeneration: 1 } };
      await worker.executeClaimedTask(claimed);
      expect(timer).toHaveBeenCalledWith(expect.any(Function), 110 * 45_000);
      timer.mockClear();
      await worker.executeClaimedTask({ ...claimed, task: { ...task, executionPolicy: { maxDurationMs: 1234 } } });
      expect(timer).toHaveBeenCalledWith(expect.any(Function), 1234);
      expect(worker.failOrRetry).not.toHaveBeenCalled();
    } finally { timer.mockRestore(); }
  });

  it('requires a matching nonempty current-head read receipt for unchanged copy edits', () => {
    const calls = [{ toolName: 'readBuildUnit', toolCallId: 'read-1', input: { unitId: 'scene-1' } }];
    const receipt = { toolName: 'readBuildUnit', toolCallId: 'read-1', output: { id: 'scene-1', headVersionId: 'current-head', body: 'Saved prose.' } };
    expect(hasCurrentUnitRead('scene-1', 'current-head', calls, [receipt])).toBe(true);
    expect(hasCurrentUnitRead('scene-1', 'new-head', calls, [receipt])).toBe(false);
    expect(hasCurrentUnitRead('scene-1', 'current-head', [], [receipt])).toBe(false);
    expect(hasCurrentUnitRead('scene-1', 'current-head', calls, [{ ...receipt, toolCallId: 'other-call' }])).toBe(false);
    expect(hasCurrentUnitRead('scene-1', 'current-head', calls, [{ ...receipt, output: { ...receipt.output, body: '' } }])).toBe(false);
  });

  it('keeps a standalone worker alive until an idle provider reaches its deadline', async () => {
    const moduleUrl = new URL('./NovelBuildWorker.ts', import.meta.url).href;
    const script = `
      const { NovelBuildWorker } = await import(${JSON.stringify(moduleUrl)});
      const worker = new NovelBuildWorker({});
      worker.startTaskHeartbeat = () => async () => {};
      worker.executeModelTask = () => new Promise(() => {});
      worker.failOrRetry = async (_task, error) => { console.log(error.message); };
      await worker.executeClaimedTask({
        run: { id: 'idle-run' }, task: { id: 'idle-task', type: 'draft-scene', executionPolicy: { maxDurationMs: 1000 } },
        lease: { leaseToken: 'idle-lease', leaseGeneration: 1 }
      });
    `;
    const result = await promisify(execFile)(process.execPath, ['--import', 'tsx', '--input-type=module', '-e', script], { timeout: 10_000 });
    expect(result.stdout).toContain('Task exceeded maxDurationMs=1000');
    expect(result.stderr).not.toContain('unsettled top-level await');
  }, 15_000);

  it('rejects invalid plan dates and time ranges at the schema boundary', () => {
    const fields = (ARTIFACT_CONTENT_SCHEMAS['scene-plan'] as import('zod').ZodObject).shape;
    for (const value of ['Final operating morning', '2026-02-30']) expect(fields.storyDate.safeParse(value).success).toBe(false);
    expect(fields.storyDate.safeParse('2026-02-28').success).toBe(true);
    expect(fields.storyDate.safeParse(undefined).success).toBe(true);
    for (const value of ['04:45-05:05 AM', '25:00', '09:65']) expect(fields.storyTime.safeParse(value).success).toBe(false);
    for (const value of ['04:45', '04:45:30', undefined]) expect(fields.storyTime.safeParse(value).success).toBe(true);
  });

  it('reserves final reporting and repair calls without exceeding the total tool budget', async () => {
    const work = vi.fn(async () => ({ saved: true }));
    const report = vi.fn().mockResolvedValueOnce({ ok: false }).mockResolvedValueOnce({ ok: true });
    const guarded = guardWorkerTools({ readBuildUnit: { execute: work }, reportTaskResult: { execute: report } } as any, 8, new AbortController().signal, async () => {});
    const call = (name: string) => (guarded[name] as any).execute({});
    for (let index = 0; index < 6; index++) await call('readBuildUnit');
    await expect(call('readBuildUnit')).rejects.toThrow('reserved for reportTaskResult');
    await expect(call('reportTaskResult')).resolves.toEqual({ ok: false });
    await expect(call('reportTaskResult')).resolves.toEqual({ ok: true });
    await expect(call('reportTaskResult')).rejects.toThrow('maxToolCalls=8');
    expect(work).toHaveBeenCalledTimes(6);
    expect(report).toHaveBeenCalledTimes(2);
  });

  it('prevents inspection from consuming the calls needed to persist outputs', async () => {
    const read = vi.fn(async () => ({}));
    const write = vi.fn(async () => ({ saved: true }));
    const exhausted = vi.fn();
    const tools = guardWorkerTools({ readBuildArtifact: { execute: read }, applyArtifactBatch: { execute: write }, reportTaskResult: { execute: async () => ({ ok: true }) } } as any, 16, new AbortController().signal, async () => {}, exhausted);
    const call = (name: string) => (tools[name] as any).execute({});
    for (let i = 0; i < 10; i++) await call('readBuildArtifact');
    await expect(call('readBuildArtifact')).rejects.toThrow('reserved for saving outputs');
    for (let i = 0; i < 4; i++) await call('applyArtifactBatch');
    await call('reportTaskResult');
    expect(read).toHaveBeenCalledTimes(10);
    expect(write).toHaveBeenCalledTimes(4);
    expect(exhausted).toHaveBeenCalledOnce();
  });

  it('preserves enough writes to finish a manuscript-wide revision after extensive inspection', async () => {
    const writes = vi.fn(async () => ({ saved: true }));
    const tools = guardWorkerTools({ readBuildUnit: { execute: async () => ({}) }, applyBuildUnitPatch: { execute: writes }, reportTaskResult: { execute: async () => ({ ok: true }) } } as any, 240, new AbortController().signal, async () => {}, () => {}, 104);
    const call = (name: string) => (tools[name] as any).execute({});
    for (let i = 0; i < 134; i++) await call('readBuildUnit');
    await expect(call('readBuildUnit')).rejects.toThrow('reserved for saving outputs');
    for (let i = 0; i < 104; i++) await call('applyBuildUnitPatch');
    await expect(call('reportTaskResult')).resolves.toEqual({ ok: true });
    expect(writes).toHaveBeenCalledTimes(104);
  });

  it('continues after rejected task reports and stops only after a validated receipt', () => {
    expect(hasSuccessfulTaskReport({ steps: [{ toolResults: [] }] })).toBe(false);
    expect(hasSuccessfulTaskReport({ steps: [{ toolResults: [{ toolName: 'reportTaskResult', output: { error: 'Artifact does not exist' } }] }] })).toBe(false);
    expect(hasSuccessfulTaskReport({ steps: [{ toolResults: [{ toolName: 'reportTaskResult', output: { ok: true, observableResult: { status: 'invented' } } }] }] })).toBe(false);
    expect(hasSuccessfulTaskReport({ steps: [{ toolResults: [{ toolName: 'reportTaskResult', output: { ok: true, observableResult: { status: 'complete', artifactIds: [] } } }] }] })).toBe(true);
  });

  it('rejects prose in causal beat references before persisting the batch', () => {
    expect(() => validateBeatReferences([{ beatKey: 'arrival', causeKeys: ["Arthur Vance's death four months ago"], consequenceKeys: [] }], [])).toThrow('must contain exact beatKey');
    expect(() => validateBeatReferences([
      { beatKey: 'arrival', causeKeys: [], consequenceKeys: ['choice'] },
      { beatKey: 'choice', causeKeys: ['arrival'], consequenceKeys: [] }
    ], [])).not.toThrow();
    expect(() => validateBeatReferences([{ beatKey: 'choice', causeKeys: ['arrival'], consequenceKeys: [] }], ['arrival'])).not.toThrow();
    expect(() => validateBeatReferences([{ beatKey: 'beat-20', causeKeys: [], consequenceKeys: ['beat-21'] }], [], ['beat-21'])).not.toThrow();
    expect(() => validateBeatReferences([{ beatKey: 'beat-20', causeKeys: ['A backstory sentence'], consequenceKeys: [] }], [], ['beat-21'])).toThrow('must contain exact beatKey');
    expect(() => validateBeatReferences([{ beatKey: 'beat-20', causeKeys: [], consequenceKeys: ['guessed-future-beat'] }], [], ['beat-21'])).toThrow('missing beat');
  });

  it('assigns disjoint stable beat keys before independent model generation', () => {
    const keys = validateBeatShardOperations([{ type: 'beat', key: 'beat-21', content: { beatKey: 'beat-21' } }], { startOrdinal: 21, count: 20, total: 110 });
    expect(keys).toHaveLength(110);
    expect(keys.at(-1)).toBe('beat-110');
    for (const [key, beatKey] of [['beat-20', 'beat-20'], ['another-key', 'beat-21'], ['invented', 'invented']]) {
      expect(() => validateBeatShardOperations([{ type: 'beat', key, content: { beatKey } }], { startOrdinal: 21, count: 20, total: 110 })).toThrow('allocation');
    }
  });

  it('waits for an in-flight heartbeat before recording a failed attempt', async () => {
    const worker = new NovelBuildWorker({} as PrismaClient) as any;
    const events: string[] = [];
    vi.spyOn(worker, 'startTaskHeartbeat').mockReturnValue(async () => {
      await new Promise(resolve => setTimeout(resolve, 5));
      events.push('heartbeat settled');
    });
    vi.spyOn(worker, 'executeModelTask').mockRejectedValue(new Error('Provider failed'));
    const fail = vi.spyOn(worker, 'failOrRetry').mockImplementation(async () => {
      expect(events).toEqual(['heartbeat settled']);
      events.push('failure recorded');
    });
    await worker.executeClaimedTask({
      run: { id: 'heartbeat-failure-run' },
      task: { id: 'heartbeat-failure-task', type: 'draft-scene', executionPolicy: {} },
      lease: { leaseToken: 'lease', leaseGeneration: 1 }
    });
    expect(fail).toHaveBeenCalledOnce();
  });

  it('normalizes stable planning aliases while fencing legacy logical references by type', () => {
    expect(referenceVariants('character:decimus-rhal')).toEqual(expect.arrayContaining(['character:decimus-rhal', 'decimus-rhal']));
    expect(isLegacyLogicalReference({ type: 'plot-thread', id: 'thread:ancient-breach' })).toBe(true);
    expect(isLegacyLogicalReference({ type: 'plot-thread', id: 'location:ancient-breach' })).toBe(false);
  });

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
    expect(judgeEvidenceCharacterBudget(96_000)).toBe(176_000);
    expect(judgeEvidenceCharacterBudget(12_000)).toBe(12_000);
    expect(judgeEvidenceCharacterBudget(96_000, true)).toBe(176_000);
    expect(completePlanningArtifactLimit('scene-plan')).toBe(700);
    expect(completePlanningArtifactLimit('open-questions')).toBe(6_000);
  });

  it('gives aggregate planning tasks a bounded large-context invocation envelope', () => {
    expect(PLANNING_TASK_TEMPLATES.find((task) => task.key === 'scene-plans')?.acceptanceCriteria).toMatchObject({
      exactChapterSceneKeysRequired: true
    });
    expect(PLANNING_TASK_TEMPLATES.every((task) => task.type === 'quality-gate' || task.type === 'checkpoint' || task.executionPolicy.exactPlanningReferencesRequired === true)).toBe(true);
    expect(createPlanningTaskTemplates(32, 104)
      .filter((task) => task.type === 'create-scene-plan-shard')
      .every((task) => task.acceptanceCriteria.exactChapterSceneKeysRequired === true && task.executionPolicy.exactPlanningReferencesRequired === true)).toBe(true);
    expect(defaultTaskBudget({ type: 'create-beats' } as any)).toMatchObject({
      maxInputTokens: 256_000,
      maxOutputTokens: 64_000,
      maxToolCalls: 16
    });
    expect(defaultTaskBudget({ type: 'create-scene-plans' } as any)).toMatchObject({
      maxInputTokens: 256_000,
      maxOutputTokens: 64_000
    });
    expect(defaultTaskBudget({ type: 'create-story-brief' } as any)).toMatchObject({
      maxInputTokens: 96_000,
      maxOutputTokens: 32_000
    });
    expect(defaultTaskBudget({ type: 'create-scene-plan-shard' } as any)).toMatchObject({
      maxOutputTokens: 32_000
    });
  });

  it('reserves reasoning capacity by default but respects model limits and explicit output caps', () => {
    const small = { inputMicrosPerMillion: 1, outputMicrosPerMillion: 1, source: 'test', version: '1', limits: { context: 128000, output: 8192 } };
    expect(taskOutputTokenLimit({}, 32000, [])).toBe(32000);
    expect(taskOutputTokenLimit({}, 32000, [small])).toBe(8192);
    const large = { ...small, limits: { context: 1048576, output: 65536 } };
    expect(taskOutputTokenLimit({}, 32000, [large])).toBe(65536);
    expect(taskOutputTokenLimit({}, 32000, [large, small])).toBe(8192);
    expect(taskOutputTokenLimit({}, 32000, [large, null])).toBe(32000);
    expect(taskOutputTokenLimit({ maxOutputTokens: 4000 }, 32000, [small])).toBe(4000);
    expect(() => resolveContextWindow([small], taskOutputTokenLimit({ maxOutputTokens: 12000 }, 32000, [small]))).toThrow('output limit');
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

  it('backs off unavailable connections instead of exhausting retries in milliseconds', () => {
    expect(executionFailureDisposition(new Error('Cannot connect to API: Request was cancelled.'))).toMatchObject({ retryable: true, retryAfterMs: 60_000, mayHaveUnreportedUsage: true });
    expect(executionFailureDisposition(Object.assign(new Error('Service unavailable'), { statusCode: 503 }))).toMatchObject({ retryable: true, retryAfterMs: 60_000 });
    expect(executionFailureDisposition(Object.assign(new Error('Cannot connect to API'), { isRetryable: false }))).toMatchObject({ retryable: false });
    expect(executionFailureDisposition(Object.assign(new Error('Cannot connect to API'), { isRetryable: false })).retryAfterMs).toBeUndefined();
  });

  it('keeps rate-limit rejection free of invented usage and honors durable cooldown hints', () => {
    const error = Object.assign(new Error('Rate limited'), { statusCode: 429, responseHeaders: { 'retry-after': '90' } });
    expect(executionFailureDisposition(error)).toMatchObject({ retryable: true, mayHaveUnreportedUsage: false, retryAfterMs: 90_000 });
    expect(executionFailureDisposition(Object.assign(new Error('Quota'), {
      statusCode: 429, responseBody: JSON.stringify({ error: { message: 'Individual quota reached. Resets in 58m44s.' } })
    }))).toMatchObject({ retryAfterMs: 3_524_000, mayHaveUnreportedUsage: false });
    expect(executionFailureDisposition(Object.assign(new Error('Rate limited'), { statusCode: 429 }))).toMatchObject({ retryAfterMs: 60_000 });
    expect(executionFailureDisposition(Object.assign(new Error('Timeout'), { statusCode: 408 }))).toMatchObject({ mayHaveUnreportedUsage: true });
  });

  it('accounts Codex subscription models at zero without making other providers free', () => {
    expect(lookupExecutionModelPrice({}, 'CODEX', 'codex/gpt-5.6-terra')).toMatchObject({
      inputMicrosPerMillion: 0,
      outputMicrosPerMillion: 0,
      version: 'codex-oauth-v1'
    });
    const limits = { context: 1_050_000, input: 922_000, output: 128_000 };
    expect(lookupExecutionModelPrice({ 'openai/gpt-5.6-terra': {
      inputMicrosPerMillion: 1_000_000, outputMicrosPerMillion: 5_000_000,
      source: 'catalog', version: '1', limits
    } }, 'CODEX', 'codex/gpt-5.6-terra')).toMatchObject({ inputMicrosPerMillion: 0, outputMicrosPerMillion: 0, limits });
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

  it('uses cached official pricing for aliased task reservations without static test rates', async () => {
    const fetchFn = vi.fn(async () => new Response(JSON.stringify({ google: { models: {
      'gemini-3.8-flash': { cost: { input: 0.75, output: 3.75 }, reasoning_options: [{ type: 'effort', values: ['high'] }] }
    } } })));
    const cache = new ModelsDevPricingCache({ fetchFn: fetchFn as typeof fetch });
    const prisma = { projectAiSettings: { findUnique: vi.fn(async () => ({
      model: 'gemini-3.8-flash-high', providerKind: 'OPENAI_COMPATIBLE'
    })) } } as unknown as PrismaClient;
    const worker = new NovelBuildWorker(prisma, { modelPricingLoader: () => loadModelPricing({ cache, configured: {} }) }) as any;
    await worker.refreshModelPricing();
    await worker.refreshModelPricing();
    const task = {
      ...PLANNING_TASK_TEMPLATES[0], qualityThreshold: null, acceptanceCriteria: {}, maxAttempts: 1,
      executionPolicy: { maxInputTokens: 1000, maxOutputTokens: 500, modelMaxAttempts: 1 }
    };
    expect(await worker.taskReservation({ projectId: 'project' }, task)).toEqual({ tokens: 1500, costMicros: 2625 });
    expect(fetchFn).toHaveBeenCalledOnce();
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


it('uses catalog windows, reserves output, and respects the smallest fallback route', () => {
  const price = { inputMicrosPerMillion: 1, outputMicrosPerMillion: 1, source: 'test', version: '1' };
  const large = { ...price, limits: { context: 1048576, output: 65536 } };
  const small = { ...price, limits: { context: 128000, input: 120000, output: 32000 } };
  expect(resolveContextWindow([large], 12000)).toEqual({ contextTokens: 1048576, inputTokens: 1036576 });
  expect(resolveContextWindow([large, small], 12000)?.inputTokens).toBe(116000);
  expect(resolveContextWindow([large, null], 12000)).toBeNull();
  expect(() => resolveContextWindow([small], 48000)).toThrow('output limit');
});


it('retains SDK tool rejection messages alongside successful tool results', () => {
  const result = { toolName: 'readBuildArtifact', toolCallId: 'read-1', output: { ok: true } };
  const collected = collectStepToolResults([{ toolResults: [result], content: [
    { type: 'tool-result', ...result },
    { type: 'tool-error', toolName: 'applyArtifactBatch', toolCallId: 'write-1', error: new Error('Scene plan references missing location geo:invented') }
  ] }]);
  expect(collected).toEqual([result, { toolName: 'applyArtifactBatch', toolCallId: 'write-1', output: { ok: false, error: 'Scene plan references missing location geo:invented' } }]);
});
