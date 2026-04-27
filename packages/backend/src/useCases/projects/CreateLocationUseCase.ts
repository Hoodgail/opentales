import type { PrismaClient } from '@prisma/client';
import type { CreateLocationInput, ManuscriptProject } from '@opentales/sdk';
import { HttpError } from '../../http/HttpError.js';
import { ProjectAccessRepository } from '../../repositories/ProjectAccessRepository.js';
import { WritingUseCase } from '../writings/WritingUseCase.js';
import { reloadManuscript } from './reloadManuscript.js';

export class CreateLocationUseCase {
  private readonly access: ProjectAccessRepository;
  private readonly writingUseCase = new WritingUseCase();

  constructor(private readonly prisma: PrismaClient) {
    this.access = new ProjectAccessRepository(prisma);
  }

  async execute(
    userId: string,
    projectId: string,
    input: CreateLocationInput
  ): Promise<ManuscriptProject> {
    await this.access.assertProjectAccess(userId, projectId);

    const name = input.name?.trim();
    if (!name) {
      throw new HttpError(400, 'Location name is required');
    }

    await this.prisma.$transaction(async (tx) => {
      const descriptionWritingId = await this.writingUseCase.createWriting(tx, {
        projectId,
        kind: 'LOCATION_DESCRIPTION',
        body: input.description,
        authorId: userId
      });
      const atmosphereWritingId = await this.writingUseCase.createWriting(tx, {
        projectId,
        kind: 'LOCATION_ATMOSPHERE',
        body: input.atmosphere,
        authorId: userId
      });
      const significanceWritingId = await this.writingUseCase.createWriting(tx, {
        projectId,
        kind: 'LOCATION_SIGNIFICANCE',
        body: input.significance,
        authorId: userId
      });
      const sensoryWritingId = await this.writingUseCase.createWriting(tx, {
        projectId,
        kind: 'LOCATION_SENSORY',
        body: input.sensoryDetails,
        authorId: userId
      });

      await tx.location.create({
        data: {
          projectId,
          name,
          type: input.type,
          descriptionWritingId,
          atmosphereWritingId,
          significanceWritingId,
          sensoryWritingId
        }
      });
    });

    return reloadManuscript(this.prisma, projectId);
  }
}
