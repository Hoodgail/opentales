import { Prisma, type PrismaClient, type WritingAnnotationKind as PrismaAnnotationKind, type WritingAnnotationStatus as PrismaAnnotationStatus } from '@prisma/client';
import type {
  AcceptWritingSuggestionInput, CreateWritingAnnotationInput, ListWritingAnnotationsInput, ReplyToWritingAnnotationInput,
  UpdateWritingAnnotationStatusInput, WritingAnnotationReply, WritingAnnotationThread
} from '@opentales/sdk';
import { HttpError } from '../../http/HttpError.js';
import { ProjectAccessRepository } from '../../repositories/ProjectAccessRepository.js';
import { countWords } from '../../utils/wordCount.js';
import { stableHash } from '../novelBuild/schemas.js';

const include = { replies: { orderBy: { createdAt: 'asc' as const } } } satisfies Prisma.WritingAnnotationThreadInclude;
type Thread = Prisma.WritingAnnotationThreadGetPayload<{ include: typeof include }>;

export class WritingAnnotationUseCase {
  private readonly access: ProjectAccessRepository;
  constructor(private readonly prisma: PrismaClient) { this.access = new ProjectAccessRepository(prisma); }

  async list(userId: string, projectId: string, input: ListWritingAnnotationsInput = {}): Promise<WritingAnnotationThread[]> {
    await this.access.assertProjectAccess(userId, projectId);
    const rows = await this.prisma.writingAnnotationThread.findMany({
      where: { projectId, ...(input.writingId ? { writingId: input.writingId } : {}), ...(input.chapterId ? { chapterId: input.chapterId } : {}), ...(input.sceneId ? { sceneId: input.sceneId } : {}), ...(input.kind ? { kind: toKind(input.kind) } : {}), ...(input.status ? { status: toStatus(input.status) } : {}) },
      orderBy: [{ updatedAt: 'desc' }, { startOffset: 'asc' }], include
    });
    return rows.map(toThread);
  }

  async get(userId: string, projectId: string, threadId: string): Promise<WritingAnnotationThread> {
    await this.access.assertProjectAccess(userId, projectId); return toThread(await this.requireThread(projectId, threadId));
  }

  async create(userId: string, projectId: string, input: CreateWritingAnnotationInput): Promise<WritingAnnotationThread> {
    await this.access.assertPermission(userId, projectId, 'project:write'); validateKey(input.idempotencyKey);
    const requestHash = stableHash(input); const prior = await this.prisma.writingAnnotationThread.findUnique({ where: { projectId_idempotencyKey: { projectId, idempotencyKey: input.idempotencyKey } }, include });
    if (prior) { if (prior.requestHash !== requestHash) throw new HttpError(409, 'Annotation idempotency key was reused with different input'); return toThread(prior); }
    const body = text(input.body, 'Annotation body', 50_000); const quote = exactText(input.quote, 'Anchor quote', 4_000);
    const suggestedReplacement = input.kind === 'suggestion' ? exactText(input.suggestedReplacement, 'Suggested replacement', 100_000, true) : null;
    if (!Number.isInteger(input.start) || !Number.isInteger(input.end) || input.start < 0 || input.end < input.start) throw new HttpError(400, 'Annotation range is invalid');
    let row;
    try { row = await this.prisma.$transaction(async (tx) => {
      const branch = await tx.writingBranch.findFirst({ where: { id: input.branchId, writingId: input.writingId, writing: { projectId } } }); if (!branch) throw new HttpError(400, 'Annotation branch does not belong to this project writing');
      const version = await tx.writingVersion.findFirst({ where: { id: input.versionId, branchId: branch.id } }); if (!version) throw new HttpError(400, 'Annotation version does not belong to this branch');
      const versionBody = version.body ?? ''; if (input.end > versionBody.length || versionBody.slice(input.start, input.end) !== quote) throw new HttpError(409, 'Annotation quote does not match the immutable anchor version');
      await validateEntityNavigation(tx, projectId, input.writingId, input.chapterId, input.sceneId);
      const anchorHash = stableHash({ writingId: input.writingId, branchId: input.branchId, start: input.start, end: input.end, quote });
      if (input.anchorHash && input.anchorHash !== anchorHash) throw new HttpError(409, 'Annotation anchor hash is stale');
      return tx.writingAnnotationThread.create({ data: {
        projectId, writingId: input.writingId, branchId: input.branchId, anchorVersionId: input.versionId, authorId: userId,
        chapterId: input.chapterId ?? null, sceneId: input.sceneId ?? null, idempotencyKey: input.idempotencyKey, requestHash,
        kind: toKind(input.kind), startOffset: input.start, endOffset: input.end, quote, anchorHash, body, suggestedReplacement
      }, include });
    }); } catch (error) { if (!isUnique(error)) throw error; const replay = await this.prisma.writingAnnotationThread.findUnique({ where: { projectId_idempotencyKey: { projectId, idempotencyKey: input.idempotencyKey } }, include }); if (!replay || replay.requestHash !== requestHash) throw new HttpError(409, 'Annotation idempotency key was reused with different input'); row = replay; }
    return toThread(row);
  }

