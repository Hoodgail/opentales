import type { PrismaClient } from '@prisma/client';
import type { CreateProjectInput, ProjectSummary } from '@opentales/sdk';
import { HttpError } from '../../http/HttpError.js';
import { ProjectAccessRepository } from '../../repositories/ProjectAccessRepository.js';
import { toSlug } from '../../utils/slug.js';
import { WritingUseCase } from '../writings/WritingUseCase.js';
import { toProjectSummary } from './projectMapper.js';

export class CreateProjectUseCase {
  private readonly access: ProjectAccessRepository;
  private readonly writingUseCase = new WritingUseCase();

  constructor(private readonly prisma: PrismaClient) {
    this.access = new ProjectAccessRepository(prisma);
  }

  async execute(userId: string, input: CreateProjectInput): Promise<ProjectSummary> {
    const title = input.title?.trim();
    if (!title) {
      throw new HttpError(400, 'Project title is required');
    }

    const orgId = await this.access.getDefaultOrgId(userId);
    const slug = toSlug(input.slug ?? title);
    if (!slug) {
      throw new HttpError(400, 'Project slug is invalid');
    }

    const project = await this.prisma.$transaction(async (tx) => {
      const created = await tx.project.create({
        data: {
          orgId,
          slug,
          title,
          genre: input.genre,
          perspective: input.perspective,
          pov: input.pov,
          voice: input.voice,
          tone: input.tone,
          themes: input.themes ?? []
        }
      });

      const loglineWritingId = await this.writingUseCase.createWriting(tx, {
        projectId: created.id,
        kind: 'LOGLINE',
        authorId: userId
      });
      const outlineWritingId = await this.writingUseCase.createWriting(tx, {
        projectId: created.id,
        kind: 'OUTLINE',
        authorId: userId
      });
      const climaxWritingId = await this.writingUseCase.createWriting(tx, {
        projectId: created.id,
        kind: 'CLIMAX',
        authorId: userId
      });

      await tx.storyStructure.create({
        data: {
          projectId: created.id,
          loglineWritingId,
          outlineWritingId,
          climaxWritingId
        }
      });

      return created;
    });

    return toProjectSummary(project);
  }
}
