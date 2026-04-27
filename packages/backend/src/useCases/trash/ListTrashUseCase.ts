import type { PrismaClient } from '@prisma/client';
import type { TrashItem } from '@opentales/sdk';
import { ProjectAccessRepository } from '../../repositories/ProjectAccessRepository.js';

const PURGE_AFTER_DAYS = 30;

export class ListTrashUseCase {
  private readonly access: ProjectAccessRepository;

  constructor(private readonly prisma: PrismaClient) {
    this.access = new ProjectAccessRepository(prisma);
  }

  async execute(userId: string, projectId: string): Promise<TrashItem[]> {
    await this.access.assertProjectAccess(userId, projectId);

    const chapters = await this.prisma.chapter.findMany({
      where: { projectId, deletedAt: { not: null } },
      orderBy: { deletedAt: 'desc' },
      include: {
        bodyWriting: { include: { defaultBranch: { include: { headVersion: true } } } }
      }
    });

    return chapters.map((chapter) => {
      const head = chapter.bodyWriting.defaultBranch?.headVersion;
      const deletedAt = (chapter.deletedAt as Date).toISOString();
      const purgesAt = new Date(
        (chapter.deletedAt as Date).getTime() + PURGE_AFTER_DAYS * 24 * 60 * 60 * 1000
      ).toISOString();
      return {
        kind: 'chapter',
        id: chapter.id,
        title: chapter.title,
        number: chapter.number,
        wordCount: head?.wordCount ?? 0,
        deletedAt,
        purgesAt
      } satisfies TrashItem;
    });
  }
}
