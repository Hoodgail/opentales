import type { PrismaClient } from '@prisma/client';
import { tool } from 'ai';
import { pagination, paginatedResult, paginationInputSchema, type ToolContext } from './shared.js';

export function listCharactersTool(prisma: PrismaClient, context: ToolContext) {
  return tool({
    description: 'List characters in the active project with pagination.',
    inputSchema: paginationInputSchema,
    execute: async (input) => {
      const page = pagination(input);
      const where = { projectId: context.projectId };
      const [total, items] = await prisma.$transaction([
        prisma.character.count({ where }),
        prisma.character.findMany({
          where,
          orderBy: { createdAt: 'asc' },
          skip: page.offset,
          take: page.limit,
          select: { id: true, name: true, role: true, traits: true }
        })
      ]);
      return paginatedResult(items, total, page.page, page.limit);
    }
  });
}
