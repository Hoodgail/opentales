import type { PrismaClient } from '@prisma/client';
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import { generateText } from 'ai';
import { HttpError } from '../../http/HttpError.js';
import { decryptSecret } from '../../utils/secretBox.js';

export type AiModel = Parameters<typeof generateText>[0]['model'];

export async function loadAiModelForProject(
  prisma: PrismaClient,
  projectId: string,
  modelOverride?: string | null
): Promise<AiModel> {
  const settings = await prisma.projectAiSettings.findUnique({ where: { projectId } });
  if (!settings?.enabled) throw new HttpError(400, 'AI is not enabled for this project');
  const model = modelOverride?.trim() || settings.model;
  if (settings.providerKind === 'OPENAI_COMPATIBLE') {
    const provider = createOpenAICompatible({
      name: 'opentales-custom',
      baseURL: settings.baseUrl ?? 'https://api.openai.com/v1',
      apiKey: settings.apiKey ? decryptSecret(settings.apiKey) : undefined
    });
    return provider(model);
  }
  if (settings.providerKind === 'GITHUB_COPILOT') {
    if (!settings.apiKey) throw new HttpError(400, 'GitHub Copilot is not connected for this project');
    const token = decryptSecret(settings.apiKey);
    const provider = createOpenAICompatible({
      name: 'github-copilot',
      baseURL: settings.baseUrl ?? 'https://api.githubcopilot.com',
      apiKey: token,
      fetch: copilotFetch(token)
    } as Parameters<typeof createOpenAICompatible>[0] & { fetch: typeof fetch });
    return provider(model);
  }
  return model;
}

function copilotFetch(token: string): typeof fetch {
  return async (input, init) => {
    const headers = new Headers(init?.headers);
    const { isAgent, isVision } = classifyCopilotRequest(input, init);

    headers.set('Openai-Intent', 'conversation-edits');
    headers.set('x-initiator', isAgent ? 'agent' : 'user');
    headers.set('User-Agent', 'opentales');
    if (isVision) headers.set('Copilot-Vision-Request', 'true');
    headers.delete('x-api-key');
    headers.delete('authorization');
    headers.set('Authorization', `Bearer ${token}`);

    return fetch(input, { ...init, headers });
  };
}

function classifyCopilotRequest(
  input: Parameters<typeof fetch>[0],
  init: Parameters<typeof fetch>[1]
): { isAgent: boolean; isVision: boolean } {
  try {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    const body = typeof init?.body === 'string' ? JSON.parse(init.body) : init?.body;
    if (body?.messages && url.includes('completions')) {
      const last = body.messages[body.messages.length - 1];
      return {
        isVision: body.messages.some((msg: { content?: unknown }) => hasContentPart(msg.content, 'image_url')),
        isAgent: last?.role !== 'user' || hasImageMessage(last)
      };
    }
    if (body?.input) {
      const last = body.input[body.input.length - 1];
      return {
        isVision: body.input.some((item: { content?: unknown }) => hasContentPart(item.content, 'input_image')),
        isAgent: last?.role !== 'user' || hasImageMessage(last)
      };
    }
    if (body?.messages) {
      const last = body.messages[body.messages.length - 1];
      const hasNonToolCalls =
        Array.isArray(last?.content) && last.content.some((part: { type?: string }) => part?.type !== 'tool_result');
      return {
        isVision: body.messages.some((item: { content?: unknown }) => hasNestedImageContent(item.content)),
        isAgent: !(last?.role === 'user' && hasNonToolCalls) || hasImageMessage(last)
      };
    }
  } catch {
    // Fall through to safe defaults.
  }
  return { isAgent: false, isVision: false };
}

function hasImageMessage(message: { content?: unknown } | undefined): boolean {
  return hasContentPart(message?.content, 'image_url') || hasContentPart(message?.content, 'input_image') || hasNestedImageContent(message?.content);
}

function hasContentPart(content: unknown, type: string): boolean {
  return Array.isArray(content) && content.some((part: { type?: string }) => part?.type === type);
}

function hasNestedImageContent(content: unknown): boolean {
  return Array.isArray(content) && content.some((part: { type?: string; content?: unknown }) => {
    if (part?.type === 'image') return true;
    return part?.type === 'tool_result' && hasContentPart(part.content, 'image');
  });
}
