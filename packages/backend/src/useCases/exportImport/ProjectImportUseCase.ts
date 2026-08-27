import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { Prisma, type PrismaClient, type ProjectImport as PrismaProjectImport } from '@prisma/client';
import type {
  ApplyProjectImportInput,
  ImportPreviewChapter,
  JsonValue,
  ProjectImportConflict,
  ProjectImportPreview
} from '@opentales/sdk';
import { z } from 'zod';
import { HttpError } from '../../http/HttpError.js';
import { LocalAssetStorage } from '../../repositories/AssetStorage.js';
import { ProjectAccessRepository } from '../../repositories/ProjectAccessRepository.js';
import { countWords } from '../../utils/wordCount.js';
import { WritingUseCase } from '../writings/WritingUseCase.js';
import { authorizationScopeSchema, stableHash, validateArtifactContent } from '../novelBuild/schemas.js';
import { parseImportFile, type ParsedImport } from './importParsers.js';
import { sha256 } from './exportFormats.js';

const PREVIEW_TTL_MS = 24 * 60 * 60 * 1_000;

const applySchema = z.object({
  idempotencyKey: z.string().trim().min(1).max(500),
  confirmConflicts: z.boolean(),
  restoreStructuredState: z.boolean().default(false),
  targetBuildRunId: z.string().trim().min(1).nullable().optional()
}).strict();

export class ProjectImportUseCase {
  private readonly access: ProjectAccessRepository;
  private readonly storage = new LocalAssetStorage();
  private readonly writings = new WritingUseCase();

  constructor(private readonly prisma: PrismaClient) {
    this.access = new ProjectAccessRepository(prisma);
  }

  async list(userId: string, projectId: string): Promise<ProjectImportPreview[]> {
    await this.access.assertProjectAccess(userId, projectId);
    const rows = await this.prisma.projectImport.findMany({ where: { projectId }, orderBy: { createdAt: 'desc' }, take: 100 });
    return rows.map(toProjectImport);
  }

  async preview(
    userId: string,
    projectId: string,
    input: { idempotencyKey: string; filename: string; mimeType?: string; buffer: Buffer }
  ): Promise<ProjectImportPreview> {
    await this.access.assertPermission(userId, projectId, 'project:write');
    const idempotencyKey = required(input.idempotencyKey, 'Idempotency key', 500);
    const filename = safeUploadName(input.filename);
    const parsed = await parseImportFile(input.buffer, filename, input.mimeType);
    const checksum = sha256(input.buffer);
    const requestHash = stableHash({ filename, declaredMimeType: input.mimeType ?? null, checksum });
    const existing = await this.prisma.projectImport.findUnique({ where: { projectId_idempotencyKey: { projectId, idempotencyKey } } });
    if (existing) {
      if (existing.requestHash !== requestHash) throw new HttpError(409, 'Import idempotency key was reused with a different file');
      return toProjectImport(existing);
    }
    const conflicts = await this.chapterConflicts(this.prisma, projectId, parsed.chapters);
    const preview = { chapters: parsed.chapters };
    const asset = await this.persistPrivateAsset(userId, projectId, filename, parsed.mimeType, input.buffer, checksum);
    try {
      const row = await this.prisma.projectImport.create({
        data: {
          projectId,
          assetId: asset.id,
          createdById: userId,
          idempotencyKey,
          requestHash,
          format: parsed.format.toUpperCase().replaceAll('-', '_') as Prisma.ProjectImportCreateInput['format'],
          filename,
          mimeType: parsed.mimeType,
          checksum,
          sizeBytes: BigInt(input.buffer.length),
          preview: json(preview),
          conflicts: json(conflicts),
          sourceMetadata: json(parsed.sourceMetadata),
          expiresAt: new Date(Date.now() + PREVIEW_TTL_MS)
        }
      });
      return toProjectImport(row);
    } catch (error) {
      await this.prisma.asset.deleteMany({ where: { id: asset.id } });
      await this.storage.delete(asset.s3Key).catch(() => undefined);
      throw error;
    }
  }

