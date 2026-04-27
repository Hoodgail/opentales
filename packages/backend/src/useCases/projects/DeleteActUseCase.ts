import type { PrismaClient } from '@prisma/client';
import type { ManuscriptProject } from '@opentales/sdk';
import { HttpError } from '../../http/HttpError.js';
import { ProjectAccessRepository } from '../../repositories/ProjectAccessRepository.js';
import { reloadManuscript } from './reloadManuscript.js';

export class DeleteActUseCase {
  private readonly access: ProjectAccessRepository;

  constructor(private readonly prisma: PrismaClient) {
    this.access = new ProjectAccessRepository(prisma);
  }

  async execute(userId: string, projectId: string, actId: string): Promise<ManuscriptProject> {
    await this.access.assertProjectAccess(userId, projectId);

    await this.prisma.$transaction(async (tx) => {
      const act = await tx.act.findFirst({
        where: { id: actId, projectId },
        select: { id: true }
      });
      if (!act) {
        throw new HttpError(404, 'Act not found');
      }

      // Detach chapters from the act before deleting so they survive as
      // orphaned chapters rather than being lost.
      await tx.chapter.updateMany({
        where: { projectId, actId },
        data: { actId: null }
      });

      await tx.act.delete({ where: { id: actId } });
    });

    return reloadManuscript(this.prisma, projectId);
  }
}
