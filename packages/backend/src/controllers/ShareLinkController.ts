import type { Request, Response } from 'express';
import type {
  CreateBetaShareLinkInput,
  UpdateBetaShareLinkInput
} from '@opentales/sdk';
import { prisma } from '../config/prisma.js';
import { HttpError } from '../http/HttpError.js';
import { CreateBetaShareLinkUseCase } from '../useCases/shareLinks/CreateBetaShareLinkUseCase.js';
import { ListBetaShareLinksUseCase } from '../useCases/shareLinks/ListBetaShareLinksUseCase.js';
import { RevokeBetaShareLinkUseCase } from '../useCases/shareLinks/RevokeBetaShareLinkUseCase.js';
import { UpdateBetaShareLinkUseCase } from '../useCases/shareLinks/UpdateBetaShareLinkUseCase.js';

export class ShareLinkController {
  private readonly createUseCase = new CreateBetaShareLinkUseCase(prisma);
  private readonly listUseCase = new ListBetaShareLinksUseCase(prisma);
  private readonly updateUseCase = new UpdateBetaShareLinkUseCase(prisma);
  private readonly revokeUseCase = new RevokeBetaShareLinkUseCase(prisma);

  list = async (req: Request, res: Response) => {
    res.json(await this.listUseCase.execute(this.userId(req), req.params.projectId));
  };

  create = async (req: Request, res: Response) => {
    const body = (req.body ?? {}) as CreateBetaShareLinkInput;
    res
      .status(201)
      .json(
        await this.createUseCase.execute(this.userId(req), req.params.projectId, {
          label: typeof body.label === 'string' ? body.label : undefined,
          allowComments:
            typeof body.allowComments === 'boolean' ? body.allowComments : undefined,
          expiresAt:
            typeof body.expiresAt === 'string' || body.expiresAt === null
              ? body.expiresAt
              : undefined,
          chapterIds: Array.isArray(body.chapterIds) ? body.chapterIds : undefined
        })
      );
  };

  update = async (req: Request, res: Response) => {
    const body = (req.body ?? {}) as UpdateBetaShareLinkInput;
    res.json(
      await this.updateUseCase.execute(
        this.userId(req),
        req.params.projectId,
        req.params.shareLinkId,
        {
          label:
            typeof body.label === 'string' || body.label === null ? body.label : undefined,
          allowComments:
            typeof body.allowComments === 'boolean' ? body.allowComments : undefined,
          expiresAt:
            typeof body.expiresAt === 'string' || body.expiresAt === null
              ? body.expiresAt
              : undefined,
          chapterIds: Array.isArray(body.chapterIds) ? body.chapterIds : undefined
        }
      )
    );
  };

  revoke = async (req: Request, res: Response) => {
    res.json(
      await this.revokeUseCase.execute(
        this.userId(req),
        req.params.projectId,
        req.params.shareLinkId
      )
    );
  };

  private userId(req: Request): string {
    if (!req.user) throw new HttpError(401, 'Authentication required');
    return req.user.id;
  }
}
