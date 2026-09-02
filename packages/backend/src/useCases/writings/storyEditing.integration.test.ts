import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

const databaseUrl = process.env.REVISION_TEST_DATABASE_URL;
process.env.DATABASE_URL ??= databaseUrl ?? 'postgresql://opentales:opentales@127.0.0.1:55432/opentales_test?schema=public';
process.env.JWT_SECRET ??= 'story-editing-integration-secret';

const [
  { ApplyStoryPatchUseCase },
  { CreateChapterUseCase },
  { SceneUseCase },
  { ProjectDocUseCase },
  { CreateSubmissionUseCase },
  { UpdateSubmissionUseCase },
  { executeMutationTool },
  { CompileChapterScenesUseCase },
  { MergeSubmissionUseCase }
] = await Promise.all([
  import('./ApplyStoryPatchUseCase.js'),
  import('../projects/CreateChapterUseCase.js'),
  import('../projects/SceneUseCase.js'),
  import('../projectDocs/ProjectDocUseCase.js'),
  import('../submissions/CreateSubmissionUseCase.js'),
  import('../submissions/UpdateSubmissionUseCase.js'),
  import('../ai/tools/mutations.js'),
  import('../projects/CompileChapterScenesUseCase.js'),
  import('../submissions/MergeSubmissionUseCase.js')
]);

const integration = describe.runIf(Boolean(databaseUrl));

