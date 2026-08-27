import { Router } from 'express';
import { RefactorController } from '../controllers/RefactorController.js';
import { asyncHandler } from '../http/asyncHandler.js';
import { requireAuth } from '../middleware/authMiddleware.js';

const controller = new RefactorController();
export const refactorRoutes = Router();
refactorRoutes.use(requireAuth);
refactorRoutes.post('/:projectId/refactor/rename/preview', asyncHandler(controller.previewRename));
refactorRoutes.post('/:projectId/refactor/rename/apply', asyncHandler(controller.applyRename));
