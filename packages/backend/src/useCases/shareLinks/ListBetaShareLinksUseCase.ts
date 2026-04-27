import type { PrismaClient } from '@prisma/client';
import type { BetaShareLink } from '@opentales/sdk';
import { ProjectAccessRepository } from '../../repositories/ProjectAccessRepository.js';
import { toBetaShareLink } from './shareLinkMapper.js';

export class ListBetaShareLinksUseCase {
  private readonly access: ProjectAccessRepository;

  constructor(private readonly prisma: PrismaClient) {
    this.access = new ProjectAccessRepository(prisma);
  }

  async execute(userId: string, projectId: string): Promise<BetaShareLink[]> {
    await this.access.assertProjectAccess(userId, projectId);
    const rows = await this.prisma.betaShareLink.findMany({
      where: { projectId },
      orderBy: { createdAt: 'desc' }
    });
    return rows.map(toBetaShareLink);
  }
}
