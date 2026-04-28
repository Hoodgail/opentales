import type { PrismaClient } from '@prisma/client';
import { grepChapterTool, grepChaptersTool } from './grepChapters.js';
import { listChaptersTool } from './listChapters.js';
import { listCharactersTool } from './listCharacters.js';
import { listLocationsTool } from './listLocations.js';
import { listProjectDocsTool } from './listProjectDocs.js';
import { mutationTools, type ApprovalHandler } from './mutations.js';
import { readChapterTool } from './readChapter.js';
import { readCharacterTool } from './readCharacter.js';
import { readLocationTool } from './readLocation.js';
import { readProjectDocTool } from './readProjectDoc.js';
import { readStoryStructureTool } from './readStoryStructure.js';
import type { ToolContext } from './shared.js';

export function buildAgentTools(
  prisma: PrismaClient,
  context: ToolContext & { userId: string },
  approval: ApprovalHandler
) {
  return {
    listCharacters: listCharactersTool(prisma, context),
    readCharacter: readCharacterTool(prisma, context),
    listChapters: listChaptersTool(prisma, context),
    grepChapter: grepChapterTool(prisma, context),
    grepChapters: grepChaptersTool(prisma, context),
    readChapter: readChapterTool(prisma, context),
    listLocations: listLocationsTool(prisma, context),
    readLocation: readLocationTool(prisma, context),
    listProjectDocs: listProjectDocsTool(prisma, context),
    readProjectDoc: readProjectDocTool(prisma, context),
    readStoryStructure: readStoryStructureTool(prisma, context),
    ...mutationTools(prisma, context, approval)
  };
}

export { executeMutationTool, mutatingToolNames, type MutatingToolName } from './mutations.js';
export { bodyOf } from './shared.js';
