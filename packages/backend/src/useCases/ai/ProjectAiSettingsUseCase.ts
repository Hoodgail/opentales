import type { AiProviderKind, PrismaClient } from '@prisma/client';
import type { ProjectAiSettings, UpdateProjectAiSettingsInput } from '@opentales/sdk';
import { HttpError } from '../../http/HttpError.js';
import { ProjectAccessRepository } from '../../repositories/ProjectAccessRepository.js';
import { encryptSecret } from '../../utils/secretBox.js';
import { defaultProjectAiSettings, toProjectAiSettings } from './aiMapper.js';

const PROVIDER_KIND: Record<string, AiProviderKind> = {
  gateway: 'GATEWAY',
  'openai-compatible': 'OPENAI_COMPATIBLE'
};

export class ProjectAiSettingsUseCase {
  private readonly access: ProjectAccessRepository;

  constructor(private readonly prisma: PrismaClient) {
    this.access = new ProjectAccessRepository(prisma);
  }

  async get(userId: string, projectId: string): Promise<ProjectAiSettings> {
    await this.access.assertProjectAccess(userId, projectId);
    const settings = await this.prisma.projectAiSettings.findUnique({ where: { projectId } });
    return settings ? toProjectAiSettings(settings) : defaultProjectAiSettings(projectId);
  }

  async update(
    userId: string,
    projectId: string,
    input: UpdateProjectAiSettingsInput
  ): Promise<ProjectAiSettings> {
    await this.access.assertPermission(userId, projectId, 'project:admin');

    const data: {
      enabled?: boolean;
      providerKind?: AiProviderKind;
      model?: string;
      baseUrl?: string | null;
      apiKey?: string | null;
    } = {};

    if (input.enabled !== undefined) data.enabled = Boolean(input.enabled);

    if (input.providerKind !== undefined) {
      const providerKind = PROVIDER_KIND[input.providerKind];
      if (!providerKind) throw new HttpError(400, 'Unsupported AI provider kind');
      data.providerKind = providerKind;
    }

    if (input.model !== undefined) {
      const model = input.model.trim();
      if (!model) throw new HttpError(400, 'AI model is required');
      data.model = model;
    }

    if (input.baseUrl !== undefined) {
      data.baseUrl =
        input.baseUrl === null || input.baseUrl.trim() === ''
          ? null
          : normalizeBaseUrl(input.baseUrl);
    }

    if (input.apiKey !== undefined) {
      data.apiKey = input.apiKey === null ? null : encryptSecret(normalizeApiKey(input.apiKey));
    }

    const existing = await this.prisma.projectAiSettings.findUnique({ where: { projectId } });
    const settings = await this.prisma.projectAiSettings.upsert({
      where: { projectId },
      create: {
        projectId,
        enabled: data.enabled ?? false,
        providerKind: data.providerKind ?? existing?.providerKind ?? 'GATEWAY',
        model: data.model ?? 'openai/gpt-5.4',
        baseUrl: data.baseUrl ?? existing?.baseUrl ?? null,
        apiKey: data.apiKey
      },
      update: data
    });

    return toProjectAiSettings(settings);
  }
}

function normalizeBaseUrl(value: string): string {
  const trimmed = value.trim().replace(/\/$/, '');
  if (!trimmed) throw new HttpError(400, 'AI provider baseUrl cannot be empty');
  try {
    const url = new URL(trimmed);
    if (url.protocol !== 'https:' && url.protocol !== 'http:') {
      throw new Error('Unsupported protocol');
    }
  } catch {
    throw new HttpError(400, 'AI provider baseUrl must be an HTTP(S) URL');
  }
  return trimmed;
}

function normalizeApiKey(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) throw new HttpError(400, 'AI provider apiKey cannot be empty');
  return trimmed;
}
