import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Prisma, PrismaClient } from '@prisma/client';
import type { BuildAuthorizationScope } from '@opentales/sdk';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { BuildJudgeExecutor, BuildModelExecutor, BuildModelExecutorInput } from './NovelBuildWorker.js';
import { taskContractSchema } from '../runtime/taskContract.js';

const databaseUrl = process.env.AI_WORKER_TEST_DATABASE_URL;
const fixturePricing = {
  'priced/model': { inputMicrosPerMillion: 2_000_000, outputMicrosPerMillion: 8_000_000, source: 'integration fixture', version: '1' }
};
process.env.DATABASE_URL ??= databaseUrl ?? 'postgresql://opentales:opentales@127.0.0.1:5432/opentales_test';
process.env.JWT_SECRET ??= 'integration-test-secret-not-for-production';
const exportAssetRoot = databaseUrl ? await mkdtemp(path.join(os.tmpdir(), 'opentales-worker-exports-')) : null;
if (exportAssetRoot) process.env.ASSETS_DIR = exportAssetRoot;
const { resumeRunnableBuilds } = await import('./NovelBuildWorker.js');
const { NovelBuildUseCase } = await import('../../novelBuild/NovelBuildUseCase.js');
const { BuildManuscriptUseCase } = await import('../../novelBuild/BuildManuscriptUseCase.js');
const { StoryStateUseCase } = await import('../../novelBuild/StoryStateUseCase.js');
const { storyIntelligenceTools } = await import('../tools/storyIntelligence.js');
const { ProjectExportUseCase } = await import('../../exportImport/ProjectExportUseCase.js');
const integration = describe.runIf(Boolean(databaseUrl));