  async apply(userId: string, projectId: string, importId: string, rawInput: ApplyProjectImportInput): Promise<ProjectImportPreview> {
    await this.access.assertPermission(userId, projectId, 'project:write');
    let input: z.infer<typeof applySchema>;
    try { input = applySchema.parse(rawInput); }
    catch (error) { throw new HttpError(400, error instanceof Error ? error.message : 'Invalid import apply request'); }
    if (input.restoreStructuredState) {
      await this.access.assertPermission(userId, projectId, 'project:admin');
      if (!input.targetBuildRunId) throw new HttpError(400, 'targetBuildRunId is required to restore structured build state');
    }
    const stored = await this.prisma.projectImport.findFirst({ where: { id: importId, projectId }, include: { asset: true } });
    if (!stored?.asset || stored.asset.isPublic) throw new HttpError(404, 'Import preview or source file not found');
    if (stored.status === 'APPLIED') {
      if (stored.applyIdempotencyKey !== input.idempotencyKey) throw new HttpError(409, 'Import was already applied with a different idempotency key');
      return toProjectImport(stored);
    }
    if (stored.expiresAt <= new Date()) throw new HttpError(410, 'Import preview expired; upload the source again');
    const buffer = await this.readAsset(stored.asset.s3Key);
    if (sha256(buffer) !== stored.checksum) throw new HttpError(409, 'Stored import checksum no longer matches its preview');
    const parsed = await parseImportFile(buffer, stored.filename, stored.mimeType);
    try {
      const result = await serializableTransaction(this.prisma, async (tx) => {
        await tx.$queryRaw`SELECT id FROM "Project" WHERE id = ${projectId} FOR UPDATE`;
        const row = await tx.projectImport.findFirst({ where: { id: importId, projectId } });
        if (!row) throw new HttpError(404, 'Import preview not found');
        const conflicts = await this.chapterConflicts(tx, projectId, parsed.chapters);
        if (conflicts.length && !input.confirmConflicts) throw new HttpError(409, 'Import conflicts require explicit confirmation', { conflicts });
        await tx.projectImport.update({ where: { id: importId }, data: { status: 'APPLYING', error: null } });
        const applied = await this.applyChapters(tx, userId, projectId, parsed.chapters, input.confirmConflicts);
        const structured = input.restoreStructuredState && input.targetBuildRunId
          ? await this.restoreStructuredState(tx, projectId, input.targetBuildRunId, parsed, applied, input.confirmConflicts)
          : { artifactIds: [] as string[], canonFactIds: [] as string[] };
        const applyResult = { ...applied, ...structured };
        await tx.projectImport.update({
          where: { id: importId },
          data: { status: 'APPLIED', applyIdempotencyKey: input.idempotencyKey, applyResult: json(applyResult), appliedAt: new Date(), error: null }
        });
        return applyResult;
      });
      void result;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Import apply failed';
      await this.prisma.projectImport.updateMany({ where: { id: importId, status: { not: 'APPLIED' } }, data: { status: 'FAILED', error: message } });
      throw error;
    }
    return toProjectImport(await this.prisma.projectImport.findUniqueOrThrow({ where: { id: importId } }));
  }

