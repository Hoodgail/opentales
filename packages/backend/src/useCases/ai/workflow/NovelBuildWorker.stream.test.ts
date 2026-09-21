import { describe, expect, it, vi } from 'vitest';
import type { BuildModelExecutorInput } from './NovelBuildWorker.js';

const streamText = vi.hoisted(() => vi.fn());
vi.mock('ai', async importOriginal => ({
  ...await importOriginal<typeof import('ai')>(), streamText
}));
process.env.DATABASE_URL ??= 'postgresql://postgres:postgres@localhost:5432/test';
process.env.JWT_SECRET ??= 'stream-test-secret';
const { defaultModelExecutor } = await import('./NovelBuildWorker.js');

describe('durable worker failed stream evidence', () => {
  it('retains the provider cause, completed usage and rejected tool calls when text rejects with no output', async () => {
    const cause = new Error('Provider stream interrupted');
    streamText.mockImplementation(options => {
      options.onError({ error: cause });
      return {
        totalUsage: Promise.resolve({ inputTokens: 300, outputTokens: 20 }),
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
});
