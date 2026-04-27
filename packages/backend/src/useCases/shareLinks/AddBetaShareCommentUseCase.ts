import type { PrismaClient } from '@prisma/client';
import type { BetaShareView, CreateBetaShareCommentInput } from '@opentales/sdk';
import { HttpError } from '../../http/HttpError.js';
import { GetBetaShareViewUseCase } from './GetBetaShareViewUseCase.js';

const MAX_NAME = 80;
const MAX_BODY = 4000;

export class AddBetaShareCommentUseCase {
  private readonly viewUseCase: GetBetaShareViewUseCase;

  constructor(private readonly prisma: PrismaClient) {
    this.viewUseCase = new GetBetaShareViewUseCase(prisma);
  }

  async execute(token: string, input: CreateBetaShareCommentInput): Promise<BetaShareView> {
    const visitorName = (input.visitorName ?? '').trim();
    const body = (input.body ?? '').trim();
    if (!visitorName) throw new HttpError(400, 'visitorName is required');
    if (!body) throw new HttpError(400, 'body is required');
    if (visitorName.length > MAX_NAME) {
      throw new HttpError(400, `visitorName must be at most ${MAX_NAME} characters`);
    }
    if (body.length > MAX_BODY) {
      throw new HttpError(400, `body must be at most ${MAX_BODY} characters`);
    }

    const link = await this.prisma.betaShareLink.findUnique({
      where: { token },
      select: {
        id: true,
        allowComments: true,
        revokedAt: true,
        expiresAt: true,
        projectId: true,
        chapterIds: true
      }
    });
    if (!link || link.revokedAt) throw new HttpError(404, 'Share link not found');
    if (link.expiresAt && link.expiresAt.getTime() < Date.now()) {
      throw new HttpError(410, 'Share link has expired');
    }
    if (!link.allowComments) {
      throw new HttpError(403, 'Comments are disabled for this share');
    }

    let chapterId: string | null = null;
    if (input.chapterId) {
      // Confirm the chapter is part of this project AND (if scoped) part of the share.
      const chapter = await this.prisma.chapter.findFirst({
        where: { id: input.chapterId, projectId: link.projectId },
        select: { id: true }
      });
      if (!chapter) throw new HttpError(400, 'Unknown chapter');
      if (link.chapterIds.length > 0 && !link.chapterIds.includes(chapter.id)) {
        throw new HttpError(403, 'This chapter is not included in the share');
      }
      chapterId = chapter.id;
    }

    let lineStart: number | null = null;
    let lineEnd: number | null = null;
    if (input.lineStart != null && input.lineEnd != null) {
      if (
        !Number.isInteger(input.lineStart) ||
        !Number.isInteger(input.lineEnd) ||
        input.lineStart < 1 ||
        input.lineEnd < input.lineStart
      ) {
        throw new HttpError(400, 'lineStart/lineEnd must be valid 1-indexed integers');
      }
      lineStart = input.lineStart;
      lineEnd = input.lineEnd;
    }

    await this.prisma.betaShareComment.create({
      data: {
        shareLinkId: link.id,
        visitorName,
        body,
        chapterId,
        lineStart,
        lineEnd
      }
    });

    return this.viewUseCase.execute(token);
  }
}
