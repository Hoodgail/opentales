import type { PrismaClient } from '@prisma/client';
import { z } from 'zod';
import { buildAgentTools } from '../tools/index.js';
import type { AgentTool } from '../tools/shared.js';

const genericSchema = { type: 'object', additionalProperties: true };
const REPLACED_BY_OPENCODE = new Set(['askUser', 'task']);

/** Descriptors for every OpenTales tool the embedded agent can call. */
export function toolManifest(prisma: PrismaClient, projectId: string, userId: string) {
  const unavailable = async () => {
    throw new Error('Tool manifest does not execute tools');
  };
  const tools = buildAgentTools(
    prisma,
    { projectId, userId },
    { handleApproval: unavailable },
    { handleQuestion: unavailable },
    { handleTask: unavailable },
    [],
    { role: 'orchestrator', taskContract: null, primary: true, approvalMode: 'auto' }
  ) as unknown as Record<string, AgentTool>;
  return Object.entries(tools)
    .filter(([name]) => !REPLACED_BY_OPENCODE.has(name))
    .map(([name, definition]) => ({
      name,
      description: definition.description,
      requiresApproval: false,
      inputSchema: jsonSchema(definition.inputSchema)
    }));
}

function jsonSchema(schema: unknown): Record<string, unknown> {
  try {
    return z.toJSONSchema(schema as z.ZodType, { unrepresentable: 'any' }) as Record<string, unknown>;
  } catch {
    return genericSchema;
  }
}
