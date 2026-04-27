import type { Response } from 'express';
import type { PrismaClient } from '@prisma/client';
import { HttpError } from '../../http/HttpError.js';
import { LocalAssetStorage } from '../../repositories/AssetStorage.js';

export class StreamAssetUseCase {
  private readonly storage = new LocalAssetStorage();

  constructor(private readonly prisma: PrismaClient) {}

  async execute(assetId: string, res: Response): Promise<void> {
    const asset = await this.prisma.asset.findUnique({
      where: { id: assetId },
      select: { id: true, s3Bucket: true, s3Key: true, mimeType: true, sizeBytes: true }
    });

    if (!asset) {
      throw new HttpError(404, 'Asset not found');
    }

    if (asset.s3Bucket !== LocalAssetStorage.bucket) {
      throw new HttpError(501, 'Asset stored in a non-local bucket');
    }

    const stream = await this.storage.readStream(asset.s3Key);
    res.setHeader('Content-Type', asset.mimeType);
    res.setHeader('Content-Length', asset.sizeBytes.toString());
    res.setHeader('Cache-Control', 'private, max-age=300');
    stream.pipe(res);
    stream.on('error', () => {
      if (!res.headersSent) {
        res.status(500).end();
      } else {
        res.end();
      }
    });
  }
}
