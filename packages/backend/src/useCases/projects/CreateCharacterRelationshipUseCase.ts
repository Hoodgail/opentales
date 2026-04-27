import type { PrismaClient } from '@prisma/client';
import type { CreateCharacterRelationshipInput, ManuscriptProject } from '@opentales/sdk';
import { HttpError } from '../../http/HttpError.js';
import { ProjectAccessRepository } from '../../repositories/ProjectAccessRepository.js';
import { reloadManuscript } from './reloadManuscript.js';

export class CreateCharacterRelationshipUseCase {
  private readonly access: ProjectAccessRepository;

  constructor(private readonly prisma: PrismaClient) {
    this.access = new ProjectAccessRepository(prisma);
  }

  async execute(
    userId: string,
    projectId: string,
    fromCharacterId: string,
    input: CreateCharacterRelationshipInput
  ): Promise<ManuscriptProject> {
    await this.access.assertProjectAccess(userId, projectId);

    const type = input.type?.trim();
    if (!type) {
      throw new HttpError(400, 'Relationship type is required');
    }
    if (!input.toCharacterId) {
      throw new HttpError(400, 'toCharacterId is required');
    }
    if (input.toCharacterId === fromCharacterId) {
      throw new HttpError(400, 'A character cannot have a relationship with themselves');
    }

    await this.prisma.$transaction(async (tx) => {
      const characters = await tx.character.findMany({
        where: { projectId, id: { in: [fromCharacterId, input.toCharacterId] } },
        select: { id: true }
      });
      if (characters.length !== 2) {
        throw new HttpError(400, 'Both characters must belong to this project');
      }

      const existing = await tx.characterRelationship.findUnique({
        where: {
          fromCharacterId_toCharacterId_type: {
            fromCharacterId,
            toCharacterId: input.toCharacterId,
            type
          }
        },
        select: { id: true }
      });
      if (existing) {
        throw new HttpError(409, 'Relationship already exists');
      }

      await tx.characterRelationship.create({
        data: {
          projectId,
          fromCharacterId,
          toCharacterId: input.toCharacterId,
          type,
          note: input.note ?? null
        }
      });
    });

    return reloadManuscript(this.prisma, projectId);
  }
}
