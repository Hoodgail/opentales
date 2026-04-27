import type { PrismaClient } from '@prisma/client';
import type { ManuscriptProject } from '@opentales/sdk';
import { HttpError } from '../../http/HttpError.js';
import { ProjectAccessRepository } from '../../repositories/ProjectAccessRepository.js';
import { reloadManuscript } from '../projects/reloadManuscript.js';

export class PurgeChapterUseCase {
  private readonly access: ProjectAccessRepository;

  constructor(private readonly prisma: PrismaClient) {
    this.access = new ProjectAccessRepository(prisma);
  }

  async execute(
    userId: string,
    projectId: string,
    chapterId: string
  ): Promise<ManuscriptProject> {
    await this.access.assertProjectAccess(userId, projectId);

    await this.prisma.$transaction(async (tx) => {
      const chapter = await tx.chapter.findFirst({
        where: { id: chapterId, projectId, deletedAt: { not: null } },
        select: {
          id: true,
          bodyWritingId: true,
          scenes: { select: { id: true, bodyWritingId: true } }
        }
      });
      if (!chapter) {
        throw new HttpError(404, 'Trashed chapter not found');
      }

      const sceneWritingIds = chapter.scenes.map((s) => s.bodyWritingId);

      await tx.chapter.delete({ where: { id: chapterId } });

      const writingIds = [chapter.bodyWritingId, ...sceneWritingIds];
      if (writingIds.length > 0) {
        await tx.writing.deleteMany({ where: { id: { in: writingIds } } });
      }
    });

    return reloadManuscript(this.prisma, projectId);
  }
}
