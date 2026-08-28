import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
const databaseUrl = process.env.REVISION_TEST_DATABASE_URL;
process.env.DATABASE_URL ??= databaseUrl ?? 'postgresql://opentales:opentales@127.0.0.1:55432/opentales_test?schema=public';
process.env.JWT_SECRET ??= 'revision-integration-secret';
const [{ NamedSnapshotUseCase }, { WritingAnnotationUseCase }, { CreateChapterUseCase }, { SceneUseCase }] = await Promise.all([
  import('./NamedSnapshotUseCase.js'), import('./WritingAnnotationUseCase.js'), import('../projects/CreateChapterUseCase.js'), import('../projects/SceneUseCase.js')
]);
const integration = describe.runIf(Boolean(databaseUrl));
integration('named snapshots and writing annotations PostgreSQL integration', () => {
  let prisma: PrismaClient; let snapshots: InstanceType<typeof NamedSnapshotUseCase>; let annotations: InstanceType<typeof WritingAnnotationUseCase>;
  let userId: string; let outsiderId: string; let orgId: string; let projectId: string; let chapterId: string; let sceneId: string;
  beforeAll(() => {
    prisma = new PrismaClient({ datasources: { db: { url: databaseUrl! } } }); snapshots = new NamedSnapshotUseCase(prisma); annotations = new WritingAnnotationUseCase(prisma);
  });
  beforeEach(async () => {
    const suffix = randomUUID(); userId = `revision-user-${suffix}`; outsiderId = `revision-outsider-${suffix}`; orgId = `revision-org-${suffix}`; projectId = `revision-project-${suffix}`;
    await prisma.user.createMany({ data: [{ id: userId, username: userId, email: `${userId}@test.dev`, passwordHash: 'x' }, { id: outsiderId, username: outsiderId, email: `${outsiderId}@test.dev`, passwordHash: 'x' }] });
    await prisma.org.create({ data: { id: orgId, slug: orgId, name: 'Revision integration' } }); await prisma.membership.create({ data: { orgId, userId, role: 'OWNER' } });
    await prisma.project.create({ data: { id: projectId, orgId, slug: projectId, title: 'Revision Project' } });
    const project = await new CreateChapterUseCase(prisma).execute(userId, projectId, { title: 'Chapter One', content: 'Chapter original.' }); chapterId = project.chapters[0].id;
    sceneId = (await new SceneUseCase(prisma).create(userId, projectId, chapterId, { title: 'Gate', content: 'The old gate opens.', goal: 'Enter safely', tension: 0.4 })).id;
  });
  afterEach(async () => { await prisma.org.deleteMany({ where: { id: orgId } }); await prisma.user.deleteMany({ where: { id: { in: [userId, outsiderId] } } }); });
  afterAll(async () => { await prisma.$disconnect(); });

  it('round-trips named snapshots, semantic/prose diff, append-only restore and branches with isolation', async () => {
    const snapshot = await snapshots.create(userId, projectId, { idempotencyKey: 'snapshot:create', label: 'Before gate edit', message: 'Stable point', scope: 'chapter', chapterId });
    expect(snapshot.heads).toHaveLength(2); expect(snapshot.contentHash).toMatch(/^[a-f0-9]{64}$/);
    await expect(snapshots.create(userId, projectId, { idempotencyKey: 'snapshot:create', label: 'Different', scope: 'chapter', chapterId })).rejects.toMatchObject({ status: 409 });
    const sceneUseCase = new SceneUseCase(prisma); const before = await sceneUseCase.get(userId, projectId, chapterId, sceneId);
    await sceneUseCase.update(userId, projectId, chapterId, sceneId, { expectedRevision: before.revision, content: 'The changed gate closes.', goal: 'Retreat', tension: 0.9 });
    const comparison = await snapshots.compare(userId, projectId, { leftSnapshotId: snapshot.id });
    expect(comparison.prose.some((item) => item.entityId === sceneId && item.changes.some((change) => change.kind !== 'equal'))).toBe(true);
    expect(comparison.semantic.some((item) => item.path.includes('goal'))).toBe(true);
    const currentScene = await sceneUseCase.get(userId, projectId, chapterId, sceneId);
    const branches = await prisma.writingBranch.findMany({ where: { id: { in: snapshot.heads.map((head) => head.branchId) } } });
    const expectedHeads = Object.fromEntries(snapshot.heads.map((head) => [head.writingId, branches.find((branch) => branch.id === head.branchId)?.headVersionId ?? null]));
    const versionsBefore = await prisma.writingVersion.count({ where: { branchId: { in: snapshot.heads.map((head) => head.branchId) } } });
    const restored = await snapshots.restore(userId, projectId, snapshot.id, { idempotencyKey: 'snapshot:restore', confirm: true, expectedHeads, expectedEntityRevisions: { [sceneId]: currentScene.revision } });
    expect(Object.keys(restored.restoredVersionIds)).toHaveLength(2);
    expect(await prisma.writingVersion.count({ where: { branchId: { in: snapshot.heads.map((head) => head.branchId) } } })).toBe(versionsBefore + 2);
    const restoredScene = await sceneUseCase.get(userId, projectId, chapterId, sceneId); expect(restoredScene).toMatchObject({ content: 'The old gate opens.', goal: 'Enter safely', tension: 0.4 });
    expect(Object.values(restored.restoredVersionIds)).not.toContain(snapshot.heads.find((head) => head.entityId === sceneId)!.versionId);
    const branched = await snapshots.branch(userId, projectId, snapshot.id, { idempotencyKey: 'snapshot:branch', name: 'alternate-ending' }); expect(branched.branches).toHaveLength(2);
    await expect(snapshots.get(outsiderId, projectId, snapshot.id)).rejects.toMatchObject({ status: 404 });
    expect((await snapshots.delete(userId, projectId, snapshot.id)).deletedAt).not.toBeNull();
  });

  it('persists threads/replies/status and accepts suggestions only under exact head+anchor CAS', async () => {
    const sceneUseCase = new SceneUseCase(prisma); let scene = await sceneUseCase.get(userId, projectId, chapterId, sceneId);
    const start = scene.content.indexOf('old gate'); const quote = 'old gate';
    let thread = await annotations.create(userId, projectId, { idempotencyKey: 'annotation:create', writingId: scene.writingId, branchId: scene.branchId!, versionId: scene.headVersionId!, sceneId, kind: 'suggestion', start, end: start + quote.length, quote, body: 'Make the image feel renewed.', suggestedReplacement: 'new gate' });
    thread = await annotations.reply(userId, projectId, thread.id, { idempotencyKey: 'annotation:reply', body: 'Agreed.' }); expect(thread.replies).toHaveLength(1);
    thread = await annotations.resolve(userId, projectId, thread.id, { expectedRevision: thread.revision });
    thread = await annotations.reopen(userId, projectId, thread.id, { expectedRevision: thread.revision });
    thread = await annotations.accept(userId, projectId, thread.id, { idempotencyKey: 'annotation:accept', confirm: true, expectedRevision: thread.revision, expectedHeadVersionId: scene.headVersionId! });
    expect(thread.status).toBe('accepted'); expect(thread.acceptedVersionId).not.toBeNull();
    scene = await sceneUseCase.get(userId, projectId, chapterId, sceneId); expect(scene.content).toBe('The new gate opens.');
    const staleStart = scene.content.indexOf('new gate');
    const stale = await annotations.create(userId, projectId, { idempotencyKey: 'annotation:stale', writingId: scene.writingId, branchId: scene.branchId!, versionId: scene.headVersionId!, sceneId, kind: 'suggestion', start: staleStart, end: staleStart + 8, quote: 'new gate', body: 'Try another word.', suggestedReplacement: 'last gate' });
    await sceneUseCase.update(userId, projectId, chapterId, sceneId, { expectedRevision: scene.revision, content: 'The gate is completely different.' });
    const latest = await sceneUseCase.get(userId, projectId, chapterId, sceneId);
    await expect(annotations.accept(userId, projectId, stale.id, { idempotencyKey: 'annotation:stale-accept', confirm: true, expectedRevision: stale.revision, expectedHeadVersionId: latest.headVersionId! })).rejects.toMatchObject({ status: 409 });
    const rejected = await annotations.reject(userId, projectId, stale.id, { expectedRevision: stale.revision }); expect(rejected.status).toBe('rejected');
    expect((await annotations.list(userId, projectId, { sceneId })).length).toBeGreaterThanOrEqual(2);
    await expect(annotations.list(outsiderId, projectId, { sceneId })).rejects.toMatchObject({ status: 404 });
  });
});
