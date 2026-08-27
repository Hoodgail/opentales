import { randomUUID } from 'node:crypto';
import { Prisma, type PrismaClient, type ProjectExport as PrismaProjectExport } from '@prisma/client';
import type {
  CreateProjectExportInput,
  JsonValue,
  ProjectExport,
  ProjectExportFormat,
  ProjectExportOptions,
  RegenerateProjectExportInput
} from '@opentales/sdk';
import { z } from 'zod';
import { env } from '../../config/env.js';
import { HttpError } from '../../http/HttpError.js';
import { LocalAssetStorage } from '../../repositories/AssetStorage.js';
import { ProjectAccessRepository } from '../../repositories/ProjectAccessRepository.js';
import { BuildManuscriptUseCase } from '../novelBuild/BuildManuscriptUseCase.js';
import { stableHash } from '../novelBuild/schemas.js';
import {
  generateDocx,
  generateEpub,
  generateHtml,
  generateMarkdownBundle,
  generatePdf,
  generatePlainText,
  generateProjectArchive,
  safeFilename,
  sha256,
  type GeneratedExport,
  type ManuscriptRenderOptions,
  type ManuscriptSnapshot
} from './exportFormats.js';
import { ManuscriptSnapshotService } from './ManuscriptSnapshotService.js';

const MAX_EXPORT_BYTES = 120 * 1024 * 1024;

const createSchema = z.object({
  idempotencyKey: z.string().trim().min(1).max(500),
  format: z.enum(['docx', 'pdf', 'epub', 'markdown', 'text', 'html', 'project-archive']),
  preset: z.enum(['standard-manuscript', 'reading-copy', 'ebook', 'web', 'archive']),
  target: z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('main') }).strict(),
    z.object({ kind: z.literal('build'), buildRunId: z.string().trim().min(1), compilationId: z.string().trim().min(1).nullable().optional() }).strict()
  ]),
  options: z.object({
    authorName: z.string().trim().min(1).max(500).optional(),
    includeTitlePage: z.boolean().optional(),
    includeAssets: z.boolean().optional(),
    chapterNumbering: z.boolean().optional()
  }).strict().default({})
}).strict();

export class ProjectExportUseCase {
  private readonly access: ProjectAccessRepository;
  private readonly storage = new LocalAssetStorage();
  private readonly snapshots: ManuscriptSnapshotService;
  private readonly manuscripts: BuildManuscriptUseCase;

  constructor(private readonly prisma: PrismaClient) {
    this.access = new ProjectAccessRepository(prisma);
    this.snapshots = new ManuscriptSnapshotService(prisma);
    this.manuscripts = new BuildManuscriptUseCase(prisma);
  }

  async list(userId: string, projectId: string): Promise<ProjectExport[]> {
    await this.access.assertProjectAccess(userId, projectId);
    const rows = await this.prisma.projectExport.findMany({ where: { projectId }, orderBy: { createdAt: 'desc' } });
    return rows.map(toProjectExport);
  }

