import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { ApplyStoryArtifactBatchInput, JsonValue } from '@opentales/sdk';

const databaseUrl = process.env.NOVEL_BUILD_TEST_DATABASE_URL;
process.env.DATABASE_URL ??= databaseUrl ?? 'postgresql://opentales:opentales@127.0.0.1:55432/opentales_test?schema=public';
process.env.JWT_SECRET ??= 'novel-build-correction-test-secret';
const [
  { NovelBuildUseCase }, { StoryStateUseCase }, { BuildManuscriptUseCase },
  { CreateChapterUseCase }, { SceneUseCase }, { CreateCharacterUseCase }, { ARTIFACT_TYPES }, { createApp }, { signAuthToken }
] = await Promise.all([
  import('./NovelBuildUseCase.js'), import('./StoryStateUseCase.js'), import('./BuildManuscriptUseCase.js'),
  import('../projects/CreateChapterUseCase.js'), import('../projects/SceneUseCase.js'), import('../projects/CreateCharacterUseCase.js'), import('./schemas.js'),
  import('../../app.js'), import('../../utils/authToken.js')
]);
const describeDatabase = databaseUrl ? describe : describe.skip;

describeDatabase('Novel Build correction-wave invariants', () => {
  let prisma: PrismaClient;
  let builds: InstanceType<typeof NovelBuildUseCase>;
  let story: InstanceType<typeof StoryStateUseCase>;
  let manuscript: InstanceType<typeof BuildManuscriptUseCase>;
  let scenes: InstanceType<typeof SceneUseCase>;
  let ownerId: string;
  let outsiderId: string;
  let orgId: string;
  let projectId: string;
  let otherProjectId: string;
  let buildId: string;
  let chapterId: string;
  let sceneId: string;
  let sceneUnitId: string;
  let characterId: string;

  beforeAll(async () => {
    prisma = new PrismaClient({ datasources: { db: { url: databaseUrl! } } });
    builds = new NovelBuildUseCase(prisma);
    story = new StoryStateUseCase(prisma);
    manuscript = new BuildManuscriptUseCase(prisma);
    scenes = new SceneUseCase(prisma);
    const suffix = randomUUID();
    ownerId = `correction-owner-${suffix}`;
    outsiderId = `correction-outsider-${suffix}`;
    orgId = `correction-org-${suffix}`;
    projectId = `correction-project-${suffix}`;
    otherProjectId = `correction-other-${suffix}`;
    await prisma.user.createMany({ data: [
      { id: ownerId, username: ownerId, email: `${ownerId}@example.test`, passwordHash: 'test' },
      { id: outsiderId, username: outsiderId, email: `${outsiderId}@example.test`, passwordHash: 'test' }
    ] });
    await prisma.org.create({ data: { id: orgId, slug: orgId, name: 'Correction invariants' } });
    await prisma.membership.create({ data: { orgId, userId: ownerId, role: 'OWNER' } });
    await prisma.project.createMany({ data: [
      { id: projectId, orgId, slug: projectId, title: 'Correction project' },
      { id: otherProjectId, orgId, slug: otherProjectId, title: 'Other project' }
    ] });

    const createdProject = await new CreateChapterUseCase(prisma).execute(ownerId, projectId, {
      title: 'Existing Chapter', content: 'ORIGINAL CHAPTER BODY', summary: 'Original chapter.'
    });
    chapterId = createdProject.chapters[0].id;
    const originalScene = await scenes.create(ownerId, projectId, chapterId, {
      title: 'Existing Scene', content: 'ORIGINAL SCENE BODY', goal: 'Keep the original.', tension: 0.2
    });
    sceneId = originalScene.id;
    const withCharacter = await new CreateCharacterUseCase(prisma).execute(ownerId, projectId, {
      name: 'Mara Vale', aliases: ['Night Fox', 'The Cartographer'], traits: ['precise'], description: 'A mapmaker.'
    });
    characterId = withCharacter.characters.find((character) => character.name === 'Mara Vale')!.id;
    activeCharacterId = characterId;

    const created = await builds.create(ownerId, projectId, {
      idempotencyKey: `correction-build-${suffix}`,
      brainstorm: 'A mapmaker enters a city that charges memories as tolls.',
      autonomyMode: 'autonomous-draft', targetWordCount: 1_200, minWordCount: 1_000, maxWordCount: 2_000,
      targetChapterCount: 1, targetSceneCount: 1, targetCharacterCount: 1,
      authorizationScope: {
        artifactTypes: [...ARTIFACT_TYPES], chapterIds: [], sceneIds: [], allowPlanningArtifacts: true,
        allowCanonWrites: true, allowChapterWrites: true, allowSceneWrites: true, allowDiagnostics: true, expiresAt: null
      },
      maxTokens: 100_000, maxCostMicros: 5_000_000
    });
    buildId = created.id;
  });

  afterAll(async () => {
    if (!prisma) return;
    await prisma.org.deleteMany({ where: { id: orgId } });
    await prisma.user.deleteMany({ where: { id: { in: [ownerId, outsiderId] } } });
    await prisma.$disconnect();
  });

  it('keeps prose isolated, CAS-fences sibling writes, and merges only after explicit owner review', async () => {
    const beforePlan = await builds.get(ownerId, projectId, buildId);
    const chapterPlan = chapterBrief();
    const scenePlanContent = scenePlan(characterId);
    const planBatch = await story.applyArtifactBatch(ownerId, projectId, buildId, {
      idempotencyKey: 'correction:plans', expectedBuildRevision: beforePlan.revision,
      operations: [
        { op: 'create', artifact: { type: 'chapter-brief', key: 'chapter-1', title: 'Chapter 1', status: 'validated', content: chapterPlan } },
        { op: 'create', artifact: { type: 'scene-plan', key: 'scene-1', title: 'Scene 1', status: 'validated', content: scenePlanContent } }
      ]
    }, { allowTaskBinding: false });
    const chapterArtifactId = planBatch.artifacts.find((artifact) => artifact.type === 'chapter-brief')!.id;
    const sceneArtifactId = planBatch.artifacts.find((artifact) => artifact.type === 'scene-plan')!.id;
    const chapterUnit = await manuscript.create(ownerId, projectId, buildId, {
      idempotencyKey: 'correction:chapter-unit', expectedBuildRevision: planBatch.buildRevision,
      kind: 'chapter', key: 'chapter-1', planArtifactId: chapterArtifactId, sourceChapterId: chapterId,
      order: 0, chapterNumber: 1, title: 'Existing Chapter', metadata: chapterPlan, initialBody: 'ORIGINAL CHAPTER BODY'
    });
    const runAfterChapter = await builds.get(ownerId, projectId, buildId);
    const sceneUnit = await manuscript.create(ownerId, projectId, buildId, {
      idempotencyKey: 'correction:scene-unit', expectedBuildRevision: runAfterChapter.revision,
      kind: 'scene', key: 'scene-1', parentUnitId: chapterUnit.id, planArtifactId: sceneArtifactId,
      sourceSceneId: sceneId, order: 0, title: 'Existing Scene', povCharacterId: characterId,
      tension: 0.8, metadata: scenePlanContent, initialBody: 'ORIGINAL SCENE BODY'
    });
    sceneUnitId = sceneUnit.id;

    const mainBefore = await canonicalBodies(prisma, chapterId, sceneId);
    const runBeforePatch = await builds.get(ownerId, projectId, buildId);
    const first = manuscript.patch(ownerId, projectId, buildId, sceneUnit.id, {
      idempotencyKey: 'correction:patch-a', expectedBuildRevision: runBeforePatch.revision,
      expectedUnitRevision: sceneUnit.revision, expectedHeadVersionId: sceneUnit.headVersionId,
      body: 'Night Fox crossed the sandbox gate. This prose exists only on the build branch.'
    });
    const sibling = manuscript.patch(ownerId, projectId, buildId, sceneUnit.id, {
      idempotencyKey: 'correction:patch-b', expectedBuildRevision: runBeforePatch.revision,
      expectedUnitRevision: sceneUnit.revision, expectedHeadVersionId: sceneUnit.headVersionId,
      body: 'Night Fox crossed the sandbox gate through a conflicting sibling draft.'
    });
    const raced = await Promise.allSettled([first, sibling]);
    expect(raced.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(raced.filter((result) => result.status === 'rejected')).toHaveLength(1);
    expect(await canonicalBodies(prisma, chapterId, sceneId)).toEqual(mainBefore);
    expect(await prisma.writingVersion.count({ where: { branchId: sceneUnit.branchId } })).toBe(2);

    const runBeforeCompile = await builds.get(ownerId, projectId, buildId);
    const compilation = await manuscript.compile(ownerId, projectId, buildId, {
      idempotencyKey: 'correction:compile', expectedBuildRevision: runBeforeCompile.revision
    });
    const comparison = await manuscript.compare(ownerId, projectId, buildId);
    expect(comparison.prose.find((item) => item.unitId === sceneUnit.id)).toMatchObject({ changed: true, mainBody: 'ORIGINAL SCENE BODY' });
    expect(compilation.chapterDraftArtifactIds).toEqual([]);
    const review = await manuscript.createReview(ownerId, projectId, buildId, {
      idempotencyKey: 'correction:review', compilationId: compilation.id, title: 'Explicit merge review'
    });
    const reviewedScene = review.units.find((item) => item.unitId === sceneUnit.id)!;
    expect(reviewedScene).toMatchObject({ action: 'update', reviewedUnitRevision: sceneUnit.revision + 1 });
    expect(reviewedScene.reviewedUnitSnapshot).toMatchObject({
      kind: 'scene', key: 'scene-1', title: 'Existing Scene', tension: 0.8,
      metadata: expect.objectContaining({ goal: 'Cross the gate', emotionalValueShift: 'resolve to grief' })
    });
    expect(reviewedScene.reviewedUnitSnapshotHash).toMatch(/^[a-f0-9]{64}$/);
    expect(reviewedScene.reviewedBody).toContain('Night Fox crossed the sandbox gate');
    expect(reviewedScene.reviewedWordCount).toBeGreaterThan(0);
    expect(reviewedScene.reviewedContentHash).toMatch(/^[a-f0-9]{64}$/);
    await expect(manuscript.approveReview(outsiderId, projectId, buildId, review.id, {
      idempotencyKey: 'correction:outsider-approve', expectedRevision: review.revision, confirm: true
    })).rejects.toMatchObject({ status: 404 });
    expect(await canonicalBodies(prisma, chapterId, sceneId)).toEqual(mainBefore);
    const approved = await manuscript.approveReview(ownerId, projectId, buildId, review.id, {
      idempotencyKey: 'correction:approve', expectedRevision: review.revision, confirm: true
    });
    const merged = await manuscript.mergeReview(ownerId, projectId, buildId, review.id, {
      idempotencyKey: 'correction:merge', expectedRevision: approved.revision, confirm: true
    });
    expect(merged.status).toBe('merged');
    const mainAfter = await canonicalBodies(prisma, chapterId, sceneId);
    expect(mainAfter.scene).toContain('sandbox gate');
    expect(mainAfter.chapter).toContain('sandbox gate');
    expect(await scenes.get(ownerId, projectId, chapterId, sceneId)).toMatchObject({
      title: 'Existing Scene', goal: 'Cross the gate', tension: 0.8, emotionalValueShift: 'resolve to grief'
    });
    expect(await prisma.buildManuscriptUnit.findUniqueOrThrow({ where: { id: sceneUnit.id } })).toMatchObject({ sourceSceneId: sceneId });

    const runBeforeMetadataReview = await builds.get(ownerId, projectId, buildId);
    const metadataCompilation = await manuscript.compile(ownerId, projectId, buildId, {
      idempotencyKey: 'correction:metadata-compile', expectedBuildRevision: runBeforeMetadataReview.revision
    });
    const metadataReview = await manuscript.createReview(ownerId, projectId, buildId, {
      idempotencyKey: 'correction:metadata-review', compilationId: metadataCompilation.id, title: 'Frozen metadata review'
    });
    const metadataApproved = await manuscript.approveReview(ownerId, projectId, buildId, metadataReview.id, {
      idempotencyKey: 'correction:metadata-approve', expectedRevision: metadataReview.revision, confirm: true
    });
    const unitBeforeMetadataChange = await manuscript.get(ownerId, projectId, buildId, sceneUnit.id);
    const runBeforeMetadataChange = await builds.get(ownerId, projectId, buildId);
    await manuscript.patch(ownerId, projectId, buildId, sceneUnit.id, {
      idempotencyKey: 'correction:post-review-metadata-change', expectedBuildRevision: runBeforeMetadataChange.revision,
      expectedUnitRevision: unitBeforeMetadataChange.revision, expectedHeadVersionId: unitBeforeMetadataChange.headVersionId,
      title: 'Changed after review', body: 'THIS BODY CHANGED AFTER THE EARLIER REVIEW.', tension: 0.1, metadata: { ...scenePlanContent, goal: 'Changed after review' }
    });
    const persistedReview = (await manuscript.listReviews(ownerId, projectId, buildId)).find((item) => item.id === review.id)!;
    expect(persistedReview.units.find((item) => item.unitId === sceneUnit.id)?.reviewedBody).toBe(reviewedScene.reviewedBody);
    await expect(manuscript.mergeReview(ownerId, projectId, buildId, metadataReview.id, {
      idempotencyKey: 'correction:metadata-stale-merge', expectedRevision: metadataApproved.revision, confirm: true
    })).rejects.toMatchObject({ status: 409 });
    expect((await scenes.get(ownerId, projectId, chapterId, sceneId)).title).toBe('Existing Scene');

    const runAfterMerge = await builds.get(ownerId, projectId, buildId);
    const secondCompilation = await manuscript.compile(ownerId, projectId, buildId, {
      idempotencyKey: 'correction:compile-reject', expectedBuildRevision: runAfterMerge.revision
    });
    const secondReview = await manuscript.createReview(ownerId, projectId, buildId, {
      idempotencyKey: 'correction:review-reject', compilationId: secondCompilation.id, title: 'Reject this version'
    });
    const rejected = await manuscript.rejectReview(ownerId, projectId, buildId, secondReview.id, {
      idempotencyKey: 'correction:reject', expectedRevision: secondReview.revision, confirm: true, reason: 'The ending needs another pass.'
    });
    expect(rejected).toMatchObject({ status: 'rejected', rejectionReason: 'The ending needs another pass.' });

    const beforeStaleCompilation = await builds.get(ownerId, projectId, buildId);
    const staleCompilation = await manuscript.compile(ownerId, projectId, buildId, {
      idempotencyKey: 'correction:stale-main-compile', expectedBuildRevision: beforeStaleCompilation.revision
    });
    const staleReview = await manuscript.createReview(ownerId, projectId, buildId, {
      idempotencyKey: 'correction:stale-main-review', compilationId: staleCompilation.id, title: 'Stale-main review'
    });
    const staleApproved = await manuscript.approveReview(ownerId, projectId, buildId, staleReview.id, {
      idempotencyKey: 'correction:stale-main-approve', expectedRevision: staleReview.revision, confirm: true
    });
    const mainScene = await scenes.get(ownerId, projectId, chapterId, sceneId);
    await scenes.update(ownerId, projectId, chapterId, sceneId, {
      expectedRevision: mainScene.revision, content: 'AN AUTHOR CHANGED MAIN AFTER REVIEW CREATION.'
    });
    const chapterHeadBeforeFailedMerge = (await canonicalBodies(prisma, chapterId, sceneId)).chapter;
    await expect(manuscript.mergeReview(ownerId, projectId, buildId, staleReview.id, {
      idempotencyKey: 'correction:stale-main-merge', expectedRevision: staleApproved.revision, confirm: true
    })).rejects.toMatchObject({ status: 409 });
    expect((await canonicalBodies(prisma, chapterId, sceneId)).chapter).toBe(chapterHeadBeforeFailedMerge);
  });

  it('keeps immutable state history, restores by appending, validates cross-project refs atomically, and honors temporal intervals', async () => {
    let run = await builds.get(ownerId, projectId, buildId);
    const first = await story.applyStateBatch(ownerId, projectId, buildId, {
      idempotencyKey: 'correction:history-1', expectedBuildRevision: run.revision,
      operations: [{ op: 'upsert-canon-fact', value: fact('mara-eye', 'blue', 1, null, sceneId) }]
    });
    const second = await story.applyStateBatch(ownerId, projectId, buildId, {
      idempotencyKey: 'correction:history-2', expectedBuildRevision: first.buildRevision,
      operations: [{ op: 'upsert-canon-fact', value: fact('mara-eye', 'green', 2, null, sceneId) }]
    });
    let history = await story.getStateHistory(ownerId, projectId, buildId, 'canon-fact', 'mara-eye');
    expect(history.versions.map((version) => version.version)).toEqual([1, 2]);
    expect(history.versions.map((version) => version.isCurrent)).toEqual([false, true]);
    const restored = await story.applyStateBatch(ownerId, projectId, buildId, {
      idempotencyKey: 'correction:history-restore', expectedBuildRevision: second.buildRevision,
      operations: [{ op: 'restore', entityKind: 'canon-fact', key: 'mara-eye', version: 1 }]
    });
    history = await story.getStateHistory(ownerId, projectId, buildId, 'canon-fact', 'mara-eye');
    expect(history.versions).toHaveLength(3);
    expect(history.versions[2]).toMatchObject({ version: 3, isCurrent: true, object: 'blue' });
    const deltaPage = await story.getStateDelta(ownerId, projectId, buildId, { limit: 2, offset: 0 });
    expect(deltaPage.canonFacts.length + deltaPage.entityStates.length + deltaPage.timelineEvents.length + deltaPage.openLoops.length + deltaPage.setupPayoffs.length + deltaPage.plotThreads.length).toBeLessThanOrEqual(2);
    expect(deltaPage.nextOffset).not.toBeNull();
    const invalidated = await story.applyStateBatch(ownerId, projectId, buildId, {
      idempotencyKey: 'correction:history-invalidate', expectedBuildRevision: restored.buildRevision,
      operations: [{ op: 'invalidate', entityKind: 'canon-fact', key: 'mara-eye', reason: 'Re-extract from revised prose' }]
    });
    const reextracted = await story.applyStateBatch(ownerId, projectId, buildId, {
      idempotencyKey: 'correction:history-reextract', expectedBuildRevision: invalidated.buildRevision,
      operations: [{ op: 'upsert-canon-fact', value: fact('mara-eye', 'hazel', 3, null, sceneId) }]
    });
    history = await story.getStateHistory(ownerId, projectId, buildId, 'canon-fact', 'mara-eye');
    expect(history.versions.at(-1)).toMatchObject({ version: 4, isCurrent: true, object: 'hazel' });

    const temporal = await story.applyStateBatch(ownerId, projectId, buildId, {
      idempotencyKey: 'correction:temporal', expectedBuildRevision: reextracted.buildRevision,
      operations: [
        { op: 'upsert-canon-fact', value: fact('mara-alive-before', true, 1, 1, sceneId, 'alive') },
        { op: 'upsert-canon-fact', value: fact('mara-alive-after', false, 2, null, sceneId, 'alive') }
      ]
    });
    expect((await story.temporalState(ownerId, projectId, buildId, { storyOrder: 1, entityType: 'character', entityId: characterId, predicate: 'alive' })).canonFacts.map((value) => value.object)).toEqual([true]);
    expect((await story.temporalState(ownerId, projectId, buildId, { storyOrder: 2, entityType: 'character', entityId: characterId, predicate: 'alive' })).canonFacts.map((value) => value.object)).toEqual([false]);

    const other = await builds.create(ownerId, otherProjectId, {
      idempotencyKey: 'correction:other-build', brainstorm: 'An unrelated story.', autonomyMode: 'assist'
    });
    const otherArtifact = await prisma.storyArtifact.create({ data: {
      projectId: otherProjectId, buildRunId: other.id, type: 'STORY_BRIEF', key: 'other', title: 'Other',
      schemaVersion: 'story-ir-v1', status: 'VALIDATED', content: { premise: 'Other.', genre: 'other', tone: [], promises: [], constraints: [] }, contentHash: 'other'
    } });
    await expect(story.applyStateBatch(ownerId, projectId, buildId, {
      idempotencyKey: 'correction:cross-project-rollback', expectedBuildRevision: temporal.buildRevision,
      operations: [
        { op: 'upsert-canon-fact', value: fact('must-rollback', 'value', 3, null, sceneId) },
        { op: 'upsert-canon-fact', value: { ...fact('cross-project', 'invalid', 3, null, sceneId), sourceSpan: { artifactId: otherArtifact.id, quote: 'cross-build evidence' } } }
      ]
    })).rejects.toMatchObject({ status: 409 });
    expect(await prisma.canonFact.count({ where: { buildRunId: buildId, key: 'must-rollback' } })).toBe(0);
  });

  it('CAS-updates and atomically reorders full Scene metadata while synchronizing mapped build units', async () => {
    const suffix = randomUUID();
    const reorderProjectId = `reorder-project-${suffix}`;
    await prisma.project.create({ data: { id: reorderProjectId, orgId, slug: reorderProjectId, title: 'Independent reorder project' } });
    const project = await new CreateChapterUseCase(prisma).execute(ownerId, reorderProjectId, { title: 'Reorder Chapter', content: 'Chapter.' });
    const localChapterId = project.chapters[0].id;
    const first = await scenes.create(ownerId, reorderProjectId, localChapterId, { title: 'First', content: 'First.' });
    const second = await scenes.create(ownerId, reorderProjectId, localChapterId, { title: 'Second', content: 'Second.' });
    const third = await scenes.create(ownerId, reorderProjectId, localChapterId, { title: 'Third', content: 'Third.' });
    const materialize = async (label: string) => {
      const run = await builds.create(ownerId, reorderProjectId, {
        idempotencyKey: `reorder:${label}`, brainstorm: 'Reorder this existing chapter.', autonomyMode: 'autonomous-draft',
        authorizationScope: { artifactTypes: [...ARTIFACT_TYPES], chapterIds: [], sceneIds: [], allowPlanningArtifacts: true, allowCanonWrites: true, allowChapterWrites: true, allowSceneWrites: true, allowDiagnostics: true, expiresAt: null },
        maxTokens: 10_000, maxCostMicros: 100_000, targetChapterCount: 1, targetSceneCount: 3, targetCharacterCount: 1
      });
      await story.applyArtifactBatch(ownerId, reorderProjectId, run.id, {
        idempotencyKey: `reorder:${label}:plans`, expectedBuildRevision: run.revision, operations: [
          { op: 'create', artifact: { type: 'chapter-brief', key: 'chapter-1', title: 'Chapter', status: 'accepted', content: { chapterKey: 'chapter-1', number: 1, title: 'Chapter', purpose: 'Reorder.', sceneKeys: ['scene-1','scene-2','scene-3'], threadRefs: [], entryState: {}, exitState: {} } } },
          ...[1,2,3].map((ordinal) => ({ op: 'create' as const, artifact: { type: 'scene-plan' as const, key: `scene-${ordinal}`, title: `Scene ${ordinal}`, status: 'accepted' as const, content: { sceneKey: `scene-${ordinal}`, chapterKey: 'chapter-1', ordinal, function: 'Sequence', goal: 'Move', obstacle: 'Order', stakes: 'Clarity', conflict: 'Sequence', turn: 'Shift', outcome: 'Ordered', emotionalValueShift: 'still to moved', tension: 0.5, dependencies: ordinal === 1 ? [] : [`scene-${ordinal - 1}`], characterRefs: [], plotThreadRefs: [], setupPayoffRefs: [], revelations: [], entryState: {}, exitState: {} } } }))
        ]
      }, { allowTaskBinding: false });
      return run.id;
    };
    const activeBuildId = await materialize('active');
    const historicalBuildId = await materialize('historical');
    await prisma.buildRun.update({ where: { id: historicalBuildId }, data: { status: 'COMPLETED', completedAt: new Date() } });
    const historicalBefore = await prisma.buildManuscriptUnit.findMany({ where: { buildRunId: historicalBuildId, kind: 'SCENE' }, orderBy: { key: 'asc' }, select: { key: true, order: true } });
    const activeBefore = await manuscript.list(ownerId, reorderProjectId, activeBuildId, { kind: 'scene' });
    const canonicalBeforeBuildOnly = (await scenes.list(ownerId, reorderProjectId, localChapterId)).map((scene) => scene.id);
    const activeRun = await builds.get(ownerId, reorderProjectId, activeBuildId);
    await manuscript.reorder(ownerId, reorderProjectId, activeBuildId, {
      idempotencyKey: 'reorder:build-only', expectedBuildRevision: activeRun.revision,
      parentUnitId: activeBefore[0].parentUnitId!, unitIds: activeBefore.map((unit) => unit.id).reverse(),
      expectedUnitRevisions: Object.fromEntries(activeBefore.map((unit) => [unit.id, unit.revision]))
    });
    expect((await scenes.list(ownerId, reorderProjectId, localChapterId)).map((scene) => scene.id)).toEqual(canonicalBeforeBuildOnly);
    const before = await scenes.list(ownerId, reorderProjectId, localChapterId);
    const revisions = Object.fromEntries(before.map((scene) => [scene.id, scene.revision]));
    const races = await Promise.allSettled([
      scenes.reorder(ownerId, reorderProjectId, localChapterId, { sceneIds: [third.id, first.id, second.id], expectedRevisions: revisions, buildRunId: activeBuildId }),
      scenes.reorder(ownerId, reorderProjectId, localChapterId, { sceneIds: [second.id, third.id, first.id], expectedRevisions: revisions, buildRunId: activeBuildId })
    ]);
    expect(races.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(races.filter((result) => result.status === 'rejected')).toHaveLength(1);
    const canonical = await scenes.list(ownerId, reorderProjectId, localChapterId);
    const activeUnits = await prisma.buildManuscriptUnit.findMany({ where: { buildRunId: activeBuildId, kind: 'SCENE' }, orderBy: { order: 'asc' } });
    expect(activeUnits.map((unit) => unit.sourceSceneId)).toEqual(canonical.map((scene) => scene.id));
    expect(await prisma.buildManuscriptUnit.findMany({ where: { buildRunId: historicalBuildId, kind: 'SCENE' }, orderBy: { key: 'asc' }, select: { key: true, order: true } })).toEqual(historicalBefore);
  }, 30_000);

  it('enforces authenticated REST review rejection and project isolation against the real router', async () => {
    const run = await builds.get(ownerId, projectId, buildId);
    const compilation = await manuscript.compile(ownerId, projectId, buildId, {
      idempotencyKey: 'correction:http-compile', expectedBuildRevision: run.revision
    });
    const review = await manuscript.createReview(ownerId, projectId, buildId, {
      idempotencyKey: 'correction:http-review', compilationId: compilation.id, title: 'HTTP review'
    });
    const asset = await prisma.asset.create({ data: {
      projectId, name: 'Novel.pdf', kind: 'DOCUMENT', s3Bucket: 'integration', s3Key: `exports/${randomUUID()}.pdf`,
      mimeType: 'application/pdf', sizeBytes: 128n, checksum: 'sha256:test-export', uploadedById: ownerId
    } });
    const exportRevision = (await builds.get(ownerId, projectId, buildId)).revision;
    const server = createApp().listen(0);
    await new Promise<void>((resolve) => server.once('listening', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('HTTP test server did not bind a TCP port');
    const base = `http://127.0.0.1:${address.port}`;
    try {
      const response = await fetch(`${base}/projects/${projectId}/builds/${buildId}/reviews/${review.id}/reject`, {
        method: 'POST', headers: { authorization: `Bearer ${signAuthToken({ userId: ownerId })}`, 'content-type': 'application/json' },
        body: JSON.stringify({ idempotencyKey: 'correction:http-reject', expectedRevision: review.revision, confirm: true, reason: 'HTTP rejection is explicit.' })
      });
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({ status: 'rejected', rejectionReason: 'HTTP rejection is explicit.' });
      const exportResponse = await fetch(`${base}/projects/${projectId}/builds/${buildId}/exports`, {
        method: 'POST', headers: { authorization: `Bearer ${signAuthToken({ userId: ownerId })}`, 'content-type': 'application/json' },
        body: JSON.stringify({
          idempotencyKey: 'correction:http-export', expectedBuildRevision: exportRevision, compilationId: compilation.id,
          outputs: [{ format: 'pdf', assetId: asset.id, mimeType: 'application/pdf', checksum: asset.checksum }]
        })
      });
      expect(exportResponse.status).toBe(400);
      expect(await exportResponse.json()).toMatchObject({ message: expect.stringMatching(/READY verified ProjectExport|Every build output/i) });
      const outsider = await fetch(`${base}/projects/${projectId}/builds/${buildId}`, {
        headers: { authorization: `Bearer ${signAuthToken({ userId: outsiderId })}` }
      });
      expect(outsider.status).toBe(404);
    } finally {
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    }
  });

  it('searches the current build branch, aliases and structured filter-only syntax with plain ranged snippets', async () => {
    await expect(new CreateCharacterUseCase(prisma).execute(ownerId, projectId, {
      name: 'Invalid Alias Character', aliases: ['Duplicate', 'duplicate']
    })).rejects.toMatchObject({ status: 400 });
    let run = await builds.get(ownerId, projectId, buildId);
    const state = await story.applyStateBatch(ownerId, projectId, buildId, {
      idempotencyKey: 'correction:unpaid-setup', expectedBuildRevision: run.revision,
      operations: [{ op: 'upsert-setup-payoff', value: {
        sourceUnitId: sceneUnitId, plotThreadId: null, key: 'gate-toll', title: 'The gate toll', description: 'A memory is promised as payment.',
        status: 'setup', setupSceneId: sceneId, payoffSceneId: null, reinforcementSceneIds: [], setupArtifactId: null,
        payoffArtifactId: null, metadata: null
      } }]
    });
    expect(state.setupPayoffs.some((item) => item.key === 'gate-toll')).toBe(true);
    const searchableUnit = await manuscript.get(ownerId, projectId, buildId, sceneUnitId);
    const beforeLongPatch = await builds.get(ownerId, projectId, buildId);
    await manuscript.patch(ownerId, projectId, buildId, sceneUnitId, {
      idempotencyKey: 'correction:late-search-body', expectedBuildRevision: beforeLongPatch.revision,
      expectedUnitRevision: searchableUnit.revision, expectedHeadVersionId: searchableUnit.headVersionId,
      body: `${'prefix '.repeat(120)}Night Fox crossed the sandbox gate at the late match.`
    });

    const alias = await story.search(ownerId, projectId, buildId, { query: '@character:"Night Fox"', limit: 20 });
    expect(alias.hits.some((hit) => hit.kind === 'character' && hit.id === characterId)).toBe(true);
    const goal = await story.search(ownerId, projectId, buildId, { query: 'scene.goal:"Changed after review"', limit: 20 });
    expect(goal.hits.some((hit) => hit.kind === 'build-unit' && hit.id === sceneUnitId)).toBe(true);
    const unpaid = await story.search(ownerId, projectId, buildId, { query: 'setup:unpaid', limit: 20 });
    expect(unpaid.hits.some((hit) => hit.kind === 'setup-payoff' && hit.key === 'gate-toll')).toBe(true);
    const prose = await story.search(ownerId, projectId, buildId, { query: 'sandbox gate', strategy: 'exact', limit: 20 });
    const proseHit = prose.hits.find((hit) => hit.kind === 'build-unit' && hit.id === sceneUnitId)!;
    expect(proseHit.snippet).not.toContain('<b>');
    expect(proseHit.sourceSpan).toEqual(expect.objectContaining({
      unitId: sceneUnitId, branchId: searchableUnit.branchId, writingVersionId: expect.any(String),
      start: expect.any(Number), end: expect.any(Number), lineStart: 1, lineEnd: 1, quote: 'sandbox gate'
    }));
    expect(proseHit.sourceSpan!.start).toBeGreaterThan(500);
    const refs = await story.findReferences(ownerId, projectId, buildId, { refType: 'character', refId: characterId, limit: 50 });
    expect(refs.hits.some((hit) => hit.kind === 'build-unit' && hit.id === sceneUnitId)).toBe(true);
    const siblingBuild = await builds.create(ownerId, projectId, { idempotencyKey: `correction:sibling-build:${randomUUID()}`, brainstorm: 'Same project, different build.', autonomyMode: 'assist' });
    await expect(manuscript.get(ownerId, projectId, siblingBuild.id, sceneUnitId)).rejects.toMatchObject({ status: 404 });
    await expect(story.getStateHistory(ownerId, projectId, siblingBuild.id, 'canon-fact', 'mara-eye')).rejects.toMatchObject({ status: 404 });
    expect((await story.search(ownerId, projectId, siblingBuild.id, { query: 'sandbox gate', strategy: 'exact' })).hits.some((hit) => hit.id === sceneUnitId)).toBe(false);
  });

  it('materializes and scopes a target-sized 32 chapter / 110 scene graph in one bounded transaction', async () => {
    const scale = await builds.create(ownerId, projectId, {
      idempotencyKey: `correction:scale:${randomUUID()}`, brainstorm: 'A complete large novel plan.',
      autonomyMode: 'autonomous-draft', targetWordCount: 110_000, targetChapterCount: 32,
      targetSceneCount: 110, targetCharacterCount: 8,
      authorizationScope: {
        artifactTypes: [...ARTIFACT_TYPES], chapterIds: [], sceneIds: [], allowPlanningArtifacts: true,
        allowCanonWrites: true, allowChapterWrites: true, allowSceneWrites: true, allowDiagnostics: true, expiresAt: null
      }, maxTokens: 500_000, maxCostMicros: 20_000_000
    });
    const operations: ApplyStoryArtifactBatchInput['operations'] = [];
    let priorSceneKey: string | null = null;
    let sceneNumber = 0;
    for (let chapterNumber = 1; chapterNumber <= 32; chapterNumber += 1) {
      const count = chapterNumber <= 14 ? 4 : 3;
      const sceneKeys = Array.from({ length: count }, () => `scale-scene-${++sceneNumber}`);
      operations.push({ op: 'create', artifact: {
        type: 'chapter-brief', key: `scale-chapter-${chapterNumber}`, title: `Scale Chapter ${chapterNumber}`, status: 'accepted',
        content: {
          chapterKey: `scale-chapter-${chapterNumber}`, number: chapterNumber, title: `Scale Chapter ${chapterNumber}`,
          purpose: `Advance the large plan through chapter ${chapterNumber}.`, sceneKeys, threadRefs: [],
          entryState: {}, exitState: {}, targetWordCount: 3_400
        }
      } });
      for (let ordinal = 1; ordinal <= count; ordinal += 1) {
        const sceneKey = sceneKeys[ordinal - 1];
        operations.push({ op: 'create', artifact: {
          type: 'scene-plan', key: sceneKey, title: `Scale Scene ${sceneNumber - count + ordinal}`, status: 'accepted',
          content: {
            sceneKey, chapterKey: `scale-chapter-${chapterNumber}`, ordinal, title: `Scale Scene ${sceneNumber - count + ordinal}`,
            function: 'Causal escalation', goal: 'Advance the plan', obstacle: 'A concrete reversal', stakes: 'The objective worsens',
            conflict: 'Opposed goals collide', turn: 'New information changes the choice', outcome: 'The next scene becomes necessary',
            emotionalValueShift: 'certainty to doubt', tension: 0.65, dependencies: priorSceneKey ? [priorSceneKey] : [],
            characterRefs: [], plotThreadRefs: [], setupPayoffRefs: [], revelations: ['A causal fact'], entryState: {}, exitState: {}
          }
        } });
        priorSceneKey = sceneKey;
      }
    }
    expect(sceneNumber).toBe(110);
    const startedAt = Date.now();
    const result = await story.applyArtifactBatch(ownerId, projectId, scale.id, {
      idempotencyKey: 'correction:scale-plans', expectedBuildRevision: scale.revision, operations
    }, { allowTaskBinding: false });
    expect(Date.now() - startedAt).toBeLessThan(20_000);
    expect(result.createdChapterTaskIds).toHaveLength(1_164);
    expect(await prisma.buildManuscriptUnit.count({ where: { buildRunId: scale.id, kind: 'CHAPTER' } })).toBe(32);
    expect(await prisma.buildManuscriptUnit.count({ where: { buildRunId: scale.id, kind: 'SCENE' } })).toBe(110);
    expect((await story.listArtifacts(ownerId, projectId, scale.id, { limit: 500 })).items).toHaveLength(142);
    const revisionScope = await prisma.buildTask.findFirstOrThrow({ where: { buildRunId: scale.id, key: 'manuscript-developmental-review' }, select: { scopeUnitIds: true } });
    expect(revisionScope.scopeUnitIds).toHaveLength(142);
    expect(await prisma.buildTask.count({ where: { buildRunId: scale.id, type: 'create-beat-shard' } })).toBe(6);
    expect(await prisma.buildTask.count({ where: { buildRunId: scale.id, type: 'create-scene-plan-shard' } })).toBe(32);
    const aggregateScenePlans = await prisma.buildTask.findFirstOrThrow({ where: { buildRunId: scale.id, type: 'aggregate-scene-plans' } });
    expect(aggregateScenePlans.dependencyIds).toHaveLength(32);
    await prisma.canonFact.createMany({ data: Array.from({ length: 510 }, (_, index) => ({
      projectId, buildRunId: scale.id, key: `cursor-fact-${index}`, subjectType: 'fixture', subjectId: `fixture-${index}`,
      predicate: 'contains', object: `cursorneedle ${index}`, status: 'CANONICAL' as const, confidence: 1
    })) });
    let cursor: string | undefined;
    const seen = new Set<string>();
    do {
      const page = await story.search(ownerId, projectId, scale.id, { query: 'cursorneedle', strategy: 'exact', limit: 100, ...(cursor ? { cursor } : {}) });
      page.hits.forEach((hit) => seen.add(hit.id));
      cursor = page.nextCursor ?? undefined;
    } while (cursor);
    expect(seen.size).toBe(510);
  }, 30_000);

  it('rejects concurrent build-create idempotency races with different payload hashes', async () => {
    const key = `correction:create-race:${randomUUID()}`;
    const raced = await Promise.allSettled([
      builds.create(ownerId, projectId, { idempotencyKey: key, brainstorm: 'First distinct brainstorm.', autonomyMode: 'assist' }),
      builds.create(ownerId, projectId, { idempotencyKey: key, brainstorm: 'Second distinct brainstorm.', autonomyMode: 'assist' })
    ]);
    expect(raced.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(raced.filter((result) => result.status === 'rejected')).toHaveLength(1);
    expect((raced.find((result) => result.status === 'rejected') as PromiseRejectedResult).reason).toMatchObject({ status: 409 });
    expect(await prisma.buildRun.count({ where: { projectId, idempotencyKey: key } })).toBe(1);
  });

  it('automatically maps stable chapter numbers and scene ordinals to canonical UPDATE review targets', async () => {
    const suffix = randomUUID();
    const mappedProjectId = `mapped-project-${suffix}`;
    await prisma.project.create({ data: { id: mappedProjectId, orgId, slug: mappedProjectId, title: 'Mapped existing manuscript' } });
    const project = await new CreateChapterUseCase(prisma).execute(ownerId, mappedProjectId, {
      title: 'Canonical Chapter One', content: 'CANONICAL CHAPTER ONE'
    });
    const canonicalChapter = project.chapters[0];
    const canonicalScene = await scenes.create(ownerId, mappedProjectId, canonicalChapter.id, {
      title: 'Canonical Opening', content: 'CANONICAL OPENING', goal: 'Old goal', tension: 0.25
    });
    const build = await builds.create(ownerId, mappedProjectId, {
      idempotencyKey: `mapped-build-${suffix}`, brainstorm: 'Revise the existing first chapter.', autonomyMode: 'autonomous-draft',
      targetWordCount: 1_000, targetChapterCount: 1, targetSceneCount: 1, targetCharacterCount: 1,
      authorizationScope: {
        artifactTypes: [...ARTIFACT_TYPES], chapterIds: [], sceneIds: [], allowPlanningArtifacts: true,
        allowCanonWrites: true, allowChapterWrites: true, allowSceneWrites: true, allowDiagnostics: true, expiresAt: null
      }, maxTokens: 50_000, maxCostMicros: 1_000_000
    });
    await story.applyArtifactBatch(ownerId, mappedProjectId, build.id, {
      idempotencyKey: 'mapped:plans', expectedBuildRevision: build.revision,
      operations: [
        { op: 'create', artifact: { type: 'chapter-brief', key: 'chapter-1', title: 'Revised Chapter One', status: 'accepted', content: {
          chapterKey: 'chapter-1', number: 1, title: 'Revised Chapter One', purpose: 'Revise chapter one.', sceneKeys: ['scene-1'],
          threadRefs: [], entryState: {}, exitState: {}, targetWordCount: 1_000
        } } },
        { op: 'create', artifact: { type: 'scene-plan', key: 'scene-1', title: 'Revised Opening', status: 'accepted', content: {
          sceneKey: 'scene-1', chapterKey: 'chapter-1', ordinal: 1, title: 'Revised Opening', function: 'Opening revision',
          goal: 'New exact goal', obstacle: 'Resistance', stakes: 'Failure', conflict: 'Opposition', turn: 'Discovery', outcome: 'Progress',
          emotionalValueShift: 'doubt to resolve', tension: 0.77, dependencies: [], characterRefs: [], plotThreadRefs: [], setupPayoffRefs: [],
          revelations: ['A clue'], entryState: {}, exitState: {}, writerNotes: 'Frozen writer note'
        } } }
      ]
    }, { allowTaskBinding: false });
    const units = await manuscript.list(ownerId, mappedProjectId, build.id);
    const chapterUnit = units.find((unit) => unit.kind === 'chapter')!;
    const sceneUnit = units.find((unit) => unit.kind === 'scene')!;
    expect(chapterUnit.sourceChapterId).toBe(canonicalChapter.id);
    expect(sceneUnit.sourceSceneId).toBe(canonicalScene.id);
    let run = await builds.get(ownerId, mappedProjectId, build.id);
    await manuscript.patch(ownerId, mappedProjectId, build.id, sceneUnit.id, {
      idempotencyKey: 'mapped:prose', expectedBuildRevision: run.revision, expectedUnitRevision: sceneUnit.revision,
      expectedHeadVersionId: sceneUnit.headVersionId, body: 'REVISED CANONICAL OPENING'
    });
    run = await builds.get(ownerId, mappedProjectId, build.id);
    const compilation = await manuscript.compile(ownerId, mappedProjectId, build.id, { idempotencyKey: 'mapped:compile', expectedBuildRevision: run.revision });
    const review = await manuscript.createReview(ownerId, mappedProjectId, build.id, { idempotencyKey: 'mapped:review', compilationId: compilation.id, title: 'Mapped review' });
    expect(review.units.every((unit) => unit.action === 'update')).toBe(true);
    const approved = await manuscript.approveReview(ownerId, mappedProjectId, build.id, review.id, { idempotencyKey: 'mapped:approve', expectedRevision: review.revision, confirm: true });
    await manuscript.mergeReview(ownerId, mappedProjectId, build.id, review.id, { idempotencyKey: 'mapped:merge', expectedRevision: approved.revision, confirm: true });
    expect(await prisma.chapter.count({ where: { projectId: mappedProjectId, deletedAt: null } })).toBe(1);
    expect(await scenes.get(ownerId, mappedProjectId, canonicalChapter.id, canonicalScene.id)).toMatchObject({
      title: 'Revised Opening', content: 'REVISED CANONICAL OPENING', goal: 'New exact goal', tension: 0.77, writerNotes: 'Frozen writer note'
    });
  });
});

function chapterBrief() {
  return {
    chapterKey: 'chapter-1', number: 1, title: 'Existing Chapter', purpose: 'Cross the memory gate.',
    sceneKeys: ['scene-1'], threadRefs: [], entryState: {}, exitState: {}, targetWordCount: 1_200
  };
}

function scenePlan(characterId: string) {
  return {
    sceneKey: 'scene-1', chapterKey: 'chapter-1', ordinal: 1, title: 'Existing Scene', function: 'Threshold crossing',
    goal: 'Cross the gate', obstacle: 'The gate demands a memory', stakes: 'Mara may forget her brother',
    conflict: 'Mara bargains with the keeper', turn: 'The toll names her happiest day', outcome: 'She pays',
    emotionalValueShift: 'resolve to grief', tension: 0.8, dependencies: [],
    povRef: { type: 'character', id: characterId, label: 'Mara Vale' },
    characterRefs: [{ type: 'character', id: characterId, label: 'Mara Vale' }], plotThreadRefs: [], setupPayoffRefs: [],
    revelations: ['The gate keeps memories'], entryState: {}, exitState: {}
  };
}

function fact(key: string, object: JsonValue, validFromOrder: number, validToOrder: number | null, sourceSceneId: string, predicate = 'eye-color') {
  return {
    sourceArtifactId: null, sourceUnitId: null, key, subjectType: 'character', subjectId: characterIdForFact(), predicate,
    object, status: 'canonical' as const, validFromSceneId: sourceSceneId, validToSceneId: null,
    validFromOrder, validToOrder, sourceChapterId: null, sourceSceneId,
    sourceSpan: { sceneId: sourceSceneId, start: 0, end: 4, quote: 'Mara' }, confidence: 1
  };
}

let activeCharacterId = '';
function characterIdForFact() { return activeCharacterId; }

async function canonicalBodies(prisma: PrismaClient, chapterId: string, sceneId: string) {
  const [chapter, scene] = await Promise.all([
    prisma.chapter.findUniqueOrThrow({ where: { id: chapterId }, include: { bodyWriting: { include: { defaultBranch: { include: { headVersion: true } } } } } }),
    prisma.scene.findUniqueOrThrow({ where: { id: sceneId }, include: { bodyWriting: { include: { defaultBranch: { include: { headVersion: true } } } } } })
  ]);
  return { chapter: chapter.bodyWriting.defaultBranch?.headVersion?.body ?? '', scene: scene.bodyWriting.defaultBranch?.headVersion?.body ?? '' };
}
