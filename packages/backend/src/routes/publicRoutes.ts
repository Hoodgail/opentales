import { Router } from 'express';
import { PublicProjectController } from '../controllers/PublicProjectController.js';
import { asyncHandler } from '../http/asyncHandler.js';

const controller = new PublicProjectController();

export const publicRoutes = Router();
// Unauthenticated by design - these are SEO-friendly read pages.
publicRoutes.get('/projects/:orgSlug/:projectSlug', asyncHandler(controller.get));
publicRoutes.get('/projects/:orgSlug/:projectSlug/rss.xml', asyncHandler(controller.rss));

// Beta-reader share links: token-gated, no login required.
publicRoutes.get('/share/:token', asyncHandler(controller.getShareView));
publicRoutes.post('/share/:token/comments', asyncHandler(controller.addShareComment));
