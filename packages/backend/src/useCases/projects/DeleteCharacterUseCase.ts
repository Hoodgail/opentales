import type { PrismaClient } from '@prisma/client';
import type { ManuscriptProject } from '@opentales/sdk';
import { HttpError } from '../../http/HttpError.js';
import { ProjectAccessRepository } from '../../repositories/ProjectAccessRepository.js';
import { reloadManuscript } from './reloadManuscript.js';

export class DeleteCharacterUseCase {
  private readonly access: ProjectAccessRepository;

  constructor(private readonly prisma: PrismaClient) {
    this.access = new ProjectAccessRepository(prisma);
  }

  async execute(
    userId: string,
    projectId: string,
    characterId: string
  ): Promise<ManuscriptProject> {
    await this.access.assertProjectAccess(userId, projectId);

    await this.prisma.$transaction(async (tx) => {
      const character = await tx.character.findFirst({
        where: { id: characterId, projectId },
        select: {
          id: true,
          descriptionWritingId: true,
          appearanceWritingId: true,
          motivationWritingId: true,
          arcWritingId: true
        }
      });
      if (!character) {
        throw new HttpError(404, 'Character not found');
      }

      // Drop relationships pointing at this character before delete so the
      // FKs don't block the cascade.
      await tx.characterRelationship.deleteMany({
        where: {
          OR: [{ fromCharacterId: characterId }, { toCharacterId: characterId }]
        }
      });

      // Clear chapter references to this character (POV).
      await tx.chapter.updateMany({
        where: { projectId, povCharacterId: characterId },
        data: { povCharacterId: null }
      });
      await tx.scene.updateMany({
        where: { povCharacterId: characterId },
        data: { povCharacterId: null }
      });
      await tx.assetAttachment.deleteMany({
        where: { entityType: 'CHARACTER', entityId: characterId }
      });

      await tx.character.delete({ where: { id: characterId } });

      // Writings use onDelete: Restrict, so clean them up after the character row is gone.
      const writingIds = [
        character.descriptionWritingId,
        character.appearanceWritingId,
        character.motivationWritingId,
        character.arcWritingId
      ];
      await tx.writing.deleteMany({ where: { id: { in: writingIds } } });
    });

    return reloadManuscript(this.prisma, projectId);
  }
}
