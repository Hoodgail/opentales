import type { PrismaClient } from '@prisma/client';
import { tool } from 'ai';
import { pagination, paginatedResult, paginationInputSchema, type ToolContext } from './shared.js';

export function listChaptersTool(prisma: PrismaClient, context: ToolContext) {
  return tool({
    description: 'List chapter metadata and summaries with pagination. Prefer this before reading full chapter bodies.',
    inputSchema: paginationInputSchema,
    execute: async (input) => {
      const page = pagination(input);
      const where = { projectId: context.projectId, deletedAt: null };
      const [total, items] = await prisma.$transaction([
        prisma.chapter.count({ where }),
        prisma.chapter.findMany({
          where,
          orderBy: { number: 'asc' },
          skip: page.offset,
          take: page.limit,
          select: {
            id: true,
            number: true,
            title: true,
            status: true,
            summary: true,
            povCharacterId: true,
            locationId: true
          }
        })
      ]);
      return paginatedResult(items, total, page.page, page.limit);
    }
  });
}
