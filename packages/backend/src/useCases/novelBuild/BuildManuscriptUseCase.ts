import { createHash } from 'node:crypto';
import { Prisma, type PrismaClient, type Role } from '@prisma/client';
import type {
  ApproveBuildReviewInput,
  BuildCompilation,
  BuildComparison,
  BuildManuscriptUnit,
  BuildReview,
  CompileBuildManuscriptInput,
  CreateBuildManuscriptUnitInput,
  CreateBuildReviewInput,
  JsonObject,
  JsonValue,
  MergeBuildReviewInput,
  PatchBuildManuscriptUnitInput,
  RegisterBuildExportInput,
  RejectBuildReviewInput,
  ReorderBuildManuscriptUnitsInput,
  StoryArtifact,
  UnpinBuildArtifactsInput
} from '@opentales/sdk';
import { HttpError } from '../../http/HttpError.js';
import { NovelBuildRepository, type NovelBuildTx } from '../../repositories/NovelBuildRepository.js';
import { ProjectAccessRepository } from '../../repositories/ProjectAccessRepository.js';
import { LocalAssetStorage } from '../../repositories/AssetStorage.js';
import { countWords } from '../../utils/wordCount.js';
import { applyContentPatch } from '../../utils/contentPatch.js';
import { WritingUseCase } from '../writings/WritingUseCase.js';
import { toStoryArtifact, toBuildRun } from './novelBuildMapper.js';
import { stableHash, STORY_SCHEMA_VERSION, validateArtifactContent } from './schemas.js';

const unitInclude = {
  branch: { include: { headVersion: true } },
  bindings: true
} satisfies Prisma.BuildManuscriptUnitInclude;

const reviewInclude = {
  units: {
    orderBy: { order: 'asc' as const },
    include: { sourceBuildVersion: { select: { body: true, wordCount: true } } }
  }
} satisfies Prisma.BuildReviewInclude;

type UnitWithHead = Prisma.BuildManuscriptUnitGetPayload<{ include: typeof unitInclude }>;

export class BuildManuscriptUseCase {
  private readonly access: ProjectAccessRepository;
  private readonly builds: NovelBuildRepository;
  private readonly writings = new WritingUseCase();
  private readonly assetStorage = new LocalAssetStorage();

  constructor(private readonly prisma: PrismaClient) {
    this.access = new ProjectAccessRepository(prisma);
    this.builds = new NovelBuildRepository(prisma);
  }

  async list(
    userId: string,
    projectId: string,
    buildRunId: string,
    filter: { kind?: 'chapter' | 'scene'; parentUnitId?: string | null } = {}
  ): Promise<BuildManuscriptUnit[]> {
    await this.assertBuildAccess(userId, projectId, buildRunId);
    const units = await this.prisma.buildManuscriptUnit.findMany({
      where: {
        projectId,
        buildRunId,
        invalidatedAt: null,
        ...(filter.kind ? { kind: filter.kind === 'chapter' ? 'CHAPTER' : 'SCENE' } : {}),
        ...(filter.parentUnitId !== undefined ? { parentUnitId: filter.parentUnitId } : {})
      },
      orderBy: [{ kind: 'asc' }, { containerKey: 'asc' }, { order: 'asc' }],
      include: unitInclude
    });
    return units.map(toBuildUnit);
  }

  async get(userId: string, projectId: string, buildRunId: string, unitId: string): Promise<BuildManuscriptUnit> {
    await this.assertBuildAccess(userId, projectId, buildRunId);
    return toBuildUnit(await this.loadUnit(projectId, buildRunId, unitId));
  }

  async create(
    userId: string,
    projectId: string,
    buildRunId: string,
    input: CreateBuildManuscriptUnitInput
  ): Promise<BuildManuscriptUnit> {
    await this.access.assertPermission(userId, projectId, 'project:write');
    validateIdempotency(input.idempotencyKey);
    const requestHash = stableHash(input);
    const unitId = await this.builds.transaction(async (tx) => {
      const fenced = input.lease ? await this.builds.assertTaskLease(tx, projectId, buildRunId, input.lease) : null;
      const run = fenced?.run ?? await this.builds.lockRun(tx, projectId, buildRunId);
      const replay = await this.builds.operationReplay<JsonObject>(tx, buildRunId, input.idempotencyKey, 'create-build-unit', requestHash);
      if (replay && typeof replay.unitId === 'string') return replay.unitId;
      assertBuildRevision(run.revision, input.expectedBuildRevision);
      if (['COMPLETED', 'CANCELLED'].includes(run.status)) throw new HttpError(409, 'Cannot create manuscript units on a terminal build');
      const kind = input.kind === 'chapter' ? 'CHAPTER' : input.kind === 'scene' ? 'SCENE' : null;
      if (!kind) throw new HttpError(400, 'Unsupported manuscript unit kind');
      const key = required(input.key, 'Unit key', 500);
      const plan = await tx.storyArtifact.findFirst({
        where: {
          id: input.planArtifactId,
          projectId,
          buildRunId,
          type: kind === 'CHAPTER' ? 'CHAPTER_BRIEF' : 'SCENE_PLAN',
          status: { in: ['VALIDATED', 'ACCEPTED'] },
          invalidatedAt: null
        }
      });
      if (!plan) throw new HttpError(400, 'Plan artifact is not a current validated artifact for this build');
      const content = jsonObject(plan.content);
      const plannedKey = stringValue(content[kind === 'CHAPTER' ? 'chapterKey' : 'sceneKey']);
      if (plannedKey !== key) throw new HttpError(409, `Unit key '${key}' does not match bound plan key '${plannedKey}'`);
      let parent: { id: string; key: string } | null = null;
      if (kind === 'SCENE') {
        if (!input.parentUnitId) throw new HttpError(400, 'Scene units require a parent chapter unit');
        parent = await tx.buildManuscriptUnit.findFirst({
          where: { id: input.parentUnitId, projectId, buildRunId, kind: 'CHAPTER', invalidatedAt: null },
          select: { id: true, key: true }
        });
        if (!parent) throw new HttpError(400, 'Parent chapter unit does not belong to this build');
        if (stringValue(content.chapterKey) !== parent.key) throw new HttpError(409, 'Scene plan chapterKey does not match its parent unit');
      } else if (input.parentUnitId) {
        throw new HttpError(400, 'Chapter units cannot have a parent unit');
      }
      await this.assertProjectReferences(tx, projectId, {
        characterIds: input.povCharacterId ? [input.povCharacterId] : [],
        locationIds: input.locationId ? [input.locationId] : [],
        chapterIds: input.sourceChapterId ? [input.sourceChapterId] : [],
        sceneIds: input.sourceSceneId ? [input.sourceSceneId] : []
      });
      if (input.lease) this.assertTaskUnitScope((await this.builds.getTask(tx, buildRunId, input.lease.taskId)).executionPolicy, key, input.parentUnitId);
      validateOrder(input.order);
      validateTension(input.tension);
      const writing = await tx.writing.create({ data: { projectId, kind: kind === 'CHAPTER' ? 'CHAPTER_BODY' : 'SCENE_BODY' } });
      const branch = await tx.writingBranch.create({
        data: { writingId: writing.id, buildRunId, name: run.branchName }
      });
      const body = input.initialBody ?? '';
      const version = await tx.writingVersion.create({
        data: {
          branchId: branch.id,
          body,
          wordCount: countWords(body),
          authorId: userId,
          message: 'Create isolated Novel Build unit'
        }
      });
      await tx.writingBranch.update({ where: { id: branch.id }, data: { headVersionId: version.id } });
      await tx.writing.update({ where: { id: writing.id }, data: { defaultBranchId: branch.id } });
      const unit = await tx.buildManuscriptUnit.create({
        data: {
          projectId,
          buildRunId,
          sourceTaskId: input.lease?.taskId ?? null,
          planArtifactId: plan.id,
          parentUnitId: parent?.id ?? null,
          sourceChapterId: input.sourceChapterId ?? null,
          sourceSceneId: input.sourceSceneId ?? null,
          writingId: writing.id,
          branchId: branch.id,
          kind,
          status: body ? 'DRAFTING' : 'PLANNED',
          key,
          containerKey: parent?.key ?? '__manuscript__',
          order: input.order,
          chapterNumber: kind === 'CHAPTER' ? input.chapterNumber ?? numberValue(content.number) : null,
          title: required(input.title, 'Unit title', 1_000),
          povCharacterId: input.povCharacterId ?? null,
          locationId: input.locationId ?? null,
          storyDate: input.storyDate ?? null,
          storyTime: input.storyTime ?? null,
          tension: input.tension ?? null,
          metadata: toInputJson(input.metadata ?? {}),
        }
      });
      await tx.storyArtifactBinding.create({
        data: {
          projectId,
          buildRunId,
          artifactId: plan.id,
          taskId: input.lease?.taskId ?? null,
          unitId: unit.id,
          bindingKind: 'BUILD_UNIT',
          role: kind === 'CHAPTER' ? 'chapter-plan' : 'scene-plan'
        }
      });
      const updated = await tx.buildRun.update({ where: { id: buildRunId }, data: { revision: { increment: 1 } }, select: { revision: true } });
      await this.builds.saveOperationReceipt(tx, buildRunId, input.idempotencyKey, 'create-build-unit', requestHash, { unitId: unit.id, buildRevision: updated.revision });
      return unit.id;
    });
    return toBuildUnit(await this.loadUnit(projectId, buildRunId, unitId));
  }

