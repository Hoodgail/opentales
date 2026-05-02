import type { Prisma, PrismaClient } from '@prisma/client';
import type { CreateProjectFolderInput, ProjectFolder, ProjectFileTree, UpdateProjectFolderInput } from '@opentales/sdk';
import { HttpError } from '../../http/HttpError.js';
import { ProjectAccessRepository } from '../../repositories/ProjectAccessRepository.js';
import {
  assertFolderInProject,
  assertSiblingNamesAvailable,
  joinPath,
  lockFolderSiblings,
  nextFolderOrder,
  validateFolderItemName,
  withFolderSiblingLock
} from './folderLocks.js';

export class ProjectFolderUseCase {
  private readonly access: ProjectAccessRepository;

  constructor(private readonly prisma: PrismaClient) {
    this.access = new ProjectAccessRepository(prisma);
  }

  async tree(userId: string, projectId: string): Promise<ProjectFileTree> {
    await this.access.assertProjectAccess(userId, projectId);
    const [folders, docs, assets] = await Promise.all([
      this.prisma.projectFolder.findMany({ where: { projectId }, orderBy: [{ parentFolderId: 'asc' }, { order: 'asc' }, { name: 'asc' }] }),
      this.prisma.projectDoc.findMany({
        where: { projectId },
        orderBy: [{ folderId: 'asc' }, { order: 'asc' }, { title: 'asc' }],
        include: { bodyWriting: { include: { defaultBranch: { include: { headVersion: true } } } } }
      }),
      this.prisma.asset.findMany({
        where: { projectId, folderId: { not: null } },
        orderBy: [{ folderId: 'asc' }, { order: 'asc' }, { createdAt: 'asc' }]
      })
    ]);
    return {
      folders: folders.map((folder) => ({
        id: folder.id,
        projectId: folder.projectId,
        parentFolderId: folder.parentFolderId,
        name: folder.name,
        path: folder.path,
        order: folder.order,
        createdAt: folder.createdAt.toISOString(),
        updatedAt: folder.updatedAt.toISOString()
      })),
      docs: docs.map((doc) => {
        const kindMap = { NOTE: 'note', BRAINSTORM: 'brainstorm', INSTRUCTIONS: 'instructions', REFERENCE: 'reference', OTHER: 'other' } as const;
        const head = doc.bodyWriting.defaultBranch?.headVersion;
        const parent = doc.folderId ? folders.find((folder) => folder.id === doc.folderId) : null;
        return {
          id: doc.id,
          projectId: doc.projectId,
          folderId: doc.folderId,
          title: doc.title,
          path: joinPath(parent?.path, doc.title),
          kind: kindMap[doc.kind],
          content: head?.body ?? '',
          wordCount: head?.wordCount ?? 0,
          order: doc.order,
          createdAt: doc.createdAt.toISOString(),
          updatedAt: doc.updatedAt.toISOString()
        };
      }),
      assets: assets.map((asset) => {
        const parent = asset.folderId ? folders.find((folder) => folder.id === asset.folderId) : null;
        return {
          id: asset.id,
          projectId: asset.projectId,
          folderId: asset.folderId,
          name: asset.name ?? asset.id,
          path: joinPath(parent?.path, asset.name ?? asset.id),
          kind: asset.kind === 'IMAGE' ? 'image' : asset.kind === 'AUDIO' ? 'audio' : asset.kind === 'VIDEO' ? 'video' : 'document',
          mimeType: asset.mimeType,
          sizeBytes: Number(asset.sizeBytes),
          url: `/assets/${asset.id}`,
          order: asset.order ?? 0,
          createdAt: asset.createdAt.toISOString()
        };
      })
    };
  }

