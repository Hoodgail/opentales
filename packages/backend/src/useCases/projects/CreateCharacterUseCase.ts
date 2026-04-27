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
    if (!name) {
      throw new HttpError(400, 'Character name is required');
    }

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