  async patch(
    userId: string,
    projectId: string,
    buildRunId: string,
    unitId: string,
    input: PatchBuildManuscriptUnitInput
  ): Promise<BuildManuscriptUnit> {
    await this.access.assertPermission(userId, projectId, 'project:write');
    validateIdempotency(input.idempotencyKey);
    const requestHash = stableHash(input);
    await this.builds.transaction(async (tx) => {
      const fenced = input.lease ? await this.builds.assertTaskLease(tx, projectId, buildRunId, input.lease) : null;
      const run = fenced?.run ?? await this.builds.lockRun(tx, projectId, buildRunId);
      const replay = await this.builds.operationReplay<JsonObject>(tx, buildRunId, input.idempotencyKey, 'patch-build-unit', requestHash);
      if (replay) return;
      if (input.body !== undefined && input.contentPatch !== undefined) {
        throw new HttpError(400, 'body and contentPatch are mutually exclusive');
      }
      assertBuildRevision(run.revision, input.expectedBuildRevision);
      const unit = await tx.buildManuscriptUnit.findFirst({
        where: { id: unitId, projectId, buildRunId, invalidatedAt: null },
        include: { branch: true }
      });
      if (!unit) throw new HttpError(404, 'Build manuscript unit not found');
      if (unit.revision !== input.expectedUnitRevision) throw new HttpError(409, 'Build unit revision is stale', { expected: input.expectedUnitRevision, actual: unit.revision });
      if (input.lease) {
        const task = await this.builds.getTask(tx, buildRunId, input.lease.taskId);
        if (!['drafter', 'reviser'].includes(task.assignedAgent)) throw new HttpError(403, 'Task agent cannot write manuscript prose');
        this.assertTaskUnitScope(task.executionPolicy, unit.key, unit.parentUnitId);
      }
      await tx.$queryRaw`SELECT id FROM "WritingBranch" WHERE id = ${unit.branchId} FOR UPDATE`;
      const branch = await tx.writingBranch.findUniqueOrThrow({
        where: { id: unit.branchId },
        include: { headVersion: { select: { body: true } } }
      });
      if (branch.headVersionId !== input.expectedHeadVersionId) throw new HttpError(409, 'Build unit branch head is stale', { expected: input.expectedHeadVersionId, actual: branch.headVersionId });
      validateTension(input.tension);
      let headVersionId = branch.headVersionId;
      const nextBody = input.contentPatch !== undefined
        ? applyContentPatch(branch.headVersion?.body ?? '', input.contentPatch)
        : input.body;
      if (nextBody !== undefined) {
        validateBody(nextBody);
        const version = await tx.writingVersion.create({
          data: {
            branchId: branch.id,
            sourceTaskId: fenced?.task.id ?? null,
            parentVersionId: branch.headVersionId,
            body: nextBody,
            wordCount: countWords(nextBody),
            authorId: userId,
            message: input.message ? required(input.message, 'Version message', 1_000) : 'Update isolated Novel Build unit'
          }
        });
        const cas = await tx.writingBranch.updateMany({
          where: { id: branch.id, headVersionId: input.expectedHeadVersionId },
          data: { headVersionId: version.id }
        });
        if (cas.count !== 1) throw new HttpError(409, 'Build unit branch head changed concurrently');
        headVersionId = version.id;
      }
      const update = await tx.buildManuscriptUnit.updateMany({
        where: { id: unit.id, revision: input.expectedUnitRevision },
        data: {
          title: input.title === undefined ? undefined : required(input.title, 'Unit title', 1_000),
          status: input.status ? toPrismaUnitStatus(input.status) : undefined,
          tension: input.tension === undefined ? undefined : input.tension,
          metadata: input.metadata === undefined ? undefined : toInputJson(input.metadata),
          revision: { increment: 1 }
        }
      });
      if (update.count !== 1) throw new HttpError(409, 'Build unit revision changed concurrently');
      const build = await tx.buildRun.update({ where: { id: buildRunId }, data: { revision: { increment: 1 } }, select: { revision: true } });
      await this.builds.saveOperationReceipt(tx, buildRunId, input.idempotencyKey, 'patch-build-unit', requestHash, { unitId, headVersionId, buildRevision: build.revision });
    });
    return toBuildUnit(await this.loadUnit(projectId, buildRunId, unitId));
  }

  async reorder(
    userId: string,
    projectId: string,
    buildRunId: string,
    input: ReorderBuildManuscriptUnitsInput
  ): Promise<BuildManuscriptUnit[]> {
    await this.access.assertPermission(userId, projectId, 'project:write');
    validateIdempotency(input.idempotencyKey);
    if (!Array.isArray(input.unitIds) || !input.unitIds.length || new Set(input.unitIds).size !== input.unitIds.length) throw new HttpError(400, 'unitIds must be a non-empty unique ordered list');
    const requestHash = stableHash(input);
    await this.builds.transaction(async (tx) => {
      const run = await this.builds.lockRun(tx, projectId, buildRunId);
      const replay = await this.builds.operationReplay<JsonObject>(tx, buildRunId, input.idempotencyKey, 'reorder-build-units', requestHash);
      if (replay) return;
      assertBuildRevision(run.revision, input.expectedBuildRevision);
      const parent = await tx.buildManuscriptUnit.findFirst({ where: { id: input.parentUnitId, projectId, buildRunId, kind: 'CHAPTER', invalidatedAt: null }, select: { id: true } });
      if (!parent) throw new HttpError(400, 'parentUnitId is not an active chapter unit in this build');
      const units = await tx.buildManuscriptUnit.findMany({ where: { projectId, buildRunId, parentUnitId: parent.id, kind: 'SCENE', invalidatedAt: null }, select: { id: true, revision: true } });
      if (units.length !== input.unitIds.length || units.some((unit) => !input.unitIds.includes(unit.id))) throw new HttpError(409, 'Build-unit reorder must include every active scene in the chapter exactly once');
      for (const unit of units) if (input.expectedUnitRevisions[unit.id] !== unit.revision) throw new HttpError(409, `Build unit '${unit.id}' revision is stale`, { expected: input.expectedUnitRevisions[unit.id], actual: unit.revision });
      await tx.buildManuscriptUnit.updateMany({ where: { id: { in: input.unitIds } }, data: { order: { increment: 1_000_000 } } });
      const rows = input.unitIds.map((id, order) => Prisma.sql`(${id}::text,${order}::integer)`);
      await tx.$executeRaw(Prisma.sql`UPDATE "BuildManuscriptUnit" unit SET "order"=ordered."order", revision=unit.revision+1, "updatedAt"=CURRENT_TIMESTAMP FROM (VALUES ${Prisma.join(rows)}) ordered(id,"order") WHERE unit.id=ordered.id AND unit."buildRunId"=${buildRunId} AND unit."parentUnitId"=${parent.id}`);
      await tx.buildRun.update({ where: { id: buildRunId }, data: { revision: { increment: 1 } } });
      await this.builds.saveOperationReceipt(tx, buildRunId, input.idempotencyKey, 'reorder-build-units', requestHash, { unitIds: input.unitIds });
    });
    return this.list(userId, projectId, buildRunId, { kind: 'scene', parentUnitId: input.parentUnitId });
  }

