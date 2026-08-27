import { Router } from 'express';
import multer from 'multer';
import { ExportImportController } from '../controllers/ExportImportController.js';
import { asyncHandler } from '../http/asyncHandler.js';
import { requireAuth } from '../middleware/authMiddleware.js';

const controller = new ExportImportController();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024, files: 1, fields: 4 }
});

export const exportImportRoutes = Router();
exportImportRoutes.use(requireAuth);

exportImportRoutes.get('/:projectId/exports', asyncHandler(controller.listExports));
exportImportRoutes.post('/:projectId/exports', asyncHandler(controller.createExport));
exportImportRoutes.get('/:projectId/exports/:exportId/download', asyncHandler(controller.downloadExport));
exportImportRoutes.post('/:projectId/exports/:exportId/regenerate', asyncHandler(controller.regenerateExport));
exportImportRoutes.delete('/:projectId/exports/:exportId', asyncHandler(controller.deleteExport));

exportImportRoutes.get('/:projectId/imports', asyncHandler(controller.listImports));
exportImportRoutes.post('/:projectId/imports/preview', upload.single('file'), asyncHandler(controller.previewImport));
exportImportRoutes.post('/:projectId/imports/:importId/apply', asyncHandler(controller.applyImport));
