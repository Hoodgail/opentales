import type { PrismaClient } from '@prisma/client';
import type { CreateActInput, ManuscriptProject } from '@opentales/sdk';
import { HttpError } from '../../http/HttpError.js';
import { ProjectAccessRepository } from '../../repositories/ProjectAccessRepository.js';
import { reloadManuscript } from './reloadManuscript.js';

export class CreateActUseCase {
  private readonly access: ProjectAccessRepository;

  constructor(private readonly prisma: PrismaClient) {
    this.access = new ProjectAccessRepository(prisma);
  }

  async execute(
    userId: string,
    projectId: string,
    input: CreateActInput
  ): Promise<ManuscriptProject> {
    await this.access.assertProjectAccess(userId, projectId);

    const title = input.title?.trim();
    if (!title) {
      throw new HttpError(400, 'Act title is required');
    }

    await this.prisma.$transaction(async (tx) => {
      const last = await tx.act.findFirst({
        where: { projectId },
        orderBy: { order: 'desc' },
        select: { order: true }
      });
      const nextOrder = (last?.order ?? -1) + 1;

      await tx.act.create({
        data: {
          projectId,
          title,
          order: nextOrder
        }
      });
    });

    return reloadManuscript(this.prisma, projectId);
  }
}
