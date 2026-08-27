import type { Request, Response } from 'express';
import type { ApplyRenameSymbolInput, PreviewRenameSymbolInput } from '@opentales/sdk';
import { prisma } from '../config/prisma.js';
import { HttpError } from '../http/HttpError.js';
import { RenameRefactorUseCase } from '../useCases/refactor/RenameRefactorUseCase.js';

export class RefactorController {
  private readonly rename = new RenameRefactorUseCase(prisma);

  previewRename = async (req: Request, res: Response) => {
    res.json(await this.rename.preview(this.user(req), req.params.projectId, req.body as PreviewRenameSymbolInput));
  };

  applyRename = async (req: Request, res: Response) => {
    res.json(await this.rename.apply(this.user(req), req.params.projectId, req.body as ApplyRenameSymbolInput));
  };

  private user(req: Request): string {
    if (!req.user) throw new HttpError(401, 'Authentication required');
    return req.user.id;
  }
}
