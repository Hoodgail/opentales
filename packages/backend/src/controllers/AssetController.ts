import type { Request, Response } from 'express';
import { prisma } from '../config/prisma.js';
import { HttpError } from '../http/HttpError.js';
import { StreamAssetUseCase } from '../useCases/assets/StreamAssetUseCase.js';
import {
  UploadAssetUseCase,
  type UploadAssetInput
} from '../useCases/assets/UploadAssetUseCase.js';
import type { AssetKind } from '@opentales/sdk';

export class AssetController {
  private readonly uploadAssetUseCase = new UploadAssetUseCase(prisma);
  private readonly streamAssetUseCase = new StreamAssetUseCase(prisma);

  upload = async (req: Request, res: Response) => {
    if (!req.file) {
      throw new HttpError(400, 'Missing file');
    }

    const kind = (req.body?.kind ?? 'image') as AssetKind;

    const input: UploadAssetInput = {
      kind,
      filename: req.file.originalname || 'upload',
      mimeType: req.file.mimetype || 'application/octet-stream',
      buffer: req.file.buffer
    };

    res.status(201).json(
      await this.uploadAssetUseCase.execute(this.userId(req), req.params.projectId, input)
    );
  };

  stream = async (req: Request, res: Response) => {
    await this.streamAssetUseCase.execute(req.params.assetId, res);
  };

  private userId(req: Request): string {
    const id = req.user?.id;
    if (!id) {
      throw new HttpError(401, 'Authentication required');
    }
    return id;
  }
}
