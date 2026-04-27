import type { Prisma, PrismaClient } from '@prisma/client';
import type { BetaShareChapter, BetaShareComment, BetaShareView } from '@opentales/sdk';
import { HttpError } from '../../http/HttpError.js';

export class GetBetaShareViewUseCase {
  constructor(private readonly prisma: PrismaClient) {}

  async execute(token: string): Promise<BetaShareView> {
    const link = await this.prisma.betaShareLink.findUnique({
      where: { token },
      include: {
        project: { select: { id: true, title: true, description: true, archivedAt: true } },
        comments: { orderBy: { createdAt: 'asc' } }
      }
    });

    if (!link || link.revokedAt || link.project.archivedAt) {
      throw new HttpError(404, 'Share link not found');
    }
    if (link.expiresAt && link.expiresAt.getTime() < Date.now()) {
      throw new HttpError(410, 'Share link has expired');
    }

    const chapterFilter: Prisma.ChapterWhereInput = {
      projectId: link.projectId,
      ...(link.chapterIds.length > 0 ? { id: { in: link.chapterIds } } : {})
    };

    const chapters = await this.prisma.chapter.findMany({
      where: chapterFilter,
      orderBy: [{ number: 'asc' }],
      include: {
        bodyWriting: { include: { defaultBranch: { include: { headVersion: true } } } }
      }
    });

    const out: BetaShareChapter[] = chapters.map((chapter) => {
      const head = chapter.bodyWriting.defaultBranch?.headVersion;
      return {
        id: chapter.id,
        number: chapter.number,
        title: chapter.title,
        summary: chapter.summary ?? '',
        wordCount: head?.wordCount ?? 0,
        content: head?.body ?? ''
      };
    });

    const comments: BetaShareComment[] = link.comments.map((c) => ({
      id: c.id,
      visitorName: c.visitorName,
      body: c.body,
      chapterId: c.chapterId,
      lineStart: c.lineStart,
      lineEnd: c.lineEnd,
      createdAt: c.createdAt.toISOString()
    }));

    return {
      projectTitle: link.project.title,
      projectDescription: link.project.description ?? '',
      shareLabel: link.label,
      allowComments: link.allowComments,
      expiresAt: link.expiresAt ? link.expiresAt.toISOString() : null,
      chapters: out,
      comments
    };
  }
}
