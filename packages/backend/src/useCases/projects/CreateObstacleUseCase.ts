import type { ObstacleType, PrismaClient } from '@prisma/client';
import type { CreateObstacleInput, ManuscriptProject } from '@opentales/sdk';
import { HttpError } from '../../http/HttpError.js';
import { ProjectAccessRepository } from '../../repositories/ProjectAccessRepository.js';
import { WritingUseCase } from '../writings/WritingUseCase.js';
import { reloadManuscript } from './reloadManuscript.js';

const obstacleTypeMap: Record<string, ObstacleType> = {
  internal: 'INTERNAL',
  external: 'EXTERNAL',
  interpersonal: 'INTERPERSONAL'
};

export class CreateObstacleUseCase {
  private readonly access: ProjectAccessRepository;
  private readonly writingUseCase = new WritingUseCase();

  constructor(private readonly prisma: PrismaClient) {
    this.access = new ProjectAccessRepository(prisma);
  }

  async execute(
    userId: string,
    projectId: string,
    input: CreateObstacleInput
  ): Promise<ManuscriptProject> {
    await this.access.assertProjectAccess(userId, projectId);

    const title = input.title?.trim();
    if (!title) {
      throw new HttpError(400, 'Obstacle title is required');
    }

    const type = obstacleTypeMap[input.type];
    if (!type) {
      throw new HttpError(400, `Invalid obstacle type: ${input.type}`);
    }

    await this.prisma.$transaction(async (tx) => {
      const last = await tx.obstacle.findFirst({
        where: { projectId },
        orderBy: { order: 'desc' },
        select: { order: true }
      });
      const nextOrder = (last?.order ?? -1) + 1;

      const descriptionWritingId = await this.writingUseCase.createWriting(tx, {
        projectId,
        kind: 'OBSTACLE_DESCRIPTION',
        body: input.description,
        authorId: userId
      });
      const resolutionWritingId = await this.writingUseCase.createWriting(tx, {
        projectId,
        kind: 'OBSTACLE_RESOLUTION',
        body: input.resolution,
        authorId: userId
      });

      await tx.obstacle.create({
        data: {
          projectId,
          title,
          type,
          descriptionWritingId,
          resolutionWritingId,
          order: nextOrder
        }
      });
    });

    return reloadManuscript(this.prisma, projectId);
  }
}
