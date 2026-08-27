import type { PrismaClient } from '@prisma/client';
import { describe, expect, it, vi } from 'vitest';
import { getBuildState } from './buildTools.js';

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
