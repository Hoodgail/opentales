import type { AiProviderKind, PrismaClient } from '@prisma/client';
import type {
  PollGithubCopilotAuthResult,
  ProjectAiSettings,
  StartGithubCopilotAuthResult,
  UpdateProjectAiSettingsInput
} from '@opentales/sdk';
import { HttpError } from '../../http/HttpError.js';
import { ProjectAccessRepository } from '../../repositories/ProjectAccessRepository.js';
import { withTimeout } from '../../utils/promiseTimeout.js';
import { encryptSecret } from '../../utils/secretBox.js';
import { defaultProjectAiSettings, toProjectAiSettings } from './aiMapper.js';

const GITHUB_COPILOT_CLIENT_ID = 'Ov23li8tweQw6odWQebz';
const GITHUB_DEVICE_CODE_URL = 'https://github.com/login/device/code';
const GITHUB_ACCESS_TOKEN_URL = 'https://github.com/login/oauth/access_token';
const PROVIDER_KIND: Record<string, AiProviderKind> = {
  gateway: 'GATEWAY',
  'openai-compatible': 'OPENAI_COMPATIBLE',
  'github-copilot': 'GITHUB_COPILOT'
};
const AI_SETTINGS_DB_TIMEOUT_MS = 10_000;

export class ProjectAiSettingsUseCase {
  private readonly access: ProjectAccessRepository;

  constructor(private readonly prisma: PrismaClient) {
    this.access = new ProjectAccessRepository(prisma);
  }

  async get(userId: string, projectId: string): Promise<ProjectAiSettings> {
    await withTimeout(
      this.access.assertProjectAccess(userId, projectId),
      AI_SETTINGS_DB_TIMEOUT_MS,
      'Timed out while checking project access'
    );
    const settings = await withTimeout(
      this.prisma.projectAiSettings.findUnique({ where: { projectId } }),
      AI_SETTINGS_DB_TIMEOUT_MS,
      'Timed out while loading AI settings'
    );
    return settings ? toProjectAiSettings(settings) : defaultProjectAiSettings(projectId);
  }

  async update(
    userId: string,
    projectId: string,
    input: UpdateProjectAiSettingsInput
  ): Promise<ProjectAiSettings> {
    await withTimeout(
      this.access.assertPermission(userId, projectId, 'project:admin'),
      AI_SETTINGS_DB_TIMEOUT_MS,
      'Timed out while checking project permissions'
    );

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

    const existing = await withTimeout(
      this.prisma.projectAiSettings.findUnique({ where: { projectId } }),
      AI_SETTINGS_DB_TIMEOUT_MS,
      'Timed out while loading AI settings'
    );
    if (data.providerKind && existing?.providerKind && existing.providerKind !== data.providerKind && input.apiKey === undefined) {
      data.apiKey = null;
    }
    const settings = await withTimeout(
      this.prisma.projectAiSettings.upsert({
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
      }),
      AI_SETTINGS_DB_TIMEOUT_MS,
      'Timed out while saving AI settings'
    );

    return toProjectAiSettings(settings);
  }

  async startGithubCopilotAuth(
    userId: string,
    projectId: string
  ): Promise<StartGithubCopilotAuthResult> {
    await withTimeout(
      this.access.assertPermission(userId, projectId, 'project:admin'),
      AI_SETTINGS_DB_TIMEOUT_MS,
      'Timed out while checking project permissions'
    );

    const response = await fetch(GITHUB_DEVICE_CODE_URL, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        'User-Agent': 'opentales'
      },
      body: JSON.stringify({
        client_id: GITHUB_COPILOT_CLIENT_ID,
        scope: 'read:user'
      })
    });
    if (!response.ok) throw new HttpError(502, 'Failed to start GitHub Copilot authentication');

    const data = (await response.json()) as {
      device_code?: string;
      user_code?: string;
      verification_uri?: string;
      expires_in?: number;
      interval?: number;
      error_description?: string;
    };
    if (!data.device_code || !data.user_code || !data.verification_uri) {
      throw new HttpError(502, data.error_description ?? 'Invalid GitHub device flow response');
    }

    return {
      deviceCode: data.device_code,
      userCode: data.user_code,
      verificationUri: data.verification_uri,
      expiresIn: data.expires_in ?? 900,
      interval: data.interval ?? 5
    };
  }

  async pollGithubCopilotAuth(
    userId: string,
    projectId: string,
    deviceCode: string
  ): Promise<PollGithubCopilotAuthResult> {
    await withTimeout(
      this.access.assertPermission(userId, projectId, 'project:admin'),
      AI_SETTINGS_DB_TIMEOUT_MS,
      'Timed out while checking project permissions'
    );

    const normalizedDeviceCode = deviceCode.trim();
    if (!normalizedDeviceCode) throw new HttpError(400, 'deviceCode is required');

    const response = await fetch(GITHUB_ACCESS_TOKEN_URL, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        'User-Agent': 'opentales'
      },
      body: JSON.stringify({
        client_id: GITHUB_COPILOT_CLIENT_ID,
        device_code: normalizedDeviceCode,
        grant_type: 'urn:ietf:params:oauth:grant-type:device_code'
      })
    });
    if (!response.ok) throw new HttpError(502, 'Failed to poll GitHub Copilot authentication');

    const data = (await response.json()) as {
      access_token?: string;
      error?: string;
      error_description?: string;
      interval?: number;
    };

    if (data.access_token) {
      const settings = await this.update(userId, projectId, {
        providerKind: 'github-copilot',
        model: 'gpt-5',
        baseUrl: null,
        apiKey: data.access_token
      });
      return { status: 'authorized', settings };
    }

    if (data.error === 'authorization_pending') return { status: 'pending' };
    if (data.error === 'slow_down') return { status: 'slow_down', interval: data.interval ?? 10 };
    return { status: 'failed', message: data.error_description ?? data.error ?? 'GitHub authorization failed' };
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
