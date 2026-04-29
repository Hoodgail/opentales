import type { Prisma, PrismaClient } from '@prisma/client';
import type { Character } from '@opentales/sdk';
import { HttpError } from '../../http/HttpError.js';
import { ProjectAccessRepository } from '../../repositories/ProjectAccessRepository.js';
import { toCharacter } from './projectMapper.js';

export class DetachCharacterAssetUseCase {
  private readonly access: ProjectAccessRepository;

  constructor(private readonly prisma: PrismaClient) {
    this.access = new ProjectAccessRepository(prisma);
  }

  async execute(
    userId: string,
    projectId: string,
    characterId: string,
    attachmentId: string
  ): Promise<Character> {
    await this.access.assertProjectAccess(userId, projectId);

    const attachment = await this.prisma.assetAttachment.findFirst({
      where: {
        id: attachmentId,
        entityType: 'CHARACTER',
        entityId: characterId,
        asset: { projectId }
      },
      select: { id: true }
    });
    if (!attachment) {
      throw new HttpError(404, 'Character asset not found');
    }

    await this.prisma.assetAttachment.delete({ where: { id: attachmentId } });

    return this.reload(characterId, projectId);
  }

  private async reload(characterId: string, projectId: string): Promise<Character> {
    const character = await this.prisma.character.findFirst({
      where: { id: characterId, projectId },
      include: characterInclude
    });
    if (!character) {
      throw new HttpError(404, 'Character not found');
    }

    const assets = await this.prisma.asset.findMany({
      where: { projectId, attachments: { some: { entityType: 'CHARACTER', entityId: characterId } } },
      include: { attachments: true },
      orderBy: { createdAt: 'asc' }
    });

    return toCharacter(character, assets);
  }
}

const characterInclude = {
  descriptionWriting: { include: { defaultBranch: { include: { headVersion: true } } } },
  appearanceWriting: { include: { defaultBranch: { include: { headVersion: true } } } },
  motivationWriting: { include: { defaultBranch: { include: { headVersion: true } } } },
  arcWriting: { include: { defaultBranch: { include: { headVersion: true } } } },
  outgoingRelationships: true
} satisfies Prisma.CharacterInclude;
