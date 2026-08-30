import type { AddressInfo } from 'node:net';
import { afterAll, describe, expect, it } from 'vitest';
import { createApp } from '../app.js';
import { closeMcpHandler } from '../routes/mcpRoutes.js';

afterAll(async () => {
  await closeMcpHandler();
});

describe('hosted MCP HTTP compatibility', () => {
  it.each([
    'https://claude.ai',
    'https://chatgpt.com',
    'https://gemini.google.com'
  ])('returns browser-readable OAuth discovery to %s', async (origin) => {
    const app = createApp();
    const server = app.listen(0);
    try {
      const { port } = server.address() as AddressInfo;
      const response = await fetch(`http://127.0.0.1:${port}/mcp`, {
        headers: {
          Accept: 'application/json, text/event-stream',
          Origin: origin
        }
      });

      expect(response.status).toBe(401);
      expect(response.headers.get('access-control-allow-origin')).toBe(origin);
      expect(response.headers.get('access-control-expose-headers')).toContain('WWW-Authenticate');
      expect(response.headers.get('access-control-expose-headers')).toContain('Mcp-Session-Id');
      expect(response.headers.get('www-authenticate')).toContain(
        'resource_metadata="http://localhost:5173/.well-known/oauth-protected-resource/mcp"'
      );
    } finally {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => error ? reject(error) : resolve());
      });
    }
  });
});
