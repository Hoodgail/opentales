import type { PrismaClient } from '@prisma/client';
import { HttpError } from '../../http/HttpError.js';
import { ProjectAccessRepository } from '../../repositories/ProjectAccessRepository.js';

export class RevokeInviteUseCase {
  private readonly access: ProjectAccessRepository;

  constructor(private readonly prisma: PrismaClient) {
    this.access = new ProjectAccessRepository(prisma);
  }

  async execute(userId: string, projectId: string, inviteId: string): Promise<void> {
    await this.access.assertPermission(userId, projectId, 'org:admin');
    const orgId = await this.access.getProjectOrgId(projectId);

    const invite = await this.prisma.invite.findUnique({
      where: { id: inviteId },
      select: { id: true, orgId: true, acceptedAt: true, revokedAt: true }
    });

    if (!invite || invite.orgId !== orgId) {
      throw new HttpError(404, 'Invite not found');
    }
    if (invite.acceptedAt) {
      throw new HttpError(400, 'Invite already accepted');
    }
    if (invite.revokedAt) {
      return; // idempotent
    }

    await this.prisma.invite.update({
      where: { id: inviteId },
      data: { revokedAt: new Date() }
    });
  }
}
