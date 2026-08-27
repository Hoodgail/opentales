import { Prisma, type PrismaClient, type SceneStatus as PrismaSceneStatus } from '@prisma/client';
import type { CreateSceneInput, DeleteSceneInput, JsonValue, ReorderScenesInput, Scene, SceneStatus, UpdateSceneInput } from '@opentales/sdk';
import { HttpError } from '../../http/HttpError.js';
import { ProjectAccessRepository } from '../../repositories/ProjectAccessRepository.js';
import { countWords } from '../../utils/wordCount.js';
import { assertJsonValue } from '../novelBuild/schemas.js';
import { WritingUseCase } from '../writings/WritingUseCase.js';
import { toScene } from './projectMapper.js';

const STATUS_MAP: Record<SceneStatus, PrismaSceneStatus> = {
  planned: 'PLANNED',
  draft: 'DRAFT',
  'in-progress': 'IN_PROGRESS',
  review: 'REVIEW',
  revised: 'REVISED',
  final: 'FINAL'
};

const sceneInclude = {
  bodyWriting: { include: { defaultBranch: { include: { headVersion: true } } } }
} satisfies Prisma.SceneInclude;

export class SceneUseCase {
  private readonly access: ProjectAccessRepository;
  private readonly writings = new WritingUseCase();

  constructor(private readonly prisma: PrismaClient) {
    this.access = new ProjectAccessRepository(prisma);
  }

  async list(userId: string, projectId: string, chapterId: string): Promise<Scene[]> {
    await this.access.assertProjectAccess(userId, projectId);
    await this.assertChapter(this.prisma, projectId, chapterId);
    const scenes = await this.prisma.scene.findMany({
      where: { chapterId },
      orderBy: { order: 'asc' },
      include: sceneInclude
    });
    return scenes.map(toScene);
  }

  async get(userId: string, projectId: string, chapterId: string, sceneId: string): Promise<Scene> {
    await this.access.assertProjectAccess(userId, projectId);
    return this.reload(projectId, chapterId, sceneId);
  }

  async create(
    userId: string,
    projectId: string,
    chapterId: string,
    input: CreateSceneInput
  ): Promise<Scene> {
    await this.access.assertPermission(userId, projectId, 'project:write');
    const normalized = this.normalizeInput(input, false);
    const sceneId = await this.prisma.$transaction(async (tx) => {
      await this.lockChapter(tx, projectId, chapterId);
      await this.assertReferences(tx, projectId, normalized);
      const existing = await tx.scene.findMany({
        where: { chapterId },
        orderBy: { order: 'asc' },
        select: { id: true }
      });
      const body = normalized.content ?? '';
      const bodyWritingId = await this.writings.createWriting(tx, {
        projectId,
        kind: 'SCENE_BODY',
        body,
        authorId: userId,
        message: 'Create scene'
      });
      const created = await tx.scene.create({
        data: {
          chapterId,
          order: existing.length,
          title: normalized.title ?? null,
          status: normalized.status ? STATUS_MAP[normalized.status] : 'DRAFT',
          povCharacterId: normalized.povCharacterId ?? null,
          locationId: normalized.locationId ?? null,
          storyDate: normalized.storyDate ?? null,
          storyTime: normalized.storyTime ?? null,
          estimatedWordCount: normalized.estimatedWordCount ?? null,
          actualWordCount: countWords(body),
          sceneFunction: normalized.sceneFunction ?? null,
          goal: normalized.goal ?? null,
          obstacle: normalized.obstacle ?? null,
          stakes: normalized.stakes ?? null,
          conflict: normalized.conflict ?? null,
          turn: normalized.turn ?? null,
          revelation: normalized.revelation ?? null,
          outcome: normalized.outcome ?? null,
          emotionalValueShift: normalized.emotionalValueShift ?? null,
          tension: normalized.tension ?? null,
          characterPresentIds: normalized.characterPresentIds ?? [],
          characterReferencedIds: normalized.characterReferencedIds ?? [],
          plotThreadIds: normalized.plotThreadIds ?? [],
          setupPayoffIds: normalized.setupPayoffIds ?? [],
          knowledgeDeltas: toPrismaJson(normalized.knowledgeDeltas),
          objectTransfers: toPrismaJson(normalized.objectTransfers),
          injuryStateChanges: toPrismaJson(normalized.injuryStateChanges),
          worldRuleRefs: toPrismaJson(normalized.worldRuleRefs),
          entryState: toPrismaJson(normalized.entryState),
          exitState: toPrismaJson(normalized.exitState),
          summary: normalized.summary ?? null,
          writerNotes: normalized.writerNotes ?? null,
          aiNotes: normalized.aiNotes ?? null,
          bodyWritingId
        },
        select: { id: true }
      });
      if (normalized.order !== undefined) {
        const target = clamp(normalized.order, 0, existing.length);
        const orderedIds = existing.map((scene) => scene.id);
        orderedIds.splice(target, 0, created.id);
        await this.reorderSequential(tx, chapterId, orderedIds);
      }
      return created.id;
    });
    return this.reload(projectId, chapterId, sceneId);
  }

