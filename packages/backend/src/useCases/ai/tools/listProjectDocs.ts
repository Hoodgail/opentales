import type { PrismaClient } from '@prisma/client';
import { tool } from 'ai';
import { z } from 'zod';
import { pagination, paginatedResult, paginationInputSchema, toPrismaDocKind, type ToolContext } from './shared.js';

export function listProjectDocsTool(prisma: PrismaClient, context: ToolContext) {
  return tool({
    description: 'List bounded project document metadata and branch/head tokens without body text.',
    inputSchema: paginationInputSchema.extend({
      kind: z.enum(['note', 'brainstorm', 'instructions', 'reference', 'other']).optional(),
      folderId: z.string().nullable().optional()
    }),
    execute: async (input) => {
      const page = pagination(input);
      const where = { projectId: context.projectId, ...(input.folderId !== undefined ? { folderId: input.folderId } : {}), ...(input.kind ? { kind: toPrismaDocKind(input.kind) } : {}) };
      const [total, items] = await prisma.$transaction([
        prisma.projectDoc.count({ where }),
        prisma.projectDoc.findMany({
          where,
          orderBy: [{ order: 'asc' }, { createdAt: 'asc' }],
          skip: page.offset,
          take: page.limit,
          select: {
            id: true,
            folderId: true,
            title: true,
            kind: true,
            updatedAt: true,
            bodyWriting: {
              select: {
                defaultBranch: {
                  select: { id: true, headVersionId: true, headVersion: { select: { wordCount: true } } }
                }
              }
            }
          }
        })
      ]);
      return paginatedResult(items.map(({ bodyWriting, ...doc }) => ({
        ...doc,
        branchId: bodyWriting.defaultBranch?.id ?? null,
        headVersionId: bodyWriting.defaultBranch?.headVersionId ?? null,
        wordCount: bodyWriting.defaultBranch?.headVersion?.wordCount ?? 0
      })), total, page.page, page.limit);
    }
  });
}
