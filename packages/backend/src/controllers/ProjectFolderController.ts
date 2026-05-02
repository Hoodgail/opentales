import type { Request, Response } from 'express';
import type { CreateProjectFolderInput, UpdateProjectFolderInput } from '@opentales/sdk';
import { prisma } from '../config/prisma.js';
import { HttpError } from '../http/HttpError.js';
import { ProjectFolderUseCase } from '../useCases/projectFiles/ProjectFolderUseCase.js';

export class ProjectFolderController {
  private readonly useCase = new ProjectFolderUseCase(prisma);

  tree = async (req: Request, res: Response) => {
    res.json(await this.useCase.tree(this.userId(req), req.params.projectId));
  };

  create = async (req: Request, res: Response) => {
    res.status(201).json(await this.useCase.create(this.userId(req), req.params.projectId, req.body as CreateProjectFolderInput));
  };

  update = async (req: Request, res: Response) => {
    res.json(await this.useCase.update(this.userId(req), req.params.projectId, req.params.folderId, req.body as UpdateProjectFolderInput));
  };

  delete = async (req: Request, res: Response) => {
    res.json(await this.useCase.delete(this.userId(req), req.params.projectId, req.params.folderId));
  };

  private userId(req: Request): string {
    if (!req.user) throw new HttpError(401, 'Authentication required');
    return req.user.id;
  }
}
