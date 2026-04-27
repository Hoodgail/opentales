import type { ChapterStatus, PrismaClient } from '@prisma/client';
import type { CreateChapterInput, ManuscriptProject } from '@opentales/sdk';
import { HttpError } from '../../http/HttpError.js';
import { ProjectAccessRepository } from '../../repositories/ProjectAccessRepository.js';
import { WritingUseCase } from '../writings/WritingUseCase.js';
import { reloadManuscript } from './reloadManuscript.js';

const statusMap: Record<string, ChapterStatus> = {
  draft: 'DRAFT',
  'in-progress': 'IN_PROGRESS',
  review: 'REVIEW',
  final: 'FINAL'
};

export class CreateChapterUseCase {
  private readonly access: ProjectAccessRepository;
  private readonly writingUseCase = new WritingUseCase();

  constructor(private readonly prisma: PrismaClient) {
    this.access = new ProjectAccessRepository(prisma);
  }

  async execute(
    userId: string,
    projectId: string,
    input: CreateChapterInput
  ): Promise<ManuscriptProject> {
    await this.access.assertProjectAccess(userId, projectId);

    const title = input.title?.trim();
    if (!title) {
      throw new HttpError(400, 'Chapter title is required');
    }

    await this.prisma.$transaction(async (tx) => {
      if (input.actId) {
        const act = await tx.act.findFirst({
          where: { id: input.actId, projectId },
          select: { id: true }
        });
        if (!act) {
          throw new HttpError(400, 'Act does not belong to this project');
        }
      }

      if (input.povCharacterId) {
        const character = await tx.character.findFirst({
          where: { id: input.povCharacterId, projectId },
          select: { id: true }
        });
        if (!character) {
          throw new HttpError(400, 'POV character does not belong to this project');
        }
      }

      if (input.locationId) {
        const location = await tx.location.findFirst({
          where: { id: input.locationId, projectId },
          select: { id: true }
        });
        if (!location) {
          throw new HttpError(400, 'Location does not belong to this project');
        }
      }

      const lastNumber = await tx.chapter.findFirst({
        where: { projectId },
        orderBy: { number: 'desc' },
        select: { number: true }
      });
      const nextNumber = (lastNumber?.number ?? 0) + 1;

      const lastOrder = await tx.chapter.findFirst({
        where: { projectId, actId: input.actId ?? null },
        orderBy: { order: 'desc' },
        select: { order: true }
      });
      const nextOrder = (lastOrder?.order ?? -1) + 1;

      const bodyWritingId = await this.writingUseCase.createWriting(tx, {
        projectId,
        kind: 'CHAPTER_BODY',
        body: input.content,
        authorId: userId
      });

      await tx.chapter.create({
        data: {
          projectId,
          actId: input.actId ?? null,
          number: nextNumber,
          title,
          status: input.status ? statusMap[input.status] : 'DRAFT',
          povCharacterId: input.povCharacterId ?? null,
          locationId: input.locationId ?? null,
          summary: input.summary,
          bodyWritingId,
          order: nextOrder
        }
      });
    });

    return reloadManuscript(this.prisma, projectId);
  }
}
