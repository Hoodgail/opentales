import { Prisma, type ChapterStatus, type NamedSnapshotScope as PrismaNamedSnapshotScope, type PrismaClient, type SceneStatus } from '@prisma/client';
import type {
  BranchFromNamedSnapshotInput, BranchFromNamedSnapshotResult, CompareNamedSnapshotsInput, CreateNamedSnapshotInput,
  JsonObject, JsonValue, NamedSnapshot, NamedSnapshotComparison, RestoreNamedSnapshotInput, RestoreNamedSnapshotResult,
  SnapshotLineChange, SnapshotListFilter, SnapshotProseDiff, SnapshotSemanticChange, SnapshotWritingHead
} from '@opentales/sdk';
import { HttpError } from '../../http/HttpError.js';
import { ProjectAccessRepository } from '../../repositories/ProjectAccessRepository.js';
import { countWords } from '../../utils/wordCount.js';
import { retryTransactionConflict } from '../../utils/prismaTransaction.js';
import { stableHash } from '../novelBuild/schemas.js';

const MAX_SNAPSHOT_BYTES = 10_000_000;
const MAX_HEADS = 5_000;
type Db = PrismaClient | Prisma.TransactionClient;

export class NamedSnapshotUseCase {
  private readonly access: ProjectAccessRepository;
  constructor(private readonly prisma: PrismaClient) { this.access = new ProjectAccessRepository(prisma); }

  async list(userId: string, projectId: string, filter: SnapshotListFilter = {}): Promise<NamedSnapshot[]> {
    await this.access.assertProjectAccess(userId, projectId);
    const rows = await this.prisma.namedSnapshot.findMany({
      where: { projectId, ...(filter.scope ? { scope: toScope(filter.scope) } : {}), ...(filter.includeDeleted ? {} : { deletedAt: null }) },
      orderBy: { createdAt: 'desc' }
    });
    return rows.map(toSnapshot);
  }

  async get(userId: string, projectId: string, snapshotId: string): Promise<NamedSnapshot> {
    await this.access.assertProjectAccess(userId, projectId);
    return toSnapshot(await this.requireSnapshot(this.prisma, projectId, snapshotId));
  }

