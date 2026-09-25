import type { PrismaClient } from '@prisma/client';
import { HttpError } from '../../../http/HttpError.js';
import { decryptSecret } from '../../../utils/secretBox.js';
import { bareCodexModelId, isCodexModelAllowed } from '../codexModels.js';
import { createCodexRequestPreparer } from '../codexProvider.js';

/** OpenCode provider ID used for every project's configured model. */
export const OPENTALES_PROVIDER_ID = 'opentales';

const OPENAI_COMPATIBLE_PACKAGE = '@opencode/ai/providers/openai-compatible';
const OPENAI_RESPONSES_PACKAGE = '@opencode/ai/providers/openai-compatible-responses';
const GATEWAY_BASE_URL = process.env.AI_GATEWAY_BASE_URL ?? 'https://ai-gateway.vercel.sh/v1';

export interface ProjectProviderSettings {
  enabled: boolean;
  providerKind: 'GATEWAY' | 'OPENAI_COMPATIBLE' | 'GITHUB_COPILOT' | 'CODEX';
  model: string;
  baseUrl: string | null;
  apiKey: string | null;
}

/** The provider block written into a project's opencode.json. Contains no secrets. */
export interface OpencodeProviderConfig {
  model: string;
  provider: {
    name: string;
    package: string;
    settings: { baseURL: string; apiKey: string };
    models: Record<string, { name: string; modelID: string }>;
  };
}

/**
 * Map OpenTales project settings onto an OpenCode provider. The API key in the
 * config is always a placeholder: real credentials are attached per request by
 * {@link ProviderTransport} so secrets never reach disk.
 */
export function providerConfigFor(
  settings: ProjectProviderSettings,
  extraModels: readonly string[] = []
): OpencodeProviderConfig {
  const models = new Map<string, string>();
  const add = (model: string) => {
    const trimmed = model.trim();
    if (!trimmed) return;
    const upstream = settings.providerKind === 'CODEX' ? bareCodexModelId(trimmed) : trimmed;
    models.set(modelKey(trimmed), upstream);
  };
  add(settings.model);
  for (const model of extraModels) add(model);

  const baseURL = baseUrlFor(settings);
  return {
    model: `${OPENTALES_PROVIDER_ID}/${modelKey(settings.model)}`,
    provider: {
      name: providerLabel(settings.providerKind),
      package: settings.providerKind === 'CODEX' ? OPENAI_RESPONSES_PACKAGE : OPENAI_COMPATIBLE_PACKAGE,
      settings: { baseURL, apiKey: 'injected-by-opentales' },
      models: Object.fromEntries(
        [...models].map(([key, upstream]) => [key, { name: upstream, modelID: upstream }])
      )
    }
  };
}

