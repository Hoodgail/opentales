import type { PrismaClient } from '@prisma/client';
import { grepChapterTool, grepChaptersTool } from './grepChapters.js';
import { listChaptersTool } from './listChapters.js';
import { listCharactersTool } from './listCharacters.js';
import { listLocationsTool } from './listLocations.js';
import { listProjectDocsTool } from './listProjectDocs.js';
import { mutationTools, type ApprovalHandler, type QuestionHandler } from './mutations.js';
import { listProjectFilesTool, readFolderTool } from './projectFiles.js';
import { readChapterTool } from './readChapter.js';
import { readCharacterTool } from './readCharacter.js';
import { readLocationTool } from './readLocation.js';
import {
  getProjectStatsTool,
  grepProjectTool,
  listActsTool,
  listAssetsTool,
  listBetaShareLinksTool,
  listCharacterRelationshipsTool,
  listMembersTool,
  listObstaclesTool,
  listProjectAiSkillsTool,
  listScenesTool,
  listSubmissionsTool,
  listTrashTool,
  listWritingVersionsTool,
  readActTool,
  readAssetContentTool,
  readAssetMetadataTool,
  readBetaShareLinkTool,
  readObstacleTool,
  readProjectAiSettingsTool,
  readProjectAiSkillTool,
  readProjectTool,
  readPublicProjectTool,
  readSceneTool,
  readSubmissionTool,
  readTrashedChapterTool,
  readWritingVersionTool
} from './readMore.js';
import { readProjectDocTool } from './readProjectDoc.js';
import { readStoryStructureTool } from './readStoryStructure.js';
import type { ToolContext } from './shared.js';

export function buildAgentTools(
  prisma: PrismaClient,
  context: ToolContext & { userId: string },
  approval: ApprovalHandler,
  question: QuestionHandler
) {
  return {
    readProject: readProjectTool(prisma, context),
    listProjectFiles: listProjectFilesTool(prisma, context),
    readFolder: readFolderTool(prisma, context),
    listCharacters: listCharactersTool(prisma, context),
    readCharacter: readCharacterTool(prisma, context),
    listCharacterRelationships: listCharacterRelationshipsTool(prisma, context),
    listChapters: listChaptersTool(prisma, context),
    grepChapter: grepChapterTool(prisma, context),
    grepChapters: grepChaptersTool(prisma, context),
    readChapter: readChapterTool(prisma, context),
    listActs: listActsTool(prisma, context),
    readAct: readActTool(prisma, context),
    listScenes: listScenesTool(prisma, context),
    readScene: readSceneTool(prisma, context),
    listLocations: listLocationsTool(prisma, context),
    readLocation: readLocationTool(prisma, context),
    listObstacles: listObstaclesTool(prisma, context),
    readObstacle: readObstacleTool(prisma, context),
    listProjectDocs: listProjectDocsTool(prisma, context),
    readProjectDoc: readProjectDocTool(prisma, context),
    readStoryStructure: readStoryStructureTool(prisma, context),
    listSubmissions: listSubmissionsTool(prisma, context),
    readSubmission: readSubmissionTool(prisma, context),
    listTrash: listTrashTool(prisma, context),
    readTrashedChapter: readTrashedChapterTool(prisma, context),
    listAssets: listAssetsTool(prisma, context),
    readAssetMetadata: readAssetMetadataTool(prisma, context),
    readAssetContent: readAssetContentTool(prisma, context),
    getProjectStats: getProjectStatsTool(prisma, context),
    listMembers: listMembersTool(prisma, context),
    listBetaShareLinks: listBetaShareLinksTool(prisma, context),
    readBetaShareLink: readBetaShareLinkTool(prisma, context),
    readPublicProject: readPublicProjectTool(prisma, context),
    readProjectAiSettings: readProjectAiSettingsTool(prisma, context),
    listProjectAiSkills: listProjectAiSkillsTool(prisma, context),
    readProjectAiSkill: readProjectAiSkillTool(prisma, context),
    listWritingVersions: listWritingVersionsTool(prisma, context),
    readWritingVersion: readWritingVersionTool(prisma, context),
    grepProject: grepProjectTool(prisma, context),
    ...mutationTools(prisma, context, approval, question)
  };
}

export { executeMutationTool, mutatingToolNames, type MutatingToolName, type QuestionHandler } from './mutations.js';
export { bodyOf } from './shared.js';
