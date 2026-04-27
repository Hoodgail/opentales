import { Router } from 'express';
import { SubmissionController } from '../controllers/SubmissionController.js';
import { asyncHandler } from '../http/asyncHandler.js';
import { requireAuth } from '../middleware/authMiddleware.js';

const controller = new SubmissionController();

// Project-scoped: list & create.
export const projectSubmissionRoutes = Router();
projectSubmissionRoutes.use(requireAuth);
projectSubmissionRoutes.get('/:projectId/submissions', asyncHandler(controller.list));
projectSubmissionRoutes.post('/:projectId/submissions', asyncHandler(controller.create));

// Submission-scoped: get / merge / decline / comment.
export const submissionRoutes = Router();
submissionRoutes.use(requireAuth);
submissionRoutes.get('/:submissionId', asyncHandler(controller.get));
submissionRoutes.patch('/:submissionId/merge', asyncHandler(controller.merge));
submissionRoutes.patch('/:submissionId/decline', asyncHandler(controller.decline));
submissionRoutes.post('/:submissionId/comments', asyncHandler(controller.comment));
