import type { ChapterStatus, PrismaClient } from '@prisma/client';
import type { Chapter, UpdateChapterInput } from '@opentales/sdk';
import { HttpError } from '../../http/HttpError.js';
import { ProjectAccessRepository } from '../../repositories/ProjectAccessRepository.js';
import { WritingUseCase } from '../writings/WritingUseCase.js';
import { toChapter } from './projectMapper.js';

const statusMap: Record<string, ChapterStatus> = {
  draft: 'DRAFT',
  'in-progress': 'IN_PROGRESS',
  review: 'REVIEW',
  final: 'FINAL'
};

export class UpdateChapterUseCase {
  private readonly access: ProjectAccessRepository;
  private readonly writingUseCase = new WritingUseCase();

  constructor(private readonly prisma: PrismaClient) {
    this.access = new ProjectAccessRepository(prisma);
  }

  async execute(
    userId: string,
    projectId: string,
    chapterId: string,
    input: UpdateChapterInput
  ): Promise<Chapter> {
    await this.access.assertPermission(userId, projectId, 'project:write');

    await this.prisma.$transaction(async (tx) => {
      const chapter = await tx.chapter.findFirst({
        where: { id: chapterId, projectId, deletedAt: null },
        select: { id: true, bodyWritingId: true }
      });

      if (!chapter) {
        throw new HttpError(404, 'Chapter not found');
      }

      let publishedAt: Date | null | undefined;
      if (input.publishedAt !== undefined) {
        if (input.publishedAt === null) publishedAt = null;
        else if (typeof input.publishedAt === 'string') {
          // "true" sentinel from the UI flips publish-now; otherwise treat as ISO string
          publishedAt = input.publishedAt === '' ? new Date() : new Date(input.publishedAt);
        }
      }

      await tx.chapter.update({
        where: { id: chapterId },
        data: {
          title: input.title,
          status: input.status ? statusMap[input.status] : undefined,
          povCharacterId: input.povCharacterId,
          locationId: input.locationId,
          summary: input.summary,
          publishedAt
        }
      });

      if (input.content !== undefined) {
        await this.writingUseCase.updateDefaultBranch(tx, {
          writingId: chapter.bodyWritingId,
          body: input.content,
          authorId: userId,
          message: 'Update chapter body'
        });
      }
    });

    return this.reload(chapterId);
  }

  private async reload(chapterId: string): Promise<Chapter> {
    const chapter = await this.prisma.chapter.findUniqueOrThrow({
      where: { id: chapterId },
      include: {
        bodyWriting: { include: { defaultBranch: { include: { headVersion: true } } } }
      }
    });
    return toChapter(chapter);
  }
}
