import type { PrismaClient } from '@prisma/client';
import type { BetaShareLink } from '@opentales/sdk';
import { HttpError } from '../../http/HttpError.js';
import { ProjectAccessRepository } from '../../repositories/ProjectAccessRepository.js';
import { toBetaShareLink } from './shareLinkMapper.js';

export class RevokeBetaShareLinkUseCase {
  private readonly access: ProjectAccessRepository;

  constructor(private readonly prisma: PrismaClient) {
    this.access = new ProjectAccessRepository(prisma);
  }

  async execute(
    userId: string,
    projectId: string,
    shareLinkId: string
  ): Promise<BetaShareLink> {
    await this.access.assertPermission(userId, projectId, 'project:admin');

    const existing = await this.prisma.betaShareLink.findUnique({
      where: { id: shareLinkId },
      select: { id: true, projectId: true }
    });
    if (!existing || existing.projectId !== projectId) {
      throw new HttpError(404, 'Share link not found');
    }

    const revoked = await this.prisma.betaShareLink.update({
      where: { id: shareLinkId },
      data: { revokedAt: new Date() }
    });
    return toBetaShareLink(revoked);
  }
}
