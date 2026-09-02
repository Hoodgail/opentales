import { createHash } from 'node:crypto';
import { Prisma, type PrismaClient } from '@prisma/client';
import { HttpError } from '../../http/HttpError.js';
import { ProjectAccessRepository } from '../../repositories/ProjectAccessRepository.js';
import { applyContentPatch } from '../../utils/contentPatch.js';
import { countWords } from '../../utils/wordCount.js';

export type StoryPatchTarget = 'chapter' | 'scene' | 'project-doc' | 'submission';

export interface StoryPatchOperation {
  target: StoryPatchTarget;
  id: string;
  expectedHeadVersionId: string | null;
  expectedRevision?: number;
  patch: { mode: 'replace'; content: string } | {
    mode: 'edit';
    edits: Array<{ oldString: string; newString: string; replaceAll?: boolean }>;
  };
  message?: string;
}

export interface ApplyStoryPatchInput {
  idempotencyKey: string;
  operations: StoryPatchOperation[];
}

export interface StoryPatchResult {
  target: StoryPatchTarget;
  id: string;
  changed: boolean;
  previousHeadVersionId: string | null;
  headVersionId: string | null;
  previousWordCount: number;
  wordCount: number;
  wordDelta: number;
  revision?: number;
}

export interface ApplyStoryPatchResult {
  ok: true;
  idempotencyKey: string;
  replayed: boolean;
  results: StoryPatchResult[];
}

type Tx = Prisma.TransactionClient;

interface LoadedTarget {
  target: StoryPatchTarget;
  id: string;
  branchId: string;
  headVersionId: string | null;
  body: string;
  revision?: number;
}

export class ApplyStoryPatchUseCase {
  private readonly access: ProjectAccessRepository;

  constructor(private readonly prisma: PrismaClient) {
    this.access = new ProjectAccessRepository(prisma);
  }