integration('story editing harness PostgreSQL integration', () => {
  let prisma: PrismaClient;
  let userId: string;
  let orgId: string;
  let projectId: string;
  let chapterId: string;
  let sceneId: string;
  let docId: string;
  let submissionId: string;

  beforeAll(() => {
    prisma = new PrismaClient({ datasources: { db: { url: databaseUrl! } } });
  });

  beforeEach(async () => {
    const suffix = randomUUID();
    userId = `story-edit-user-${suffix}`;
    orgId = `story-edit-org-${suffix}`;
    projectId = `story-edit-project-${suffix}`;
    await prisma.user.create({ data: { id: userId, username: userId, email: `${userId}@test.dev`, passwordHash: 'x' } });
    await prisma.org.create({ data: { id: orgId, slug: orgId, name: 'Story editing integration' } });
    await prisma.membership.create({ data: { orgId, userId, role: 'OWNER' } });
    await prisma.project.create({ data: { id: projectId, orgId, slug: projectId, title: 'Story Editing Project' } });

    const project = await new CreateChapterUseCase(prisma).execute(userId, projectId, {
      title: 'Chapter One',
      content: ''
    });
    chapterId = project.chapters[0].id;
    sceneId = (await new SceneUseCase(prisma).create(userId, projectId, chapterId, {
      title: 'Empty scene',
      content: ''
    })).id;
    docId = (await new ProjectDocUseCase(prisma).create(userId, projectId, {
      title: 'Continuity ledger',
      content: 'Amplifier: Vale Citadel'
    })).id;
    submissionId = (await new CreateSubmissionUseCase(prisma).execute(userId, projectId, {
      kind: 'chapter-edit',
      title: 'Chapter One draft',
      chapterId,
      body: 'Lio carried the amplifier from Vale Citadel.'
    })).id;
  });

  afterEach(async () => {
    await prisma.org.deleteMany({ where: { id: orgId } });
    await prisma.user.deleteMany({ where: { id: userId } });
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('atomically initializes empty prose and repairs open submissions with replay-safe receipts', async () => {
    const chapter = await prisma.chapter.findUniqueOrThrow({
      where: { id: chapterId },
      include: { bodyWriting: { include: { defaultBranch: true } } }
    });
    const scene = await new SceneUseCase(prisma).get(userId, projectId, chapterId, sceneId);
    const doc = await prisma.projectDoc.findUniqueOrThrow({
      where: { id: docId },
      include: { bodyWriting: { include: { defaultBranch: true } } }
    });
    const submission = await prisma.submission.findUniqueOrThrow({
      where: { id: submissionId },
      include: { branch: true }
    });

    const input = {
      idempotencyKey: 'repair-story-v1',
      operations: [
        {
          target: 'chapter' as const,
          id: chapterId,
          expectedHeadVersionId: chapter.bodyWriting.defaultBranch!.headVersionId,
          patch: { mode: 'replace' as const, content: 'Chapter prose now exists.' }
        },
        {
          target: 'scene' as const,
          id: sceneId,
          expectedHeadVersionId: scene.headVersionId,
          expectedRevision: scene.revision,
          patch: { mode: 'replace' as const, content: 'Scene prose now exists.' }
        },
        {
          target: 'project-doc' as const,
          id: docId,
          expectedHeadVersionId: doc.bodyWriting.defaultBranch!.headVersionId,
          patch: { mode: 'edit' as const, edits: [{ oldString: 'Vale Citadel', newString: 'civic vault' }] }
        },
        {
          target: 'submission' as const,
          id: submissionId,
          expectedHeadVersionId: submission.branch.headVersionId,
          patch: { mode: 'edit' as const, edits: [{ oldString: 'Lio', newString: 'Neri' }] }
        }
      ]
    };

    const harness = new ApplyStoryPatchUseCase(prisma);
    const applied = await harness.execute(userId, projectId, input);
    expect(applied.results).toHaveLength(4);
    expect(applied.results.every((result) => result.changed)).toBe(true);
    expect(applied.results.find((result) => result.target === 'scene')?.revision).toBe(scene.revision + 1);

    const replay = await harness.execute(userId, projectId, input);
    expect(replay.replayed).toBe(true);
    expect(replay.results).toEqual(applied.results);

    const updatedScene = await new SceneUseCase(prisma).get(userId, projectId, chapterId, sceneId);
    expect(updatedScene.content).toBe('Scene prose now exists.');
    const updatedSubmission = await prisma.submission.findUniqueOrThrow({
      where: { id: submissionId },
      include: { branch: { include: { headVersion: true } } }
    });
    expect(updatedSubmission.branch.headVersion?.body).toContain('Neri');
    expect(await prisma.activity.count({ where: { submissionId, type: 'SUBMISSION_UPDATED' } })).toBe(1);

    await expect(harness.execute(userId, projectId, {
      ...input,
      idempotencyKey: 'stale-story-v1'
    })).rejects.toMatchObject({ status: 409 });
  });

  it('updates an open submission in place and returns the next head token', async () => {
    const before = await prisma.submission.findUniqueOrThrow({
      where: { id: submissionId },
      include: { branch: true }
    });
    const updated = await new UpdateSubmissionUseCase(prisma).execute(userId, projectId, submissionId, {
      expectedHeadVersionId: before.branch.headVersionId,
      title: 'Corrected Chapter One draft',
      body: 'Neri carried the amplifier from the civic vault.'
    });

    expect(updated).toMatchObject({
      id: submissionId,
      title: 'Corrected Chapter One draft',
      headBody: 'Neri carried the amplifier from the civic vault.'
    });
    expect(updated.headVersionId).not.toBe(before.branch.headVersionId);
    await expect(new UpdateSubmissionUseCase(prisma).execute(userId, projectId, submissionId, {
      expectedHeadVersionId: before.branch.headVersionId,
      body: 'Stale overwrite'
    })).rejects.toMatchObject({ status: 409 });
  });

  it('forwards MCP scene revisions and initializes empty chapter/scene bodies', async () => {
    const chapter = await prisma.chapter.findUniqueOrThrow({
      where: { id: chapterId },
      include: { bodyWriting: { include: { defaultBranch: true } } }
    });
    const chapterReceipt = await executeMutationTool(prisma, { userId, projectId }, 'updateChapter', {
      chapterId,
      expectedHeadVersionId: chapter.bodyWriting.defaultBranch!.headVersionId,
      content: 'Initialized through updateChapter.'
    });
    expect(chapterReceipt).toMatchObject({ ok: true, action: 'updated', wordCount: 3 });

    const scene = await new SceneUseCase(prisma).get(userId, projectId, chapterId, sceneId);
    const sceneReceipt = await executeMutationTool(prisma, { userId, projectId }, 'updateScene', {
      sceneId,
      expectedRevision: scene.revision,
      expectedHeadVersionId: scene.headVersionId,
      content: 'Initialized through updateScene.'
    });
    expect(sceneReceipt).toMatchObject({
      ok: true,
      action: 'updated',
      revision: scene.revision + 1,
      wordCount: 3
    });
    expect((await new SceneUseCase(prisma).get(userId, projectId, chapterId, sceneId)).content)
      .toBe('Initialized through updateScene.');
  });

  it('compiles ordered scene records into a chapter with an idempotent receipt', async () => {
    const scenes = new SceneUseCase(prisma);
    const first = await scenes.get(userId, projectId, chapterId, sceneId);
    await scenes.update(userId, projectId, chapterId, sceneId, {
      expectedRevision: first.revision,
      expectedHeadVersionId: first.headVersionId,
      content: 'First scene.'
    });
    const second = await scenes.create(userId, projectId, chapterId, {
      title: 'Second scene',
      content: 'Second scene.'
    });
    const currentScenes = await scenes.list(userId, projectId, chapterId);
    const chapter = await prisma.chapter.findUniqueOrThrow({
      where: { id: chapterId },
      include: { bodyWriting: { include: { defaultBranch: true } } }
    });
    const input = {
      idempotencyKey: 'compile-scenes-v1',
      expectedChapterHeadVersionId: chapter.bodyWriting.defaultBranch!.headVersionId,
      expectedSceneRevisions: Object.fromEntries(currentScenes.map((scene) => [scene.id, scene.revision])),
      separator: '\n\n---\n\n'
    };
    const compiler = new CompileChapterScenesUseCase(prisma);
    const compiled = await compiler.execute(userId, projectId, chapterId, input);
    const replay = await compiler.execute(userId, projectId, chapterId, input);
    expect(compiled).toMatchObject({ sceneCount: 2, changed: true, replayed: false });
    expect(replay).toMatchObject({ headVersionId: compiled.headVersionId, replayed: true });
    const body = await prisma.writingVersion.findUniqueOrThrow({ where: { id: compiled.headVersionId! } });
    expect(body.body).toBe('First scene.\n\n---\n\nSecond scene.');
    expect(second.order).toBe(1);
  });

  it('rejects stale submission merges and permits an explicit reconciled-head merge', async () => {
    const chapter = await prisma.chapter.findUniqueOrThrow({
      where: { id: chapterId },
      include: { bodyWriting: { include: { defaultBranch: true } } }
    });
    await executeMutationTool(prisma, { userId, projectId }, 'updateChapter', {
      chapterId,
      expectedHeadVersionId: chapter.bodyWriting.defaultBranch!.headVersionId,
      content: 'A newer canonical edit.'
    });
    const current = await prisma.chapter.findUniqueOrThrow({
      where: { id: chapterId },
      include: { bodyWriting: { include: { defaultBranch: true } } }
    });
    const merger = new MergeSubmissionUseCase(prisma);
    await expect(merger.execute(userId, submissionId)).rejects.toMatchObject({ status: 409 });
    const merged = await merger.execute(userId, submissionId, {
      expectedMainHeadVersionId: current.bodyWriting.defaultBranch!.headVersionId,
      confirm: true
    });
    expect(merged.status).toBe('merged');
    const canonical = await prisma.chapter.findUniqueOrThrow({
      where: { id: chapterId },
      include: { bodyWriting: { include: { defaultBranch: { include: { headVersion: true } } } } }
    });
    expect(canonical.bodyWriting.defaultBranch?.headVersion?.body)
      .toBe('Lio carried the amplifier from Vale Citadel.');
  });
});
