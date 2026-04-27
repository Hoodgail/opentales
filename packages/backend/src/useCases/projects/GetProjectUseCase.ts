import type { PrismaClient } from '@prisma/client';
import type { ManuscriptProject } from '@opentales/sdk';
import { HttpError } from '../../http/HttpError.js';
import { ProjectAccessRepository } from '../../repositories/ProjectAccessRepository.js';
import { getProjectInclude, toManuscriptProject } from './projectMapper.js';

export class GetProjectUseCase {
  private readonly access: ProjectAccessRepository;

  constructor(private readonly prisma: PrismaClient) {
    this.access = new ProjectAccessRepository(prisma);
  }

  async execute(userId: string, projectId: string): Promise<ManuscriptProject> {
    await this.access.assertProjectAccess(userId, projectId);

    const project = await this.prisma.project.findUnique({
      where: { id: projectId },
      include: getProjectInclude()
    });

    if (!project) {
      throw new HttpError(404, 'Project not found');
    }

    return toManuscriptProject(project);
  }
}
