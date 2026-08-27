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
    await this.access.assertPermission(userId, projectId, 'project:write');

    await this.prisma.$transaction(async (tx) => {
      const character = await tx.character.findFirst({
        where: { id: characterId, projectId },
        select: {
          id: true,
          name: true,
          descriptionWritingId: true,
          appearanceWritingId: true,
          motivationWritingId: true,
          arcWritingId: true
        }
      });

      if (!character) {
        throw new HttpError(404, 'Character not found');
      }
      const nextName = input.name === undefined ? character.name : input.name.trim();
      if (!nextName || nextName.length > 500) throw new HttpError(400, 'Character name must be between 1 and 500 characters');

      const data: Prisma.CharacterUpdateInput = {
        name: input.name === undefined ? undefined : nextName,
        role: input.role,
        age: input.age,
        occupation: input.occupation,
        traits: input.traits,
        aliases: input.aliases === undefined ? undefined : normalizeAliases(input.aliases, nextName)
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

    return this.reload(characterId, projectId);
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

  private async reload(characterId: string, projectId: string): Promise<Character> {
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
    const assets = await this.prisma.asset.findMany({
      where: { projectId, attachments: { some: { entityType: 'CHARACTER', entityId: characterId } } },
      include: { attachments: true },
      orderBy: { createdAt: 'asc' }
    });
    return toCharacter(character, assets);
  }
}

function normalizeAliases(values: string[], name: string): string[] {
  if (!Array.isArray(values) || values.length > 1_000) throw new HttpError(400, 'Character aliases must contain at most 1,000 values');
  const aliases = values.map((value) => {
    if (typeof value !== 'string' || !value.trim() || value.trim().length > 500) throw new HttpError(400, 'Each character alias must be between 1 and 500 characters');
    return value.trim();
  });
  const normalized = aliases.map((value) => value.toLocaleLowerCase());
  if (new Set(normalized).size !== normalized.length || normalized.includes(name.toLocaleLowerCase())) throw new HttpError(400, 'Character aliases must be unique and different from the character name');
  return aliases;
}
