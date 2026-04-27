import type { PrismaClient } from '@prisma/client';
import type { ManuscriptProject } from '@opentales/sdk';
import { HttpError } from '../../http/HttpError.js';
import { ProjectAccessRepository } from '../../repositories/ProjectAccessRepository.js';
import { reloadManuscript } from '../projects/reloadManuscript.js';

export class RestoreChapterUseCase {
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
      where: { id: chapterId, projectId, deletedAt: { not: null } },
      select: { id: true }
    });
    if (!chapter) {
      throw new HttpError(404, 'Trashed chapter not found');
    }

    await this.prisma.chapter.update({
      where: { id: chapterId },
      data: { deletedAt: null }
    });

    return reloadManuscript(this.prisma, projectId);
  }
}
