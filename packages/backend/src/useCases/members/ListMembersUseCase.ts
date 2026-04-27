import type { PrismaClient } from '@prisma/client';
import type { OrgMember, ProjectInvite, Role as SdkRole } from '@opentales/sdk';
import { ProjectAccessRepository } from '../../repositories/ProjectAccessRepository.js';

export interface MembersAndInvites {
  members: OrgMember[];
  invites: ProjectInvite[];
  currentUserRole: SdkRole;
}

export class ListMembersUseCase {
  private readonly access: ProjectAccessRepository;

  constructor(private readonly prisma: PrismaClient) {
    this.access = new ProjectAccessRepository(prisma);
  }

  async execute(userId: string, projectId: string): Promise<MembersAndInvites> {
    const role = await this.access.getProjectRole(userId, projectId);
    const orgId = await this.access.getProjectOrgId(projectId);

    const [memberships, invites] = await Promise.all([
      this.prisma.membership.findMany({
        where: { orgId },
        orderBy: [{ role: 'asc' }, { createdAt: 'asc' }],
        include: {
          user: {
            select: { id: true, username: true, email: true, name: true, avatarAssetId: true }
          }
        }
      }),
      this.prisma.invite.findMany({
        where: { orgId, acceptedAt: null, revokedAt: null },
        orderBy: { createdAt: 'desc' },
        include: {
          invitedBy: { select: { username: true } }
        }
      })
    ]);

    return {
      currentUserRole: role,
      members: memberships.map((m) => ({
        userId: m.userId,
        username: m.user.username,
        email: m.user.email,
        name: m.user.name,
        role: m.role,
        joinedAt: m.createdAt.toISOString()
      })),
      invites: invites.map((invite) => ({
        id: invite.id,
        username: invite.username,
        email: invite.email,
        role: invite.role,
        token: invite.token,
        expiresAt: invite.expiresAt.toISOString(),
        invitedById: invite.invitedById,
        invitedByUsername: invite.invitedBy.username,
        createdAt: invite.createdAt.toISOString()
      }))
    };
  }
}
