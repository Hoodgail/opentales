import { Prisma, type PrismaClient } from '@prisma/client';
import type { ManuscriptProject, UpdateActInput } from '@opentales/sdk';
import { HttpError } from '../../http/HttpError.js';
import { ProjectAccessRepository } from '../../repositories/ProjectAccessRepository.js';
import { reloadManuscript } from './reloadManuscript.js';

export class UpdateActUseCase {
  private readonly access: ProjectAccessRepository;

  constructor(private readonly prisma: PrismaClient) {
    this.access = new ProjectAccessRepository(prisma);
  }

  async execute(
    userId: string,
    projectId: string,
    actId: string,
    input: UpdateActInput
  ): Promise<ManuscriptProject> {
    await this.access.assertProjectAccess(userId, projectId);

    await this.prisma.$transaction(async (tx) => {
      const act = await tx.act.findFirst({
        where: { id: actId, projectId },
        select: { id: true }
      });
      if (!act) {
        throw new HttpError(404, 'Act not found');
      }

      if (input.title !== undefined) {
        const title = input.title.trim();
        if (!title) {
          throw new HttpError(400, 'Act title is required');
        }
        await tx.act.update({ where: { id: actId }, data: { title } });
      }

      if (input.chapterIds !== undefined) {
        await this.reorderChapters(tx, projectId, actId, input.chapterIds);
      }
    });

    return reloadManuscript(this.prisma, projectId);
  }

  private async reorderChapters(
    tx: Prisma.TransactionClient,
    projectId: string,
    actId: string,
    chapterIds: string[]
  ) {
    if (chapterIds.length === 0) return;

    const chapters = await tx.chapter.findMany({
      where: { id: { in: chapterIds }, projectId },
      select: { id: true }
    });

    const known = new Set(chapters.map((c) => c.id));
    const unknown = chapterIds.find((id) => !known.has(id));
    if (unknown) {
      throw new HttpError(400, `Chapter ${unknown} is not part of this project`);
    }

    for (let i = 0; i < chapterIds.length; i += 1) {
      await tx.chapter.update({
        where: { id: chapterIds[i] },
        data: { actId, order: i }
      });
    }
  }
}
