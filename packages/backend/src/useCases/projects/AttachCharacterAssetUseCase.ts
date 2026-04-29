import type { Prisma, PrismaClient } from '@prisma/client';
import type { AttachCharacterAssetInput, Character } from '@opentales/sdk';
import { HttpError } from '../../http/HttpError.js';
import { ProjectAccessRepository } from '../../repositories/ProjectAccessRepository.js';
import { toCharacter } from './projectMapper.js';

const CHARACTER_ASSET_ROLE = 'character-reference';

export class AttachCharacterAssetUseCase {
  private readonly access: ProjectAccessRepository;

  constructor(private readonly prisma: PrismaClient) {
    this.access = new ProjectAccessRepository(prisma);
  }

  async execute(
    userId: string,
    projectId: string,
    characterId: string,
    input: AttachCharacterAssetInput
  ): Promise<Character> {
    await this.access.assertProjectAccess(userId, projectId);

    const role = input.role?.trim() || CHARACTER_ASSET_ROLE;
    const asset = await this.prisma.asset.findFirst({
      where: { id: input.assetId, projectId },
      select: { id: true }
    });
    if (!asset) {
      throw new HttpError(404, 'Asset not found');
    }

    const character = await this.prisma.character.findFirst({
      where: { id: characterId, projectId },
      select: { id: true }
    });
    if (!character) {
      throw new HttpError(404, 'Character not found');
    }

    await this.prisma.assetAttachment.upsert({
      where: {
        entityType_entityId_role_assetId: {
          entityType: 'CHARACTER',
          entityId: characterId,
          role,
          assetId: input.assetId
        }
      },
      update: { order: input.order ?? null },
      create: {
        assetId: input.assetId,
        entityType: 'CHARACTER',
        entityId: characterId,
        role,
        order: input.order ?? null
      }
    });

    return this.reload(characterId, projectId);
  }

  private async reload(characterId: string, projectId: string): Promise<Character> {
    const character = await this.prisma.character.findUniqueOrThrow({
      where: { id: characterId },
      include: characterInclude
    });
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
