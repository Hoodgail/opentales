import { createHash, randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { env } from '../../config/env.js';
import { authenticateMcpOAuthToken } from '../../middleware/mcpAuthMiddleware.js';
import { McpOAuthUseCase, OAuthProtocolError } from './McpOAuthUseCase.js';

const databaseUrl = process.env.REVISION_TEST_DATABASE_URL;
const integration = describe.runIf(Boolean(databaseUrl));

integration('MCP OAuth PostgreSQL integration', () => {
  let prisma: PrismaClient;
  let oauth: McpOAuthUseCase;
  let userId: string;
  let orgId: string;
  let projectId: string;
  let clientId: string;

  beforeAll(async () => {
    prisma = new PrismaClient({ datasources: { db: { url: databaseUrl! } } });
    oauth = new McpOAuthUseCase(prisma);
    const suffix = randomUUID();
    userId = `mcp-oauth-user-${suffix}`;
    orgId = `mcp-oauth-org-${suffix}`;
    projectId = `mcp-oauth-project-${suffix}`;
    await prisma.user.create({
      data: { id: userId, username: userId, email: `${userId}@test.dev`, passwordHash: 'x' }
    });
    await prisma.org.create({
      data: {
        id: orgId,
        slug: orgId,
        name: 'OAuth Test Workspace',
        memberships: { create: { userId, role: 'OWNER' } },
        projects: { create: { id: projectId, slug: projectId, title: 'OAuth Test Novel' } }
      }
    });
  });

  afterAll(async () => {
    if (!prisma) return;
    await prisma.org.deleteMany({ where: { id: orgId } });
    await prisma.user.deleteMany({ where: { id: userId } });
    if (clientId) await prisma.mcpOAuthClient.deleteMany({ where: { clientId } });
    await prisma.$disconnect();
  });

  it('registers Claude, grants one project with PKCE, rotates refresh tokens, and revokes access', async () => {
    const registration = await oauth.registerClient({
      client_name: 'Claude',
      redirect_uris: ['https://claude.ai/api/mcp/auth_callback'],
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      token_endpoint_auth_method: 'none'
    });
    clientId = String(registration.client_id);
    expect(clientId).toMatch(/^otclient_/);

    const verifier = 'mcp-oauth-verifier-with-at-least-forty-three-characters-123';
    const challenge = createHash('sha256').update(verifier, 'ascii').digest('base64url');
    const request = {
      responseType: 'code',
      clientId,
      redirectUri: 'https://claude.ai/api/mcp/auth_callback',
      codeChallenge: challenge,
      codeChallengeMethod: 'S256',
      state: 'state-1',
      resource: env.mcpPublicUrl,
      scope: 'opentales:project:read opentales:project:write'
    };
    const context = await oauth.authorizationContext(userId, request);
    expect(context).toMatchObject({ clientName: 'Claude', writeRequested: true });
    expect(context.projects).toContainEqual(expect.objectContaining({ projectId, canWrite: true }));

    const authorization = await oauth.authorize(userId, {
      ...request,
      projectId,
      access: 'read-write',
      decision: 'approve'
    });
    const redirect = new URL(authorization.redirectUrl);
    const code = redirect.searchParams.get('code');
    expect(code).toMatch(/^otcode_/);
    expect(redirect.searchParams.get('state')).toBe('state-1');
    expect(redirect.searchParams.get('iss')).toBe(env.mcpOAuthIssuer);

    const tokens = await oauth.exchangeToken({
      grant_type: 'authorization_code',
      client_id: clientId,
      redirect_uri: request.redirectUri,
      code,
      code_verifier: verifier,
      resource: env.mcpPublicUrl
    });
    expect(tokens.access_token).toMatch(/^otoauth_/);
    expect(tokens.refresh_token).toMatch(/^otrefresh_/);
    expect(tokens.scope).toContain('opentales:project:write');
    expect((await authenticateMcpOAuthToken(prisma, tokens.access_token)).extra).toMatchObject({
      credentialType: 'oauth', projectId, userId, access: 'read-write'
    });
    await expect(oauth.exchangeToken({
      grant_type: 'authorization_code', client_id: clientId, redirect_uri: request.redirectUri,
      code, code_verifier: verifier
    })).rejects.toMatchObject({ code: 'invalid_grant' });

    const refreshed = await oauth.exchangeToken({
      grant_type: 'refresh_token',
      client_id: clientId,
      refresh_token: tokens.refresh_token,
      resource: env.mcpPublicUrl
    });
    expect(refreshed.access_token).not.toBe(tokens.access_token);
    await expect(authenticateMcpOAuthToken(prisma, tokens.access_token)).rejects.toMatchObject({ status: 401 });
    await expect(authenticateMcpOAuthToken(prisma, refreshed.access_token)).resolves.toBeDefined();

    await oauth.revoke({ token: refreshed.refresh_token, client_id: clientId });
    await expect(authenticateMcpOAuthToken(prisma, refreshed.access_token)).rejects.toMatchObject({ status: 401 });
  });

  it('rejects an API key presented as an OAuth client ID before database lookup', async () => {
    await expect(oauth.authorizationContext(userId, {
      responseType: 'code',
      clientId: `otmcp_${'a'.repeat(43)}`,
      redirectUri: 'https://claude.ai/api/mcp/auth_callback',
      codeChallenge: 'a'.repeat(43),
      codeChallengeMethod: 'S256'
    })).rejects.toBeInstanceOf(OAuthProtocolError);
  });
});
