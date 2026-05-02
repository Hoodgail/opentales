import { Buffer } from 'node:buffer';
import type { PrismaClient } from '@prisma/client';
import type { ProjectStorageUsage } from '@opentales/sdk';
import { ProjectAccessRepository } from '../../repositories/ProjectAccessRepository.js';

export class GetProjectStorageUseCase {
  private readonly access: ProjectAccessRepository;

  constructor(private readonly prisma: PrismaClient) {
    this.access = new ProjectAccessRepository(prisma);
  }

  async execute(userId: string, projectId: string): Promise<ProjectStorageUsage> {
    await this.access.assertProjectAccess(userId, projectId);
    const [assets, versions] = await Promise.all([
      this.prisma.asset.findMany({ where: { projectId }, select: { id: true, sizeBytes: true } }),
      this.prisma.writingVersion.findMany({
        where: { branch: { writing: { projectId } } },
        select: { id: true, body: true, bodyAssetId: true, bodyAsset: { select: { sizeBytes: true } } }
      })
    ]);

    const assetBytes = assets.reduce((sum, asset) => sum + Number(asset.sizeBytes), 0);
    const writingContentBytes = versions.reduce((sum, version) => sum + Buffer.byteLength(version.body ?? '', 'utf8'), 0);
    const bodyAssetIds = new Set<string>();
    let writingBodyAssetBytes = 0;
    for (const version of versions) {
      if (!version.bodyAssetId || bodyAssetIds.has(version.bodyAssetId)) continue;
      bodyAssetIds.add(version.bodyAssetId);
      writingBodyAssetBytes += Number(version.bodyAsset?.sizeBytes ?? 0);
    }

    return {
      projectId,
      assetBytes,
      writingContentBytes,
      writingBodyAssetBytes,
      totalBytes: assetBytes + writingContentBytes + writingBodyAssetBytes,
      assetCount: assets.length,
      writingVersionCount: versions.length,
      writingBodyAssetCount: bodyAssetIds.size
    };
  }
}