/** OpenCode model IDs cannot contain `/`, so gateway-style IDs are encoded. */
export function modelKey(model: string): string {
  return model.trim().replace(/\//g, '--');
}

export function modelFromKey(key: string): string {
  return key.replace(/--/g, '/');
}

function baseUrlFor(settings: ProjectProviderSettings): string {
  switch (settings.providerKind) {
    case 'OPENAI_COMPATIBLE':
      return normalizeOpenAiBaseUrl(settings.baseUrl ?? 'https://api.openai.com/v1');
    case 'GITHUB_COPILOT':
      return (settings.baseUrl ?? 'https://api.githubcopilot.com').replace(/\/$/, '');
    case 'CODEX':
      // Requests are rewritten to the ChatGPT Codex endpoint by the transport.
      return 'https://chatgpt.com/backend-api/codex/v1';
    case 'GATEWAY':
    default:
      return GATEWAY_BASE_URL.replace(/\/$/, '');
  }
}

/**
 * OpenAI-compatible SDKs append `/chat/completions` to the base URL. Hosts
 * such as `https://strata.yasui.io` only serve under `/v1`, so a bare origin
 * gets `/v1` appended. Explicit paths are respected.
 */
export function normalizeOpenAiBaseUrl(value: string): string {
  const trimmed = value.trim().replace(/\/+$/, '');
  try {
    const url = new URL(trimmed);
    if (url.pathname === '' || url.pathname === '/') return `${url.origin}/v1`;
  } catch {
    throw new HttpError(400, 'AI base URL must be an absolute URL');
  }
  return trimmed;
}

function providerLabel(kind: ProjectProviderSettings['providerKind']): string {
  switch (kind) {
    case 'OPENAI_COMPATIBLE':
      return 'OpenAI-compatible';
    case 'GITHUB_COPILOT':
      return 'GitHub Copilot';
    case 'CODEX':
      return 'ChatGPT Codex';
    default:
      return 'Vercel AI Gateway';
  }
}

export type RequestRewriter = (request: Request) => Promise<Request>;

/**
 * Builds the credential transport for one project. The returned rewriter is
 * called from the plugin's `http.request` hook for every model request.
 */
export async function providerTransportFor(
  prisma: PrismaClient,
  projectId: string
): Promise<RequestRewriter> {
  const settings = await prisma.projectAiSettings.findUnique({ where: { projectId } });
  if (!settings?.enabled) throw new HttpError(400, 'AI is not enabled for this project');

  switch (settings.providerKind) {
    case 'OPENAI_COMPATIBLE': {
      const key = settings.apiKey ? decryptSecret(settings.apiKey) : null;
      return async (request) => withHeaders(request, (headers) => {
        headers.delete('x-api-key');
        if (key) headers.set('Authorization', `Bearer ${key}`);
        else headers.delete('Authorization');
      });
    }
    case 'GITHUB_COPILOT': {
      if (!settings.apiKey) throw new HttpError(400, 'GitHub Copilot is not connected for this project');
      const token = decryptSecret(settings.apiKey);
      return async (request) => {
        const body = await request.clone().text().catch(() => '');
        const { isAgent, isVision } = classifyCopilotBody(body);
        return withHeaders(request, (headers) => {
          headers.delete('x-api-key');
          headers.set('Authorization', `Bearer ${token}`);
          headers.set('Openai-Intent', 'conversation-edits');
          headers.set('x-initiator', isAgent ? 'agent' : 'user');
          headers.set('User-Agent', 'opentales');
          if (isVision) headers.set('Copilot-Vision-Request', 'true');
        });
      };
    }
    case 'CODEX': {
      if (!settings.apiKey) throw new HttpError(400, 'Codex is not connected for this project');
      if (!isCodexModelAllowed(settings.model)) throw new HttpError(400, 'Model is not available through Codex');
      const prepare = createCodexRequestPreparer(prisma, projectId);
      return async (request) => {
        const body = await request.clone().text();
        const prepared = await prepare(request.url, { method: request.method, headers: request.headers, body });
        return new Request(prepared.url, { ...prepared.init, signal: request.signal });
      };
    }
    case 'GATEWAY':
    default: {
      const key = process.env.AI_GATEWAY_API_KEY;
      if (!key) throw new HttpError(400, 'AI_GATEWAY_API_KEY is not configured on the server');
      return async (request) => withHeaders(request, (headers) => {
        headers.set('Authorization', `Bearer ${key}`);
      });
    }
  }
}

function withHeaders(request: Request, mutate: (headers: Headers) => void): Request {
  const headers = new Headers(request.headers);
  mutate(headers);
  return new Request(request, { headers });
}

export function classifyCopilotBody(raw: string): { isAgent: boolean; isVision: boolean } {
  try {
    const body = JSON.parse(raw) as {
      messages?: Array<{ role?: string; content?: unknown }>;
      input?: Array<{ role?: string; content?: unknown }>;
    };
    const items = body.messages ?? body.input ?? [];
    const last = items[items.length - 1];
    const hasImage = (content: unknown) =>
      Array.isArray(content) &&
      content.some((part: { type?: string }) => part?.type === 'image_url' || part?.type === 'input_image' || part?.type === 'image');
    return {
      isVision: items.some((item) => hasImage(item.content)),
      isAgent: last?.role !== 'user' || hasImage(last?.content)
    };
  } catch {
    return { isAgent: false, isVision: false };
  }
}
