import { z } from 'zod';
import type { RuntimeRole } from '../runtime/taskContract.js';

const artifactTypeSchema = z.enum([
  'story-brief',
  'narrative-contract',
  'character-bible',
  'relationship-graph',
  'world-bible',
  'plot-thread',
  'act-architecture',
  'chapter-brief',
  'scene-plan',
  'timeline',
  'setup-payoff-map',
  'research-questions',
  'open-questions',
  'beat',
  'chapter-draft',
  'revision-issue',
  'finale-plan',
  'export-manifest',
  'task-result'
]);

export const skillManifestSchema = z.object({
  schemaVersion: z.literal(1),
  name: z.string().regex(/^[a-z0-9][a-z0-9-]{0,63}$/),
  version: z.string().regex(/^\d+\.\d+\.\d+(?:-[a-z0-9.-]+)?$/i),
  description: z.string().trim().min(1).max(1_000),
  kind: z.enum(['workflow', 'planning', 'drafting', 'critique', 'revision', 'continuity', 'research']),
  inputs: z.array(artifactTypeSchema).max(30).default([]),
  outputs: z.array(artifactTypeSchema).max(30).default([]),
  runtimeRoles: z.array(z.enum(['orchestrator', 'explorer', 'creator', 'drafter', 'critic', 'reviser', 'researcher', 'librarian'])).min(1),
  allowedTools: z.array(z.string().trim().min(1)).max(100),
  maxIterations: z.number().int().min(1).max(4).default(1),
  context: z.object({
    maxTokens: z.number().int().min(1_000).max(80_000).default(24_000),
    sections: z.array(z.enum(['story-brief', 'narrative-contract', 'active-task', 'characters', 'world', 'recent-causal', 'threads', 'canon', 'style'])).min(1)
  }),
  rubric: z.string().trim().min(1).optional(),
  procedure: z.array(z.string().trim().min(1)).min(1).max(30),
  references: z.array(z.string().trim().min(1)).max(30).default([])
}).strict();

export type SkillManifest = z.infer<typeof skillManifestSchema>;

export function parseSkillManifest(value: unknown, source = 'skill.json'): SkillManifest {
  const parsed = skillManifestSchema.safeParse(value);
  if (!parsed.success) {
    const details = parsed.error.issues.map((issue) => `${issue.path.join('.') || 'manifest'}: ${issue.message}`).join('; ');
    throw new Error(`Invalid ${source}: ${details}`);
  }
  return parsed.data;
}

export function legacySkillManifest(name: string, description: string): SkillManifest {
  return skillManifestSchema.parse({
    schemaVersion: 1,
    name,
    version: '1.0.0-legacy',
    description,
    kind: 'planning',
    runtimeRoles: ['creator'] satisfies RuntimeRole[],
    allowedTools: ['readProjectAiSkill'],
    context: { maxTokens: 24_000, sections: ['story-brief', 'active-task'] },
    procedure: ['Load the human-readable SKILL.md only when this capability is active.']
  });
}

export function conciseSkillInstructions(manifest: SkillManifest): string {
  return [
    `Skill: ${manifest.name}@${manifest.version}`,
    `Kind: ${manifest.kind}`,
    'Procedure:',
    ...manifest.procedure.map((step, index) => `${index + 1}. ${step}`),
    manifest.rubric ? `Rubric: ${manifest.rubric}` : ''
  ].filter(Boolean).join('\n');
}