integration('NovelBuildWorker PostgreSQL integration', () => {
  const prisma = new PrismaClient({ datasourceUrl: databaseUrl });
  const suffix = randomUUID().slice(0, 8);
  let projectId = '';
  let userId = '';
  let buildRunId = '';
  const generatedExportIds: string[] = [];

  beforeAll(async () => {
    const user = await prisma.user.create({
      data: {
        username: `ai-worker-${suffix}`,
        email: `ai-worker-${suffix}@example.test`,
        passwordHash: 'integration-only'
      }
    });
    userId = user.id;
    const org = await prisma.org.create({
      data: {
        slug: `ai-worker-${suffix}`,
        name: 'AI Worker Integration',
        memberships: { create: { userId, role: 'OWNER' } }
      }
    });
    const project = await prisma.project.create({
      data: {
        orgId: org.id,
        slug: 'novel',
        title: 'Deterministic Novel Build',
        description: 'A cartographer discovers that every map erases one memory.',
        genre: 'Gothic fantasy',
        perspective: 'close third',
        pov: 'single',
        voice: 'concrete and restrained',
        tone: 'melancholic',
        themes: ['memory', 'love', 'cost']
      }
    });
    projectId = project.id;
    await prisma.projectAiSettings.create({ data: { projectId, enabled: true, providerKind: 'GATEWAY', model: 'priced/model' } });
  }, 15_000);

  afterAll(async () => {
    for (const exportId of generatedExportIds) await new ProjectExportUseCase(prisma).delete(userId, projectId, exportId).catch(() => undefined);
    await prisma.org.deleteMany({ where: { slug: `ai-worker-${suffix}` } });
    await prisma.user.deleteMany({ where: { id: userId } });
    await prisma.$disconnect();
    if (exportAssetRoot) await rm(exportAssetRoot, { recursive: true, force: true });
  });

  it('runs a fresh Plan & Review brainstorm through planning, two causal scenes, revisions, real export, and final completion', async () => {
    const builds = new NovelBuildUseCase(prisma);
    const created = await builds.create(userId, projectId, {
      idempotencyKey: `fresh-build:${suffix}`,
      brainstorm: 'A disgraced cartographer restores a vanished district, but each line erases a beloved memory.',
      objective: 'Produce a complete causal gothic fantasy test manuscript.',
      targetWordCount: 1_200,
      minWordCount: 1_000,
      maxWordCount: 2_000,
      targetChapterCount: 1,
      targetSceneCount: 2,
      targetCharacterCount: 1,
      autonomyMode: 'plan-review',
      maxTokens: 10_000_000,
      maxCostMicros: 10_000_000
    });
    buildRunId = created.id;
    const authorizedScope: BuildAuthorizationScope = {
      artifactTypes: ['story-brief', 'narrative-contract', 'character-bible', 'relationship-graph', 'world-bible', 'plot-thread', 'act-architecture', 'chapter-brief', 'scene-plan', 'timeline', 'setup-payoff-map', 'research-questions', 'open-questions', 'beat', 'chapter-draft', 'revision-issue', 'finale-plan', 'export-manifest'],
      chapterIds: [], sceneIds: [], allowPlanningArtifacts: true, allowCanonWrites: true,
      allowChapterWrites: true, allowSceneWrites: true, allowDiagnostics: true, expiresAt: null
    };
    await builds.authorize(userId, projectId, buildRunId, {
      idempotencyKey: `authorize-planning:${suffix}`,
      expectedRevision: created.revision,
      authorizationScope: {
        artifactTypes: ['story-brief', 'narrative-contract', 'character-bible', 'relationship-graph', 'world-bible', 'plot-thread', 'act-architecture', 'chapter-brief', 'scene-plan', 'timeline', 'setup-payoff-map', 'research-questions', 'open-questions', 'beat', 'finale-plan'],
        chapterIds: [], sceneIds: [], allowPlanningArtifacts: true, allowCanonWrites: false,
        allowChapterWrites: false, allowSceneWrites: false, allowDiagnostics: true, expiresAt: null
      },
      maxTokens: 10_000_000,
      maxCostMicros: 10_000_000
    });
    const executor = deterministicExecutor(prisma, buildRunId);
    const judgeExecutor = deterministicJudgeExecutor();
    const [firstWorker, secondWorker] = await Promise.all([
      resumeRunnableBuilds(prisma, { workerId: `integration-a:${suffix}`, maxTasksPerSweep: 200, modelExecutor: executor, judgeExecutor, buildRunIds: [buildRunId], modelPricing: fixturePricing }),
      resumeRunnableBuilds(prisma, { workerId: `integration-b:${suffix}`, maxTasksPerSweep: 200, modelExecutor: executor, judgeExecutor, buildRunIds: [buildRunId], modelPricing: fixturePricing })
    ]);
    expect(firstWorker + secondWorker).toBeGreaterThan(0);
    let run = await prisma.buildRun.findUniqueOrThrow({ where: { id: buildRunId } });
    const planningFailures = await prisma.buildTask.findMany({ where: { buildRunId, status: 'FAILED' }, select: { key: true, lastError: true } });
    expect(run.status, `${run.lastError ?? ''}\n${planningFailures.map((task) => `${task.key}: ${task.lastError ?? ''}`).join('\n')}`).toBe('PAUSED');
    expect(run.currentPhase).toBe('checkpoint-review:planning-checkpoint');
    expect(await prisma.chapter.count({ where: { projectId } })).toBe(0);
    expect(await prisma.scene.count({ where: { chapter: { projectId } } })).toBe(0);
    expect(await prisma.buildManuscriptUnit.count({ where: { buildRunId } })).toBe(0);

    await builds.authorize(userId, projectId, buildRunId, {
      idempotencyKey: `authorize-manifest:${suffix}`,
      expectedRevision: run.revision,
      authorizationScope: authorizedScope,
      maxTokens: 10_000_000,
      maxCostMicros: 10_000_000
    });
    for (let approval = 0; approval < 10; approval += 1) {
      await resumeRunnableBuilds(prisma, { workerId: `integration-draft:${suffix}:${approval}`, maxTasksPerSweep: 300, modelExecutor: executor, judgeExecutor, buildRunIds: [buildRunId], modelPricing: fixturePricing });
      run = await prisma.buildRun.findUniqueOrThrow({ where: { id: buildRunId } });
      if (run.status !== 'PAUSED' || !run.currentPhase.startsWith('checkpoint-review:')) break;
      await builds.authorize(userId, projectId, buildRunId, {
        idempotencyKey: `authorize-checkpoint:${suffix}:${approval}`,
        expectedRevision: run.revision,
        authorizationScope: authorizedScope,
        maxTokens: 10_000_000,
        maxCostMicros: 10_000_000
      });
    }
    run = await prisma.buildRun.findUniqueOrThrow({ where: { id: buildRunId } });
    const draftingFailures = await prisma.buildTask.findMany({ where: { buildRunId, status: 'FAILED' }, select: { key: true, lastError: true } });
    const draftUnitsAtPause = await prisma.buildManuscriptUnit.findMany({ where: { buildRunId }, include: { branch: { include: { headVersion: true } } } });
    expect(run.status, `${run.lastError ?? ''}\n${draftingFailures.map((task) => `${task.key}: ${task.lastError ?? ''}`).join('\n')}\n${draftUnitsAtPause.map((unit) => `${unit.key}:${unit.branch.headVersion?.wordCount ?? 0}`).join(', ')}`).toBe('PAUSED');
    const nonDone = await prisma.buildTask.findMany({ where: { buildRunId, status: { not: 'DONE' } }, select: { key: true, status: true, lastError: true } });
    const diagnosticResult = await new StoryStateUseCase(prisma).diagnostics(userId, projectId, buildRunId);
    const blockerReason = run.lastError ?? nonDone.find((task) => task.key === 'export-preparation')?.lastError ?? '';
    expect(blockerReason, `phase=${run.currentPhase}\n${diagnosticResult.diagnostics.map((diagnostic) => `${diagnostic.code}: ${diagnostic.message}`).join('\n')}\n${nonDone.map((task) => `${task.key} [${task.status}]: ${task.lastError ?? ''}`).join('\n')}`).toContain('export');

    const compilation = await prisma.buildCompilation.findFirstOrThrow({ where: { buildRunId }, orderBy: { createdAt: 'desc' } });
    const generatedExport = await new ProjectExportUseCase(prisma).create(userId, projectId, {
      idempotencyKey: `generate-export:${suffix}`,
      format: 'text',
      preset: 'reading-copy',
      target: { kind: 'build', buildRunId, compilationId: compilation.id },
      options: { includeTitlePage: true, chapterNumbering: true }
    });
    expect(generatedExport.status).toBe('ready');
    expect(generatedExport.assetId).toBeTruthy();
    generatedExportIds.push(generatedExport.id);
    run = await prisma.buildRun.findUniqueOrThrow({ where: { id: buildRunId } });
    await builds.resume(userId, projectId, buildRunId, { idempotencyKey: `resume-export:${suffix}`, expectedRevision: run.revision });
    await resumeRunnableBuilds(prisma, { workerId: `integration-final:${suffix}`, maxTasksPerSweep: 50, modelExecutor: executor, judgeExecutor, buildRunIds: [buildRunId], modelPricing: fixturePricing });

    run = await prisma.buildRun.findUniqueOrThrow({ where: { id: buildRunId } });
    const tasks = await prisma.buildTask.findMany({ where: { buildRunId } });
    const failedDetails = tasks.filter((task) => task.status === 'FAILED').map((task) => `${task.key}: ${task.lastError}`).join('\n');
    expect(run.status, `${run.lastError ?? ''}\n${failedDetails}`).toBe('COMPLETED');
    expect(tasks.every((task) => task.status === 'DONE')).toBe(true);
    expect(tasks.every((task) => task.attempts <= 2)).toBe(true);
    expect(tasks.some((task) => task.key === 'scene:scene-1:checkpoint')).toBe(true);
    expect(tasks.some((task) => task.key === 'scene:scene-2:checkpoint')).toBe(true);
    expect(tasks.some((task) => task.key === 'chapter:chapter-1:compile')).toBe(true);

    const [units, branches, canon, checkpoints, traces, evaluations, runningTransitions] = await Promise.all([
      prisma.buildManuscriptUnit.findMany({ where: { buildRunId } }),
      prisma.writingBranch.findMany({ where: { buildRunId } }),
      prisma.canonFact.findMany({ where: { buildRunId, status: 'CANONICAL', isCurrent: true } }),
      prisma.buildCheckpoint.findMany({ where: { buildRunId } }),
      prisma.buildTrace.findMany({ where: { buildRunId } }),
      prisma.buildEvaluationResult.findMany({ where: { buildRunId } }),
      prisma.buildTaskTransition.count({ where: { buildRunId, toStatus: 'RUNNING' } })
    ]);
    expect(units).toHaveLength(3);
    expect(branches.length).toBeGreaterThanOrEqual(3);
    expect(canon.length).toBeGreaterThanOrEqual(2);
    expect(checkpoints.length).toBeGreaterThanOrEqual(3);
    expect(traces.length).toBeGreaterThan(0);
    expect(traces.length).toBeLessThanOrEqual(runningTransitions);
    expect(traces.every((trace) => trace.status !== 'STARTED' && trace.completedAt !== null)).toBe(true);
    expect(new Set(traces.map((trace) => trace.idempotencyKey)).size).toBe(traces.length);
    expect(evaluations.some((evaluation) => evaluation.kind === 'MODEL')).toBe(true);
    const sceneCritic = tasks.find((task) => task.key === 'scene:scene-1:critic');
    const sceneRevision = tasks.find((task) => task.key === 'scene:scene-1:revision');
    const sceneGate = tasks.find((task) => task.key === 'scene:scene-1:quality-gate');
    expect(sceneCritic && evaluations.some((evaluation) => evaluation.taskId === sceneCritic.id && evaluation.kind === 'MODEL' && !evaluation.passed)).toBe(true);
    expect(sceneRevision?.attempts).toBeGreaterThan(0);
    expect(sceneGate && evaluations.some((evaluation) => evaluation.taskId === sceneGate.id && evaluation.kind === 'MODEL' && !evaluation.passed)).toBe(true);
    expect(sceneGate && evaluations.some((evaluation) => evaluation.taskId === sceneGate.id && evaluation.kind === 'MODEL' && evaluation.passed)).toBe(true);
    const pricedTraces = traces.filter((trace) => trace.model === 'priced/model');
    expect(pricedTraces.length).toBeGreaterThan(0);
    expect(pricedTraces.every((trace) => (trace.costMicros ?? 0) > 0)).toBe(true);
    expect(pricedTraces.every((trace) => trace.costMicros === (trace.inputTokens ?? 0) * 2 + (trace.outputTokens ?? 0) * 8)).toBe(true);
    expect(run.costMicrosUsed).toBe(traces.reduce((sum, trace) => sum + (trace.costMicros ?? 0), 0));
    expect(await resumeRunnableBuilds(prisma, { workerId: `integration-replay:${suffix}`, maxTasksPerSweep: 100, modelExecutor: executor, judgeExecutor, buildRunIds: [buildRunId], modelPricing: fixturePricing })).toBe(0);
  }, 60_000);

  it('runs a production 85k/32-chapter/104-scene plan through persisted shards and a representative compiled/exported chapter', async () => {
    const builds = new NovelBuildUseCase(prisma);
    const scope: BuildAuthorizationScope = {
      artifactTypes: ['story-brief', 'narrative-contract', 'character-bible', 'relationship-graph', 'world-bible', 'plot-thread', 'act-architecture', 'chapter-brief', 'scene-plan', 'timeline', 'setup-payoff-map', 'research-questions', 'open-questions', 'beat', 'chapter-draft', 'revision-issue', 'finale-plan', 'export-manifest'],
      chapterIds: [], sceneIds: [], allowPlanningArtifacts: true, allowCanonWrites: true,
      allowChapterWrites: true, allowSceneWrites: true, allowDiagnostics: true, expiresAt: null
    };
    const run = await builds.create(userId, projectId, {
      idempotencyKey: `production-scale:${suffix}`,
      brainstorm: 'A full-length causal restoration novel whose 104 scenes each change state and advance the memory price.',
      objective: 'Plan a production-scale novel and prove its durable shards compile into executable scene work.',
      targetWordCount: 85_000, minWordCount: 76_500, maxWordCount: 93_500,
      targetChapterCount: 32, targetSceneCount: 104, targetCharacterCount: 12,
      autonomyMode: 'autonomous-draft', authorizationScope: scope,
      maxTokens: 100_000_000, maxCostMicros: 100_000_000
    });
    const executor = deterministicExecutor(prisma, run.id, { chapters: 32, scenes: 104, characters: 12, targetWords: 85_000 });
    const planningTaskCount = await prisma.buildTask.count({ where: { buildRunId: run.id, phase: { in: ['planning', 'planning-review'] } } });
    expect(planningTaskCount).toBeGreaterThan(20);
    let plannedExecutions = await resumeRunnableBuilds(prisma, {
      workerId: `production-plan:${suffix}`, buildRunIds: [run.id], maxTasksPerSweep: planningTaskCount,
      modelExecutor: executor, judgeExecutor: deterministicJudgeExecutor(), modelPricing: fixturePricing
    });
    for (let continuation = 0; continuation < 10; continuation += 1) {
      const checkpoint = await prisma.buildTask.findUniqueOrThrow({ where: { buildRunId_key: { buildRunId: run.id, key: 'planning-checkpoint' } } });
      if (checkpoint.status === 'DONE') break;
      plannedExecutions += await resumeRunnableBuilds(prisma, {
        workerId: `production-plan-continuation:${suffix}:${continuation}`, buildRunIds: [run.id], maxTasksPerSweep: 1,
        modelExecutor: executor, judgeExecutor: deterministicJudgeExecutor(), modelPricing: fixturePricing
      });
    }
    const planningRun = await prisma.buildRun.findUniqueOrThrow({ where: { id: run.id } });
    const incompletePlanning = await prisma.buildTask.findMany({ where: { buildRunId: run.id, phase: { in: ['planning', 'planning-review'] }, status: { not: 'DONE' } }, select: { key: true, status: true, lastError: true } });
    expect(plannedExecutions, `${planningRun.status}: ${planningRun.lastError ?? ''}\n${incompletePlanning.map((task) => `${task.key}[${task.status}]:${task.lastError ?? ''}`).join('\n')}`).toBeGreaterThanOrEqual(planningTaskCount);
    expect(incompletePlanning).toHaveLength(0);

    const [artifacts, units, planningTasks, allTasks] = await Promise.all([
      prisma.storyArtifact.findMany({ where: { buildRunId: run.id, invalidatedAt: null } }),
      prisma.buildManuscriptUnit.findMany({ where: { buildRunId: run.id } }),
      prisma.buildTask.findMany({ where: { buildRunId: run.id, phase: { in: ['planning', 'planning-review'] } } }),
      prisma.buildTask.findMany({ where: { buildRunId: run.id } })
    ]);
    expect(artifacts.filter((artifact) => artifact.type === 'BEAT')).toHaveLength(104);
    expect(artifacts.filter((artifact) => artifact.type === 'SCENE_PLAN')).toHaveLength(104);
    expect(artifacts.filter((artifact) => artifact.type === 'CHAPTER_BRIEF')).toHaveLength(32);
    expect(units.filter((unit) => unit.kind === 'CHAPTER')).toHaveLength(32);
    expect(units.filter((unit) => unit.kind === 'SCENE')).toHaveLength(104);
    expect(planningTasks.filter((task) => task.type === 'create-beat-shard').length).toBeGreaterThan(1);
    expect(planningTasks.filter((task) => task.type === 'create-scene-plan-shard')).toHaveLength(32);
    expect(planningTasks.find((task) => task.type === 'aggregate-beats')?.status).toBe('DONE');
    expect(planningTasks.find((task) => task.type === 'aggregate-scene-plans')?.status).toBe('DONE');
    expect(allTasks.some((task) => task.key === 'scene:scene-104:checkpoint')).toBe(true);
    const storyState = new StoryStateUseCase(prisma);
    const [scenePageOne, scenePageTwo] = await Promise.all([
      storyState.listArtifacts(userId, projectId, run.id, { types: ['scene-plan'], limit: 60, offset: 0 }),
      storyState.listArtifacts(userId, projectId, run.id, { types: ['scene-plan'], limit: 60, offset: 60 })
    ]);
    expect(scenePageOne.total).toBe(104);
    expect(scenePageOne.items).toHaveLength(60);
    expect(scenePageOne.nextOffset).toBe(60);
    expect(scenePageTwo.items).toHaveLength(44);

    // Scene 1 intentionally fails its first quality gate and reruns revision;
    // that rerun increments downstream revision generations, so scenes 2-4
    // each execute the normal ten-task chain. 14 + 10*3 + compile/checkpoint.
    const representativeTaskCount = 46;
    const representativeExecutions = await resumeRunnableBuilds(prisma, {
      workerId: `production-chapter:${suffix}`, buildRunIds: [run.id], maxTasksPerSweep: representativeTaskCount,
      modelExecutor: executor, judgeExecutor: deterministicJudgeExecutor(), modelPricing: fixturePricing
    });
    const representativeRun = await prisma.buildRun.findUniqueOrThrow({ where: { id: run.id } });
    const representativeFailures = await prisma.buildTask.findMany({ where: { buildRunId: run.id, status: 'FAILED' }, select: { key: true, lastError: true } });
    expect(representativeExecutions, `${representativeRun.status}:${representativeRun.lastError ?? ''}\n${representativeFailures.map((task) => `${task.key}:${task.lastError ?? ''}`).join('\n')}`).toBe(representativeTaskCount);
    const chapterCheckpoint = await prisma.buildTask.findUniqueOrThrow({ where: { buildRunId_key: { buildRunId: run.id, key: 'chapter:chapter-1:checkpoint' } } });
    const representativeKeys = [1, 2, 3, 4, 5].flatMap((scene) => ['context', 'draft', 'canon', 'diagnostics', 'critic', 'revision', 'reextract-canon', 'rerun-diagnostics', 'quality-gate', 'checkpoint'].map((suffix) => `scene:scene-${scene}:${suffix}`));
    const chapterOneTasks = await prisma.buildTask.findMany({ where: { buildRunId: run.id, OR: [{ key: { in: representativeKeys } }, { key: { startsWith: 'chapter:chapter-1:' } }] }, select: { key: true, status: true, attempts: true, revisionIteration: true, lastError: true } });
    expect(chapterCheckpoint.status, chapterOneTasks.map((task) => `${task.key}[${task.status}] a${task.attempts}/r${task.revisionIteration}: ${task.lastError ?? ''}`).join('\n')).toBe('DONE');
    const compilation = await prisma.buildCompilation.findFirstOrThrow({ where: { buildRunId: run.id }, orderBy: { createdAt: 'desc' } });
    expect(compilation.totalWordCount).toBeGreaterThan(1_000);
    const exports = new ProjectExportUseCase(prisma);
    const generated = await exports.create(userId, projectId, {
      idempotencyKey: `production-export:${suffix}`, format: 'text', preset: 'reading-copy',
      target: { kind: 'build', buildRunId: run.id, compilationId: compilation.id }, options: { chapterNumbering: true }
    });
    expect(generated.status).toBe('ready');
    expect(generated.assetId).toBeTruthy();
    expect(await prisma.storyArtifact.count({ where: { buildRunId: run.id, type: 'EXPORT_MANIFEST', invalidatedAt: null } })).toBe(1);
    await exports.delete(userId, projectId, generated.id);
  }, 120_000);

  it('pauses before a priced task can exceed the authorized cost ceiling', async () => {
    const expensiveRun = await createBudgetRun(prisma, projectId, userId, suffix, 'priced/model', 1);
    const executor = vi.fn<BuildModelExecutor>(async () => { throw new Error('executor must not run past preflight budget gate'); });
    const executed = await resumeRunnableBuilds(prisma, {
      workerId: `integration-budget:${suffix}`,
      buildRunIds: [expensiveRun.id],
      maxTasksPerSweep: 2,
      modelExecutor: executor,
      modelPricing: {
        'priced/model': { inputMicrosPerMillion: 1_000, outputMicrosPerMillion: 1_000, source: 'integration fixture', version: '1' }
      }
    });
    const [run, task] = await Promise.all([
      prisma.buildRun.findUniqueOrThrow({ where: { id: expensiveRun.id } }),
      prisma.buildTask.findFirstOrThrow({ where: { buildRunId: expensiveRun.id } })
    ]);
    expect(executed).toBe(0);
    expect(executor).not.toHaveBeenCalled();
    expect(run.status).toBe('PAUSED');
    expect(run.lastError).toContain('maximum authorized task cost');
    expect(task.status).toBe('READY');
    expect(task.attempts).toBe(0);
  });

  it('pauses a cost-bounded run when model pricing is unknown', async () => {
    const unknownRun = await createBudgetRun(prisma, projectId, userId, `${suffix}-unknown`, 'unknown/model', 1_000_000);
    const executor = vi.fn<BuildModelExecutor>(async () => { throw new Error('unknown-price executor must not run'); });
    await resumeRunnableBuilds(prisma, {
      workerId: `integration-unknown-price:${suffix}`,
      buildRunIds: [unknownRun.id],
      maxTasksPerSweep: 2,
      modelExecutor: executor,
      modelPricing: {}
    });
    const run = await prisma.buildRun.findUniqueOrThrow({ where: { id: unknownRun.id } });
    expect(executor).not.toHaveBeenCalled();
    expect(run.status).toBe('PAUSED');
    expect(run.lastError).toContain('pricing is unknown');
    expect(run.lastError).toContain('AI_MODEL_PRICING_JSON');
  });

  it('fences a late manuscript write and waits for the aborted execution to quiesce before pause returns', async () => {
    const fixture = await createIsolatedSceneRun(prisma, projectId, userId, `${suffix}-late-pause`);
    let signalStarted!: () => void;
    const started = new Promise<void>((resolve) => { signalStarted = resolve; });
    let lateWriteError: unknown;
    const executor: BuildModelExecutor = async (input) => {
      signalStarted();
      if (!input.abortSignal.aborted) await new Promise<void>((resolve) => input.abortSignal.addEventListener('abort', () => resolve(), { once: true }));
      try {
        await invokeWorkerTool(input, 'applyBuildUnitPatch', {
          buildRunId: fixture.run.id,
          taskId: input.contract.scope.buildTaskId,
          unitId: fixture.sceneUnit.id,
          idempotencyKey: `forbidden-late-write:${fixture.run.id}`,
          expectedUnitRevision: fixture.sceneUnit.revision,
          expectedHeadVersionId: fixture.sceneUnit.branch.headVersionId,
          body: 'THIS LATE WRITE MUST NEVER COMMIT'
        });
      } catch (error) {
        lateWriteError = error;
      }
      throw input.abortSignal.reason ?? new Error('paused');
    };
    const work = resumeRunnableBuilds(prisma, { workerId: `late-pause:${suffix}`, buildRunIds: [fixture.run.id], maxTasksPerSweep: 1, modelExecutor: executor, modelPricing: fixturePricing });
    await started;
    const running = await prisma.buildRun.findUniqueOrThrow({ where: { id: fixture.run.id } });
    const paused = await new NovelBuildUseCase(prisma).pause(userId, projectId, fixture.run.id, { idempotencyKey: `pause:${fixture.run.id}`, expectedRevision: running.revision, reason: 'Adversarial pause' });
    await work;

    const [unit, task, versions, traces] = await Promise.all([
      prisma.buildManuscriptUnit.findUniqueOrThrow({ where: { id: fixture.sceneUnit.id }, include: { branch: { include: { headVersion: true } } } }),
      prisma.buildTask.findUniqueOrThrow({ where: { id: fixture.task.id } }),
      prisma.writingVersion.findMany({ where: { branchId: fixture.sceneUnit.branchId } }),
      prisma.buildTrace.findMany({ where: { buildRunId: fixture.run.id } })
    ]);
    expect(paused.status).toBe('paused');
    expect(task.status).toBe('READY');
    expect(unit.branch.headVersion?.body).toBe(fixture.initialBody);
    expect(versions).toHaveLength(1);
    expect(String(lateWriteError)).toMatch(/interrupted|pause|abort/i);
    expect(traces).toHaveLength(1);
    expect(traces[0].status).toBe('FAILED');
    expect(traces[0].completionState).toBe('interrupted');
  }, 15_000);

  it('recovers a dead lease/STARTED trace and lets two workers produce exactly one fenced output', async () => {
    const fixture = await createIsolatedSceneRun(prisma, projectId, userId, `${suffix}-crash`, { maxAttempts: 3 });
    const builds = new NovelBuildUseCase(prisma);
    const claimed = await builds.claim(userId, projectId, fixture.run.id, {
      idempotencyKey: `dead-claim:${fixture.run.id}`,
      workerId: `dead-worker:${suffix}`,
      leaseMs: 30_000,
      reserveTokens: 2_000,
      reserveCostMicros: 20_000
    });
    if (!claimed?.lease) throw new Error('Dead-worker fixture was not claimed');
    const deadLease = claimed.lease;
    await new StoryStateUseCase(prisma).startTrace(userId, projectId, fixture.run.id, deadLease, {
      taskId: fixture.task.id,
      idempotencyKey: `dead-trace:${fixture.run.id}`,
      attempt: 1,
      provider: 'fixture',
      model: 'priced/model',
      modelParameters: {},
      workflowVersion: 'novel-build-v1',
      systemPromptVersion: 'layered-v1',
      skillVersions: { 'novel-build': '1.1.0', 'novel-chapters': '2.0.0' },
      toolSchemaVersions: { buildWorkflow: 2 },
      inputs: {},
      retrievedArtifactIds: [],
      contextTokenCount: 0,
      startedAt: new Date(Date.now() - 60_000).toISOString()
    });
    await prisma.buildTask.update({ where: { id: fixture.task.id }, data: { leaseExpiresAt: new Date(Date.now() - 1_000), heartbeatAt: new Date(Date.now() - 60_000) } });

    let executions = 0;
    const executor: BuildModelExecutor = async (input) => {
      executions += 1;
      const unit = await prisma.buildManuscriptUnit.findUniqueOrThrow({ where: { id: fixture.sceneUnit.id }, include: { branch: true } });
      await invokeWorkerTool(input, 'applyBuildUnitPatch', {
        buildRunId: fixture.run.id,
        taskId: input.contract.scope.buildTaskId,
        unitId: unit.id,
        idempotencyKey: `recovered-output:${fixture.run.id}:${input.contract.metadata.attempt}`,
        expectedUnitRevision: unit.revision,
        expectedHeadVersionId: unit.branch.headVersionId,
        body: 'Exactly one recovered worker output.'
      });
      return workerSuccess(120, 40);
    };
    await Promise.all([
      resumeRunnableBuilds(prisma, { workerId: `recover-a:${suffix}`, buildRunIds: [fixture.run.id], maxTasksPerSweep: 1, modelExecutor: executor, modelPricing: fixturePricing }),
      resumeRunnableBuilds(prisma, { workerId: `recover-b:${suffix}`, buildRunIds: [fixture.run.id], maxTasksPerSweep: 1, modelExecutor: executor, modelPricing: fixturePricing })
    ]);

    const [unit, task, run, versions, traces] = await Promise.all([
      prisma.buildManuscriptUnit.findUniqueOrThrow({ where: { id: fixture.sceneUnit.id }, include: { branch: { include: { headVersion: true } } } }),
      prisma.buildTask.findUniqueOrThrow({ where: { id: fixture.task.id } }),
      prisma.buildRun.findUniqueOrThrow({ where: { id: fixture.run.id } }),
      prisma.writingVersion.findMany({ where: { branchId: fixture.sceneUnit.branchId }, orderBy: { createdAt: 'asc' } }),
      prisma.buildTrace.findMany({ where: { buildRunId: fixture.run.id }, orderBy: { startedAt: 'asc' } })
    ]);
    expect(executions).toBe(1);
    expect(task.attempts).toBe(2);
    expect(task.status).toBe('DONE');
    expect(unit.branch.headVersion?.body).toBe('Exactly one recovered worker output.');
    expect(versions).toHaveLength(2);
    expect(traces).toHaveLength(2);
    expect(traces[0].status).toBe('FAILED');
    expect(traces[1].status).toBe('COMPLETED');

    await expect(new BuildManuscriptUseCase(prisma).patch(userId, projectId, fixture.run.id, fixture.sceneUnit.id, {
      idempotencyKey: `stale-dead-worker:${fixture.run.id}`,
      expectedBuildRevision: run.revision,
      expectedUnitRevision: unit.revision,
      expectedHeadVersionId: unit.branch.headVersionId,
      lease: deadLease,
      body: 'A stale process must not overwrite the recovered output.'
    })).rejects.toThrow(/stale|fenced|leased|completed/i);
    expect(await prisma.writingVersion.count({ where: { branchId: fixture.sceneUnit.branchId } })).toBe(2);
  });

  it('rejects a no-op revision even when the candidate reports perfect checks and quality', async () => {
    const fixture = await createIsolatedSceneRun(prisma, projectId, userId, `${suffix}-noop`, {
      taskType: 'finalization', assignedAgent: 'reviser', acceptanceCriteria: { finalManuscriptRequired: true },
      skillVersions: { 'novel-build': '1.1.0', 'novel-finalization': '1.0.0' }, maxAttempts: 1, maxRevisionIterations: 0
    });
    await resumeRunnableBuilds(prisma, {
      workerId: `noop:${suffix}`, buildRunIds: [fixture.run.id], maxTasksPerSweep: 1,
      modelExecutor: async () => workerSuccess(100, 25), modelPricing: fixturePricing
    });
    const [run, task, unit, evaluations] = await Promise.all([
      prisma.buildRun.findUniqueOrThrow({ where: { id: fixture.run.id } }),
      prisma.buildTask.findUniqueOrThrow({ where: { id: fixture.task.id } }),
      prisma.buildManuscriptUnit.findUniqueOrThrow({ where: { id: fixture.sceneUnit.id }, include: { branch: true } }),
      prisma.buildEvaluationResult.findMany({ where: { buildRunId: fixture.run.id } })
    ]);
    expect(run.status).toBe('FAILED');
    expect(task.status).toBe('FAILED');
    expect(unit.branch.headVersionId).toBe(fixture.sceneUnit.branch.headVersionId);
    expect(evaluations.some((evaluation) => evaluation.kind === 'DETERMINISTIC' && !evaluation.passed)).toBe(true);

    const lineFixture = await createIsolatedSceneRun(prisma, projectId, userId, `${suffix}-noop-line`, {
      taskType: 'line-edit', assignedAgent: 'reviser', acceptanceCriteria: {},
      skillVersions: { 'novel-build': '1.1.0', 'novel-line-revision': '1.0.0' }, maxAttempts: 1, maxRevisionIterations: 0
    });
    await resumeRunnableBuilds(prisma, {
      workerId: `noop-line:${suffix}`, buildRunIds: [lineFixture.run.id], maxTasksPerSweep: 1,
      modelExecutor: async () => workerSuccess(100, 25), modelPricing: fixturePricing
    });
    expect((await prisma.buildTask.findUniqueOrThrow({ where: { id: lineFixture.task.id } })).status).toBe('FAILED');
  });

  it('pins exact skill provenance and rejects same-version override content changes before another attempt', async () => {
    const fixture = await createIsolatedSceneRun(prisma, projectId, userId, `${suffix}-skill-pin`, { maxAttempts: 2 });
    await resumeRunnableBuilds(prisma, {
      workerId: `skill-pin-first:${suffix}`, buildRunIds: [fixture.run.id], maxTasksPerSweep: 1,
      modelExecutor: async () => { throw new Error('First attempt establishes immutable provenance'); }, modelPricing: fixturePricing
    });
    const pinned = await prisma.buildTask.findUniqueOrThrow({ where: { id: fixture.task.id } });
    const pinnedPolicy = pinned.executionPolicy as Record<string, unknown>;
    expect(Array.isArray(pinnedPolicy.skillProvenance)).toBe(true);
    expect(JSON.stringify(pinnedPolicy.skillProvenance)).toContain('contentHash');
    const novelBuildPin = (pinnedPolicy.skillProvenance as Array<Record<string, unknown>>).find((pin) => pin.name === 'novel-build');
    expect(novelBuildPin?.references).toEqual([{ name: 'references/runtime-boundaries.md', contentHash: expect.stringMatching(/^[a-f0-9]{64}$/) }]);
    const overrideContent = [
      '---', 'name: novel-chapters', 'version: 2.0.0', 'kind: drafting',
      'runtimeRoles: ["drafter", "reviser"]',
      'allowedTools: ["readBuildUnit", "applyBuildUnitPatch"]',
      'context: {"maxTokens":24000,"sections":["active-task","recent-causal","canon"]}',
      'procedure: ["Changed same-version project procedure."]', '---',
      'This content changed without a version bump and must be rejected.'
    ].join('\n');
    await prisma.projectAiSkill.create({ data: { projectId, name: 'novel-chapters', description: 'Changed same-version override', content: overrideContent, enabled: true } });
    try {
      const executor = vi.fn<BuildModelExecutor>(async () => workerSuccess(10, 10));
      expect(await resumeRunnableBuilds(prisma, {
        workerId: `skill-pin-second:${suffix}`, buildRunIds: [fixture.run.id], maxTasksPerSweep: 1,
        modelExecutor: executor, modelPricing: fixturePricing
      })).toBe(0);
      const [run, after, trace] = await Promise.all([
        prisma.buildRun.findUniqueOrThrow({ where: { id: fixture.run.id } }),
        prisma.buildTask.findUniqueOrThrow({ where: { id: fixture.task.id } }),
        prisma.buildTrace.findFirstOrThrow({ where: { buildRunId: fixture.run.id } })
      ]);
      expect(executor).not.toHaveBeenCalled();
      expect(run.status).toBe('PAUSED');
      expect(run.lastError).toContain('publish a new skill version');
      expect(after.attempts).toBe(1);
      expect(JSON.stringify(trace.skillVersions)).toContain('manifestHash');
    } finally {
      await prisma.projectAiSkill.deleteMany({ where: { projectId, name: 'novel-chapters' } });
    }
  });

  it('persists actual usage and atomically pauses/fences an output-token overrun', async () => {
    const fixture = await createIsolatedSceneRun(prisma, projectId, userId, `${suffix}-overrun`, { maxTokens: 25_000 });
    await resumeRunnableBuilds(prisma, {
      workerId: `overrun:${suffix}`, buildRunIds: [fixture.run.id], maxTasksPerSweep: 1,
      modelExecutor: async (input) => {
        const unit = await prisma.buildManuscriptUnit.findUniqueOrThrow({ where: { id: fixture.sceneUnit.id }, include: { branch: true } });
        await invokeWorkerTool(input, 'applyBuildUnitPatch', {
          buildRunId: fixture.run.id, taskId: input.contract.scope.buildTaskId, unitId: unit.id,
          idempotencyKey: `overrun-write:${fixture.run.id}`,
          expectedUnitRevision: unit.revision, expectedHeadVersionId: unit.branch.headVersionId,
          body: 'This over-budget attempt body must be compensated.'
        });
        return workerSuccess(26_000, 1_000);
      }, modelPricing: fixturePricing
    });
    const [run, task, trace, unitAfter] = await Promise.all([
      prisma.buildRun.findUniqueOrThrow({ where: { id: fixture.run.id } }),
      prisma.buildTask.findUniqueOrThrow({ where: { id: fixture.task.id } }),
      prisma.buildTrace.findFirstOrThrow({ where: { buildRunId: fixture.run.id } }),
      prisma.buildManuscriptUnit.findUniqueOrThrow({ where: { id: fixture.sceneUnit.id }, include: { branch: { include: { headVersion: true } } } })
    ]);
    expect(run.status).toBe('PAUSED');
    expect(run.tokensUsed).toBe(27_000);
    expect(run.lastError).toContain('budget exceeded');
    expect(task.status).toBe('FAILED');
    expect(task.leaseOwner).toBeNull();
    expect(trace.inputTokens).toBe(26_000);
    expect(trace.outputTokens).toBe(1_000);
    expect(trace.costMicros).toBeGreaterThan(0);
    expect(unitAfter.branch.headVersion?.body).toBe(fixture.initialBody);
  }, 15_000);

  it('hard-times out executors and judges that ignore AbortSignal without hanging runNow', async () => {
    const executorFixture = await createIsolatedSceneRun(prisma, projectId, userId, `${suffix}-hung-executor`, { maxAttempts: 1, maxDurationMs: 1_000 });
    const executorStarted = Date.now();
    await resumeRunnableBuilds(prisma, {
      workerId: `hung-executor:${suffix}`, buildRunIds: [executorFixture.run.id], maxTasksPerSweep: 1,
      modelExecutor: async () => new Promise(() => undefined), modelPricing: fixturePricing
    });
    expect(Date.now() - executorStarted).toBeLessThan(3_000);
    const [executorTask, executorTrace] = await Promise.all([
      prisma.buildTask.findUniqueOrThrow({ where: { id: executorFixture.task.id } }),
      prisma.buildTrace.findFirstOrThrow({ where: { buildRunId: executorFixture.run.id } })
    ]);
    expect(executorTask.status).toBe('FAILED');
    expect(executorTrace.status).toBe('FAILED');
    expect(executorTrace.error).toContain('maxDurationMs');

    const judgeFixture = await createIsolatedSceneRun(prisma, projectId, userId, `${suffix}-hung-judge`, {
      taskType: 'critique-scene', assignedAgent: 'critic', acceptanceCriteria: { rubric: 'scene-quality-v1' },
      skillVersions: { 'novel-build': '1.1.0', 'novel-critic': '2.0.0' }, qualityThreshold: 0.8,
      maxAttempts: 1, maxDurationMs: 1_000
    });
    const judgeStarted = Date.now();
    await resumeRunnableBuilds(prisma, {
      workerId: `hung-judge:${suffix}`, buildRunIds: [judgeFixture.run.id], maxTasksPerSweep: 1,
      modelExecutor: async (input) => {
        await invokeWorkerTool(input, 'runStoryLint', { buildRunId: judgeFixture.run.id });
        return workerSuccess(100, 25);
      },
      judgeExecutor: async () => new Promise(() => undefined),
      modelPricing: fixturePricing
    });
    expect(Date.now() - judgeStarted).toBeLessThan(3_000);
    const [judgeTask, judgeTrace] = await Promise.all([
      prisma.buildTask.findUniqueOrThrow({ where: { id: judgeFixture.task.id } }),
      prisma.buildTrace.findFirstOrThrow({ where: { buildRunId: judgeFixture.run.id } })
    ]);
    expect(judgeTask.status).toBe('FAILED');
    expect(judgeTrace.status).toBe('FAILED');
    expect(judgeTrace.error).toContain('maxDurationMs');
  }, 10_000);

  it('pessimistically settles priced failures with omitted usage so retries cannot bypass the budget', async () => {
    const fixture = await createIsolatedSceneRun(prisma, projectId, userId, `${suffix}-omitted-usage`, { maxAttempts: 2, maxTokens: 100_000 });
    await resumeRunnableBuilds(prisma, {
      workerId: `omitted-usage:${suffix}`, buildRunIds: [fixture.run.id], maxTasksPerSweep: 2,
      modelExecutor: async (input) => {
        const unit = await prisma.buildManuscriptUnit.findUniqueOrThrow({ where: { id: fixture.sceneUnit.id }, include: { branch: true } });
        await invokeWorkerTool(input, 'applyBuildUnitPatch', {
          buildRunId: fixture.run.id, taskId: input.contract.scope.buildTaskId, unitId: unit.id,
          idempotencyKey: `failed-billed-write:${fixture.run.id}:${input.contract.metadata.attempt}`,
          expectedUnitRevision: unit.revision, expectedHeadVersionId: unit.branch.headVersionId,
          body: 'This failed billed attempt must never survive.'
        });
        throw new Error('Provider disconnected after accepting the billed request');
      },
      modelPricing: fixturePricing
    });
    const [run, task, traces, unitAfter] = await Promise.all([
      prisma.buildRun.findUniqueOrThrow({ where: { id: fixture.run.id } }),
      prisma.buildTask.findUniqueOrThrow({ where: { id: fixture.task.id } }),
      prisma.buildTrace.findMany({ where: { buildRunId: fixture.run.id }, orderBy: { attempt: 'asc' } }),
      prisma.buildManuscriptUnit.findUniqueOrThrow({ where: { id: fixture.sceneUnit.id }, include: { branch: { include: { headVersion: true } } } })
    ]);
    expect(task.status).toBe('FAILED');
    expect(traces).toHaveLength(2);
    expect(traces.every((trace) => (trace.inputTokens ?? 0) > 0 && (trace.costMicros ?? 0) > 0)).toBe(true);
    expect(run.tokensUsed).toBe(traces.reduce((sum, trace) => sum + (trace.inputTokens ?? 0) + (trace.outputTokens ?? 0), 0));
    expect(run.costMicrosUsed).toBe(traces.reduce((sum, trace) => sum + (trace.costMicros ?? 0), 0));
    expect(run.tokensUsed).toBeGreaterThanOrEqual(50_000);
    expect(unitAfter.branch.headVersion?.body).toBe(fixture.initialBody);
  });

  it('compensates failed-attempt artifacts and canon so no active partial state survives', async () => {
    const artifactRun = await createBudgetRun(prisma, projectId, userId, `${suffix}-artifact-compensation`, 'priced/model', 1_000_000);
    await prisma.buildTask.updateMany({ where: { buildRunId: artifactRun.id }, data: { executionPolicy: { model: 'priced/model', maxInputTokens: 24_000, maxOutputTokens: 1_000 } } });
    let artifactMutationCompleted = false;
    await resumeRunnableBuilds(prisma, {
      workerId: `artifact-compensation:${suffix}`, buildRunIds: [artifactRun.id], maxTasksPerSweep: 1, modelPricing: fixturePricing,
      modelExecutor: async (input) => {
        await invokeWorkerTool(input, 'applyArtifactBatch', {
          buildRunId: artifactRun.id, taskId: input.contract.scope.buildTaskId, idempotencyKey: `partial-artifact:${artifactRun.id}`,
          operations: [{ action: 'upsert', type: 'story-brief', key: 'partial-brief', title: 'Partial Brief', schemaVersion: 'story-ir-v1', status: 'VALIDATED', content: { premise: 'This partial artifact must be invalidated.', genre: 'fantasy', tone: [], promises: [], constraints: [], targetWordCount: 1_000, minWordCount: 1_000, maxWordCount: 1_000, targetChapterCount: 1, targetSceneCount: 1, targetCharacterCount: 1 } }]
        });
        artifactMutationCompleted = true;
        throw new Error('Provider failed after artifact mutation');
      }
    });
    const artifactTask = await prisma.buildTask.findFirstOrThrow({ where: { buildRunId: artifactRun.id } });
    expect(artifactMutationCompleted, artifactTask.lastError ?? 'artifact tool did not complete').toBe(true);
    const compensatedArtifacts = await prisma.storyArtifact.findMany({ where: { buildRunId: artifactRun.id }, select: { id: true, taskId: true, status: true, invalidatedAt: true } });
    expect(compensatedArtifacts.filter((artifact) => artifact.invalidatedAt === null)).toHaveLength(0);
    expect(compensatedArtifacts, JSON.stringify(compensatedArtifacts)).toHaveLength(1);
    expect(compensatedArtifacts[0].status).toBe('INVALIDATED');

    const canonFixture = await createIsolatedSceneRun(prisma, projectId, userId, `${suffix}-canon-compensation`, {
      taskType: 'extract-scene-canon', assignedAgent: 'librarian', acceptanceCriteria: { canonDeltaRequired: true },
      skillVersions: { 'novel-build': '1.1.0', 'novel-continuity': '1.1.0' }, maxAttempts: 1
    });
    await resumeRunnableBuilds(prisma, {
      workerId: `canon-compensation:${suffix}`, buildRunIds: [canonFixture.run.id], maxTasksPerSweep: 1, modelPricing: fixturePricing,
      modelExecutor: async (input) => {
        await invokeWorkerTool(input, 'commitCanonDelta', {
          buildRunId: canonFixture.run.id, taskId: input.contract.scope.buildTaskId, sourceUnitId: canonFixture.sceneUnit.id,
          idempotencyKey: `partial-canon:${canonFixture.run.id}`,
          facts: [{ key: 'partial-fact', subjectType: 'character', subjectId: 'mara', predicate: 'knows', object: true, status: 'CANONICAL', validFromOrder: 1, confidence: 1 }]
        });
        throw new Error('Provider failed after canon mutation');
      }
    });
    expect(await prisma.canonFact.count({ where: { buildRunId: canonFixture.run.id, isCurrent: true, invalidatedAt: null } })).toBe(0);
    expect(await prisma.canonFact.count({ where: { buildRunId: canonFixture.run.id, status: 'INVALIDATED' } })).toBe(1);
  });

  it('rejects a forged artifact type and a scene canon delta without assigned-unit provenance', async () => {
    const forged = await createBudgetRun(prisma, projectId, userId, `${suffix}-forged`, 'priced/model', 1_000_000);
    await resumeRunnableBuilds(prisma, {
      workerId: `forged:${suffix}`, buildRunIds: [forged.id], maxTasksPerSweep: 1, modelPricing: fixturePricing,
      modelExecutor: async (input) => {
        await invokeWorkerTool(input, 'applyArtifactBatch', {
          buildRunId: forged.id, taskId: input.contract.scope.buildTaskId, idempotencyKey: `forged:${forged.id}`,
          operations: [{ action: 'upsert', type: 'world-bible', key: 'forged-world', title: 'Forged World', schemaVersion: 'story-ir-v1', status: 'VALIDATED', content: { rules: [], institutions: [], geography: [], factions: [], terminology: [], technologyOrMagicConstraints: [] } }]
        });
        return workerSuccess(50, 20);
      }
    });
    expect(await prisma.storyArtifact.count({ where: { buildRunId: forged.id } })).toBe(0);
    expect((await prisma.buildTask.findFirstOrThrow({ where: { buildRunId: forged.id } })).status).toBe('FAILED');

    const canonFixture = await createIsolatedSceneRun(prisma, projectId, userId, `${suffix}-global-canon`, {
      taskType: 'extract-scene-canon', assignedAgent: 'librarian', acceptanceCriteria: { canonDeltaRequired: true },
      skillVersions: { 'novel-build': '1.1.0', 'novel-continuity': '1.1.0' }, maxAttempts: 1
    });
    await resumeRunnableBuilds(prisma, {
      workerId: `global-canon:${suffix}`, buildRunIds: [canonFixture.run.id], maxTasksPerSweep: 1, modelPricing: fixturePricing,
      modelExecutor: async (input) => {
        await invokeWorkerTool(input, 'commitCanonDelta', {
          buildRunId: canonFixture.run.id, taskId: input.contract.scope.buildTaskId, idempotencyKey: `global-canon:${canonFixture.run.id}`,
          facts: [{ key: 'unscoped-fact', subjectType: 'character', subjectId: 'mara', predicate: 'knows', object: true, status: 'CANONICAL', confidence: 1 }]
        });
        return workerSuccess(50, 20);
      }
    });
    expect(await prisma.canonFact.count({ where: { buildRunId: canonFixture.run.id } })).toBe(0);
    expect((await prisma.buildTask.findUniqueOrThrow({ where: { id: canonFixture.task.id } })).status).toBe('FAILED');
  });

  it('keeps search on the isolated build branch and clamps canon/entity/timeline reads before future state', async () => {
    const buildNeedle = `BUILD_ONLY_${suffix}`;
    const mainNeedle = `MAIN_ONLY_${suffix}`;
    const referenceLabel = `Late Reference ${suffix}`;
    const buildBody = `${'Opening build context '.repeat(20)}${buildNeedle} and then much later ${referenceLabel} closes the scene.`;
    const fixture = await createIsolatedSceneRun(prisma, projectId, userId, `${suffix}-temporal-search`, { initialBody: buildBody });
    const referenceArtifact = await prisma.storyArtifact.create({ data: {
      projectId, buildRunId: fixture.run.id, type: 'CHARACTER_BIBLE', key: `late-reference-${suffix}`, title: referenceLabel,
      schemaVersion: 'story-ir-v1', status: 'VALIDATED', contentHash: `late-reference-hash-${suffix}`,
      content: { characterKey: `late-reference-${suffix}`, name: referenceLabel, aliases: [], role: 'reference', wants: [], needs: [], contradictions: [], knowledge: [], secrets: [], relationships: [] }
    } });
    await createCanonicalChapter(prisma, projectId, userId, mainNeedle);
    const state = new StoryStateUseCase(prisma);
    const buildHit = await state.search(userId, projectId, fixture.run.id, { query: buildNeedle, strategy: 'exact', limit: 20 });
    const hiddenMain = await state.search(userId, projectId, fixture.run.id, { query: mainNeedle, strategy: 'exact', limit: 20 });
    const references = await state.findReferences(userId, projectId, fixture.run.id, { refType: 'artifact', refId: referenceArtifact.id, limit: 20 });
    const scopedHit = buildHit.hits.find((hit) => hit.kind === 'build-unit' && hit.id === fixture.sceneUnit.id);
    expect(scopedHit).toBeDefined();
    expect(scopedHit?.sourceSpan).toEqual(expect.objectContaining({
      unitId: fixture.sceneUnit.id,
      branchId: fixture.sceneUnit.branchId,
      writingVersionId: fixture.sceneUnit.branch.headVersionId,
      start: buildBody.indexOf(buildNeedle),
      end: buildBody.indexOf(buildNeedle) + buildNeedle.length
    }));
    expect(hiddenMain.hits).toHaveLength(0);
    const proseReference = references.hits.find((hit) => hit.kind === 'build-unit' && hit.id === fixture.sceneUnit.id);
    expect(proseReference?.sourceSpan).toEqual(expect.objectContaining({
      start: buildBody.indexOf(referenceLabel),
      end: buildBody.indexOf(referenceLabel) + referenceLabel.length
    }));

    const currentRun = await prisma.buildRun.findUniqueOrThrow({ where: { id: fixture.run.id } });
    await state.applyStateBatch(userId, projectId, fixture.run.id, {
      idempotencyKey: `temporal-ledger:${fixture.run.id}`,
      expectedBuildRevision: currentRun.revision,
      operations: [
        { op: 'upsert-canon-fact', value: { sourceArtifactId: null, key: 'past-fact', subjectType: 'character', subjectId: 'mara', predicate: 'door-state', object: 'closed', status: 'canonical', validFromSceneId: null, validToSceneId: null, validFromOrder: 1, validToOrder: 1, sourceChapterId: null, sourceSceneId: null, sourceSpan: null, confidence: 1 } },
        { op: 'upsert-canon-fact', value: { sourceArtifactId: null, key: 'future-fact', subjectType: 'character', subjectId: 'mara', predicate: 'door-state', object: 'open', status: 'canonical', validFromSceneId: null, validToSceneId: null, validFromOrder: 2, validToOrder: null, sourceChapterId: null, sourceSceneId: null, sourceSpan: null, confidence: 1 } },
        { op: 'upsert-entity-state', value: { sourceArtifactId: null, sourceFactId: null, key: 'past-state', entityType: 'character', entityId: 'mara', stateKey: 'door-state', value: 'closed', status: 'active', validFromSceneId: null, validToSceneId: null, validFromOrder: 1, validToOrder: 1, storyOrder: 1, sourceSpan: null } },
        { op: 'upsert-entity-state', value: { sourceArtifactId: null, sourceFactId: null, key: 'future-state', entityType: 'character', entityId: 'mara', stateKey: 'door-state', value: 'open', status: 'active', validFromSceneId: null, validToSceneId: null, validFromOrder: 2, validToOrder: null, storyOrder: 2, sourceSpan: null } },
        { op: 'upsert-timeline-event', value: { sourceArtifactId: null, key: 'past-event', title: 'Past event', description: null, chronology: { order: 1 }, sortOrder: 1, chapterId: null, sceneId: null, dependencyIds: [], participantRefs: [], sourceSpan: null } },
        { op: 'upsert-timeline-event', value: { sourceArtifactId: null, key: 'future-event', title: 'Future secret', description: null, chronology: { order: 2 }, sortOrder: 2, chapterId: null, sceneId: null, dependencyIds: ['past-event'], participantRefs: [], sourceSpan: null } }
      ]
    });
    const contract = taskContractSchema.parse({
      objective: 'Read state only through the assigned scene',
      outputs: [{ type: 'task-result', name: 'temporal-read' }],
      acceptanceCriteria: [{ id: 'bounded', description: 'Future state is hidden' }],
      scope: { buildRunId: fixture.run.id, buildTaskId: fixture.task.id, manuscriptUnitIds: [fixture.sceneUnit.id] },
      metadata: { targetStoryOrder: 1 }
    });
    const tools = storyIntelligenceTools(prisma, { projectId, userId }, { handleApproval: async (_name, _input, execute) => execute() }, contract, null);
    const scopedSearch = await invokeToolMap(tools as unknown as Record<string, unknown>, 'searchStory', { buildRunId: fixture.run.id, query: buildNeedle, exact: true, limit: 20 }) as { hits: Array<{ id: string; sourceSpan: { start?: number; end?: number } }> };
    const canonResult = await invokeToolMap(tools, 'queryCanon', { buildRunId: fixture.run.id, subjectId: 'mara', predicate: 'door-state', atOrder: 999, limit: 20 }) as { storyOrder: number; items: Array<{ key: string }> };
    const entityResult = await invokeToolMap(tools, 'queryEntityState', { buildRunId: fixture.run.id, entityType: 'character', entityId: 'mara', stateKey: 'door-state', atStoryOrder: 999, limit: 20 }) as { storyOrder: number; entityStates: Array<{ key: string }> };
    const timelineResult = await invokeToolMap(tools, 'queryTimeline', { buildRunId: fixture.run.id, toOrder: 999, limit: 20 }) as { storyOrder: number; items: Array<{ key: string }> };
    expect(canonResult.storyOrder).toBe(1);
    expect(canonResult.items.map((item) => item.key)).toEqual(['past-fact']);
    expect(entityResult.storyOrder).toBe(1);
    expect(entityResult.entityStates.map((item) => item.key)).toEqual(['past-state']);
    expect(timelineResult.storyOrder).toBe(1);
    expect(timelineResult.items.map((item) => item.key)).toEqual(['past-event']);
    expect(scopedSearch.hits.find((hit) => hit.id === fixture.sceneUnit.id)?.sourceSpan).toEqual(expect.objectContaining({ start: buildBody.indexOf(buildNeedle), end: buildBody.indexOf(buildNeedle) + buildNeedle.length }));
  });
});

