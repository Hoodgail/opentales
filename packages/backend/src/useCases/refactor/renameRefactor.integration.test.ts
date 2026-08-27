import { createHash, randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { ApplyRenameSymbolInput, PreviewRenameSymbolInput, RenameSymbolPreview } from '@opentales/sdk';

const databaseUrl = process.env.RENAME_REFACTOR_TEST_DATABASE_URL;
process.env.DATABASE_URL ??= databaseUrl ?? 'postgresql://opentales:opentales@127.0.0.1:55432/opentales_test?schema=public';
process.env.JWT_SECRET ??= 'rename-refactor-integration-secret';
const [{ RenameRefactorUseCase }, { CreateCharacterUseCase }, { CreateLocationUseCase }, { CreateChapterUseCase }] = await Promise.all([
  import('./RenameRefactorUseCase.js'),
  import('../projects/CreateCharacterUseCase.js'),
  import('../projects/CreateLocationUseCase.js'),
  import('../projects/CreateChapterUseCase.js')
]);

const integration = describe.runIf(Boolean(databaseUrl));

interface Fixture {
  suffix: string;
  userId: string;
  outsiderId: string;
  orgId: string;
  projectId: string;
  otherOrgId: string;
  otherProjectId: string;
}

integration('symbol-aware rename refactor PostgreSQL integration', () => {
  let prisma: PrismaClient;
  let rename: InstanceType<typeof RenameRefactorUseCase>;
  const fixtures: Fixture[] = [];

  beforeAll(() => {
    prisma = new PrismaClient({ datasources: { db: { url: databaseUrl! } } });
    rename = new RenameRefactorUseCase(prisma);
  });

  afterAll(async () => {
    if (!prisma) return;
    await prisma.org.deleteMany({ where: { id: { in: fixtures.flatMap((fixture) => [fixture.orgId, fixture.otherOrgId]) } } });
    await prisma.user.deleteMany({ where: { id: { in: fixtures.flatMap((fixture) => [fixture.userId, fixture.outsiderId]) } } });
    await prisma.$disconnect();
  });

  async function fixture(): Promise<Fixture> {
    const suffix = randomUUID();
    const value: Fixture = {
      suffix,
      userId: `rename-user-${suffix}`,
      outsiderId: `rename-outsider-${suffix}`,
      orgId: `rename-org-${suffix}`,
      projectId: `rename-project-${suffix}`,
      otherOrgId: `rename-other-org-${suffix}`,
      otherProjectId: `rename-other-project-${suffix}`
    };
    await prisma.user.createMany({ data: [
      { id: value.userId, username: value.userId, email: `${value.userId}@test.dev`, passwordHash: 'x' },
      { id: value.outsiderId, username: value.outsiderId, email: `${value.outsiderId}@test.dev`, passwordHash: 'x' }
    ] });
    await prisma.org.createMany({ data: [
      { id: value.orgId, slug: value.orgId, name: 'Rename integration' },
      { id: value.otherOrgId, slug: value.otherOrgId, name: 'Rename isolation' }
    ] });
    await prisma.membership.createMany({ data: [
      { orgId: value.orgId, userId: value.userId, role: 'OWNER' },
      { orgId: value.otherOrgId, userId: value.outsiderId, role: 'OWNER' }
    ] });
    await prisma.project.createMany({ data: [
      { id: value.projectId, orgId: value.orgId, slug: value.projectId, title: 'Rename Project' },
      { id: value.otherProjectId, orgId: value.otherOrgId, slug: value.otherProjectId, title: 'Other Project' }
    ] });
    fixtures.push(value);
    return value;
  }

  it('previews without mutation and atomically renames only a selected build branch with immutable version history', async () => {
    const f = await fixture();
    const oldName = 'Dr. [Mara]+';
    const project = await new CreateCharacterUseCase(prisma).execute(f.userId, f.projectId, {
      name: oldName,
      aliases: ['Mara'],
      description: `${oldName} keeps the archive.`,
      appearance: '', motivation: '', arc: ''
    });
    const characterId = project.characters[0]!.id;
    const chapterProject = await new CreateChapterUseCase(prisma).execute(f.userId, f.projectId, { title: `${oldName} arrives`, content: `${oldName} remains in main.` });
    expect(chapterProject.chapters[0]!.id).toBeTruthy();

    const buildRun = await prisma.buildRun.create({ data: {
      projectId: f.projectId, createdById: f.userId, objective: 'Rename fixture', brainstorm: 'Fixture', idempotencyKey: `build-${f.suffix}`,
      requestHash: 'fixture', manifest: {}, workflowVersion: 'test', branchName: `rename-${f.suffix}`, authorizationScope: {}
    } });
    const writing = await prisma.writing.create({ data: { projectId: f.projectId, kind: 'SCENE_BODY' } });
    const branch = await prisma.writingBranch.create({ data: { writingId: writing.id, buildRunId: buildRun.id, name: `build-${f.suffix}` } });
    const prefix = 'A'.repeat(180) + ' ';
    const buildBody = `${prefix}${oldName} crosses the build gate with Mara. ${oldName}ship is untouched.`;
    const buildVersion = await prisma.writingVersion.create({ data: { branchId: branch.id, body: buildBody, wordCount: 11, authorId: f.userId } });
    await prisma.writingBranch.update({ where: { id: branch.id }, data: { headVersionId: buildVersion.id } });
    const unit = await prisma.buildManuscriptUnit.create({ data: {
      projectId: f.projectId, buildRunId: buildRun.id, writingId: writing.id, branchId: branch.id, kind: 'CHAPTER', status: 'ACCEPTED',
      key: 'chapter-1', containerKey: 'manuscript', order: 1, chapterNumber: 1, title: `${oldName} build scene`, metadata: { displayName: oldName, aliases: [oldName, 'Mara'], stableCharacterId: characterId }
    } });
    const artifactContent = { characterId, displayName: oldName, summary: `${oldName} trusts Mara.`, aliases: [oldName, 'Mara'] };
    const artifact = await prisma.storyArtifact.create({ data: {
      projectId: f.projectId, buildRunId: buildRun.id, type: 'CHARACTER_BIBLE', key: 'character-bible', title: `${oldName} bible`,
      schemaVersion: 'test', status: 'ACCEPTED', content: artifactContent, contentHash: hash(artifactContent)
    } });
    const input: PreviewRenameSymbolInput = { targetType: 'character', targetId: characterId, newName: 'Mara Vale', scope: 'build', buildRunId: buildRun.id, caseSensitive: true, includeAliases: ['Mara'], limit: 500 };
    const preview = await rename.preview(f.userId, f.projectId, input);
    expect(preview.conflicts).toEqual([]);
    expect(preview.expectedHeads).toEqual([{ writingId: writing.id, branchId: branch.id, versionId: buildVersion.id, bodyHash: hash(buildBody) }]);
    const late = preview.occurrences.find((occurrence) => occurrence.kind === 'build-writing' && occurrence.matchedText === oldName)!;
    expect(late.start).toBe(buildBody.indexOf(oldName));
    expect(late.start).toBeGreaterThan(120);
    expect(preview.occurrences.some((occurrence) => occurrence.kind === 'canonical-writing')).toBe(false);
    expect((await prisma.character.findUniqueOrThrow({ where: { id: characterId } })).name).toBe(oldName);
    expect((await prisma.writingBranch.findUniqueOrThrow({ where: { id: branch.id } })).headVersionId).toBe(buildVersion.id);

    const result = await rename.apply(f.userId, f.projectId, applyInput(input, preview, 'apply-build'));
    expect(result.appliedOccurrences).toBe(preview.totalOccurrences);
    expect(result.updatedBranches).toHaveLength(1);
    const buildHead = await prisma.writingBranch.findUniqueOrThrow({ where: { id: branch.id }, include: { headVersion: true } });
    expect(buildHead.headVersion?.body).toBe(`${prefix}Mara Vale crosses the build gate with Mara Vale. ${oldName}ship is untouched.`);
    expect(buildHead.headVersion?.parentVersionId).toBe(buildVersion.id);
    expect(await prisma.writingVersion.count({ where: { branchId: branch.id } })).toBe(2);
    const mainBranches = await prisma.writingBranch.findMany({ where: { writing: { projectId: f.projectId }, buildRunId: null, defaultFor: { some: {} } }, include: { headVersion: true } });
    expect(mainBranches.some((branch) => branch.headVersion?.body?.includes(`${oldName} remains in main.`))).toBe(true);
    const renamed = await prisma.character.findUniqueOrThrow({ where: { id: characterId } });
    expect(renamed).toMatchObject({ name: 'Mara Vale' });
    expect(renamed.aliases).toEqual(expect.arrayContaining([oldName, 'Mara']));
    const updatedUnit = await prisma.buildManuscriptUnit.findUniqueOrThrow({ where: { id: unit.id } });
    expect(updatedUnit.title).toBe('Mara Vale build scene');
    expect(updatedUnit.metadata).toMatchObject({ displayName: 'Mara Vale', aliases: [oldName, 'Mara'], stableCharacterId: characterId });
    const updatedArtifact = await prisma.storyArtifact.findUniqueOrThrow({ where: { id: artifact.id } });
    expect(updatedArtifact.title).toBe('Mara Vale bible');
    expect(updatedArtifact.content).toMatchObject({ characterId, displayName: 'Mara Vale', summary: 'Mara Vale trusts Mara Vale.', aliases: [oldName, 'Mara'] });
    expect(await rename.apply(f.userId, f.projectId, applyInput(input, preview, 'apply-build'))).toEqual(result);
    await expect(rename.apply(f.userId, f.projectId, { ...applyInput(input, preview, 'apply-build'), newName: 'Different payload' })).rejects.toMatchObject({ status: 409 });
  });

  it('rolls back every rename mutation when an expected branch head is stale', async () => {
    const f = await fixture();
    const project = await new CreateLocationUseCase(prisma).execute(f.userId, f.projectId, { name: 'Port (A)+', aliases: ['Old Port'], description: 'Port (A)+ waits beyond the reef.' });
    const location = project.locations[0]!;
    const input: PreviewRenameSymbolInput = { targetType: 'location', targetId: location.id, newName: 'Harbor Prime', scope: 'main', caseSensitive: true, includeAliases: [], limit: 100 };
    const preview = await rename.preview(f.userId, f.projectId, input);
    const persistedLocation = await prisma.location.findUniqueOrThrow({ where: { id: location.id } });
    const expected = preview.expectedHeads.find((head) => head.writingId === persistedLocation.descriptionWritingId)!;
    const external = await prisma.writingVersion.create({ data: { branchId: expected.branchId, parentVersionId: expected.versionId, body: 'Externally changed Port (A)+ prose.', wordCount: 5, authorId: f.userId } });
    await prisma.writingBranch.update({ where: { id: expected.branchId }, data: { headVersionId: external.id } });
    const receiptsBefore = await prisma.renameRefactorReceipt.count({ where: { projectId: f.projectId } });
    await expect(rename.apply(f.userId, f.projectId, applyInput(input, preview, 'stale'))).rejects.toMatchObject({ status: 409 });
    const untouched = await prisma.location.findUniqueOrThrow({ where: { id: location.id } });
    expect(untouched).toMatchObject({ name: 'Port (A)+', aliases: ['Old Port'] });
    expect((await prisma.writingBranch.findUniqueOrThrow({ where: { id: expected.branchId } })).headVersionId).toBe(external.id);
    expect(await prisma.renameRefactorReceipt.count({ where: { projectId: f.projectId } })).toBe(receiptsBefore);
  });

  it('enforces project isolation and duplicate canonical/alias conflicts for locations', async () => {
    const f = await fixture();
    const project = await new CreateLocationUseCase(prisma).execute(f.userId, f.projectId, { name: 'North [Gate]', aliases: ['The Gate'], description: 'North [Gate] opens.' });
    const location = project.locations[0]!;
    await new CreateLocationUseCase(prisma).execute(f.userId, f.projectId, { name: 'South Gate', aliases: ['Harbor'] });
    const input: PreviewRenameSymbolInput = { targetType: 'location', targetId: location.id, newName: 'Harbor', scope: 'main', caseSensitive: false, includeAliases: ['The Gate'], limit: 100 };
    await expect(rename.preview(f.outsiderId, f.projectId, input)).rejects.toMatchObject({ status: 404 });
    await expect(rename.preview(f.userId, f.otherProjectId, input)).rejects.toMatchObject({ status: 404 });
    const preview = await rename.preview(f.userId, f.projectId, input);
    expect(preview.conflicts).toContain("Another location already uses 'Harbor' as a canonical name or alias");
    await expect(rename.apply(f.userId, f.projectId, applyInput(input, preview, 'duplicate'))).rejects.toMatchObject({ status: 409 });
    expect((await prisma.location.findUniqueOrThrow({ where: { id: location.id } })).name).toBe('North [Gate]');
  });
});

function applyInput(input: PreviewRenameSymbolInput, preview: RenameSymbolPreview, idempotencyKey: string): ApplyRenameSymbolInput {
  return { ...input, idempotencyKey, confirm: true, previewHash: preview.previewHash, expectedHeads: preview.expectedHeads, expectedRevisions: preview.expectedRevisions, expectedEntityUpdatedAt: preview.expectedEntityUpdatedAt };
}

function hash(value: unknown): string {
  const stable = (item: unknown): string => Array.isArray(item) ? `[${item.map(stable).join(',')}]` : item && typeof item === 'object'
    ? `{${Object.entries(item as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([key, child]) => `${JSON.stringify(key)}:${stable(child)}`).join(',')}}`
    : JSON.stringify(item) ?? 'undefined';
  return createHash('sha256').update(stable(value)).digest('hex');
}