  private async applyChapters(
    tx: Prisma.TransactionClient,
    userId: string,
    projectId: string,
    chapters: ImportPreviewChapter[],
    confirmConflicts: boolean
  ) {
    const existing = await tx.chapter.findMany({ where: { projectId, deletedAt: null }, include: { bodyWriting: { include: { defaultBranch: true } } } });
    const claimedExisting = new Set<string>();
    const chapterIdMap = new Map<string, string>();
    const sceneIdMap = new Map<string, string>();
    const createdChapterIds: string[] = [];
    const updatedChapterIds: string[] = [];
    for (const [index, chapter] of chapters.entries()) {
      const conflict = existing.find((candidate) => !claimedExisting.has(candidate.id) && (candidate.number === chapter.number || candidate.title.toLowerCase() === chapter.title.toLowerCase()));
      let chapterId: string;
      if (conflict) {
        if (!confirmConflicts) throw new HttpError(409, `Chapter '${chapter.title}' conflicts with an existing chapter`);
        claimedExisting.add(conflict.id);
        const branch = conflict.bodyWriting.defaultBranch;
        if (!branch) throw new HttpError(409, `Existing chapter '${conflict.title}' has no default branch`);
        const version = await tx.writingVersion.create({
          data: { branchId: branch.id, parentVersionId: branch.headVersionId, body: chapter.body, wordCount: countWords(chapter.body), authorId: userId, message: `Confirmed import from ${chapter.title}` }
        });
        await tx.writingBranch.update({ where: { id: branch.id }, data: { headVersionId: version.id } });
        await tx.chapter.update({ where: { id: conflict.id }, data: { title: chapter.title, summary: chapter.summary ?? conflict.summary } });
        chapterId = conflict.id;
        updatedChapterIds.push(chapterId);
      } else {
        const nextNumber = await nextAvailableNumber(tx, projectId, chapter.number);
        const writingId = await this.writings.createWriting(tx, { projectId, kind: 'CHAPTER_BODY', body: chapter.body, authorId: userId, message: 'Import chapter' });
        const created = await tx.chapter.create({
          data: { projectId, number: nextNumber, order: existing.length + index, title: chapter.title, summary: chapter.summary ?? null, status: 'DRAFT', bodyWritingId: writingId }
        });
        chapterId = created.id;
        createdChapterIds.push(chapterId);
      }
      if (chapter.sourceId) chapterIdMap.set(chapter.sourceId, chapterId);
      const currentScenes = await tx.scene.findMany({ where: { chapterId }, orderBy: { order: 'asc' }, include: { bodyWriting: { include: { defaultBranch: true } } } });
      for (const [sceneIndex, scene] of chapter.scenes.entries()) {
        const target = currentScenes[sceneIndex];
        let sceneId: string;
        if (target && confirmConflicts) {
          const branch = target.bodyWriting.defaultBranch;
          if (!branch) throw new HttpError(409, 'Existing scene has no default branch');
          const version = await tx.writingVersion.create({ data: { branchId: branch.id, parentVersionId: branch.headVersionId, body: scene.body, wordCount: countWords(scene.body), authorId: userId, message: 'Confirmed scene import' } });
          await tx.writingBranch.update({ where: { id: branch.id }, data: { headVersionId: version.id } });
          await tx.scene.update({ where: { id: target.id }, data: { title: scene.title, actualWordCount: countWords(scene.body) } });
          sceneId = target.id;
        } else {
          const writingId = await this.writings.createWriting(tx, { projectId, kind: 'SCENE_BODY', body: scene.body, authorId: userId, message: 'Import scene' });
          const created = await tx.scene.create({ data: { chapterId, order: currentScenes.length + sceneIndex, title: scene.title, status: 'DRAFT', actualWordCount: countWords(scene.body), bodyWritingId: writingId } });
          sceneId = created.id;
        }
        if (scene.sourceId) sceneIdMap.set(scene.sourceId, sceneId);
      }
    }
    return { createdChapterIds, updatedChapterIds, chapterIdMap: Object.fromEntries(chapterIdMap), sceneIdMap: Object.fromEntries(sceneIdMap) };
  }

