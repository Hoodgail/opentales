import type { PrismaClient } from '@prisma/client';
import { tool } from 'ai';
import { z } from 'zod';
import { pagination, paginatedResult, paginationInputSchema, toPrismaDocKind, type ToolContext } from './shared.js';

export function listProjectDocsTool(prisma: PrismaClient, context: ToolContext) {
  return tool({
    description: 'List project notes, brainstorms, instructions, and reference docs with pagination.',
    inputSchema: paginationInputSchema.extend({
      kind: z.enum(['note', 'brainstorm', 'instructions', 'reference', 'other']).optional()
    }),
    execute: async (input) => {
      const page = pagination(input);
      const where = { projectId: context.projectId, ...(input.kind ? { kind: toPrismaDocKind(input.kind) } : {}) };
      const [total, items] = await prisma.$transaction([
        prisma.projectDoc.count({ where }),
        prisma.projectDoc.findMany({
          where,
          orderBy: [{ order: 'asc' }, { createdAt: 'asc' }],
          skip: page.offset,
          take: page.limit,
          select: { id: true, title: true, kind: true, updatedAt: true }
        })
      ]);
      return paginatedResult(items, total, page.page, page.limit);
    }
  });
}
