import type { PrismaClient, Role } from '@prisma/client';
import { HttpError } from '../../http/HttpError.js';
import { ProjectAccessRepository } from '../../repositories/ProjectAccessRepository.js';
import { rankRole } from '../../utils/permissions.js';

export class UpdateMemberRoleUseCase {
  private readonly access: ProjectAccessRepository;

  constructor(private readonly prisma: PrismaClient) {
    this.access = new ProjectAccessRepository(prisma);
  }

  async execute(
    userId: string,
    projectId: string,
    targetUserId: string,
    role: Role
  ): Promise<void> {
    const callerRole = await this.access.assertPermission(userId, projectId, 'org:admin');
    const orgId = await this.access.getProjectOrgId(projectId);

    const target = await this.prisma.membership.findUnique({
      where: { orgId_userId: { orgId, userId: targetUserId } },
      select: { id: true, role: true, userId: true }
    });

    if (!target) {
      throw new HttpError(404, 'Member not found');
    }

    // Only an OWNER can promote/demote another OWNER or change role to OWNER.
    if (rankRole(target.role) >= rankRole('OWNER') || role === 'OWNER') {
      if (callerRole !== 'OWNER') {
        throw new HttpError(403, 'Only the owner can change ownership');
      }
    }

    if (target.role === 'OWNER' && role !== 'OWNER') {
      const ownerCount = await this.prisma.membership.count({
        where: { orgId, role: 'OWNER' }
      });
      if (ownerCount <= 1) {
        throw new HttpError(400, 'Cannot demote the last owner of the workspace');
      }
    }

    await this.prisma.membership.update({
      where: { id: target.id },
      data: { role }
    });
  }
}
