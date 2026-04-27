import type { PrismaClient } from '@prisma/client';
import type { AcceptInviteResult } from '@opentales/sdk';
import { HttpError } from '../../http/HttpError.js';

export class AcceptInviteUseCase {
  constructor(private readonly prisma: PrismaClient) {}

  async execute(userId: string, token: string): Promise<AcceptInviteResult> {
    const invite = await this.prisma.invite.findUnique({
      where: { token },
      include: { org: { select: { id: true, slug: true, name: true } } }
    });

    if (!invite) {
      throw new HttpError(404, 'Invite not found or already used');
    }
    if (invite.revokedAt) {
      throw new HttpError(400, 'Invite was revoked');
    }
    if (invite.acceptedAt) {
      throw new HttpError(400, 'Invite already accepted');
    }
    if (invite.expiresAt.getTime() < Date.now()) {
      throw new HttpError(400, 'Invite expired');
    }

    if (invite.username) {
      const user = await this.prisma.user.findUnique({
        where: { id: userId },
        select: { username: true }
      });
      if (!user || user.username !== invite.username) {
        throw new HttpError(403, 'This invite was not addressed to your account');
      }
    }

    await this.prisma.$transaction(async (tx) => {
      const existing = await tx.membership.findUnique({
        where: { orgId_userId: { orgId: invite.orgId, userId } },
        select: { id: true }
      });
      if (!existing) {
        await tx.membership.create({
          data: { orgId: invite.orgId, userId, role: invite.role }
        });
      }
      await tx.invite.update({
        where: { id: invite.id },
        data: { acceptedAt: new Date(), acceptedById: userId }
      });
    });

    const firstProject = await this.prisma.project.findFirst({
      where: { orgId: invite.orgId },
      orderBy: { createdAt: 'asc' },
      select: { id: true, slug: true, title: true }
    });

    return {
      orgId: invite.org.id,
      orgSlug: invite.org.slug,
      orgName: invite.org.name,
      role: invite.role,
      projectId: firstProject?.id ?? null,
      projectSlug: firstProject?.slug ?? null,
      projectTitle: firstProject?.title ?? null
    };
  }
}