  async compile(
    userId: string,
    projectId: string,
    buildRunId: string,
    input: CompileBuildManuscriptInput
  ): Promise<BuildCompilation> {
    await this.access.assertPermission(userId, projectId, 'project:write');
    validateIdempotency(input.idempotencyKey);
    const requestHash = stableHash(input);
    const compilationId = await this.builds.transaction(async (tx) => {
      const fenced = input.lease ? await this.builds.assertTaskLease(tx, projectId, buildRunId, input.lease) : null;
      const run = fenced?.run ?? await this.builds.lockRun(tx, projectId, buildRunId);
      const replay = await this.builds.operationReplay<JsonObject>(tx, buildRunId, input.idempotencyKey, 'compile-build-manuscript', requestHash);
      if (replay && typeof replay.compilationId === 'string') return replay.compilationId;
      assertBuildRevision(run.revision, input.expectedBuildRevision);
      if (input.exportManifestArtifactId) throw new HttpError(400, 'Export manifests must be attached through the verified registerExport operation');
      if (input.checkpointId) {
        const checkpoint = await tx.buildCheckpoint.findFirst({ where: { id: input.checkpointId, projectId, buildRunId } });
        if (!checkpoint) throw new HttpError(400, 'Compilation checkpoint does not belong to this build');
      }
      const units = await tx.buildManuscriptUnit.findMany({
        where: { projectId, buildRunId, invalidatedAt: null, status: { not: 'INVALIDATED' } },
        orderBy: [{ kind: 'asc' }, { containerKey: 'asc' }, { order: 'asc' }],
        include: { branch: { include: { headVersion: true } } }
      });
      const chapters = units.filter((unit) => unit.kind === 'CHAPTER').sort((a, b) => (a.chapterNumber ?? a.order) - (b.chapterNumber ?? b.order));
      if (!chapters.length) throw new HttpError(409, 'Build has no isolated chapter units to compile');
      const manifestUnits: JsonValue[] = [];
      const compiledRows: Array<{ unitId: string; writingVersionId: string; order: number; wordCount: number; contentHash: string }> = [];
      let manuscriptOrder = 0;
      for (const chapter of chapters) {
        const scenes = units.filter((unit) => unit.kind === 'SCENE' && unit.parentUnitId === chapter.id).sort((a, b) => a.order - b.order);
        const sceneBodies = scenes.map((scene) => scene.branch.headVersion?.body ?? '');
        const compiledBody = scenes.length ? sceneBodies.join('\n\n***\n\n') : chapter.branch.headVersion?.body ?? '';
        await tx.$queryRaw`SELECT id FROM "WritingBranch" WHERE id = ${chapter.branchId} FOR UPDATE`;
        let chapterVersionId = chapter.branch.headVersionId;
        if ((chapter.branch.headVersion?.body ?? '') !== compiledBody || !chapterVersionId) {
          const version = await tx.writingVersion.create({
            data: {
              branchId: chapter.branchId,
              sourceTaskId: fenced?.task.id ?? null,
              parentVersionId: chapter.branch.headVersionId,
              body: compiledBody,
              wordCount: countWords(compiledBody),
              authorId: userId,
              message: 'Deterministic scene-to-chapter compilation'
            }
          });
          await tx.writingBranch.update({ where: { id: chapter.branchId }, data: { headVersionId: version.id } });
          chapterVersionId = version.id;
        }
        const chapterWords = countWords(compiledBody);
        const chapterHash = stableHash(compiledBody);
        compiledRows.push({ unitId: chapter.id, writingVersionId: chapterVersionId!, order: manuscriptOrder++, wordCount: chapterWords, contentHash: chapterHash });
        manifestUnits.push({ unitId: chapter.id, key: chapter.key, kind: 'chapter', order: chapter.order, chapterNumber: chapter.chapterNumber, writingVersionId: chapterVersionId!, wordCount: chapterWords, contentHash: chapterHash });
        for (const scene of scenes) {
          if (!scene.branch.headVersionId) throw new HttpError(409, `Scene unit '${scene.key}' has no prose version`);
          const body = scene.branch.headVersion?.body ?? '';
          const wordCount = countWords(body);
          const contentHash = stableHash(body);
          compiledRows.push({ unitId: scene.id, writingVersionId: scene.branch.headVersionId, order: manuscriptOrder++, wordCount, contentHash });
          manifestUnits.push({ unitId: scene.id, key: scene.key, kind: 'scene', parentUnitId: chapter.id, order: scene.order, writingVersionId: scene.branch.headVersionId, wordCount, contentHash, tension: scene.tension });
        }
      }
      const totalWordCount = compiledRows.filter((row) => chapters.some((chapter) => chapter.id === row.unitId)).reduce((sum, row) => sum + row.wordCount, 0);
      const manifest = { version: 'build-compilation-v1', buildRunId, branchName: run.branchName, totalWordCount, units: manifestUnits };
      const compilation = await tx.buildCompilation.create({
        data: {
          projectId,
          buildRunId,
          checkpointId: input.checkpointId ?? null,
          exportManifestArtifactId: null,
          idempotencyKey: input.idempotencyKey,
          requestHash,
          manifest: toInputJson(manifest),
          totalWordCount,
          contentHash: stableHash(manifest)
        }
      });
      await tx.buildCompilationUnit.createMany({ data: compiledRows.map((row) => ({ compilationId: compilation.id, ...row })) });
      if (fenced?.task.type === 'compile-chapter-unit') {
        const policy = jsonObject(fenced.task.executionPolicy);
        const chapterKey = typeof policy.chapterKey === 'string' ? policy.chapterKey : null;
        const chapter = chapterKey ? chapters.find((candidate) => candidate.key === chapterKey) : null;
        if (!chapter || !fenced.task.scopeUnitIds.includes(chapter.id)) throw new HttpError(409, 'Chapter compilation task is not scoped to its declared chapter unit');
        const row = compiledRows.find((candidate) => candidate.unitId === chapter.id);
        if (!row || !chapter.planArtifactId) throw new HttpError(409, 'Compiled chapter is missing its plan or prose version');
        const content = validateArtifactContent('chapter-draft', {
          chapterKey: chapter.key,
          planArtifactId: chapter.planArtifactId,
          writingBranchId: chapter.branchId,
          writingVersionId: row.writingVersionId,
          wordCount: row.wordCount,
          summary: typeof (chapter.metadata as Prisma.JsonObject).purpose === 'string'
            ? (chapter.metadata as Prisma.JsonObject).purpose
            : `Compiled draft for ${chapter.title}`
        });
        const current = await tx.storyArtifact.findFirst({
          where: { projectId, buildRunId, type: 'CHAPTER_DRAFT', key: chapter.key, status: { notIn: ['SUPERSEDED', 'INVALIDATED'] }, invalidatedAt: null },
          orderBy: { version: 'desc' }
        });
        if (current) {
          const directive = await tx.buildDirective.findFirst({ where: { buildRunId }, orderBy: { createdAt: 'desc' }, select: { pinnedArtifactIds: true } });
          if (directive?.pinnedArtifactIds.includes(current.id)) throw new HttpError(409, 'The current chapter draft is pinned; explicitly unpin it before recompiling');
          await tx.storyArtifact.update({ where: { id: current.id }, data: { status: 'SUPERSEDED' } });
        }
        const last = await tx.storyArtifact.findFirst({ where: { buildRunId, type: 'CHAPTER_DRAFT', key: chapter.key }, orderBy: { version: 'desc' }, select: { id: true, version: true } });
        const draft = await tx.storyArtifact.create({ data: {
          projectId, buildRunId, taskId: fenced.task.id, type: 'CHAPTER_DRAFT', key: chapter.key,
          title: `${chapter.title} — compiled draft`, version: (last?.version ?? 0) + 1,
          schemaVersion: STORY_SCHEMA_VERSION, status: 'VALIDATED', content: toInputJson(content),
          contentHash: stableHash(content), replacesArtifactId: current?.id ?? null
        } });
        await tx.storyArtifactBinding.createMany({ data: [
          { projectId, buildRunId, artifactId: draft.id, taskId: fenced.task.id, unitId: chapter.id, bindingKind: 'BUILD_UNIT', role: 'compiled-chapter-draft' },
          { projectId, buildRunId, artifactId: draft.id, taskId: fenced.task.id, bindingKind: 'LEDGER', entityType: 'build-compilation', entityId: compilation.id, role: 'chapter-draft' }
        ] });
      }
      const updated = await tx.buildRun.update({ where: { id: buildRunId }, data: { revision: { increment: 1 } }, select: { revision: true } });
      await this.builds.saveOperationReceipt(tx, buildRunId, input.idempotencyKey, 'compile-build-manuscript', requestHash, { compilationId: compilation.id, buildRevision: updated.revision });
      return compilation.id;
    });
    return this.getCompilation(userId, projectId, buildRunId, compilationId);
  }

  async getCompilation(userId: string, projectId: string, buildRunId: string, compilationId: string): Promise<BuildCompilation> {
    await this.assertBuildAccess(userId, projectId, buildRunId);
    const compilation = await this.prisma.buildCompilation.findFirst({
      where: { id: compilationId, projectId, buildRunId },
      include: { units: { orderBy: { order: 'asc' } } }
    });
    if (!compilation) throw new HttpError(404, 'Build compilation not found');
    const draftBindings = await this.prisma.storyArtifactBinding.findMany({
      where: { projectId, buildRunId, bindingKind: 'LEDGER', entityType: 'build-compilation', entityId: compilationId, role: 'chapter-draft' },
      orderBy: { createdAt: 'asc' }, select: { artifactId: true }
    });
    return toCompilation(compilation, draftBindings.map((binding) => binding.artifactId));
  }