interface IsolatedRunOptions {
  taskType?: string;
  assignedAgent?: string;
  acceptanceCriteria?: Record<string, unknown>;
  skillVersions?: Record<string, string>;
  maxAttempts?: number;
  maxRevisionIterations?: number;
  maxTokens?: number;
  initialBody?: string;
  maxDurationMs?: number;
  qualityThreshold?: number;
}

async function createIsolatedSceneRun(
  prisma: PrismaClient,
  projectId: string,
  userId: string,
  key: string,
  options: IsolatedRunOptions = {}
) {
  const run = await prisma.buildRun.create({
    data: {
      projectId,
      createdById: userId,
      authorizedById: userId,
      objective: `Adversarial worker fixture ${key}`,
      brainstorm: 'A bounded adversarial worker fixture.',
      idempotencyKey: `isolated:${key}`,
      manifest: { version: 'novel-build-v1', target: { targetChapterCount: 1, targetSceneCount: 1 }, artifactSpecs: [] },
      autonomyMode: 'AUTONOMOUS_DRAFT',
      status: 'DRAFTING',
      currentPhase: 'drafting',
      workflowVersion: 'novel-build-v1',
      branchName: `ai/isolated-${key}`,
      authorizationScope: {
        artifactTypes: ['chapter-draft', 'revision-issue'], chapterIds: [], sceneIds: [], allowPlanningArtifacts: true,
        allowCanonWrites: true, allowChapterWrites: true, allowSceneWrites: true, allowDiagnostics: true, expiresAt: null
      },
      maxTokens: options.maxTokens ?? 100_000,
      maxCostMicros: 1_000_000,
      authorizedAt: new Date()
    }
  });
  const chapterWriting = await prisma.writing.create({ data: { projectId, kind: 'CHAPTER_BODY' } });
  const chapterBranch = await prisma.writingBranch.create({ data: { writingId: chapterWriting.id, buildRunId: run.id, name: `${run.branchName}/chapter` } });
  const chapterUnit = await prisma.buildManuscriptUnit.create({
    data: {
      projectId, buildRunId: run.id, writingId: chapterWriting.id, branchId: chapterBranch.id, kind: 'CHAPTER', status: 'PLANNED',
      key: 'chapter-fixture', containerKey: '__manuscript__', order: 0, chapterNumber: 1, title: 'Fixture Chapter', metadata: {}
    }
  });
  const sceneWriting = await prisma.writing.create({ data: { projectId, kind: 'SCENE_BODY' } });
  const sceneBranch = await prisma.writingBranch.create({ data: { writingId: sceneWriting.id, buildRunId: run.id, name: `${run.branchName}/scene` } });
  const initialBody = options.initialBody ?? 'Original isolated scene body.';
  const initialVersion = await prisma.writingVersion.create({ data: { branchId: sceneBranch.id, body: initialBody, wordCount: initialBody.split(/\s+/).length, authorId: userId, message: 'Adversarial fixture baseline' } });
  await prisma.writingBranch.update({ where: { id: sceneBranch.id }, data: { headVersionId: initialVersion.id } });
  const createdSceneUnit = await prisma.buildManuscriptUnit.create({
    data: {
      projectId, buildRunId: run.id, parentUnitId: chapterUnit.id, writingId: sceneWriting.id, branchId: sceneBranch.id,
      kind: 'SCENE', status: 'PLANNED', key: 'scene-fixture', containerKey: chapterUnit.key, order: 1, title: 'Fixture Scene',
      metadata: { sceneKey: 'scene-fixture', chapterKey: chapterUnit.key, dependencies: [] }
    }
  });
  const taskType = options.taskType ?? 'draft-scene-unit';
  const assignedAgent = options.assignedAgent ?? 'drafter';
  const task = await prisma.buildTask.create({
    data: {
      buildRunId: run.id,
      key: `task:${key}`,
      type: taskType,
      phase: taskType === 'finalization' ? 'revising' : 'drafting',
      status: 'READY',
      scopeUnitIds: [createdSceneUnit.id],
      assignedAgent,
      skillVersions: options.skillVersions ?? { 'novel-build': '1.1.0', 'novel-chapters': '2.0.0' },
      acceptanceCriteria: (options.acceptanceCriteria ?? { manuscriptUnitDraftRequired: true }) as Prisma.InputJsonObject,
      executionPolicy: {
        model: 'priced/model', maxInputTokens: 24_000, maxOutputTokens: 1_000, maxToolCalls: 4, maxDurationMs: options.maxDurationMs ?? 10_000,
        unitIds: [createdSceneUnit.id], unitKeys: [createdSceneUnit.key], chapterUnitId: chapterUnit.id, chapterKey: chapterUnit.key, sceneKey: createdSceneUnit.key
      },
      maxAttempts: options.maxAttempts ?? 2,
      maxRevisionIterations: options.maxRevisionIterations ?? 1,
      qualityThreshold: options.qualityThreshold,
      priority: 100
    }
  });
  const sceneUnit = await prisma.buildManuscriptUnit.findUniqueOrThrow({ where: { id: createdSceneUnit.id }, include: { branch: true } });
  return { run, task, chapterUnit, sceneUnit, initialBody };
}

