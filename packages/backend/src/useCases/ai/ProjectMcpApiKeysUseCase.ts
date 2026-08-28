import { createHash, randomBytes } from 'node:crypto';
import type { PrismaClient, ProjectMcpApiKey as PrismaProjectMcpApiKey } from '@prisma/client';
import type {
  CreateProjectMcpApiKeyInput,
  CreateProjectMcpApiKeyResult,
  ProjectMcpApiKey
} from '@opentales/sdk';
import { HttpError } from '../../http/HttpError.js';
import { ProjectAccessRepository } from '../../repositories/ProjectAccessRepository.js';

const MAX_ACTIVE_KEYS = 25;
const MAX_NAME_LENGTH = 80;
const KEY_PREFIX = 'otmcp_';

export class ProjectMcpApiKeysUseCase {
  private readonly access: ProjectAccessRepository;

  constructor(private readonly prisma: PrismaClient) {
    this.access = new ProjectAccessRepository(prisma);
  }

  async list(userId: string, projectId: string): Promise<ProjectMcpApiKey[]> {
    await this.access.assertPermission(userId, projectId, 'project:admin');
    const keys = await this.prisma.projectMcpApiKey.findMany({
      where: { projectId },
      orderBy: { createdAt: 'desc' },
      take: 100
    });
    return keys.map(toProjectMcpApiKey);
  }

  async create(
    userId: string,
    projectId: string,
    input: CreateProjectMcpApiKeyInput
  ): Promise<CreateProjectMcpApiKeyResult> {
    await this.access.assertPermission(userId, projectId, 'project:admin');
    const rawInput = input && typeof input === 'object'
      ? input as unknown as Record<string, unknown>
      : {};
    const now = new Date();
    const activeCount = await this.prisma.projectMcpApiKey.count({
      where: {
        projectId,
        revokedAt: null,
        OR: [{ expiresAt: null }, { expiresAt: { gt: now } }]
      }
    });
    if (activeCount >= MAX_ACTIVE_KEYS) {
      throw new HttpError(400, `Projects can have at most ${MAX_ACTIVE_KEYS} active MCP API keys`);
    }

    const name = validateName(rawInput.name);
    const permission = toPrismaPermission(rawInput.permission ?? 'read-write');
    const expiresAt = parseExpiry(rawInput.expiresAt, now);
    const secret = `${KEY_PREFIX}${randomBytes(32).toString('base64url')}`;
    const key = await this.prisma.projectMcpApiKey.create({
      data: {
        projectId,
        createdById: userId,
        name,
        permission,
        secretHash: hashMcpApiKey(secret),
        prefix: secret.slice(0, KEY_PREFIX.length + 8),
        expiresAt
      }
    });

    return { key: toProjectMcpApiKey(key), secret };
  }

  async revoke(userId: string, projectId: string, keyId: string): Promise<ProjectMcpApiKey> {
    await this.access.assertPermission(userId, projectId, 'project:admin');
    const key = await this.prisma.projectMcpApiKey.findFirst({
      where: { id: keyId, projectId }
    });
    if (!key) throw new HttpError(404, 'MCP API key not found');
    if (key.revokedAt) return toProjectMcpApiKey(key);

    return toProjectMcpApiKey(await this.prisma.projectMcpApiKey.update({
      where: { id: key.id },
      data: { revokedAt: new Date() }
    }));
  }
}

export function hashMcpApiKey(secret: string): string {
  return createHash('sha256').update(secret, 'utf8').digest('hex');
}

export function toProjectMcpApiKey(key: PrismaProjectMcpApiKey): ProjectMcpApiKey {
  return {
    id: key.id,
    projectId: key.projectId,
    name: key.name,
    permission: key.permission === 'READ_ONLY' ? 'read-only' : 'read-write',
    prefix: key.prefix,
    expiresAt: key.expiresAt?.toISOString() ?? null,
    lastUsedAt: key.lastUsedAt?.toISOString() ?? null,
    revokedAt: key.revokedAt?.toISOString() ?? null,
    createdAt: key.createdAt.toISOString()
  };
}

function validateName(value: unknown): string {
  const name = typeof value === 'string' ? value.trim() : '';
  if (!name) throw new HttpError(400, 'API key name is required');
  if (name.length > MAX_NAME_LENGTH) {
    throw new HttpError(400, `API key name must be ${MAX_NAME_LENGTH} characters or fewer`);
  }
  return name;
}

function toPrismaPermission(value: unknown): 'READ_ONLY' | 'READ_WRITE' {
  if (value === 'read-only') return 'READ_ONLY';
  if (value === 'read-write') return 'READ_WRITE';
  throw new HttpError(400, 'permission must be read-only or read-write');
}

function parseExpiry(value: unknown, now: Date): Date | null {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string') {
    throw new HttpError(400, 'expiresAt must be a valid ISO date string or null');
  }
  const expiresAt = new Date(value);
  if (Number.isNaN(expiresAt.getTime())) {
    throw new HttpError(400, 'expiresAt must be a valid ISO date string or null');
  }
  if (expiresAt.getTime() <= now.getTime()) {
    throw new HttpError(400, 'expiresAt must be in the future');
  }
  return expiresAt;
}
