import type { Request, Response } from 'express';
import type {
  ApproveBuildReviewInput,
  CompileBuildManuscriptInput,
  CreateBuildManuscriptUnitInput,
  CreateBuildReviewInput,
  MergeBuildReviewInput,
  PatchBuildManuscriptUnitInput,
  ReorderBuildManuscriptUnitsInput,
  RegisterBuildExportInput,
  RejectBuildReviewInput,
  UnpinBuildArtifactsInput
} from '@opentales/sdk';
import { prisma } from '../config/prisma.js';
import { HttpError } from '../http/HttpError.js';
import { BuildManuscriptUseCase } from '../useCases/novelBuild/BuildManuscriptUseCase.js';

export class BuildManuscriptController {
  private readonly useCase = new BuildManuscriptUseCase(prisma);

  listUnits = async (req: Request, res: Response) => {
    const kind = req.query.kind === 'chapter' || req.query.kind === 'scene' ? req.query.kind : undefined;
    const parentUnitId = typeof req.query.parentUnitId === 'string' ? req.query.parentUnitId || null : undefined;
    res.json(await this.useCase.list(this.userId(req), req.params.projectId, req.params.buildRunId, { kind, parentUnitId }));
  };

  getUnit = async (req: Request, res: Response) => {
    res.json(await this.useCase.get(this.userId(req), req.params.projectId, req.params.buildRunId, req.params.unitId));
  };

  createUnit = async (req: Request, res: Response) => {
    res.status(201).json(await this.useCase.create(
      this.userId(req), req.params.projectId, req.params.buildRunId, req.body as CreateBuildManuscriptUnitInput
    ));
  };

  patchUnit = async (req: Request, res: Response) => {
    res.json(await this.useCase.patch(
      this.userId(req), req.params.projectId, req.params.buildRunId, req.params.unitId,
      req.body as PatchBuildManuscriptUnitInput
    ));
  };

  reorderUnits = async (req: Request, res: Response) => {
    res.json(await this.useCase.reorder(
      this.userId(req), req.params.projectId, req.params.buildRunId, req.body as ReorderBuildManuscriptUnitsInput
    ));
  };

  compile = async (req: Request, res: Response) => {
    res.status(201).json(await this.useCase.compile(
      this.userId(req), req.params.projectId, req.params.buildRunId, req.body as CompileBuildManuscriptInput
    ));
  };

  getCompilation = async (req: Request, res: Response) => {
    res.json(await this.useCase.getCompilation(
      this.userId(req), req.params.projectId, req.params.buildRunId, req.params.compilationId
    ));
  };

  compare = async (req: Request, res: Response) => {
    res.json(await this.useCase.compare(this.userId(req), req.params.projectId, req.params.buildRunId));
  };

  listReviews = async (req: Request, res: Response) => {
    res.json(await this.useCase.listReviews(this.userId(req), req.params.projectId, req.params.buildRunId));
  };

  getReview = async (req: Request, res: Response) => {
    res.json(await this.useCase.getReview(
      this.userId(req), req.params.projectId, req.params.buildRunId, req.params.reviewId
    ));
  };

  createReview = async (req: Request, res: Response) => {
    res.status(201).json(await this.useCase.createReview(
      this.userId(req), req.params.projectId, req.params.buildRunId, req.body as CreateBuildReviewInput
    ));
  };

  approveReview = async (req: Request, res: Response) => {
    res.json(await this.useCase.approveReview(
      this.userId(req), req.params.projectId, req.params.buildRunId, req.params.reviewId,
      req.body as ApproveBuildReviewInput
    ));
  };

  mergeReview = async (req: Request, res: Response) => {
    res.json(await this.useCase.mergeReview(
      this.userId(req), req.params.projectId, req.params.buildRunId, req.params.reviewId,
      req.body as MergeBuildReviewInput
    ));
  };

  rejectReview = async (req: Request, res: Response) => {
    res.json(await this.useCase.rejectReview(
      this.userId(req), req.params.projectId, req.params.buildRunId, req.params.reviewId,
      req.body as RejectBuildReviewInput
    ));
  };

  registerExport = async (req: Request, res: Response) => {
    res.status(201).json(await this.useCase.registerExport(
      this.userId(req), req.params.projectId, req.params.buildRunId, req.body as RegisterBuildExportInput
    ));
  };

  unpin = async (req: Request, res: Response) => {
    res.json(await this.useCase.unpin(
      this.userId(req), req.params.projectId, req.params.buildRunId, req.body as UnpinBuildArtifactsInput
    ));
  };

  private userId(req: Request): string {
    if (!req.user) throw new HttpError(401, 'Authentication required');
    return req.user.id;
  }
}
