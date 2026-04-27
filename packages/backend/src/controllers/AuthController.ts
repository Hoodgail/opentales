import type { Request, Response } from 'express';
import { prisma } from '../config/prisma.js';
import { HttpError } from '../http/HttpError.js';
import { GetCurrentUserUseCase } from '../useCases/auth/GetCurrentUserUseCase.js';
import { LoginUseCase } from '../useCases/auth/LoginUseCase.js';
import { RegisterUseCase } from '../useCases/auth/RegisterUseCase.js';

export class AuthController {
  private readonly registerUseCase = new RegisterUseCase(prisma);
  private readonly loginUseCase = new LoginUseCase(prisma);
  private readonly getCurrentUserUseCase = new GetCurrentUserUseCase(prisma);

  register = async (req: Request, res: Response) => {
    const session = await this.registerUseCase.execute(req.body);
    res.status(201).json(session);
  };

  login = async (req: Request, res: Response) => {
    const session = await this.loginUseCase.execute(req.body);
    res.json(session);
  };

  me = async (req: Request, res: Response) => {
    if (!req.user) {
      throw new HttpError(401, 'Authentication required');
    }

    const user = await this.getCurrentUserUseCase.execute(req.user.id);
    res.json(user);
  };
}
