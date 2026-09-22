import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import { generateText, streamText } from 'ai';
import { describe, expect, it } from 'vitest';
import { withCompatibleUsage } from './compatibleUsage.js';

describe('OpenAI-compatible reasoning usage at the AI SDK boundary', () => {
  it.each([2, 88])('counts reasoning once when completion_tokens=%s', async completionTokens => {
    const usage = { prompt_tokens: 4, completion_tokens: completionTokens, total_tokens: 92, completion_tokens_details: { reasoning_tokens: 86 } };
    const provider = createOpenAICompatible({ name: 'fixture', baseURL: 'https://example.test/v1', apiKey: 'test', fetch: async (_url, init) => {
      const request = JSON.parse(String(init?.body));
      const common = { id: 'completion', model: 'test', created: 1 };
      if (!request.stream) return Response.json({ ...common, choices: [{ index: 0, message: { role: 'assistant', content: 'OK' }, finish_reason: 'stop' }], usage });
      const events = [
        { ...common, choices: [{ index: 0, delta: { role: 'assistant', content: 'OK' }, finish_reason: null }] },
        { ...common, choices: [{ index: 0, delta: {}, finish_reason: 'stop' }], usage }
      ];
      return new Response(events.map(event => `data: ${JSON.stringify(event)}\n\n`).join('') + 'data: [DONE]\n\n', { headers: { 'Content-Type': 'text/event-stream' } });
    } });
    const model = withCompatibleUsage(provider('test'));
    const generated = await generateText({ model, prompt: 'Reply OK' });
    expect(generated.usage).toMatchObject({ inputTokens: 4, outputTokens: 88, totalTokens: 92 });
    const streamed = streamText({ model, prompt: 'Reply OK' });
    expect(await streamed.text).toBe('OK');
    expect(await streamed.totalUsage).toMatchObject({ inputTokens: 4, outputTokens: 88, totalTokens: 92 });
  });
});
