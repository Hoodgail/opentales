import { createHash } from 'node:crypto';
import { Prisma, type PrismaClient } from '@prisma/client';
import type {
  ApplyRenameSymbolInput,
  ApplyRenameSymbolResult,
  JsonValue,
  PreviewRenameSymbolInput,
  RenameSymbolExpectedHead,
  RenameSymbolOccurrence,
  RenameSymbolPreview
} from '@opentales/sdk';
import { HttpError } from '../../http/HttpError.js';
import { ProjectAccessRepository } from '../../repositories/ProjectAccessRepository.js';
import { countWords } from '../../utils/wordCount.js';

const MAX_SOURCES = 5_000;
const MAX_SCAN_BYTES = 50_000_000;
const MAX_OCCURRENCES = 20_000;
const MAX_PREVIEW_OCCURRENCES = 2_000;
const MAX_NAME_LENGTH = 200;
const RETRIES = 4;

type Db = PrismaClient | Prisma.TransactionClient;

interface TargetEntity {
  id: string;
  name: string;
  aliases: string[];
  updatedAt: Date;
}

interface BranchChange {
  writingId: string;
  branchId: string;
  versionId: string;
  bodyHash: string;
  body: string;
  nextBody: string;
}

type StructuredChange =
  | { kind: 'artifact'; id: string; revision: string; expectedUpdatedAt: Date; previousContentHash: string; title: string; content: JsonValue; contentHash: string }
  | { kind: 'unit'; id: string; revision: string; title: string; metadata: JsonValue }
  | { kind: 'chapter'; id: string; revision: string; title: string }
  | { kind: 'scene'; id: string; revision: string; title: string }
  | { kind: 'project-doc'; id: string; revision: string; title: string };

interface Computation {
  preview: RenameSymbolPreview;
  entity: TargetEntity;
  branchChanges: BranchChange[];
  structuredChanges: StructuredChange[];
}

interface EntityDescriptor {
  entityType: string;
  entityId: string;
  title: string;
  unitId: string | null;
  buildRunId: string | null;
}

export class RenameRefactorUseCase {
  private readonly access: ProjectAccessRepository;

  constructor(private readonly prisma: PrismaClient) {
    this.access = new ProjectAccessRepository(prisma);
  }

  async preview(userId: string, projectId: string, input: PreviewRenameSymbolInput): Promise<RenameSymbolPreview> {
    await this.access.assertProjectAccess(userId, projectId);
    return (await this.compute(this.prisma, projectId, validateInput(input))).preview;
  }

