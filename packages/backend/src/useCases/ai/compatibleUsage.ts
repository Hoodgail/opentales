import type { OpenAICompatibleProvider } from '@ai-sdk/openai-compatible';

type CompatibleModel = ReturnType<OpenAICompatibleProvider>;
type Usage = Awaited<ReturnType<CompatibleModel['doGenerate']>>['usage'];

export function normalizeCompatibleUsage(usage: Usage): Usage {
  const { inputTokens, outputTokens, totalTokens, reasoningTokens } = usage;
  // Some relays report visible completion tokens separately from reasoning.
  // AI SDK's v2-to-v3 adapter discards totalTokens, so reconcile this exact,
  // observable convention before conversion. Standard OpenAI totals already
  // include reasoning and must never be counted twice.
  if (typeof inputTokens === 'number' && typeof outputTokens === 'number'
    && typeof reasoningTokens === 'number' && reasoningTokens > 0
    && totalTokens === inputTokens + outputTokens + reasoningTokens) {
    return { ...usage, outputTokens: outputTokens + reasoningTokens };
  }
  return usage;
}

export function withCompatibleUsage(model: CompatibleModel): CompatibleModel {
  return new Proxy(model, {
    get(target, property) {
      if (property === 'doGenerate') return async (...args: Parameters<typeof model.doGenerate>) => {
        const result = await target.doGenerate(...args);
        return { ...result, usage: normalizeCompatibleUsage(result.usage) };
      };
      if (property === 'doStream') return async (...args: Parameters<typeof model.doStream>) => {
        const result = await target.doStream(...args);
        return { ...result, stream: result.stream.pipeThrough(new TransformStream({
          transform(chunk, controller) {
            controller.enqueue(chunk.type === 'finish' ? { ...chunk, usage: normalizeCompatibleUsage(chunk.usage) } : chunk);
          }
        })) };
      };
      return Reflect.get(target, property, target);
    }
  });
}
