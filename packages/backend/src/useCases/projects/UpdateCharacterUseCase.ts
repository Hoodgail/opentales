import { Prisma, type PrismaClient } from '@prisma/client';
import type { Character, UpdateCharacterInput } from '@opentales/sdk';
import { HttpError } from '../../http/HttpError.js';
import { ProjectAccessRepository } from '../../repositories/ProjectAccessRepository.js';
import { WritingUseCase } from '../writings/WritingUseCase.js';
import { toCharacter } from './projectMapper.js';

export class UpdateCharacterUseCase {
  private readonly access: ProjectAccessRepository;
  private readonly writingUseCase = new WritingUseCase();

  constructor(private readonly prisma: PrismaClient) {
    this.access = new ProjectAccessRepository(prisma);
  }

  async execute(
    userId: string,
    projectId: string,
    characterId: string,
    input: UpdateCharacterInput
  ): Promise<Character> {
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

      const data: Prisma.CharacterUpdateInput = {
        name: input.name,
        role: input.role,
        age: input.age,
        occupation: input.occupation,
        traits: input.traits
      };

      if (input.avatarAssetId !== undefined) {
        data.avatarAsset = input.avatarAssetId
          ? { connect: { id: input.avatarAssetId } }
          : { disconnect: true };
      }

      await tx.character.update({
        where: { id: characterId },
        data
      });

      await this.updateText(tx, character.descriptionWritingId, input.description, userId, 'Update character description');
      await this.updateText(tx, character.appearanceWritingId, input.appearance, userId, 'Update character appearance');
      await this.updateText(tx, character.motivationWritingId, input.motivation, userId, 'Update character motivation');
      await this.updateText(tx, character.arcWritingId, input.arc, userId, 'Update character arc');
    });

    return this.reload(characterId);
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

  private async reload(characterId: string): Promise<Character> {
    const character = await this.prisma.character.findUniqueOrThrow({
      where: { id: characterId },
      include: {
        descriptionWriting: { include: { defaultBranch: { include: { headVersion: true } } } },
        appearanceWriting: { include: { defaultBranch: { include: { headVersion: true } } } },
        motivationWriting: { include: { defaultBranch: { include: { headVersion: true } } } },
        arcWriting: { include: { defaultBranch: { include: { headVersion: true } } } },
        outgoingRelationships: true
      }
    });
    return toCharacter(character);
  }
}