  async apply(userId: string, projectId: string, raw: ApplyRenameSymbolInput): Promise<ApplyRenameSymbolResult> {
    await this.access.assertPermission(userId, projectId, 'project:write');
    if (raw.confirm !== true) throw new HttpError(400, 'Explicit rename confirmation is required');
    const idempotencyKey = requiredText(raw.idempotencyKey, 'Idempotency key', 500);
    const input = validateInput(raw);
    const requestHash = stableHash(raw);

    return retrySerializable(async () => this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "Project" WHERE id=${projectId} FOR UPDATE`;
      const replay = await tx.renameRefactorReceipt.findUnique({
        where: { projectId_idempotencyKey: { projectId, idempotencyKey } }
      });
      if (replay) {
        if (replay.requestHash !== requestHash) throw new HttpError(409, 'Rename idempotency key was reused with different input');
        return replay.result as unknown as ApplyRenameSymbolResult;
      }

      const computation = await this.compute(tx, projectId, input);
      const { preview } = computation;
      if (preview.conflicts.length) throw new HttpError(409, 'Rename preview contains conflicts', { conflicts: preview.conflicts });
      if (raw.previewHash !== preview.previewHash) throw new HttpError(409, 'Rename preview is stale; generate a new preview');
      if (raw.expectedEntityUpdatedAt !== preview.expectedEntityUpdatedAt) throw new HttpError(409, 'Rename target changed after preview');
      if (stableHash(raw.expectedHeads) !== stableHash(preview.expectedHeads)) throw new HttpError(409, 'One or more writing heads changed after preview');
      if (stableHash(raw.expectedRevisions) !== stableHash(preview.expectedRevisions)) throw new HttpError(409, 'Structured rename sources changed after preview');

      const updatedBranches: ApplyRenameSymbolResult['updatedBranches'] = [];
      for (const change of computation.branchChanges) {
        const branch = await tx.writingBranch.findFirst({
          where: { id: change.branchId, writingId: change.writingId, headVersionId: change.versionId, writing: { projectId } },
          include: { headVersion: true }
        });
        if (!branch || stableHash(branch.headVersion?.body ?? '') !== change.bodyHash) throw new HttpError(409, `Writing '${change.writingId}' changed after preview`);
        const version = await tx.writingVersion.create({ data: {
          branchId: branch.id,
          parentVersionId: change.versionId,
          body: change.nextBody,
          wordCount: countWords(change.nextBody),
          authorId: userId,
          message: `Rename ${preview.targetType}: ${preview.oldName} → ${preview.newName}`
        } });
        const cas = await tx.writingBranch.updateMany({ where: { id: branch.id, headVersionId: change.versionId }, data: { headVersionId: version.id } });
        if (cas.count !== 1) throw new HttpError(409, `Writing '${change.writingId}' changed concurrently`);
        updatedBranches.push({ writingId: change.writingId, branchId: branch.id, previousVersionId: change.versionId, newVersionId: version.id });
      }

      const updatedArtifactIds: string[] = [];
      const updatedUnitIds: string[] = [];
      for (const change of computation.structuredChanges) {
        if (change.kind === 'artifact') {
          const updated = await tx.storyArtifact.updateMany({
            where: { id: change.id, projectId, updatedAt: change.expectedUpdatedAt, contentHash: change.previousContentHash },
            data: { title: change.title, content: json(change.content), contentHash: change.contentHash }
          });
          if (updated.count !== 1) throw new HttpError(409, `Artifact '${change.id}' changed concurrently`);
          updatedArtifactIds.push(change.id);
        } else if (change.kind === 'unit') {
          const updated = await tx.buildManuscriptUnit.updateMany({
            where: { id: change.id, projectId, revision: Number(change.revision), invalidatedAt: null },
            data: { title: change.title, metadata: json(change.metadata), revision: { increment: 1 } }
          });
          if (updated.count !== 1) throw new HttpError(409, `Build unit '${change.id}' changed concurrently`);
          updatedUnitIds.push(change.id);
        } else if (change.kind === 'chapter') {
          const updated = await tx.chapter.updateMany({ where: { id: change.id, projectId, updatedAt: new Date(change.revision), deletedAt: null }, data: { title: change.title } });
          if (updated.count !== 1) throw new HttpError(409, `Chapter '${change.id}' changed concurrently`);
        } else if (change.kind === 'scene') {
          const updated = await tx.scene.updateMany({ where: { id: change.id, revision: Number(change.revision), chapter: { projectId } }, data: { title: change.title, revision: { increment: 1 } } });
          if (updated.count !== 1) throw new HttpError(409, `Scene '${change.id}' changed concurrently`);
        } else {
          const updated = await tx.projectDoc.updateMany({ where: { id: change.id, projectId, updatedAt: new Date(change.revision) }, data: { title: change.title } });
          if (updated.count !== 1) throw new HttpError(409, `Project document '${change.id}' changed concurrently`);
        }
      }

      const aliases = uniqueNames([computation.entity.name, ...computation.entity.aliases])
        .filter((alias) => alias !== preview.newName);
      const entityWhere = { id: computation.entity.id, projectId, updatedAt: computation.entity.updatedAt };
      const entityUpdated = preview.targetType === 'character'
        ? await tx.character.updateMany({ where: entityWhere, data: { name: preview.newName, aliases } })
        : await tx.location.updateMany({ where: entityWhere, data: { name: preview.newName, aliases } });
      if (entityUpdated.count !== 1) throw new HttpError(409, 'Rename target changed concurrently');

      const result: ApplyRenameSymbolResult = {
        previewHash: preview.previewHash,
        targetType: preview.targetType,
        targetId: preview.targetId,
        oldName: preview.oldName,
        newName: preview.newName,
        aliases,
        scope: preview.scope,
        buildRunId: preview.buildRunId,
        appliedOccurrences: preview.totalOccurrences,
        updatedBranches,
        updatedArtifactIds,
        updatedUnitIds,
        appliedAt: new Date().toISOString()
      };
      await tx.renameRefactorReceipt.create({ data: {
        projectId, idempotencyKey, requestHash, targetType: preview.targetType, targetId: preview.targetId, result: json(result)
      } });
      return result;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }));
  }

  private async compute(db: Db, projectId: string, input: PreviewRenameSymbolInput): Promise<Computation> {
    if (input.buildRunId && input.scope === 'main') throw new HttpError(400, 'buildRunId cannot be used with main scope');
    if (input.scope === 'build' && !input.buildRunId) throw new HttpError(400, 'Build scope requires buildRunId');
    if (input.buildRunId) {
      const build = await db.buildRun.findFirst({ where: { id: input.buildRunId, projectId }, select: { id: true } });
      if (!build) throw new HttpError(404, 'Build run not found');
    }
    const entity = await this.target(db, projectId, input.targetType, input.targetId);
    const selectedAliases = input.includeAliases.map((alias) => requiredText(alias, 'Alias', MAX_NAME_LENGTH));
    for (const alias of selectedAliases) if (!entity.aliases.includes(alias)) throw new HttpError(400, `Alias '${alias}' does not belong to the rename target`);
    const selectedNames = uniqueNames([entity.name, ...selectedAliases]).sort((a, b) => b.length - a.length || a.localeCompare(b));
    const conflicts = await this.duplicateConflicts(db, projectId, input, entity);
    if (entity.name === input.newName) conflicts.push('The new name is identical to the current canonical name');

    const occurrences: RenameSymbolOccurrence[] = [];
    const expectedRevisions: Record<string, string> = {};
    let totalOccurrences = 0;
    let scannedBytes = 0;
    const add = (base: Omit<RenameSymbolOccurrence, 'id' | 'start' | 'end' | 'matchedText' | 'beforeSnippet' | 'afterSnippet'>, value: string) => {
      scannedBytes += Buffer.byteLength(value);
      for (const match of matches(value, selectedNames, input.newName, input.caseSensitive)) {
        totalOccurrences += 1;
        if (totalOccurrences <= MAX_OCCURRENCES && occurrences.length < (input.limit ?? 500)) occurrences.push({
          ...base,
          id: stableHash([base.kind, base.entityType, base.entityId, base.field, match.start, match.end, match.matchedText]),
          ...match
        });
      }
    };

    add({ kind: 'structured-label', entityType: input.targetType, entityId: entity.id, title: entity.name, writingId: null, branchId: null, versionId: null, buildRunId: null, artifactId: null, unitId: null, field: 'name' }, entity.name);

    const branchChanges: BranchChange[] = [];
    const branchScope: Prisma.WritingBranchWhereInput = input.scope === 'main'
      ? { buildRunId: null }
      : input.scope === 'build'
        ? { buildRunId: input.buildRunId }
        : input.buildRunId ? { OR: [{ buildRunId: null }, { buildRunId: input.buildRunId }] } : {};
    const branches = await db.writingBranch.findMany({
      where: { writing: { projectId }, headVersionId: { not: null }, ...branchScope },
      include: { writing: { select: { id: true, defaultBranchId: true, kind: true } }, headVersion: true },
      orderBy: { id: 'asc' }, take: MAX_SOURCES + 1
    });
    if (branches.length > MAX_SOURCES) conflicts.push(`Rename scope exceeds ${MAX_SOURCES} writing branches`);
    const buildUnits = await db.buildManuscriptUnit.findMany({
      where: { projectId, invalidatedAt: null, ...(input.buildRunId ? { buildRunId: input.buildRunId } : {}) },
      select: { id: true, branchId: true, buildRunId: true, kind: true, key: true, title: true, metadata: true, revision: true },
      orderBy: { id: 'asc' }, take: MAX_SOURCES + 1
    });
    if (buildUnits.length > MAX_SOURCES) conflicts.push(`Rename scope exceeds ${MAX_SOURCES} build units`);
    const unitByBranch = new Map(buildUnits.map((unit) => [unit.branchId, unit]));
    const canonicalDescriptors = await writingDescriptors(db, projectId, branches.map((branch) => branch.writingId));
    const eligibleBranches = branches.filter((branch) => {
      if (branch.buildRunId === null) return input.scope !== 'build' && branch.writing.defaultBranchId === branch.id;
      if (input.scope === 'main') return false;
      const unit = unitByBranch.get(branch.id);
      return Boolean(unit && (!input.buildRunId || unit.buildRunId === input.buildRunId));
    });
    for (const branch of eligibleBranches) {
      const body = branch.headVersion?.body ?? '';
      const unit = unitByBranch.get(branch.id);
      const descriptor: EntityDescriptor = unit ? {
        entityType: `build-${unit.kind.toLowerCase()}`,
        entityId: unit.id,
        title: unit.title,
        unitId: unit.id,
        buildRunId: unit.buildRunId
      } : canonicalDescriptors.get(branch.writingId) ?? { entityType: 'writing', entityId: branch.writingId, title: branch.writing.kind, unitId: null, buildRunId: null };
      const found = matches(body, selectedNames, input.newName, input.caseSensitive);
      if (!found.length) { scannedBytes += Buffer.byteLength(body); continue; }
      add({ kind: unit ? 'build-writing' : 'canonical-writing', entityType: descriptor.entityType, entityId: descriptor.entityId, title: descriptor.title, writingId: branch.writingId, branchId: branch.id, versionId: branch.headVersionId, buildRunId: descriptor.buildRunId, artifactId: null, unitId: descriptor.unitId, field: 'body' }, body);
      branchChanges.push({ writingId: branch.writingId, branchId: branch.id, versionId: branch.headVersionId!, bodyHash: stableHash(body), body, nextBody: replaceText(body, selectedNames, input.newName, input.caseSensitive) });
    }

    const structuredChanges: StructuredChange[] = [];
    if (input.scope !== 'build') {
      const [chapters, scenes, docs] = await Promise.all([
        db.chapter.findMany({ where: { projectId, deletedAt: null }, select: { id: true, title: true, updatedAt: true }, take: MAX_SOURCES + 1 }),
        db.scene.findMany({ where: { chapter: { projectId } }, select: { id: true, title: true, revision: true }, take: MAX_SOURCES + 1 }),
        db.projectDoc.findMany({ where: { projectId }, select: { id: true, title: true, updatedAt: true }, take: MAX_SOURCES + 1 })
      ]);
      if ([chapters, scenes, docs].some((rows) => rows.length > MAX_SOURCES)) conflicts.push(`Rename scope exceeds ${MAX_SOURCES} structured labels of one kind`);
      for (const chapter of chapters.slice(0, MAX_SOURCES)) this.addLabelChange(chapter.title, 'chapter', chapter.id, chapter.title, chapter.updatedAt.toISOString(), input, selectedNames, add, expectedRevisions, structuredChanges);
      for (const scene of scenes.slice(0, MAX_SOURCES)) if (scene.title) this.addLabelChange(scene.title, 'scene', scene.id, scene.title, String(scene.revision), input, selectedNames, add, expectedRevisions, structuredChanges);
      for (const doc of docs.slice(0, MAX_SOURCES)) this.addLabelChange(doc.title, 'project-doc', doc.id, doc.title, doc.updatedAt.toISOString(), input, selectedNames, add, expectedRevisions, structuredChanges);
    }
    if (input.scope !== 'main') {
      for (const unit of buildUnits.slice(0, MAX_SOURCES)) {
        scannedBytes += Buffer.byteLength(JSON.stringify(unit.metadata));
        const transformed = transformJson(unit.metadata as JsonValue, selectedNames, input.newName, input.caseSensitive, `metadata`, (field, value) => add({ kind: 'structured-label', entityType: 'build-unit', entityId: unit.id, title: unit.title, writingId: null, branchId: unit.branchId, versionId: null, buildRunId: unit.buildRunId, artifactId: null, unitId: unit.id, field }, value));
        const nextTitle = replaceText(unit.title, selectedNames, input.newName, input.caseSensitive);
        if (nextTitle !== unit.title) add({ kind: 'structured-label', entityType: 'build-unit', entityId: unit.id, title: unit.title, writingId: null, branchId: unit.branchId, versionId: null, buildRunId: unit.buildRunId, artifactId: null, unitId: unit.id, field: 'title' }, unit.title);
        if (nextTitle !== unit.title || stableHash(transformed) !== stableHash(unit.metadata)) {
          const revision = String(unit.revision); expectedRevisions[`unit:${unit.id}`] = revision;
          structuredChanges.push({ kind: 'unit', id: unit.id, revision, title: nextTitle, metadata: transformed });
        }
      }
      const artifacts = await db.storyArtifact.findMany({ where: {
        projectId, invalidatedAt: null, status: { notIn: ['SUPERSEDED', 'INVALIDATED'] }, ...(input.buildRunId ? { buildRunId: input.buildRunId } : {})
      }, orderBy: { id: 'asc' }, take: MAX_SOURCES + 1 });
      if (artifacts.length > MAX_SOURCES) conflicts.push(`Rename scope exceeds ${MAX_SOURCES} active artifacts`);
      for (const artifact of artifacts.slice(0, MAX_SOURCES)) {
        scannedBytes += Buffer.byteLength(JSON.stringify(artifact.content));
        const nextTitle = replaceText(artifact.title, selectedNames, input.newName, input.caseSensitive);
        if (nextTitle !== artifact.title) add({ kind: 'artifact', entityType: 'story-artifact', entityId: artifact.id, title: artifact.title, writingId: null, branchId: null, versionId: null, buildRunId: artifact.buildRunId, artifactId: artifact.id, unitId: null, field: 'title' }, artifact.title);
        const transformed = transformJson(artifact.content as JsonValue, selectedNames, input.newName, input.caseSensitive, 'content', (field, value) => add({ kind: 'artifact', entityType: 'story-artifact', entityId: artifact.id, title: artifact.title, writingId: null, branchId: null, versionId: null, buildRunId: artifact.buildRunId, artifactId: artifact.id, unitId: null, field }, value));
        if (nextTitle !== artifact.title || stableHash(transformed) !== stableHash(artifact.content)) {
          const revision = `${artifact.updatedAt.toISOString()}:${artifact.contentHash}`; expectedRevisions[`artifact:${artifact.id}`] = revision;
          structuredChanges.push({ kind: 'artifact', id: artifact.id, revision, expectedUpdatedAt: artifact.updatedAt, previousContentHash: artifact.contentHash, title: nextTitle, content: transformed, contentHash: stableHash(transformed) });
        }
      }
    }
    if (scannedBytes > MAX_SCAN_BYTES) conflicts.push('Rename scope exceeds the 50 MB scan limit');
    if (totalOccurrences > MAX_OCCURRENCES) conflicts.push(`Rename affects more than ${MAX_OCCURRENCES} occurrences; narrow the scope`);

    const expectedHeads: RenameSymbolExpectedHead[] = branchChanges.map(({ writingId, branchId, versionId, bodyHash }) => ({ writingId, branchId, versionId, bodyHash })).sort((a, b) => a.branchId.localeCompare(b.branchId));
    occurrences.sort((a, b) => a.kind.localeCompare(b.kind) || a.entityType.localeCompare(b.entityType) || a.entityId.localeCompare(b.entityId) || a.field.localeCompare(b.field) || a.start - b.start);
    const hashPayload = { projectId, targetType: input.targetType, targetId: input.targetId, oldName: entity.name, aliases: entity.aliases, newName: input.newName, scope: input.scope, buildRunId: input.buildRunId ?? null, caseSensitive: input.caseSensitive, selectedNames, totalOccurrences, expectedHeads, expectedRevisions, expectedEntityUpdatedAt: entity.updatedAt.toISOString(), conflicts };
    const preview: RenameSymbolPreview = {
      ...hashPayload,
      occurrences: occurrences.slice(0, Math.min(input.limit ?? 500, MAX_PREVIEW_OCCURRENCES)),
      truncated: totalOccurrences > Math.min(input.limit ?? 500, MAX_PREVIEW_OCCURRENCES),
      previewHash: stableHash(hashPayload)
    };
    return { preview, entity, branchChanges, structuredChanges };
  }

  private addLabelChange(value: string, kind: 'chapter' | 'scene' | 'project-doc', id: string, title: string, revision: string, input: PreviewRenameSymbolInput, names: string[], add: (base: Omit<RenameSymbolOccurrence, 'id' | 'start' | 'end' | 'matchedText' | 'beforeSnippet' | 'afterSnippet'>, value: string) => void, expected: Record<string, string>, changes: StructuredChange[]) {
    const next = replaceText(value, names, input.newName, input.caseSensitive); if (next === value) return;
    add({ kind: 'structured-label', entityType: kind, entityId: id, title, writingId: null, branchId: null, versionId: null, buildRunId: null, artifactId: null, unitId: null, field: 'title' }, value);
    expected[`${kind}:${id}`] = revision; changes.push({ kind, id, revision, title: next } as StructuredChange);
  }

  private async target(db: Db, projectId: string, targetType: PreviewRenameSymbolInput['targetType'], targetId: string): Promise<TargetEntity> {
    const row = targetType === 'character'
      ? await db.character.findFirst({ where: { id: targetId, projectId }, select: { id: true, name: true, aliases: true, updatedAt: true } })
      : await db.location.findFirst({ where: { id: targetId, projectId }, select: { id: true, name: true, aliases: true, updatedAt: true } });
    if (!row) throw new HttpError(404, `${targetType === 'character' ? 'Character' : 'Location'} not found`);
    return row;
  }

  private async duplicateConflicts(db: Db, projectId: string, input: PreviewRenameSymbolInput, entity: TargetEntity): Promise<string[]> {
    const rows = input.targetType === 'character'
      ? await db.character.findMany({ where: { projectId, id: { not: entity.id } }, select: { id: true, name: true, aliases: true } })
      : await db.location.findMany({ where: { projectId, id: { not: entity.id } }, select: { id: true, name: true, aliases: true } });
    const normalized = input.newName.toLocaleLowerCase();
    return rows.some((row) => [row.name, ...row.aliases].some((name) => name.toLocaleLowerCase() === normalized))
      ? [`Another ${input.targetType} already uses '${input.newName}' as a canonical name or alias`]
      : [];
  }
}

function validateInput(input: PreviewRenameSymbolInput): PreviewRenameSymbolInput {
  if (!['character', 'location'].includes(input.targetType)) throw new HttpError(400, 'Rename targetType must be character or location');
  if (!['main', 'build', 'all'].includes(input.scope)) throw new HttpError(400, 'Rename scope must be main, build, or all');
  const newName = requiredText(input.newName, 'New name', MAX_NAME_LENGTH);
  const targetId = requiredText(input.targetId, 'Target ID', 500);
  if (typeof input.caseSensitive !== 'boolean') throw new HttpError(400, 'caseSensitive must be explicitly true or false');
  if (!Array.isArray(input.includeAliases)) throw new HttpError(400, 'includeAliases must be an explicit array');
  const limit = input.limit ?? 500;
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_PREVIEW_OCCURRENCES) throw new HttpError(400, `Rename preview limit must be between 1 and ${MAX_PREVIEW_OCCURRENCES}`);
  return { ...input, targetId, newName, buildRunId: input.buildRunId ?? null, includeAliases: uniqueNames(input.includeAliases), limit };
}

function requiredText(value: unknown, label: string, max: number): string {
  if (typeof value !== 'string' || !value.trim()) throw new HttpError(400, `${label} is required`);
  const result = value.trim(); if (result.length > max) throw new HttpError(400, `${label} is too long`);
  if (/\p{C}/u.test(result)) throw new HttpError(400, `${label} contains unsupported control characters`);
  return result;
}

function uniqueNames(values: string[]): string[] {
  const seen = new Set<string>(); const result: string[] = [];
  for (const value of values) { const key = value.toLocaleLowerCase(); if (!seen.has(key)) { seen.add(key); result.push(value); } }
  return result;
}

function matches(value: string, names: string[], replacement: string, caseSensitive: boolean) {
  if (!value || !names.length) return [] as Array<{ start: number; end: number; matchedText: string; beforeSnippet: string; afterSnippet: string }>;
  const pattern = names.map(escapeRegex).sort((a, b) => b.length - a.length).join('|');
  const regex = new RegExp(pattern, caseSensitive ? 'gu' : 'giu');
  const result = [] as Array<{ start: number; end: number; matchedText: string; beforeSnippet: string; afterSnippet: string }>;
  for (const match of value.matchAll(regex)) {
    const start = match.index; const end = start + match[0].length;
    const left = start ? Array.from(value.slice(0, start)).at(-1) ?? '' : '';
    const right = end < value.length ? Array.from(value.slice(end))[0] ?? '' : '';
    if ((left && isWord(left)) || (right && isWord(right))) continue;
    const from = Math.max(0, start - 70); const to = Math.min(value.length, end + 70);
    result.push({ start, end, matchedText: match[0], beforeSnippet: value.slice(from, to), afterSnippet: `${value.slice(from, start)}${replacement}${value.slice(end, to)}` });
  }
  return result;
}

function replaceText(value: string, names: string[], replacement: string, caseSensitive: boolean): string {
  const found = matches(value, names, replacement, caseSensitive); if (!found.length) return value;
  let result = ''; let cursor = 0;
  for (const match of found) { result += value.slice(cursor, match.start) + replacement; cursor = match.end; }
  return result + value.slice(cursor);
}

function transformJson(value: JsonValue, names: string[], replacement: string, caseSensitive: boolean, path: string, onString: (path: string, value: string) => void): JsonValue {
  if (typeof value === 'string') { const next = replaceText(value, names, replacement, caseSensitive); if (next !== value) onString(path, value); return next; }
  if (Array.isArray(value)) return value.map((item, index) => transformJson(item, names, replacement, caseSensitive, `${path}[${index}]`, onString));
  if (!value || typeof value !== 'object') return value;
  const output: Record<string, JsonValue> = {};
  for (const [key, child] of Object.entries(value)) output[key] = skipStructuredKey(key) ? child : transformJson(child, names, replacement, caseSensitive, `${path}.${key}`, onString);
  return output;
}

function skipStructuredKey(key: string): boolean {
  const lower = key.toLocaleLowerCase();
  return lower === 'id' || lower === 'key' || lower === 'aliases' || lower.endsWith('id') || lower.endsWith('ids') || lower.endsWith('key') || lower.endsWith('keys');
}
function escapeRegex(value: string) { return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
function isWord(value: string) { return /[\p{L}\p{N}_]/u.test(value); }
function json(value: unknown): Prisma.InputJsonValue { return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue; }
function stableHash(value: unknown): string { return createHash('sha256').update(stableStringify(value)).digest('hex'); }
function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([key, child]) => `${JSON.stringify(key)}:${stableStringify(child)}`).join(',')}}`;
  return JSON.stringify(value) ?? 'undefined';
}

async function writingDescriptors(db: Db, projectId: string, writingIds: string[]): Promise<Map<string, EntityDescriptor>> {
  const unique = [...new Set(writingIds)]; const map = new Map<string, EntityDescriptor>();
  if (!unique.length) return map;
  const [chapters, scenes, docs, characters, locations, structures, obstacles] = await Promise.all([
    db.chapter.findMany({ where: { projectId, bodyWritingId: { in: unique }, deletedAt: null }, select: { id: true, title: true, bodyWritingId: true } }),
    db.scene.findMany({ where: { bodyWritingId: { in: unique }, chapter: { projectId } }, select: { id: true, title: true, bodyWritingId: true } }),
    db.projectDoc.findMany({ where: { projectId, bodyWritingId: { in: unique } }, select: { id: true, title: true, bodyWritingId: true } }),
    db.character.findMany({ where: { projectId, OR: [{ descriptionWritingId: { in: unique } }, { appearanceWritingId: { in: unique } }, { motivationWritingId: { in: unique } }, { arcWritingId: { in: unique } }] }, select: { id: true, name: true, descriptionWritingId: true, appearanceWritingId: true, motivationWritingId: true, arcWritingId: true } }),
    db.location.findMany({ where: { projectId, OR: [{ descriptionWritingId: { in: unique } }, { atmosphereWritingId: { in: unique } }, { significanceWritingId: { in: unique } }, { sensoryWritingId: { in: unique } }] }, select: { id: true, name: true, descriptionWritingId: true, atmosphereWritingId: true, significanceWritingId: true, sensoryWritingId: true } }),
    db.storyStructure.findMany({ where: { projectId, OR: [{ loglineWritingId: { in: unique } }, { outlineWritingId: { in: unique } }, { climaxWritingId: { in: unique } }] } }),
    db.obstacle.findMany({ where: { projectId, OR: [{ descriptionWritingId: { in: unique } }, { resolutionWritingId: { in: unique } }] }, select: { id: true, title: true, descriptionWritingId: true, resolutionWritingId: true } })
  ]);
  const put = (writingId: string, entityType: string, entityId: string, title: string) => map.set(writingId, { entityType, entityId, title, unitId: null, buildRunId: null });
  for (const row of chapters) put(row.bodyWritingId, 'chapter', row.id, row.title);
  for (const row of scenes) put(row.bodyWritingId, 'scene', row.id, row.title ?? 'Untitled scene');
  for (const row of docs) put(row.bodyWritingId, 'project-doc', row.id, row.title);
  for (const row of characters) for (const [field, label] of [['descriptionWritingId', 'description'], ['appearanceWritingId', 'appearance'], ['motivationWritingId', 'motivation'], ['arcWritingId', 'arc']] as const) put(row[field], 'character', row.id, `${row.name} · ${label}`);
  for (const row of locations) for (const [field, label] of [['descriptionWritingId', 'description'], ['atmosphereWritingId', 'atmosphere'], ['significanceWritingId', 'significance'], ['sensoryWritingId', 'sensory']] as const) put(row[field], 'location', row.id, `${row.name} · ${label}`);
  for (const row of structures) { put(row.loglineWritingId, 'story-structure', row.id, 'Logline'); put(row.outlineWritingId, 'story-structure', row.id, 'Outline'); put(row.climaxWritingId, 'story-structure', row.id, 'Climax'); }
  for (const row of obstacles) { put(row.descriptionWritingId, 'obstacle', row.id, row.title); put(row.resolutionWritingId, 'obstacle', row.id, row.title); }
  return map;
}

async function retrySerializable<T>(operation: () => Promise<T>): Promise<T> {
  for (let attempt = 0; ; attempt += 1) {
    try { return await operation(); }
    catch (error) {
      if (attempt >= RETRIES - 1 || !isRetryable(error)) throw error;
      await new Promise((resolve) => setTimeout(resolve, 8 * 2 ** attempt + Math.floor(Math.random() * 11)));
    }
  }
}
function isRetryable(error: unknown) {
  return error instanceof Prisma.PrismaClientKnownRequestError && (error.code === 'P2034' || (error.code === 'P2010' && ['40001', '40P01'].includes(String(error.meta?.code))));
}
