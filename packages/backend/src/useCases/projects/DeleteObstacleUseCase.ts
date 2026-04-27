import type { PrismaClient } from '@prisma/client';
import type { ManuscriptProject } from '@opentales/sdk';
import { HttpError } from '../../http/HttpError.js';
import { ProjectAccessRepository } from '../../repositories/ProjectAccessRepository.js';
import { reloadManuscript } from './reloadManuscript.js';

export class DeleteObstacleUseCase {
  private readonly access: ProjectAccessRepository;

  constructor(private readonly prisma: PrismaClient) {
    this.access = new ProjectAccessRepository(prisma);
  }

  async execute(
    userId: string,
    projectId: string,
    obstacleId: string
  ): Promise<ManuscriptProject> {
    await this.access.assertProjectAccess(userId, projectId);

    await this.prisma.$transaction(async (tx) => {
      const obstacle = await tx.obstacle.findFirst({
        where: { id: obstacleId, projectId },
        select: { id: true, descriptionWritingId: true, resolutionWritingId: true }
      });
      if (!obstacle) {
        throw new HttpError(404, 'Obstacle not found');
      }

      await tx.obstacle.delete({ where: { id: obstacleId } });
      await tx.writing.deleteMany({
        where: { id: { in: [obstacle.descriptionWritingId, obstacle.resolutionWritingId] } }
      });
    });

    return reloadManuscript(this.prisma, projectId);
  }
}
