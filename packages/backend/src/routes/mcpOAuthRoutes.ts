import { Router, type NextFunction, type Request, type Response } from 'express';
import { McpOAuthController } from '../controllers/McpOAuthController.js';
import { asyncHandler } from '../http/asyncHandler.js';
import { requireAuth } from '../middleware/authMiddleware.js';

const controller = new McpOAuthController();

export const mcpOAuthPublicRoutes = Router();
mcpOAuthPublicRoutes.get('/.well-known/oauth-protected-resource', asyncHandler(controller.protectedResourceMetadata));
mcpOAuthPublicRoutes.get('/.well-known/oauth-protected-resource/mcp', asyncHandler(controller.protectedResourceMetadata));
mcpOAuthPublicRoutes.get('/.well-known/oauth-authorization-server', asyncHandler(controller.authorizationServerMetadata));
mcpOAuthPublicRoutes.post('/register', limitDynamicRegistration, asyncHandler(controller.register));
mcpOAuthPublicRoutes.post('/token', asyncHandler(controller.token));
mcpOAuthPublicRoutes.post('/revoke', asyncHandler(controller.revoke));

export const mcpOAuthUserRoutes = Router();
mcpOAuthUserRoutes.use(requireAuth);
mcpOAuthUserRoutes.get('/authorize/context', asyncHandler(controller.authorizationContext));
mcpOAuthUserRoutes.post('/authorize', asyncHandler(controller.authorize));

const registrationWindows = new Map<string, { count: number; resetAt: number }>();
const REGISTRATION_WINDOW_MS = 15 * 60 * 1000;
const REGISTRATIONS_PER_WINDOW = 30;

function limitDynamicRegistration(req: Request, res: Response, next: NextFunction): void {
  const now = Date.now();
  const key = req.header('cf-connecting-ip')
    ?? req.header('x-forwarded-for')?.split(',')[0]?.trim()
    ?? req.ip
    ?? 'unknown';
  const current = registrationWindows.get(key);
  const window = !current || current.resetAt <= now
    ? { count: 0, resetAt: now + REGISTRATION_WINDOW_MS }
    : current;
  window.count += 1;
  registrationWindows.set(key, window);
  if (window.count > REGISTRATIONS_PER_WINDOW) {
    res.setHeader('Retry-After', String(Math.max(1, Math.ceil((window.resetAt - now) / 1000))));
    res.status(429).json({ error: 'temporarily_unavailable', error_description: 'Too many client registrations' });
    return;
  }
  next();
}