  async compare(userId: string, projectId: string, buildRunId: string): Promise<BuildComparison> {
    await this.assertBuildAccess(userId, projectId, buildRunId);
    const [units, compilation, canonFacts, entityStates, timelineEvents, openLoops, plotThreads] = await Promise.all([
      this.prisma.buildManuscriptUnit.findMany({ where: { projectId, buildRunId, invalidatedAt: null }, orderBy: [{ kind: 'asc' }, { containerKey: 'asc' }, { order: 'asc' }], include: unitInclude }),
      this.prisma.buildCompilation.findFirst({ where: { projectId, buildRunId }, orderBy: { createdAt: 'desc' } }),
      this.prisma.canonFact.findMany({ where: { projectId, buildRunId, isCurrent: true, invalidatedAt: null }, select: { id: true } }),
      this.prisma.entityState.findMany({ where: { projectId, buildRunId, isCurrent: true, invalidatedAt: null }, select: { id: true } }),
      this.prisma.timelineEvent.findMany({ where: { projectId, buildRunId, isCurrent: true, invalidatedAt: null }, select: { id: true } }),
      this.prisma.openLoop.findMany({ where: { projectId, buildRunId, isCurrent: true, invalidatedAt: null, status: { in: ['OPEN', 'REINFORCED'] } }, select: { id: true } }),
      this.prisma.plotThread.findMany({ where: { projectId, buildRunId, isCurrent: true, invalidatedAt: null, status: { in: ['PLANNED', 'ACTIVE'] } }, select: { id: true } })
    ]);
    const sourceChapterIds = units.flatMap((unit) => unit.kind === 'CHAPTER' && unit.sourceChapterId ? [unit.sourceChapterId] : []);
    const sourceSceneIds = units.flatMap((unit) => unit.kind === 'SCENE' && unit.sourceSceneId ? [unit.sourceSceneId] : []);
    const [mainChapters, mainScenes] = await Promise.all([
      sourceChapterIds.length ? this.prisma.chapter.findMany({ where: { id: { in: sourceChapterIds }, projectId }, include: { bodyWriting: { include: { defaultBranch: { include: { headVersion: true } } } } } }) : [],
      sourceSceneIds.length ? this.prisma.scene.findMany({ where: { id: { in: sourceSceneIds }, chapter: { projectId } }, include: { bodyWriting: { include: { defaultBranch: { include: { headVersion: true } } } } } }) : []
    ]);
    const chapterById = new Map(mainChapters.map((chapter) => [chapter.id, chapter]));
    const sceneById = new Map(mainScenes.map((scene) => [scene.id, scene]));
    const prose = [];
    for (const unit of units) {
      const main = unit.kind === 'CHAPTER' && unit.sourceChapterId
        ? chapterById.get(unit.sourceChapterId) ?? null
        : unit.kind === 'SCENE' && unit.sourceSceneId
          ? sceneById.get(unit.sourceSceneId) ?? null
          : null;
      const mainHead = main?.bodyWriting.defaultBranch?.headVersion ?? null;
      const buildHead = unit.branch.headVersion;
      prose.push({
        unitId: unit.id,
        unitKey: unit.key,
        kind: unit.kind === 'CHAPTER' ? 'chapter' as const : 'scene' as const,
        title: unit.title,
        mainRefId: unit.kind === 'CHAPTER' ? unit.sourceChapterId : unit.sourceSceneId,
        mainVersionId: mainHead?.id ?? null,
        buildVersionId: buildHead?.id ?? null,
        mainBody: mainHead?.body ?? '',
        buildBody: buildHead?.body ?? '',
        wordDelta: (buildHead?.wordCount ?? 0) - (mainHead?.wordCount ?? 0),
        changed: (buildHead?.body ?? '') !== (mainHead?.body ?? '')
      });
    }
    return {
      projectId,
      buildRunId,
      compilationId: compilation?.id ?? null,
      prose,
      semantic: {
        addedCanonFactIds: canonFacts.map((item) => item.id),
        changedEntityStateIds: entityStates.map((item) => item.id),
        timelineEventIds: timelineEvents.map((item) => item.id),
        unresolvedOpenLoopIds: openLoops.map((item) => item.id),
        activePlotThreadIds: plotThreads.map((item) => item.id)
      }
    };
  }

  async listReviews(userId: string, projectId: string, buildRunId: string): Promise<BuildReview[]> {
    await this.assertBuildAccess(userId, projectId, buildRunId);
    return (await this.prisma.buildReview.findMany({
      where: { projectId, buildRunId }, orderBy: { createdAt: 'desc' }, include: reviewInclude
    })).map(toBuildReview);
  }

  async getReview(userId: string, projectId: string, buildRunId: string, reviewId: string): Promise<BuildReview> {
    await this.assertBuildAccess(userId, projectId, buildRunId);
    const review = await this.prisma.buildReview.findFirst({
      where: { id: reviewId, projectId, buildRunId }, include: reviewInclude
    });
    if (!review) throw new HttpError(404, 'Build review not found');
    return toBuildReview(review);
  }

  async createReview(
    userId: string,
    projectId: string,
    buildRunId: string,
    input: CreateBuildReviewInput
  ): Promise<BuildReview> {
    await this.access.assertPermission(userId, projectId, 'project:write');
    validateIdempotency(input.idempotencyKey);
    const requestHash = stableHash(input);
    const reviewId = await this.builds.transaction(async (tx) => {
      await this.builds.lockRun(tx, projectId, buildRunId);
      const replay = await this.builds.operationReplay<JsonObject>(tx, buildRunId, input.idempotencyKey, 'create-build-review', requestHash);
      if (replay && typeof replay.reviewId === 'string') return replay.reviewId;
      const compilation = await tx.buildCompilation.findFirst({
        where: { id: input.compilationId, projectId, buildRunId },
        include: { units: { include: { unit: { include: { branch: { select: { headVersionId: true } } } } }, orderBy: { order: 'asc' } } }
      });
      if (!compilation) throw new HttpError(400, 'Compilation does not belong to this build');
      if (input.checkpointId) {
        const checkpoint = await tx.buildCheckpoint.findFirst({ where: { id: input.checkpointId, projectId, buildRunId } });
        if (!checkpoint) throw new HttpError(400, 'Review checkpoint does not belong to this build');
      }
      const review = await tx.buildReview.create({
        data: {
          projectId,
          buildRunId,
          compilationId: compilation.id,
          checkpointId: input.checkpointId ?? null,
          createdById: userId,
          title: required(input.title, 'Review title', 1_000),
          message: input.message ? required(input.message, 'Review message', 20_000) : null
        }
      });
      const sourceChapterIds = compilation.units.flatMap((compiled) => compiled.unit.kind === 'CHAPTER' && compiled.unit.sourceChapterId ? [compiled.unit.sourceChapterId] : []);
      const sourceSceneIds = compilation.units.flatMap((compiled) => compiled.unit.kind === 'SCENE' && compiled.unit.sourceSceneId ? [compiled.unit.sourceSceneId] : []);
      const [mainChapters, mainScenes] = await Promise.all([
        sourceChapterIds.length ? tx.chapter.findMany({ where: { id: { in: sourceChapterIds }, projectId, deletedAt: null }, include: { bodyWriting: { include: { defaultBranch: true } } } }) : [],
        sourceSceneIds.length ? tx.scene.findMany({ where: { id: { in: sourceSceneIds }, chapter: { projectId, deletedAt: null } }, include: { bodyWriting: { include: { defaultBranch: true } } } }) : []
      ]);
      const chapterById = new Map(mainChapters.map((chapter) => [chapter.id, chapter]));
      const sceneById = new Map(mainScenes.map((scene) => [scene.id, scene]));
      const reviewUnits = compilation.units.map((compiled) => {
        const unit = compiled.unit;
        if (unit.branch.headVersionId !== compiled.writingVersionId) throw new HttpError(409, `Compilation is stale for build unit '${unit.key}'; compile again before review`);
        const reviewedUnitSnapshot = buildReviewedUnitSnapshot(unit);
        let expectedMainHeadVersionId: string | null = null;
        if (unit.kind === 'CHAPTER' && unit.sourceChapterId) {
          const chapter = chapterById.get(unit.sourceChapterId);
          if (!chapter) throw new HttpError(409, `Mapped main chapter for unit '${unit.key}' no longer exists`);
          expectedMainHeadVersionId = chapter.bodyWriting.defaultBranch?.headVersionId ?? null;
        }
        if (unit.kind === 'SCENE' && unit.sourceSceneId) {
          const scene = sceneById.get(unit.sourceSceneId);
          if (!scene) throw new HttpError(409, `Mapped main scene for unit '${unit.key}' no longer exists`);
          expectedMainHeadVersionId = scene.bodyWriting.defaultBranch?.headVersionId ?? null;
        }
        return {
          reviewId: review.id, unitId: unit.id, action: unit.sourceChapterId || unit.sourceSceneId ? 'UPDATE' as const : 'CREATE' as const,
          targetChapterId: unit.sourceChapterId, targetSceneId: unit.sourceSceneId, expectedMainHeadVersionId,
          sourceBuildVersionId: compiled.writingVersionId,
          reviewedUnitRevision: unit.revision,
          reviewedUnitSnapshot: toInputJson(reviewedUnitSnapshot),
          reviewedUnitSnapshotHash: stableHash(reviewedUnitSnapshot),
          reviewedContentHash: compiled.contentHash,
          order: compiled.order
        };
      });
      if (reviewUnits.length) await tx.buildReviewUnit.createMany({ data: reviewUnits });
      await this.builds.saveOperationReceipt(tx, buildRunId, input.idempotencyKey, 'create-build-review', requestHash, { reviewId: review.id });
      return review.id;
    });
    return this.getReview(userId, projectId, buildRunId, reviewId);
  }

