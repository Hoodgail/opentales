import type { PrismaClient } from '@prisma/client';
import type { ProjectSummary } from '@opentales/sdk';
import { ProjectAccessRepository } from '../../repositories/ProjectAccessRepository.js';
import { toProjectSummary } from './projectMapper.js';

export class ListProjectsUseCase {
  private readonly access: ProjectAccessRepository;

  constructor(private readonly prisma: PrismaClient) {
    this.access = new ProjectAccessRepository(prisma);
  }

  async execute(userId: string): Promise<ProjectSummary[]> {
    const orgIds = await this.access.getAccessibleOrgIds(userId);
    const projects = await this.prisma.project.findMany({
      where: { orgId: { in: orgIds }, archivedAt: null, deletedAt: null },
      orderBy: { updatedAt: 'desc' },
      select: {
        id: true,
        slug: true,
        title: true,
        description: true,
        genre: true,
        updatedAt: true,
        visibility: true,
        coverAssetId: true,
        coverOrientation: true
      }
    });

    return projects.map(toProjectSummary);
  }
}
