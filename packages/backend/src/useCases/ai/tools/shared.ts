import { z } from 'zod';
import { randomUUID } from 'node:crypto';
export { applyContentEdit, applyContentPatch } from '../../../utils/contentPatch.js';

export const paginationInputSchema = z.object({
  page: z.number().int().min(1).optional().describe('Page number, starting at 1. Defaults to 1.'),
  limit: z.number().int().min(1).max(100).optional().describe('Items per page. Defaults to 10, maximum 100.')
});

export const readRangeInputSchema = z.object({
  startLine: z.number().int().min(1).optional(),
  endLine: z.number().int().min(1).optional(),
  offset: z.number().int().min(0).optional(),
  length: z.number().int().min(1).max(20000).optional(),
  full: z.boolean().optional()
});

export const emptyInputSchema = z.object({});

export const editContentInputSchema = z.object({
  oldString: z.string().min(1).describe('Exact existing text to replace. Read the current content first and include enough surrounding text to make a single match.'),
  newString: z.string().describe('Replacement text. Use an empty string to delete the matched text.'),
  replaceAll: z.boolean().optional().describe('Replace every exact occurrence. Defaults to false; leave false for a uniquely anchored edit.')
}).strict().refine((input) => input.oldString !== input.newString, {
  message: 'oldString and newString must differ'
});

export const contentPatchInputSchema = z.discriminatedUnion('mode', [
  z.object({
    mode: z.literal('replace'),
    content: z.string().max(2_000_000).describe('Complete replacement body. May be empty, which is useful for initializing or clearing a writing.')
  }).strict(),
  z.object({
    mode: z.literal('edit'),
    edits: z.array(editContentInputSchema).min(1).max(100).describe('Exact replacements applied in order to the current body.')
  }).strict()
]);

export interface ToolContext {
  projectId: string;
}

export interface AgentToolInvocationContext {
  toolCallId?: string;
  abortSignal?: AbortSignal;
}

export function invocationToolCallId(options: AgentToolInvocationContext | undefined): string {
  const providerId = options?.toolCallId?.trim();
  return providerId || `manual-${randomUUID()}`;
}

export function pagination(input: { page?: number; limit?: number } = {}) {
  const page = Math.max(input.page ?? 1, 1);
  const limit = Math.min(Math.max(input.limit ?? 10, 1), 100);
  return { page, limit, offset: (page - 1) * limit };
}

export function paginatedResult<T>(items: T[], total: number, page: number, limit: number) {
  const totalPages = Math.max(Math.ceil(total / limit), 1);
  return {
    items,
    total,
    page,
    limit,
    totalPages,
    nextPage: page < totalPages ? page + 1 : null,
    previousPage: page > 1 ? page - 1 : null
  };
}

export function readTextRange(
  content: string,
  input: { startLine?: number; endLine?: number; offset?: number; length?: number; full?: boolean }
) {
  const lines = content.split(/\r?\n/);
  if (input.full) {
    return {
      content,
      range: { mode: 'full', startLine: 1, endLine: lines.length, offset: 0, length: content.length }
    };
  }
  if (input.startLine !== undefined || input.endLine !== undefined) {
    const startLine = Math.max(input.startLine ?? 1, 1);
    const endLine = Math.min(input.endLine ?? startLine + 80, lines.length);
    return {
      content: lines.slice(startLine - 1, endLine).join('\n'),
      range: { mode: 'lines', startLine, endLine, offset: null, length: null }
    };
  }
  const offset = Math.max(input.offset ?? 0, 0);
  const length = Math.min(input.length ?? 8000, 20000);
  return {
    content: content.slice(offset, offset + length),
    range: { mode: 'offset', startLine: null, endLine: null, offset, length }
  };
}

export function bodyOf(writing: {
  defaultBranch: { headVersion: { body: string | null } | null } | null;
}): string {
  return writing.defaultBranch?.headVersion?.body ?? '';
}

export function countWords(value: string): number {
  return value.trim().split(/\s+/).filter(Boolean).length;
}

export function toPrismaDocKind(kind: string): 'NOTE' | 'BRAINSTORM' | 'INSTRUCTIONS' | 'REFERENCE' | 'OTHER' {
  const map = {
    note: 'NOTE',
    brainstorm: 'BRAINSTORM',
    instructions: 'INSTRUCTIONS',
    reference: 'REFERENCE',
    other: 'OTHER'
  } as const;
  return map[kind as keyof typeof map] ?? 'NOTE';
}
