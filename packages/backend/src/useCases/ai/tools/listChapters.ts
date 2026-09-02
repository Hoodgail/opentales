import type { PrismaClient } from '@prisma/client';
import { tool } from 'ai';
import { pagination, paginatedResult, paginationInputSchema, type ToolContext } from './shared.js';

export function listChaptersTool(prisma: PrismaClient, context: ToolContext) {
  return tool({
    description: 'List bounded chapter metadata, summaries, word counts, and branch/head tokens without body text. Prefer this before reading full chapters or applying a multi-chapter patch.',
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
            locationId: true,
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
      return paginatedResult(items.map(({ bodyWriting, ...chapter }) => ({
        ...chapter,
        branchId: bodyWriting.defaultBranch?.id ?? null,
        headVersionId: bodyWriting.defaultBranch?.headVersionId ?? null,
        wordCount: bodyWriting.defaultBranch?.headVersion?.wordCount ?? 0
      })), total, page.page, page.limit);
    }
  });
}
