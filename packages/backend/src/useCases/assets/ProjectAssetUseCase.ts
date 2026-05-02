import type { PrismaClient } from '@prisma/client';
import type { Asset, UpdateProjectAssetInput } from '@opentales/sdk';
import { env } from '../../config/env.js';
import { HttpError } from '../../http/HttpError.js';
import { LocalAssetStorage } from '../../repositories/AssetStorage.js';
import { ProjectAccessRepository } from '../../repositories/ProjectAccessRepository.js';
import { assertFolderInProject, assertSiblingNamesAvailable, itemNameFromAsset, lockFolderSiblings } from '../projectFiles/folderLocks.js';

export class ProjectAssetUseCase {
  private readonly access: ProjectAccessRepository;
  private readonly storage = new LocalAssetStorage();

  constructor(private readonly prisma: PrismaClient) {
    this.access = new ProjectAccessRepository(prisma);
  }

  async update(userId: string, projectId: string, assetId: string, input: UpdateProjectAssetInput): Promise<Asset> {
    await this.access.assertPermission(userId, projectId, 'project:write');
    const existing = await this.prisma.asset.findFirst({ where: { id: assetId, projectId } });
    if (!existing) throw new HttpError(404, 'Asset not found');
    const targetFolderId = input.folderId === undefined ? existing.folderId : input.folderId;
    const nextName = input.name === undefined ? existing.name : itemNameFromAsset(input.name, assetId);

    const lockIds = Array.from(new Set([existing.folderId ?? null, targetFolderId ?? null]));
    await this.prisma.$transaction(async (tx) => {
      for (const id of lockIds.sort((a, b) => String(a).localeCompare(String(b)))) await lockFolderSiblings(tx, projectId, id);
      if (input.folderId !== undefined) await assertFolderInProject(tx, projectId, input.folderId);
      if (targetFolderId && nextName) {
        await assertSiblingNamesAvailable(tx, projectId, targetFolderId, [{ type: 'asset', id: assetId, name: nextName }]);
      }
      await tx.asset.update({
        where: { id: assetId },
        data: {
          folderId: input.folderId === undefined ? undefined : input.folderId,
          name: nextName,
          order: input.order
        }
      });
    });

    const updated = await this.prisma.asset.findUniqueOrThrow({ where: { id: assetId } });
    return toAsset(updated);
  }

  async delete(userId: string, projectId: string, assetId: string): Promise<{ id: string; deleted: true }> {
    await this.access.assertPermission(userId, projectId, 'project:write');
    const asset = await this.prisma.asset.findFirst({ where: { id: assetId, projectId } });
    if (!asset) throw new HttpError(404, 'Asset not found');
    await this.prisma.asset.delete({ where: { id: assetId } });
    if (asset.s3Bucket === LocalAssetStorage.bucket) await this.storage.delete(asset.s3Key);
    return { id: assetId, deleted: true };
  }
}

export function toAsset(asset: {
  id: string;
  projectId: string | null;
  folderId?: string | null;
  name?: string | null;
  kind: 'IMAGE' | 'AUDIO' | 'VIDEO' | 'DOCUMENT' | 'TEXT_BLOB';
  mimeType: string;
  sizeBytes: bigint;
  createdAt: Date;
}): Asset {
  return {
    id: asset.id,
    projectId: asset.projectId,
    folderId: asset.folderId ?? null,
    name: asset.name ?? null,
    kind: asset.kind === 'IMAGE' ? 'image' : asset.kind === 'AUDIO' ? 'audio' : asset.kind === 'VIDEO' ? 'video' : 'document',
    mimeType: asset.mimeType,
    sizeBytes: Number(asset.sizeBytes),
    url: `${env.publicBaseUrl}/assets/${asset.id}`,
    createdAt: asset.createdAt.toISOString()
  };
}
