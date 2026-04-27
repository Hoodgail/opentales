import { Router } from 'express';
import { ProjectController } from '../controllers/ProjectController.js';
import { StatsController } from '../controllers/StatsController.js';
import { TrashController } from '../controllers/TrashController.js';
import { asyncHandler } from '../http/asyncHandler.js';
import { requireAuth } from '../middleware/authMiddleware.js';

const controller = new ProjectController();
const trash = new TrashController();
const stats = new StatsController();
export const projectRoutes = Router();

projectRoutes.use(requireAuth);
projectRoutes.get('/', asyncHandler(controller.list));
projectRoutes.post('/', asyncHandler(controller.create));
projectRoutes.get('/:projectId', asyncHandler(controller.get));
projectRoutes.patch('/:projectId', asyncHandler(controller.update));

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
