import { Router } from 'express';
import { ShareLinkController } from '../controllers/ShareLinkController.js';
import { asyncHandler } from '../http/asyncHandler.js';
import { requireAuth } from '../middleware/authMiddleware.js';

const controller = new ShareLinkController();

export const shareLinkRoutes = Router();
shareLinkRoutes.use(requireAuth);
shareLinkRoutes.get('/:projectId/share-links', asyncHandler(controller.list));
shareLinkRoutes.post('/:projectId/share-links', asyncHandler(controller.create));
shareLinkRoutes.patch(
  '/:projectId/share-links/:shareLinkId',
  asyncHandler(controller.update)
);
shareLinkRoutes.delete(
  '/:projectId/share-links/:shareLinkId',
  asyncHandler(controller.revoke)
);