  private async restoreStructuredState(
    tx: Prisma.TransactionClient,
    projectId: string,
    buildRunId: string,
    parsed: ParsedImport,
    applied: { chapterIdMap: Record<string, string>; sceneIdMap: Record<string, string> },
    confirmConflicts: boolean
  ) {
    const archiveBuild = objectValue(parsed.archive?.build);
    const run = await tx.buildRun.findFirst({ where: { id: buildRunId, projectId } });
    if (!run) throw new HttpError(404, 'Target build run not found');
    const scope = authorizationScopeSchema.parse(run.authorizationScope);
    if (!scope.allowPlanningArtifacts || !scope.allowCanonWrites) throw new HttpError(403, 'Target build is not authorized for artifact and canon restoration');
    const artifactIds: string[] = [];
    const oldToNewArtifact = new Map<string, string>();
    for (const raw of arrayValue(archiveBuild.artifacts)) {
      const source = objectValue(raw);
      const type = stringValue(source.type)?.toLowerCase().replaceAll('_', '-') as Parameters<typeof validateArtifactContent>[0] | undefined;
      const key = stringValue(source.key);
      if (!type || !key || !scope.artifactTypes.includes(type)) continue;
      // Export manifests and compiled draft receipts reference source-project
      // assets/versions and must be regenerated after the import.
      if (type === 'export-manifest' || type === 'chapter-draft') continue;
      const content = validateArtifactContent(type, source.content);
      const current = await tx.storyArtifact.findFirst({ where: { buildRunId, type: type.toUpperCase().replaceAll('-', '_') as never, key, invalidatedAt: null, status: { notIn: ['SUPERSEDED', 'INVALIDATED'] } }, orderBy: { version: 'desc' } });
      if (current && !confirmConflicts) throw new HttpError(409, `Structured artifact '${type}/${key}' already exists`);
      if (current) await tx.storyArtifact.update({ where: { id: current.id }, data: { status: 'SUPERSEDED' } });
      const created = await tx.storyArtifact.create({ data: {
        projectId, buildRunId, type: type.toUpperCase().replaceAll('-', '_') as never, key,
        title: stringValue(source.title) ?? key, version: (current?.version ?? 0) + 1,
        schemaVersion: stringValue(source.schemaVersion) ?? 'story-ir-v1', status: 'VALIDATED',
        content: content as Prisma.InputJsonValue, contentHash: stableHash(content), replacesArtifactId: current?.id ?? null
      } });
      artifactIds.push(created.id);
      const oldId = stringValue(source.id);
      if (oldId) oldToNewArtifact.set(oldId, created.id);
    }
    const canonFactIds: string[] = [];
    for (const raw of arrayValue(archiveBuild.canonFacts)) {
      const source = objectValue(raw);
      const key = stringValue(source.key);
      const subjectType = stringValue(source.subjectType);
      const subjectId = stringValue(source.subjectId);
      const predicate = stringValue(source.predicate);
      if (!key || !subjectType || !subjectId || !predicate || source.object === undefined) continue;
      const current = await tx.canonFact.findFirst({ where: { buildRunId, key, isCurrent: true }, orderBy: { version: 'desc' } });
      if (current && !confirmConflicts) throw new HttpError(409, `Canon fact '${key}' already exists`);
      if (current) await tx.canonFact.update({ where: { id: current.id }, data: { isCurrent: false } });
      const fact = await tx.canonFact.create({
        data: {
          projectId, buildRunId, key, subjectType, subjectId, predicate, object: jsonInput(source.object),
          version: (current?.version ?? 0) + 1, isCurrent: true, supersedesFactId: current?.id ?? null,
          status: canonStatus(source.status), confidence: numberValue(source.confidence, 1),
          sourceArtifactId: mapped(oldToNewArtifact, source.sourceArtifactId),
          sourceChapterId: mappedRecord(applied.chapterIdMap, source.sourceChapterId), sourceSceneId: mappedRecord(applied.sceneIdMap, source.sourceSceneId),
          validFromSceneId: mappedRecord(applied.sceneIdMap, source.validFromSceneId), validToSceneId: mappedRecord(applied.sceneIdMap, source.validToSceneId),
          sourceSpan: source.sourceSpan === null || source.sourceSpan === undefined ? Prisma.JsonNull : jsonInput(source.sourceSpan),
          validFromOrder: typeof source.validFromOrder === 'number' ? source.validFromOrder : null,
          validToOrder: typeof source.validToOrder === 'number' ? source.validToOrder : null
        }
      });
      canonFactIds.push(fact.id);
    }
    await tx.buildRun.update({ where: { id: buildRunId }, data: { revision: { increment: 1 } } });
    return { artifactIds, canonFactIds };
  }

  private async chapterConflicts(client: PrismaClient | Prisma.TransactionClient, projectId: string, chapters: ImportPreviewChapter[]): Promise<ProjectImportConflict[]> {
    const existing = await client.chapter.findMany({ where: { projectId, deletedAt: null }, select: { id: true, number: true, title: true } });
    const conflicts: ProjectImportConflict[] = [];
    for (const chapter of chapters) {
      const number = existing.find((item) => item.number === chapter.number);
      if (number) conflicts.push({ kind: 'chapter-number', sourceKey: String(chapter.number), existingId: number.id, message: `Chapter number ${chapter.number} already belongs to '${number.title}'.` });
      const title = existing.find((item) => item.title.toLowerCase() === chapter.title.toLowerCase());
      if (title && title.id !== number?.id) conflicts.push({ kind: 'chapter-title', sourceKey: chapter.title, existingId: title.id, message: `Chapter title '${chapter.title}' already exists.` });
    }
    return conflicts;
  }

  private async persistPrivateAsset(userId: string, projectId: string, filename: string, mimeType: string, buffer: Buffer, checksum: string) {
    const asset = await this.prisma.asset.create({ data: {
      projectId, kind: 'DOCUMENT', s3Bucket: LocalAssetStorage.bucket, s3Key: `pending/import/${randomUUID()}`,
      mimeType, sizeBytes: BigInt(buffer.length), checksum, isPublic: false, uploadedById: userId, name: filename
    } });
    try {
      const stored = await this.storage.write(projectId, asset.id, path.extname(filename).slice(1) || 'bin', buffer);
      return await this.prisma.asset.update({ where: { id: asset.id }, data: { s3Key: stored.key, sizeBytes: stored.sizeBytes } });
    } catch (error) {
      await this.prisma.asset.deleteMany({ where: { id: asset.id } });
      throw error;
    }
  }

