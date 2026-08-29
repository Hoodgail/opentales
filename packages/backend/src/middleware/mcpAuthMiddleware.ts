import type { NextFunction, Request, Response } from 'express';
import type { PrismaClient, Role } from '@prisma/client';
import type { AuthInfo } from '@modelcontextprotocol/server';
import { env } from '../config/env.js';
import { prisma } from '../config/prisma.js';
import { HttpError } from '../http/HttpError.js';
import { hashMcpApiKey } from '../useCases/ai/ProjectMcpApiKeysUseCase.js';
import {
  hashOAuthSecret,
  OAUTH_ACCESS_TOKEN_PREFIX
} from '../useCases/ai/McpOAuthUseCase.js';
import { roleHas } from '../utils/permissions.js';

export type McpProjectAccess = 'read-only' | 'read-write';

export interface McpAuthContext {
  credentialId: string;
  credentialType: 'api-key' | 'oauth';
  projectId: string;
  projectTitle: string;
  orgId: string;
  userId: string;
  role: Role;
  access: McpProjectAccess;
}

declare global {
  namespace Express {
    interface Request {
      auth?: AuthInfo;
    }
  }
}

export function validateMcpOrigin(req: Request, res: Response, next: NextFunction): void {
  const header = req.header('origin');
  if (!header) {
    next();
    return;
  }

  const origin = normalizedOrigin(header);
  const allowed = env.mcpAllowedOrigins.some((candidate) => normalizedOrigin(candidate) === origin);
  if (!origin || !allowed) {
    res.status(403).json({ message: 'Origin not allowed for the MCP endpoint' });
    return;
  }
  next();
}

export async function requireMcpAuth(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const authorization = req.header('authorization');
    const secret = authorization?.startsWith('Bearer ')
      ? authorization.slice('Bearer '.length).trim()
      : '';
    if (!secret) throw new HttpError(401, 'MCP credential required');
    req.auth = await authenticateMcpCredential(prisma, secret);
    next();
  } catch (error) {
    if (!(error instanceof HttpError)) console.error('MCP authentication failed', error);
    const status = error instanceof HttpError ? error.status : 500;
    if (status === 401) {
      res.setHeader(
        'WWW-Authenticate',
        `Bearer resource_metadata="${env.mcpOAuthIssuer}/.well-known/oauth-protected-resource/mcp", scope="opentales:project:read opentales:project:write"`
      );
    }
    res.status(status).json({
      message: status === 401 ? 'Invalid, expired, or revoked MCP credential' : 'Unable to authenticate MCP request'
    });
  }
}

export const requireMcpApiKey = requireMcpAuth;

export async function authenticateMcpCredential(client: PrismaClient, secret: string): Promise<AuthInfo> {
  if (secret.startsWith(OAUTH_ACCESS_TOKEN_PREFIX)) return authenticateMcpOAuthToken(client, secret);
  return authenticateMcpApiKey(client, secret);
}

export async function authenticateMcpApiKey(
  client: PrismaClient,
  secret: string
): Promise<AuthInfo> {
  if (!/^otmcp_[A-Za-z0-9_-]{40,}$/.test(secret)) {
    throw new HttpError(401, 'Invalid MCP API key');
  }

  const key = await client.projectMcpApiKey.findUnique({
    where: { secretHash: hashMcpApiKey(secret) },
    include: {
      project: { select: { id: true, orgId: true, title: true, deletedAt: true } },
      createdBy: {
        select: {
          memberships: { select: { orgId: true, role: true } }
        }
      }
    }
  });
  const now = new Date();
  if (
    !key
    || key.revokedAt
    || key.project.deletedAt
    || (key.expiresAt && key.expiresAt.getTime() <= now.getTime())
  ) {
    throw new HttpError(401, 'Invalid MCP API key');
  }

  const membership = key.createdBy.memberships.find((candidate) => candidate.orgId === key.project.orgId);
  if (!membership) throw new HttpError(401, 'Invalid MCP API key');

  const canWrite = key.permission === 'READ_WRITE' && roleHas(membership.role, 'project:write');
  const access: McpProjectAccess = canWrite ? 'read-write' : 'read-only';
  const context: McpAuthContext = {
    credentialId: key.id,
    credentialType: 'api-key',
    projectId: key.project.id,
    projectTitle: key.project.title,
    orgId: key.project.orgId,
    userId: key.createdById,
    role: membership.role,
    access
  };

  const staleBefore = new Date(now.getTime() - 5 * 60 * 1000);
  if (!key.lastUsedAt || key.lastUsedAt < staleBefore) {
    try {
      await client.projectMcpApiKey.updateMany({
        where: {
          id: key.id,
          OR: [{ lastUsedAt: null }, { lastUsedAt: { lt: staleBefore } }]
        },
        data: { lastUsedAt: now }
      });
    } catch (error) {
      console.error('Failed to update MCP API-key usage timestamp', error);
    }
  }

  return {
    token: secret,
    clientId: key.id,
    scopes: scopesFor(membership.role, access),
    ...(key.expiresAt ? { expiresAt: Math.floor(key.expiresAt.getTime() / 1000) } : {}),
    extra: { ...context }
  };
}

