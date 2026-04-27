import bcrypt from 'bcryptjs';
import type { PrismaClient } from '@prisma/client';
import type { AuthSession } from '@opentales/sdk';
import { HttpError } from '../../http/HttpError.js';
import { signAuthToken } from '../../utils/authToken.js';
import { toSlug } from '../../utils/slug.js';

export interface RegisterInput {
  username: string;
  email: string;
  password: string;
  name?: string;
}

export class RegisterUseCase {
  constructor(private readonly prisma: PrismaClient) {}

  async execute(input: RegisterInput): Promise<AuthSession> {
    const username = input.username.trim().toLowerCase();
    const email = input.email.trim().toLowerCase();

    if (username.length < 3) {
      throw new HttpError(400, 'Username must be at least 3 characters');
    }
    if (!email.includes('@')) {
      throw new HttpError(400, 'A valid email is required');
    }
    if (input.password.length < 8) {
      throw new HttpError(400, 'Password must be at least 8 characters');
    }

    const existing = await this.prisma.user.findFirst({
      where: { OR: [{ username }, { email }] }
    });
    if (existing) {
      throw new HttpError(409, 'Username or email is already registered');
    }

    const passwordHash = await bcrypt.hash(input.password, 12);

    const user = await this.prisma.$transaction(async (tx) => {
      const createdUser = await tx.user.create({
        data: {
          username,
          email,
          passwordHash,
          name: input.name?.trim() || username
        }
      });

      const orgName = input.name?.trim() || username;
      const baseSlug = toSlug(orgName) || username;
      const org = await tx.org.create({
        data: {
          slug: `${baseSlug}-${createdUser.id.slice(-6)}`,
          name: `${orgName}'s Workspace`
        }
      });

      await tx.membership.create({
        data: {
          orgId: org.id,
          userId: createdUser.id,
          role: 'OWNER'
        }
      });

      return createdUser;
    });

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
