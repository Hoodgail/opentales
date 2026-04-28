import type { PrismaClient } from '@prisma/client';
import { tool } from 'ai';
import { z } from 'zod';
import { HttpError } from '../../../http/HttpError.js';
import { bodyOf, type ToolContext } from './shared.js';

const grepInputSchema = z.object({
  query: z.string(),
  chapterIds: z.array(z.string()).optional(),
  regex: z.boolean().optional(),
  caseSensitive: z.boolean().optional(),
  limit: z.number().int().min(1).max(100).optional()
});

export function grepChapterTool(prisma: PrismaClient, context: ToolContext) {
  return tool({
    description: 'Search one chapter body for a text or regex pattern and return matching line snippets.',
    inputSchema: grepInputSchema.omit({ chapterIds: true }).extend({ chapterId: z.string() }),
    execute: async (input) => grepChapters(prisma, context, { ...input, chapterIds: [input.chapterId] })
  });
}

export function grepChaptersTool(prisma: PrismaClient, context: ToolContext) {
  return tool({
    description: 'Search all or selected chapter bodies for a text or regex pattern and return matching line snippets.',
    inputSchema: grepInputSchema,
    execute: async (input) => grepChapters(prisma, context, input)
  });
}

async function grepChapters(
  prisma: PrismaClient,
  context: ToolContext,
  input: { query: string; chapterIds?: string[]; regex?: boolean; caseSensitive?: boolean; limit?: number }
) {
  const query = input.query.trim();
  if (!query) throw new HttpError(400, 'grep query is required');
  const limit = Math.min(input.limit ?? 50, 100);
  const chapters = await prisma.chapter.findMany({
    where: {
      projectId: context.projectId,
      deletedAt: null,
      ...(input.chapterIds?.length ? { id: { in: input.chapterIds } } : {})
    },
    orderBy: { number: 'asc' },
    include: {
      bodyWriting: { include: { defaultBranch: { include: { headVersion: true } } } }
    }
  });
  const matcher = makeMatcher(query, Boolean(input.regex), Boolean(input.caseSensitive));
  const matches: Array<{
    chapterId: string;
    chapterNumber: number;
    chapterTitle: string;
    line: number;
    text: string;
  }> = [];
  for (const chapter of chapters) {
    const lines = bodyOf(chapter.bodyWriting).split(/\r?\n/);
    for (const [index, line] of lines.entries()) {
      if (matcher(line)) {
        matches.push({
          chapterId: chapter.id,
          chapterNumber: chapter.number,
          chapterTitle: chapter.title,
          line: index + 1,
          text: line
        });
        if (matches.length >= limit) return { query, matches, truncated: true };
      }
    }
  }
  return { query, matches, truncated: false };
}

function makeMatcher(query: string, regex: boolean, caseSensitive: boolean): (line: string) => boolean {
  if (regex) {
    const expression = new RegExp(query, caseSensitive ? '' : 'i');
    return (line) => expression.test(line);
  }
  const needle = caseSensitive ? query : query.toLowerCase();
  return (line) => (caseSensitive ? line : line.toLowerCase()).includes(needle);
}