async function createCanonicalChapter(prisma: PrismaClient, projectId: string, userId: string, body: string) {
  const latest = await prisma.chapter.findFirst({ where: { projectId }, orderBy: { number: 'desc' }, select: { number: true } });
  const number = (latest?.number ?? 0) + 1;
  const writing = await prisma.writing.create({ data: { projectId, kind: 'CHAPTER_BODY' } });
  const branch = await prisma.writingBranch.create({ data: { writingId: writing.id, name: 'main' } });
  const version = await prisma.writingVersion.create({ data: { branchId: branch.id, body, wordCount: body.split(/\s+/).length, authorId: userId } });
  await Promise.all([
    prisma.writingBranch.update({ where: { id: branch.id }, data: { headVersionId: version.id } }),
    prisma.writing.update({ where: { id: writing.id }, data: { defaultBranchId: branch.id } })
  ]);
  return prisma.chapter.create({ data: { projectId, number, order: number - 1, title: `Canonical ${number}`, bodyWritingId: writing.id } });
}

async function invokeWorkerTool(input: BuildModelExecutorInput, name: string, value: Record<string, unknown>): Promise<unknown> {
  return invokeToolMap(input.tools as unknown as Record<string, unknown>, name, value, input.abortSignal);
}

async function invokeToolMap(tools: Record<string, unknown>, name: string, value: Record<string, unknown>, abortSignal = new AbortController().signal): Promise<unknown> {
  const selected = tools[name] as { execute?: (input: unknown, options: { toolCallId: string; messages: unknown[]; abortSignal: AbortSignal }) => Promise<unknown> } | undefined;
  if (!selected?.execute) throw new Error(`Expected scoped tool ${name}`);
  return selected.execute(value, { toolCallId: `adversarial:${name}:${randomUUID()}`, messages: [], abortSignal });
}