  async execute(
    userId: string,
    projectId: string,
    input: ApplyStoryPatchInput
  ): Promise<ApplyStoryPatchResult> {
    await this.access.assertPermission(userId, projectId, 'project:write');
    const idempotencyKey = input.idempotencyKey.trim();
    if (!idempotencyKey) throw new HttpError(400, 'idempotencyKey is required');
    if (!input.operations.length || input.operations.length > 50) {
      throw new HttpError(400, 'operations must contain between 1 and 50 prose patches');
    }
    const targetKeys = input.operations.map((operation) => `${operation.target}:${operation.id}`);
    if (new Set(targetKeys).size !== targetKeys.length) {
      throw new HttpError(400, 'A story patch may target each chapter, scene, document, or submission only once');
    }
    const requestHash = stableHash(input);

    try {
      return await this.prisma.$transaction(async (tx) => {
        const replay = await tx.storyPatchReceipt.findUnique({
          where: { projectId_idempotencyKey: { projectId, idempotencyKey } }
        });
        if (replay) {
          if (replay.operation !== 'apply-story-patch' || replay.requestHash !== requestHash) {
            throw new HttpError(409, 'idempotencyKey was already used with a different story patch');
          }
          return { ...(replay.response as unknown as ApplyStoryPatchResult), replayed: true };
        }

        const results: StoryPatchResult[] = [];
        for (const operation of [...input.operations].sort((a, b) =>
          `${a.target}:${a.id}`.localeCompare(`${b.target}:${b.id}`)
        )) {
          const target = await this.loadAndLockTarget(tx, projectId, operation);
          if (target.headVersionId !== operation.expectedHeadVersionId) {
            throw new HttpError(409, `${operation.target} '${operation.id}' has a stale writing head; re-read it and retry`, {
              expectedHeadVersionId: operation.expectedHeadVersionId,
              actualHeadVersionId: target.headVersionId
            });
          }
          if (operation.target === 'scene') {
            if (!Number.isInteger(operation.expectedRevision) || (operation.expectedRevision ?? -1) < 0) {
              throw new HttpError(400, `Scene '${operation.id}' requires expectedRevision from readScene`);
            }
            if (target.revision !== operation.expectedRevision) {
              throw new HttpError(409, `Scene '${operation.id}' revision is stale; re-read it and retry`, {
                expectedRevision: operation.expectedRevision,
                actualRevision: target.revision
              });
            }
          }

          const body = applyContentPatch(target.body, operation.patch);
          const previousWordCount = countWords(target.body);
          const wordCount = countWords(body);
          if (body === target.body) {
            results.push({
              target: operation.target,
              id: operation.id,
              changed: false,
              previousHeadVersionId: target.headVersionId,
              headVersionId: target.headVersionId,
              previousWordCount,
              wordCount,
              wordDelta: 0,
              ...(target.revision !== undefined ? { revision: target.revision } : {})
            });
            continue;
          }

          const version = await tx.writingVersion.create({
            data: {
              branchId: target.branchId,
              parentVersionId: target.headVersionId,
              body,
              wordCount,
              authorId: userId,
              message: boundedMessage(operation.message, `Apply story patch to ${operation.target}`)
            }
          });
          const branchUpdate = await tx.writingBranch.updateMany({
            where: { id: target.branchId, headVersionId: target.headVersionId },
            data: { headVersionId: version.id }
          });
          if (branchUpdate.count !== 1) {
            throw new HttpError(409, `${operation.target} '${operation.id}' changed concurrently; re-read it and retry`);
          }

          let revision = target.revision;
          if (operation.target === 'scene') {
            const sceneUpdate = await tx.scene.updateMany({
              where: { id: operation.id, revision: operation.expectedRevision },
              data: { actualWordCount: wordCount, revision: { increment: 1 } }
            });
            if (sceneUpdate.count !== 1) throw new HttpError(409, `Scene '${operation.id}' changed concurrently; re-read it and retry`);
            revision = (target.revision ?? 0) + 1;
          } else if (operation.target === 'chapter') {
            await tx.chapter.update({ where: { id: operation.id }, data: { updatedAt: new Date() } });
          } else if (operation.target === 'project-doc') {
            await tx.projectDoc.update({ where: { id: operation.id }, data: { updatedAt: new Date() } });
          } else {
            await tx.activity.create({
              data: {
                submissionId: operation.id,
                type: 'SUBMISSION_UPDATED',
                authorId: userId,
                content: { changedFields: ['body'], headVersionId: version.id, source: 'applyStoryPatch' }
              }
            });
          }

          results.push({
            target: operation.target,
            id: operation.id,
            changed: true,
            previousHeadVersionId: target.headVersionId,
            headVersionId: version.id,
            previousWordCount,
            wordCount,
            wordDelta: wordCount - previousWordCount,
            ...(revision !== undefined ? { revision } : {})
          });
        }

        const response: ApplyStoryPatchResult = {
          ok: true,
          idempotencyKey,
          replayed: false,
          results: input.operations.map((operation) =>
            results.find((result) => result.target === operation.target && result.id === operation.id)!
          )
        };
        await tx.storyPatchReceipt.create({
          data: {
            projectId,
            idempotencyKey,
            operation: 'apply-story-patch',
            requestHash,
            response: JSON.parse(JSON.stringify(response)) as Prisma.InputJsonValue
          }
        });
        return response;
      });
    } catch (error) {
      if (!isUniqueViolation(error)) throw error;
      const replay = await this.prisma.storyPatchReceipt.findUnique({
        where: { projectId_idempotencyKey: { projectId, idempotencyKey } }
      });
      if (!replay || replay.operation !== 'apply-story-patch' || replay.requestHash !== requestHash) {
        throw new HttpError(409, 'idempotencyKey was reused concurrently with a different story patch');
      }
      return { ...(replay.response as unknown as ApplyStoryPatchResult), replayed: true };
    }
  }

