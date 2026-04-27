import type { PrismaClient } from '@prisma/client';
import type { ManuscriptProject } from '@opentales/sdk';
import { HttpError } from '../../http/HttpError.js';
import { ProjectAccessRepository } from '../../repositories/ProjectAccessRepository.js';
import { reloadManuscript } from './reloadManuscript.js';

export class DeleteCharacterRelationshipUseCase {
  private readonly access: ProjectAccessRepository;

  constructor(private readonly prisma: PrismaClient) {
    this.access = new ProjectAccessRepository(prisma);
  }

  async execute(
    userId: string,
    projectId: string,
    fromCharacterId: string,
    relationshipId: string
  ): Promise<ManuscriptProject> {
    await this.access.assertProjectAccess(userId, projectId);

    await this.prisma.$transaction(async (tx) => {
      const relationship = await tx.characterRelationship.findFirst({
        where: { id: relationshipId, projectId, fromCharacterId },
        select: { id: true }
      });
      if (!relationship) {
        throw new HttpError(404, 'Relationship not found');
      }
      await tx.characterRelationship.delete({ where: { id: relationshipId } });
    });

    return reloadManuscript(this.prisma, projectId);
  }
}