  async create(userId: string, projectId: string, rawInput: CreateProjectExportInput, regeneratedFromId?: string): Promise<ProjectExport> {
    await this.access.assertPermission(userId, projectId, 'project:write');
    let input: z.infer<typeof createSchema>;
    try { input = createSchema.parse(rawInput); }
    catch (error) { throw new HttpError(400, error instanceof Error ? error.message : 'Invalid export request'); }
    if (input.target.kind === 'build') await this.access.assertPermission(userId, projectId, 'project:admin');
    const requestHash = stableHash(input);
    const prior = await this.prisma.projectExport.findUnique({ where: { projectId_idempotencyKey: { projectId, idempotencyKey: input.idempotencyKey } } });
    if (prior) {
      if (prior.requestHash !== requestHash) throw new HttpError(409, 'Export idempotency key was reused with different input');
      return toProjectExport(prior);
    }
    const placeholderName = `${safeFilename((await this.projectTitle(projectId)))}.${extensionFor(input.format)}`;
    let row: PrismaProjectExport;
    try {
      row = await this.prisma.projectExport.create({
        data: {
          projectId,
          buildRunId: input.target.kind === 'build' ? input.target.buildRunId : null,
          compilationId: input.target.kind === 'build' ? input.target.compilationId ?? null : null,
          requestedById: userId,
          regeneratedFromId: regeneratedFromId ?? null,
          idempotencyKey: input.idempotencyKey,
          requestHash,
          target: input.target.kind === 'build' ? 'BUILD' : 'MAIN',
          format: toPrismaFormat(input.format),
          preset: toPrismaPreset(input.preset),
          filename: placeholderName,
          options: json(input.options),
          provenance: {},
          branchHeads: {}
        }
      });
    } catch (error) {
      const replay = await this.prisma.projectExport.findUnique({ where: { projectId_idempotencyKey: { projectId, idempotencyKey: input.idempotencyKey } } });
      if (replay?.requestHash === requestHash) return toProjectExport(replay);
      throw error;
    }
    let asset: { id: string; s3Key: string } | null = null;
    try {
      await this.prisma.projectExport.update({ where: { id: row.id }, data: { status: 'GENERATING' } });
      const snapshot = await this.resolveSnapshot(userId, projectId, input);
      validateSnapshotBounds(snapshot);
      const generated = await this.generate(input.format, snapshot, { ...input.options, preset: input.preset });
      if (!generated.buffer.length) throw new Error('Exporter produced an empty file');
      if (generated.buffer.length > MAX_EXPORT_BYTES) throw new HttpError(413, 'Generated export exceeds the 120 MB limit');
      const checksum = sha256(generated.buffer);
      const filename = `${safeFilename(snapshot.projectTitle)}-${input.preset}.${generated.extension}`;
      asset = await this.persistPrivateAsset(userId, projectId, filename, generated.mimeType, generated.buffer, checksum);
      const provenance = {
        generator: 'opentales-export-v1',
        generatedAt: new Date().toISOString(),
        target: snapshot.target,
        buildRunId: snapshot.buildRunId,
        compilationId: snapshot.compilationId,
        branchName: snapshot.branchName,
        contentHash: snapshot.contentHash,
        totalWordCount: snapshot.totalWordCount,
        validation: generated.validation
      };
      row = await this.prisma.projectExport.update({
        where: { id: row.id },
        data: {
          buildRunId: snapshot.buildRunId,
          compilationId: snapshot.compilationId,
          assetId: asset.id,
          status: 'READY',
          filename,
          mimeType: generated.mimeType,
          checksum,
          sizeBytes: BigInt(generated.buffer.length),
          provenance: json(provenance),
          branchHeads: json(snapshot.branchHeads),
          error: null,
          generatedAt: new Date()
        }
      });
      if (snapshot.target === 'build' && snapshot.buildRunId && snapshot.compilationId) {
        const manifest = await this.registerVerifiedBuildOutputs(userId, projectId, snapshot.buildRunId, snapshot.compilationId, row.id);
        row = await this.prisma.projectExport.update({
          where: { id: row.id },
          data: { provenance: json({ ...provenance, exportManifestArtifactId: manifest.id }) }
        });
      }
      return toProjectExport(row);
    } catch (error) {
      if (asset) await this.deleteAssetBytesAndRow(asset).catch(() => undefined);
      const message = error instanceof Error ? error.message : 'Export generation failed';
      row = await this.prisma.projectExport.update({ where: { id: row.id }, data: { assetId: null, status: 'FAILED', error: message } });
      if (error instanceof HttpError) throw error;
      throw new HttpError(500, message);
    }
  }

  async regenerate(userId: string, projectId: string, exportId: string, input: RegenerateProjectExportInput): Promise<ProjectExport> {
    const existing = await this.requireExport(userId, projectId, exportId);
    if (existing.status === 'DELETED') throw new HttpError(409, 'Deleted exports cannot be regenerated');
    const options = objectValue(existing.options) as ProjectExportOptions;
    return this.create(userId, projectId, {
      idempotencyKey: required(input.idempotencyKey, 'Idempotency key'),
      format: fromPrismaFormat(existing.format),
      preset: existing.preset.toLowerCase().replaceAll('_', '-') as CreateProjectExportInput['preset'],
      target: existing.target === 'BUILD'
        ? { kind: 'build', buildRunId: existing.buildRunId!, compilationId: existing.compilationId }
        : { kind: 'main' },
      options
    }, existing.id);
  }

