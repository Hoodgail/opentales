import bcrypt from 'bcryptjs';
import type { PrismaClient } from '@prisma/client';
import type { AuthSession } from '@opentales/sdk';
import { HttpError } from '../../http/HttpError.js';
import { signAuthToken } from '../../utils/authToken.js';

export interface LoginInput {
  emailOrUsername: string;
  password: string;
}

export class LoginUseCase {
  constructor(private readonly prisma: PrismaClient) {}

  async execute(input: LoginInput): Promise<AuthSession> {
    const identifier = input.emailOrUsername.trim().toLowerCase();
    const user = await this.prisma.user.findFirst({
      where: {
        OR: [{ email: identifier }, { username: identifier }]
      }
    });

    if (!user) {
      throw new HttpError(401, 'Invalid credentials');
    }

    const isValid = await bcrypt.compare(input.password, user.passwordHash);
    if (!isValid) {
      throw new HttpError(401, 'Invalid credentials');
    }

    return {
      token: signAuthToken({ userId: user.id }),
      user: {
        id: user.id,
        username: user.username,
        email: user.email,
        name: user.name,
        createdAt: user.createdAt.toISOString()
      }
    };
  }
}
