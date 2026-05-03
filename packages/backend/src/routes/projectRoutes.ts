import { Router } from 'express';
import { AiController } from '../controllers/AiController.js';
import { CollaborationController } from '../controllers/CollaborationController.js';
import { ProjectDocController } from '../controllers/ProjectDocController.js';
import { ProjectFolderController } from '../controllers/ProjectFolderController.js';
import { ProjectController } from '../controllers/ProjectController.js';
import { StatsController } from '../controllers/StatsController.js';
import { StorageController } from '../controllers/StorageController.js';
import { TrashController } from '../controllers/TrashController.js';
import { asyncHandler } from '../http/asyncHandler.js';
import { requireAuth } from '../middleware/authMiddleware.js';

const controller = new ProjectController();
const ai = new AiController();
const collaboration = new CollaborationController();
const docs = new ProjectDocController();
const folders = new ProjectFolderController();
const trash = new TrashController();
const stats = new StatsController();
const storage = new StorageController();
export const projectRoutes = Router();

projectRoutes.use(requireAuth);
projectRoutes.get('/', asyncHandler(controller.list));
projectRoutes.post('/', asyncHandler(controller.create));
projectRoutes.get('/:projectId', asyncHandler(controller.get));
projectRoutes.patch('/:projectId', asyncHandler(controller.update));

projectRoutes.get(
  '/:projectId/collaboration/documents/:kind/:entityId/:field',
  asyncHandler(collaboration.snapshot)
);
projectRoutes.get('/:projectId/collaboration/events', asyncHandler(collaboration.projectEvents));
projectRoutes.get(
  '/:projectId/collaboration/documents/:kind/:entityId/:field/events',
  asyncHandler(collaboration.events)
);
projectRoutes.post('/:projectId/collaboration/leave', asyncHandler(collaboration.leave));
projectRoutes.post(
  '/:projectId/collaboration/documents/:kind/:entityId/:field/presence',
  asyncHandler(collaboration.presence)
);
projectRoutes.post(
  '/:projectId/collaboration/documents/:kind/:entityId/:field/edits',
  asyncHandler(collaboration.edit)
);

projectRoutes.get('/:projectId/ai-settings', asyncHandler(ai.getSettings));
projectRoutes.patch('/:projectId/ai-settings', asyncHandler(ai.updateSettings));
projectRoutes.get('/:projectId/ai/tools', asyncHandler(ai.tools));
projectRoutes.get('/:projectId/ai/skills', asyncHandler(ai.skills));
projectRoutes.post('/:projectId/ai/skills', asyncHandler(ai.createSkill));
projectRoutes.patch('/:projectId/ai/skills/:skillId', asyncHandler(ai.updateSkill));
projectRoutes.delete('/:projectId/ai/skills/:skillId', asyncHandler(ai.deleteSkill));
projectRoutes.get('/:projectId/ai/agent-sessions', asyncHandler(ai.agentSessions));
projectRoutes.post('/:projectId/ai/agent-sessions', asyncHandler(ai.createAgentSession));
projectRoutes.get('/:projectId/ai/agent-sessions/:sessionId', asyncHandler(ai.agentSession));
projectRoutes.get('/:projectId/ai/agent-sessions/:sessionId/events', asyncHandler(ai.agentSessionEvents));
projectRoutes.post('/:projectId/ai/agent-sessions/:sessionId/prompts', asyncHandler(ai.queueAgentPrompt));
projectRoutes.post('/:projectId/ai/agent-sessions/:sessionId/cancel', asyncHandler(ai.cancelAgentSession));
projectRoutes.post(
  '/:projectId/ai/agent-sessions/:sessionId/tool-calls/approvals',
  asyncHandler(ai.approveToolCalls)
);
projectRoutes.post(
  '/:projectId/ai/agent-sessions/:sessionId/tool-calls/:toolCallId/approval',
  asyncHandler(ai.approveToolCall)
);
projectRoutes.get('/:projectId/ai/agent-session', asyncHandler(ai.agentSession));
projectRoutes.get('/:projectId/ai/agent-session/events', asyncHandler(ai.agentSessionEvents));
projectRoutes.post('/:projectId/ai/agent-session/prompts', asyncHandler(ai.queueAgentPrompt));
projectRoutes.post('/:projectId/ai/agent-session/cancel', asyncHandler(ai.cancelAgentSession));
projectRoutes.post(
  '/:projectId/ai/agent-session/tool-calls/approvals',
  asyncHandler(ai.approveToolCalls)
);
projectRoutes.post(
  '/:projectId/ai/agent-session/tool-calls/:toolCallId/approval',
  asyncHandler(ai.approveToolCall)
);
projectRoutes.post('/:projectId/ai/continuity-reviews', asyncHandler(ai.continuityReview));
projectRoutes.post('/:projectId/ai/rewrite-suggestions', asyncHandler(ai.rewriteSuggestion));
projectRoutes.post('/:projectId/ai/character-dialogue', asyncHandler(ai.characterDialogue));
projectRoutes.post('/:projectId/ai/outline-expansions', asyncHandler(ai.outlineExpansion));

