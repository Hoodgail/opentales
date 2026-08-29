import type { PrismaClient } from '@prisma/client';
import { describe, expect, it, vi } from 'vitest';
import {
  coerceReportedTaskResult,
  getBuildState,
  normalizeArtifactBatchForContract,
  normalizeArtifactContentForManifest,
  normalizeReportedTaskResult
} from './buildTools.js';

const now = new Date('2026-08-26T00:00:00.000Z');

function fixture() {
  const run = {
    id: 'build-1',
    projectId: 'project-1',
    objective: 'Build a novel',
    brainstorm: 'source-brainstorm',
    manifest: { version: 'v1', target: { genre: 'science fantasy' }, hidden: 'manifest-bulk' },
    autonomyMode: 'PLAN_REVIEW',
    status: 'PAUSED',
    currentPhase: 'planning',
    workflowVersion: 'novel-build-v1',
    branchName: 'build/story',
    authorizationScope: { allowPlanningArtifacts: true },
    maxTokens: null,
    tokensUsed: 0,
    tokensReserved: 0,
    maxCostMicros: null,
    costMicrosUsed: 0,
    costMicrosReserved: 0,
    revision: 2,
    executionGeneration: 1,
    authorizedAt: now,
    pausedAt: now,
    lastError: 'Paused',
    updatedAt: now
  };
  const tasks = [
    {
      id: 'task-ready', key: 'story-brief', type: 'create-story-brief', phase: 'planning', status: 'READY',
      dependencyIds: [], assignedAgent: 'creator', attempts: 0, maxAttempts: 3, progress: 0, priority: 100,
      lastError: null, updatedAt: now, executionPolicy: { hidden: 'policy-bulk' }
    },
    {
      id: 'task-blocked', key: 'world-bible', type: 'create-world-bible', phase: 'planning', status: 'BLOCKED',
      dependencyIds: ['task-ready'], assignedAgent: 'creator', attempts: 0, maxAttempts: 3, progress: 0, priority: 85,
      lastError: null, updatedAt: now, executionPolicy: { hidden: 'policy-bulk' }
    }
  ];
  const artifacts = [{
    id: 'artifact-1', type: 'STORY_BRIEF', key: 'story-brief', title: 'Brief', version: 1,
    schemaVersion: '1', status: 'VALIDATED', taskId: 'task-ready', updatedAt: now,
    content: { secret: 'artifact-body-must-not-leak' }
  }];
  const checkpoints = [{ id: 'checkpoint-1', sequence: 1, label: 'Plan', phase: 'planning', taskId: null, createdAt: now }];
  const prisma = {
    buildRun: { findFirst: vi.fn(async () => run) },
    buildTask: { findMany: vi.fn(async () => tasks) },
    storyArtifact: { findMany: vi.fn(async () => artifacts) },
    buildCheckpoint: { findMany: vi.fn(async () => checkpoints) }
  } as unknown as PrismaClient;
  return { prisma };
}

