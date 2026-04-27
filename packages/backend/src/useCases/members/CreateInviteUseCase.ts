import { randomBytes } from 'node:crypto';
import type { PrismaClient, Role } from '@prisma/client';
import type { CreateInviteInput, ProjectInvite } from '@opentales/sdk';
import { HttpError } from '../../http/HttpError.js';
import { ProjectAccessRepository } from '../../repositories/ProjectAccessRepository.js';

const VALID_ROLES = new Set<Role>(['ADMIN', 'EDITOR', 'VIEWER', 'OWNER']);

function generateToken(): string {
  return randomBytes(24).toString('base64url');
}

export class CreateInviteUseCase {
  private readonly access: ProjectAccessRepository;

  constructor(private readonly prisma: PrismaClient) {
    this.access = new ProjectAccessRepository(prisma);
  }

  async execute(
    userId: string,
    projectId: string,
    input: CreateInviteInput
  ): Promise<ProjectInvite> {
    const callerRole = await this.access.assertPermission(userId, projectId, 'org:admin');
    const orgId = await this.access.getProjectOrgId(projectId);

    if (!VALID_ROLES.has(input.role)) {
      throw new HttpError(400, `Unknown role: ${input.role}`);
    }
    if (input.role === 'OWNER' && callerRole !== 'OWNER') {
      throw new HttpError(403, 'Only an owner can invite another owner');
    }

    const username = input.username?.trim() || null;
    const email = input.email?.trim().toLowerCase() || null;
    if (!username && !email) {
      throw new HttpError(400, 'Provide a username or email for the invite');
    }

    if (username) {
      const existingUser = await this.prisma.user.findUnique({
        where: { username },
        select: { id: true }
      });
      if (existingUser) {
        const existingMembership = await this.prisma.membership.findUnique({
          where: { orgId_userId: { orgId, userId: existingUser.id } },
          select: { id: true }
        });
        if (existingMembership) {
          throw new HttpError(400, 'User is already a member of this workspace');
        }
      }
    }

    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

    const invite = await this.prisma.invite.create({
      data: {
        orgId,
        invitedById: userId,
        username,
        email,
        role: input.role,
        token: generateToken(),
        expiresAt
      },
      include: { invitedBy: { select: { username: true } } }
    });

    return {
      id: invite.id,
      username: invite.username,
      email: invite.email,
      role: invite.role,
      token: invite.token,
      expiresAt: invite.expiresAt.toISOString(),
      invitedById: invite.invitedById,
      invitedByUsername: invite.invitedBy.username,
      createdAt: invite.createdAt.toISOString()
    };
  }
}
