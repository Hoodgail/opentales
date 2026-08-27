import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import { generateText, Output } from 'ai';
import { z } from 'zod';

const baseURL = required('EVAL_MODEL_BASE_URL');
const apiKey = required('EVAL_MODEL_API_KEY');
const modelId = required('EVAL_MODEL_ID');
const repeats = boundedInt(process.env.EVAL_MODEL_TRIALS, 3, 2, 20);
const minimumMean = boundedNumber(process.env.EVAL_MODEL_MIN_MEAN, 0.7, 0, 1, 'EVAL_MODEL_MIN_MEAN');
const maximumVariance = boundedNumber(process.env.EVAL_MODEL_MAX_VARIANCE, 0.04, 0, 1, 'EVAL_MODEL_MAX_VARIANCE');
const prompt = process.env.EVAL_MODEL_PROMPT ?? 'Evaluate whether this scene has a causal turn, character-specific pressure, stable POV, and an earned outcome: Mara opens the forbidden map. It erases her memory of why she came.';
const provider = createOpenAICompatible({ name: 'eval-provider', baseURL, apiKey });
const schema = z.object({
  scores: z.object({ causality: z.number().min(0).max(1), characterPressure: z.number().min(0).max(1), povStability: z.number().min(0).max(1), payoff: z.number().min(0).max(1) }),
  feedback: z.string()
});

const trials: Array<{
  index: number;
  latencyMs: number;
  scores: z.infer<typeof schema>['scores'];
  feedback: string;
  usage: unknown;
}> = [];
for (let index = 0; index < repeats; index += 1) {
  const started = Date.now();
  const response = await generateText({
    model: provider(modelId),
    system: 'Act as an independent fiction rubric judge. Return scores and concise observable feedback, never hidden reasoning.',
    prompt,
    output: Output.object({ schema }),
    maxOutputTokens: 1_000
  });
  trials.push({ index, latencyMs: Date.now() - started, scores: response.output.scores, feedback: response.output.feedback, usage: response.totalUsage ?? response.usage });
}
const dimensions = ['causality', 'characterPressure', 'povStability', 'payoff'] as const;
const summary = Object.fromEntries(dimensions.map((dimension) => {
  const values = trials.map((trial) => trial.scores[dimension]);
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  const variance = values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / values.length;
  return [dimension, { mean, variance, min: Math.min(...values), max: Math.max(...values) }];
}));
const failures = dimensions.flatMap((dimension) => {
  const result = summary[dimension] as { mean: number; variance: number };
  return [
    ...(result.mean < minimumMean ? [`${dimension} mean ${result.mean.toFixed(4)} < ${minimumMean}`] : []),
    ...(result.variance > maximumVariance ? [`${dimension} variance ${result.variance.toFixed(4)} > ${maximumVariance}`] : [])
  ];
});
const report = { modelId, repeats, generatedAt: new Date().toISOString(), thresholds: { minimumMean, maximumVariance }, passed: failures.length === 0, failures, summary, trials };
const directory = resolve(process.cwd(), 'test-results/evals');
await mkdir(directory, { recursive: true });
await writeFile(resolve(directory, 'model-trials.json'), JSON.stringify(report, null, 2));
process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
if (!report.passed) process.exitCode = 1;

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required for opt-in model trials`);
  return value;
}

function boundedInt(value: string | undefined, fallback: number, min: number, max: number): number {
  const parsed = Number(value ?? fallback);
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) throw new Error(`EVAL_MODEL_TRIALS must be ${min}-${max}`);
  return parsed;
}

function boundedNumber(value: string | undefined, fallback: number, min: number, max: number, label: string): number {
  const parsed = Number(value ?? fallback);
  if (!Number.isFinite(parsed) || parsed < min || parsed > max) throw new Error(`${label} must be between ${min} and ${max}`);
  return parsed;
}
