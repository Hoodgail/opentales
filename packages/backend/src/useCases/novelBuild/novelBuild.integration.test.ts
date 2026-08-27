import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import type { ApplyStoryArtifactBatchInput } from '@opentales/sdk';

const databaseUrl = process.env.NOVEL_BUILD_TEST_DATABASE_URL;
process.env.DATABASE_URL ??= databaseUrl ?? 'postgresql://opentales:opentales@127.0.0.1:55432/opentales_test?schema=public';
process.env.JWT_SECRET ??= 'novel-build-integration-test-secret';
const [{ NovelBuildUseCase }, { StoryStateUseCase }, { BuildManuscriptUseCase }] = await Promise.all([
  import('./NovelBuildUseCase.js'),
  import('./StoryStateUseCase.js'),
  import('./BuildManuscriptUseCase.js')
]);
const describeDatabase = databaseUrl ? describe : describe.skip;

describeDatabase('durable Novel Build integration', () => {
  let prisma: PrismaClient;
  let builds: InstanceType<typeof NovelBuildUseCase>;
  let story: InstanceType<typeof StoryStateUseCase>;
  let manuscript: InstanceType<typeof BuildManuscriptUseCase>;
  let ownerId: string;
  let outsiderId: string;
  let orgId: string;
  let projectId: string;
  let buildId: string;

  beforeAll(async () => {
    prisma = new PrismaClient({ datasources: { db: { url: databaseUrl! } } });
    builds = new NovelBuildUseCase(prisma);
    story = new StoryStateUseCase(prisma);
    manuscript = new BuildManuscriptUseCase(prisma);
    const suffix = randomUUID();
    ownerId = `owner-${suffix}`;
    outsiderId = `outsider-${suffix}`;
    orgId = `org-${suffix}`;
    projectId = `project-${suffix}`;
    await prisma.user.createMany({ data: [
      { id: ownerId, username: `owner-${suffix}`, email: `owner-${suffix}@example.test`, passwordHash: 'test' },
      { id: outsiderId, username: `outsider-${suffix}`, email: `outsider-${suffix}@example.test`, passwordHash: 'test' }
    ] });
    await prisma.org.create({ data: { id: orgId, slug: `org-${suffix}`, name: 'Novel Build Test' } });
    await prisma.membership.create({ data: { orgId, userId: ownerId, role: 'OWNER' } });
    await prisma.project.create({ data: { id: projectId, orgId, slug: `project-${suffix}`, title: 'Novel Build Test' } });
  });

  afterAll(async () => {
    if (!prisma) return;
    await prisma.org.deleteMany({ where: { id: orgId } });
    await prisma.user.deleteMany({ where: { id: { in: [ownerId, outsiderId] } } });
    await prisma.$disconnect();
  });

  it('persists, leases, recovers, cross-links, searches, diagnoses and invalidates a build end to end', async () => {
    const created = await builds.create(ownerId, projectId, {
      idempotencyKey: 'integration:create',
      brainstorm: 'A cartographer discovers every map erases one beloved memory, and must chart a forbidden city to save her brother.',
      objective: 'Build a complete gothic fantasy novel',
      targetWordCount: 85_000,
      genre: 'gothic fantasy',
      constraints: ['no resurrection', 'bittersweet ending'],
      autonomyMode: 'autonomous-draft',
      authorizationScope: {
        artifactTypes: ['story-brief', 'narrative-contract', 'character-bible', 'relationship-graph', 'world-bible', 'plot-thread', 'act-architecture', 'chapter-brief', 'scene-plan', 'timeline', 'setup-payoff-map', 'research-questions', 'open-questions', 'beat', 'chapter-draft', 'revision-issue'],
        chapterIds: [], sceneIds: [], allowPlanningArtifacts: true, allowCanonWrites: true,
        allowChapterWrites: true, allowSceneWrites: true, allowDiagnostics: true, expiresAt: null
      },
      maxTokens: 50_000,
      maxCostMicros: 2_000_000
    });
    buildId = created.id;
    expect(created.tasks).toHaveLength(67);
    expect(created.tasks.filter((task) => task.type === 'create-beat-shard')).toHaveLength(6);
    expect(created.tasks.filter((task) => task.type === 'create-scene-plan-shard')).toHaveLength(32);
    expect(created.tasks.filter((task) => task.status === 'ready').map((task) => task.key)).toEqual(['story-brief']);
    expect(created.tasks.map((task) => task.key)).toEqual(expect.arrayContaining([
      'planning-checkpoint', 'drafting-complete', 'manuscript-developmental-review', 'structural-revision',
      'line-edit', 'copy-edit', 'proof', 'finalization', 'export-preparation', 'final-checkpoint'
    ]));
    expect(created.manifest.sourceBrainstormHash).toMatch(/^[a-f0-9]{64}$/);
    expect(created.tasks.find((task) => task.key === 'story-brief')?.skillVersions).toEqual(expect.objectContaining({ 'novel-build': '1.1.0', 'novel-intake': '1.0.0' }));
    expect(created.tasks.find((task) => task.key.startsWith('scene-plans:chapter-'))?.skillVersions).toEqual(expect.objectContaining({ 'novel-scenes': '1.0.0' }));
    expect(created.tasks.find((task) => task.key === 'scene-plans')).toMatchObject({ type: 'aggregate-scene-plans', assignedAgent: 'orchestrator' });
    expect(created.tasks.find((task) => task.key === 'continuity-review-pass')?.skillVersions).toEqual(expect.objectContaining({ 'novel-continuity': '1.0.0' }));
    expect(created.tasks.find((task) => task.key === 'line-edit')?.skillVersions).toEqual(expect.objectContaining({ 'novel-line-revision': '1.0.0' }));

    const claimInput = { idempotencyKey: 'integration:claim-story', workerId: 'worker-1', leaseMs: 60_000, taskTypes: ['create-story-brief'] };
    const claimed = await builds.claim(ownerId, projectId, buildId, claimInput);
    const claimedReplay = await builds.claim(ownerId, projectId, buildId, claimInput);
    expect(claimed?.task.id).toBe(claimedReplay?.task.id);
    expect(claimed?.task.status).toBe('running');
    await expect(builds.claim(ownerId, projectId, buildId, {
      idempotencyKey: 'integration:claim-capacity-contender', workerId: 'worker-contender', leaseMs: 60_000
    })).resolves.toBeNull();
    expect(await prisma.buildTask.count({ where: { buildRunId: buildId, status: 'RUNNING' } })).toBe(1);

    await expect(story.applyArtifactBatch(ownerId, projectId, buildId, {
      idempotencyKey: 'integration:forged-task-binding',
      expectedBuildRevision: claimed!.buildRun.revision,
      operations: [{
        op: 'create', artifact: {
          taskId: claimed!.task.id, type: 'story-brief', key: 'forged-public-output', title: 'Forged output',
          content: { premise: 'Forged.', genre: 'fantasy', tone: [], promises: [], constraints: [] }
        }
      }]
    }, { allowTaskBinding: false })).rejects.toMatchObject({ status: 403 });

    const artifactInput: ApplyStoryArtifactBatchInput = {
      idempotencyKey: 'integration:story-artifact',
      expectedBuildRevision: claimed!.buildRun.revision,
      operations: [{
        op: 'create',
        artifact: {
          taskId: claimed!.task.id,
          type: 'story-brief',
          key: 'story-brief',
          title: 'Story Brief',
          status: 'validated',
          content: {
            premise: 'A mapmaker must trade memories to chart a forbidden city and save her brother.',
            genre: 'gothic fantasy',
            targetAudience: 'adult',
            tone: ['haunting', 'intimate'],
            promises: ['memory has an irreversible cost', 'a tragic romance'],
            constraints: ['no resurrection', 'bittersweet ending'],
            thematicQuestion: 'What remains of love when memory is gone?',
            targetWordCount: 85_000
          }
        }
      }]
    };
    const artifactBatch = await story.applyArtifactBatch(ownerId, projectId, buildId, artifactInput);
    const artifactReplay = await story.applyArtifactBatch(ownerId, projectId, buildId, artifactInput);
    expect(artifactBatch.artifacts[0].id).toBe(artifactReplay.artifacts[0].id);
    const storyBriefId = artifactBatch.artifacts[0].id;

    await story.appendEvaluation(ownerId, projectId, buildId, {
      taskId: claimed!.task.id, artifactId: storyBriefId, idempotencyKey: 'integration:eval', kind: 'deterministic',
      rubric: 'story-brief-v1', rubricVersion: '1', scores: { schema: 1 }, checks: [{ name: 'schema', passed: true }],
      passed: true, threshold: 1, feedback: null, evidence: { artifactId: storyBriefId }
    }, { lease: claimed!.lease! });

    const completed = await builds.complete(ownerId, projectId, buildId, claimed!.task.id, {
      idempotencyKey: 'integration:complete-story',
      workerId: 'worker-1',
      leaseToken: claimed!.lease!.leaseToken,
      leaseGeneration: claimed!.lease!.leaseGeneration,
      runGeneration: claimed!.lease!.runGeneration,
      expectedRevision: claimed!.task.revision,
      outputArtifactIds: [storyBriefId],
      result: { schemaValidated: true }
    });
    expect(completed.task.status).toBe('done');
    expect(completed.unblockedTaskIds).toHaveLength(3);

    const narrative = await builds.claim(ownerId, projectId, buildId, {
      idempotencyKey: 'integration:claim-narrative', workerId: 'worker-2', leaseMs: 10_000,
      taskTypes: ['create-narrative-contract']
    });
    expect(narrative?.task.status).toBe('running');
    await prisma.buildTask.update({
      where: { id: narrative!.task.id },
      data: { leaseExpiresAt: new Date(Date.now() - 5_000) }
    });
    const recovered = await builds.recover(ownerId, projectId, buildId, { idempotencyKey: 'integration:recover' });
    expect(recovered.recoveredTaskIds).toContain(narrative!.task.id);
    expect(recovered.buildRun.tasks.find((task) => task.id === narrative!.task.id)?.status).toBe('ready');
    await expect(builds.complete(ownerId, projectId, buildId, narrative!.task.id, {
      idempotencyKey: 'integration:stale-complete', workerId: 'worker-2',
      leaseToken: narrative!.lease!.leaseToken, leaseGeneration: narrative!.lease!.leaseGeneration,
      runGeneration: narrative!.lease!.runGeneration, expectedRevision: narrative!.task.revision
    })).rejects.toMatchObject({ status: 409 });

    const beforePlans = await builds.get(ownerId, projectId, buildId);
    const chapterBriefTaskId = beforePlans.tasks.find((task) => task.key === 'chapter-briefs')!.id;
    const scenePlanTaskId = beforePlans.tasks.find((task) => task.key === 'scene-plans')!.id;
    const plans = await story.applyArtifactBatch(ownerId, projectId, buildId, {
      idempotencyKey: 'integration:chapter-plans',
      expectedBuildRevision: beforePlans.revision,
      operations: [
        { op: 'create', artifact: { taskId: chapterBriefTaskId, type: 'chapter-brief', key: 'chapter-1', title: 'Chapter 1', status: 'accepted', content: chapterBrief('chapter-1', 1, ['scene-1']) } },
        { op: 'create', artifact: { taskId: chapterBriefTaskId, type: 'chapter-brief', key: 'chapter-2', title: 'Chapter 2', status: 'accepted', content: chapterBrief('chapter-2', 2, ['scene-2']) } },
        { op: 'create', artifact: { taskId: scenePlanTaskId, type: 'scene-plan', key: 'scene-1', title: 'Scene 1', status: 'accepted', content: scenePlan('scene-1', 'chapter-1', 1, []) } },
        { op: 'create', artifact: { taskId: scenePlanTaskId, type: 'scene-plan', key: 'scene-2', title: 'Scene 2', status: 'accepted', content: scenePlan('scene-2', 'chapter-2', 2, ['scene-1']) } }
      ]
    });
    expect(plans.createdChapterTaskIds).toHaveLength(24);
    const graph = await prisma.buildTask.findMany({ where: { buildRunId: buildId } });
    const sceneOneCheckpoint = graph.find((task) => task.key === 'scene:scene-1:checkpoint')!;
    const sceneTwoContext = graph.find((task) => task.key === 'scene:scene-2:context')!;
    const chapterOneCheckpoint = graph.find((task) => task.key === 'chapter:chapter-1:checkpoint')!;
    expect(sceneTwoContext.dependencyIds).toEqual(expect.arrayContaining([sceneOneCheckpoint.id, chapterOneCheckpoint.id]));
    expect(sceneTwoContext.dependencyIds).toHaveLength(2);
    const beforeBoundary = await builds.get(ownerId, projectId, buildId);
    const planningBoundary = await builds.createCheckpoint(ownerId, projectId, buildId, {
      idempotencyKey: 'integration:planning-boundary', expectedBuildRevision: beforeBoundary.revision,
      label: 'Keep through accepted premise', phase: 'planning'
    });
    const chapterTwoArtifact = plans.artifacts.find((artifact) => artifact.key === 'chapter-2')!;
    const beforeReplacement = await builds.get(ownerId, projectId, buildId);
    const replacement = await story.applyArtifactBatch(ownerId, projectId, buildId, {
      idempotencyKey: 'integration:replace-chapter-2', expectedBuildRevision: beforeReplacement.revision,
      operations: [{
        op: 'replace', artifactId: chapterTwoArtifact.id, expectedVersion: chapterTwoArtifact.version,
        artifact: {
          type: 'chapter-brief', key: 'chapter-2', title: 'Chapter 2 — Revised', status: 'validated',
          content: { ...chapterBrief('chapter-2', 2, ['scene-2']), purpose: 'Mara refuses Elias and enters the archive alone.' }
        }
      }]
    }, { allowTaskBinding: false });
    expect(replacement.artifacts.find((artifact) => artifact.id === chapterTwoArtifact.id)?.status).toBe('superseded');
    expect(replacement.artifacts.find((artifact) => artifact.replacesArtifactId === chapterTwoArtifact.id)?.version).toBe(2);
    const invalidatedAfterReplacement = await prisma.buildTask.findMany({
      where: { buildRunId: buildId, invalidatedAt: { not: null } }, select: { id: true, key: true }
    });
    expect(
      invalidatedAfterReplacement.some((task) => task.id === sceneTwoContext.id),
      `Invalidated tasks: ${invalidatedAfterReplacement.map((task) => task.key).join(', ')}`
    ).toBe(true);

    expect(await prisma.chapter.count({ where: { projectId } })).toBe(0);
    expect(await prisma.scene.count({ where: { chapter: { projectId } } })).toBe(0);
    const sceneUnit = (await manuscript.list(ownerId, projectId, buildId, { kind: 'scene' })).find((unit) => unit.key === 'scene-1')!;
    const initialBuildHead = sceneUnit.headVersionId;
    const beforeWrite = await builds.get(ownerId, projectId, buildId);
    const firstPatch = manuscript.patch(ownerId, projectId, buildId, sceneUnit.id, {
      idempotencyKey: 'integration:scene-write-a', expectedBuildRevision: beforeWrite.revision,
      expectedUnitRevision: sceneUnit.revision, expectedHeadVersionId: sceneUnit.headVersionId,
      body: 'The door took her name, but Mara crossed the threshold.', message: 'Isolated scene draft A'
    });
    const secondPatch = manuscript.patch(ownerId, projectId, buildId, sceneUnit.id, {
      idempotencyKey: 'integration:scene-write-b', expectedBuildRevision: beforeWrite.revision,
      expectedUnitRevision: sceneUnit.revision, expectedHeadVersionId: sceneUnit.headVersionId,
      body: 'A conflicting isolated scene draft.', message: 'Isolated scene draft B'
    });
    const concurrent = await Promise.allSettled([firstPatch, secondPatch]);
    expect(concurrent.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(concurrent.filter((result) => result.status === 'rejected')).toHaveLength(1);
    const patchedUnit = await manuscript.get(ownerId, projectId, buildId, sceneUnit.id);
    expect(patchedUnit.body).toMatch(/door took her name|conflicting isolated/);
    expect(await prisma.chapter.count({ where: { projectId } })).toBe(0);
    expect(await prisma.scene.count({ where: { chapter: { projectId } } })).toBe(0);

    const beforeState = await builds.get(ownerId, projectId, buildId);
    await story.applyStateBatch(ownerId, projectId, buildId, {
      idempotencyKey: 'integration:canon-conflict',
      expectedBuildRevision: beforeState.revision,
      operations: [
        { op: 'upsert-canon-fact', value: canonFact('mara-eyes-blue', 'blue') },
        { op: 'upsert-canon-fact', value: canonFact('mara-eyes-green', 'green') },
        { op: 'upsert-open-loop', value: {
          key: 'red-moth', kind: 'setup', status: 'open', title: 'The red moth', description: 'A repeated omen.',
          introducedSceneId: null, resolvedSceneId: null, introducedArtifactId: null, resolvedArtifactId: null,
          targetPayoff: 'Reveal who sent it', metadata: null
        } }
      ]
    });
    const diagnostics = await story.diagnostics(ownerId, projectId, buildId);
    expect(diagnostics.diagnostics.map((item) => item.code)).toContain('canon-conflict');

    const search = await story.search(ownerId, projectId, buildId, { query: 'memory', strategy: 'hybrid', limit: 20 });
    expect(search.hits.some((hit) => hit.id === storyBriefId)).toBe(true);
    const filteredSearch = await story.search(ownerId, projectId, buildId, {
      query: '', filters: { entity: ['mara'] }, limit: 20
    });
    expect(filteredSearch.hits.some((hit) => hit.kind === 'canon-fact')).toBe(true);
    const chapterSearch = await story.search(ownerId, projectId, buildId, {
      query: patchedUnit.body.includes('door') ? 'door' : 'conflicting', filters: { chapter: [sceneUnit.parentUnitId!] }, limit: 20
    });
    expect(chapterSearch.hits.some((hit) => hit.id === sceneUnit.id)).toBe(true);
    const pagedArtifacts = await story.listArtifacts(ownerId, projectId, buildId, { limit: 500 });
    expect(pagedArtifacts.limit).toBe(500);
    await expect(story.search(ownerId, projectId, buildId, { query: '(a+)+', strategy: 'regex' })).rejects.toMatchObject({ status: 400 });

    const state = await story.getState(ownerId, projectId, buildId);
    const maraFact = state.canonFacts.find((fact) => fact.key === 'mara-eyes-blue')!;
    const references = await story.findReferences(ownerId, projectId, buildId, { refType: 'character', refId: 'mara', limit: 100 });
    expect(references.hits.some((hit) => hit.id === maraFact.id)).toBe(true);

    const beforeTrace = await builds.get(ownerId, projectId, buildId);
    await expect(story.appendTrace(ownerId, projectId, buildId, {
      taskId: claimed!.task.id, idempotencyKey: 'integration:forged-completed-trace', attempt: 1, status: 'completed',
      provider: 'forged', model: 'forged', modelParameters: {}, workflowVersion: beforeTrace.workflowVersion,
      systemPromptVersion: null, skillVersions: {}, toolSchemaVersions: {}, inputs: {}, retrievedArtifactIds: [],
      contextTokenCount: 0, toolCalls: [], toolResults: [], outputs: {}, validatorResults: {}, inputTokens: 0,
      outputTokens: 0, costMicros: 0, latencyMs: 0, retries: 0, completionState: 'done', error: null,
      startedAt: new Date().toISOString(), completedAt: new Date().toISOString()
    })).rejects.toMatchObject({ status: 403 });
    await story.appendTrace(ownerId, projectId, buildId, {
      taskId: null,
      idempotencyKey: 'integration:trace', attempt: 1, status: 'completed', provider: 'test', model: 'test-model', modelParameters: {},
      workflowVersion: beforeTrace.workflowVersion, systemPromptVersion: 'test', skillVersions: { 'novel-build': '1.1.0' },
      toolSchemaVersions: { build: '1' }, inputs: { artifactId: storyBriefId }, retrievedArtifactIds: [storyBriefId],
      contextTokenCount: 100, toolCalls: [], toolResults: [], outputs: { artifactId: storyBriefId }, validatorResults: { schema: 'pass' },
      inputTokens: 100, outputTokens: 50, costMicros: 1000, latencyMs: 25, retries: 0, completionState: 'done', error: null,
      startedAt: new Date(Date.now() - 25).toISOString(), completedAt: new Date().toISOString()
    });
    const observability = await story.observability(ownerId, projectId, buildId, {});
    expect(observability.traces.map((trace) => trace.idempotencyKey)).toContain('integration:trace');
    expect(observability.evaluations.map((evaluation) => evaluation.idempotencyKey)).toContain('integration:eval');

    await expect(builds.get(outsiderId, projectId, buildId)).rejects.toMatchObject({ status: 404 });

    const beforeRerun = await builds.get(ownerId, projectId, buildId);
    const narrativeTask = beforeRerun.tasks.find((task) => task.key === 'chapter-briefs')!;
    const replanInput = {
      idempotencyKey: 'integration:replan-after-premise', expectedRevision: beforeRerun.revision,
      fromTaskId: narrativeTask.id, checkpointId: planningBoundary.id,
      directive: 'Keep the accepted premise. Re-plan from the narrative contract so Mara refuses Elias at the midpoint.',
      pinnedArtifactIds: [storyBriefId]
    };
    const replan = await builds.replan(ownerId, projectId, buildId, replanInput);
    const replanReplay = await builds.replan(ownerId, projectId, buildId, replanInput);
    expect(replanReplay.directive.id).toBe(replan.directive.id);
    expect(replan.invalidatedTaskIds.length).toBeGreaterThan(10);
    expect(replan.preservedArtifactIds).toEqual([storyBriefId]);
    expect(replan.directive.checkpointId).toBe(planningBoundary.id);
    expect(replan.buildRun.activeDirective?.id).toBe(replan.directive.id);
    expect((await story.observability(ownerId, projectId, buildId, {})).directives.map((item) => item.id)).toContain(replan.directive.id);
    expect((await prisma.writingBranch.findUniqueOrThrow({ where: { id: sceneUnit.branchId } })).headVersionId).toBe(initialBuildHead);
    expect((await prisma.storyArtifact.findUniqueOrThrow({ where: { id: storyBriefId } })).status).toBe('VALIDATED');
    expect((await prisma.storyArtifact.findUniqueOrThrow({ where: { id: plans.artifacts.find((artifact) => artifact.key === 'chapter-1')!.id } })).status).toBe('INVALIDATED');
    await expect(story.applyArtifactBatch(ownerId, projectId, buildId, {
      idempotencyKey: 'integration:replace-pinned', expectedBuildRevision: replan.buildRun.revision,
      operations: [{ op: 'replace', artifactId: storyBriefId, expectedVersion: 1, artifact: {
        type: 'story-brief', key: 'story-brief', title: 'Pinned premise replacement', status: 'validated',
        content: artifactBatch.artifacts[0].content
      } }]
    }, { allowTaskBinding: false })).rejects.toMatchObject({ status: 409 });
    const unpinned = await manuscript.unpin(ownerId, projectId, buildId, {
      idempotencyKey: 'integration:unpin-premise', expectedRevision: replan.buildRun.revision, artifactIds: [storyBriefId]
    });
    await expect(story.applyArtifactBatch(ownerId, projectId, buildId, {
      idempotencyKey: 'integration:replace-after-unpin', expectedBuildRevision: unpinned.revision,
      operations: [{ op: 'replace', artifactId: storyBriefId, expectedVersion: 1, artifact: {
        type: 'story-brief', key: 'story-brief', title: 'Unpinned premise replacement', status: 'validated',
        content: artifactBatch.artifacts[0].content
      } }]
    }, { allowTaskBinding: false })).resolves.toMatchObject({ artifacts: expect.any(Array) });
  }, 30_000);

  it('requires manifest approval for Plan & Review and records explicit authorization', async () => {
    const assist = await builds.create(ownerId, projectId, {
      idempotencyKey: 'integration:assist-unscoped', brainstorm: 'A small assist-mode premise.', autonomyMode: 'assist'
    });
    await expect(builds.claim(ownerId, projectId, assist.id, {
      idempotencyKey: 'integration:assist-claim', workerId: 'worker-assist'
    })).rejects.toMatchObject({ status: 403 });

    const review = await builds.create(ownerId, projectId, {
      idempotencyKey: 'integration:plan-review',
      brainstorm: 'A lighthouse keeper hears tomorrow’s shipwrecks in the foghorn.',
      autonomyMode: 'plan-review'
    });
    expect(review.status).toBe('paused');
    expect(review.currentPhase).toBe('manifest-review');
    expect(review.authorizedAt).toBeNull();
    await expect(builds.claim(ownerId, projectId, review.id, {
      idempotencyKey: 'integration:premature-claim', workerId: 'worker-review'
    })).rejects.toMatchObject({ status: 409 });

    const authorized = await builds.authorize(ownerId, projectId, review.id, {
      idempotencyKey: 'integration:approve-manifest',
      expectedRevision: review.revision,
      authorizationScope: review.authorizationScope,
      maxTokens: 100_000,
      maxCostMicros: 5_000_000
    });
    expect(authorized.status).toBe('planning');
    expect(authorized.authorizedAt).not.toBeNull();
    expect(authorized.tasks.find((task) => task.key === 'story-brief')?.status).toBe('ready');

    await Promise.all([
      ...Array.from({ length: 8 }, () => builds.get(ownerId, projectId, review.id)),
      ...Array.from({ length: 4 }, (_, index) => story.appendTrace(ownerId, projectId, review.id, {
        taskId: null, idempotencyKey: `integration:concurrent-trace:${index}`, attempt: 0, status: 'completed',
        provider: 'test', model: 'test', modelParameters: {}, workflowVersion: authorized.workflowVersion,
        systemPromptVersion: null, skillVersions: {}, toolSchemaVersions: {}, inputs: {}, retrievedArtifactIds: [],
        contextTokenCount: 1, toolCalls: [], toolResults: [], outputs: {}, validatorResults: {}, inputTokens: 1,
        outputTokens: 1, costMicros: 1, latencyMs: 1, retries: 0, completionState: 'done', error: null,
        startedAt: new Date().toISOString(), completedAt: new Date().toISOString()
      }))
    ]);
    const afterContention = await builds.get(ownerId, projectId, review.id);
    expect(afterContention.tokensUsed).toBe(8);

    await prisma.buildTask.updateMany({
      where: { buildRunId: review.id, key: { not: 'planning-checkpoint' }, phase: { in: ['planning', 'planning-review'] } },
      data: { status: 'DONE', progress: 100, completedAt: new Date() }
    });
    await prisma.buildTask.update({
      where: { buildRunId_key: { buildRunId: review.id, key: 'planning-checkpoint' } },
      data: { status: 'READY', priority: 200 }
    });
    const checkpointClaim = await builds.claim(ownerId, projectId, review.id, {
      idempotencyKey: 'integration:claim-plan-checkpoint', workerId: 'worker-review', taskTypes: ['checkpoint']
    });
    const checkpointResult = await builds.complete(ownerId, projectId, review.id, checkpointClaim!.task.id, {
      idempotencyKey: 'integration:complete-plan-checkpoint', workerId: 'worker-review',
      leaseToken: checkpointClaim!.lease!.leaseToken,
      leaseGeneration: checkpointClaim!.lease!.leaseGeneration,
      runGeneration: checkpointClaim!.lease!.runGeneration,
      expectedRevision: checkpointClaim!.task.revision, createCheckpoint: true
    });
    expect(checkpointResult.buildRun.status).toBe('paused');
    expect(checkpointResult.buildRun.currentPhase).toBe('checkpoint-review:planning-checkpoint');
    expect(checkpointResult.checkpoint?.label).toBe('planning-checkpoint');
  });
});

function chapterBrief(chapterKey: string, number: number, sceneKeys: string[]) {
  return {
    chapterKey, number, title: `Chapter ${number}`, purpose: `Escalate the story in chapter ${number}.`,
    sceneKeys, threadRefs: [], entryState: {}, exitState: {}, targetWordCount: 2_500
  };
}

function scenePlan(sceneKey: string, chapterKey: string, ordinal: number, dependencies: string[]) {
  return {
    sceneKey, chapterKey, ordinal, title: `Scene ${ordinal}`, function: 'Escalation', goal: 'Reach the archive',
    obstacle: 'The city changes its streets', stakes: 'A memory will be lost', conflict: 'Mara chooses between speed and safety',
    turn: 'The map redraws itself', outcome: 'Mara loses a childhood memory', emotionalValueShift: 'hope to dread',
    tension: 0.75,
    dependencies, characterRefs: [], plotThreadRefs: [], setupPayoffRefs: [], revelations: ['The city is alive'],
    entryState: {}, exitState: {}
  };
}

function canonFact(key: string, eyeColor: string) {
  return {
    sourceArtifactId: null, key, subjectType: 'character', subjectId: 'mara', predicate: 'eye-color', object: eyeColor,
    status: 'canonical' as const, validFromSceneId: null, validToSceneId: null, sourceChapterId: null, sourceSceneId: null,
    sourceSpan: null, confidence: 1
  };
}
