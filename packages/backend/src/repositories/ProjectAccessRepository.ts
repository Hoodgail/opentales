import type { PrismaClient, Role } from '@prisma/client';
import { HttpError } from '../http/HttpError.js';
import { assertRoleHas, type Permission } from '../utils/permissions.js';

export class ProjectAccessRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async getAccessibleOrgIds(userId: string): Promise<string[]> {
    const memberships = await this.prisma.membership.findMany({
      where: { userId },
      select: { orgId: true }
    });
    return memberships.map((membership) => membership.orgId);
  }

  async assertProjectAccess(userId: string, projectId: string): Promise<void> {
    await this.getProjectRole(userId, projectId);
  }

  async getProjectRole(userId: string, projectId: string): Promise<Role> {
    const membership = await this.prisma.membership.findFirst({
      where: {
        userId,
        org: { projects: { some: { id: projectId } } }
      },
      select: { role: true }
    });

    if (!membership) {
      throw new HttpError(404, 'Project not found');
    }

    return membership.role;
  }

  async assertPermission(
    userId: string,
    projectId: string,
    permission: Permission
  ): Promise<Role> {
    const role = await this.getProjectRole(userId, projectId);
    assertRoleHas(role, permission);
    return role;
  }

  async getProjectOrgId(projectId: string): Promise<string> {
    const project = await this.prisma.project.findUnique({
      where: { id: projectId },
      select: { orgId: true }
    });
    if (!project) {
      throw new HttpError(404, 'Project not found');
    }
    return project.orgId;
  }

  async getDefaultOrgId(userId: string): Promise<string> {
    const membership = await this.prisma.membership.findFirst({
      where: { userId },
      orderBy: [{ role: 'asc' }, { createdAt: 'asc' }],
      select: { orgId: true }
    });

    if (!membership) {
      throw new HttpError(400, 'User has no workspace');
    }

    return membership.orgId;
  }
}