  async reply(userId: string, projectId: string, threadId: string, input: ReplyToWritingAnnotationInput): Promise<WritingAnnotationThread> {
    await this.access.assertPermission(userId, projectId, 'project:write'); validateKey(input.idempotencyKey); const body = text(input.body, 'Reply body', 50_000); const requestHash = stableHash(input);
    await this.prisma.$transaction(async (tx) => {
      const thread = await tx.writingAnnotationThread.findFirst({ where: { id: threadId, projectId } }); if (!thread) throw new HttpError(404, 'Annotation thread not found');
      const prior = await tx.writingAnnotationReply.findUnique({ where: { threadId_idempotencyKey: { threadId, idempotencyKey: input.idempotencyKey } } });
      if (prior) { if (prior.requestHash !== requestHash) throw new HttpError(409, 'Reply idempotency key was reused'); return; }
      await tx.writingAnnotationReply.create({ data: { threadId, authorId: userId, idempotencyKey: input.idempotencyKey, requestHash, body } });
      await tx.writingAnnotationThread.update({ where: { id: threadId }, data: { revision: { increment: 1 } } });
    }); return toThread(await this.requireThread(projectId, threadId));
  }

  resolve(userId: string, projectId: string, threadId: string, input: UpdateWritingAnnotationStatusInput) { return this.changeStatus(userId, projectId, threadId, input, 'RESOLVED'); }
  reopen(userId: string, projectId: string, threadId: string, input: UpdateWritingAnnotationStatusInput) { return this.changeStatus(userId, projectId, threadId, input, 'OPEN'); }
  reject(userId: string, projectId: string, threadId: string, input: UpdateWritingAnnotationStatusInput) { return this.changeStatus(userId, projectId, threadId, input, 'REJECTED', true); }