  async delete(userId: string, projectId: string, exportId: string): Promise<ProjectExport> {
    await this.access.assertPermission(userId, projectId, 'project:write');
    const existing = await this.prisma.projectExport.findFirst({ where: { id: exportId, projectId } });
    if (!existing) throw new HttpError(404, 'Export not found');
    if (existing.status === 'DELETED') return toProjectExport(existing);
    let key: string | null = null;
    const updated = await this.prisma.$transaction(async (tx) => {
      const locked = await tx.projectExport.findFirst({ where: { id: exportId, projectId } });
      if (!locked) throw new HttpError(404, 'Export not found');
      if (locked.assetId) {
        const asset = await tx.asset.findUnique({ where: { id: locked.assetId } });
        key = asset?.s3Key ?? null;
        const manifests = await tx.storyArtifact.findMany({ where: { projectId, type: 'EXPORT_MANIFEST', invalidatedAt: null } });
        for (const manifest of manifests) {
          const outputs = Array.isArray(objectValue(manifest.content).outputs) ? objectValue(manifest.content).outputs as unknown[] : [];
          if (!outputs.some((output) => objectValue(output).assetId === locked.assetId)) continue;
          await tx.storyArtifact.update({ where: { id: manifest.id }, data: { status: 'INVALIDATED', invalidatedAt: new Date() } });
          await tx.buildCompilation.updateMany({ where: { exportManifestArtifactId: manifest.id }, data: { exportManifestArtifactId: null } });
        }
        await tx.asset.delete({ where: { id: locked.assetId } });
      }
      return tx.projectExport.update({ where: { id: exportId }, data: { assetId: null, status: 'DELETED', deletedAt: new Date() } });
    });
    if (key) await this.storage.delete(key).catch(() => undefined);
    return toProjectExport(updated);
  }

  async download(userId: string, projectId: string, exportId: string) {
    await this.access.assertProjectAccess(userId, projectId);
    const row = await this.prisma.projectExport.findFirst({
      where: { id: exportId, projectId, status: 'READY', deletedAt: null },
      include: { asset: true }
    });
    if (!row?.asset || row.asset.isPublic) throw new HttpError(404, 'Export file not found');
    if (row.asset.s3Bucket !== LocalAssetStorage.bucket) throw new HttpError(501, 'Export is stored in an unsupported bucket');
    return {
      filename: row.filename,
      mimeType: row.mimeType ?? row.asset.mimeType,
      sizeBytes: row.asset.sizeBytes,
      checksum: row.checksum,
      stream: await this.storage.readStream(row.asset.s3Key)
    };
  }

  private async resolveSnapshot(userId: string, projectId: string, input: z.infer<typeof createSchema>): Promise<ManuscriptSnapshot> {
    if (input.target.kind === 'main') return this.snapshots.main(projectId, input.options.authorName);
    let compilationId = input.target.compilationId ?? null;
    if (!compilationId) {
      const run = await this.prisma.buildRun.findFirst({ where: { id: input.target.buildRunId, projectId }, select: { revision: true } });
      if (!run) throw new HttpError(404, 'Build run not found');
      const compilation = await this.manuscripts.compile(userId, projectId, input.target.buildRunId, {
        idempotencyKey: `project-export:${randomUUID()}:compile`,
        expectedBuildRevision: run.revision
      });
      compilationId = compilation.id;
    }
    return this.snapshots.build(projectId, input.target.buildRunId, compilationId, input.options.authorName);
  }

  private async generate(format: ProjectExportFormat, snapshot: ManuscriptSnapshot, options: ManuscriptRenderOptions): Promise<GeneratedExport> {
    if (format === 'docx') return generateDocx(snapshot, options);
    if (format === 'pdf') return generatePdf(snapshot, options);
    if (format === 'epub') return generateEpub(snapshot, options);
    if (format === 'markdown') return generateMarkdownBundle(snapshot, options);
    if (format === 'text') return generatePlainText(snapshot, options);
    if (format === 'html') return generateHtml(snapshot, options);
    const archive = await this.snapshots.projectArchive(snapshot, options.includeAssets !== false);
    return generateProjectArchive(archive.payload, archive.assetFiles);
  }

  private async registerVerifiedBuildOutputs(userId: string, projectId: string, buildRunId: string, compilationId: string, currentExportId: string) {
    const ready = await this.prisma.projectExport.findMany({
      where: { projectId, buildRunId, compilationId, status: 'READY', assetId: { not: null }, deletedAt: null },
      orderBy: { generatedAt: 'desc' }
    });
    const latest = new Map<string, PrismaProjectExport>();
    for (const item of ready) if (!latest.has(item.format)) latest.set(item.format, item);
    const outputs = [...latest.values()].map((item) => ({
      projectExportId: item.id,
      format: fromPrismaFormat(item.format),
      assetId: item.assetId!,
      mimeType: item.mimeType!,
      checksum: item.checksum
    }));
    const run = await this.prisma.buildRun.findFirst({ where: { id: buildRunId, projectId }, select: { revision: true } });
    if (!run) throw new HttpError(404, 'Build run not found');
    return this.manuscripts.registerExport(userId, projectId, buildRunId, {
      idempotencyKey: `project-export:${currentExportId}:register`,
      expectedBuildRevision: run.revision,
      compilationId,
      outputs
    });
  }

