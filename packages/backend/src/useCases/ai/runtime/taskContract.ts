import { z } from 'zod';

export const runtimeRoleSchema = z.enum([
  'orchestrator',
  'explorer',
  'creator',
  'drafter',
  'critic',
  'reviser',
  'researcher',
  'librarian'
]);

export type RuntimeRole = z.infer<typeof runtimeRoleSchema>;

const taskReferenceSchema = z.object({
  type: z.string().trim().min(1),
  id: z.string().trim().min(1),
  required: z.boolean().default(true),
  description: z.string().trim().min(1).optional()
});

const taskOutputSchema = z.object({
  type: z.string().trim().min(1),
  name: z.string().trim().min(1),
  schemaVersion: z.number().int().min(1).default(1),
  description: z.string().trim().min(1).optional()
});

const acceptanceCriterionSchema = z.object({
  id: z.string().trim().min(1),
  description: z.string().trim().min(1),
  check: z.enum(['deterministic', 'rubric', 'human']).default('deterministic'),
  required: z.boolean().default(true)
});

const taskBudgetSchema = z.object({
  maxInputTokens: z.number().int().min(256).max(1_000_000).default(24_000),
  maxOutputTokens: z.number().int().min(128).max(250_000).default(8_000),
  maxToolCalls: z.number().int().min(1).max(1_000).default(16),
  maxCostUsd: z.number().nonnegative().optional(),
  maxDurationMs: z.number().int().min(1_000).max(24 * 60 * 60 * 1_000).default(15 * 60 * 1_000)
});

const modelPolicySchema = z.object({
  preferred: z.string().trim().min(1).optional(),
  fallbacks: z.array(z.string().trim().min(1)).max(5).default([]),
  tier: z.enum(['fast', 'balanced', 'strong', 'judge']).default('balanced')
});

const retryPolicySchema = z.object({
  maxAttempts: z.number().int().min(1).max(5).default(2),
  backoffMs: z.number().int().min(0).max(60_000).default(1_000),
  retryOn: z.array(z.enum(['transient', 'timeout', 'validation', 'quality'])).max(4).default(['transient'])
});

const qualityGateSchema = z.object({
  minimumScore: z.number().min(0).max(1).default(0.8),
  maxRevisions: z.number().int().min(0).max(3).default(1),
  requiredChecks: z.array(z.string().trim().min(1)).max(30).default([])
});

export const taskScopeSchema = z.object({
  buildRunId: z.string().trim().min(1).optional(),
  buildTaskId: z.string().trim().min(1).optional(),
  manuscriptUnitIds: z.array(z.string().trim().min(1)).max(20_000).default([]),
  chapterIds: z.array(z.string().trim().min(1)).max(1_000).default([]),
  sceneIds: z.array(z.string().trim().min(1)).max(10_000).default([]),
  artifactIds: z.array(z.string().trim().min(1)).max(10_000).default([]),
  allowSupportingArtifacts: z.boolean().default(false)
});

export const taskContractSchema = z.object({
  version: z.literal(1).default(1),
  objective: z.string().trim().min(1).max(12_000),
  dependencies: z.array(z.string().trim().min(1)).max(5_000).default([]),
  inputs: z.array(taskReferenceSchema).max(10_000).default([]),
  outputs: z.array(taskOutputSchema).min(1).max(5_000),
  acceptanceCriteria: z.array(acceptanceCriterionSchema).min(1).max(50),
  budget: taskBudgetSchema.default({
    maxInputTokens: 24_000,
    maxOutputTokens: 8_000,
    maxToolCalls: 16,
    maxDurationMs: 15 * 60 * 1_000
  }),
  modelPolicy: modelPolicySchema.default({ fallbacks: [], tier: 'balanced' }),
  retryPolicy: retryPolicySchema.default({ maxAttempts: 2, backoffMs: 1_000, retryOn: ['transient'] }),
  qualityGate: qualityGateSchema.default({ minimumScore: 0.8, maxRevisions: 1, requiredChecks: [] }),
  scope: taskScopeSchema.default({ manuscriptUnitIds: [], chapterIds: [], sceneIds: [], artifactIds: [], allowSupportingArtifacts: false }),
  skillVersions: z.record(z.string(), z.string().trim().min(1)).default({}),
  metadata: z.record(z.string(), z.unknown()).default({})
});

export type TaskContract = z.infer<typeof taskContractSchema>;

export interface LegacyTaskInput {
  description: string;
  prompt?: string;
  objective?: string;
  subagent_type: string;
  task_id?: string;
  contract?: unknown;
}

/**
 * Normalize every delegation into an executable contract. The legacy prompt form
 * remains accepted for old clients, but it never reaches the runtime as an
 * unstructured assignment.
 */
export function normalizeTaskContract(input: LegacyTaskInput): TaskContract {
  if (input.contract !== undefined) return taskContractSchema.parse(input.contract);

  const objective = input.objective?.trim() || input.prompt?.trim();
  if (!objective) throw new Error('A typed task contract or objective is required');
  return taskContractSchema.parse({
    objective,
    outputs: [{ type: 'task-result', name: input.description }],
    acceptanceCriteria: [
      {
        id: 'objective-complete',
        description: `Provide evidence that the delegated objective is complete: ${input.description}`,
        check: 'deterministic'
      }
    ],
    scope: { allowSupportingArtifacts: true }
  });
}

export type EvaluationDisposition = 'accept' | 'revise' | 'escalate';

export function evaluationDisposition(
  contract: TaskContract,
  score: number,
  revision: number,
  requiredChecksPassed: boolean
): EvaluationDisposition {
  if (requiredChecksPassed && score >= contract.qualityGate.minimumScore) return 'accept';
  if (revision < contract.qualityGate.maxRevisions) return 'revise';
  return 'escalate';
}

export function stepLimitForTask(contract: TaskContract | null | undefined): number {
  if (!contract) return 12;
  // AI SDK steps include model responses as well as tool calls. Keep the loop
  // bounded; durable workflow scheduling owns work beyond this invocation.
  return Math.min(2_048, Math.max(4, contract.budget.maxToolCalls * 2 + 2));
}