  async accept(userId: string, projectId: string, threadId: string, input: AcceptWritingSuggestionInput): Promise<WritingAnnotationThread> {
    await this.access.assertPermission(userId, projectId, 'project:write'); if (input.confirm !== true) throw new HttpError(400, 'Explicit suggestion acceptance is required'); validateKey(input.idempotencyKey); const requestHash = stableHash(input);
    await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "WritingAnnotationThread" WHERE id=${threadId} FOR UPDATE`;
      const thread = await tx.writingAnnotationThread.findFirst({ where: { id: threadId, projectId } }); if (!thread) throw new HttpError(404, 'Annotation thread not found');
      if (thread.status === 'ACCEPTED' && thread.decisionIdempotencyKey === input.idempotencyKey && thread.decisionRequestHash === requestHash) return;
      if (thread.kind !== 'SUGGESTION' || thread.status !== 'OPEN' || thread.suggestedReplacement === null) throw new HttpError(409, 'Only open suggestions can be accepted');
      if (thread.revision !== input.expectedRevision) throw new HttpError(409, 'Annotation revision is stale');
      await tx.$queryRaw`SELECT id FROM "WritingBranch" WHERE id=${thread.branchId} FOR UPDATE`;
      const branch = await tx.writingBranch.findFirst({ where: { id: thread.branchId, writingId: thread.writingId, writing: { projectId } } }); if (!branch) throw new HttpError(409, 'Annotation branch no longer exists');
      if (branch.headVersionId !== input.expectedHeadVersionId) throw new HttpError(409, 'Writing head changed; reload before accepting suggestion');
      const current = await tx.writingVersion.findUnique({ where: { id: branch.headVersionId! } }); const body = current?.body ?? '';
      if (thread.endOffset > body.length || body.slice(thread.startOffset, thread.endOffset) !== thread.quote || stableHash({ writingId: thread.writingId, branchId: thread.branchId, start: thread.startOffset, end: thread.endOffset, quote: thread.quote }) !== thread.anchorHash) throw new HttpError(409, 'Suggestion anchor is stale or changed');
      const nextBody = body.slice(0, thread.startOffset) + thread.suggestedReplacement + body.slice(thread.endOffset);
      const version = await tx.writingVersion.create({ data: { branchId: branch.id, parentVersionId: branch.headVersionId, body: nextBody, wordCount: countWords(nextBody), authorId: userId, message: `Accept suggestion ${thread.id}` } });
      const cas = await tx.writingBranch.updateMany({ where: { id: branch.id, headVersionId: input.expectedHeadVersionId }, data: { headVersionId: version.id } }); if (cas.count !== 1) throw new HttpError(409, 'Writing changed concurrently');
      if (thread.sceneId) await tx.scene.updateMany({ where: { id: thread.sceneId, bodyWritingId: thread.writingId, chapter: { projectId } }, data: { actualWordCount: countWords(nextBody), revision: { increment: 1 } } });
      await tx.writingAnnotationThread.update({ where: { id: thread.id }, data: { status: 'ACCEPTED', acceptedVersionId: version.id, resolvedById: userId, resolvedAt: new Date(), decisionIdempotencyKey: input.idempotencyKey, decisionRequestHash: requestHash, revision: { increment: 1 } } });
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    return toThread(await this.requireThread(projectId, threadId));
  }

  private async changeStatus(userId: string, projectId: string, threadId: string, input: UpdateWritingAnnotationStatusInput, status: 'OPEN' | 'RESOLVED' | 'REJECTED', suggestionOnly = false): Promise<WritingAnnotationThread> {
    await this.access.assertPermission(userId, projectId, 'project:write');
    const fromStatus = status === 'OPEN' ? 'RESOLVED' : 'OPEN';
    const updated = await this.prisma.writingAnnotationThread.updateMany({ where: { id: threadId, projectId, revision: input.expectedRevision, status: fromStatus, ...(suggestionOnly ? { kind: 'SUGGESTION' } : {}) }, data: { status, resolvedById: status === 'OPEN' ? null : userId, resolvedAt: status === 'OPEN' ? null : new Date(), revision: { increment: 1 } } });
    if (updated.count !== 1) throw new HttpError(409, 'Annotation revision is stale or transition is invalid'); return toThread(await this.requireThread(projectId, threadId));
  }
  private async requireThread(projectId: string, id: string): Promise<Thread> { const row = await this.prisma.writingAnnotationThread.findFirst({ where: { id, projectId }, include }); if (!row) throw new HttpError(404, 'Annotation thread not found'); return row; }
}

async function validateEntityNavigation(tx: Prisma.TransactionClient, projectId: string, writingId: string, chapterId?: string | null, sceneId?: string | null) {
  if (chapterId) { const chapter = await tx.chapter.findFirst({ where: { id: chapterId, projectId, bodyWritingId: writingId } }); if (!chapter) throw new HttpError(400, 'chapterId is not the annotated writing'); }
  if (sceneId) { const scene = await tx.scene.findFirst({ where: { id: sceneId, bodyWritingId: writingId, chapter: { projectId } } }); if (!scene) throw new HttpError(400, 'sceneId is not the annotated writing'); }
  if (chapterId && sceneId) throw new HttpError(400, 'Annotation cannot target both a chapter and scene');
}
function toThread(row: Thread): WritingAnnotationThread { return { id: row.id, projectId: row.projectId, writingId: row.writingId, branchId: row.branchId, anchorVersionId: row.anchorVersionId, authorId: row.authorId, resolvedById: row.resolvedById, acceptedVersionId: row.acceptedVersionId, chapterId: row.chapterId, sceneId: row.sceneId, kind: row.kind.toLowerCase() as WritingAnnotationThread['kind'], status: row.status.toLowerCase() as WritingAnnotationThread['status'], revision: row.revision, start: row.startOffset, end: row.endOffset, quote: row.quote, anchorHash: row.anchorHash, body: row.body, suggestedReplacement: row.suggestedReplacement, resolvedAt: row.resolvedAt?.toISOString() ?? null, createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString(), replies: row.replies.map(toReply) }; }
function toReply(row: Thread['replies'][number]): WritingAnnotationReply { return { id: row.id, threadId: row.threadId, authorId: row.authorId, body: row.body, createdAt: row.createdAt.toISOString() }; }
function toKind(value: CreateWritingAnnotationInput['kind']): PrismaAnnotationKind { return value.toUpperCase() as PrismaAnnotationKind; }
function toStatus(value: NonNullable<ListWritingAnnotationsInput['status']>): PrismaAnnotationStatus { return value.toUpperCase() as PrismaAnnotationStatus; }
function text(value: unknown, label: string, max: number) { if (typeof value !== 'string' || !value.trim()) throw new HttpError(400, `${label} is required`); if (value.trim().length > max) throw new HttpError(400, `${label} is too long`); return value.trim(); }
function exactText(value: unknown, label: string, max: number, allowEmpty = false) { if (typeof value !== 'string' || (!allowEmpty && !value)) throw new HttpError(400, `${label} is required`); if (value.length > max) throw new HttpError(400, `${label} is too long`); return value; }
function validateKey(value: unknown) { text(value, 'Idempotency key', 500); }
function isUnique(error: unknown) { return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002'; }