export async function authenticateMcpOAuthToken(
  client: PrismaClient,
  secret: string
): Promise<AuthInfo> {
  if (!/^otoauth_[A-Za-z0-9_-]{40,}$/.test(secret)) throw new HttpError(401, 'Invalid MCP OAuth token');
  const token = await client.mcpOAuthToken.findUnique({
    where: { accessTokenHash: hashOAuthSecret(secret) },
    include: {
      project: { select: { id: true, orgId: true, title: true, deletedAt: true } },
      user: { select: { memberships: { select: { orgId: true, role: true } } } }
    }
  });
  const now = new Date();
  if (
    !token
    || token.revokedAt
    || token.project.deletedAt
    || token.resource !== env.mcpPublicUrl
    || token.accessExpiresAt.getTime() <= now.getTime()
    || !token.scopes.includes('opentales:project:read')
  ) throw new HttpError(401, 'Invalid MCP OAuth token');
  const membership = token.user.memberships.find((candidate) => candidate.orgId === token.project.orgId);
  if (!membership) throw new HttpError(401, 'Invalid MCP OAuth token');
  const canWrite = token.permission === 'READ_WRITE'
    && token.scopes.includes('opentales:project:write')
    && roleHas(membership.role, 'project:write');
  const access: McpProjectAccess = canWrite ? 'read-write' : 'read-only';
  const context: McpAuthContext = {
    credentialId: token.id,
    credentialType: 'oauth',
    projectId: token.project.id,
    projectTitle: token.project.title,
    orgId: token.project.orgId,
    userId: token.userId,
    role: membership.role,
    access
  };
  const staleBefore = new Date(now.getTime() - 5 * 60 * 1000);
  if (!token.lastUsedAt || token.lastUsedAt < staleBefore) {
    client.mcpOAuthToken.updateMany({
      where: { id: token.id, OR: [{ lastUsedAt: null }, { lastUsedAt: { lt: staleBefore } }] },
      data: { lastUsedAt: now }
    }).catch((error) => console.error('Failed to update MCP OAuth-token usage timestamp', error));
  }
  return {
    token: secret,
    clientId: token.clientId,
    scopes: scopesFor(membership.role, access),
    expiresAt: Math.floor(token.accessExpiresAt.getTime() / 1000),
    resource: new URL(token.resource),
    extra: { ...context }
  };
}

export function mcpAuthContext(authInfo: AuthInfo | undefined): McpAuthContext {
  const extra = authInfo?.extra;
  if (
    !extra
    || typeof extra.credentialId !== 'string'
    || (extra.credentialType !== 'api-key' && extra.credentialType !== 'oauth')
    || typeof extra.projectId !== 'string'
    || typeof extra.projectTitle !== 'string'
    || typeof extra.orgId !== 'string'
    || typeof extra.userId !== 'string'
    || !isRole(extra.role)
    || (extra.access !== 'read-only' && extra.access !== 'read-write')
  ) {
    throw new HttpError(401, 'Authenticated MCP context is missing');
  }
  return {
    credentialId: extra.credentialId,
    credentialType: extra.credentialType,
    projectId: extra.projectId,
    projectTitle: extra.projectTitle,
    orgId: extra.orgId,
    userId: extra.userId,
    role: extra.role,
    access: extra.access
  };
}

function scopesFor(role: Role, access: McpProjectAccess): string[] {
  const scopes = ['opentales:project:read'];
  if (access === 'read-write') scopes.push('opentales:project:write');
  if (access === 'read-write' && roleHas(role, 'project:admin')) scopes.push('opentales:project:admin');
  if (access === 'read-write' && roleHas(role, 'org:admin')) scopes.push('opentales:org:admin');
  return scopes;
}

function normalizedOrigin(value: string): string | null {
  try {
    return new URL(value).origin;
  } catch {
    return null;
  }
}

function isRole(value: unknown): value is Role {
  return value === 'OWNER' || value === 'ADMIN' || value === 'EDITOR' || value === 'VIEWER';
}