  async create(userId: string, projectId: string, input: CreateNamedSnapshotInput): Promise<NamedSnapshot> {
    await this.access.assertPermission(userId, projectId, 'project:write');
    validateKey(input.idempotencyKey); const label = text(input.label, 'Snapshot label', 500); const message = optionalText(input.message, 20_000);
    const requestHash = stableHash(input);
    const existing = await this.prisma.namedSnapshot.findUnique({ where: { projectId_idempotencyKey: { projectId, idempotencyKey: input.idempotencyKey } } });
    if (existing) { if (existing.requestHash !== requestHash) throw new HttpError(409, 'Snapshot idempotency key was reused with different input'); return toSnapshot(existing); }
    let result;
    try { result = await retryTransactionConflict(() => this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "Project" WHERE id=${projectId} FOR SHARE`;
      const heads = await this.captureHeads(tx, projectId, input);
      if (!heads.length) throw new HttpError(409, 'Snapshot scope contains no writing heads');
      if (heads.length > MAX_HEADS) throw new HttpError(413, `Snapshot exceeds ${MAX_HEADS} writing heads`);
      const structuredState = await this.captureStructuredState(tx, projectId, input, heads);
      const payload = { heads, structuredState };
      const serialized = JSON.stringify(payload); const sizeBytes = Buffer.byteLength(serialized);
      if (sizeBytes > MAX_SNAPSHOT_BYTES) throw new HttpError(413, 'Snapshot exceeds the 10 MB metadata limit');
      return tx.namedSnapshot.create({ data: {
        projectId, createdById: userId, idempotencyKey: input.idempotencyKey, requestHash, label, message,
        scope: toScope(input.scope), chapterId: input.chapterId ?? null, sceneId: input.sceneId ?? null,
        projectDocId: input.projectDocId ?? null, writingId: input.writingId ?? null, buildRunId: input.buildRunId ?? null,
        checkpointId: input.checkpointId ?? null, compilationId: input.compilationId ?? null,
        heads: json(heads), structuredState: json(structuredState), contentHash: stableHash(payload), sizeBytes
      } });
    }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead })); }
    catch (error) { if (!isUnique(error)) throw error; const replay = await this.prisma.namedSnapshot.findUnique({ where: { projectId_idempotencyKey: { projectId, idempotencyKey: input.idempotencyKey } } }); if (!replay || replay.requestHash !== requestHash) throw new HttpError(409, 'Snapshot idempotency key was reused with different input'); result = replay; }
    return toSnapshot(result);
  }

  async delete(userId: string, projectId: string, snapshotId: string): Promise<NamedSnapshot> {
    await this.access.assertPermission(userId, projectId, 'project:write');
    const row = await this.requireSnapshot(this.prisma, projectId, snapshotId);
    if (row.deletedAt) return toSnapshot(row);
    return toSnapshot(await this.prisma.namedSnapshot.update({ where: { id: row.id }, data: { deletedAt: new Date() } }));
  }

  async compare(userId: string, projectId: string, input: CompareNamedSnapshotsInput): Promise<NamedSnapshotComparison> {
    await this.access.assertProjectAccess(userId, projectId);
    const left = await this.requireSnapshot(this.prisma, projectId, input.leftSnapshotId);
    const leftHeads = snapshotHeads(left.heads);
    const right = input.rightSnapshotId ? await this.requireSnapshot(this.prisma, projectId, input.rightSnapshotId) : null;
    const rightHeads = right ? snapshotHeads(right.heads) : await this.currentHeads(projectId, leftHeads);
    const versions = await this.prisma.writingVersion.findMany({ where: { id: { in: [...new Set([...leftHeads, ...rightHeads].map((head) => head.versionId))] } }, select: { id: true, body: true } });
    const bodies = new Map(versions.map((version) => [version.id, version.body ?? '']));
    const allWritings = [...new Set([...leftHeads, ...rightHeads].map((head) => head.writingId))];
    const prose: SnapshotProseDiff[] = allWritings.map((writingId) => {
      const l = leftHeads.find((head) => head.writingId === writingId) ?? null; const r = rightHeads.find((head) => head.writingId === writingId) ?? null;
      const leftBody = l ? bodies.get(l.versionId) ?? '' : ''; const rightBody = r ? bodies.get(r.versionId) ?? '' : '';
      return { writingId, entityType: l?.entityType ?? r?.entityType ?? 'writing', entityId: l?.entityId ?? r?.entityId ?? writingId,
        leftVersionId: l?.versionId ?? null, rightVersionId: r?.versionId ?? null, leftWordCount: countWords(leftBody), rightWordCount: countWords(rightBody),
        wordDelta: countWords(rightBody) - countWords(leftBody), changes: lineChanges(leftBody, rightBody) };
    });
    const rightState = right ? right.structuredState as JsonValue : await this.captureCurrentStateForSnapshot(projectId, left);
    return { leftSnapshotId: left.id, rightSnapshotId: right?.id ?? null, prose, semantic: semanticChanges(left.structuredState as JsonValue, rightState) };
  }

  async restore(userId: string, projectId: string, snapshotId: string, input: RestoreNamedSnapshotInput): Promise<RestoreNamedSnapshotResult> {
    await this.access.assertPermission(userId, projectId, 'project:write');
    if (input.confirm !== true) throw new HttpError(400, 'Explicit restore confirmation is required'); validateKey(input.idempotencyKey);
    const requestHash = stableHash(input);
    return retryTransactionConflict(() => this.prisma.$transaction(async (tx) => {
      const snapshot = await this.requireSnapshot(tx, projectId, snapshotId);
      if (snapshot.deletedAt) throw new HttpError(409, 'Deleted snapshots cannot be restored');
      const replay = await tx.snapshotOperationReceipt.findUnique({ where: { snapshotId_idempotencyKey: { snapshotId, idempotencyKey: input.idempotencyKey } } });
      if (replay) { if (replay.requestHash !== requestHash || replay.operation !== 'restore') throw new HttpError(409, 'Snapshot operation idempotency conflict'); return replay.result as unknown as RestoreNamedSnapshotResult; }
      const restoredVersionIds: Record<string, string> = {};
      await tx.$queryRaw`SELECT id FROM "Project" WHERE id=${projectId} FOR UPDATE`;
      for (const head of snapshotHeads(snapshot.heads)) {
        const branch = await tx.writingBranch.findFirst({ where: { id: head.branchId, writingId: head.writingId, writing: { projectId } } });
        if (!branch) throw new HttpError(409, `Snapshot branch for writing '${head.writingId}' no longer exists`);
        if (!(head.writingId in input.expectedHeads) || input.expectedHeads[head.writingId] !== branch.headVersionId) throw new HttpError(409, `Writing '${head.writingId}' changed; reload before restore`);
        const source = await tx.writingVersion.findFirst({ where: { id: head.versionId, branch: { writingId: head.writingId } }, select: { body: true } });
        if (!source) throw new HttpError(409, `Snapshot version '${head.versionId}' is unavailable`);
        const version = await tx.writingVersion.create({ data: { branchId: branch.id, parentVersionId: branch.headVersionId, body: source.body ?? '', wordCount: countWords(source.body ?? ''), authorId: userId, message: `Restore snapshot: ${snapshot.label}` } });
        const cas = await tx.writingBranch.updateMany({ where: { id: branch.id, headVersionId: branch.headVersionId }, data: { headVersionId: version.id } });
        if (cas.count !== 1) throw new HttpError(409, `Writing '${head.writingId}' changed concurrently`);
        restoredVersionIds[head.writingId] = version.id;
      }
      await restoreStructuredState(tx, projectId, snapshot.structuredState as JsonValue, input.expectedEntityRevisions ?? {});
      const result: RestoreNamedSnapshotResult = { snapshotId, restoredVersionIds, restoredAt: new Date().toISOString() };
      await tx.snapshotOperationReceipt.create({ data: { snapshotId, idempotencyKey: input.idempotencyKey, requestHash, operation: 'restore', result: json(result) } });
      return result;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }));
  }

  async branch(userId: string, projectId: string, snapshotId: string, input: BranchFromNamedSnapshotInput): Promise<BranchFromNamedSnapshotResult> {
    await this.access.assertPermission(userId, projectId, 'project:write'); validateKey(input.idempotencyKey); const name = text(input.name, 'Branch name', 500); const requestHash = stableHash(input);
    return this.prisma.$transaction(async (tx) => {
      const snapshot = await this.requireSnapshot(tx, projectId, snapshotId); if (snapshot.deletedAt) throw new HttpError(409, 'Deleted snapshots cannot be branched');
      const replay = await tx.snapshotOperationReceipt.findUnique({ where: { snapshotId_idempotencyKey: { snapshotId, idempotencyKey: input.idempotencyKey } } });
      if (replay) { if (replay.requestHash !== requestHash || replay.operation !== 'branch') throw new HttpError(409, 'Snapshot operation idempotency conflict'); return replay.result as unknown as BranchFromNamedSnapshotResult; }
      const branches = [];
      for (const head of snapshotHeads(snapshot.heads)) {
        const writing = await tx.writing.findFirst({ where: { id: head.writingId, projectId }, select: { id: true } }); if (!writing) throw new HttpError(409, 'Snapshot writing no longer exists');
        const existing = await tx.writingBranch.findUnique({ where: { writingId_name: { writingId: head.writingId, name } } });
        if (existing) throw new HttpError(409, `Branch '${name}' already exists for a snapshot writing`);
        const created = await tx.writingBranch.create({ data: { writingId: head.writingId, name, parentBranchId: head.branchId, headVersionId: head.versionId } });
        branches.push({ writingId: head.writingId, branchId: created.id, name, headVersionId: head.versionId });
      }
      const result: BranchFromNamedSnapshotResult = { snapshotId, branches };
      await tx.snapshotOperationReceipt.create({ data: { snapshotId, idempotencyKey: input.idempotencyKey, requestHash, operation: 'branch', result: json(result) } }); return result;
    });
  }

  private async captureHeads(db: Db, projectId: string, input: CreateNamedSnapshotInput): Promise<SnapshotWritingHead[]> {
    if (input.scope === 'build-compilation') {
      if (!input.buildRunId || !input.compilationId) throw new HttpError(400, 'Build compilation snapshot requires buildRunId and compilationId');
      const compilation = await db.buildCompilation.findFirst({ where: { id: input.compilationId, projectId, buildRunId: input.buildRunId }, include: { units: { include: { unit: true, writingVersion: true } } } });
      if (!compilation) throw new HttpError(404, 'Build compilation not found');
      return compilation.units.map((row) => head(row.unit.kind.toLowerCase(), row.unit.id, row.unit.writingId, row.unit.branchId, row.writingVersionId, row.writingVersion.body ?? ''));
    }
    if (input.scope === 'build-checkpoint') {
      if (!input.buildRunId || !input.checkpointId) throw new HttpError(400, 'Build checkpoint snapshot requires buildRunId and checkpointId');
      const checkpoint = await db.buildCheckpoint.findFirst({ where: { id: input.checkpointId, projectId, buildRunId: input.buildRunId } }); if (!checkpoint) throw new HttpError(404, 'Build checkpoint not found');
      const state = object(checkpoint.stateSnapshot); const raw = Array.isArray(state.writingBranches) ? state.writingBranches.map(object) : [];
      const branchIds = raw.flatMap((value) => typeof value.id === 'string' ? [value.id] : []);
      const branches = await db.writingBranch.findMany({ where: { id: { in: branchIds }, writing: { projectId } }, include: { writing: true } });
      const versions = await db.writingVersion.findMany({ where: { id: { in: raw.flatMap((value) => typeof value.headVersionId === 'string' ? [value.headVersionId] : []) } } });
      return raw.flatMap((value) => { const branch = branches.find((item) => item.id === value.id); const version = versions.find((item) => item.id === value.headVersionId); return branch && version ? [head('writing', branch.writingId, branch.writingId, branch.id, version.id, version.body ?? '')] : []; });
    }
    const where: Prisma.WritingWhereInput = { projectId };
    if (input.scope === 'writing') where.id = requiredId(input.writingId, 'writingId');
    if (input.scope === 'project-doc') where.projectDocs = { some: { id: requiredId(input.projectDocId, 'projectDocId'), projectId } };
    if (input.scope === 'scene') where.sceneBodies = { some: { id: requiredId(input.sceneId, 'sceneId'), chapter: { projectId } } };
    if (input.scope === 'chapter') where.OR = [{ chapterBodies: { some: { id: requiredId(input.chapterId, 'chapterId'), projectId } } }, { sceneBodies: { some: { chapterId: requiredId(input.chapterId, 'chapterId') } } }];
    const writings = await db.writing.findMany({ where, include: {
      defaultBranch: { include: { headVersion: true } }, chapterBodies: { select: { id: true } }, sceneBodies: { select: { id: true } }, projectDocs: { select: { id: true } },
      storyLoglineStructure: { select: { id: true } }, storyOutlineStructure: { select: { id: true } }, storyClimaxStructure: { select: { id: true } }
    } });
    return writings.flatMap((writing) => writing.defaultBranch?.headVersion ? [head(entity(writing), entityId(writing, writing.id), writing.id, writing.defaultBranch.id, writing.defaultBranch.headVersion.id, writing.defaultBranch.headVersion.body ?? '')] : []);
  }

  private async captureStructuredState(db: Db, projectId: string, input: CreateNamedSnapshotInput, heads: SnapshotWritingHead[]): Promise<JsonValue> {
    const [project, chapters, docs] = await Promise.all([
      db.project.findFirst({ where: { id: projectId }, select: { id: true, title: true, description: true, genre: true, perspective: true, pov: true, voice: true, tone: true, themes: true } }),
      db.chapter.findMany({ where: { projectId, ...(input.chapterId ? { id: input.chapterId } : {}), deletedAt: null }, include: { scenes: true } }),
      db.projectDoc.findMany({ where: { projectId, ...(input.projectDocId ? { id: input.projectDocId } : {}) }, select: { id: true, title: true, kind: true, order: true } })
    ]);
    const buildState = input.buildRunId ? await Promise.all([
      db.canonFact.findMany({ where: { projectId, buildRunId: input.buildRunId, isCurrent: true, invalidatedAt: null } }), db.entityState.findMany({ where: { projectId, buildRunId: input.buildRunId, isCurrent: true, invalidatedAt: null } }),
      db.openLoop.findMany({ where: { projectId, buildRunId: input.buildRunId, isCurrent: true, invalidatedAt: null } }), db.setupPayoffLink.findMany({ where: { projectId, buildRunId: input.buildRunId, isCurrent: true, invalidatedAt: null } }),
      db.plotThread.findMany({ where: { projectId, buildRunId: input.buildRunId, isCurrent: true, invalidatedAt: null } })
    ]) : [];
    return JSON.parse(JSON.stringify({ project, chapters, docs, buildState, mentions: Object.fromEntries(heads.map((item) => [item.writingId, []])) })) as JsonValue;
  }

  private async currentHeads(projectId: string, source: SnapshotWritingHead[]): Promise<SnapshotWritingHead[]> {
    const branches = await this.prisma.writingBranch.findMany({ where: { id: { in: source.map((head) => head.branchId) }, writing: { projectId } }, include: { headVersion: true } });
    return source.flatMap((item) => { const branch = branches.find((value) => value.id === item.branchId); return branch?.headVersion ? [head(item.entityType, item.entityId, item.writingId, branch.id, branch.headVersion.id, branch.headVersion.body ?? '')] : []; });
  }
  private async captureCurrentStateForSnapshot(projectId: string, snapshot: Prisma.NamedSnapshotGetPayload<object>): Promise<JsonValue> {
    return this.captureStructuredState(this.prisma, projectId, { idempotencyKey: 'current', label: 'current', scope: fromScope(snapshot.scope), chapterId: snapshot.chapterId, sceneId: snapshot.sceneId, projectDocId: snapshot.projectDocId, writingId: snapshot.writingId, buildRunId: snapshot.buildRunId, checkpointId: snapshot.checkpointId, compilationId: snapshot.compilationId }, snapshotHeads(snapshot.heads));
  }
  private async requireSnapshot(db: Db, projectId: string, id: string) { const row = await db.namedSnapshot.findFirst({ where: { id, projectId } }); if (!row) throw new HttpError(404, 'Named snapshot not found'); return row; }
}

function head(entityType: string, entityId: string, writingId: string, branchId: string, versionId: string, body: string): SnapshotWritingHead { return { entityType, entityId, writingId, branchId, versionId, wordCount: countWords(body), bodyHash: stableHash(body) }; }
function entity(value: { chapterBodies: { id: string }[]; sceneBodies: { id: string }[]; projectDocs: { id: string }[]; storyLoglineStructure: { id: string }[]; storyOutlineStructure: { id: string }[]; storyClimaxStructure: { id: string }[] }) { return value.chapterBodies.length ? 'chapter' : value.sceneBodies.length ? 'scene' : value.projectDocs.length ? 'project-doc' : value.storyLoglineStructure.length ? 'story-logline' : value.storyOutlineStructure.length ? 'story-outline' : value.storyClimaxStructure.length ? 'story-climax' : 'writing'; }
function entityId(value: Parameters<typeof entity>[0], writingId: string) { return value.chapterBodies[0]?.id ?? value.sceneBodies[0]?.id ?? value.projectDocs[0]?.id ?? value.storyLoglineStructure[0]?.id ?? value.storyOutlineStructure[0]?.id ?? value.storyClimaxStructure[0]?.id ?? writingId; }
function snapshotHeads(value: Prisma.JsonValue): SnapshotWritingHead[] { if (!Array.isArray(value)) throw new HttpError(409, 'Snapshot head map is invalid'); return value as unknown as SnapshotWritingHead[]; }
function toSnapshot(row: Prisma.NamedSnapshotGetPayload<object>): NamedSnapshot { return { id: row.id, projectId: row.projectId, createdById: row.createdById, label: row.label, message: row.message, scope: fromScope(row.scope), chapterId: row.chapterId, sceneId: row.sceneId, projectDocId: row.projectDocId, writingId: row.writingId, buildRunId: row.buildRunId, checkpointId: row.checkpointId, compilationId: row.compilationId, heads: snapshotHeads(row.heads), structuredState: row.structuredState as JsonValue, contentHash: row.contentHash, sizeBytes: row.sizeBytes, createdAt: row.createdAt.toISOString(), deletedAt: row.deletedAt?.toISOString() ?? null }; }
function toScope(value: CreateNamedSnapshotInput['scope']): PrismaNamedSnapshotScope { return value.toUpperCase().replaceAll('-', '_') as PrismaNamedSnapshotScope; }
function fromScope(value: PrismaNamedSnapshotScope): NamedSnapshot['scope'] { return value.toLowerCase().replaceAll('_', '-') as NamedSnapshot['scope']; }
function lineChanges(left: string, right: string): SnapshotLineChange[] { const a = left.split('\n'), b = right.split('\n'); let prefix = 0; while (prefix < a.length && prefix < b.length && a[prefix] === b[prefix]) prefix++; let suffix = 0; while (suffix < a.length - prefix && suffix < b.length - prefix && a[a.length - 1 - suffix] === b[b.length - 1 - suffix]) suffix++; const out: SnapshotLineChange[] = []; if (prefix) out.push({ kind: 'equal', leftStart: 0, rightStart: 0, lines: a.slice(0, prefix) }); if (a.length - prefix - suffix) out.push({ kind: 'removed', leftStart: prefix, rightStart: prefix, lines: a.slice(prefix, a.length - suffix) }); if (b.length - prefix - suffix) out.push({ kind: 'added', leftStart: a.length - suffix, rightStart: prefix, lines: b.slice(prefix, b.length - suffix) }); if (suffix) out.push({ kind: 'equal', leftStart: a.length - suffix, rightStart: b.length - suffix, lines: a.slice(a.length - suffix) }); return out; }
function semanticChanges(left: JsonValue, right: JsonValue): SnapshotSemanticChange[] { const changes: SnapshotSemanticChange[] = []; const walk = (a: JsonValue | undefined, b: JsonValue | undefined, path: string) => { if (stableHash(a) === stableHash(b) || changes.length >= 2_000) return; if (Array.isArray(a) && Array.isArray(b)) { const keyed = [...a, ...b].every((item) => !item || typeof item !== 'object' || Array.isArray(item) || typeof item.id === 'string'); if (keyed) { const leftMap = new Map(a.map((item, index) => [object(item).id as string ?? String(index), item])); const rightMap = new Map(b.map((item, index) => [object(item).id as string ?? String(index), item])); for (const key of new Set([...leftMap.keys(), ...rightMap.keys()])) walk(leftMap.get(key), rightMap.get(key), `${path}[${key}]`); } else for (let index = 0; index < Math.max(a.length, b.length); index++) walk(a[index], b[index], `${path}[${index}]`); } else if (a && b && typeof a === 'object' && typeof b === 'object' && !Array.isArray(a) && !Array.isArray(b)) { for (const key of new Set([...Object.keys(a), ...Object.keys(b)])) walk(a[key], b[key], path ? `${path}.${key}` : key); } else changes.push({ path, before: a ?? null, after: b ?? null }); }; walk(left, right, ''); return changes; }
function text(value: unknown, label: string, max: number) { if (typeof value !== 'string' || !value.trim()) throw new HttpError(400, `${label} is required`); if (value.trim().length > max) throw new HttpError(400, `${label} is too long`); return value.trim(); }
function optionalText(value: unknown, max: number) { return value === null || value === undefined || value === '' ? null : text(value, 'Text', max); }
function validateKey(value: unknown) { text(value, 'Idempotency key', 500); }
function requiredId(value: unknown, label: string) { return text(value, label, 500); }
function object(value: unknown): Record<string, JsonValue> { return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, JsonValue> : {}; }
function json(value: unknown): Prisma.InputJsonValue { return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue; }
function isUnique(error: unknown) { return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002'; }

async function restoreStructuredState(tx: Prisma.TransactionClient, projectId: string, value: JsonValue, expectedRevisions: Record<string, number>) {
  const state = object(value); const project = object(state.project);
  if (project.id === projectId) await tx.project.update({ where: { id: projectId }, data: {
    title: typeof project.title === 'string' ? project.title : undefined, description: typeof project.description === 'string' || project.description === null ? project.description : undefined,
    genre: typeof project.genre === 'string' || project.genre === null ? project.genre : undefined, perspective: typeof project.perspective === 'string' || project.perspective === null ? project.perspective : undefined,
    pov: typeof project.pov === 'string' || project.pov === null ? project.pov : undefined, voice: typeof project.voice === 'string' || project.voice === null ? project.voice : undefined,
    tone: typeof project.tone === 'string' || project.tone === null ? project.tone : undefined, themes: Array.isArray(project.themes) ? project.themes.filter((item): item is string => typeof item === 'string') : undefined
  } });
  for (const rawChapter of Array.isArray(state.chapters) ? state.chapters : []) {
    const chapter = object(rawChapter); if (typeof chapter.id !== 'string') continue;
    const exists = await tx.chapter.findFirst({ where: { id: chapter.id, projectId, deletedAt: null }, select: { id: true } }); if (!exists) throw new HttpError(409, `Snapshot chapter '${chapter.id}' no longer exists`);
    await tx.chapter.update({ where: { id: chapter.id }, data: {
      title: typeof chapter.title === 'string' ? chapter.title : undefined, status: typeof chapter.status === 'string' ? chapter.status as ChapterStatus : undefined,
      povCharacterId: typeof chapter.povCharacterId === 'string' || chapter.povCharacterId === null ? chapter.povCharacterId : undefined,
      locationId: typeof chapter.locationId === 'string' || chapter.locationId === null ? chapter.locationId : undefined,
      summary: typeof chapter.summary === 'string' || chapter.summary === null ? chapter.summary : undefined
    } });
    for (const rawScene of Array.isArray(chapter.scenes) ? chapter.scenes : []) {
      const scene = object(rawScene); if (typeof scene.id !== 'string') continue; const expected = expectedRevisions[scene.id];
      if (!Number.isInteger(expected)) throw new HttpError(409, `Expected revision is required for scene '${scene.id}' metadata restore`);
      const result = await tx.scene.updateMany({ where: { id: scene.id, chapterId: chapter.id, revision: expected }, data: {
        title: typeof scene.title === 'string' || scene.title === null ? scene.title : undefined, status: typeof scene.status === 'string' ? scene.status as SceneStatus : undefined,
        povCharacterId: typeof scene.povCharacterId === 'string' || scene.povCharacterId === null ? scene.povCharacterId : undefined,
        locationId: typeof scene.locationId === 'string' || scene.locationId === null ? scene.locationId : undefined,
        storyDate: typeof scene.storyDate === 'string' || scene.storyDate === null ? scene.storyDate : undefined,
        storyTime: typeof scene.storyTime === 'string' || scene.storyTime === null ? scene.storyTime : undefined,
        estimatedWordCount: typeof scene.estimatedWordCount === 'number' || scene.estimatedWordCount === null ? scene.estimatedWordCount : undefined,
        actualWordCount: typeof scene.actualWordCount === 'number' ? scene.actualWordCount : undefined,
        sceneFunction: nullableJsonString(scene.sceneFunction), goal: nullableJsonString(scene.goal), obstacle: nullableJsonString(scene.obstacle), stakes: nullableJsonString(scene.stakes), conflict: nullableJsonString(scene.conflict),
        turn: nullableJsonString(scene.turn), revelation: nullableJsonString(scene.revelation), outcome: nullableJsonString(scene.outcome), emotionalValueShift: nullableJsonString(scene.emotionalValueShift),
        tension: typeof scene.tension === 'number' || scene.tension === null ? scene.tension : undefined,
        characterPresentIds: stringArray(scene.characterPresentIds), characterReferencedIds: stringArray(scene.characterReferencedIds), plotThreadIds: stringArray(scene.plotThreadIds), setupPayoffIds: stringArray(scene.setupPayoffIds),
        knowledgeDeltas: prismaJson(scene.knowledgeDeltas), objectTransfers: prismaJson(scene.objectTransfers), injuryStateChanges: prismaJson(scene.injuryStateChanges), worldRuleRefs: prismaJson(scene.worldRuleRefs), entryState: prismaJson(scene.entryState), exitState: prismaJson(scene.exitState),
        summary: nullableJsonString(scene.summary), writerNotes: nullableJsonString(scene.writerNotes), aiNotes: nullableJsonString(scene.aiNotes), revision: { increment: 1 }
      } }); if (result.count !== 1) throw new HttpError(409, `Scene '${scene.id}' metadata changed concurrently`);
    }
  }
  for (const rawDoc of Array.isArray(state.docs) ? state.docs : []) { const doc = object(rawDoc); if (typeof doc.id === 'string') await tx.projectDoc.updateMany({ where: { id: doc.id, projectId }, data: { title: typeof doc.title === 'string' ? doc.title : undefined, order: typeof doc.order === 'number' ? doc.order : undefined } }); }
}
function nullableJsonString(value: JsonValue | undefined): string | null | undefined { return typeof value === 'string' || value === null ? value : undefined; }
function stringArray(value: JsonValue | undefined): string[] | undefined { return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : undefined; }
function prismaJson(value: JsonValue | undefined): Prisma.InputJsonValue | typeof Prisma.JsonNull | undefined { if (value === undefined) return undefined; return value === null ? Prisma.JsonNull : value as Prisma.InputJsonValue; }