function workerSuccess(inputTokens: number, outputTokens: number) {
  return {
    result: {
      status: 'complete' as const,
      decisions: [{ decision: 'Candidate claims success', reason: 'Adversarial fixture; worker must independently validate it' }],
      artifactIds: [], evidence: [], checks: { forgedPerfectCheck: true }, quality: { forgedPerfectScore: 1 }, unresolvedQuestions: []
    },
    inputTokens,
    outputTokens,
    toolCalls: [],
    toolResults: [],
    modelId: 'priced/model'
  };
}

async function createBudgetRun(prisma: PrismaClient, projectId: string, userId: string, suffix: string, model: string, maxCostMicros: number) {
  const run = await prisma.buildRun.create({
    data: {
      projectId,
      createdById: userId,
      authorizedById: userId,
      objective: 'Budget preflight fixture',
      brainstorm: 'Budget fixture',
      idempotencyKey: `budget:${suffix}`,
      manifest: { version: 'novel-build-v1' },
      autonomyMode: 'AUTONOMOUS_DRAFT',
      status: 'PLANNING',
      currentPhase: 'planning',
      workflowVersion: 'novel-build-v1',
      branchName: `ai/budget-${suffix}`,
      authorizationScope: { artifactTypes: ['story-brief'], chapterIds: [], sceneIds: [], allowPlanningArtifacts: true, allowCanonWrites: false, allowChapterWrites: false, allowSceneWrites: false, allowDiagnostics: true, expiresAt: null },
      maxCostMicros,
      authorizedAt: new Date()
    }
  });
  await prisma.buildTask.create({
    data: {
      buildRunId: run.id,
      key: 'story-brief',
      type: 'create-story-brief',
      phase: 'planning',
      status: 'READY',
      assignedAgent: 'creator',
      skillVersions: { 'novel-build': '1.1.0', 'novel-intake': '1.0.0' },
      acceptanceCriteria: { requiredArtifactTypes: ['story-brief'] },
      executionPolicy: { model, maxInputTokens: 1_000, maxOutputTokens: 1_000 },
      maxAttempts: 1,
      maxRevisionIterations: 0,
      priority: 100
    }
  });
  return run;
}

