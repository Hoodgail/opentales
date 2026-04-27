import type { PrismaClient } from '@prisma/client';
import type { ManuscriptProject } from '@opentales/sdk';
import { getProjectInclude, toManuscriptProject } from './projectMapper.js';

export async function reloadManuscript(
  prisma: PrismaClient,
  projectId: string
): Promise<ManuscriptProject> {
  const project = await prisma.project.findUniqueOrThrow({
    where: { id: projectId },
    include: getProjectInclude()
  });
  return toManuscriptProject(project);
}
