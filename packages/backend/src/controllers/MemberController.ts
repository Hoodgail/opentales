import type { Request, Response } from 'express';
import type { Role } from '@prisma/client';
import { prisma } from '../config/prisma.js';
import { HttpError } from '../http/HttpError.js';
import { ListMembersUseCase } from '../useCases/members/ListMembersUseCase.js';
import { UpdateMemberRoleUseCase } from '../useCases/members/UpdateMemberRoleUseCase.js';
import { RemoveMemberUseCase } from '../useCases/members/RemoveMemberUseCase.js';
import { CreateInviteUseCase } from '../useCases/members/CreateInviteUseCase.js';
import { RevokeInviteUseCase } from '../useCases/members/RevokeInviteUseCase.js';
import { AcceptInviteUseCase } from '../useCases/members/AcceptInviteUseCase.js';

const ROLES: ReadonlySet<Role> = new Set(['OWNER', 'ADMIN', 'EDITOR', 'VIEWER']);

function parseRole(value: unknown): Role {
  if (typeof value === 'string' && ROLES.has(value as Role)) {
    return value as Role;
  }
  throw new HttpError(400, `Unknown role: ${String(value)}`);
}

export class MemberController {
  private readonly listMembersUseCase = new ListMembersUseCase(prisma);
  private readonly updateRoleUseCase = new UpdateMemberRoleUseCase(prisma);
  private readonly removeMemberUseCase = new RemoveMemberUseCase(prisma);
  private readonly createInviteUseCase = new CreateInviteUseCase(prisma);
  private readonly revokeInviteUseCase = new RevokeInviteUseCase(prisma);
  private readonly acceptInviteUseCase = new AcceptInviteUseCase(prisma);

  list = async (req: Request, res: Response) => {
    res.json(await this.listMembersUseCase.execute(this.userId(req), req.params.projectId));
  };

  updateRole = async (req: Request, res: Response) => {
    const role = parseRole(req.body?.role);
    await this.updateRoleUseCase.execute(
      this.userId(req),
      req.params.projectId,
      req.params.userId,
      role
    );
    res.json(await this.listMembersUseCase.execute(this.userId(req), req.params.projectId));
  };

  remove = async (req: Request, res: Response) => {
    await this.removeMemberUseCase.execute(
      this.userId(req),
      req.params.projectId,
      req.params.userId
    );
    res.json(await this.listMembersUseCase.execute(this.userId(req), req.params.projectId));
  };

  createInvite = async (req: Request, res: Response) => {
    const role = parseRole(req.body?.role);
    res
      .status(201)
      .json(
        await this.createInviteUseCase.execute(this.userId(req), req.params.projectId, {
          username: req.body?.username,
          email: req.body?.email,
          role
        })
      );
  };

  revokeInvite = async (req: Request, res: Response) => {
    await this.revokeInviteUseCase.execute(
      this.userId(req),
      req.params.projectId,
      req.params.inviteId
    );
    res.json(await this.listMembersUseCase.execute(this.userId(req), req.params.projectId));
  };

  acceptInvite = async (req: Request, res: Response) => {
    const token = typeof req.body?.token === 'string' ? req.body.token : null;
    if (!token) throw new HttpError(400, 'Invite token is required');
    res.json(await this.acceptInviteUseCase.execute(this.userId(req), token));
  };

  private userId(req: Request): string {
    if (!req.user) {
      throw new HttpError(401, 'Authentication required');
    }
    return req.user.id;
  }
}
