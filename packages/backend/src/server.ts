import { env } from './config/env.js';
import { prisma } from './config/prisma.js';
import { createApp } from './app.js';
import { startNovelBuildWorker } from './useCases/ai/workflow/NovelBuildWorker.js';
import { closeMcpHandler } from './routes/mcpRoutes.js';

const app = createApp();
const workerEnabled =
  process.env.NODE_ENV !== 'test' && process.env.AI_NOVEL_BUILD_WORKER_ENABLED !== 'false';
const novelBuildWorker = workerEnabled ? startNovelBuildWorker(prisma) : null;

const server = app.listen(env.port, () => {
  console.log(`OpenTales backend listening on http://localhost:${env.port}`);
});

async function shutdown() {
  await novelBuildWorker?.stop();
  await closeMcpHandler();
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
  await prisma.$disconnect();
}

process.on('SIGINT', () => {
  shutdown().finally(() => process.exit(0));
});

process.on('SIGTERM', () => {
  shutdown().finally(() => process.exit(0));
});
