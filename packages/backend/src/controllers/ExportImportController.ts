import type { Request, Response } from 'express';
import type { ApplyProjectImportInput, CreateProjectExportInput, RegenerateProjectExportInput } from '@opentales/sdk';
import { prisma } from '../config/prisma.js';
import { HttpError } from '../http/HttpError.js';
import { ProjectExportUseCase } from '../useCases/exportImport/ProjectExportUseCase.js';
import { ProjectImportUseCase } from '../useCases/exportImport/ProjectImportUseCase.js';

export class ExportImportController {
  private readonly exports = new ProjectExportUseCase(prisma);
  private readonly imports = new ProjectImportUseCase(prisma);

  listExports = async (req: Request, res: Response) => {
    res.json(await this.exports.list(this.userId(req), req.params.projectId));
  };

  createExport = async (req: Request, res: Response) => {
    res.status(201).json(await this.exports.create(this.userId(req), req.params.projectId, req.body as CreateProjectExportInput));
  };

  regenerateExport = async (req: Request, res: Response) => {
    res.status(201).json(await this.exports.regenerate(
      this.userId(req), req.params.projectId, req.params.exportId, req.body as RegenerateProjectExportInput
    ));
  };

  deleteExport = async (req: Request, res: Response) => {
    res.json(await this.exports.delete(this.userId(req), req.params.projectId, req.params.exportId));
  };

  downloadExport = async (req: Request, res: Response) => {
    const download = await this.exports.download(this.userId(req), req.params.projectId, req.params.exportId);
    const ascii = download.filename.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_');
    res.setHeader('Content-Type', download.mimeType);
    res.setHeader('Content-Length', download.sizeBytes.toString());
    res.setHeader('Content-Disposition', `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(download.filename)}`);
    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    if (download.checksum) res.setHeader('X-Content-SHA256', download.checksum);
    download.stream.pipe(res);
    download.stream.on('error', () => res.destroy());
  };

  listImports = async (req: Request, res: Response) => {
    res.json(await this.imports.list(this.userId(req), req.params.projectId));
  };

  previewImport = async (req: Request, res: Response) => {
    if (!req.file) throw new HttpError(400, 'Missing import file');
    const idempotencyKey = typeof req.body?.idempotencyKey === 'string' ? req.body.idempotencyKey : '';
    const declaredMimeType = typeof req.body?.mimeType === 'string' ? req.body.mimeType : req.file.mimetype;
    res.status(201).json(await this.imports.preview(this.userId(req), req.params.projectId, {
      idempotencyKey,
      filename: req.file.originalname || 'import',
      mimeType: declaredMimeType,
      buffer: req.file.buffer
    }));
  };

  applyImport = async (req: Request, res: Response) => {
    res.json(await this.imports.apply(
      this.userId(req), req.params.projectId, req.params.importId, req.body as ApplyProjectImportInput
    ));
  };

  private userId(req: Request): string {
    if (!req.user) throw new HttpError(401, 'Authentication required');
    return req.user.id;
  }
}
