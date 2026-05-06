import type { ProjectAiSettings } from '@opentales/sdk';

export function toProjectAiSettings(settings: {
  projectId: string;
  enabled: boolean;
  providerKind: 'GATEWAY' | 'OPENAI_COMPATIBLE' | 'GITHUB_COPILOT';
  model: string;
  baseUrl: string | null;
  apiKey: string | null;
  updatedAt: Date;
}): ProjectAiSettings {
  return {
    projectId: settings.projectId,
    enabled: settings.enabled,
    providerKind:
      settings.providerKind === 'OPENAI_COMPATIBLE'
        ? 'openai-compatible'
        : settings.providerKind === 'GITHUB_COPILOT'
          ? 'github-copilot'
          : 'gateway',
    model: settings.model,
    baseUrl: settings.baseUrl,
    hasApiKey: Boolean(settings.apiKey),
    updatedAt: settings.updatedAt.toISOString()
  };
}

export function defaultProjectAiSettings(projectId: string): ProjectAiSettings {
  return {
    projectId,
    enabled: false,
    providerKind: 'gateway',
    model: 'openai/gpt-5.4',
    baseUrl: null,
    hasApiKey: false,
    updatedAt: null
  };
}
