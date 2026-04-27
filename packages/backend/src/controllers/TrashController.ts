import type { Request, Response } from 'express';
import { prisma } from '../config/prisma.js';
import { HttpError } from '../http/HttpError.js';
import { ListTrashUseCase } from '../useCases/trash/ListTrashUseCase.js';
import { PurgeChapterUseCase } from '../useCases/trash/PurgeChapterUseCase.js';
import { RestoreChapterUseCase } from '../useCases/trash/RestoreChapterUseCase.js';

export class TrashController {
  private readonly listUseCase = new ListTrashUseCase(prisma);
  private readonly restoreUseCase = new RestoreChapterUseCase(prisma);
  private readonly purgeUseCase = new PurgeChapterUseCase(prisma);

  list = async (req: Request, res: Response) => {
    res.json(await this.listUseCase.execute(this.userId(req), req.params.projectId));
  };

  restoreChapter = async (req: Request, res: Response) => {
    res.json(
      await this.restoreUseCase.execute(
        this.userId(req),
        req.params.projectId,
        req.params.chapterId
      )
    );
  };

  purgeChapter = async (req: Request, res: Response) => {
    res.json(
      await this.purgeUseCase.execute(
        this.userId(req),
        req.params.projectId,
        req.params.chapterId
      )
    );
  };

  private userId(req: Request): string {
    if (!req.user) throw new HttpError(401, 'Authentication required');
    return req.user.id;
  }
}
