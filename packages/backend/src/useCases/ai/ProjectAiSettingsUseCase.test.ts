import type { PrismaClient } from '@prisma/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ProjectAccessRepository } from '../../repositories/ProjectAccessRepository.js';
import { decryptSecret } from '../../utils/secretBox.js';
import { parseCodexCredentials } from './codexProvider.js';
import { ProjectAiSettingsUseCase } from './ProjectAiSettingsUseCase.js';

describe('ProjectAiSettingsUseCase Codex integration', () => {
  beforeEach(() => {
    vi.spyOn(ProjectAccessRepository.prototype, 'assertPermission').mockResolvedValue('OWNER');
  });

  afterEach(() => vi.unstubAllGlobals());

  it('persists authorized Codex credentials encrypted without exposing them', async () => {
    const now = new Date('2026-08-27T00:00:00.000Z');
    const upsert = vi.fn(async (args: { create: Record<string, unknown> }) => ({
      id: 'settings-1',
      projectId: 'project-1',
      enabled: true,
      providerKind: 'CODEX' as const,
      model: 'codex/gpt-5.4',
      baseUrl: null,
      apiKey: args.create.apiKey as string,
      createdAt: now,
      updatedAt: now
    }));
    const prisma = {
      projectAiSettings: { findUnique: vi.fn(async () => null), upsert }
    } as unknown as PrismaClient;
    const accessToken = jwt({ chatgpt_account_id: 'account-1' });
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce(jsonResponse({ authorization_code: 'code', code_verifier: 'verifier' }))
      .mockResolvedValueOnce(jsonResponse({ access_token: accessToken, refresh_token: 'refresh', expires_in: 3600 })));

    const result = await new ProjectAiSettingsUseCase(prisma).pollCodexAuth(
      'user-1',
      'project-1',
      'device-auth',
      'ABCD'
    );

    expect(result).toMatchObject({
      status: 'authorized',
      settings: { providerKind: 'codex', model: 'codex/gpt-5.4', hasApiKey: true }
    });
    const encrypted = vi.mocked(upsert).mock.calls[0]?.[0].create.apiKey;
    expect(String(encrypted)).not.toContain(accessToken);
    expect(parseCodexCredentials(decryptSecret(String(encrypted)))).toMatchObject({
      access: accessToken,
      refresh: 'refresh',
      accountId: 'account-1'
    });
  });

  it('canonicalizes allowed Codex models and rejects manually supplied tokens', async () => {
    const now = new Date('2026-08-27T00:00:00.000Z');
    const existing = {
      id: 'settings-1',
      projectId: 'project-1',
      enabled: true,
      providerKind: 'GATEWAY' as 'GATEWAY' | 'CODEX',
      model: 'openai/gpt-5.4',
      baseUrl: null,
      apiKey: null,
      createdAt: now,
      updatedAt: now
    };
    const upsert = vi.fn(async (args: { update: Record<string, unknown> }) => ({
      ...existing,
      ...args.update,
      updatedAt: now
    }));
    const findUnique = vi.fn(async () => existing);
    const prisma = { projectAiSettings: { findUnique, upsert } } as unknown as PrismaClient;
    const useCase = new ProjectAiSettingsUseCase(prisma);

    const saved = await useCase.update('user-1', 'project-1', {
      providerKind: 'codex',
      model: 'gpt-5.6-terra'
    });
    expect(saved.model).toBe('codex/gpt-5.6-terra');
    expect(vi.mocked(upsert).mock.calls[0]?.[0].update).toMatchObject({
      providerKind: 'CODEX',
      model: 'codex/gpt-5.6-terra',
      baseUrl: null,
      apiKey: null
    });

    findUnique.mockResolvedValue({ ...existing, providerKind: 'CODEX', model: 'codex/gpt-5.4' });
    await expect(useCase.update('user-1', 'project-1', { apiKey: 'not-allowed' }))
      .rejects.toMatchObject({ status: 400 });
  });
});

function jwt(claims: Record<string, unknown>): string {
  return `header.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.signature`;
}

function jsonResponse(value: unknown): Response {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { 'content-type': 'application/json' }
  });
}
