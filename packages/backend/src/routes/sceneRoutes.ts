import { Router } from "express";
import { SceneController } from "../controllers/SceneController.js";
import { asyncHandler } from "../http/asyncHandler.js";
import { requireAuth } from "../middleware/authMiddleware.js";

const scenes = new SceneController();

export const sceneRoutes = Router();
sceneRoutes.use(requireAuth);

sceneRoutes.get(
  "/:projectId/chapters/:chapterId/scenes",
  asyncHandler(scenes.list),
);
sceneRoutes.post(
  "/:projectId/chapters/:chapterId/scenes",
  asyncHandler(scenes.create),
);
sceneRoutes.post(
  "/:projectId/chapters/:chapterId/scenes/reorder",
  asyncHandler(scenes.reorder),
);
sceneRoutes.get(
  "/:projectId/chapters/:chapterId/scenes/:sceneId",
  asyncHandler(scenes.get),
);
sceneRoutes.patch(
  "/:projectId/chapters/:chapterId/scenes/:sceneId",
  asyncHandler(scenes.update),
);
sceneRoutes.delete(
  "/:projectId/chapters/:chapterId/scenes/:sceneId",
  asyncHandler(scenes.delete),
);
