import { Prisma, type PrismaClient } from '@prisma/client';
import type { StoryStructure, UpdateStructureInput } from '@opentales/sdk';
import { HttpError } from '../../http/HttpError.js';
import { ProjectAccessRepository } from '../../repositories/ProjectAccessRepository.js';
import { WritingUseCase } from '../writings/WritingUseCase.js';

export class UpdateStructureUseCase {
  private readonly access: ProjectAccessRepository;
  private readonly writingUseCase = new WritingUseCase();

  constructor(private readonly prisma: PrismaClient) {
    this.access = new ProjectAccessRepository(prisma);
  }

  async execute(userId: string, projectId: string, input: UpdateStructureInput): Promise<StoryStructure> {
    await this.access.assertProjectAccess(userId, projectId);

    await this.prisma.$transaction(async (tx) => {
      await tx.project.update({
        where: { id: projectId },
        data: {
          title: input.title,
          genre: input.genre,
          perspective: input.perspective,
          pov: input.pov,
          voice: input.voice,
          tone: input.tone,
          themes: input.themes
        }
      });

      const structure = await tx.storyStructure.findUnique({
        where: { projectId },
        select: { loglineWritingId: true, outlineWritingId: true, climaxWritingId: true }
      });

      if (!structure) {
        throw new HttpError(404, 'Story structure not found');
      }

      await this.updateText(tx, structure.loglineWritingId, input.logline, userId, 'Update logline');
      await this.updateText(tx, structure.outlineWritingId, input.outline, userId, 'Update outline');
      await this.updateText(tx, structure.climaxWritingId, input.climax, userId, 'Update climax');
    });

    return this.reload(projectId);
  }

  private async updateText(
    tx: Prisma.TransactionClient,
    writingId: string,
    body: string | undefined,
    authorId: string,
    message: string
  ) {
    if (body === undefined) return;
    await this.writingUseCase.updateDefaultBranch(tx, { writingId, body, authorId, message });
  }

  private async reload(projectId: string): Promise<StoryStructure> {
    const project = await this.prisma.project.findUniqueOrThrow({
      where: { id: projectId },
      include: {
        storyStructure: {
          include: {
            loglineWriting: { include: { defaultBranch: { include: { headVersion: true } } } },
            outlineWriting: { include: { defaultBranch: { include: { headVersion: true } } } },
            climaxWriting: { include: { defaultBranch: { include: { headVersion: true } } } }
          }
        },
        obstacles: {
          orderBy: { order: 'asc' },
          include: {
            descriptionWriting: { include: { defaultBranch: { include: { headVersion: true } } } },
            resolutionWriting: { include: { defaultBranch: { include: { headVersion: true } } } }
          }
        }
      }
    });
    const structure = project.storyStructure;
    return {
      title: project.title,
      genre: project.genre ?? '',
      perspective: project.perspective ?? '',
      pov: project.pov ?? '',
      voice: project.voice ?? '',
      tone: project.tone ?? '',
      themes: project.themes,
      logline: structure ? currentBody(structure.loglineWriting) : '',
      outline: structure ? currentBody(structure.outlineWriting) : '',
      climax: structure ? currentBody(structure.climaxWriting) : '',
      obstacles: project.obstacles.map((obstacle) => ({
        id: obstacle.id,
        title: obstacle.title,
        type: obstacle.type.toLowerCase() as StoryStructure['obstacles'][number]['type'],
        description: currentBody(obstacle.descriptionWriting),
        resolution: currentBody(obstacle.resolutionWriting)
      }))
    };
  }
}

function currentBody(writing: {
  defaultBranch: { headVersion: { body: string | null } | null } | null;
}): string {
  return writing.defaultBranch?.headVersion?.body ?? '';
}
