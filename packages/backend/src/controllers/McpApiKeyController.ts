import type { Request, Response } from 'express';
import type { CreateProjectMcpApiKeyInput } from '@opentales/sdk';
import { prisma } from '../config/prisma.js';
import { HttpError } from '../http/HttpError.js';
import { ProjectMcpApiKeysUseCase } from '../useCases/ai/ProjectMcpApiKeysUseCase.js';

export class McpApiKeyController {
  private readonly useCase = new ProjectMcpApiKeysUseCase(prisma);

  list = async (req: Request, res: Response) => {
    res.json(await this.useCase.list(this.userId(req), req.params.projectId));
  };

  create = async (req: Request, res: Response) => {
    res.status(201).json(await this.useCase.create(
      this.userId(req),
      req.params.projectId,
      req.body as CreateProjectMcpApiKeyInput
    ));
  };

  revoke = async (req: Request, res: Response) => {
    res.json(await this.useCase.revoke(
      this.userId(req),
      req.params.projectId,
      req.params.keyId
    ));
  };

  private userId(req: Request): string {
    if (!req.user) throw new HttpError(401, 'Authentication required');
    return req.user.id;
  }
}
