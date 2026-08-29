import { Router } from 'express';
import { createMcpHandler } from '@modelcontextprotocol/server';
import { toNodeHandler } from '@modelcontextprotocol/node';
import { prisma } from '../config/prisma.js';
import { requireMcpAuth, validateMcpOrigin } from '../middleware/mcpAuthMiddleware.js';
import { createOpenTalesMcpServer } from '../mcp/OpenTalesMcpServer.js';

const handler = createMcpHandler(
  ({ authInfo }) => createOpenTalesMcpServer(prisma, authInfo),
  {
    responseMode: 'auto',
    onerror: (error) => console.error('MCP protocol error', error)
  }
);
const nodeHandler = toNodeHandler(handler, {
  onerror: (error) => console.error('MCP HTTP adapter error', error)
});

export const mcpRoutes = Router();

export async function closeMcpHandler(): Promise<void> {
  await handler.close();
}

mcpRoutes.all('/', validateMcpOrigin, requireMcpAuth, (req, res, next) => {
  nodeHandler(req, res, req.body).catch(next);
});
