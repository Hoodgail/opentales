import { env } from './config/env.js';
import { prisma } from './config/prisma.js';
import { createApp } from './app.js';

const app = createApp();

const server = app.listen(env.port, () => {
  console.log(`OpenTales backend listening on http://localhost:${env.port}`);
});

async function shutdown() {
  server.close();
  await prisma.$disconnect();
}

process.on('SIGINT', () => {
  shutdown().finally(() => process.exit(0));
});

process.on('SIGTERM', () => {
  shutdown().finally(() => process.exit(0));
});
