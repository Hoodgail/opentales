import type { PrismaClient } from '@prisma/client';
import type { AuthUser } from '@opentales/sdk';
import { HttpError } from '../../http/HttpError.js';

export class GetCurrentUserUseCase {
  constructor(private readonly prisma: PrismaClient) {}

  async execute(userId: string): Promise<AuthUser> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, username: true, email: true, name: true, createdAt: true }
    });

    if (!user) {
      throw new HttpError(404, 'User not found');
    }

    return {
      ...user,
      createdAt: user.createdAt.toISOString()
    };
  }
}
