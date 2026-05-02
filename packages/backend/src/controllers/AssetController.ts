import type { Request, Response } from 'express';
import { prisma } from '../config/prisma.js';
import { HttpError } from '../http/HttpError.js';
import { StreamAssetUseCase } from '../useCases/assets/StreamAssetUseCase.js';
import { ProjectAssetUseCase } from '../useCases/assets/ProjectAssetUseCase.js';
import {
  UploadAssetUseCase,
  type UploadAssetInput
} from '../useCases/assets/UploadAssetUseCase.js';
import type { AssetKind } from '@opentales/sdk';
import type { UpdateProjectAssetInput } from '@opentales/sdk';

export class AssetController {
  private readonly uploadAssetUseCase = new UploadAssetUseCase(prisma);
  private readonly streamAssetUseCase = new StreamAssetUseCase(prisma);
  private readonly projectAssetUseCase = new ProjectAssetUseCase(prisma);

  upload = async (req: Request, res: Response) => {
    if (!req.file) {
      throw new HttpError(400, 'Missing file');
    }

    const kind = (req.body?.kind ?? 'image') as AssetKind;

    const input: UploadAssetInput = {
      kind,
      filename: req.file.originalname || 'upload',
      mimeType: req.file.mimetype || 'application/octet-stream',
      buffer: req.file.buffer,
      folderId: typeof req.body?.folderId === 'string' ? req.body.folderId : null,
      name: typeof req.body?.name === 'string' ? req.body.name : undefined
    };

    res.status(201).json(
      await this.uploadAssetUseCase.execute(this.userId(req), req.params.projectId, input)
    );
  };

  stream = async (req: Request, res: Response) => {
    await this.streamAssetUseCase.execute(req.params.assetId, res);
  };

  update = async (req: Request, res: Response) => {
    res.json(await this.projectAssetUseCase.update(this.userId(req), req.params.projectId, req.params.assetId, req.body as UpdateProjectAssetInput));
  };

  delete = async (req: Request, res: Response) => {
    res.json(await this.projectAssetUseCase.delete(this.userId(req), req.params.projectId, req.params.assetId));
  };

  private userId(req: Request): string {
    const id = req.user?.id;
    if (!id) {
      throw new HttpError(401, 'Authentication required');
    }
    return id;
  }
}
