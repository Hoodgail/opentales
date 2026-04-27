import type { PrismaClient } from '@prisma/client';
import { HttpError } from '../../http/HttpError.js';
import { ProjectAccessRepository } from '../../repositories/ProjectAccessRepository.js';

export class RemoveMemberUseCase {
  private readonly access: ProjectAccessRepository;

  constructor(private readonly prisma: PrismaClient) {
    this.access = new ProjectAccessRepository(prisma);
  }

  async execute(userId: string, projectId: string, targetUserId: string): Promise<void> {
    const callerRole = await this.access.assertPermission(userId, projectId, 'org:admin');
    const orgId = await this.access.getProjectOrgId(projectId);

    const target = await this.prisma.membership.findUnique({
      where: { orgId_userId: { orgId, userId: targetUserId } },
      select: { id: true, role: true, userId: true }
    });

    if (!target) {
      throw new HttpError(404, 'Member not found');
    }

    if (target.role === 'OWNER') {
      const ownerCount = await this.prisma.membership.count({
        where: { orgId, role: 'OWNER' }
      });
      if (ownerCount <= 1) {
        throw new HttpError(400, 'Cannot remove the last owner of the workspace');
      }
      if (callerRole !== 'OWNER') {
        throw new HttpError(403, 'Only the owner can remove an owner');
      }
    }

    await this.prisma.membership.delete({ where: { id: target.id } });
  }
}
