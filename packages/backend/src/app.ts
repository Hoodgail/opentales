import cors from 'cors';
import express from 'express';
import { errorMiddleware } from './middleware/errorMiddleware.js';
import { authRoutes } from './routes/authRoutes.js';
import { assetPublicRoutes, assetUploadRoutes } from './routes/assetRoutes.js';
import { inviteRoutes, memberRoutes } from './routes/memberRoutes.js';
import { projectRoutes } from './routes/projectRoutes.js';
import { publicRoutes } from './routes/publicRoutes.js';
import { shareLinkRoutes } from './routes/shareLinkRoutes.js';
import { projectSubmissionRoutes, submissionRoutes } from './routes/submissionRoutes.js';

export function createApp() {
  const app = express();

  app.use(cors({ origin: true, credentials: true }));
  app.use(express.json({ limit: '2mb' }));

  app.get('/health', (_req, res) => {
    res.json({ status: 'ok' });
  });

  app.use('/auth', authRoutes);
  // Asset upload requires auth; reads are unauthenticated so <img> tags work.
  app.use('/projects', assetUploadRoutes);
  app.use('/assets', assetPublicRoutes);
  // Public/unauthenticated read pages.
  app.use('/public', publicRoutes);
  app.use('/projects', memberRoutes);
  app.use('/invites', inviteRoutes);
  app.use('/projects', projectSubmissionRoutes);
  app.use('/submissions', submissionRoutes);
  app.use('/projects', shareLinkRoutes);
  app.use('/projects', projectRoutes);
  app.use(errorMiddleware);

  return app;
}
