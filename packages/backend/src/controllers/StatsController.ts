import type { Request, Response } from 'express';
import { prisma } from '../config/prisma.js';
import { HttpError } from '../http/HttpError.js';
import { GetProjectStatsUseCase } from '../useCases/stats/GetProjectStatsUseCase.js';

export class StatsController {
  private readonly getStatsUseCase = new GetProjectStatsUseCase(prisma);

  get = async (req: Request, res: Response) => {
    const daysParam = typeof req.query.days === 'string' ? Number.parseInt(req.query.days, 10) : null;
    const days = daysParam && Number.isFinite(daysParam) ? Math.min(Math.max(daysParam, 1), 365) : undefined;
    res.json(await this.getStatsUseCase.execute(this.userId(req), req.params.projectId, days));
  };

  private userId(req: Request): string {
    if (!req.user) throw new HttpError(401, 'Authentication required');
    return req.user.id;
  }
}
