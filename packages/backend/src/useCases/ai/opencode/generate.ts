import type { PrismaClient } from '@prisma/client';
import { z } from 'zod';
import { HttpError } from '../../../http/HttpError.js';
import { opencodeRuntime } from './host.js';

/**
 * One-shot structured generation through the project's embedded OpenCode
 * instance. Uses an ephemeral, tool-less session so the same provider,
 * credential injection, and model settings apply as for agent sessions.
 */
export async function generateStructured<Schema extends z.ZodType>(
  prisma: PrismaClient,
  projectId: string,
  input: { system: string; prompt: string; schema: Schema }
): Promise<z.infer<Schema>> {
  const runtime = opencodeRuntime(prisma);
  const workspace = await runtime.ensureProject(projectId);
  const host = await runtime.host();
  const session = await host.sessions.create({
    location: { directory: workspace.directory },
    title: 'OpenTales assist',
    metadata: { opentalesAssist: true },
    permissions: [{ action: '*', resource: '*', effect: 'deny' }]
  });
  try {
    const jsonSchema = JSON.stringify(z.toJSONSchema(input.schema, { unrepresentable: 'any' }));
    const prompt = [
      input.system,
      '',
      input.prompt,
      '',
      'Respond with a single JSON object that validates against this JSON Schema. Output only the JSON, with no prose or code fences.',
      jsonSchema
    ].join('\n');
    let lastError = 'Model returned invalid JSON';
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const result = await host.sessions.generate({
        sessionID: session.id,
        prompt: attempt === 0 ? prompt : `${prompt}\n\nYour previous answer was invalid (${lastError}). Return only valid JSON.`
      });
      const parsed = input.schema.safeParse(extractJson(result.text));
      if (parsed.success) return parsed.data;
      lastError = parsed.error.issues.map((issue) => issue.message).join('; ').slice(0, 300);
    }
    throw new HttpError(502, `The model did not return a valid response: ${lastError}`);
  } finally {
    await host.sessions.remove({ sessionID: session.id }).catch(() => undefined);
  }
}

function extractJson(text: string): unknown {
  const trimmed = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/```$/, '').trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    const start = trimmed.indexOf('{');
    const end = trimmed.lastIndexOf('}');
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(trimmed.slice(start, end + 1));
      } catch {
        return null;
      }
    }
    return null;
  }
}
