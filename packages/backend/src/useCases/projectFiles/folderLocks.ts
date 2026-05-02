import type { Prisma, PrismaClient } from '@prisma/client';
import { HttpError } from '../../http/HttpError.js';

type Tx = Prisma.TransactionClient;

export type FolderItemType = 'folder' | 'doc' | 'asset';

export interface SiblingNameCheck {
  type: FolderItemType;
  id?: string;
  name: string;
}

export function validateFolderItemName(name: string, label = 'Name'): string {
  const trimmed = name.trim();
  if (!trimmed) throw new HttpError(400, `${label} is required`);
  if (trimmed.includes('/')) throw new HttpError(400, `${label} cannot contain /`);
  if (trimmed === '.' || trimmed === '..') throw new HttpError(400, `${label} is reserved`);
  return trimmed;
}

export function joinPath(parentPath: string | null | undefined, name: string): string {
  return parentPath ? `${parentPath}/${name}` : name;
}

export async function withFolderSiblingLock<T>(
  prisma: PrismaClient,
  projectId: string,
  folderId: string | null,
  run: (tx: Tx) => Promise<T>
): Promise<T> {
  return prisma.$transaction(async (tx) => {
    await lockFolderSiblings(tx, projectId, folderId);
    return run(tx);
  });
}

export async function lockFolderSiblings(tx: Tx, projectId: string, folderId: string | null): Promise<void> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`${projectId}:${folderId ?? 'root'}`}, 937)::bigint)`;
}

export async function assertFolderInProject(
  tx: Tx,
  projectId: string,
  folderId: string | null | undefined
): Promise<{ id: string; path: string } | null> {
  if (!folderId) return null;
  const folder = await tx.projectFolder.findFirst({
    where: { id: folderId, projectId },
    select: { id: true, path: true }
  });
  if (!folder) throw new HttpError(404, 'Folder not found');
  return folder;
}

export async function assertSiblingNamesAvailable(
  tx: Tx,
  projectId: string,
  folderId: string | null,
  items: SiblingNameCheck[]
): Promise<void> {
  for (const item of items) {
    const name = validateFolderItemName(item.name);
    const [folder, doc, asset] = await Promise.all([
      item.type === 'folder'
        ? tx.projectFolder.findFirst({ where: { projectId, parentFolderId: folderId, name, NOT: item.id ? { id: item.id } : undefined }, select: { id: true } })
        : tx.projectFolder.findFirst({ where: { projectId, parentFolderId: folderId, name }, select: { id: true } }),
      item.type === 'doc'
        ? tx.projectDoc.findFirst({ where: { projectId, folderId, title: name, NOT: item.id ? { id: item.id } : undefined }, select: { id: true } })
        : tx.projectDoc.findFirst({ where: { projectId, folderId, title: name }, select: { id: true } }),
      item.type === 'asset'
        ? tx.asset.findFirst({ where: { projectId, folderId, name, NOT: item.id ? { id: item.id } : undefined }, select: { id: true } })
        : tx.asset.findFirst({ where: { projectId, folderId, name }, select: { id: true } })
    ]);

    if (folder || doc || asset) {
      throw new HttpError(409, `An item named "${name}" already exists in this folder`);
    }
  }
}

export async function nextFolderOrder(tx: Tx, projectId: string, folderId: string | null): Promise<number> {
  const [folder, doc, asset] = await Promise.all([
    tx.projectFolder.findFirst({ where: { projectId, parentFolderId: folderId }, orderBy: { order: 'desc' }, select: { order: true } }),
    tx.projectDoc.findFirst({ where: { projectId, folderId }, orderBy: { order: 'desc' }, select: { order: true } }),
    tx.asset.findFirst({ where: { projectId, folderId }, orderBy: { order: 'desc' }, select: { order: true } })
  ]);
  return Math.max(folder?.order ?? -1, doc?.order ?? -1, asset?.order ?? -1) + 1;
}

export function itemNameFromAsset(filename: string | null | undefined, assetId: string): string {
  return validateFolderItemName(filename?.trim() || assetId, 'Asset name');
}