projectRoutes.get('/:projectId/docs', asyncHandler(docs.list));
projectRoutes.get('/:projectId/docs/tree', asyncHandler(folders.tree));
projectRoutes.post('/:projectId/docs', asyncHandler(docs.create));
projectRoutes.get('/:projectId/docs/:docId', asyncHandler(docs.get));
projectRoutes.patch('/:projectId/docs/:docId', asyncHandler(docs.update));
projectRoutes.delete('/:projectId/docs/:docId', asyncHandler(docs.delete));

projectRoutes.post('/:projectId/folders', asyncHandler(folders.create));
projectRoutes.patch('/:projectId/folders/:folderId', asyncHandler(folders.update));
projectRoutes.delete('/:projectId/folders/:folderId', asyncHandler(folders.delete));

projectRoutes.post('/:projectId/acts', asyncHandler(controller.createAct));
projectRoutes.patch('/:projectId/acts/:actId', asyncHandler(controller.updateAct));
projectRoutes.delete('/:projectId/acts/:actId', asyncHandler(controller.deleteAct));

projectRoutes.post('/:projectId/chapters', asyncHandler(controller.createChapter));
projectRoutes.patch('/:projectId/chapters/:chapterId', asyncHandler(controller.updateChapter));
projectRoutes.delete('/:projectId/chapters/:chapterId', asyncHandler(controller.deleteChapter));

projectRoutes.post('/:projectId/characters', asyncHandler(controller.createCharacter));
projectRoutes.patch('/:projectId/characters/:characterId', asyncHandler(controller.updateCharacter));
projectRoutes.delete('/:projectId/characters/:characterId', asyncHandler(controller.deleteCharacter));
projectRoutes.post(
  '/:projectId/characters/:characterId/assets',
  asyncHandler(controller.attachCharacterAsset)
);
projectRoutes.delete(
  '/:projectId/characters/:characterId/assets/:attachmentId',
  asyncHandler(controller.detachCharacterAsset)
);
projectRoutes.post(
  '/:projectId/characters/:characterId/relationships',
  asyncHandler(controller.createCharacterRelationship)
);
projectRoutes.delete(
  '/:projectId/characters/:characterId/relationships/:relationshipId',
  asyncHandler(controller.deleteCharacterRelationship)
);

projectRoutes.post('/:projectId/locations', asyncHandler(controller.createLocation));
projectRoutes.patch('/:projectId/locations/:locationId', asyncHandler(controller.updateLocation));
projectRoutes.delete('/:projectId/locations/:locationId', asyncHandler(controller.deleteLocation));

projectRoutes.patch('/:projectId/structure', asyncHandler(controller.updateStructure));

projectRoutes.post('/:projectId/obstacles', asyncHandler(controller.createObstacle));
projectRoutes.patch('/:projectId/obstacles/:obstacleId', asyncHandler(controller.updateObstacle));
projectRoutes.delete('/:projectId/obstacles/:obstacleId', asyncHandler(controller.deleteObstacle));

projectRoutes.get('/:projectId/trash', asyncHandler(trash.list));
projectRoutes.post(
  '/:projectId/trash/chapters/:chapterId/restore',
  asyncHandler(trash.restoreChapter)
);
projectRoutes.delete(
  '/:projectId/trash/chapters/:chapterId',
  asyncHandler(trash.purgeChapter)
);

projectRoutes.get('/:projectId/stats', asyncHandler(stats.get));
projectRoutes.get('/:projectId/storage', asyncHandler(storage.get));