  private async persistPrivateAsset(userId: string, projectId: string, filename: string, mimeType: string, buffer: Buffer, checksum: string) {
    const created = await this.prisma.asset.create({
      data: {
        projectId,
        kind: mimeType.startsWith('text/') ? 'TEXT_BLOB' : 'DOCUMENT',
        s3Bucket: LocalAssetStorage.bucket,
        s3Key: `pending/export/${randomUUID()}`,
        mimeType,
        sizeBytes: BigInt(buffer.length),
        checksum,
        isPublic: false,
        uploadedById: userId,
        name: filename
      }
    });
    try {
      const stored = await this.storage.write(projectId, created.id, extensionForFilename(filename), buffer);
      return await this.prisma.asset.update({ where: { id: created.id }, data: { s3Key: stored.key, sizeBytes: stored.sizeBytes } });
    } catch (error) {
      await this.prisma.asset.deleteMany({ where: { id: created.id } });
      throw error;
    }
  }

  private async deleteAssetBytesAndRow(asset: { id: string; s3Key: string }) {
    await this.prisma.asset.deleteMany({ where: { id: asset.id } });
    await this.storage.delete(asset.s3Key);
  }

  private async requireExport(userId: string, projectId: string, exportId: string) {
    await this.access.assertProjectAccess(userId, projectId);
    const row = await this.prisma.projectExport.findFirst({ where: { id: exportId, projectId } });
    if (!row) throw new HttpError(404, 'Export not found');
    return row;
  }

  private async projectTitle(projectId: string): Promise<string> {
    const project = await this.prisma.project.findUnique({ where: { id: projectId }, select: { title: true } });
    if (!project) throw new HttpError(404, 'Project not found');
    return project.title;
  }
}

function toProjectExport(row: PrismaProjectExport): ProjectExport {
  return {
    id: row.id,
    projectId: row.projectId,
    buildRunId: row.buildRunId,
    compilationId: row.compilationId,
    assetId: row.assetId,
    regeneratedFromId: row.regeneratedFromId,
    target: row.target.toLowerCase() as ProjectExport['target'],
    format: fromPrismaFormat(row.format),
    preset: row.preset.toLowerCase().replaceAll('_', '-') as ProjectExport['preset'],
    status: row.status.toLowerCase() as ProjectExport['status'],
    filename: row.filename,
    mimeType: row.mimeType,
    checksum: row.checksum,
    sizeBytes: row.sizeBytes === null ? null : Number(row.sizeBytes),
    options: objectValue(row.options) as ProjectExportOptions,
    provenance: row.provenance as JsonValue,
    branchHeads: row.branchHeads as JsonValue,
    error: row.error,
    downloadUrl: row.status === 'READY' && !row.deletedAt ? `${env.publicBaseUrl}/projects/${row.projectId}/exports/${row.id}/download` : null,
    generatedAt: row.generatedAt?.toISOString() ?? null,
    deletedAt: row.deletedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString()
  };
}

function toPrismaFormat(format: ProjectExportFormat) {
  return format.toUpperCase().replaceAll('-', '_') as 'DOCX' | 'PDF' | 'EPUB' | 'MARKDOWN' | 'TEXT' | 'HTML' | 'PROJECT_ARCHIVE';
}

function fromPrismaFormat(format: PrismaProjectExport['format']): ProjectExportFormat {
  return format.toLowerCase().replaceAll('_', '-') as ProjectExportFormat;
}

function toPrismaPreset(preset: CreateProjectExportInput['preset']) {
  return preset.toUpperCase().replaceAll('-', '_') as 'STANDARD_MANUSCRIPT' | 'READING_COPY' | 'EBOOK' | 'WEB' | 'ARCHIVE';
}

function extensionFor(format: ProjectExportFormat): string {
  if (format === 'markdown') return 'markdown.zip';
  if (format === 'project-archive') return 'opentales.zip';
  return format === 'text' ? 'txt' : format;
}

function extensionForFilename(filename: string): string {
  return filename.split('.').slice(1).join('.').replace(/[^a-zA-Z0-9.]/g, '').slice(0, 12) || 'bin';
}

function objectValue(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function json(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

function required(value: unknown, label: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new HttpError(400, `${label} is required`);
  return value.trim();
}

function validateSnapshotBounds(snapshot: ManuscriptSnapshot): void {
  if (snapshot.chapters.length > 2_000) throw new HttpError(413, 'Exports are limited to 2,000 chapters');
  const bytes = snapshot.chapters.reduce((sum, chapter) => sum + Buffer.byteLength(chapter.body, 'utf8'), 0);
  if (bytes > 50 * 1024 * 1024) throw new HttpError(413, 'Manuscript prose exceeds the 50 MB export input limit');
}
