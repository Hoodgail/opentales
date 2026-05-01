import type { Request, Response } from 'express';
import type {
  CollaborationDocumentRef,
  CollaborationEditInput,
  CollaborationLeaveInput,
  CollaborationPresenceInput
} from '@opentales/sdk';
import { prisma } from '../config/prisma.js';
import { HttpError } from '../http/HttpError.js';
import { CollaborationUseCase } from '../useCases/collaboration/CollaborationUseCase.js';

export class CollaborationController {
  private readonly useCase = new CollaborationUseCase(prisma);

  snapshot = async (req: Request, res: Response) => {
    res.json(await this.useCase.snapshot(this.userId(req), req.params.projectId, this.ref(req)));
  };

  events = async (req: Request, res: Response) => {
    await this.useCase.subscribe(
      this.userId(req),
      req.params.projectId,
      this.ref(req),
      typeof req.query.clientId === 'string' ? req.query.clientId : '',
      res
    );
  };

  projectEvents = async (req: Request, res: Response) => {
    await this.useCase.subscribeProject(this.userId(req), req.params.projectId, res);
  };

  leave = async (req: Request, res: Response) => {
    res.json(
      await this.useCase.leaveProject(
        this.userId(req),
        req.params.projectId,
        req.body as CollaborationLeaveInput
      )
    );
  };

  edit = async (req: Request, res: Response) => {
    res.json(
      await this.useCase.applyEdit(
        this.userId(req),
        req.params.projectId,
        this.ref(req),
        req.body as CollaborationEditInput
      )
    );
  };

  presence = async (req: Request, res: Response) => {
    res.json(
      await this.useCase.updatePresence(
        this.userId(req),
        req.params.projectId,
        this.ref(req),
        req.body as CollaborationPresenceInput
      )
    );
  };

  private ref(req: Request): CollaborationDocumentRef {
    return {
      kind: req.params.kind as CollaborationDocumentRef['kind'],
      entityId: req.params.entityId,
      field: req.params.field
    };
  }

  private userId(req: Request): string {
    if (!req.user) throw new HttpError(401, 'Authentication required');
    return req.user.id;
  }
}