  async update(
    userId: string,
    projectId: string,
    chapterId: string,
    sceneId: string,
    input: UpdateSceneInput
  ): Promise<Scene> {
    await this.access.assertPermission(userId, projectId, 'project:write');
    const normalized = this.normalizeInput(input, true);
    await this.prisma.$transaction(async (tx) => {
      await this.lockChapter(tx, projectId, chapterId);
      const existing = await tx.scene.findFirst({
        where: { id: sceneId, chapterId, chapter: { projectId, deletedAt: null } },
        select: { id: true, bodyWritingId: true, revision: true }
      });
      if (!existing) throw new HttpError(404, 'Scene not found');
      if (existing.revision !== normalized.expectedRevision) {
        throw new HttpError(409, 'Scene revision is stale', { expected: normalized.expectedRevision, actual: existing.revision });
      }
      await this.assertReferences(tx, projectId, normalized);
      const data: Prisma.SceneUpdateInput = {};
      assign(data, 'title', normalized.title);
      if (normalized.status !== undefined) data.status = STATUS_MAP[normalized.status];
      if (normalized.povCharacterId !== undefined) data.povCharacter = normalized.povCharacterId === null ? { disconnect: true } : { connect: { id: normalized.povCharacterId } };
      if (normalized.locationId !== undefined) data.location = normalized.locationId === null ? { disconnect: true } : { connect: { id: normalized.locationId } };
      assign(data, 'storyDate', normalized.storyDate);
      assign(data, 'storyTime', normalized.storyTime);
      assign(data, 'estimatedWordCount', normalized.estimatedWordCount);
      assign(data, 'sceneFunction', normalized.sceneFunction);
      assign(data, 'goal', normalized.goal);
      assign(data, 'obstacle', normalized.obstacle);
      assign(data, 'stakes', normalized.stakes);
      assign(data, 'conflict', normalized.conflict);
      assign(data, 'turn', normalized.turn);
      assign(data, 'revelation', normalized.revelation);
      assign(data, 'outcome', normalized.outcome);
      assign(data, 'emotionalValueShift', normalized.emotionalValueShift);
      assign(data, 'tension', normalized.tension);
      assign(data, 'characterPresentIds', normalized.characterPresentIds);
      assign(data, 'characterReferencedIds', normalized.characterReferencedIds);
      assign(data, 'plotThreadIds', normalized.plotThreadIds);
      assign(data, 'setupPayoffIds', normalized.setupPayoffIds);
      assignJson(data, 'knowledgeDeltas', normalized.knowledgeDeltas);
      assignJson(data, 'objectTransfers', normalized.objectTransfers);
      assignJson(data, 'injuryStateChanges', normalized.injuryStateChanges);
      assignJson(data, 'worldRuleRefs', normalized.worldRuleRefs);
      assignJson(data, 'entryState', normalized.entryState);
      assignJson(data, 'exitState', normalized.exitState);
      assign(data, 'summary', normalized.summary);
      assign(data, 'writerNotes', normalized.writerNotes);
      assign(data, 'aiNotes', normalized.aiNotes);
      if (normalized.content !== undefined) {
        await this.writings.updateDefaultBranch(tx, {
          writingId: existing.bodyWritingId,
          body: normalized.content,
          authorId: userId,
          message: 'Update scene body'
        });
        data.actualWordCount = countWords(normalized.content);
      }
      data.revision = { increment: 1 };
      await tx.scene.update({ where: { id: sceneId }, data });
      if (normalized.order !== undefined) {
        const scenes = await tx.scene.findMany({
          where: { chapterId },
          orderBy: { order: 'asc' },
          select: { id: true }
        });
        const orderedIds = scenes.map((scene) => scene.id).filter((id) => id !== sceneId);
        orderedIds.splice(clamp(normalized.order, 0, orderedIds.length), 0, sceneId);
        await this.reorderSequential(tx, chapterId, orderedIds);
      }
    });
    return this.reload(projectId, chapterId, sceneId);
  }

