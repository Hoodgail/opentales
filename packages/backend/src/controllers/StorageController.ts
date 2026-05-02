import type { Request, Response } from 'express';
import { prisma } from '../config/prisma.js';
import { HttpError } from '../http/HttpError.js';
import { GetProjectStorageUseCase } from '../useCases/storage/GetProjectStorageUseCase.js';

export class StorageController {
  private readonly useCase = new GetProjectStorageUseCase(prisma);

  get = async (req: Request, res: Response) => {
    res.json(await this.useCase.execute(this.userId(req), req.params.projectId));
  };

  private userId(req: Request): string {
    if (!req.user) throw new HttpError(401, 'Authentication required');
    return req.user.id;
  }
}
