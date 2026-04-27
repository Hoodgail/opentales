import { randomBytes } from 'node:crypto';
import type { PrismaClient } from '@prisma/client';
import type { BetaShareLink, CreateBetaShareLinkInput } from '@opentales/sdk';
import { HttpError } from '../../http/HttpError.js';
import { ProjectAccessRepository } from '../../repositories/ProjectAccessRepository.js';
import { toBetaShareLink } from './shareLinkMapper.js';

function generateToken(): string {
  return randomBytes(24).toString('base64url');
}

export class CreateBetaShareLinkUseCase {
  private readonly access: ProjectAccessRepository;

  constructor(private readonly prisma: PrismaClient) {
    this.access = new ProjectAccessRepository(prisma);
  }

  async execute(
    userId: string,
    projectId: string,
    input: CreateBetaShareLinkInput
  ): Promise<BetaShareLink> {
    await this.access.assertPermission(userId, projectId, 'project:admin');

    let expiresAt: Date | null = null;
    if (input.expiresAt) {
      const parsed = new Date(input.expiresAt);
      if (Number.isNaN(parsed.getTime())) {
        throw new HttpError(400, 'expiresAt must be a valid ISO date string');
      }
      if (parsed.getTime() <= Date.now()) {
        throw new HttpError(400, 'expiresAt must be in the future');
      }
      expiresAt = parsed;
    }

    const chapterIds = Array.from(new Set(input.chapterIds ?? [])).filter(
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

    const created = await this.prisma.betaShareLink.create({
      data: {
        projectId,
        token: generateToken(),
        chapterIds,
        allowComments: input.allowComments ?? true,
        label: input.label?.trim() || null,
        createdById: userId,
        expiresAt
      }
    });

    return toBetaShareLink(created);
  }
}
