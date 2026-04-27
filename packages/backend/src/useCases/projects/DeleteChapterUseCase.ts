import type { PrismaClient } from '@prisma/client';
import type { ManuscriptProject } from '@opentales/sdk';
import { HttpError } from '../../http/HttpError.js';
import { ProjectAccessRepository } from '../../repositories/ProjectAccessRepository.js';
import { reloadManuscript } from './reloadManuscript.js';

export class DeleteChapterUseCase {
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

    const chapter = await this.prisma.chapter.findFirst({
      where: { id: chapterId, projectId, deletedAt: null },
      select: { id: true }
    });
    if (!chapter) {
      throw new HttpError(404, 'Chapter not found');
    }

    // Soft delete — keep all body writings intact so restore is lossless.
    // The Trash panel can permanently purge later.
    await this.prisma.chapter.update({
      where: { id: chapterId },
      data: { deletedAt: new Date() }
    });

    return reloadManuscript(this.prisma, projectId);
  }
}