function deterministicExecutor(prisma: PrismaClient, buildRunId: string, scale?: { chapters: number; scenes: number; characters: number; targetWords: number }): BuildModelExecutor {
  return async (input) => {
    const taskType = String(input.contract.metadata.taskType ?? '');
    const taskKey = String(input.contract.metadata.taskKey ?? taskType);
    const attempt = Number(input.contract.metadata.attempt ?? 0);
    const revisionIteration = Number(input.contract.metadata.revisionIteration ?? 0);
    const artifactIds: string[] = [];
    const toolCalls: unknown[] = [];
    const toolResults: unknown[] = [];
    const call = async (name: string, value: Record<string, unknown>) => {
      const tool = input.tools[name] as { execute?: (input: unknown, options: unknown) => Promise<unknown> } | undefined;
      if (!tool?.execute) throw new Error(`Fixture expected scoped tool ${name}`);
      const toolCallId = `${taskKey}:${name}:${toolCalls.length + 1}`;
      toolCalls.push({ toolCallId, toolName: name, input: value });
      const output = await tool.execute(value, { toolCallId, messages: [], abortSignal: new AbortController().signal });
      toolResults.push({ toolCallId, toolName: name, output });
      return output as Record<string, unknown>;
    };

    const planningOperations = scale
      ? productionPlanningArtifactsFor(input.contract.outputs.map((output) => output.type), input.contract.scope.buildTaskId ?? taskKey, input.contract.metadata, scale)
      : planningArtifactsFor(input.contract.outputs.map((output) => output.type), input.contract.scope.buildTaskId ?? taskKey);
    if (planningOperations.length) {
      const operationBatches = taskType === 'create-character-bibles'
        ? chunkValues(planningOperations, 3)
        : [planningOperations];
      for (const [batchIndex, operations] of operationBatches.entries()) {
        const batch = await call('applyArtifactBatch', {
          buildRunId,
          taskId: input.contract.scope.buildTaskId,
          idempotencyKey: `${taskKey}:artifacts:${attempt}:${revisionIteration}:${batchIndex + 1}`,
          operations
        });
        const results = Array.isArray(batch.results) ? batch.results as Array<Record<string, unknown>> : [];
        artifactIds.push(...results.map((item) => item.id).filter((id): id is string => typeof id === 'string'));
      }
    }

    if (taskType === 'draft-scene-unit' || roleIsRevision(input)) {
      for (const unitId of input.contract.scope.manuscriptUnitIds) {
        const unit = await prisma.buildManuscriptUnit.findUniqueOrThrow({ where: { id: unitId }, include: { branch: { include: { headVersion: true } } } });
        const currentBody = unit.branch.headVersion?.body ?? '';
        const draftedBody = taskType === 'draft-scene-unit'
          ? sceneBody(unit.key)
          : `${currentBody}\n\nRevision completed.`;
        await call('applyBuildUnitPatch', {
          buildRunId,
          taskId: input.contract.scope.buildTaskId,
          unitId,
          idempotencyKey: `${taskKey}:patch:${unitId}:${attempt}:${revisionIteration}`,
          expectedUnitRevision: unit.revision,
          expectedHeadVersionId: unit.branch.headVersionId,
          body: draftedBody,
          status: taskType === 'draft-scene-unit' ? 'drafting' : 'review',
          message: `Deterministic ${taskType}`
        });
      }
    }

    if (taskType === 'extract-scene-canon') {
      const sourceUnitId = input.contract.scope.manuscriptUnitIds[0];
      const [unit, characterArtifact] = await Promise.all([
        prisma.buildManuscriptUnit.findUniqueOrThrow({ where: { id: sourceUnitId }, include: { parentUnit: { select: { order: true } } } }),
        prisma.storyArtifact.findFirstOrThrow({ where: { buildRunId, type: 'CHARACTER_BIBLE', invalidatedAt: null }, orderBy: { key: 'asc' } })
      ]);
      const isOpeningScene = unit.key === 'scene-1';
      const storyOrder = (unit.parentUnit?.order ?? 0) * 10_000 + unit.order;
      const characterKey = typeof (characterArtifact.content as Record<string, unknown>).characterKey === 'string'
        ? String((characterArtifact.content as Record<string, unknown>).characterKey)
        : characterArtifact.key;
      await call('commitCanonDelta', {
        buildRunId,
        taskId: input.contract.scope.buildTaskId,
        sourceUnitId,
        idempotencyKey: `${taskKey}:canon:${attempt}:${revisionIteration}`,
        facts: [{ key: `${unit.key}:recognition`, subjectType: 'character', subjectId: characterKey, predicate: 'recognizes-lover', object: isOpeningScene, status: 'CANONICAL', validFromOrder: storyOrder, validToOrder: isOpeningScene ? storyOrder : undefined, confidence: 1 }],
        entityStates: [{ key: `${unit.key}:state`, entityType: 'character', entityId: characterKey, stateKey: 'recognizes-lover', value: isOpeningScene, status: 'ACTIVE', validFromOrder: storyOrder, validToOrder: isOpeningScene ? storyOrder : undefined, storyOrder, sourceFactKey: `${unit.key}:recognition` }],
        timelineEvents: [{ key: `${unit.key}:event`, title: unit.title, chronology: { order: storyOrder }, sortOrder: storyOrder, participantRefs: [{ type: 'artifact', id: characterArtifact.id, key: characterKey }] }],
        openLoops: [{ key: `${unit.key}:memory-cost`, kind: 'MYSTERY', status: isOpeningScene ? 'OPEN' : 'RESOLVED', title: 'Can Mara recover the lost recognition?', description: 'The cost becomes the ending choice.', resolvedArtifactId: isOpeningScene ? undefined : characterArtifact.id }]
      });
    }

    if (/quality-gate|critique|review-pass|developmental|proof/i.test(taskType)) {
      await call('runStoryLint', { buildRunId });
    }

    const checks = Object.fromEntries(input.contract.acceptanceCriteria.map((criterion) => [criterion.id, true]));
    return {
      result: {
        status: 'complete',
        decisions: [{ decision: `Completed ${taskKey}`, reason: 'Deterministic integration fixture' }],
        artifactIds,
        evidence: toolResults.map((item) => {
          const record = item as Record<string, unknown>;
          return { type: 'tool-result', id: typeof record.toolCallId === 'string' ? record.toolCallId : undefined, summary: `${String(record.toolName)} executed` };
        }),
        checks,
        quality: { fixture: 0.97 },
        unresolvedQuestions: []
      },
      inputTokens: 100,
      outputTokens: 50,
      toolCalls,
      toolResults,
      modelId: 'priced/model'
    };
  };
}

