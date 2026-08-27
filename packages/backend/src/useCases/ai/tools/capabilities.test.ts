import { describe, expect, it } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import { buildAgentTools } from './index.js';
import { filterToolsForRole, filterToolsForSkill } from './capabilities.js';
import { taskContractSchema } from '../runtime/taskContract.js';

const tools = {
  listBuildRuns: { execute: async () => 'builds' },
  startNovelBuild: { execute: async () => 'started' },
  readChapter: { execute: async () => 'read' },
  searchStory: { execute: async () => 'searched' },
  findReferences: { execute: async () => 'references' },
  getSceneContext: { execute: async () => 'context' },
  updateChapter: { execute: async () => 'updated' },
  applyChapterPatch: { execute: async () => 'patched' },
  applyBuildUnitPatch: { execute: async () => 'unit-patched' },
  applyArtifactBatch: { execute: async () => 'artifacts-applied' },
  commitCanonDelta: { execute: async () => 'canon-committed' },
  updateScene: { execute: async () => 'scene-updated' },
  createCharacter: { execute: async () => 'created' },
  runStoryLint: { execute: async () => 'linted' },
  reportTaskResult: { execute: async () => 'reported' },
  task: { execute: async () => 'delegated' }
};

describe('runtime capability filtering', () => {
it('exposes build discovery broadly but build initialization only to the primary orchestrator', () => {
  const primary = filterToolsForRole(tools, 'orchestrator', null, { primary: true });
  const delegated = filterToolsForRole(tools, 'orchestrator', null, { primary: false });
  expect(primary.listBuildRuns).toBeDefined();
  expect(primary.startNovelBuild).toBeDefined();
  expect(delegated.listBuildRuns).toBeDefined();
  expect(delegated.startNovelBuild).toBeUndefined();
});

it('gives explorer literally no mutation or delegation tools', () => {
  const filtered = filterToolsForRole(tools, 'explorer', null, { primary: false });
  expect(Object.keys(filtered)).toEqual(['listBuildRuns', 'readChapter', 'searchStory', 'findReferences', 'getSceneContext']);
});

it('gives critic diagnostics but no manuscript mutation', () => {
  const filtered = filterToolsForRole(tools, 'critic', null, { primary: false });
  expect(Object.keys(filtered)).toEqual(['listBuildRuns', 'readChapter', 'searchStory', 'findReferences', 'getSceneContext', 'runStoryLint', 'reportTaskResult']);
});

it('preserves approval-gated legacy interactive chapter runners', async () => {
  const contract = taskContractSchema.parse({
    objective: 'Draft assigned chapter',
    outputs: [{ type: 'chapter-draft', name: 'Chapter 7' }],
    acceptanceCriteria: [{ id: 'drafted', description: 'Chapter is drafted' }],
    scope: { chapterIds: ['chapter-7'] }
  });
  const filtered = filterToolsForRole(tools, 'drafter', contract, { primary: false });
  await expect(filtered.updateChapter?.execute?.({ chapterId: 'chapter-8' })).resolves.toBe('updated');
  await expect(filtered.updateChapter?.execute?.({ chapterId: 'chapter-7' })).resolves.toBe('updated');
  expect(filtered.createCharacter).toBeUndefined();
});

it('preserves approval-gated legacy interactive scene metadata runners', async () => {
  const contract = taskContractSchema.parse({
    objective: 'Draft assigned scene',
    outputs: [{ type: 'chapter-draft', name: 'Scene 7.2' }],
    acceptanceCriteria: [{ id: 'drafted', description: 'Scene is drafted' }],
    scope: { chapterIds: ['chapter-7'], sceneIds: ['scene-7-2'] }
  });
  const filtered = filterToolsForRole(tools, 'drafter', contract, { primary: false });
  await expect(filtered.updateScene?.execute?.({ sceneId: 'scene-8-1' })).resolves.toBe('scene-updated');
  await expect(filtered.updateScene?.execute?.({ sceneId: 'scene-7-2' })).resolves.toBe('scene-updated');
});

it('intersects runtime capabilities with the active skill manifest', () => {
  const roleScoped = filterToolsForRole(tools, 'drafter', null, { primary: false });
  const skillScoped = filterToolsForSkill(roleScoped, ['readChapter', 'updateChapter']);
  expect(Object.keys(skillScoped)).toEqual(['listBuildRuns', 'readChapter', 'searchStory', 'findReferences', 'getSceneContext', 'updateChapter']);
  expect(skillScoped.findReferences).toBeDefined();
});

it('strictly narrows durable worker schemas to the procedural skill tools', () => {
  const roleScoped = filterToolsForRole(tools, 'creator', null, { primary: false });
  const skillScoped = filterToolsForSkill(
    roleScoped,
    ['applyArtifactBatch', 'reportTaskResult'],
    { preserveRoleReads: false }
  );
  expect(Object.keys(skillScoped)).toEqual(['applyArtifactBatch', 'reportTaskResult']);
});

it('lets the librarian persist a scoped timeline artifact during planning', () => {
  const contract = taskContractSchema.parse({
    objective: 'Create the timeline artifact', outputs: [{ type: 'timeline', name: 'timeline' }],
    acceptanceCriteria: [{ id: 'timeline', description: 'Timeline is validated' }],
    scope: { buildRunId: 'build-1', buildTaskId: 'task-1' }
  });
  const filtered = filterToolsForRole(tools, 'librarian', contract, { primary: false });
  expect(filtered.applyArtifactBatch).toBeDefined();
  expect(filtered.updateChapter).toBeUndefined();
});

it('removes canonical chapter mutation from durable build workers', () => {
  const contract = taskContractSchema.parse({
    objective: 'Draft on the isolated build branch',
    outputs: [{ type: 'chapter-draft', name: 'Chapter 7' }],
    acceptanceCriteria: [{ id: 'drafted', description: 'Draft is persisted' }],
    scope: { buildRunId: 'build-1', chapterIds: ['chapter-7'] }
  });
  const filtered = filterToolsForRole(tools, 'drafter', contract, { primary: false });
  expect(filtered.updateChapter).toBeUndefined();
  expect(filtered.updateScene).toBeUndefined();
  expect(filtered.applyChapterPatch).toBeUndefined();
});

it('allows only the explicitly assigned isolated build unit', async () => {
  const contract = taskContractSchema.parse({
    objective: 'Draft one scene unit', outputs: [{ type: 'chapter-draft', name: 'scene' }],
    acceptanceCriteria: [{ id: 'head', description: 'Unit head changes' }],
    scope: { buildRunId: 'build-1', buildTaskId: 'task-1', manuscriptUnitIds: ['unit-1'] }
  });
  const filtered = filterToolsForRole(tools, 'drafter', contract, { primary: false });
  await expect(filtered.applyBuildUnitPatch?.execute?.({ buildRunId: 'build-1', taskId: 'task-1', unitId: 'unit-2' })).rejects.toThrow(/assigned build unit/);
  await expect(filtered.applyBuildUnitPatch?.execute?.({ buildRunId: 'build-1', taskId: 'task-1', unitId: 'unit-1' })).resolves.toBe('unit-patched');
  await expect(filtered.applyBuildUnitPatch?.execute?.({ buildRunId: 'build-1', taskId: 'task-1', unitId: 'unit-1', status: 'accepted' })).rejects.toThrow(/workflow gates/);
});

it('requires scoped artifact outputs to carry an exact build-unit binding', async () => {
  const contract = taskContractSchema.parse({
    objective: 'Report one scoped revision issue', outputs: [{ type: 'revision-issue', name: 'issue' }],
    acceptanceCriteria: [{ id: 'bound', description: 'Output is bound' }],
    scope: { buildRunId: 'build-1', buildTaskId: 'task-1', manuscriptUnitIds: ['unit-1'] }
  });
  const filtered = filterToolsForRole(tools, 'reviser', contract, { primary: false });
  await expect(filtered.applyArtifactBatch?.execute?.({ buildRunId: 'build-1', taskId: 'task-1', operations: [{ action: 'upsert', bindings: [] }] })).rejects.toThrow(/bind to an assigned/);
  await expect(filtered.applyArtifactBatch?.execute?.({ buildRunId: 'build-1', taskId: 'task-1', operations: [{ action: 'upsert', bindings: [{ bindingKind: 'build-unit', unitId: 'unit-1', role: 'revision-target' }] }] })).resolves.toBe('artifacts-applied');
});

it('does not give planning creators canon mutation authority', () => {
  const contract = taskContractSchema.parse({
    objective: 'Plan only', outputs: [{ type: 'story-brief', name: 'brief' }],
    acceptanceCriteria: [{ id: 'planned', description: 'Plan exists' }],
    scope: { buildRunId: 'build-1', buildTaskId: 'task-1' }
  });
  expect(filterToolsForRole(tools, 'creator', contract, { primary: false }).commitCanonDelta).toBeUndefined();
});

it('removes askUser in Auto mode while retaining in-scope mutation tools', () => {
  const handlers = {
    handleApproval: async () => ({ ok: true })
  };
  const taskHandler = { handleTask: async () => ({ ok: true }) };
  const manual = buildAgentTools(
    {} as PrismaClient,
    { projectId: 'project-1', userId: 'user-1' },
    handlers,
    { handleQuestion: async () => ({ ok: true }) },
    taskHandler,
    [],
    { role: 'orchestrator', taskContract: null, primary: true, approvalMode: 'manual' }
  );
  const auto = buildAgentTools(
    {} as PrismaClient,
    { projectId: 'project-1', userId: 'user-1' },
    handlers,
    { handleQuestion: async () => ({ ok: true }) },
    taskHandler,
    [],
    { role: 'orchestrator', taskContract: null, primary: true, approvalMode: 'auto' }
  );

  expect(manual.askUser).toBeDefined();
  expect(auto.askUser).toBeUndefined();
  expect(auto.createChapter).toBeDefined();
});

it('hard-binds durable read tools and scene context to the assigned build/unit', async () => {
  const contract = taskContractSchema.parse({
    objective: 'Inspect one assigned build scene', outputs: [{ type: 'task-result', name: 'inspection' }],
    acceptanceCriteria: [{ id: 'scoped', description: 'Reads stay scoped' }],
    scope: { buildRunId: 'build-1', buildTaskId: 'task-1', manuscriptUnitIds: ['unit-1'] }
  });
  const filtered = filterToolsForRole(tools, 'critic', contract, { primary: false });
  await expect(filtered.searchStory?.execute?.({ buildRunId: 'build-2', query: 'secret' })).rejects.toThrow(/assigned build run/);
  await expect(filtered.searchStory?.execute?.({ buildRunId: 'build-1', query: 'secret' })).resolves.toBe('searched');
  await expect(filtered.getSceneContext?.execute?.({ sceneId: 'unit-2' })).rejects.toThrow(/assigned scene/);
  await expect(filtered.getSceneContext?.execute?.({ sceneId: 'unit-1' })).resolves.toBe('context');
});
});