  async create(userId: string, projectId: string, input: CreateProjectFolderInput): Promise<ProjectFolder> {
    await this.access.assertPermission(userId, projectId, 'project:write');
    const name = validateFolderItemName(input.name, 'Folder name');
    const parentFolderId = input.parentFolderId ?? null;
    const folderId = await withFolderSiblingLock(this.prisma, projectId, parentFolderId, async (tx) => {
      const parent = await assertFolderInProject(tx, projectId, parentFolderId);
      await assertSiblingNamesAvailable(tx, projectId, parentFolderId, [{ type: 'folder', name }]);
      const order = input.order ?? await nextFolderOrder(tx, projectId, parentFolderId);
      const folder = await tx.projectFolder.create({
        data: { projectId, parentFolderId, name, path: joinPath(parent?.path, name), order },
        select: { id: true }
      });
      return folder.id;
    });
    return this.get(userId, projectId, folderId);
  }

  async get(userId: string, projectId: string, folderId: string): Promise<ProjectFolder> {
    await this.access.assertProjectAccess(userId, projectId);
    const folder = await this.prisma.projectFolder.findFirst({ where: { id: folderId, projectId } });
    if (!folder) throw new HttpError(404, 'Folder not found');
    return {
      id: folder.id,
      projectId: folder.projectId,
      parentFolderId: folder.parentFolderId,
      name: folder.name,
      path: folder.path,
      order: folder.order,
      createdAt: folder.createdAt.toISOString(),
      updatedAt: folder.updatedAt.toISOString()
    };
  }

  async update(userId: string, projectId: string, folderId: string, input: UpdateProjectFolderInput): Promise<ProjectFolder> {
    await this.access.assertPermission(userId, projectId, 'project:write');
    const existing = await this.prisma.projectFolder.findFirst({ where: { id: folderId, projectId } });
    if (!existing) throw new HttpError(404, 'Folder not found');
    const nextName = input.name === undefined ? existing.name : validateFolderItemName(input.name, 'Folder name');
    const nextParentId = input.parentFolderId === undefined ? existing.parentFolderId : input.parentFolderId;
    if (nextParentId === folderId) throw new HttpError(400, 'Cannot move a folder into itself');

    const lockIds = Array.from(new Set([existing.parentFolderId ?? null, nextParentId ?? null]));
    await this.prisma.$transaction(async (tx) => {
      for (const id of lockIds.sort((a, b) => String(a).localeCompare(String(b)))) await lockFolderSiblings(tx, projectId, id);
      const parent = await assertFolderInProject(tx, projectId, nextParentId);
      if (parent && (parent.path === existing.path || parent.path.startsWith(`${existing.path}/`))) {
        throw new HttpError(400, 'Cannot move a folder into its descendant');
      }
      await assertSiblingNamesAvailable(tx, projectId, nextParentId ?? null, [{ type: 'folder', id: folderId, name: nextName }]);
      const path = joinPath(parent?.path, nextName);
      await tx.projectFolder.update({ where: { id: folderId }, data: { parentFolderId: nextParentId ?? null, name: nextName, path, order: input.order } });
      if (path !== existing.path) await updateDescendantPaths(tx, projectId, existing.path, path);
    });
    return this.get(userId, projectId, folderId);
  }

  async delete(userId: string, projectId: string, folderId: string): Promise<{ id: string; deleted: true }> {
    await this.access.assertPermission(userId, projectId, 'project:write');
    const folder = await this.prisma.projectFolder.findFirst({ where: { id: folderId, projectId }, select: { id: true } });
    if (!folder) throw new HttpError(404, 'Folder not found');
    await this.prisma.projectFolder.delete({ where: { id: folderId } });
    return { id: folderId, deleted: true };
  }
}

async function updateDescendantPaths(tx: Prisma.TransactionClient, projectId: string, oldPath: string, newPath: string) {
  const descendants = await tx.projectFolder.findMany({
    where: { projectId, path: { startsWith: `${oldPath}/` } },
    select: { id: true, path: true }
  });
  for (const folder of descendants) {
    await tx.projectFolder.update({
      where: { id: folder.id },
      data: { path: `${newPath}${folder.path.slice(oldPath.length)}` }
    });
  }
}