function planningArtifactsFor(types: string[], taskId: string): Array<Record<string, unknown>> {
  const operation = (type: string, key: string, title: string, content: Record<string, unknown>) => ({ action: 'upsert', type, key, title, schemaVersion: 'story-ir-v1', status: 'VALIDATED', content });
  return types.flatMap((type) => {
    if (type === 'story-brief') return [operation(type, 'story-brief', 'Story Brief', { premise: 'A map restores streets by erasing beloved memories.', genre: 'gothic fantasy', tone: ['melancholic'], promises: ['costly cartography'], constraints: ['no resurrection'], thematicQuestion: 'What may love ask memory to pay?', targetWordCount: 1200, minWordCount: 1000, maxWordCount: 2000, targetChapterCount: 1, targetSceneCount: 2, targetCharacterCount: 1 })];
    if (type === 'narrative-contract') return [operation(type, 'narrative-contract', 'Narrative Contract', { pov: 'close third', tense: 'past', narrativeDistance: 'close', sentenceRhythm: 'compressed with periodic expansion', diction: 'concrete', metaphorDensity: 'low-medium', interiority: 'high', dialogueCompression: 'high', expositionStyle: 'embedded in action', descriptionDensity: 'medium', contentConstraints: ['no imitation'] })];
    if (type === 'character-bible') return [operation(type, 'mara', 'Mara', { characterKey: 'mara', name: 'Mara', aliases: [], role: 'protagonist', wants: ['restore the district'], needs: ['accept irreversible loss'], contradictions: ['maps truth while hiding from memory'], arc: 'control to costly acceptance', voice: 'precise and guarded', knowledge: [], secrets: ['she caused the first erasure'], relationships: [] })];
    if (type === 'relationship-graph') return [operation(type, 'relationships', 'Relationships', { nodes: [{ type: 'character', id: 'mara', key: 'mara', label: 'Mara' }], edges: [] })];
    if (type === 'world-bible') return [operation(type, 'world', 'World Bible', { rules: [{ key: 'memory-price', statement: 'Every restored place consumes a living memory.' }], institutions: [], geography: [{ key: 'vanished-district', name: 'Vanished District', description: 'A city quarter erased from maps and minds.' }], factions: [], terminology: [{ term: 'restoration map', definition: 'A map that trades memory for place.' }], technologyOrMagicConstraints: ['No memory may be restored twice.'] })];
    if (type === 'plot-thread') return [
      operation(type, 'main-thread', 'Main Thread', { threadKey: 'main-thread', kind: 'main', summary: 'Mara restores the district while losing the person she meant to save.', stakes: 'city identity and intimate recognition', characterRefs: [{ type: 'character', id: 'mara', key: 'mara' }], beatKeys: ['draw-street', 'restore-district'], setupPayoffKeys: ['memory-cost'], resolution: 'Mara preserves the city and accepts that her lover no longer knows her.' }),
      operation(type, 'memory-mystery', 'Memory Mystery', { threadKey: 'memory-mystery', kind: 'mystery', summary: 'The map reveals why memory is its price.', stakes: 'Mara must understand the cost before choosing.', characterRefs: [{ type: 'character', id: 'mara', key: 'mara' }], beatKeys: ['draw-street', 'restore-district'], setupPayoffKeys: ['memory-cost'], resolution: 'The price proves permanent and exact.' }),
      operation(type, 'mara-arc', 'Mara Arc', { threadKey: 'mara-arc', kind: 'character-arc', summary: 'Mara moves from control to acceptance.', stakes: 'Her ability to love without possession.', characterRefs: [{ type: 'character', id: 'mara', key: 'mara' }], beatKeys: ['draw-street', 'restore-district'], setupPayoffKeys: [], resolution: 'She accepts the cost without undoing the city.' }),
      operation(type, 'lost-love', 'Lost Love', { threadKey: 'lost-love', kind: 'romance', summary: 'Recognition between Mara and her lover erodes.', stakes: 'Their shared identity.', characterRefs: [{ type: 'character', id: 'mara', key: 'mara' }], beatKeys: ['draw-street', 'restore-district'], setupPayoffKeys: ['memory-cost'], resolution: 'Love survives as an action rather than recognition.' }),
      operation(type, 'preservation-theme', 'Preservation Theme', { threadKey: 'preservation-theme', kind: 'thematic', summary: 'Preserving a place may require relinquishing ownership of its memories.', stakes: 'The moral meaning of restoration.', characterRefs: [{ type: 'character', id: 'mara', key: 'mara' }], beatKeys: ['draw-street', 'restore-district'], setupPayoffKeys: [], resolution: 'The city is restored without erasing the cost.' })
    ];
    if (type === 'beat') return [
      operation(type, 'draw-street', 'Draw the Street', { beatKey: 'draw-street', title: 'Draw the Street', function: 'Reveal the first concrete memory cost.', causeKeys: [], consequenceKeys: ['restore-district'], threadRefs: [{ type: 'plot-thread', id: 'main-thread', key: 'main-thread' }], expectedPayoff: 'Mara knowingly faces the final price.' }),
      operation(type, 'restore-district', 'Restore the District', { beatKey: 'restore-district', title: 'Restore the District', function: 'Resolve the causal and thematic choice.', causeKeys: ['draw-street'], consequenceKeys: [], threadRefs: [{ type: 'plot-thread', id: 'main-thread', key: 'main-thread' }], expectedPayoff: 'The district returns as recognition disappears.' })
    ];
    if (type === 'act-architecture') return [operation(type, 'acts', 'Act Architecture', { acts: [{ actKey: 'act-1', title: 'Restoration', purpose: 'Force the irreversible map choice.', entryState: 'district absent', exitState: 'district restored at personal cost', beatKeys: ['draw-street', 'restore-district'], chapterKeys: ['chapter-1'] }] })];
    if (type === 'chapter-brief') return [operation(type, 'chapter-1', 'The Map That Forgot', { chapterKey: 'chapter-1', number: 1, title: 'The Map That Forgot', actKey: 'act-1', purpose: 'Restore the district and pay the memory cost.', sceneKeys: ['scene-1', 'scene-2'], threadRefs: [{ type: 'plot-thread', id: 'main-thread', key: 'main-thread' }], entryState: { district: 'absent' }, exitState: { district: 'restored' }, targetWordCount: 1200 })];
    if (type === 'scene-plan') return [
      operation(type, 'scene-1', 'Draw the Street', { sceneKey: 'scene-1', chapterKey: 'chapter-1', ordinal: 1, title: 'Draw the Street', function: 'Establish the map price.', goal: 'Restore the first street.', obstacle: 'The map demands a memory.', stakes: 'Mara may forget her lover.', conflict: 'She draws despite the warning.', turn: 'The street returns.', outcome: 'One cherished memory vanishes.', emotionalValueShift: 'hope to dread', tension: 0.65, dependencies: [], characterRefs: [{ type: 'character', id: 'mara', key: 'mara' }], plotThreadRefs: [{ type: 'plot-thread', id: 'main-thread', key: 'main-thread' }], setupPayoffRefs: [{ type: 'setup-payoff', id: 'memory-cost', key: 'memory-cost' }], revelations: ['Maps consume memory.'], entryState: { recognition: true }, exitState: { recognition: 'damaged' } }),
      operation(type, 'scene-2', 'Choose the City', { sceneKey: 'scene-2', chapterKey: 'chapter-1', ordinal: 2, title: 'Choose the City', function: 'Pay off the memory cost.', goal: 'Complete the restoration.', obstacle: 'The final line will erase recognition.', stakes: 'Love or the city survives intact, not both.', conflict: 'Mara chooses with full knowledge.', turn: 'She draws the final line.', outcome: 'The district returns and her lover becomes a stranger.', emotionalValueShift: 'dread to costly acceptance', tension: 0.95, dependencies: ['scene-1'], characterRefs: [{ type: 'character', id: 'mara', key: 'mara' }], plotThreadRefs: [{ type: 'plot-thread', id: 'main-thread', key: 'main-thread' }], setupPayoffRefs: [{ type: 'setup-payoff', id: 'memory-cost', key: 'memory-cost' }], revelations: ['The price is permanent.'], entryState: { recognition: 'damaged' }, exitState: { recognition: false } })
    ];
    if (type === 'timeline') return [operation(type, 'timeline', 'Timeline', { events: [{ eventKey: 'draw-street', title: 'First street restored', chronology: { order: 1 }, dependencyKeys: [], sceneRef: { type: 'scene-plan', id: 'scene-1', key: 'scene-1' }, participantRefs: [{ type: 'character', id: 'mara', key: 'mara' }] }, { eventKey: 'restore-district', title: 'District restored', chronology: { order: 2 }, dependencyKeys: ['draw-street'], sceneRef: { type: 'scene-plan', id: 'scene-2', key: 'scene-2' }, participantRefs: [{ type: 'character', id: 'mara', key: 'mara' }] }] })];
    if (type === 'setup-payoff-map') return [operation(type, 'setup-payoff', 'Setup and Payoff', { links: [{ key: 'memory-cost', description: 'The map price is introduced then paid.', setupRef: { type: 'scene-plan', id: 'scene-1', key: 'scene-1' }, reinforcementRefs: [], payoffRef: { type: 'scene-plan', id: 'scene-2', key: 'scene-2' }, threadRef: { type: 'plot-thread', id: 'main-thread', key: 'main-thread' } }] })];
    if (type === 'research-questions') return [operation(type, 'research', 'Research Questions', { questions: [{ key: 'map-material', question: 'What material makes the map legible?', priority: 'low', status: 'answered', answer: 'Iron-gall ink.', references: [] }] })];
    if (type === 'open-questions') return [operation(type, 'open-questions', 'Open Questions', { questions: [{ key: 'ending-choice', question: 'What does Mara preserve?', priority: 'critical', status: 'answered', answer: 'The city at the cost of recognition.', references: [] }] })];
    if (type === 'finale-plan') return [operation(type, 'finale', 'Finale Plan', { finaleKey: 'finale', mainThreadKey: 'main-thread', resolvesMainThread: true, climax: 'Mara draws the final street knowing the exact memory it will erase.', endingCost: 'Her lover survives but no longer recognizes her.', thematicResolution: 'Preservation without possession is still love.', intentionallyOpenLoopKeys: [] })];
    return [];
  }).map((item) => ({ ...item, taskId }));
}

