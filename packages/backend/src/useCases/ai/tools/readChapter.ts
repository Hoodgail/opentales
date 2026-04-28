import type { PrismaClient } from '@prisma/client';
import { tool } from 'ai';
import { z } from 'zod';
import { HttpError } from '../../../http/HttpError.js';
import { bodyOf, readRangeInputSchema, readTextRange, type ToolContext } from './shared.js';

export function readChapterTool(prisma: PrismaClient, context: ToolContext) {
  return tool({
    description:
      'Read a bounded chapter body range. Use startLine/endLine for line ranges or offset/length for character ranges. Pass full:true only when needed.',
    inputSchema: readRangeInputSchema.extend({ chapterId: z.string() }),
    execute: async (input) => readChapter(prisma, context, input)
  });
}

export async function readChapter(
  prisma: PrismaClient,
  context: ToolContext,
  input: { chapterId: string; startLine?: number; endLine?: number; offset?: number; length?: number; full?: boolean }
) {
  const chapter = await prisma.chapter.findFirst({
    where: { id: input.chapterId, projectId: context.projectId, deletedAt: null },
    include: {
      bodyWriting: { include: { defaultBranch: { include: { headVersion: true } } } }
    }
  });
  if (!chapter) throw new HttpError(404, 'Chapter not found');
  const range = readTextRange(bodyOf(chapter.bodyWriting), input);
  return {
    id: chapter.id,
    number: chapter.number,
    title: chapter.title,
    summary: chapter.summary,
    range: range.range,
    content: range.content
  };
}
