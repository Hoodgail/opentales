import { Prisma, type PrismaClient } from '@prisma/client';
import type { Location, UpdateLocationInput } from '@opentales/sdk';
import { HttpError } from '../../http/HttpError.js';
import { ProjectAccessRepository } from '../../repositories/ProjectAccessRepository.js';
import { WritingUseCase } from '../writings/WritingUseCase.js';
import { toLocation } from './projectMapper.js';

export class UpdateLocationUseCase {
  private readonly access: ProjectAccessRepository;
  private readonly writingUseCase = new WritingUseCase();

  constructor(private readonly prisma: PrismaClient) {
    this.access = new ProjectAccessRepository(prisma);
  }

  async execute(
    userId: string,
    projectId: string,
    locationId: string,
    input: UpdateLocationInput
  ): Promise<Location> {
    await this.access.assertPermission(userId, projectId, 'project:write');

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

      const data: Prisma.LocationUpdateInput = {
        name: input.name,
        type: input.type
      };

      if (input.imageAssetId !== undefined) {
        data.imageAsset = input.imageAssetId
          ? { connect: { id: input.imageAssetId } }
          : { disconnect: true };
      }

      await tx.location.update({
        where: { id: locationId },
        data
      });

      await this.updateText(tx, location.descriptionWritingId, input.description, userId, 'Update location description');
      await this.updateText(tx, location.atmosphereWritingId, input.atmosphere, userId, 'Update location atmosphere');
      await this.updateText(tx, location.significanceWritingId, input.significance, userId, 'Update location significance');
      await this.updateText(tx, location.sensoryWritingId, input.sensoryDetails, userId, 'Update location sensory details');
    });

    return this.reload(locationId);
  }

  private async updateText(
    tx: Prisma.TransactionClient,
    writingId: string,
    body: string | undefined,
    authorId: string,
    message: string
  ) {
    if (body === undefined) return;
    await this.writingUseCase.updateDefaultBranch(tx, { writingId, body, authorId, message });
  }

  private async reload(locationId: string): Promise<Location> {
    const location = await this.prisma.location.findUniqueOrThrow({
      where: { id: locationId },
      include: {
        descriptionWriting: { include: { defaultBranch: { include: { headVersion: true } } } },
        atmosphereWriting: { include: { defaultBranch: { include: { headVersion: true } } } },
        significanceWriting: { include: { defaultBranch: { include: { headVersion: true } } } },
        sensoryWriting: { include: { defaultBranch: { include: { headVersion: true } } } }
      }
    });
    return toLocation(location);
  }
}
