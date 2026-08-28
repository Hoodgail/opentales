import type { PrismaClient, ProjectMcpApiKey as PrismaProjectMcpApiKey } from '@prisma/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ProjectAccessRepository } from '../../repositories/ProjectAccessRepository.js';
import {
  hashMcpApiKey,
  ProjectMcpApiKeysUseCase
} from './ProjectMcpApiKeysUseCase.js';

const now = new Date('2026-08-27T12:00:00.000Z');

describe('ProjectMcpApiKeysUseCase', () => {
  beforeEach(() => {
    vi.spyOn(ProjectAccessRepository.prototype, 'assertPermission').mockResolvedValue('OWNER');
    vi.useFakeTimers();
    vi.setSystemTime(now);
  });

  afterEach(() => vi.useRealTimers());

  it('returns a bearer secret once and persists only its hash', async () => {
    const create = vi.fn(async ({ data }: { data: Record<string, unknown> }) => row({
      name: String(data.name),
      permission: data.permission as 'READ_ONLY' | 'READ_WRITE',
      secretHash: String(data.secretHash),
      prefix: String(data.prefix),
      expiresAt: data.expiresAt as Date | null
    }));
    const prisma = {
      projectMcpApiKey: { count: vi.fn(async () => 0), create }
    } as unknown as PrismaClient;

    const result = await new ProjectMcpApiKeysUseCase(prisma).create('user-1', 'project-1', {
      name: 'Claude drafting',
      permission: 'read-write',
      expiresAt: '2026-11-25T12:00:00.000Z'
    });

    expect(result.secret).toMatch(/^otmcp_[A-Za-z0-9_-]{40,}$/);
    expect(result.key).toMatchObject({
      name: 'Claude drafting',
      permission: 'read-write',
      prefix: result.secret.slice(0, 14)
    });
    const persisted = create.mock.calls[0]![0].data;
    expect(persisted.secretHash).toBe(hashMcpApiKey(result.secret));
    expect(JSON.stringify(persisted)).not.toContain(result.secret);
  });

  it('lists metadata without exposing hashes and revokes keys idempotently', async () => {
    const active = row();
    const revoked = row({ revokedAt: now });
    const update = vi.fn(async () => revoked);
    const findFirst = vi.fn(async () => active);
    const prisma = {
      projectMcpApiKey: {
        findMany: vi.fn(async () => [active]),
        findFirst,
        update
      }
    } as unknown as PrismaClient;
    const useCase = new ProjectMcpApiKeysUseCase(prisma);

    const listed = await useCase.list('user-1', 'project-1');
    expect(listed[0]).not.toHaveProperty('secretHash');
    expect(listed[0]).not.toHaveProperty('secret');

    const result = await useCase.revoke('user-1', 'project-1', active.id);
    expect(result.revokedAt).toBe(now.toISOString());
    expect(update).toHaveBeenCalledTimes(1);

    findFirst.mockResolvedValue(revoked);
    await useCase.revoke('user-1', 'project-1', active.id);
    expect(update).toHaveBeenCalledTimes(1);
  });

  it('rejects expired input and enforces the active-key limit', async () => {
    const prisma = {
      projectMcpApiKey: { count: vi.fn(async () => 25), create: vi.fn() }
    } as unknown as PrismaClient;
    const useCase = new ProjectMcpApiKeysUseCase(prisma);
    await expect(useCase.create('user-1', 'project-1', {
      name: 'One too many',
      expiresAt: '2026-08-28T00:00:00.000Z'
    })).rejects.toMatchObject({ status: 400 });

    vi.mocked(prisma.projectMcpApiKey.count).mockResolvedValue(0);
    await expect(useCase.create('user-1', 'project-1', {
      name: 'Already expired',
      expiresAt: '2026-08-26T00:00:00.000Z'
    })).rejects.toMatchObject({ status: 400 });
  });
});

function row(overrides: Partial<PrismaProjectMcpApiKey> = {}): PrismaProjectMcpApiKey {
  return {
    id: 'key-1',
    projectId: 'project-1',
    createdById: 'user-1',
    name: 'External agent',
    permission: 'READ_WRITE',
    secretHash: 'hash-only',
    prefix: 'otmcp_abcd1234',
    expiresAt: null,
    lastUsedAt: null,
    revokedAt: null,
    createdAt: now,
    updatedAt: now,
    ...overrides
  };
}