  async delete(
    userId: string,
    projectId: string,
    chapterId: string,
    sceneId: string,
    input: DeleteSceneInput = {}
  ): Promise<{ id: string; deleted: true }> {
    await this.access.assertPermission(userId, projectId, 'project:write');
    await this.prisma.$transaction(async (tx) => {
      await this.lockChapter(tx, projectId, chapterId);
      const scene = await tx.scene.findFirst({
        where: { id: sceneId, chapterId, chapter: { projectId, deletedAt: null } },
        select: { id: true, bodyWritingId: true, revision: true }
      });
      if (!scene) throw new HttpError(404, 'Scene not found');
      if (input.expectedRevision !== undefined) {
        if (!Number.isInteger(input.expectedRevision) || input.expectedRevision < 0) throw new HttpError(400, 'expectedRevision must be a non-negative integer');
        if (scene.revision !== input.expectedRevision) throw new HttpError(409, 'Scene revision is stale', { expected: input.expectedRevision, actual: scene.revision });
      }
      await tx.scene.delete({ where: { id: sceneId } });
      await tx.writing.delete({ where: { id: scene.bodyWritingId } });
      const remaining = await tx.scene.findMany({
        where: { chapterId },
        orderBy: { order: 'asc' },
        select: { id: true }
      });
      await this.reorderSequential(tx, chapterId, remaining.map((item) => item.id));
    });
    return { id: sceneId, deleted: true };
  }

