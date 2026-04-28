import type { Request, Response } from 'express';
import type { CreateProjectDocInput, ProjectDocKind, UpdateProjectDocInput } from '@opentales/sdk';
import { prisma } from '../config/prisma.js';
import { HttpError } from '../http/HttpError.js';
import { ProjectDocUseCase } from '../useCases/projectDocs/ProjectDocUseCase.js';

export class ProjectDocController {
  private readonly useCase = new ProjectDocUseCase(prisma);

  list = async (req: Request, res: Response) => {
    res.json(
      await this.useCase.list(this.userId(req), req.params.projectId, {
        limit: parseOptionalInt(req.query.limit),
        offset: parseOptionalInt(req.query.offset),
        kind: typeof req.query.kind === 'string' ? (req.query.kind as ProjectDocKind) : undefined
      })
    );
  };

  create = async (req: Request, res: Response) => {
    res
      .status(201)
      .json(
        await this.useCase.create(
          this.userId(req),
          req.params.projectId,
          req.body as CreateProjectDocInput
        )
      );
  };

  get = async (req: Request, res: Response) => {
    res.json(await this.useCase.get(this.userId(req), req.params.projectId, req.params.docId));
  };

  update = async (req: Request, res: Response) => {
    res.json(
      await this.useCase.update(
        this.userId(req),
        req.params.projectId,
        req.params.docId,
        req.body as UpdateProjectDocInput
      )
    );
  };

  delete = async (req: Request, res: Response) => {
    res.json(await this.useCase.delete(this.userId(req), req.params.projectId, req.params.docId));
  };

  private userId(req: Request): string {
    if (!req.user) throw new HttpError(401, 'Authentication required');
    return req.user.id;
  }
}

function parseOptionalInt(value: unknown): number | undefined {
  if (typeof value !== 'string') return undefined;
  const parsed = Number(value);
  return Number.isInteger(parsed) ? parsed : undefined;
}
