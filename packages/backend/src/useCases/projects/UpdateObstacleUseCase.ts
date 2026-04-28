import { Prisma, type ObstacleType, type PrismaClient } from '@prisma/client';
import type { Obstacle, UpdateObstacleInput } from '@opentales/sdk';
import { HttpError } from '../../http/HttpError.js';
import { ProjectAccessRepository } from '../../repositories/ProjectAccessRepository.js';
import { WritingUseCase } from '../writings/WritingUseCase.js';

const obstacleTypeMap: Record<string, ObstacleType> = {
  internal: 'INTERNAL',
  external: 'EXTERNAL',
  interpersonal: 'INTERPERSONAL'
};

export class UpdateObstacleUseCase {
  private readonly access: ProjectAccessRepository;
  private readonly writingUseCase = new WritingUseCase();

  constructor(private readonly prisma: PrismaClient) {
    this.access = new ProjectAccessRepository(prisma);
  }

  async execute(
    userId: string,
    projectId: string,
    obstacleId: string,
    input: UpdateObstacleInput
  ): Promise<Obstacle> {
    await this.access.assertProjectAccess(userId, projectId);

    await this.prisma.$transaction(async (tx) => {
      const obstacle = await tx.obstacle.findFirst({
        where: { id: obstacleId, projectId },
        select: { id: true, descriptionWritingId: true, resolutionWritingId: true }
      });
      if (!obstacle) {
        throw new HttpError(404, 'Obstacle not found');
      }

      const data: Prisma.ObstacleUpdateInput = {};
      if (input.title !== undefined) {
        const title = input.title.trim();
        if (!title) throw new HttpError(400, 'Obstacle title is required');
        data.title = title;
      }
      if (input.type !== undefined) {
        const type = obstacleTypeMap[input.type];
        if (!type) throw new HttpError(400, `Invalid obstacle type: ${input.type}`);
        data.type = type;
      }
      if (input.order !== undefined) {
        data.order = input.order;
      }

      if (Object.keys(data).length > 0) {
        await tx.obstacle.update({ where: { id: obstacleId }, data });
      }

      if (input.description !== undefined) {
        await this.writingUseCase.updateDefaultBranch(tx, {
          writingId: obstacle.descriptionWritingId,
          body: input.description,
          authorId: userId,
          message: 'Update obstacle description'
        });
      }
      if (input.resolution !== undefined) {
        await this.writingUseCase.updateDefaultBranch(tx, {
          writingId: obstacle.resolutionWritingId,
          body: input.resolution,
          authorId: userId,
          message: 'Update obstacle resolution'
        });
      }
    });

    return this.reload(obstacleId);
  }

  private async reload(obstacleId: string): Promise<Obstacle> {
    const obstacle = await this.prisma.obstacle.findUniqueOrThrow({
      where: { id: obstacleId },
      include: {
        descriptionWriting: { include: { defaultBranch: { include: { headVersion: true } } } },
        resolutionWriting: { include: { defaultBranch: { include: { headVersion: true } } } }
      }
    });
    return {
      id: obstacle.id,
      title: obstacle.title,
      type: obstacle.type.toLowerCase() as Obstacle['type'],
      description: obstacle.descriptionWriting.defaultBranch?.headVersion?.body ?? '',
      resolution: obstacle.resolutionWriting.defaultBranch?.headVersion?.body ?? ''
    };
  }
}
