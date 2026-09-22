import { describe, expect, it, vi } from 'vitest';
import type { BuildModelExecutorInput, BuildJudgeExecutorInput } from './NovelBuildWorker.js';

const streamText = vi.hoisted(() => vi.fn());
vi.mock('ai', async importOriginal => ({
  ...await importOriginal<typeof import('ai')>(), streamText
}));
process.env.DATABASE_URL ??= 'postgresql://postgres:postgres@localhost:5432/test';
process.env.JWT_SECRET ??= 'stream-test-secret';
const { defaultModelExecutor, defaultJudgeExecutor } = await import('./NovelBuildWorker.js');

describe('durable worker failed stream evidence', () => {
  it.each(['complete', 'zero', 'rejected'])('retains completed step usage and provider cause when aggregate usage is %s', async aggregate => {
    const cause = new Error('Provider stream interrupted');
    streamText.mockImplementation(options => {
      expect(options.maxRetries).toBe(0);
      options.onError({ error: cause });
      return {
        totalUsage: aggregate === 'rejected' ? Promise.reject(new Error('Usage interrupted')) : Promise.resolve(aggregate === 'zero' ? { inputTokens: 0, outputTokens: 0 } : { inputTokens: 300, outputTokens: 20 }),
        text: Promise.reject(new Error('No output generated. Check the stream for errors.')),
        steps: Promise.resolve([{
          usage: { inputTokens: 300, outputTokens: 20 },
          toolCalls: [{ toolName: 'applyArtifactBatch', toolCallId: 'write-1', input: {} }],
          toolResults: [],
          content: [{ type: 'tool-error', toolName: 'applyArtifactBatch', toolCallId: 'write-1', error: new Error('Unknown character reference') }]
        }])
      };
    });
    const input = {
      resolveModel: async () => ({ provider: 'test.chat' }),
      system: 'Authorized worker', prompt: 'Save the assigned plan', tools: {}, stepLimit: 4,
      abortSignal: new AbortController().signal,
      contract: {
        modelPolicy: { preferred: 'test-model', fallbacks: [] },
        retryPolicy: { maxAttempts: 1, retryOn: [] },
        budget: { maxOutputTokens: 1000 }, metadata: {}
      }
    } as unknown as BuildModelExecutorInput;
    await expect(defaultModelExecutor(input)).rejects.toMatchObject({
      message: 'Provider stream interrupted', inputTokens: 300, outputTokens: 20,
      usageByModel: [{ modelId: 'test-model', inputTokens: 300, outputTokens: 20 }],
      workerToolResults: [expect.objectContaining({
        toolName: 'applyArtifactBatch', output: { ok: false, error: 'Unknown character reference' }
      })]
    });
  });

  it('preserves the judge provider error instead of replacing it with no-output text failure', async () => {
    const cause = Object.assign(new Error('Quota exceeded'), { statusCode: 429, responseHeaders: { 'retry-after': '60' } });
    streamText.mockImplementation(options => {
      expect(options.maxRetries).toBe(0);
      options.onError({ error: cause });
      return {
        totalUsage: Promise.resolve({ inputTokens: 0, outputTokens: 0 }),
        text: Promise.reject(new Error('No output generated')),
        steps: Promise.resolve([]), finishReason: Promise.resolve('error')
      };
    });
    const input = {
      resolveModel: async () => ({ provider: 'test.chat' }),
      rubric: 'scene-quality-v1', observableResult: {}, deterministicChecks: {}, evidencePack: { artifacts: [] },
      abortSignal: new AbortController().signal,
      contract: { objective: 'Evaluate the scene', acceptanceCriteria: [], modelPolicy: { preferred: 'test-model' },
        budget: { maxInputTokens: 10000, maxOutputTokens: 4000 }, metadata: {} }
    } as unknown as BuildJudgeExecutorInput;
    await expect(defaultJudgeExecutor(input)).rejects.toMatchObject({
      message: 'Quota exceeded', statusCode: 429, inputTokens: 0, outputTokens: 0
    });
  });

  it.each(['known-artifact', 'invented-artifact'])('constrains repair choices and rejects invalid fallback targets: %s', async id => {
    const result = { scores: { completeness: 0.5, causality: 0.5, coherence: 0.5, contract: 0.5 }, feedback: 'Allocate the missing illustration.', evidence: [], repairArtifactIds: [id] };
    streamText.mockImplementation(options => {
      const schema = options.tools.reportJudgeResult.inputSchema;
      expect(schema.safeParse({ ...result, repairArtifactIds: ['known-artifact'] }).success).toBe(true);
      expect(schema.safeParse({ ...result, repairArtifactIds: ['invented-artifact'] }).success).toBe(false);
      return {
        totalUsage: Promise.resolve({ inputTokens: 100, outputTokens: 30 }), text: Promise.resolve(JSON.stringify(result)),
        steps: Promise.resolve([]), finishReason: Promise.resolve('stop')
      };
    });
    const input = {
      resolveModel: async () => ({ provider: 'test.chat' }), rubric: 'complete-book-plan-v1', observableResult: {}, deterministicChecks: {},
      evidencePack: { artifacts: [{ id: 'known-artifact', key: 'chapter-1', type: 'chapter-brief', content: '{}' }] },
      abortSignal: new AbortController().signal,
      contract: { objective: 'Evaluate the plan', acceptanceCriteria: [], modelPolicy: { preferred: 'test-model' },
        budget: { maxInputTokens: 10000, maxOutputTokens: 4000 }, metadata: {} }
    } as unknown as BuildJudgeExecutorInput;
    if (id === 'known-artifact') expect((await defaultJudgeExecutor(input)).result.repairArtifactIds).toEqual([id]);
    else await expect(defaultJudgeExecutor(input)).rejects.toMatchObject({ message: expect.stringContaining('exact supplied artifact ID'), inputTokens: 100, outputTokens: 30 });
  });
});
