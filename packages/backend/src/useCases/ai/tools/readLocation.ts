import type { PrismaClient } from '@prisma/client';
import { tool } from 'ai';
import { z } from 'zod';
import { HttpError } from '../../../http/HttpError.js';
import { bodyOf, type ToolContext } from './shared.js';

export function readLocationTool(prisma: PrismaClient, context: ToolContext) {
  return tool({
    description: 'Read a location profile, including description, atmosphere, significance, and sensory details.',
    inputSchema: z.object({ locationId: z.string() }),
    execute: async ({ locationId }) => {
      const location = await prisma.location.findFirst({
        where: { id: locationId, projectId: context.projectId },
        include: {
          descriptionWriting: { include: { defaultBranch: { include: { headVersion: true } } } },
          atmosphereWriting: { include: { defaultBranch: { include: { headVersion: true } } } },
          significanceWriting: { include: { defaultBranch: { include: { headVersion: true } } } },
          sensoryWriting: { include: { defaultBranch: { include: { headVersion: true } } } }
        }
      });
      if (!location) throw new HttpError(404, 'Location not found');
      return {
        id: location.id,
        name: location.name,
        type: location.type,
        description: bodyOf(location.descriptionWriting),
        atmosphere: bodyOf(location.atmosphereWriting),
        significance: bodyOf(location.significanceWriting),
        sensoryDetails: bodyOf(location.sensoryWriting)
      };
    }
  });
}
