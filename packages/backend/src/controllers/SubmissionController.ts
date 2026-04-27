import type { Request, Response } from 'express';
import type { CreateSubmissionInput, SubmissionStatus } from '@opentales/sdk';
import { prisma } from '../config/prisma.js';
import { HttpError } from '../http/HttpError.js';
import { CreateSubmissionUseCase } from '../useCases/submissions/CreateSubmissionUseCase.js';
import { ListSubmissionsUseCase } from '../useCases/submissions/ListSubmissionsUseCase.js';
import { GetSubmissionUseCase } from '../useCases/submissions/GetSubmissionUseCase.js';
import { MergeSubmissionUseCase } from '../useCases/submissions/MergeSubmissionUseCase.js';
import { DeclineSubmissionUseCase } from '../useCases/submissions/DeclineSubmissionUseCase.js';
import { AddCommentUseCase } from '../useCases/submissions/AddCommentUseCase.js';

const STATUSES: ReadonlySet<SubmissionStatus> = new Set(['open', 'merged', 'declined']);

export class SubmissionController {
  private readonly createUseCase = new CreateSubmissionUseCase(prisma);
  private readonly listUseCase = new ListSubmissionsUseCase(prisma);
  private readonly getUseCase = new GetSubmissionUseCase(prisma);
  private readonly mergeUseCase = new MergeSubmissionUseCase(prisma);
  private readonly declineUseCase = new DeclineSubmissionUseCase(prisma);
  private readonly addCommentUseCase = new AddCommentUseCase(prisma);

  create = async (req: Request, res: Response) => {
    const body = req.body as Partial<CreateSubmissionInput>;
    if (body.kind !== 'chapter-edit' && body.kind !== 'new-chapter') {
      throw new HttpError(400, 'Submission kind must be chapter-edit or new-chapter');
    }
    if (typeof body.title !== 'string') throw new HttpError(400, 'title is required');
    if (typeof body.body !== 'string') throw new HttpError(400, 'body is required');

    res
      .status(201)
      .json(
        await this.createUseCase.execute(this.userId(req), req.params.projectId, {
          kind: body.kind,
          title: body.title,
          message: body.message,
          chapterId: body.chapterId,
          body: body.body,
          proposedTitle: body.proposedTitle,
          proposedNumber: body.proposedNumber,
          proposedActId: body.proposedActId
        })
      );
  };

  list = async (req: Request, res: Response) => {
    const status =
      typeof req.query.status === 'string' && STATUSES.has(req.query.status as SubmissionStatus)
        ? (req.query.status as SubmissionStatus)
        : undefined;
    res.json(
      await this.listUseCase.execute(this.userId(req), req.params.projectId, { status })
    );
  };

  get = async (req: Request, res: Response) => {
    res.json(await this.getUseCase.execute(this.userId(req), req.params.submissionId));
  };

  merge = async (req: Request, res: Response) => {
    res.json(await this.mergeUseCase.execute(this.userId(req), req.params.submissionId));
  };

  decline = async (req: Request, res: Response) => {
    res.json(await this.declineUseCase.execute(this.userId(req), req.params.submissionId));
  };

  comment = async (req: Request, res: Response) => {
    const body = typeof req.body?.body === 'string' ? req.body.body : '';
    const anchor =
      req.body && typeof req.body.anchor === 'object' && req.body.anchor !== null
        ? req.body.anchor
        : undefined;
    res.json(
      await this.addCommentUseCase.execute(this.userId(req), req.params.submissionId, {
        body,
        anchor
      })
    );
  };

  private userId(req: Request): string {
    if (!req.user) throw new HttpError(401, 'Authentication required');
    return req.user.id;
  }
}
