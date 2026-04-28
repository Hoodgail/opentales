import type { PrismaClient } from '@prisma/client';
import { tool } from 'ai';
import { HttpError } from '../../../http/HttpError.js';
import { bodyOf, emptyInputSchema, type ToolContext } from './shared.js';

export function readStoryStructureTool(prisma: PrismaClient, context: ToolContext) {
  return tool({
    description: 'Read high-level project structure: genre, premise, outline, climax, themes, obstacles.',
    inputSchema: emptyInputSchema,
    execute: async () => {
      const project = await prisma.project.findUnique({
        where: { id: context.projectId },
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
      if (!project) throw new HttpError(404, 'Project not found');
      return {
        title: project.title,
        genre: project.genre,
        perspective: project.perspective,
        pov: project.pov,
        voice: project.voice,
        tone: project.tone,
        themes: project.themes,
        logline: project.storyStructure ? bodyOf(project.storyStructure.loglineWriting) : '',
        outline: project.storyStructure ? bodyOf(project.storyStructure.outlineWriting) : '',
        climax: project.storyStructure ? bodyOf(project.storyStructure.climaxWriting) : '',
        obstacles: project.obstacles.map((obstacle) => ({
          id: obstacle.id,
          title: obstacle.title,
          type: obstacle.type,
          description: bodyOf(obstacle.descriptionWriting),
          resolution: bodyOf(obstacle.resolutionWriting)
        }))
      };
    }
  });
}
