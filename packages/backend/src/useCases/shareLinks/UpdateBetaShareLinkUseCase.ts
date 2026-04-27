import type { Prisma, PrismaClient } from '@prisma/client';
import type { BetaShareLink, UpdateBetaShareLinkInput } from '@opentales/sdk';
import { HttpError } from '../../http/HttpError.js';
import { ProjectAccessRepository } from '../../repositories/ProjectAccessRepository.js';
import { toBetaShareLink } from './shareLinkMapper.js';

export class UpdateBetaShareLinkUseCase {
  private readonly access: ProjectAccessRepository;

  constructor(private readonly prisma: PrismaClient) {
    this.access = new ProjectAccessRepository(prisma);
  }

  async execute(
    userId: string,
    projectId: string,
    shareLinkId: string,
    input: UpdateBetaShareLinkInput
  ): Promise<BetaShareLink> {
    await this.access.assertPermission(userId, projectId, 'project:admin');

    const existing = await this.prisma.betaShareLink.findUnique({
      where: { id: shareLinkId },
      select: { id: true, projectId: true }
    });
    if (!existing || existing.projectId !== projectId) {
      throw new HttpError(404, 'Share link not found');
    }

    const data: Prisma.BetaShareLinkUpdateInput = {};
    if (input.label !== undefined) {
      data.label = input.label === null ? null : input.label.trim() || null;
    }
    if (input.allowComments !== undefined) {
      data.allowComments = input.allowComments;
    }
    if (input.expiresAt !== undefined) {
      if (input.expiresAt === null) {
        data.expiresAt = null;
      } else {
        const parsed = new Date(input.expiresAt);
        if (Number.isNaN(parsed.getTime())) {
          throw new HttpError(400, 'expiresAt must be a valid ISO date string');
        }
        data.expiresAt = parsed;
      }
    }
    if (input.chapterIds !== undefined) {
      const chapterIds = Array.from(new Set(input.chapterIds)).filter(
        (id): id is string => typeof id === 'string' && id.length > 0
      );
      if (chapterIds.length > 0) {
        const valid = await this.prisma.chapter.count({
          where: { projectId, id: { in: chapterIds } }
        });
        if (valid !== chapterIds.length) {
          throw new HttpError(400, 'One or more chapter ids do not belong to this project');
        }
      }
      data.chapterIds = chapterIds;
    }

    const updated = await this.prisma.betaShareLink.update({
      where: { id: shareLinkId },
      data
    });
    return toBetaShareLink(updated);
  }
}
