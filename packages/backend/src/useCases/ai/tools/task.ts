import { tool, type Tool } from 'ai';
import { z } from 'zod';
import { HttpError } from '../../../http/HttpError.js';
import type { AiAgentInfo } from '../agents.js';
import {
  normalizeTaskContract,
  taskContractSchema,
  type TaskContract
} from '../runtime/taskContract.js';
import { invocationToolCallId, type AgentToolInvocationContext } from './shared.js';

export interface TaskHandler {
  handleTask(input: TaskToolInput, toolCallId: string, abortSignal?: AbortSignal): Promise<unknown>;
}

export interface TaskToolInput {
  description: string;
  objective?: string;
  prompt?: string;
  subagent_type: string;
  task_id?: string;
  contract?: TaskContract;
}

const taskInputSchema = z.object({
  description: z.string().trim().min(1).describe('Short description of the task for UI/session title'),
  contract: taskContractSchema.optional().describe('Typed executable assignment. Required for new durable-workflow delegations.'),
  objective: z.string().trim().min(1).optional().describe('Legacy-compatible objective; normalized into a typed contract.'),
  prompt: z.string().trim().min(1).optional().describe('Deprecated legacy prompt; normalized into a typed contract.'),
  subagent_type: z.string().trim().min(1).describe('Name of the subagent to invoke'),
  task_id: z.string().trim().optional().describe('Existing subagent session id to resume')
}).refine((input) => Boolean(input.contract || input.objective || input.prompt), {
  message: 'contract or objective is required'
});

export function taskTool(subagents: AiAgentInfo[], handler: TaskHandler): Tool<any, any> {
  return tool({
    description: taskDescription(subagents),
    inputSchema: taskInputSchema,
    execute: async (input, options?: AgentToolInvocationContext) => {
      const parsed = taskInputSchema.safeParse(input);
      if (!parsed.success) throw new HttpError(400, parsed.error.issues.map((issue) => issue.message).join('; '));
      const contract = normalizeTaskContract(parsed.data);
      return handler.handleTask({ ...parsed.data, contract }, invocationToolCallId(options), options?.abortSignal);
    }
  }) as Tool<any, any>;
}

function taskDescription(subagents: AiAgentInfo[]): string {
  const available = subagents.length
    ? subagents.map((agent) => `- ${agent.name}: ${agent.description}`).join('\n')
    : '- none';
  return [
    'Launch a specialized subagent with a typed, bounded task contract, then return its observable result.',
    'For new work, provide contract with dependencies, typed inputs/outputs, acceptance criteria, budget, model/retry/quality policies, and exact mutation scope.',
    'Do not delegate vague roles such as "review everything". Give one independently verifiable objective with explicit evidence requirements.',
    'Pass task_id to resume a previous subagent session returned by this tool. task_id is an AI session ID, never a Novel Build buildRunId.',
    'Never use this tool to execute a persisted Novel Build task or produce its structured artifacts. The authorized durable worker owns that dependency graph; use the Novel Build workspace to authorize/resume it.',
    'An active buildRunId may be inherited only for bounded analysis whose outputs are not persisted build artifacts. Resolve opaque IDs with tools instead of asking the author for them.',
    '',
    'Available subagents:',
    available
  ].join('\n');
}