  private async readAsset(key: string): Promise<Buffer> {
    const chunks: Buffer[] = [];
    for await (const chunk of await this.storage.readStream(key)) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    return Buffer.concat(chunks);
  }
}

async function serializableTransaction<T>(prisma: PrismaClient, work: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 12; attempt += 1) try {
    return await prisma.$transaction(work, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, timeout: 60_000, maxWait: 10_000 });
  } catch (error) {
    lastError = error;
    if (!isSerializationConflict(error) || attempt === 11) throw error;
    await new Promise((resolve) => setTimeout(resolve, Math.min(500, 20 * (2 ** Math.min(attempt, 4))) + Math.floor(Math.random() * 50)));
  }
  throw lastError;
}

function isSerializationConflict(error: unknown): boolean {
  if (error instanceof Prisma.PrismaClientKnownRequestError && (error.code === 'P2034' || (error.code === 'P2010' && ['40001', '40P01'].includes(String(error.meta?.code))))) return true;
  return /40001|40P01|serialize access|serialization failure|deadlock/i.test(error instanceof Error ? error.message : String(error));
}

function toProjectImport(row: PrismaProjectImport): ProjectImportPreview {
  const preview = objectValue(row.preview);
  return {
    id: row.id, projectId: row.projectId, assetId: row.assetId,
    format: row.format.toLowerCase().replaceAll('_', '-') as ProjectImportPreview['format'],
    status: row.status.toLowerCase() as ProjectImportPreview['status'],
    filename: row.filename, mimeType: row.mimeType, checksum: row.checksum, sizeBytes: Number(row.sizeBytes),
    chapters: Array.isArray(preview.chapters) ? preview.chapters as unknown as ImportPreviewChapter[] : [],
    conflicts: Array.isArray(row.conflicts) ? row.conflicts as unknown as ProjectImportConflict[] : [],
    sourceMetadata: row.sourceMetadata as JsonValue,
    expiresAt: row.expiresAt.toISOString(), appliedAt: row.appliedAt?.toISOString() ?? null,
    applyResult: row.applyResult as JsonValue | null, error: row.error,
    createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString()
  };
}

async function nextAvailableNumber(tx: Prisma.TransactionClient, projectId: string, preferred: number): Promise<number> {
  let value = Math.max(1, Math.trunc(preferred));
  while (await tx.chapter.count({ where: { projectId, number: value } })) value += 1;
  return value;
}

function safeUploadName(value: string): string {
  const name = path.basename(value).replace(/[\u0000-\u001f\u007f]/g, '').trim();
  if (!name || name.length > 255) throw new HttpError(400, 'Import filename is invalid');
  return name;
}

function required(value: unknown, label: string, max: number): string {
  if (typeof value !== 'string' || !value.trim()) throw new HttpError(400, `${label} is required`);
  if (value.trim().length > max) throw new HttpError(400, `${label} is too long`);
  return value.trim();
}

function objectValue(value: unknown): Record<string, JsonValue> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, JsonValue> : {};
}

function arrayValue(value: unknown): JsonValue[] { return Array.isArray(value) ? value as JsonValue[] : []; }
function stringValue(value: unknown): string | null { return typeof value === 'string' ? value : null; }
function numberValue(value: unknown, fallback: number): number { return typeof value === 'number' && Number.isFinite(value) ? value : fallback; }
function json(value: unknown): Prisma.InputJsonValue { return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue; }
function jsonInput(value: unknown): Prisma.InputJsonValue { return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue; }
function mapped(map: Map<string, string>, value: unknown): string | null { const key = stringValue(value); return key ? map.get(key) ?? null : null; }
function mappedRecord(map: Record<string, string>, value: unknown): string | null { const key = stringValue(value); return key ? map[key] ?? null : null; }
type CanonStatusValue = 'PROPOSED' | 'CANONICAL' | 'DISPUTED' | 'RETRACTED' | 'INVALIDATED';
function canonStatus(value: unknown): CanonStatusValue {
  const normalized = stringValue(value)?.toUpperCase();
  return ['PROPOSED', 'CANONICAL', 'DISPUTED', 'RETRACTED', 'INVALIDATED'].includes(normalized ?? '') ? normalized as CanonStatusValue : 'CANONICAL';
}