function productionPlanningArtifactsFor(
  types: string[],
  taskId: string,
  metadata: Record<string, unknown>,
  scale: { chapters: number; scenes: number; characters: number; targetWords: number }
): Array<Record<string, unknown>> {
  const operation = (type: string, key: string, title: string, content: Record<string, unknown>) => ({ action: 'upsert', type, key, title, schemaVersion: 'story-ir-v1', status: 'VALIDATED', content, taskId });
  const characterRefs = Array.from({ length: scale.characters }, (_, index) => ({ type: 'character', id: `character-${index + 1}`, key: `character-${index + 1}` }));
  const beatKeys = Array.from({ length: scale.scenes }, (_, index) => `beat-${index + 1}`);
  const chapterKeys = Array.from({ length: scale.chapters }, (_, index) => `chapter-${index + 1}`);
  const sceneCounts = Array.from({ length: scale.chapters }, (_, index) => Math.floor(scale.scenes / scale.chapters) + (index < scale.scenes % scale.chapters ? 1 : 0));
  const chapterStart = (chapterNumber: number) => sceneCounts.slice(0, chapterNumber - 1).reduce((sum, count) => sum + count, 0) + 1;
  const shard = metadata.shard && typeof metadata.shard === 'object' && !Array.isArray(metadata.shard) ? metadata.shard as Record<string, unknown> : {};
  return types.flatMap((type) => {
    if (type === 'story-brief') return [operation(type, 'story-brief', 'Production Story Brief', { premise: 'A cartographer restores an erased city by spending her own memories.', genre: 'gothic fantasy', tone: ['melancholic', 'urgent'], promises: ['causal restoration', 'irreversible memory cost'], constraints: ['no resurrection', 'every scene changes state'], thematicQuestion: 'Can preservation remain love without possession?', targetWordCount: scale.targetWords, minWordCount: Math.floor(scale.targetWords * 0.9), maxWordCount: Math.ceil(scale.targetWords * 1.1), targetChapterCount: scale.chapters, targetSceneCount: scale.scenes, targetCharacterCount: scale.characters })];
    if (type === 'narrative-contract') return [operation(type, 'narrative-contract', 'Production Narrative Contract', { pov: 'close third', tense: 'past', narrativeDistance: 'close', sentenceRhythm: 'controlled variation', diction: 'concrete', metaphorDensity: 'medium', interiority: 'high', dialogueCompression: 'high', expositionStyle: 'embedded in action', descriptionDensity: 'medium', contentConstraints: ['no imitation', 'no head hopping'] })];
    if (type === 'character-bible') return Array.from({ length: scale.characters }, (_, index) => operation(type, `character-${index + 1}`, `Character ${index + 1}`, { characterKey: `character-${index + 1}`, name: `Character ${index + 1}`, aliases: [`C${index + 1}`], role: index === 0 ? 'protagonist' : 'supporting', wants: [`complete responsibility ${index + 1}`], needs: ['accept irreversible consequence'], contradictions: ['precise yet emotionally avoidant'], arc: 'control toward accountable choice', voice: `distinct voice ${index + 1}`, knowledge: [], secrets: index === 0 ? ['caused the first erasure'] : [], relationships: [] }));
    if (type === 'relationship-graph') return [operation(type, 'relationships', 'Production Relationships', { nodes: characterRefs, edges: characterRefs.slice(1).map((reference, index) => ({ key: `relationship-${index + 1}`, from: characterRefs[0], to: reference, type: 'alliance', description: 'A pressured alliance.', state: 'uneasy' })) })];
    if (type === 'world-bible') return [operation(type, 'world', 'Production World', { rules: [{ key: 'memory-price', statement: 'Every restored place consumes a specific living memory.' }], institutions: [{ key: 'survey-office', name: 'Survey Office', description: 'Controls legal maps.' }], geography: [{ key: 'erased-city', name: 'Erased City', description: 'A district removed from maps and memory.' }], factions: [], terminology: [{ term: 'restoration line', definition: 'A cartographic mark that restores place at a memory cost.' }], technologyOrMagicConstraints: ['No consumed memory can be restored.'] })];
    if (type === 'plot-thread') return Array.from({ length: 5 }, (_, index) => operation(type, index === 0 ? 'main-thread' : `thread-${index + 1}`, index === 0 ? 'Main Restoration' : `Supporting Thread ${index + 1}`, { threadKey: index === 0 ? 'main-thread' : `thread-${index + 1}`, kind: index === 0 ? 'main' : index === 1 ? 'mystery' : index === 2 ? 'character-arc' : index === 3 ? 'romance' : 'thematic', summary: `Causal thread ${index + 1} crosses the manuscript.`, stakes: 'Memory, identity, and the surviving city.', characterRefs: [characterRefs[index % characterRefs.length]], beatKeys: beatKeys.filter((_, beatIndex) => beatIndex % 5 === index), setupPayoffKeys: index === 0 ? ['memory-price'] : [], resolution: `Thread ${index + 1} resolves in the finale.` }));
    if (type === 'beat') {
      const start = Number(shard.startOrdinal ?? 1);
      const count = Number(shard.count ?? scale.scenes);
      return Array.from({ length: count }, (_, offset) => {
        const ordinal = start + offset;
        return operation(type, `beat-${ordinal}`, `Beat ${ordinal}`, { beatKey: `beat-${ordinal}`, title: `Beat ${ordinal}`, function: `Advance causal state ${ordinal}.`, causeKeys: ordinal === 1 ? [] : [`beat-${ordinal - 1}`], consequenceKeys: ordinal === scale.scenes ? [] : [`beat-${ordinal + 1}`], threadRefs: [{ type: 'plot-thread', id: 'main-thread', key: 'main-thread' }], expectedPayoff: ordinal === scale.scenes ? 'Resolve the memory price.' : `Cause beat ${ordinal + 1}.` });
      });
    }
    if (type === 'act-architecture') return [operation(type, 'acts', 'Production Act Architecture', { acts: [{ actKey: 'act-1', title: 'Restoration', purpose: 'Escalate every restoration into the final cost.', entryState: 'city erased', exitState: 'city restored and recognition lost', beatKeys, chapterKeys }] })];
    if (type === 'chapter-brief') return chapterKeys.map((chapterKey, index) => {
      const start = chapterStart(index + 1);
      const sceneKeys = Array.from({ length: sceneCounts[index] }, (_, offset) => `scene-${start + offset}`);
      return operation(type, chapterKey, `Chapter ${index + 1}`, { chapterKey, number: index + 1, title: `Chapter ${index + 1}`, actKey: 'act-1', purpose: `Escalate restoration consequence ${index + 1}.`, sceneKeys, threadRefs: [{ type: 'plot-thread', id: 'main-thread', key: 'main-thread' }], entryState: { restoration: index }, exitState: { restoration: index + 1 }, targetWordCount: Math.round(scale.targetWords / scale.chapters) });
    });
    if (type === 'scene-plan') {
      const chapterNumber = Number(shard.chapterNumber ?? 1);
      const start = Number(shard.startOrdinal ?? chapterStart(chapterNumber));
      const count = Number(shard.count ?? sceneCounts[chapterNumber - 1]);
      return Array.from({ length: count }, (_, offset) => {
        const ordinal = start + offset;
        return operation(type, `scene-${ordinal}`, `Scene ${ordinal}`, { sceneKey: `scene-${ordinal}`, chapterKey: `chapter-${chapterNumber}`, ordinal: offset + 1, title: `Scene ${ordinal}`, function: `Change restoration state ${ordinal}.`, goal: `Restore segment ${ordinal}.`, obstacle: 'The map demands a memory.', stakes: 'Identity may be lost.', conflict: 'The protagonist draws despite the cost.', turn: `Segment ${ordinal} returns.`, outcome: `A memory is consumed at scene ${ordinal}.`, emotionalValueShift: 'resolve to costly resolve', tension: Math.min(1, 0.4 + ordinal / scale.scenes * 0.6), dependencies: ordinal === 1 ? [] : [`scene-${ordinal - 1}`], characterRefs: [characterRefs[0], characterRefs[ordinal % characterRefs.length]], plotThreadRefs: [{ type: 'plot-thread', id: 'main-thread', key: 'main-thread' }], setupPayoffRefs: [{ type: 'setup-payoff', id: 'memory-price', key: 'memory-price' }], revelations: [`Restoration cost ${ordinal} is irreversible.`], entryState: { restoration: ordinal - 1 }, exitState: { restoration: ordinal } });
      });
    }
    if (type === 'timeline') return [operation(type, 'timeline', 'Production Timeline', { events: Array.from({ length: scale.scenes }, (_, index) => ({ eventKey: `event-${index + 1}`, title: `Restoration event ${index + 1}`, chronology: { order: index + 1 }, dependencyKeys: index === 0 ? [] : [`event-${index}`], sceneRef: { type: 'scene-plan', id: `scene-${index + 1}`, key: `scene-${index + 1}` }, participantRefs: [characterRefs[0]] })) })];
    if (type === 'setup-payoff-map') return [operation(type, 'setup-payoff', 'Production Setup Payoff', { links: [{ key: 'memory-price', description: 'The first cost escalates into the final irreversible payment.', setupRef: { type: 'scene-plan', id: 'scene-1', key: 'scene-1' }, reinforcementRefs: [{ type: 'scene-plan', id: `scene-${Math.floor(scale.scenes / 2)}`, key: `scene-${Math.floor(scale.scenes / 2)}` }], payoffRef: { type: 'scene-plan', id: `scene-${scale.scenes}`, key: `scene-${scale.scenes}` }, threadRef: { type: 'plot-thread', id: 'main-thread', key: 'main-thread' } }] })];
    if (type === 'research-questions') return [operation(type, 'research', 'Production Research', { questions: [{ key: 'ink', question: 'Which archival ink remains legible?', priority: 'low', status: 'answered', answer: 'Iron-gall ink.', references: [] }] })];
    if (type === 'open-questions') return [operation(type, 'open-questions', 'Production Open Questions', { questions: [{ key: 'final-choice', question: 'What survives the final map?', priority: 'critical', status: 'answered', answer: 'The city survives while personal recognition is lost.', references: [] }] })];
    if (type === 'finale-plan') return [operation(type, 'finale', 'Production Finale', { finaleKey: 'finale', mainThreadKey: 'main-thread', resolvesMainThread: true, climax: 'The cartographer draws the final district knowing who will forget her.', endingCost: 'The beloved survives without recognition.', thematicResolution: 'Preservation without possession remains an act of love.', intentionallyOpenLoopKeys: [] })];
    return [];
  });
}

function chunkValues<T>(values: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let index = 0; index < values.length; index += size) {
    chunks.push(values.slice(index, index + size));
  }
  return chunks;
}

function sceneBody(sceneKey: string): string {
  const sentence = sceneKey === 'scene-1'
    ? 'Mara drew the vanished street while the map lifted one bright memory from her mind.'
    : 'Mara completed the district and accepted that the living city would remember what her lover could not.';
  return Array.from({ length: 35 }, () => sentence).join(' ');
}

function deterministicJudgeExecutor(): BuildJudgeExecutor {
  return async (input) => {
    expect(input.observableResult.checks).toEqual({});
    expect(input.observableResult.quality).toEqual({});
    expect(input.evidencePack.provenance.taskId).toBe(input.contract.scope.buildTaskId);
    expect(input.evidencePack.artifacts.length + input.evidencePack.units.length).toBeGreaterThan(0);
    expect(input.evidencePack.artifacts.every((artifact) => artifact.content.length > 0)).toBe(true);
    expect(input.evidencePack.units.every((unit) => typeof unit.body === 'string' && unit.headVersionId !== null)).toBe(true);
    const sceneCritic = input.contract.metadata.taskType === 'critique-scene';
    const firstSceneGate = input.contract.metadata.taskType === 'quality-gate'
      && String(input.contract.metadata.taskKey ?? '').startsWith('scene:')
      && Number(input.contract.metadata.revisionIteration ?? 0) === 0;
    const score = sceneCritic || firstSceneGate ? 0.55 : 0.97;
    const dimensions = ['completeness', 'causality', 'coherence', 'contract', 'continuity', 'character', 'prose', 'structure', 'payoff', 'arc', 'motivation', 'knowledge', 'temporal', 'state', 'worldRules', 'escalation', 'variation', 'tension', 'momentum', 'mechanics', 'consistency', 'formatting', 'cleanliness', 'correctness', 'evidence'];
    return {
      result: {
      scores: Object.fromEntries(dimensions.map((dimension) => [dimension, score])),
      feedback: sceneCritic || firstSceneGate ? 'Independent critic requests the bounded scene revision.' : 'Deterministic independent judge fixture passed.',
      evidence: [{ type: 'fixture', summary: 'Independent judge invocation' }]
      },
      inputTokens: 50,
      outputTokens: 25,
      modelId: 'priced/model'
    };
  };
}

function roleIsRevision(input: BuildModelExecutorInput): boolean {
  return ['revise-scene-unit', 'structural-revision', 'line-edit', 'copy-edit', 'finalization'].includes(String(input.contract.metadata.taskType ?? ''));
}
