import type { PrismaClient } from '@prisma/client';
import { tool } from 'ai';
import { z } from 'zod';
import { HttpError } from '../../../http/HttpError.js';
import { bodyOf, readRangeInputSchema, readTextRange, type ToolContext } from './shared.js';

export function readProjectDocTool(prisma: PrismaClient, context: ToolContext) {
  return tool({
    description:
      'Read a project note, brainstorm, instruction, or reference doc. Use bounded line or offset ranges unless full text is required.',
    inputSchema: readRangeInputSchema.extend({ docId: z.string() }),
    execute: async (input) => {
      const doc = await prisma.projectDoc.findFirst({
        where: { id: input.docId, projectId: context.projectId },
        include: {
          folder: true,
          bodyWriting: { include: { defaultBranch: { include: { headVersion: true } } } }
        }
      });
      if (!doc) throw new HttpError(404, 'Project document not found');
      const range = readTextRange(bodyOf(doc.bodyWriting), input);
      return {
        id: doc.id,
        folderId: doc.folderId,
        title: doc.title,
        path: doc.folder ? `${doc.folder.path}/${doc.title}` : doc.title,
        kind: doc.kind,
        range: range.range,
        content: range.content,
        updatedAt: doc.updatedAt.toISOString()
      };
    }
  });
}
