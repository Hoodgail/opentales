import type { Request, Response } from 'express';
import type {
  AcceptWritingSuggestionInput, BranchFromNamedSnapshotInput, CompareNamedSnapshotsInput, CreateNamedSnapshotInput,
  CreateWritingAnnotationInput, ListWritingAnnotationsInput, NamedSnapshotScope, ReplyToWritingAnnotationInput,
  RestoreNamedSnapshotInput, UpdateWritingAnnotationStatusInput, WritingAnnotationKind, WritingAnnotationStatus
} from '@opentales/sdk';
import { prisma } from '../config/prisma.js';
import { HttpError } from '../http/HttpError.js';
import { NamedSnapshotUseCase } from '../useCases/revisions/NamedSnapshotUseCase.js';
import { WritingAnnotationUseCase } from '../useCases/revisions/WritingAnnotationUseCase.js';

export class RevisionController {
  private readonly snapshots = new NamedSnapshotUseCase(prisma);
  private readonly annotations = new WritingAnnotationUseCase(prisma);
  listSnapshots = async (req: Request, res: Response) => res.json(await this.snapshots.list(this.user(req), req.params.projectId, { scope: stringQuery(req.query.scope) as NamedSnapshotScope | undefined, includeDeleted: req.query.includeDeleted === 'true' }));
  createSnapshot = async (req: Request, res: Response) => res.status(201).json(await this.snapshots.create(this.user(req), req.params.projectId, req.body as CreateNamedSnapshotInput));
  getSnapshot = async (req: Request, res: Response) => res.json(await this.snapshots.get(this.user(req), req.params.projectId, req.params.snapshotId));
  deleteSnapshot = async (req: Request, res: Response) => res.json(await this.snapshots.delete(this.user(req), req.params.projectId, req.params.snapshotId));
  compareSnapshots = async (req: Request, res: Response) => res.json(await this.snapshots.compare(this.user(req), req.params.projectId, req.body as CompareNamedSnapshotsInput));
  restoreSnapshot = async (req: Request, res: Response) => res.json(await this.snapshots.restore(this.user(req), req.params.projectId, req.params.snapshotId, req.body as RestoreNamedSnapshotInput));
  branchSnapshot = async (req: Request, res: Response) => res.status(201).json(await this.snapshots.branch(this.user(req), req.params.projectId, req.params.snapshotId, req.body as BranchFromNamedSnapshotInput));
  listAnnotations = async (req: Request, res: Response) => { const input: ListWritingAnnotationsInput = { writingId: stringQuery(req.query.writingId), chapterId: stringQuery(req.query.chapterId), sceneId: stringQuery(req.query.sceneId), status: stringQuery(req.query.status) as WritingAnnotationStatus | undefined, kind: stringQuery(req.query.kind) as WritingAnnotationKind | undefined }; res.json(await this.annotations.list(this.user(req), req.params.projectId, input)); };
  createAnnotation = async (req: Request, res: Response) => res.status(201).json(await this.annotations.create(this.user(req), req.params.projectId, req.body as CreateWritingAnnotationInput));
  getAnnotation = async (req: Request, res: Response) => res.json(await this.annotations.get(this.user(req), req.params.projectId, req.params.threadId));
  replyAnnotation = async (req: Request, res: Response) => res.status(201).json(await this.annotations.reply(this.user(req), req.params.projectId, req.params.threadId, req.body as ReplyToWritingAnnotationInput));
  resolveAnnotation = async (req: Request, res: Response) => res.json(await this.annotations.resolve(this.user(req), req.params.projectId, req.params.threadId, req.body as UpdateWritingAnnotationStatusInput));
  reopenAnnotation = async (req: Request, res: Response) => res.json(await this.annotations.reopen(this.user(req), req.params.projectId, req.params.threadId, req.body as UpdateWritingAnnotationStatusInput));
  acceptSuggestion = async (req: Request, res: Response) => res.json(await this.annotations.accept(this.user(req), req.params.projectId, req.params.threadId, req.body as AcceptWritingSuggestionInput));
  rejectSuggestion = async (req: Request, res: Response) => res.json(await this.annotations.reject(this.user(req), req.params.projectId, req.params.threadId, req.body as UpdateWritingAnnotationStatusInput));
  private user(req: Request) { if (!req.user) throw new HttpError(401, 'Authentication required'); return req.user.id; }
}
function stringQuery(value: unknown): string | undefined { return typeof value === 'string' && value ? value : undefined; }