  async reorder(
    userId: string,
    projectId: string,
    chapterId: string,
    input: ReorderScenesInput
  ): Promise<Scene[]> {
    await this.access.assertPermission(userId, projectId, 'project:write');
    if (!Array.isArray(input.sceneIds) || !input.sceneIds.length || new Set(input.sceneIds).size !== input.sceneIds.length) {
      throw new HttpError(400, 'sceneIds must be a non-empty unique ordered list');
    }
    let completed = false;
    for (let attempt = 0; attempt < 8 && !completed; attempt += 1) {
      try {
        await this.prisma.$transaction(async (tx) => {
          await this.lockChapter(tx, projectId, chapterId);
          if (input.buildRunId) {
            const build = await tx.buildRun.findFirst({ where: { id: input.buildRunId, projectId }, select: { status: true } });
            if (!build) throw new HttpError(400, 'Reorder buildRunId does not belong to this project');
            if (['COMPLETED', 'CANCELLED'].includes(build.status)) throw new HttpError(409, 'Historical or terminal build mappings cannot be reordered');
          }
          const currentScenes = await tx.scene.findMany({ where: { chapterId }, select: { id: true, revision: true } });
          if (currentScenes.length !== input.sceneIds.length || currentScenes.some((scene) => !input.sceneIds.includes(scene.id))) throw new HttpError(409, 'Bulk reorder must include every scene in the chapter exactly once');
          for (const scene of currentScenes) if (!Number.isInteger(input.expectedRevisions?.[scene.id]) || input.expectedRevisions[scene.id] !== scene.revision) {
            throw new HttpError(409, `Scene '${scene.id}' revision is stale`, { expected: input.expectedRevisions?.[scene.id], actual: scene.revision });
          }
          await tx.scene.updateMany({ where: { chapterId }, data: { order: { increment: 1_000_000 } } });
          const rows = input.sceneIds.map((id, order) => Prisma.sql`(${id}::text, ${order}::integer)`);
          await tx.$executeRaw(Prisma.sql`UPDATE "Scene" AS scene SET "order"=ordered."order", revision=scene.revision+1, "updatedAt"=CURRENT_TIMESTAMP FROM (VALUES ${Prisma.join(rows)}) AS ordered(id,"order") WHERE scene.id=ordered.id AND scene."chapterId"=${chapterId}`);
          const mapped = input.buildRunId ? await tx.buildManuscriptUnit.findMany({ where: { projectId, buildRunId: input.buildRunId, sourceSceneId: { in: input.sceneIds }, invalidatedAt: null }, select: { id: true, sourceSceneId: true } }) : [];
          if (mapped.length) {
            await tx.buildManuscriptUnit.updateMany({ where: { id: { in: mapped.map((unit) => unit.id) } }, data: { order: { increment: 1_000_000 } } });
            const unitRows = mapped.map((unit) => Prisma.sql`(${unit.id}::text, ${input.sceneIds.indexOf(unit.sourceSceneId!)}::integer)`);
            await tx.$executeRaw(Prisma.sql`UPDATE "BuildManuscriptUnit" AS unit SET "order"=ordered."order", revision=unit.revision+1, "updatedAt"=CURRENT_TIMESTAMP FROM (VALUES ${Prisma.join(unitRows)}) AS ordered(id,"order") WHERE unit.id=ordered.id AND unit."buildRunId"=${input.buildRunId}`);
          }
        }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
        completed = true;
      } catch (error) {
        if (!isSerializationConflict(error)) throw error;
        if (attempt === 7) throw new HttpError(409, 'Concurrent scene reorder could not be serialized; reload revisions and retry');
        await new Promise((resolve) => setTimeout(resolve, 15 * (attempt + 1) + Math.floor(Math.random() * 20)));
      }
    }
    return this.list(userId, projectId, chapterId);
  }

  private async reload(projectId: string, chapterId: string, sceneId: string): Promise<Scene> {
    const scene = await this.prisma.scene.findFirst({
      where: { id: sceneId, chapterId, chapter: { projectId, deletedAt: null } },
      include: sceneInclude
    });
    if (!scene) throw new HttpError(404, 'Scene not found');
    return toScene(scene);
  }

  private async assertChapter(
    db: PrismaClient | Prisma.TransactionClient,
    projectId: string,
    chapterId: string
  ): Promise<void> {
    const chapter = await db.chapter.findFirst({
      where: { id: chapterId, projectId, deletedAt: null },
      select: { id: true }
    });
    if (!chapter) throw new HttpError(404, 'Chapter not found');
  }

  private async lockChapter(tx: Prisma.TransactionClient, projectId: string, chapterId: string) {
    await tx.$queryRaw`SELECT id FROM "Chapter" WHERE id = ${chapterId} AND "projectId" = ${projectId} AND "deletedAt" IS NULL FOR UPDATE`;
    await this.assertChapter(tx, projectId, chapterId);
  }

  private async assertReferences(
    tx: Prisma.TransactionClient,
    projectId: string,
    input: CreateSceneInput & { expectedRevision?: number }
  ): Promise<void> {
    const characterIds = unique([
      ...(input.characterPresentIds ?? []),
      ...(input.characterReferencedIds ?? []),
      ...(input.povCharacterId ? [input.povCharacterId] : [])
    ]);
    if (characterIds.length) {
      const count = await tx.character.count({ where: { projectId, id: { in: characterIds } } });
      if (count !== characterIds.length) throw new HttpError(400, 'One or more character references do not belong to this project');
    }
    if (input.locationId) {
      const location = await tx.location.findFirst({ where: { id: input.locationId, projectId }, select: { id: true } });
      if (!location) throw new HttpError(400, 'Location does not belong to this project');
    }
    const threadIds = unique(input.plotThreadIds ?? []);
    if (threadIds.length) {
      const count = await tx.plotThread.count({ where: { projectId, id: { in: threadIds }, isCurrent: true, invalidatedAt: null, buildRun: { reviews: { some: { status: 'MERGED' } } } } });
      if (count !== threadIds.length) throw new HttpError(400, 'Canonical scenes may reference only current plot threads from an explicitly merged build');
    }
    const setupIds = unique(input.setupPayoffIds ?? []);
    if (setupIds.length) {
      const count = await tx.setupPayoffLink.count({ where: { projectId, id: { in: setupIds }, isCurrent: true, invalidatedAt: null, buildRun: { reviews: { some: { status: 'MERGED' } } } } });
      if (count !== setupIds.length) throw new HttpError(400, 'Canonical scenes may reference only current setup/payoff links from an explicitly merged build');
    }
  }

  private normalizeInput(input: CreateSceneInput | UpdateSceneInput, partial: boolean): CreateSceneInput & { expectedRevision?: number } {
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw new HttpError(400, 'Scene input is required');
    const result: CreateSceneInput & { expectedRevision?: number } = { ...input };
    if (result.title !== undefined) result.title = text(result.title, 'Scene title', 1_000, true);
    for (const field of ['storyDate', 'storyTime'] as const) {
      const value = result[field];
      if (value !== undefined && value !== null) result[field] = text(value, field, 500, true);
    }
    for (const field of ['sceneFunction', 'goal', 'obstacle', 'stakes', 'conflict', 'turn', 'revelation', 'outcome', 'emotionalValueShift', 'summary', 'writerNotes', 'aiNotes'] as const) {
      if (result[field] !== undefined) result[field] = text(result[field] ?? '', field, 50_000, true);
    }
    if (result.status !== undefined && !STATUS_MAP[result.status]) throw new HttpError(400, 'Unsupported scene status');
    if (partial && (!Number.isInteger(result.expectedRevision) || (result.expectedRevision ?? -1) < 0)) throw new HttpError(400, 'expectedRevision must be a non-negative integer');
    for (const field of ['povCharacterId', 'locationId'] as const) {
      const value = result[field];
      if (value !== undefined && value !== null) result[field] = text(value, field, 500, false);
    }
    if (result.order !== undefined && (!Number.isInteger(result.order) || result.order < 0)) throw new HttpError(400, 'Scene order must be a non-negative integer');
    if (result.estimatedWordCount !== undefined && result.estimatedWordCount !== null && (!Number.isInteger(result.estimatedWordCount) || result.estimatedWordCount < 0 || result.estimatedWordCount > 1_000_000)) throw new HttpError(400, 'Estimated word count is invalid');
    if (result.tension !== undefined && result.tension !== null && (typeof result.tension !== 'number' || !Number.isFinite(result.tension) || result.tension < 0 || result.tension > 1)) throw new HttpError(400, 'Tension must be between 0 and 1');
    for (const field of ['characterPresentIds', 'characterReferencedIds', 'plotThreadIds', 'setupPayoffIds'] as const) {
      if (result[field] !== undefined) result[field] = validateIds(result[field] ?? [], field);
    }
    for (const field of ['knowledgeDeltas', 'objectTransfers', 'injuryStateChanges', 'worldRuleRefs', 'entryState', 'exitState'] as const) {
      const value = result[field];
      if (value !== undefined && value !== null) {
        try { assertJsonValue(value); } catch (error) { throw new HttpError(400, error instanceof Error ? error.message : `${field} must be JSON`); }
      }
    }
    if (result.content !== undefined && (typeof result.content !== 'string' || result.content.length > 2_000_000)) {
      throw new HttpError(400, 'Scene content must be a string no larger than 2 MB');
    }
    return result;
  }

  private async reorderSequential(tx: Prisma.TransactionClient, chapterId: string, orderedIds: string[]) {
    for (let index = 0; index < orderedIds.length; index += 1) {
      await tx.scene.update({ where: { id: orderedIds[index] }, data: { order: -(index + 1) } });
    }
    for (let index = 0; index < orderedIds.length; index += 1) {
      await tx.scene.update({ where: { id: orderedIds[index] }, data: { order: index } });
    }
    const count = await tx.scene.count({ where: { chapterId } });
    if (count !== orderedIds.length) throw new HttpError(409, 'Scene order changed concurrently');
  }
}

function assign<T extends object, K extends keyof T>(target: T, key: K, value: T[K] | undefined) {
  if (value !== undefined) target[key] = value;
}

function assignJson(target: Prisma.SceneUpdateInput, key: 'knowledgeDeltas' | 'objectTransfers' | 'injuryStateChanges' | 'worldRuleRefs' | 'entryState' | 'exitState', value: JsonValue | null | undefined) {
  if (value !== undefined) target[key] = value === null ? Prisma.JsonNull : (value as Prisma.InputJsonValue);
}

function toPrismaJson(value: JsonValue | null | undefined): Prisma.InputJsonValue | typeof Prisma.JsonNull | undefined {
  if (value === undefined) return undefined;
  return value === null ? Prisma.JsonNull : (value as Prisma.InputJsonValue);
}

function text(value: string, label: string, max: number, empty: boolean): string {
  if (typeof value !== 'string') throw new HttpError(400, `${label} must be a string`);
  const normalized = value.trim();
  if (!empty && !normalized) throw new HttpError(400, `${label} is required`);
  if (normalized.length > max) throw new HttpError(400, `${label} is too long`);
  return normalized;
}

function validateIds(value: string[], label: string): string[] {
  if (!Array.isArray(value) || value.length > 100_000) throw new HttpError(400, `${label} is invalid`);
  return unique(value.map((id) => text(id, label, 500, false)));
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

function isSerializationConflict(error: unknown): boolean {
  if (error instanceof Prisma.PrismaClientKnownRequestError && (error.code === 'P2034' || (error.code === 'P2010' && ['40001', '40P01'].includes(String(error.meta?.code))))) return true;
  return /40001|40P01|serialize access|serialization failure|deadlock/i.test(error instanceof Error ? error.message : String(error));
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}
