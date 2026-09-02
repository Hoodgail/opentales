import { Prisma, type PrismaClient } from '@prisma/client';
import type { ManuscriptProject, UpdateCharacterRelationshipInput } from '@opentales/sdk';
import { HttpError } from '../../http/HttpError.js';
import { ProjectAccessRepository } from '../../repositories/ProjectAccessRepository.js';
import { reloadManuscript } from './reloadManuscript.js';

export class UpdateCharacterRelationshipUseCase {
  private readonly access: ProjectAccessRepository;

  constructor(private readonly prisma: PrismaClient) {
    this.access = new ProjectAccessRepository(prisma);
  }

  async execute(
    userId: string,
    projectId: string,
    fromCharacterId: string,
    relationshipId: string,
    input: UpdateCharacterRelationshipInput
  ): Promise<ManuscriptProject> {
    await this.access.assertPermission(userId, projectId, 'project:write');
    const relationship = await this.prisma.characterRelationship.findFirst({
      where: { id: relationshipId, projectId, fromCharacterId }
    });
    if (!relationship) throw new HttpError(404, 'Relationship not found');
    const toCharacterId = input.toCharacterId ?? relationship.toCharacterId;
    const type = input.type === undefined ? relationship.type : input.type.trim();
    if (!type) throw new HttpError(400, 'Relationship type is required');
    if (toCharacterId === fromCharacterId) throw new HttpError(400, 'A character cannot have a relationship with themselves');
    const target = await this.prisma.character.findFirst({ where: { id: toCharacterId, projectId }, select: { id: true } });
    if (!target) throw new HttpError(400, 'Related character does not belong to this project');
    try {
      await this.prisma.characterRelationship.update({
        where: { id: relationshipId },
        data: {
          toCharacterId,
          type,
          note: input.note === undefined ? undefined : input.note?.trim() || null
        }
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new HttpError(409, 'Relationship already exists');
      }
      throw error;
    }
    return reloadManuscript(this.prisma, projectId);
  }
}
