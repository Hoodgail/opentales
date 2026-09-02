import { Prisma, type PrismaClient } from '@prisma/client';
import { HttpError } from '../../http/HttpError.js';
import { ProjectAccessRepository } from '../../repositories/ProjectAccessRepository.js';
import { countWords } from '../../utils/wordCount.js';
import { stableHash } from '../novelBuild/schemas.js';
import { WritingUseCase } from '../writings/WritingUseCase.js';

export interface CompileChapterScenesInput {
  idempotencyKey: string;
  expectedChapterHeadVersionId: string | null;
  expectedSceneRevisions: Record<string, number>;
  separator?: string;
  message?: string;
}

export interface CompileChapterScenesResult {
  ok: true;
  chapterId: string;
  headVersionId: string | null;
  sceneCount: number;
  wordCount: number;
  changed: boolean;
  replayed: boolean;
}

export class CompileChapterScenesUseCase {
  private readonly access: ProjectAccessRepository;
  private readonly writings = new WritingUseCase();

  constructor(private readonly prisma: PrismaClient) {
    this.access = new ProjectAccessRepository(prisma);
  }

  async execute(
    userId: string,
    projectId: string,
    chapterId: string,
    input: CompileChapterScenesInput
  ): Promise<CompileChapterScenesResult> {
    await this.access.assertPermission(userId, projectId, 'project:write');
    const idempotencyKey = input.idempotencyKey.trim();
    if (!idempotencyKey) throw new HttpError(400, 'idempotencyKey is required');
    const separator = input.separator ?? '\n\n***\n\n';
    if (separator.length > 1_000) throw new HttpError(400, 'Scene separator must be no longer than 1,000 characters');
    const requestHash = stableHash({ ...input, separator });
    try {
      return await this.prisma.$transaction(async (tx) => {
        const replay = await tx.storyPatchReceipt.findUnique({
          where: { projectId_idempotencyKey: { projectId, idempotencyKey } }
        });
        if (replay) {
          if (replay.operation !== 'compile-chapter-scenes' || replay.requestHash !== requestHash) {
            throw new HttpError(409, 'idempotencyKey was already used for a different story operation');
          }
          return { ...(replay.response as unknown as CompileChapterScenesResult), replayed: true };
        }

        await tx.$queryRaw`SELECT id FROM "Chapter" WHERE id = ${chapterId} AND "projectId" = ${projectId} AND "deletedAt" IS NULL FOR UPDATE`;
        const chapter = await tx.chapter.findFirst({
          where: { id: chapterId, projectId, deletedAt: null },
          include: {
            bodyWriting: { include: { defaultBranch: { include: { headVersion: true } } } },
            scenes: {
              orderBy: { order: 'asc' },
              include: { bodyWriting: { include: { defaultBranch: { include: { headVersion: true } } } } }
            }
          }
        });
        if (!chapter?.bodyWriting.defaultBranch) throw new HttpError(404, 'Chapter not found');
        if (!chapter.scenes.length) throw new HttpError(409, 'Chapter has no scenes to compile');
        const expectedIds = Object.keys(input.expectedSceneRevisions).sort();
        const actualIds = chapter.scenes.map((scene) => scene.id).sort();
        if (expectedIds.length !== actualIds.length || expectedIds.some((id, index) => id !== actualIds[index])) {
          throw new HttpError(409, 'expectedSceneRevisions must contain every current scene exactly once; call listScenes and retry');
        }
        for (const scene of chapter.scenes) {
          if (input.expectedSceneRevisions[scene.id] !== scene.revision) {
            throw new HttpError(409, `Scene '${scene.id}' revision is stale; re-read it and retry`, {
              expectedRevision: input.expectedSceneRevisions[scene.id],
              actualRevision: scene.revision
            });
          }
        }
        const body = chapter.scenes
          .map((scene) => scene.bodyWriting.defaultBranch?.headVersion?.body ?? '')
          .join(separator);
        const currentBody = chapter.bodyWriting.defaultBranch.headVersion?.body ?? '';
        let headVersionId = chapter.bodyWriting.defaultBranch.headVersionId;
        const changed = body !== currentBody;
        if (changed) {
          const version = await this.writings.updateDefaultBranch(tx, {
            writingId: chapter.bodyWritingId,
            body,
            authorId: userId,
            message: boundedMessage(input.message),
            expectedHeadVersionId: input.expectedChapterHeadVersionId
          });
          headVersionId = version.id;
          await tx.chapter.update({ where: { id: chapterId }, data: { updatedAt: new Date() } });
        } else if (chapter.bodyWriting.defaultBranch.headVersionId !== input.expectedChapterHeadVersionId) {
          throw new HttpError(409, 'Chapter head is stale; call readChapter and retry');
        }

        const response: CompileChapterScenesResult = {
          ok: true,
          chapterId,
          headVersionId,
          sceneCount: chapter.scenes.length,
          wordCount: countWords(body),
          changed,
          replayed: false
        };
        await tx.storyPatchReceipt.create({
          data: {
            projectId,
            idempotencyKey,
            operation: 'compile-chapter-scenes',
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
      if (!replay || replay.operation !== 'compile-chapter-scenes' || replay.requestHash !== requestHash) {
        throw new HttpError(409, 'idempotencyKey was reused concurrently for a different story operation');
      }
      return { ...(replay.response as unknown as CompileChapterScenesResult), replayed: true };
    }
  }
}

function boundedMessage(value: string | undefined): string {
  const normalized = value?.trim();
  if (!normalized) return 'Compile ordered scene bodies into chapter';
  if (normalized.length > 1_000) throw new HttpError(400, 'Compilation message must be no longer than 1,000 characters');
  return normalized;
}

function isUniqueViolation(error: unknown): boolean {
  return Boolean(error && typeof error === 'object' && 'code' in error && (error as { code?: string }).code === 'P2002');
}