  async approveReview(
    userId: string,
    projectId: string,
    buildRunId: string,
    reviewId: string,
    input: ApproveBuildReviewInput
  ): Promise<BuildReview> {
    await this.assertOwner(userId, projectId);
    if (input.confirm !== true) throw new HttpError(400, 'Explicit owner confirmation is required');
    validateIdempotency(input.idempotencyKey);
    const requestHash = stableHash(input);
    await this.builds.transaction(async (tx) => {
      await this.builds.lockRun(tx, projectId, buildRunId);
      const replay = await this.builds.operationReplay<JsonObject>(tx, buildRunId, input.idempotencyKey, `approve-build-review:${reviewId}`, requestHash);
      if (replay) return;
      await tx.$queryRaw`SELECT id FROM "BuildReview" WHERE id = ${reviewId} FOR UPDATE`;
      const review = await tx.buildReview.findFirst({ where: { id: reviewId, projectId, buildRunId }, include: { units: { include: { unit: true, sourceBuildVersion: true } } } });
      if (!review) throw new HttpError(404, 'Build review not found');
      if (review.status !== 'OPEN') throw new HttpError(409, 'Only an open review can be approved');
      if (review.revision !== input.expectedRevision) throw new HttpError(409, 'Build review revision is stale');
      for (const item of review.units) {
        if (item.reviewedUnitSnapshotHash === 'legacy-review-recreate-required') throw new HttpError(409, 'Review predates immutable unit snapshots and must be recreated');
        const snapshot = jsonObject(item.reviewedUnitSnapshot);
        if (stableHash(snapshot) !== item.reviewedUnitSnapshotHash) throw new HttpError(409, `Reviewed unit snapshot '${item.unitId}' failed integrity validation`);
        if (item.unit.revision !== item.reviewedUnitRevision || stableHash(buildReviewedUnitSnapshot(item.unit)) !== item.reviewedUnitSnapshotHash) {
          throw new HttpError(409, `Build unit '${item.unit.key}' changed after review creation`);
        }
        if (stableHash(item.sourceBuildVersion.body ?? '') !== item.reviewedContentHash) throw new HttpError(409, `Reviewed prose '${item.unit.key}' failed content-hash validation`);
      }
      await tx.buildReview.update({
        where: { id: review.id },
        data: { status: 'APPROVED', approvedById: userId, approvedAt: new Date(), revision: { increment: 1 } }
      });
      await this.builds.saveOperationReceipt(tx, buildRunId, input.idempotencyKey, `approve-build-review:${reviewId}`, requestHash, { reviewId });
    });
    return this.getReview(userId, projectId, buildRunId, reviewId);
  }

  async mergeReview(
    userId: string,
    projectId: string,
    buildRunId: string,
    reviewId: string,
    input: MergeBuildReviewInput
  ): Promise<BuildReview> {
    await this.assertOwner(userId, projectId);
    if (input.confirm !== true) throw new HttpError(400, 'Explicit owner confirmation is required');
    validateIdempotency(input.idempotencyKey);
    const requestHash = stableHash(input);
    await this.builds.transaction(async (tx) => {
      await this.builds.lockRun(tx, projectId, buildRunId);
      const replay = await this.builds.operationReplay<JsonObject>(tx, buildRunId, input.idempotencyKey, `merge-build-review:${reviewId}`, requestHash);
      if (replay) return;
      await tx.$queryRaw`SELECT id FROM "BuildReview" WHERE id = ${reviewId} FOR UPDATE`;
      const review = await tx.buildReview.findFirst({
        where: { id: reviewId, projectId, buildRunId },
        include: { units: { include: { unit: true, sourceBuildVersion: true }, orderBy: { order: 'asc' } } }
      });
      if (!review) throw new HttpError(404, 'Build review not found');
      if (review.status !== 'APPROVED') throw new HttpError(409, 'Review requires owner approval before merge');
      if (review.revision !== input.expectedRevision) throw new HttpError(409, 'Build review revision is stale');
      const reviewedSnapshots = new Map<string, JsonObject>();
      for (const item of review.units) {
        if (item.reviewedUnitSnapshotHash === 'legacy-review-recreate-required') throw new HttpError(409, 'Review predates immutable unit snapshots and must be recreated');
        const rawSnapshot = jsonObject(item.reviewedUnitSnapshot);
        const snapshot = rawSnapshot as unknown as JsonObject;
        if (stableHash(snapshot) !== item.reviewedUnitSnapshotHash) throw new HttpError(409, `Reviewed unit snapshot '${item.unitId}' failed integrity validation`);
        if (item.unit.revision !== item.reviewedUnitRevision || stableHash(buildReviewedUnitSnapshot(item.unit)) !== item.reviewedUnitSnapshotHash) {
          throw new HttpError(409, `Build unit '${item.unit.key}' changed after review creation`);
        }
        if (stableHash(item.sourceBuildVersion.body ?? '') !== item.reviewedContentHash) throw new HttpError(409, `Reviewed prose '${item.unit.key}' failed content-hash validation`);
        reviewedSnapshots.set(item.id, snapshot);
      }
      const [characters, locations, plotThreads, setupPayoffs] = await Promise.all([
        tx.character.findMany({ where: { projectId }, select: { id: true, name: true, aliases: true } }),
        tx.location.findMany({ where: { projectId }, select: { id: true, name: true } }),
        tx.plotThread.findMany({ where: { projectId, buildRunId, isCurrent: true, invalidatedAt: null }, select: { id: true, key: true } }),
        tx.setupPayoffLink.findMany({ where: { projectId, buildRunId, isCurrent: true, invalidatedAt: null }, select: { id: true, key: true } })
      ]);
      const characterRefs = referenceMap(characters.flatMap((character) => [character.id, character.name, ...character.aliases].map((value) => [value, character.id] as const)));
      const locationRefs = referenceMap(locations.flatMap((location) => [[location.id, location.id] as const, [location.name, location.id] as const]));
      const plotThreadRefs = referenceMap(plotThreads.flatMap((thread) => [[thread.id, thread.id] as const, [thread.key, thread.id] as const]));
      const setupPayoffRefs = referenceMap(setupPayoffs.flatMap((setup) => [[setup.id, setup.id] as const, [setup.key, setup.id] as const]));
      const chapterTargets = new Map<string, string>();
      for (const item of review.units.filter((item) => item.unit.kind === 'CHAPTER')) {
        const snapshot = reviewedSnapshots.get(item.id)!;
        const body = item.sourceBuildVersion.body ?? '';
        const metadata = jsonObject(snapshot.metadata as Prisma.JsonValue);
        const povCharacterId = nullableId(snapshot.povCharacterId) ?? resolveStructuredReference(metadata.povRef, characterRefs);
        const locationId = nullableId(snapshot.locationId) ?? resolveStructuredReference(metadata.locationRef, locationRefs);
        let chapterId = item.targetChapterId;
        let resultVersionId: string;
        if (item.action === 'UPDATE') {
          if (!chapterId) throw new HttpError(409, 'Review update is missing its target chapter');
          const chapter = await tx.chapter.findFirst({ where: { id: chapterId, projectId, deletedAt: null }, include: { bodyWriting: { include: { defaultBranch: true } } } });
          if (!chapter?.bodyWriting.defaultBranch) throw new HttpError(409, 'Target chapter has no main branch');
          resultVersionId = await this.mergeWritingHead(tx, chapter.bodyWriting.defaultBranch.id, item.expectedMainHeadVersionId, body, userId, `Merge Novel Build ${buildRunId}`);
          await tx.chapter.update({ where: { id: chapter.id }, data: {
            title: required(snapshot.title, 'Reviewed chapter title', 1_000), povCharacterId, locationId,
            summary: nullableString(metadata.summary) ?? nullableString(metadata.purpose)
          } });
        } else {
          const chapterNumber = numberValue(snapshot.chapterNumber);
          if (chapterNumber === null) throw new HttpError(409, `New chapter unit '${item.unit.key}' has no chapter number`);
          const duplicate = await tx.chapter.findFirst({ where: { projectId, number: chapterNumber, deletedAt: null } });
          if (duplicate) throw new HttpError(409, `Chapter number ${chapterNumber} already exists on main`);
          const writingId = await this.writings.createWriting(tx, { projectId, kind: 'CHAPTER_BODY', body, authorId: userId, message: `Merge Novel Build ${buildRunId}` });
          const writing = await tx.writing.findUniqueOrThrow({ where: { id: writingId }, include: { defaultBranch: true } });
          resultVersionId = writing.defaultBranch!.headVersionId!;
          const chapter = await tx.chapter.create({
            data: {
              projectId,
              number: chapterNumber,
              order: requiredInteger(snapshot.order, 'Reviewed chapter order'),
              title: required(snapshot.title, 'Reviewed chapter title', 1_000),
              status: 'DRAFT',
              povCharacterId,
              locationId,
              summary: nullableString(metadata.summary) ?? nullableString(metadata.purpose),
              bodyWritingId: writingId
            }
          });
          chapterId = chapter.id;
        }
        chapterTargets.set(item.unit.id, chapterId!);
        await tx.buildManuscriptUnit.update({ where: { id: item.unit.id }, data: { sourceChapterId: chapterId, revision: { increment: 1 } } });
        await tx.buildReviewUnit.update({ where: { id: item.id }, data: { targetChapterId: chapterId, resultMainVersionId: resultVersionId } });
      }
      for (const item of review.units.filter((item) => item.unit.kind === 'SCENE')) {
        const snapshot = reviewedSnapshots.get(item.id)!;
        const body = item.sourceBuildVersion.body ?? '';
        const metadata = jsonObject(snapshot.metadata as Prisma.JsonValue);
        const povCharacterId = nullableId(snapshot.povCharacterId) ?? resolveStructuredReference(metadata.povRef, characterRefs);
        const locationId = nullableId(snapshot.locationId) ?? resolveStructuredReference(metadata.locationRef, locationRefs);
        const sceneFields = {
          order: requiredInteger(snapshot.order, 'Reviewed scene order'),
          title: required(snapshot.title, 'Reviewed scene title', 1_000),
          povCharacterId,
          locationId,
          storyDate: nullableString(snapshot.storyDate),
          storyTime: nullableString(snapshot.storyTime),
          estimatedWordCount: numberValue(metadata.estimatedWordCount) ?? numberValue(metadata.targetWordCount),
          tension: numberValue(snapshot.tension),
          sceneFunction: nullableString(metadata.function),
          goal: nullableString(metadata.goal),
          obstacle: nullableString(metadata.obstacle),
          stakes: nullableString(metadata.stakes),
          conflict: nullableString(metadata.conflict),
          turn: nullableString(metadata.turn),
          revelation: stringArray(metadata.revelations).join('; ') || null,
          outcome: nullableString(metadata.outcome),
          emotionalValueShift: nullableString(metadata.emotionalValueShift),
          characterPresentIds: resolveStringReferences(stringArray(metadata.characterPresentIds), characterRefs).length
            ? resolveStringReferences(stringArray(metadata.characterPresentIds), characterRefs)
            : resolveStructuredReferences(metadata.characterRefs, 'character', characterRefs),
          characterReferencedIds: resolveStringReferences(stringArray(metadata.characterReferencedIds), characterRefs),
          plotThreadIds: resolveStructuredReferences(metadata.plotThreadRefs, 'plot-thread', plotThreadRefs),
          setupPayoffIds: resolveStructuredReferences(metadata.setupPayoffRefs, 'setup-payoff', setupPayoffRefs),
          knowledgeDeltas: nullableJson(metadata.knowledgeDeltas),
          objectTransfers: nullableJson(metadata.objectTransfers),
          injuryStateChanges: nullableJson(metadata.injuryStateChanges),
          worldRuleRefs: nullableJson(metadata.worldRuleRefs),
          entryState: nullableJson(metadata.entryState),
          exitState: nullableJson(metadata.exitState),
          summary: nullableString(metadata.summary),
          writerNotes: nullableString(metadata.writerNotes),
          aiNotes: nullableString(metadata.aiNotes),
          actualWordCount: countWords(body)
        };
        let sceneId = item.targetSceneId;
        let resultVersionId: string;
        if (item.action === 'UPDATE') {
          if (!sceneId) throw new HttpError(409, 'Review update is missing its target scene');
          const scene = await tx.scene.findFirst({ where: { id: sceneId, chapter: { projectId, deletedAt: null } }, include: { bodyWriting: { include: { defaultBranch: true } } } });
          if (!scene?.bodyWriting.defaultBranch) throw new HttpError(409, 'Target scene has no main branch');
          resultVersionId = await this.mergeWritingHead(tx, scene.bodyWriting.defaultBranch.id, item.expectedMainHeadVersionId, body, userId, `Merge Novel Build ${buildRunId}`);
          await tx.scene.update({ where: { id: scene.id }, data: { ...sceneFields, revision: { increment: 1 } } });
        } else {
          const parentUnitId = nullableId(snapshot.parentUnitId);
          const chapterId = parentUnitId ? chapterTargets.get(parentUnitId) : null;
          if (!chapterId) throw new HttpError(409, `Scene unit '${item.unit.key}' has no merged parent chapter`);
          const writingId = await this.writings.createWriting(tx, { projectId, kind: 'SCENE_BODY', body, authorId: userId, message: `Merge Novel Build ${buildRunId}` });
          const writing = await tx.writing.findUniqueOrThrow({ where: { id: writingId }, include: { defaultBranch: true } });
          resultVersionId = writing.defaultBranch!.headVersionId!;
          const scene = await tx.scene.create({
            data: {
              chapterId,
              status: 'DRAFT',
              ...sceneFields,
              bodyWritingId: writingId
            }
          });
          sceneId = scene.id;
        }
        await tx.buildManuscriptUnit.update({ where: { id: item.unit.id }, data: { sourceSceneId: sceneId, revision: { increment: 1 } } });
        await tx.buildReviewUnit.update({ where: { id: item.id }, data: { targetSceneId: sceneId, resultMainVersionId: resultVersionId } });
      }
      await tx.buildReview.update({
        where: { id: review.id },
        data: { status: 'MERGED', mergedById: userId, mergedAt: new Date(), revision: { increment: 1 } }
      });
      await this.builds.saveOperationReceipt(tx, buildRunId, input.idempotencyKey, `merge-build-review:${reviewId}`, requestHash, { reviewId });
    });
    return this.getReview(userId, projectId, buildRunId, reviewId);
  }

