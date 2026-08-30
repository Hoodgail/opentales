import type { PrismaClient } from '@prisma/client';
import type { NextFunction, Request, Response } from 'express';
import { describe, expect, it, vi } from 'vitest';
import {
  authenticateMcpApiKey,
  mcpProtectedResourceMetadataUrl,
  validateMcpOrigin
} from './mcpAuthMiddleware.js';
import { hashMcpApiKey } from '../useCases/ai/ProjectMcpApiKeysUseCase.js';

const secret = `otmcp_${'a'.repeat(43)}`;

describe('MCP API-key authentication', () => {
  it('derives protected-resource discovery from the canonical MCP resource URL', () => {
    expect(mcpProtectedResourceMetadataUrl()).toBe(
      'http://localhost:5173/.well-known/oauth-protected-resource/mcp'
    );
  });

  it('binds the key to its project and creator membership', async () => {
    const findUnique = vi.fn(async () => authenticatedRow());
    const updateMany = vi.fn(async () => ({ count: 1 }));
    const prisma = {
      projectMcpApiKey: { findUnique, updateMany }
    } as unknown as PrismaClient;

    const auth = await authenticateMcpApiKey(prisma, secret);

    expect(findUnique).toHaveBeenCalledWith(expect.objectContaining({
      where: { secretHash: hashMcpApiKey(secret) }
    }));
    expect(auth.scopes).toEqual(expect.arrayContaining([
      'opentales:project:read',
      'opentales:project:write',
      'opentales:project:admin'
    ]));
    expect(auth.extra).toMatchObject({
      projectId: 'project-1',
      userId: 'user-1',
      role: 'ADMIN',
      access: 'read-write'
    });
    expect(updateMany).toHaveBeenCalledTimes(1);
  });

  it('downgrades a read-only key even when its creator is an admin', async () => {
    const prisma = {
      projectMcpApiKey: {
        findUnique: vi.fn(async () => authenticatedRow({ permission: 'READ_ONLY' })),
        updateMany: vi.fn(async () => ({ count: 1 }))
      }
    } as unknown as PrismaClient;

    const auth = await authenticateMcpApiKey(prisma, secret);
    expect(auth.scopes).toEqual(['opentales:project:read']);
    expect(auth.extra).toMatchObject({ access: 'read-only' });
  });

  it('rejects a key when the creator no longer belongs to the workspace', async () => {
    const value = authenticatedRow();
    value.createdBy.memberships = [];
    const prisma = {
      projectMcpApiKey: { findUnique: vi.fn(async () => value), updateMany: vi.fn() }
    } as unknown as PrismaClient;

    await expect(authenticateMcpApiKey(prisma, secret)).rejects.toMatchObject({ status: 401 });
  });

  it('rejects browser origins outside the configured frontend allowlist', () => {
    const request = { header: vi.fn(() => 'https://attacker.example') } as unknown as Request;
    const response = {} as Response;
    response.status = vi.fn(() => response) as Response['status'];
    response.json = vi.fn(() => response) as Response['json'];
    const next = vi.fn() as NextFunction;

    validateMcpOrigin(request, response, next);

    expect(response.status).toHaveBeenCalledWith(403);
    expect(next).not.toHaveBeenCalled();
  });

  it.each([
    'https://claude.ai',
    'https://chatgpt.com',
    'https://gemini.google.com'
  ])('allows the hosted MCP client origin %s', (origin) => {
    const request = { header: vi.fn(() => origin) } as unknown as Request;
    const response = {} as Response;
    const next = vi.fn() as NextFunction;

    validateMcpOrigin(request, response, next);

    expect(next).toHaveBeenCalledTimes(1);
  });
});

function authenticatedRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'key-1',
    projectId: 'project-1',
    createdById: 'user-1',
    permission: 'READ_WRITE' as const,
    expiresAt: null,
    lastUsedAt: null,
    revokedAt: null,
    project: {
      id: 'project-1',
      orgId: 'org-1',
      title: 'The Lantern Book',
      deletedAt: null
    },
    createdBy: {
      memberships: [{ orgId: 'org-1', role: 'ADMIN' as const }]
    },
    ...overrides
  };
}
