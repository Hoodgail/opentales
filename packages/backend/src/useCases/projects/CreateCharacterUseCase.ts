import type { PrismaClient } from '@prisma/client';
import type { CreateCharacterInput, ManuscriptProject } from '@opentales/sdk';
import { HttpError } from '../../http/HttpError.js';
import { ProjectAccessRepository } from '../../repositories/ProjectAccessRepository.js';
import { WritingUseCase } from '../writings/WritingUseCase.js';
import { reloadManuscript } from './reloadManuscript.js';

export class CreateCharacterUseCase {
  private readonly access: ProjectAccessRepository;
  private readonly writingUseCase = new WritingUseCase();

  constructor(private readonly prisma: PrismaClient) {
    this.access = new ProjectAccessRepository(prisma);
  }

  async execute(
    userId: string,
    projectId: string,
    input: CreateCharacterInput
  ): Promise<ManuscriptProject> {
    await this.access.assertProjectAccess(userId, projectId);

    const name = input.name?.trim();
    if (!name || name.length > 500) {
      throw new HttpError(400, 'Character name is required');
    }
    const aliases = normalizeAliases(input.aliases, name);

    await this.prisma.$transaction(async (tx) => {
      const descriptionWritingId = await this.writingUseCase.createWriting(tx, {
        projectId,
        kind: 'CHARACTER_DESCRIPTION',
        body: input.description,
        authorId: userId
      });
      const appearanceWritingId = await this.writingUseCase.createWriting(tx, {
        projectId,
        kind: 'CHARACTER_APPEARANCE',
        body: input.appearance,
        authorId: userId
      });
      const motivationWritingId = await this.writingUseCase.createWriting(tx, {
        projectId,
        kind: 'CHARACTER_MOTIVATION',
        body: input.motivation,
        authorId: userId
      });
      const arcWritingId = await this.writingUseCase.createWriting(tx, {
        projectId,
        kind: 'CHARACTER_ARC',
        body: input.arc,
        authorId: userId
      });

      await tx.character.create({
        data: {
          projectId,
          name,
          role: input.role,
          age: input.age,
          occupation: input.occupation,
          traits: input.traits ?? [],
          aliases,
          descriptionWritingId,
          appearanceWritingId,
          motivationWritingId,
          arcWritingId
        }
      });
    });

    return reloadManuscript(this.prisma, projectId);
  }
}

function normalizeAliases(values: string[] | undefined, name: string): string[] {
  if (values === undefined) return [];
  if (!Array.isArray(values) || values.length > 1_000) throw new HttpError(400, 'Character aliases must contain at most 1,000 values');
  const aliases = values.map((value) => {
    if (typeof value !== 'string' || !value.trim() || value.trim().length > 500) throw new HttpError(400, 'Each character alias must be between 1 and 500 characters');
    return value.trim();
  });
  const normalized = aliases.map((value) => value.toLocaleLowerCase());
  if (new Set(normalized).size !== normalized.length || normalized.includes(name.toLocaleLowerCase())) throw new HttpError(400, 'Character aliases must be unique and different from the character name');
  return aliases;
}
