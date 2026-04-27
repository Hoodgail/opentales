import type { Request, Response } from 'express';
import type { CreateBetaShareCommentInput } from '@opentales/sdk';
import { prisma } from '../config/prisma.js';
import { GetProjectRssUseCase } from '../useCases/projects/GetProjectRssUseCase.js';
import { GetPublicProjectUseCase } from '../useCases/projects/GetPublicProjectUseCase.js';
import { GetBetaShareViewUseCase } from '../useCases/shareLinks/GetBetaShareViewUseCase.js';
import { AddBetaShareCommentUseCase } from '../useCases/shareLinks/AddBetaShareCommentUseCase.js';

export class PublicProjectController {
  private readonly getPublicProjectUseCase = new GetPublicProjectUseCase(prisma);
  private readonly getShareViewUseCase = new GetBetaShareViewUseCase(prisma);
  private readonly addShareCommentUseCase = new AddBetaShareCommentUseCase(prisma);
  private readonly getProjectRssUseCase = new GetProjectRssUseCase(prisma);

  get = async (req: Request, res: Response) => {
    res.json(
      await this.getPublicProjectUseCase.execute(req.params.orgSlug, req.params.projectSlug)
    );
  };

  getShareView = async (req: Request, res: Response) => {
    res.json(await this.getShareViewUseCase.execute(req.params.token));
  };

  addShareComment = async (req: Request, res: Response) => {
    const body = (req.body ?? {}) as CreateBetaShareCommentInput;
    res.json(
      await this.addShareCommentUseCase.execute(req.params.token, {
        visitorName: typeof body.visitorName === 'string' ? body.visitorName : '',
        body: typeof body.body === 'string' ? body.body : '',
        chapterId:
          typeof body.chapterId === 'string' || body.chapterId === null
            ? body.chapterId
            : undefined,
        lineStart: typeof body.lineStart === 'number' ? body.lineStart : null,
        lineEnd: typeof body.lineEnd === 'number' ? body.lineEnd : null
      })
    );
  };

  rss = async (req: Request, res: Response) => {
    const xml = await this.getProjectRssUseCase.execute(
      req.params.orgSlug,
      req.params.projectSlug
    );
    res.setHeader('Content-Type', 'application/rss+xml; charset=utf-8');
    res.setHeader('Cache-Control', 'public, max-age=300');
    res.send(xml);
  };
}
