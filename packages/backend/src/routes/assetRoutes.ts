import { Router } from 'express';
import multer from 'multer';
import { AssetController } from '../controllers/AssetController.js';
import { asyncHandler } from '../http/asyncHandler.js';
import { requireAuth } from '../middleware/authMiddleware.js';

const controller = new AssetController();

// 25 MB limit; in-memory storage (file is then persisted by the use case).
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024 }
});

export const assetUploadRoutes = Router();
assetUploadRoutes.use(requireAuth);
assetUploadRoutes.post(
  '/:projectId/assets',
  upload.single('file'),
  asyncHandler(controller.upload)
);

// Public read: served unauthenticated so <img src> tags work in the browser.
// Anyone with a valid asset id (cuid, ~25 chars of entropy) can fetch the bytes.
export const assetPublicRoutes = Router();
assetPublicRoutes.get('/:assetId', asyncHandler(controller.stream));