  async rejectReview(
    userId: string,
    projectId: string,
    buildRunId: string,
    reviewId: string,
    input: RejectBuildReviewInput
  ): Promise<BuildReview> {
    await this.assertOwner(userId, projectId);
    if (input.confirm !== true) throw new HttpError(400, 'Explicit owner confirmation is required');
    validateIdempotency(input.idempotencyKey);
    const reason = required(input.reason, 'Rejection reason', 20_000);
    const requestHash = stableHash(input);
    await this.builds.transaction(async (tx) => {
      await this.builds.lockRun(tx, projectId, buildRunId);
      const replay = await this.builds.operationReplay<JsonObject>(tx, buildRunId, input.idempotencyKey, `reject-build-review:${reviewId}`, requestHash);
      if (replay) return;
      await tx.$queryRaw`SELECT id FROM "BuildReview" WHERE id = ${reviewId} FOR UPDATE`;
      const review = await tx.buildReview.findFirst({ where: { id: reviewId, projectId, buildRunId } });
      if (!review) throw new HttpError(404, 'Build review not found');
      if (!['OPEN', 'APPROVED'].includes(review.status)) throw new HttpError(409, 'Only an open or approved review can be rejected');
      if (review.revision !== input.expectedRevision) throw new HttpError(409, 'Build review revision is stale');
      await tx.buildReview.update({
        where: { id: review.id },
        data: { status: 'REJECTED', rejectedAt: new Date(), rejectionReason: reason, revision: { increment: 1 } }
      });
      await this.builds.saveOperationReceipt(tx, buildRunId, input.idempotencyKey, `reject-build-review:${reviewId}`, requestHash, { reviewId });
    });
    return this.getReview(userId, projectId, buildRunId, reviewId);
  }

  async registerExport(
    userId: string,
    projectId: string,
    buildRunId: string,
    input: RegisterBuildExportInput
  ): Promise<StoryArtifact> {
    await this.access.assertPermission(userId, projectId, 'project:admin');
    validateIdempotency(input.idempotencyKey);
    if (!Array.isArray(input.outputs) || input.outputs.length < 1 || input.outputs.length > 20) throw new HttpError(400, 'At least one real export output is required');
    const requestHash = stableHash(input);
    const artifactId = await this.builds.transaction(async (tx) => {
      const run = await this.builds.lockRun(tx, projectId, buildRunId);
      await this.assertVerifiedExportOutputs(tx, projectId, buildRunId, input.compilationId, input.outputs);
      const replay = await this.builds.operationReplay<JsonObject>(tx, buildRunId, input.idempotencyKey, 'register-build-export', requestHash);
      if (replay && typeof replay.artifactId === 'string') return replay.artifactId;
      assertBuildRevision(run.revision, input.expectedBuildRevision);
      const compilation = await tx.buildCompilation.findFirst({ where: { id: input.compilationId, projectId, buildRunId } });
      if (!compilation) throw new HttpError(400, 'Compilation does not belong to this build');
      const assetIds = [...new Set(input.outputs.map((output) => output.assetId))];
      const assets = await tx.asset.findMany({ where: { id: { in: assetIds }, projectId, kind: { in: ['DOCUMENT', 'TEXT_BLOB'] } } });
      if (assets.length !== assetIds.length) throw new HttpError(400, 'Every export output must reference a persisted project document asset');
      for (const output of input.outputs) {
        const asset = assets.find((candidate) => candidate.id === output.assetId)!;
        if (asset.mimeType !== output.mimeType) throw new HttpError(400, `Export MIME type does not match asset '${asset.id}'`);
        if (output.checksum && asset.checksum && output.checksum !== asset.checksum) throw new HttpError(400, `Export checksum does not match asset '${asset.id}'`);
      }
      const content = validateArtifactContent('export-manifest', {
        compilationId: compilation.id,
        totalWordCount: compilation.totalWordCount,
        contentHash: compilation.contentHash,
        outputs: input.outputs.map(({ projectExportId: _projectExportId, ...output }) => output),
        generatedAt: new Date().toISOString()
      });
      const key = `export-manifest:${compilation.id}`;
      const previous = await tx.storyArtifact.findFirst({ where: { buildRunId, type: 'EXPORT_MANIFEST', key }, orderBy: { version: 'desc' } });
      if (previous) {
        const directive = await tx.buildDirective.findFirst({ where: { buildRunId }, orderBy: { createdAt: 'desc' }, select: { pinnedArtifactIds: true } });
        if (directive?.pinnedArtifactIds.includes(previous.id)) throw new HttpError(409, 'The current export manifest is pinned; explicitly unpin it before replacement');
      }
      const artifact = await tx.storyArtifact.create({
        data: {
          projectId,
          buildRunId,
          type: 'EXPORT_MANIFEST',
          key,
          title: 'Export Manifest',
          version: (previous?.version ?? 0) + 1,
          schemaVersion: 'story-ir-v1',
          status: 'VALIDATED',
          content: toInputJson(content),
          contentHash: stableHash(content),
          replacesArtifactId: previous?.id ?? null
        }
      });
      if (previous) await tx.storyArtifact.update({ where: { id: previous.id }, data: { status: 'SUPERSEDED' } });
      await tx.buildCompilation.update({ where: { id: compilation.id }, data: { exportManifestArtifactId: artifact.id } });
      await tx.storyArtifactBinding.create({
        data: { projectId, buildRunId, artifactId: artifact.id, bindingKind: 'LEDGER', entityType: 'build-compilation', entityId: compilation.id, role: 'export-manifest' }
      });
      await tx.buildRun.update({ where: { id: buildRunId }, data: { revision: { increment: 1 } } });
      await this.builds.saveOperationReceipt(tx, buildRunId, input.idempotencyKey, 'register-build-export', requestHash, { artifactId: artifact.id });
      return artifact.id;
    });
    return toStoryArtifact(await this.prisma.storyArtifact.findUniqueOrThrow({ where: { id: artifactId } }));
  }

