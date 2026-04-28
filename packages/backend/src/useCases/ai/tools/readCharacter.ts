import type { PrismaClient } from '@prisma/client';
import { tool } from 'ai';
import { z } from 'zod';
import { HttpError } from '../../../http/HttpError.js';
import { bodyOf, type ToolContext } from './shared.js';

export function readCharacterTool(prisma: PrismaClient, context: ToolContext) {
  return tool({
    description: 'Read a character profile, including description, appearance, motivation, and arc.',
    inputSchema: z.object({ characterId: z.string() }),
    execute: async ({ characterId }) => {
      const character = await prisma.character.findFirst({
        where: { id: characterId, projectId: context.projectId },
        include: {
          descriptionWriting: { include: { defaultBranch: { include: { headVersion: true } } } },
          appearanceWriting: { include: { defaultBranch: { include: { headVersion: true } } } },
          motivationWriting: { include: { defaultBranch: { include: { headVersion: true } } } },
          arcWriting: { include: { defaultBranch: { include: { headVersion: true } } } }
        }
      });
      if (!character) throw new HttpError(404, 'Character not found');
      return {
        id: character.id,
        name: character.name,
        role: character.role,
        age: character.age,
        occupation: character.occupation,
        traits: character.traits,
        description: bodyOf(character.descriptionWriting),
        appearance: bodyOf(character.appearanceWriting),
        motivation: bodyOf(character.motivationWriting),
        arc: bodyOf(character.arcWriting)
      };
    }
  });
}
