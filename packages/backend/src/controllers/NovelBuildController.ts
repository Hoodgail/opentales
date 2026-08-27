import type { Request, Response } from 'express';
import type {
  ApplyStoryArtifactBatchInput,
  ApplyStoryStateBatchInput,
  AuthorizeBuildRunInput,
  BranchBuildFromCheckpointInput,
  BuildLifecycleInput,
  CreateBuildCheckpointInput,
  CreateBuildRunInput,
  FindStoryReferencesInput,
  ListStoryArtifactsInput,
  ReplanBuildInput,
  SearchStoryInput,
  StoryArtifactStatus,
  StoryArtifactType
  ,StoryStateEntityKind
  ,TemporalStoryStateQuery
} from '@opentales/sdk';
import { prisma } from '../config/prisma.js';
import { HttpError } from '../http/HttpError.js';
import { NovelBuildUseCase } from '../useCases/novelBuild/NovelBuildUseCase.js';
import { StoryStateUseCase } from '../useCases/novelBuild/StoryStateUseCase.js';

export class NovelBuildController {
  private readonly builds = new NovelBuildUseCase(prisma);
  private readonly story = new StoryStateUseCase(prisma);

  list = async (req: Request, res: Response) => {
    res.json(await this.builds.list(this.userId(req), req.params.projectId));
  };

  create = async (req: Request, res: Response) => {
    res.status(201).json(await this.builds.create(this.userId(req), req.params.projectId, req.body as CreateBuildRunInput));
  };

  get = async (req: Request, res: Response) => {
    res.json(await this.builds.get(this.userId(req), req.params.projectId, req.params.buildRunId));
  };

  authorize = async (req: Request, res: Response) => {
    res.json(await this.builds.authorize(this.userId(req), req.params.projectId, req.params.buildRunId, req.body as AuthorizeBuildRunInput));
  };

  pause = async (req: Request, res: Response) => {
    res.json(await this.builds.pause(this.userId(req), req.params.projectId, req.params.buildRunId, req.body as BuildLifecycleInput));
  };

  resume = async (req: Request, res: Response) => {
    res.json(await this.builds.resume(this.userId(req), req.params.projectId, req.params.buildRunId, req.body as BuildLifecycleInput));
  };

  cancel = async (req: Request, res: Response) => {
    res.json(await this.builds.cancel(this.userId(req), req.params.projectId, req.params.buildRunId, req.body as BuildLifecycleInput));
  };

  retry = async (req: Request, res: Response) => {
    res.json(await this.builds.retry(this.userId(req), req.params.projectId, req.params.buildRunId, req.params.taskId, req.body as BuildLifecycleInput));
  };

  rerun = async (req: Request, res: Response) => {
    res.json(await this.builds.rerun(this.userId(req), req.params.projectId, req.params.buildRunId, req.params.taskId, req.body as BuildLifecycleInput));
  };

  replan = async (req: Request, res: Response) => {
    res.json(await this.builds.replan(
      this.userId(req), req.params.projectId, req.params.buildRunId, req.body as ReplanBuildInput
    ));
  };

  branchFromCheckpoint = async (req: Request, res: Response) => {
    res.json(await this.builds.branchFromCheckpoint(
      this.userId(req), req.params.projectId, req.params.buildRunId, req.body as BranchBuildFromCheckpointInput
    ));
  };

  createCheckpoint = async (req: Request, res: Response) => {
    res.status(201).json(await this.builds.createCheckpoint(this.userId(req), req.params.projectId, req.params.buildRunId, req.body as CreateBuildCheckpointInput));
  };

  listArtifacts = async (req: Request, res: Response) => {
    const input: ListStoryArtifactsInput = {
      types: queryStrings(req.query.types) as StoryArtifactType[] | undefined,
      statuses: queryStrings(req.query.statuses) as StoryArtifactStatus[] | undefined,
      taskId: queryString(req.query.taskId),
      limit: queryInt(req.query.limit),
      offset: queryInt(req.query.offset)
    };
    res.json(await this.story.listArtifacts(this.userId(req), req.params.projectId, req.params.buildRunId, input));
  };

  artifactBatch = async (req: Request, res: Response) => {
    res.json(await this.story.applyArtifactBatch(
      this.userId(req), req.params.projectId, req.params.buildRunId,
      req.body as ApplyStoryArtifactBatchInput,
      { allowTaskBinding: false }
    ));
  };

  getState = async (req: Request, res: Response) => {
    res.json(await this.story.getState(this.userId(req), req.params.projectId, req.params.buildRunId));
  };

  stateDelta = async (req: Request, res: Response) => {
    res.json(await this.story.getStateDelta(this.userId(req), req.params.projectId, req.params.buildRunId, {
      sinceUpdatedAt: queryString(req.query.sinceUpdatedAt), limit: queryInt(req.query.limit), offset: queryInt(req.query.offset)
    }));
  };

  stateHistory = async (req: Request, res: Response) => {
    res.json(await this.story.getStateHistory(
      this.userId(req), req.params.projectId, req.params.buildRunId,
      req.params.entityKind as StoryStateEntityKind, req.params.key
    ));
  };

  temporalState = async (req: Request, res: Response) => {
    res.json(await this.story.temporalState(
      this.userId(req), req.params.projectId, req.params.buildRunId, req.body as TemporalStoryStateQuery
    ));
  };

  stateBatch = async (req: Request, res: Response) => {
    res.json(await this.story.applyStateBatch(this.userId(req), req.params.projectId, req.params.buildRunId, req.body as ApplyStoryStateBatchInput));
  };

  observability = async (req: Request, res: Response) => {
    res.json(await this.story.observability(this.userId(req), req.params.projectId, req.params.buildRunId, {
      taskId: queryString(req.query.taskId), limit: queryInt(req.query.limit), offset: queryInt(req.query.offset)
    }));
  };

  search = async (req: Request, res: Response) => {
    res.json(await this.story.search(this.userId(req), req.params.projectId, req.params.buildRunId, req.body as SearchStoryInput));
  };

  references = async (req: Request, res: Response) => {
    res.json(await this.story.findReferences(this.userId(req), req.params.projectId, req.params.buildRunId, req.body as FindStoryReferencesInput));
  };

  diagnostics = async (req: Request, res: Response) => {
    res.json(await this.story.diagnostics(this.userId(req), req.params.projectId, req.params.buildRunId));
  };

  private userId(req: Request): string {
    if (!req.user) throw new HttpError(401, 'Authentication required');
    return req.user.id;
  }
}

function queryString(value: unknown): string | undefined {
  return typeof value === 'string' && value ? value : undefined;
}

function queryStrings(value: unknown): string[] | undefined {
  if (Array.isArray(value)) return value.filter((item): item is string => typeof item === 'string');
  if (typeof value === 'string' && value) return value.split(',').filter(Boolean);
  return undefined;
}

function queryInt(value: unknown): number | undefined {
  if (typeof value !== 'string') return undefined;
  const parsed = Number(value);
  if (!Number.isInteger(parsed)) throw new HttpError(400, 'Pagination values must be integers');
  return parsed;
}
