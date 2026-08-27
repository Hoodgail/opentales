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
    const aliases = normalizeAliases(input.aliases, name);

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
          aliases,
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

function normalizeAliases(values: string[] | undefined, name: string): string[] {
  if (values === undefined) return [];
  if (!Array.isArray(values) || values.length > 1_000) throw new HttpError(400, 'Location aliases must contain at most 1,000 values');
  const aliases = values.map((value) => {
    if (typeof value !== 'string' || !value.trim() || value.trim().length > 500) throw new HttpError(400, 'Each location alias must be between 1 and 500 characters');
    return value.trim();
  });
  const normalized = aliases.map((value) => value.toLocaleLowerCase());
  if (new Set(normalized).size !== normalized.length || normalized.includes(name.toLocaleLowerCase())) throw new HttpError(400, 'Location aliases must be unique and different from the location name');
  return aliases;
}
