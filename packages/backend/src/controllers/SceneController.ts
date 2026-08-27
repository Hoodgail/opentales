import type { Request, Response } from 'express';
import type { CreateSceneInput, DeleteSceneInput, ReorderScenesInput, UpdateSceneInput } from '@opentales/sdk';
import { prisma } from '../config/prisma.js';
import { HttpError } from '../http/HttpError.js';
import { SceneUseCase } from '../useCases/projects/SceneUseCase.js';

export class SceneController {
  private readonly scenes = new SceneUseCase(prisma);

  list = async (req: Request, res: Response) => {
    res.json(await this.scenes.list(this.userId(req), req.params.projectId, req.params.chapterId));
  };

  get = async (req: Request, res: Response) => {
    res.json(
      await this.scenes.get(
        this.userId(req),
        req.params.projectId,
        req.params.chapterId,
        req.params.sceneId
      )
    );
  };

  create = async (req: Request, res: Response) => {
    res.status(201).json(
      await this.scenes.create(
        this.userId(req),
        req.params.projectId,
        req.params.chapterId,
        req.body as CreateSceneInput
      )
    );
  };

  update = async (req: Request, res: Response) => {
    res.json(
      await this.scenes.update(
        this.userId(req),
        req.params.projectId,
        req.params.chapterId,
        req.params.sceneId,
        req.body as UpdateSceneInput
      )
    );
  };

  reorder = async (req: Request, res: Response) => {
    res.json(await this.scenes.reorder(
      this.userId(req), req.params.projectId, req.params.chapterId, req.body as ReorderScenesInput
    ));
  };

  delete = async (req: Request, res: Response) => {
    res.json(
      await this.scenes.delete(
        this.userId(req),
        req.params.projectId,
        req.params.chapterId,
        req.params.sceneId,
        req.body as DeleteSceneInput
      )
    );
  };

  private userId(req: Request): string {
    if (!req.user) throw new HttpError(401, 'Authentication required');
    return req.user.id;
  }
}
