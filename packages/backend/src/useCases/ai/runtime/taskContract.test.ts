import { describe, expect, it } from 'vitest';
import {
  evaluationDisposition,
  normalizeTaskContract,
  stepLimitForTask,
  taskContractSchema
} from './taskContract.js';

describe('task contracts', () => {
it('normalizes legacy delegation into a bounded typed contract', () => {
  const contract = normalizeTaskContract({
    description: 'Inspect chapter',
    prompt: 'Inspect chapter 7 and report concrete continuity defects.',
    subagent_type: 'critic-runner'
  });
  expect(contract.version).toBe(1);
  expect(contract.outputs[0]?.type).toBe('task-result');
  expect(contract.acceptanceCriteria).toHaveLength(1);
  expect(stepLimitForTask(contract)).toBeLessThanOrEqual(64);
});

it('requires outputs and acceptance evidence', () => {
  const parsed = taskContractSchema.safeParse({ objective: 'Draft chapter 7' });
  expect(parsed.success).toBe(false);
});

it('bounds quality revisions and escalates after the limit', () => {
  const contract = normalizeTaskContract({
    description: 'Critique',
    prompt: 'Critique the target.',
    subagent_type: 'critic-runner'
  });
  expect(evaluationDisposition(contract, 0.2, 0, false)).toBe('revise');
  expect(evaluationDisposition(contract, 0.2, 1, false)).toBe('escalate');
  expect(evaluationDisposition(contract, 0.9, 0, true)).toBe('accept');
});

it('accepts production novel scope with 32 chapters and 110 scenes', () => {
  const parsed = taskContractSchema.parse({
    objective: 'Run whole-manuscript revision',
    outputs: [{ type: 'chapter-draft', name: 'Revised manuscript' }],
    acceptanceCriteria: [{ id: 'revised', description: 'Every assigned unit is revised' }],
    budget: { maxInputTokens: 32_000, maxOutputTokens: 8_000, maxToolCalls: 1_000, maxDurationMs: 900_000 },
    scope: {
      chapterIds: Array.from({ length: 32 }, (_, index) => `chapter-${index + 1}`),
      sceneIds: Array.from({ length: 110 }, (_, index) => `scene-${index + 1}`),
      manuscriptUnitIds: Array.from({ length: 142 }, (_, index) => `unit-${index + 1}`)
    }
  });
  expect(parsed.scope.chapterIds).toHaveLength(32);
  expect(parsed.scope.sceneIds).toHaveLength(110);
  expect(parsed.budget.maxToolCalls).toBe(1_000);
  expect(stepLimitForTask(parsed)).toBe(2_002);
});
});