describe('bounded build tool projections', () => {
  it('binds provider-shaped task reports to the active fenced contract', () => {
    const contract = {
      scope: { buildRunId: 'build-1', buildTaskId: 'task-1' }
    } as unknown as Parameters<typeof coerceReportedTaskResult>[1];
    const lease = {
      taskId: 'task-1', workerId: 'worker-1', leaseToken: 'lease-1',
      leaseGeneration: 4, runGeneration: 2
    } as Parameters<typeof coerceReportedTaskResult>[2];
    const coerced = coerceReportedTaskResult({
      status: 'complete',
      decisions: [{ summary: 'Planning passed', rationale: 'All required artifacts exist.' }],
      evidence: ['Deterministic checks passed.'],
      checks: { complete: { passed: true, details: '15 artifacts' } },
      quality: { rubric: 'complete-book-plan-v1', completeness: { value: 0.94 } }
    }, contract, lease);

    expect(coerced).toMatchObject({
      buildRunId: 'build-1',
      taskId: 'task-1',
      idempotencyKey: 'worker-report:task-1:4',
      status: 'complete',
      decisions: [{ decision: 'Planning passed', reason: 'All required artifacts exist.' }],
      evidence: [{ type: 'worker', summary: 'Deterministic checks passed.' }]
    });
    expect(normalizeReportedTaskResult(coerced)).toMatchObject({
      checks: { complete: true },
      quality: { completeness: 0.94 }
    });
  });

  it('normalizes detailed model self-reports into flat observable checks and scores', () => {
    expect(normalizeReportedTaskResult({
      buildRunId: 'build-1',
      taskId: 'task-1',
      idempotencyKey: 'report-1',
      status: 'complete',
      decisions: [],
      artifactIds: ['artifact-1'],
      evidence: [],
      checks: {
        requiredArtifactTypes: { passed: true, observed: ['story-brief'] },
        scope: false
      },
      quality: {
        rubric: 'story-brief-v1',
        score: 0.96,
        specificity: { score: 0.9, note: 'specific' }
      },
      unresolvedQuestions: []
    })).toMatchObject({
      checks: { requiredArtifactTypes: true, scope: false },
      quality: { score: 0.96, specificity: 0.9 }
    });
  });

  it('drops invented build-unit bindings from unscoped planning artifacts', () => {
    const input = {
      buildRunId: 'build-1',
      taskId: 'task-1',
      idempotencyKey: 'artifact-1',
      operations: [{
        action: 'upsert' as const,
        type: 'story-brief' as const,
        key: 'story-brief',
        title: 'Story Brief',
        schemaVersion: '1',
        content: {},
        status: 'VALIDATED' as const,
        bindings: [
          { bindingKind: 'build-unit' as const, role: 'invented', unitId: 'story-brief:1' },
          { bindingKind: 'entity' as const, role: 'subject', entityType: 'character', entityId: 'character-1' }
        ]
      }]
    };
    const contract = {
      scope: { buildTaskId: 'task-1', manuscriptUnitIds: [] }
    } as unknown as Parameters<typeof normalizeArtifactBatchForContract>[1];

    expect(normalizeArtifactBatchForContract(input, contract).operations[0]).toMatchObject({
      bindings: [{ bindingKind: 'entity', entityId: 'character-1' }]
    });
    const withoutBindings = {
      ...input,
      operations: [{ ...input.operations[0], bindings: undefined }]
    } as unknown as typeof input;
    expect(normalizeArtifactBatchForContract(withoutBindings, contract).operations[0]).toMatchObject({
      bindings: []
    });
  });

  it('keeps immutable build targets authoritative in generated story briefs', () => {
    expect(normalizeArtifactContentForManifest('story-brief', {
      premise: 'A premise',
      genre: 'wrong genre',
      tone: ['wrong tone'],
      constraints: ['Generated constraint'],
      targetWordCount: 110_000,
      minWordCount: 90_000,
      maxWordCount: 130_000,
      targetChapterCount: 30,
      targetSceneCount: 90,
      targetCharacterCount: 24
    }, {
      target: {
        genre: 'Science fantasy',
        targetAudience: 'YA / New Adult',
        tone: ['wonder', 'betrayal'],
        constraints: ['Stop after planning'],
        targetWordCount: 80_000,
        minWordCount: 72_000,
        maxWordCount: 88_000,
        targetChapterCount: 24,
        targetSceneCount: 78,
        targetCharacterCount: 9
      }
    })).toMatchObject({
      genre: 'Science fantasy',
      targetAudience: 'YA / New Adult',
      tone: ['wonder', 'betrayal'],
      constraints: ['Stop after planning', 'Generated constraint'],
      targetWordCount: 80_000,
      minWordCount: 72_000,
      maxWordCount: 88_000,
      targetChapterCount: 24,
      targetSceneCount: 78,
      targetCharacterCount: 9
    });
  });

  it('returns a compact summary without full manifests, task policies, brainstorms, or artifact bodies', async () => {
    const { prisma } = fixture();
    const summary = await getBuildState(prisma, 'project-1', 'build-1');
    const serialized = JSON.stringify(summary);

    expect(summary.readyTasks).toEqual([
      expect.objectContaining({ id: 'task-ready', key: 'story-brief', status: 'READY' })
    ]);
    expect(summary.blockers).toEqual([
      expect.objectContaining({ key: 'world-bible', dependencyKeys: ['story-brief'] })
    ]);
    expect(serialized).not.toContain('source-brainstorm');
    expect(serialized).not.toContain('manifest-bulk');
    expect(serialized).not.toContain('policy-bulk');
    expect(serialized).not.toContain('artifact-body-must-not-leak');
    expect(serialized.length).toBeLessThan(8_000);
  });

  it('returns source context only when explicitly requested', async () => {
    const { prisma } = fixture();
    const state = await getBuildState(prisma, 'project-1', 'build-1', 'context') as {
      context: { brainstorm: string; target: unknown; manifestVersion: unknown };
    };
    expect(state.context).toMatchObject({
      brainstorm: 'source-brainstorm',
      target: { genre: 'science fantasy' },
      manifestVersion: 'v1'
    });
  });
});
