import type { PrismaClient } from '@prisma/client';
import type { ManuscriptProject } from '@opentales/sdk';
import { HttpError } from '../../http/HttpError.js';
import { ProjectAccessRepository } from '../../repositories/ProjectAccessRepository.js';
import { reloadManuscript } from './reloadManuscript.js';

export class DeleteLocationUseCase {
  private readonly access: ProjectAccessRepository;

  constructor(private readonly prisma: PrismaClient) {
    this.access = new ProjectAccessRepository(prisma);
  }

  async execute(
    userId: string,
    projectId: string,
    locationId: string
  ): Promise<ManuscriptProject> {
    await this.access.assertProjectAccess(userId, projectId);

    await this.prisma.$transaction(async (tx) => {
      const location = await tx.location.findFirst({
        where: { id: locationId, projectId },
        select: {
          id: true,
          descriptionWritingId: true,
          atmosphereWritingId: true,
          significanceWritingId: true,
          sensoryWritingId: true
        }
      });
      if (!location) {
        throw new HttpError(404, 'Location not found');
      }

      await tx.chapter.updateMany({
        where: { projectId, locationId },
        data: { locationId: null }
      });
      await tx.scene.updateMany({
        where: { locationId },
        data: { locationId: null }
      });

      await tx.location.delete({ where: { id: locationId } });

      const writingIds = [
        location.descriptionWritingId,
        location.atmosphereWritingId,
        location.significanceWritingId,
        location.sensoryWritingId
      ];
      await tx.writing.deleteMany({ where: { id: { in: writingIds } } });
    });

    return reloadManuscript(this.prisma, projectId);
  }
}
