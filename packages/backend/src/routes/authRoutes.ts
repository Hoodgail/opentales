import { Router } from 'express';
import { AuthController } from '../controllers/AuthController.js';
import { asyncHandler } from '../http/asyncHandler.js';
import { requireAuth } from '../middleware/authMiddleware.js';

const controller = new AuthController();
export const authRoutes = Router();

authRoutes.post('/register', asyncHandler(controller.register));
authRoutes.post('/login', asyncHandler(controller.login));
authRoutes.get('/me', requireAuth, asyncHandler(controller.me));