  private async assertVerifiedExportOutputs(
    db: PrismaClient | NovelBuildTx,
    projectId: string,
    buildRunId: string,
    compilationId: string,
    outputs: RegisterBuildExportInput['outputs']
  ): Promise<void> {
    const compilation = await db.buildCompilation.findFirst({
      where: { id: compilationId, projectId, buildRunId },
      include: { units: { include: { unit: { select: { kind: true } } } } }
    });
    if (!compilation) throw new HttpError(400, 'Compilation does not belong to this build');
    const chapterHeads = compilation.units
      .filter((row) => row.unit.kind === 'CHAPTER')
      .map((row) => ({ versionId: row.writingVersionId, contentHash: row.contentHash }));
    for (const output of outputs) {
      if (typeof output.projectExportId !== 'string' || !output.projectExportId) throw new HttpError(400, 'Every build output must name its READY verified ProjectExport');
      const record = await db.projectExport.findFirst({
        where: {
          id: output.projectExportId,
          projectId,
          buildRunId,
          compilationId,
          assetId: output.assetId,
          status: 'READY',
          deletedAt: null
        },
        include: { asset: true }
      });
      if (!record?.asset) throw new HttpError(400, `Export asset '${output.assetId}' is not backed by a READY verified project export`);
      if (record.target !== 'BUILD') throw new HttpError(400, `Project export '${record.id}' is not a build-target export`);
      if (record.asset.isPublic || record.asset.s3Bucket !== LocalAssetStorage.bucket) throw new HttpError(400, `Export asset '${output.assetId}' is not in private managed storage`);
      if (record.format.toLowerCase().replaceAll('_', '-') !== output.format) throw new HttpError(400, `Export format does not match verified export '${record.id}'`);
      if (record.mimeType !== output.mimeType || record.asset.mimeType !== output.mimeType) throw new HttpError(400, `Export MIME type does not match verified export '${record.id}'`);
      if (!record.checksum || record.checksum !== output.checksum || record.asset.checksum !== record.checksum) throw new HttpError(400, `Export checksum does not match verified export '${record.id}'`);
      if (record.sizeBytes === null || record.sizeBytes !== record.asset.sizeBytes) throw new HttpError(400, `Export size does not match verified export '${record.id}'`);
      const provenance = jsonObject(record.provenance);
      if (provenance.contentHash !== compilation.contentHash || provenance.compilationId !== compilation.id) throw new HttpError(400, `Export provenance does not match compilation '${compilation.id}'`);
      const heads = Array.isArray(record.branchHeads) ? record.branchHeads.map(jsonObject) : [];
      if (chapterHeads.some((head) => !heads.some((candidate) => candidate.versionId === head.versionId && candidate.contentHash === head.contentHash))) {
        throw new HttpError(400, `Export branch-head provenance does not match compilation '${compilation.id}'`);
      }
      const digest = createHash('sha256');
      let size = 0;
      for await (const chunk of await this.assetStorage.readStream(record.asset.s3Key)) {
        const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        size += bytes.length;
        digest.update(bytes);
      }
      if (BigInt(size) !== record.asset.sizeBytes || digest.digest('hex') !== record.checksum) throw new HttpError(409, `Export bytes failed checksum verification for '${record.id}'`);
    }
  }

  async unpin(
    userId: string,
    projectId: string,
    buildRunId: string,
    input: UnpinBuildArtifactsInput
  ) {
    await this.access.assertPermission(userId, projectId, 'project:write');
    const requestHash = stableHash(input);
    await this.builds.transaction(async (tx) => {
      const run = await this.builds.lockRun(tx, projectId, buildRunId);
      const replay = await this.builds.operationReplay<JsonObject>(tx, buildRunId, input.idempotencyKey, 'unpin-build-artifacts', requestHash);
      if (replay) return;
      assertBuildRevision(run.revision, input.expectedRevision);
      const active = await tx.buildDirective.findFirst({ where: { projectId, buildRunId }, orderBy: { createdAt: 'desc' } });
      if (!active) throw new HttpError(409, 'Build has no active directive with pinned artifacts');
      const ids = [...new Set(input.artifactIds)];
      if (ids.some((id) => !active.pinnedArtifactIds.includes(id))) throw new HttpError(400, 'One or more artifacts are not currently pinned');
      const remaining = active.pinnedArtifactIds.filter((id) => !ids.includes(id));
      await tx.buildDirective.create({
        data: {
          projectId,
          buildRunId,
          fromTaskId: active.fromTaskId,
          checkpointId: active.checkpointId,
          createdById: userId,
          idempotencyKey: input.idempotencyKey,
          directive: active.directive,
          pinnedArtifactIds: remaining
        }
      });
      await tx.buildRun.update({ where: { id: buildRunId }, data: { revision: { increment: 1 } } });
      await this.builds.saveOperationReceipt(tx, buildRunId, input.idempotencyKey, 'unpin-build-artifacts', requestHash, { remaining });
    });
    return toBuildRun(await this.builds.get(projectId, buildRunId));
  }

  private async mergeWritingHead(
    tx: NovelBuildTx,
    branchId: string,
    expectedHeadVersionId: string | null,
    body: string,
    userId: string,
    message: string
  ): Promise<string> {
    await tx.$queryRaw`SELECT id FROM "WritingBranch" WHERE id = ${branchId} FOR UPDATE`;
    const branch = await tx.writingBranch.findUniqueOrThrow({ where: { id: branchId } });
    if (branch.headVersionId !== expectedHeadVersionId) throw new HttpError(409, 'Main manuscript changed after review creation');
    const version = await tx.writingVersion.create({
      data: { branchId, parentVersionId: branch.headVersionId, body, wordCount: countWords(body), authorId: userId, message }
    });
    const cas = await tx.writingBranch.updateMany({ where: { id: branchId, headVersionId: expectedHeadVersionId }, data: { headVersionId: version.id } });
    if (cas.count !== 1) throw new HttpError(409, 'Main manuscript changed concurrently');
    return version.id;
  }

  private async assertOwner(userId: string, projectId: string): Promise<Role> {
    const role = await this.access.getProjectRole(userId, projectId);
    if (role !== 'OWNER') throw new HttpError(403, 'Only the project owner may approve or merge a Novel Build review');
    return role;
  }

  private async loadUnit(projectId: string, buildRunId: string, unitId: string): Promise<UnitWithHead> {
    const unit = await this.prisma.buildManuscriptUnit.findFirst({ where: { id: unitId, projectId, buildRunId }, include: unitInclude });
    if (!unit) throw new HttpError(404, 'Build manuscript unit not found');
    return unit;
  }

  private async assertBuildAccess(userId: string, projectId: string, buildRunId: string) {
    await this.access.assertProjectAccess(userId, projectId);
    const build = await this.prisma.buildRun.findFirst({ where: { id: buildRunId, projectId }, select: { id: true } });
    if (!build) throw new HttpError(404, 'Novel Build not found');
  }

  private async assertProjectReferences(
    tx: NovelBuildTx,
    projectId: string,
    refs: { characterIds: string[]; locationIds: string[]; chapterIds: string[]; sceneIds: string[] }
  ) {
    const [characters, locations, chapters, scenes] = await Promise.all([
      refs.characterIds.length ? tx.character.count({ where: { projectId, id: { in: refs.characterIds } } }) : 0,
      refs.locationIds.length ? tx.location.count({ where: { projectId, id: { in: refs.locationIds } } }) : 0,
      refs.chapterIds.length ? tx.chapter.count({ where: { projectId, id: { in: refs.chapterIds }, deletedAt: null } }) : 0,
      refs.sceneIds.length ? tx.scene.count({ where: { id: { in: refs.sceneIds }, chapter: { projectId, deletedAt: null } } }) : 0
    ]);
    if (characters !== refs.characterIds.length || locations !== refs.locationIds.length || chapters !== refs.chapterIds.length || scenes !== refs.sceneIds.length) {
      throw new HttpError(400, 'One or more manuscript-unit references belong to another project');
    }
  }

