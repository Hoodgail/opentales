import path from 'node:path';
import { AssetKind, type PrismaClient } from '@prisma/client';
import type { Asset, AssetKind as SdkAssetKind } from '@opentales/sdk';
import { HttpError } from '../../http/HttpError.js';
import { ProjectAccessRepository } from '../../repositories/ProjectAccessRepository.js';
import { LocalAssetStorage } from '../../repositories/AssetStorage.js';
import { env } from '../../config/env.js';
import { assertFolderInProject, assertSiblingNamesAvailable, itemNameFromAsset, nextFolderOrder, withFolderSiblingLock } from '../projectFiles/folderLocks.js';

const SDK_TO_PRISMA: Record<SdkAssetKind, AssetKind> = {
  image: AssetKind.IMAGE,
  audio: AssetKind.AUDIO,
  video: AssetKind.VIDEO,
  document: AssetKind.DOCUMENT
};

function fromPrismaKind(kind: AssetKind): SdkAssetKind {
  switch (kind) {
    case AssetKind.IMAGE:
      return 'image';
    case AssetKind.AUDIO:
      return 'audio';
    case AssetKind.VIDEO:
      return 'video';
    case AssetKind.DOCUMENT:
    case AssetKind.TEXT_BLOB:
    default:
      return 'document';
  }
}

export interface UploadAssetInput {
  kind: SdkAssetKind;
  filename: string;
  mimeType: string;
  buffer: Buffer;
  folderId?: string | null;
  name?: string;
}

export class UploadAssetUseCase {
  private readonly access: ProjectAccessRepository;
  private readonly storage = new LocalAssetStorage();

  constructor(private readonly prisma: PrismaClient) {
    this.access = new ProjectAccessRepository(prisma);
  }

  async execute(userId: string, projectId: string, input: UploadAssetInput): Promise<Asset> {
    await this.access.assertProjectAccess(userId, projectId);

    if (!input.buffer || input.buffer.length === 0) {
      throw new HttpError(400, 'Empty file');
    }

    const sdkKind = input.kind ?? 'image';
    const prismaKind = SDK_TO_PRISMA[sdkKind];
    if (!prismaKind) {
      throw new HttpError(400, `Unsupported asset kind: ${input.kind}`);
    }

    const ext = path.extname(input.filename).replace(/^\./, '').toLowerCase();

    const folderId = input.folderId ?? null;
    const name = input.name !== undefined || folderId ? itemNameFromAsset(input.name ?? input.filename, '') : null;

    const created = await withFolderSiblingLock(this.prisma, projectId, folderId, async (tx) => {
      await assertFolderInProject(tx, projectId, folderId);
      if (folderId && name) await assertSiblingNamesAvailable(tx, projectId, folderId, [{ type: 'asset', name }]);
      // Pre-allocate id so the storage key is stable.
      return tx.asset.create({
        data: {
          projectId,
          folderId,
          name,
          order: folderId ? await nextFolderOrder(tx, projectId, folderId) : null,
          kind: prismaKind,
          s3Bucket: LocalAssetStorage.bucket,
          s3Key: `pending/${cryptoRandom()}`,
          mimeType: input.mimeType,
          sizeBytes: BigInt(input.buffer.length),
          uploadedById: userId
        }
      });
    });

    const stored = await this.storage.write(projectId, created.id, ext, input.buffer);

    const finalAsset = await this.prisma.asset.update({
      where: { id: created.id },
      data: {
        s3Key: stored.key,
        sizeBytes: stored.sizeBytes
      }
    });

    return {
      id: finalAsset.id,
      projectId: finalAsset.projectId,
      folderId: finalAsset.folderId,
      name: finalAsset.name,
      kind: fromPrismaKind(finalAsset.kind),
      mimeType: finalAsset.mimeType,
      sizeBytes: Number(finalAsset.sizeBytes),
      url: `${env.publicBaseUrl}/assets/${finalAsset.id}`,
      createdAt: finalAsset.createdAt.toISOString()
    };
  }
}

function cryptoRandom(): string {
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}