  private async loadAndLockTarget(
    tx: Tx,
    projectId: string,
    operation: StoryPatchOperation
  ): Promise<LoadedTarget> {
    if (operation.target === 'chapter') {
      await tx.$queryRaw`SELECT id FROM "Chapter" WHERE id = ${operation.id} AND "projectId" = ${projectId} AND "deletedAt" IS NULL FOR UPDATE`;
      const chapter = await tx.chapter.findFirst({
        where: { id: operation.id, projectId, deletedAt: null },
        include: { bodyWriting: { include: { defaultBranch: { include: { headVersion: true } } } } }
      });
      if (!chapter?.bodyWriting.defaultBranch) throw new HttpError(404, `Chapter '${operation.id}' not found`);
      await this.lockBranch(tx, chapter.bodyWriting.defaultBranch.id);
      return this.refreshTarget(tx, operation.target, operation.id, chapter.bodyWriting.defaultBranch.id);
    }
    if (operation.target === 'scene') {
      await tx.$queryRaw`SELECT scene.id FROM "Scene" scene JOIN "Chapter" chapter ON chapter.id = scene."chapterId" WHERE scene.id = ${operation.id} AND chapter."projectId" = ${projectId} AND chapter."deletedAt" IS NULL FOR UPDATE OF chapter, scene`;
      const scene = await tx.scene.findFirst({
        where: { id: operation.id, chapter: { projectId, deletedAt: null } },
        include: { bodyWriting: { include: { defaultBranch: true } } }
      });
      if (!scene?.bodyWriting.defaultBranch) throw new HttpError(404, `Scene '${operation.id}' not found`);
      await this.lockBranch(tx, scene.bodyWriting.defaultBranch.id);
      const target = await this.refreshTarget(tx, operation.target, operation.id, scene.bodyWriting.defaultBranch.id);
      return { ...target, revision: scene.revision };
    }
    if (operation.target === 'project-doc') {
      await tx.$queryRaw`SELECT id FROM "ProjectDoc" WHERE id = ${operation.id} AND "projectId" = ${projectId} FOR UPDATE`;
      const doc = await tx.projectDoc.findFirst({
        where: { id: operation.id, projectId },
        include: { bodyWriting: { include: { defaultBranch: true } } }
      });
      if (!doc?.bodyWriting.defaultBranch) throw new HttpError(404, `Project document '${operation.id}' not found`);
      await this.lockBranch(tx, doc.bodyWriting.defaultBranch.id);
      return this.refreshTarget(tx, operation.target, operation.id, doc.bodyWriting.defaultBranch.id);
    }

    await tx.$queryRaw`SELECT id FROM "Submission" WHERE id = ${operation.id} AND "projectId" = ${projectId} FOR UPDATE`;
    const submission = await tx.submission.findFirst({
      where: { id: operation.id, projectId },
      include: { branch: true }
    });
    if (!submission) throw new HttpError(404, `Submission '${operation.id}' not found`);
    if (submission.status !== 'OPEN') throw new HttpError(409, `Submission '${operation.id}' is not open and cannot be patched`);
    await this.lockBranch(tx, submission.branchId);
    return this.refreshTarget(tx, operation.target, operation.id, submission.branchId);
  }

  private async lockBranch(tx: Tx, branchId: string): Promise<void> {
    await tx.$queryRaw`SELECT id FROM "WritingBranch" WHERE id = ${branchId} FOR UPDATE`;
  }

  private async refreshTarget(
    tx: Tx,
    target: StoryPatchTarget,
    id: string,
    branchId: string
  ): Promise<LoadedTarget> {
    const branch = await tx.writingBranch.findUnique({
      where: { id: branchId },
      include: { headVersion: { select: { body: true } } }
    });
    if (!branch) throw new HttpError(409, `${target} '${id}' no longer has a writing branch`);
    return {
      target,
      id,
      branchId,
      headVersionId: branch.headVersionId,
      body: branch.headVersion?.body ?? ''
    };
  }
}

function boundedMessage(value: string | undefined, fallback: string): string {
  const normalized = value?.trim();
  if (!normalized) return fallback;
  if (normalized.length > 1_000) throw new HttpError(400, 'Patch message must be no longer than 1,000 characters');
  return normalized;
}

function stableHash(value: unknown): string {
  return createHash('sha256').update(stableJson(value)).digest('hex');
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

function isUniqueViolation(error: unknown): boolean {
  return Boolean(error && typeof error === 'object' && 'code' in error && (error as { code?: string }).code === 'P2002');
}
