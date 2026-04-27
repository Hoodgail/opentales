import type { Role } from '@prisma/client';
import { HttpError } from '../http/HttpError.js';

export type Permission = 'project:read' | 'project:write' | 'project:admin' | 'org:admin';

const ROLE_PERMISSIONS: Record<Role, ReadonlySet<Permission>> = {
  OWNER: new Set(['project:read', 'project:write', 'project:admin', 'org:admin']),
  ADMIN: new Set(['project:read', 'project:write', 'project:admin', 'org:admin']),
  EDITOR: new Set(['project:read', 'project:write']),
  VIEWER: new Set(['project:read'])
};

export function roleHas(role: Role, permission: Permission): boolean {
  return ROLE_PERMISSIONS[role].has(permission);
}

export function assertRoleHas(role: Role, permission: Permission): void {
  if (!roleHas(role, permission)) {
    throw new HttpError(403, `Role ${role} lacks permission '${permission}'`);
  }
}

const ROLE_RANK: Record<Role, number> = {
  VIEWER: 1,
  EDITOR: 2,
  ADMIN: 3,
  OWNER: 4
};

export function rankRole(role: Role): number {
  return ROLE_RANK[role];
}
