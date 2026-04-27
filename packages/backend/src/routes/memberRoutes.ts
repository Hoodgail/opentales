import { Router } from 'express';
import { MemberController } from '../controllers/MemberController.js';
import { asyncHandler } from '../http/asyncHandler.js';
import { requireAuth } from '../middleware/authMiddleware.js';

const controller = new MemberController();

export const memberRoutes = Router();
memberRoutes.use(requireAuth);
memberRoutes.get('/:projectId/members', asyncHandler(controller.list));
memberRoutes.patch('/:projectId/members/:userId', asyncHandler(controller.updateRole));
memberRoutes.delete('/:projectId/members/:userId', asyncHandler(controller.remove));
memberRoutes.post('/:projectId/invites', asyncHandler(controller.createInvite));
memberRoutes.delete('/:projectId/invites/:inviteId', asyncHandler(controller.revokeInvite));

export const inviteRoutes = Router();
inviteRoutes.use(requireAuth);
inviteRoutes.post('/accept', asyncHandler(controller.acceptInvite));