  private assertTaskUnitScope(rawPolicy: Prisma.JsonValue, unitKey: string, parentUnitId?: string | null) {
    const policy = jsonObject(rawPolicy);
    const keys = stringArray(policy.unitKeys).concat(stringArray(policy.chapterKeys), stringArray(policy.sceneKeys));
    const ids = stringArray(policy.unitIds).concat(typeof policy.chapterUnitId === 'string' ? [policy.chapterUnitId] : []);
    if (keys.length && !keys.includes(unitKey)) throw new HttpError(403, `Task is not scoped to unit '${unitKey}'`);
    if (parentUnitId && ids.length && !ids.includes(parentUnitId)) throw new HttpError(403, 'Task is not scoped to the parent manuscript unit');
  }
}

function toBuildUnit(unit: UnitWithHead): BuildManuscriptUnit {
  return {
    id: unit.id,
    projectId: unit.projectId,
    buildRunId: unit.buildRunId,
    sourceTaskId: unit.sourceTaskId,
    planArtifactId: unit.planArtifactId,
    parentUnitId: unit.parentUnitId,
    sourceChapterId: unit.sourceChapterId,
    sourceSceneId: unit.sourceSceneId,
    writingId: unit.writingId,
    branchId: unit.branchId,
    headVersionId: unit.branch.headVersionId,
    kind: unit.kind === 'CHAPTER' ? 'chapter' : 'scene',
    status: unit.status.toLowerCase() as BuildManuscriptUnit['status'],
    key: unit.key,
    containerKey: unit.containerKey,
    order: unit.order,
    chapterNumber: unit.chapterNumber,
    title: unit.title,
    povCharacterId: unit.povCharacterId,
    locationId: unit.locationId,
    storyDate: unit.storyDate,
    storyTime: unit.storyTime,
    tension: unit.tension,
    metadata: unit.metadata as JsonValue,
    revision: unit.revision,
    body: unit.branch.headVersion?.body ?? '',
    wordCount: unit.branch.headVersion?.wordCount ?? 0,
    invalidatedAt: unit.invalidatedAt?.toISOString() ?? null,
    createdAt: unit.createdAt.toISOString(),
    updatedAt: unit.updatedAt.toISOString()
  };
}

function toCompilation(compilation: Prisma.BuildCompilationGetPayload<{ include: { units: true } }>, chapterDraftArtifactIds: string[] = []): BuildCompilation {
  return {
    id: compilation.id,
    projectId: compilation.projectId,
    buildRunId: compilation.buildRunId,
    checkpointId: compilation.checkpointId,
    exportManifestArtifactId: compilation.exportManifestArtifactId,
    manifest: compilation.manifest as JsonValue,
    totalWordCount: compilation.totalWordCount,
    contentHash: compilation.contentHash,
    chapterDraftArtifactIds,
    createdAt: compilation.createdAt.toISOString(),
    units: compilation.units.sort((a, b) => a.order - b.order).map((unit) => ({
      id: unit.id,
      unitId: unit.unitId,
      writingVersionId: unit.writingVersionId,
      order: unit.order,
      wordCount: unit.wordCount,
      contentHash: unit.contentHash
    }))
  };
}

function toBuildReview(review: Prisma.BuildReviewGetPayload<{ include: typeof reviewInclude }>): BuildReview {
  const status = { OPEN: 'open', APPROVED: 'approved', MERGED: 'merged', REJECTED: 'rejected' } as const;
  return {
    id: review.id,
    projectId: review.projectId,
    buildRunId: review.buildRunId,
    compilationId: review.compilationId,
    checkpointId: review.checkpointId,
    title: review.title,
    message: review.message,
    status: status[review.status],
    revision: review.revision,
    approvedAt: review.approvedAt?.toISOString() ?? null,
    mergedAt: review.mergedAt?.toISOString() ?? null,
    rejectedAt: review.rejectedAt?.toISOString() ?? null,
    rejectionReason: review.rejectionReason,
    createdAt: review.createdAt.toISOString(),
    updatedAt: review.updatedAt.toISOString(),
    units: review.units.sort((a, b) => a.order - b.order).map((unit) => ({
      id: unit.id,
      unitId: unit.unitId,
      action: unit.action === 'CREATE' ? 'create' : 'update',
      targetChapterId: unit.targetChapterId,
      targetSceneId: unit.targetSceneId,
      expectedMainHeadVersionId: unit.expectedMainHeadVersionId,
      sourceBuildVersionId: unit.sourceBuildVersionId,
      reviewedUnitRevision: unit.reviewedUnitRevision,
      reviewedUnitSnapshot: unit.reviewedUnitSnapshot as JsonValue,
      reviewedUnitSnapshotHash: unit.reviewedUnitSnapshotHash,
      reviewedBody: unit.sourceBuildVersion.body ?? '',
      reviewedWordCount: unit.sourceBuildVersion.wordCount,
      reviewedContentHash: unit.reviewedContentHash,
      resultMainVersionId: unit.resultMainVersionId,
      order: unit.order
    }))
  };
}

function toPrismaUnitStatus(status: PatchBuildManuscriptUnitInput['status']) {
  const map = { planned: 'PLANNED', drafting: 'DRAFTING', review: 'REVIEW', accepted: 'ACCEPTED', invalidated: 'INVALIDATED' } as const;
  return status ? map[status] : undefined;
}

function validateIdempotency(value: string) { required(value, 'Idempotency key', 500); }
function validateBody(value: string) { if (typeof value !== 'string' || value.length > 5_000_000) throw new HttpError(400, 'Body must be a string no larger than 5 MB'); }
function validateOrder(value: number) { if (!Number.isInteger(value) || value < 0 || value > 100_000) throw new HttpError(400, 'Unit order must be a non-negative integer'); }
function validateTension(value: number | null | undefined) { if (value !== undefined && value !== null && (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1)) throw new HttpError(400, 'Tension must be between 0 and 1'); }
function assertBuildRevision(actual: number, expected: number) { if (!Number.isInteger(expected) || expected < 0) throw new HttpError(400, 'expectedBuildRevision must be a non-negative integer'); if (actual !== expected) throw new HttpError(409, 'Build revision is stale', { expected, actual }); }
function required(value: unknown, label: string, max: number): string { if (typeof value !== 'string' || !value.trim()) throw new HttpError(400, `${label} is required`); if (value.trim().length > max) throw new HttpError(400, `${label} is too long`); return value.trim(); }
function jsonObject(value: Prisma.JsonValue): Record<string, Prisma.JsonValue> { return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, Prisma.JsonValue> : {}; }
function stringValue(value: Prisma.JsonValue | undefined): string { return typeof value === 'string' ? value : ''; }
function nullableString(value: Prisma.JsonValue | undefined): string | null { return typeof value === 'string' && value.trim() ? value : null; }
function nullableId(value: Prisma.JsonValue | undefined): string | null { return typeof value === 'string' && value ? value : null; }
function numberValue(value: Prisma.JsonValue | undefined): number | null { return typeof value === 'number' && Number.isFinite(value) ? value : null; }
function requiredInteger(value: Prisma.JsonValue | undefined, label: string): number { if (typeof value !== 'number' || !Number.isInteger(value)) throw new HttpError(409, `${label} is invalid`); return value; }
function stringArray(value: Prisma.JsonValue | undefined): string[] { return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []; }
function toInputJson(value: unknown): Prisma.InputJsonValue { return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue; }
function nullableJson(value: Prisma.JsonValue | undefined): Prisma.InputJsonValue | typeof Prisma.JsonNull { return value === undefined || value === null ? Prisma.JsonNull : toInputJson(value); }
function referenceMap(entries: ReadonlyArray<readonly [string, string]>): Map<string, string> { return new Map(entries); }
function resolveStringReferences(values: string[], references: Map<string, string>): string[] { return [...new Set(values.flatMap((value) => references.get(value) ?? []))]; }
function resolveStructuredReference(value: Prisma.JsonValue | undefined, references: Map<string, string>): string | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return (typeof value.id === 'string' ? references.get(value.id) : undefined)
    ?? (typeof value.key === 'string' ? references.get(value.key) : undefined)
    ?? null;
}
function resolveStructuredReferences(value: Prisma.JsonValue | undefined, type: string, references: Map<string, string>): string[] {
  return Array.isArray(value) ? [...new Set(value.flatMap((item) => item && typeof item === 'object' && !Array.isArray(item) && item.type === type
    ? [resolveStructuredReference(item as Prisma.JsonObject, references)].filter((id): id is string => Boolean(id)) : []))] : [];
}
function buildReviewedUnitSnapshot(unit: {
  kind: 'CHAPTER' | 'SCENE'; key: string; parentUnitId: string | null; sourceChapterId: string | null; sourceSceneId: string | null;
  order: number; chapterNumber: number | null; title: string; povCharacterId: string | null; locationId: string | null;
  storyDate: string | null; storyTime: string | null; tension: number | null; metadata: Prisma.JsonValue; branchId: string;
}): JsonObject {
  return {
    kind: unit.kind.toLowerCase(), key: unit.key, parentUnitId: unit.parentUnitId,
    sourceChapterId: unit.sourceChapterId, sourceSceneId: unit.sourceSceneId,
    order: unit.order, chapterNumber: unit.chapterNumber, title: unit.title,
    povCharacterId: unit.povCharacterId, locationId: unit.locationId,
    storyDate: unit.storyDate, storyTime: unit.storyTime, tension: unit.tension,
    metadata: unit.metadata as JsonValue, branchId: unit.branchId
  };
}
