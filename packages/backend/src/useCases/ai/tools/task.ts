import { tool, type Tool } from 'ai';
import { z } from 'zod';
import { HttpError } from '../../../http/HttpError.js';
import type { AiAgentInfo } from '../agents.js';

export interface TaskHandler {
  handleTask(input: TaskToolInput): Promise<unknown>;
}

export interface TaskToolInput {
  description: string;
  prompt: string;
  subagent_type: string;
  task_id?: string;
}

const taskInputSchema = z.object({
  description: z.string().trim().min(1).describe('Short description of the task for UI/session title'),
  prompt: z.string().trim().min(1).describe('Detailed prompt for the subagent to execute'),
  subagent_type: z.string().trim().min(1).describe('Name of the subagent to invoke'),
  task_id: z.string().trim().optional().describe('Existing subagent session id to resume')
});

export function taskTool(subagents: AiAgentInfo[], handler: TaskHandler): Tool<any, any> {
  return tool({
    description: taskDescription(subagents),
    inputSchema: taskInputSchema,
    execute: async (input) => {
      const parsed = taskInputSchema.safeParse(input);
      if (!parsed.success) throw new HttpError(400, parsed.error.issues.map((issue) => issue.message).join('; '));
      return handler.handleTask(parsed.data);
    }
  }) as Tool<any, any>;
}

function taskDescription(subagents: AiAgentInfo[]): string {
  const available = subagents.length
    ? subagents.map((agent) => `- ${agent.name}: ${agent.description}`).join('\n')
    : '- none';
  return [
    'Launch a specialized subagent in a child session to handle complex or focused work, then return its final result.',
    'Use this when another agent can research, explore, review, or execute a well-scoped task independently.',
    'Pass task_id to resume a previous subagent session returned by this tool.',
    '',
    'Available subagents:',
    available
  ].join('\n');
}
