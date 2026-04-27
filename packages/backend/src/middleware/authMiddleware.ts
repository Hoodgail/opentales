import type { NextFunction, Request, Response } from 'express';
import { prisma } from '../config/prisma.js';
import { HttpError } from '../http/HttpError.js';
import { verifyAuthToken } from '../utils/authToken.js';

declare global {
  namespace Express {
    interface Request {
      user?: {
        id: string;
        username: string;
        email: string;
        name: string | null;
      };
    }
  }
}

export async function requireAuth(req: Request, _res: Response, next: NextFunction) {
  try {
    const header = req.header('authorization');
    const token = header?.startsWith('Bearer ') ? header.slice('Bearer '.length) : undefined;
    if (!token) {
      throw new HttpError(401, 'Authentication required');
    }

    const payload = verifyAuthToken(token);
    const user = await prisma.user.findUnique({
      where: { id: payload.userId },
      select: { id: true, username: true, email: true, name: true }
    });

    if (!user) {
      throw new HttpError(401, 'Invalid authentication token');
    }

    req.user = user;
    next();
  } catch (error) {
    next(error instanceof HttpError ? error : new HttpError(401, 'Invalid authentication token'));
  }
}
