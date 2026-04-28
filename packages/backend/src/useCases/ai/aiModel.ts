import type { PrismaClient } from '@prisma/client';
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import { generateText } from 'ai';
import { HttpError } from '../../http/HttpError.js';
import { decryptSecret } from '../../utils/secretBox.js';

export type AiModel = Parameters<typeof generateText>[0]['model'];

export async function loadAiModelForProject(
  prisma: PrismaClient,
  projectId: string
): Promise<AiModel> {
  const settings = await prisma.projectAiSettings.findUnique({ where: { projectId } });
  if (!settings?.enabled) throw new HttpError(400, 'AI is not enabled for this project');
  if (settings.providerKind === 'OPENAI_COMPATIBLE') {
    const provider = createOpenAICompatible({
      name: 'opentales-custom',
      baseURL: settings.baseUrl ?? 'https://api.openai.com/v1',
      apiKey: settings.apiKey ? decryptSecret(settings.apiKey) : undefined
    });
    return provider(settings.model);
  }
  return settings.model;
}
