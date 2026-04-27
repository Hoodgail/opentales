import { Prisma, type PrismaClient } from '@prisma/client';
import type { ManuscriptProject, UpdateStructureInput } from '@opentales/sdk';
import { HttpError } from '../../http/HttpError.js';
import { ProjectAccessRepository } from '../../repositories/ProjectAccessRepository.js';
import { WritingUseCase } from '../writings/WritingUseCase.js';
import { getProjectInclude, toManuscriptProject } from './projectMapper.js';

export class UpdateStructureUseCase {
  private readonly access: ProjectAccessRepository;
  private readonly writingUseCase = new WritingUseCase();

  constructor(private readonly prisma: PrismaClient) {
    this.access = new ProjectAccessRepository(prisma);
  }

  async execute(userId: string, projectId: string, input: UpdateStructureInput): Promise<ManuscriptProject> {
    await this.access.assertProjectAccess(userId, projectId);

    await this.prisma.$transaction(async (tx) => {
      await tx.project.update({
        where: { id: projectId },
        data: {
          title: input.title,
          genre: input.genre,
          perspective: input.perspective,
          pov: input.pov,
          voice: input.voice,
          tone: input.tone,
          themes: input.themes
        }
      });

      const structure = await tx.storyStructure.findUnique({
        where: { projectId },
        select: { loglineWritingId: true, outlineWritingId: true, climaxWritingId: true }
      });

      if (!structure) {
        throw new HttpError(404, 'Story structure not found');
      }

      await this.updateText(tx, structure.loglineWritingId, input.logline, userId, 'Update logline');
      await this.updateText(tx, structure.outlineWritingId, input.outline, userId, 'Update outline');
      await this.updateText(tx, structure.climaxWritingId, input.climax, userId, 'Update climax');
    });

    return this.reload(projectId);
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

  private async reload(projectId: string): Promise<ManuscriptProject> {
    const project = await this.prisma.project.findUniqueOrThrow({
      where: { id: projectId },
      include: getProjectInclude()
    });
    return toManuscriptProject(project);
  }
}
