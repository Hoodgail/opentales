import type { PrismaClient } from '@prisma/client';
import { tool } from 'ai';
import { z } from 'zod';
import { ProjectFolderUseCase } from '../../projectFiles/ProjectFolderUseCase.js';
import { emptyInputSchema, type ToolContext } from './shared.js';

export function listProjectFilesTool(prisma: PrismaClient, context: ToolContext & { userId: string }) {
  return tool({
    description: 'List the project file tree: folders, docs, and assets that are intentionally placed inside folders. Root assets are omitted.',
    inputSchema: emptyInputSchema,
    execute: async () => new ProjectFolderUseCase(prisma).tree(context.userId, context.projectId)
  });
}

export function readFolderTool(prisma: PrismaClient, context: ToolContext & { userId: string }) {
  return tool({
    description: 'Read one folder by folderId or path and return its immediate child folders, docs, and assets.',
    inputSchema: z.object({ folderId: z.string().optional(), path: z.string().optional() }),
    execute: async (input) => {
      const tree = await new ProjectFolderUseCase(prisma).tree(context.userId, context.projectId);
      const folder = input.folderId
        ? tree.folders.find((candidate) => candidate.id === input.folderId)
        : input.path
          ? tree.folders.find((candidate) => candidate.path === input.path)
          : null;
      const folderId = folder?.id ?? null;
      return {
        folder,
        folders: tree.folders.filter((candidate) => candidate.parentFolderId === folderId),
        docs: tree.docs.filter((doc) => (doc.folderId ?? null) === folderId),
        assets: tree.assets.filter((asset) => (asset.folderId ?? null) === folderId)
      };
    }
  });
}
