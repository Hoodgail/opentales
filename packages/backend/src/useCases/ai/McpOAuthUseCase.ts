import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import type { PrismaClient, ProjectMcpApiKeyPermission, Role } from '@prisma/client';
import type {
  AuthorizeMcpOAuthInput,
  AuthorizeMcpOAuthResult,
  McpOAuthAuthorizationContext,
  McpOAuthAuthorizationRequest,
  McpOAuthProject
} from '@opentales/sdk';
import { env } from '../../config/env.js';
import { HttpError } from '../../http/HttpError.js';
import { ProjectAccessRepository } from '../../repositories/ProjectAccessRepository.js';
import { retryTransactionConflict } from '../../utils/prismaTransaction.js';
import { roleHas } from '../../utils/permissions.js';

export const MCP_OAUTH_SCOPES = ['opentales:project:read', 'opentales:project:write'] as const;
const AUTHORIZATION_CODE_TTL_MS = 5 * 60 * 1000;
const ACCESS_TOKEN_TTL_SECONDS = 60 * 60;
const REFRESH_TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const CLIENT_ID_PREFIX = 'otclient_';
const CODE_PREFIX = 'otcode_';
export const OAUTH_ACCESS_TOKEN_PREFIX = 'otoauth_';
export const OAUTH_REFRESH_TOKEN_PREFIX = 'otrefresh_';
const PKCE_PATTERN = /^[A-Za-z0-9_-]{43,128}$/;

export interface OAuthTokenResult {
  access_token: string;
  token_type: 'Bearer';
  expires_in: number;
  refresh_token: string;
  scope: string;
}

export class McpOAuthUseCase {
  private readonly access: ProjectAccessRepository;

  constructor(private readonly prisma: PrismaClient) {
    this.access = new ProjectAccessRepository(prisma);
  }

  async registerClient(input: unknown): Promise<Record<string, unknown>> {
    const value = record(input);
    const redirectUris = stringArray(value.redirect_uris, 'redirect_uris', 10).map(validateRedirectUri);
    if (!redirectUris.length) throw new OAuthProtocolError('invalid_client_metadata', 'At least one redirect_uri is required');
    const grantTypes = optionalStringArray(value.grant_types, ['authorization_code', 'refresh_token']);
    if (!grantTypes.includes('authorization_code') || grantTypes.some((item) => item !== 'authorization_code' && item !== 'refresh_token')) {
      throw new OAuthProtocolError('invalid_client_metadata', 'Only authorization_code and refresh_token grants are supported');
    }
    const responseTypes = optionalStringArray(value.response_types, ['code']);
    if (responseTypes.length !== 1 || responseTypes[0] !== 'code') {
      throw new OAuthProtocolError('invalid_client_metadata', 'Only the code response type is supported');
    }
    const tokenEndpointAuthMethod = optionalString(value.token_endpoint_auth_method) ?? 'none';
    if (tokenEndpointAuthMethod !== 'none') {
      throw new OAuthProtocolError('invalid_client_metadata', 'Only public PKCE clients are supported');
    }
    const clientName = boundedString(value.client_name, 'client_name', 200, 'MCP client');
    const clientUri = optionalPublicUrl(value.client_uri, 'client_uri');
    const logoUri = optionalPublicUrl(value.logo_uri, 'logo_uri');
    const clientId = `${CLIENT_ID_PREFIX}${randomBytes(24).toString('base64url')}`;
    const client = await this.prisma.mcpOAuthClient.create({
      data: {
        clientId,
        clientName,
        redirectUris: unique(redirectUris),
        grantTypes: unique(grantTypes),
        responseTypes,
        tokenEndpointAuthMethod,
        clientUri,
        logoUri
      }
    });
    return {
      client_id: client.clientId,
      client_id_issued_at: Math.floor(client.createdAt.getTime() / 1000),
      client_name: client.clientName,
      redirect_uris: client.redirectUris,
      grant_types: client.grantTypes,
      response_types: client.responseTypes,
      token_endpoint_auth_method: client.tokenEndpointAuthMethod,
      ...(client.clientUri ? { client_uri: client.clientUri } : {}),
      ...(client.logoUri ? { logo_uri: client.logoUri } : {})
    };
  }

  async authorizationContext(
    userId: string,
    input: McpOAuthAuthorizationRequest
  ): Promise<McpOAuthAuthorizationContext> {
    const request = await this.validateAuthorizationRequest(input);
    const memberships = await this.prisma.membership.findMany({
      where: { userId },
      orderBy: { createdAt: 'asc' },
      select: {
        role: true,
        org: {
          select: {
            name: true,
            projects: {
              where: { deletedAt: null },
              orderBy: { title: 'asc' },
              select: { id: true, title: true }
            }
          }
        }
      }
    });
    const projects: McpOAuthProject[] = memberships.flatMap((membership) =>
      membership.org.projects.map((project) => ({
        projectId: project.id,
        title: project.title,
        orgName: membership.org.name,
        role: membership.role,
        canWrite: roleHas(membership.role, 'project:write') && request.scopes.includes('opentales:project:write')
      }))
    );
    return {
      clientName: request.client.clientName,
      redirectUri: request.redirectUri,
      requestedScopes: request.scopes,
      writeRequested: request.scopes.includes('opentales:project:write'),
      projects
    };
  }

  async authorize(userId: string, input: AuthorizeMcpOAuthInput): Promise<AuthorizeMcpOAuthResult> {
    const request = await this.validateAuthorizationRequest(input);
    if (input.decision === 'deny') {
      return { redirectUrl: authorizationRedirect(request.redirectUri, { error: 'access_denied', state: request.state }) };
    }
    if (input.decision !== 'approve') throw new HttpError(400, 'decision must be approve or deny');
    const projectId = requiredString(input.projectId, 'projectId', 500);
    const role = await this.access.getProjectRole(userId, projectId);
    const requestedAccess = input.access ?? 'read-only';
    if (requestedAccess !== 'read-only' && requestedAccess !== 'read-write') {
      throw new HttpError(400, 'access must be read-only or read-write');
    }
    if (requestedAccess === 'read-write') {
      if (!request.scopes.includes('opentales:project:write')) {
        throw new OAuthProtocolError('invalid_scope', 'The client did not request project write access');
      }
      if (!roleHas(role, 'project:write')) throw new HttpError(403, 'Your project role does not allow write access');
    }
    const permission: ProjectMcpApiKeyPermission = requestedAccess === 'read-write' ? 'READ_WRITE' : 'READ_ONLY';
    const scopes = scopesForGrant(role, permission, request.scopes);
    const code = `${CODE_PREFIX}${randomBytes(32).toString('base64url')}`;
    await this.prisma.mcpOAuthAuthorizationCode.create({
      data: {
        codeHash: hashOAuthSecret(code),
        clientId: request.client.clientId,
        projectId,
        userId,
        permission,
        redirectUri: request.redirectUri,
        codeChallenge: request.codeChallenge,
        resource: request.resource,
        scopes,
        expiresAt: new Date(Date.now() + AUTHORIZATION_CODE_TTL_MS)
      }
    });
    return {
      redirectUrl: authorizationRedirect(request.redirectUri, { code, state: request.state })
    };
  }

  async exchangeToken(input: Record<string, unknown>): Promise<OAuthTokenResult> {
    const grantType = requiredString(input.grant_type, 'grant_type', 100);
    if (grantType === 'authorization_code') return this.exchangeAuthorizationCode(input);
    if (grantType === 'refresh_token') return this.refreshAccessToken(input);
    throw new OAuthProtocolError('unsupported_grant_type', 'Only authorization_code and refresh_token are supported');
  }

  async revoke(input: Record<string, unknown>): Promise<void> {
    const token = requiredString(input.token, 'token', 1_000);
    const clientId = optionalString(input.client_id);
    const hash = hashOAuthSecret(token);
    await this.prisma.mcpOAuthToken.updateMany({
      where: {
        ...(clientId ? { clientId } : {}),
        OR: [{ accessTokenHash: hash }, { refreshTokenHash: hash }]
      },
      data: { revokedAt: new Date() }
    });
  }

  private async exchangeAuthorizationCode(input: Record<string, unknown>): Promise<OAuthTokenResult> {
    const code = requiredString(input.code, 'code', 1_000);
    const clientId = requiredString(input.client_id, 'client_id', 500);
    const redirectUri = validateRedirectUri(requiredString(input.redirect_uri, 'redirect_uri', 2_000));
    const verifier = requiredString(input.code_verifier, 'code_verifier', 200);
    if (!PKCE_PATTERN.test(verifier)) throw new OAuthProtocolError('invalid_grant', 'code_verifier is invalid');
    const requestedResource = optionalString(input.resource);
    return retryTransactionConflict(() => this.prisma.$transaction(async (tx) => {
      const row = await tx.mcpOAuthAuthorizationCode.findUnique({
        where: { codeHash: hashOAuthSecret(code) },
        include: { project: { select: { orgId: true, deletedAt: true } } }
      });
      if (
        !row
        || row.clientId !== clientId
        || row.redirectUri !== redirectUri
        || row.consumedAt
        || row.expiresAt.getTime() <= Date.now()
        || row.project.deletedAt
        || (requestedResource && normalizeResource(requestedResource) !== row.resource)
        || !matchesPkce(verifier, row.codeChallenge)
      ) throw new OAuthProtocolError('invalid_grant', 'Authorization code is invalid, expired, or already used');
      const membership = await tx.membership.findUnique({
        where: { orgId_userId: { orgId: row.project.orgId, userId: row.userId } },
        select: { role: true }
      });
      if (!membership) throw new OAuthProtocolError('invalid_grant', 'Project access is no longer available');
      const consumed = await tx.mcpOAuthAuthorizationCode.updateMany({
        where: { id: row.id, consumedAt: null, expiresAt: { gt: new Date() } },
        data: { consumedAt: new Date() }
      });
      if (consumed.count !== 1) throw new OAuthProtocolError('invalid_grant', 'Authorization code is invalid, expired, or already used');
      return createToken(tx, {
        clientId,
        projectId: row.projectId,
        userId: row.userId,
        role: membership.role,
        permission: row.permission,
        resource: row.resource,
        requestedScopes: row.scopes
      });
    }));
  }

  private async refreshAccessToken(input: Record<string, unknown>): Promise<OAuthTokenResult> {
    const refreshToken = requiredString(input.refresh_token, 'refresh_token', 1_000);
    const clientId = requiredString(input.client_id, 'client_id', 500);
    const requestedResource = optionalString(input.resource);
    const refreshHash = hashOAuthSecret(refreshToken);
    return retryTransactionConflict(() => this.prisma.$transaction(async (tx) => {
      const row = await tx.mcpOAuthToken.findUnique({
        where: { refreshTokenHash: refreshHash },
        include: { project: { select: { orgId: true, deletedAt: true } } }
      });
      if (
        !row
        || row.clientId !== clientId
        || row.revokedAt
        || row.refreshExpiresAt.getTime() <= Date.now()
        || row.project.deletedAt
        || (requestedResource && normalizeResource(requestedResource) !== row.resource)
      ) throw new OAuthProtocolError('invalid_grant', 'Refresh token is invalid or expired');
      const membership = await tx.membership.findUnique({
        where: { orgId_userId: { orgId: row.project.orgId, userId: row.userId } },
        select: { role: true }
      });
      if (!membership) throw new OAuthProtocolError('invalid_grant', 'Project access is no longer available');
      const accessToken = `${OAUTH_ACCESS_TOKEN_PREFIX}${randomBytes(32).toString('base64url')}`;
      const nextRefreshToken = `${OAUTH_REFRESH_TOKEN_PREFIX}${randomBytes(32).toString('base64url')}`;
      const permission = effectivePermission(row.permission, membership.role);
      const scopes = scopesForGrant(membership.role, permission, row.scopes);
      const rotated = await tx.mcpOAuthToken.updateMany({
        where: { id: row.id, refreshTokenHash: refreshHash, revokedAt: null, refreshExpiresAt: { gt: new Date() } },
        data: {
          accessTokenHash: hashOAuthSecret(accessToken),
          refreshTokenHash: hashOAuthSecret(nextRefreshToken),
          permission,
          scopes,
          accessExpiresAt: new Date(Date.now() + ACCESS_TOKEN_TTL_SECONDS * 1000),
          lastUsedAt: null
        }
      });
      if (rotated.count !== 1) throw new OAuthProtocolError('invalid_grant', 'Refresh token is invalid or expired');
      return tokenResult(accessToken, nextRefreshToken, scopes);
    }));
  }

  private async validateAuthorizationRequest(input: McpOAuthAuthorizationRequest): Promise<ValidatedAuthorizationRequest> {
    if (input.clientId.startsWith('otmcp_')) {
      throw new OAuthProtocolError(
        'invalid_client',
        'An MCP API key cannot be used as an OAuth client ID. Remove this connector and add it again without custom client credentials.'
      );
    }
    const clientId = requiredString(input.clientId, 'client_id', 500);
    const client = await this.prisma.mcpOAuthClient.findUnique({ where: { clientId } });
    if (!client) throw new OAuthProtocolError('invalid_client', 'OAuth client is unknown. Re-add the connector so Claude can register automatically.');
    if (input.responseType !== 'code') throw new OAuthProtocolError('unsupported_response_type', 'Only response_type=code is supported');
    const redirectUri = validateRedirectUri(input.redirectUri);
    if (!client.redirectUris.includes(redirectUri)) throw new OAuthProtocolError('invalid_request', 'redirect_uri is not registered for this client');
    if (input.codeChallengeMethod !== 'S256' || !PKCE_PATTERN.test(input.codeChallenge)) {
      throw new OAuthProtocolError('invalid_request', 'PKCE with code_challenge_method=S256 is required');
    }
    const resource = normalizeResource(input.resource ?? env.mcpPublicUrl);
    const scopes = parseScopes(input.scope);
    return {
      client,
      redirectUri,
      codeChallenge: input.codeChallenge,
      resource,
      scopes,
      state: optionalString(input.state)
    };
  }
}

interface ValidatedAuthorizationRequest {
  client: { clientId: string; clientName: string; redirectUris: string[] };
  redirectUri: string;
  codeChallenge: string;
  resource: string;
  scopes: string[];
  state?: string;
}

async function createToken(
  tx: Parameters<Parameters<PrismaClient['$transaction']>[0]>[0],
  input: {
    clientId: string;
    projectId: string;
    userId: string;
    role: Role;
    permission: ProjectMcpApiKeyPermission;
    resource: string;
    requestedScopes: string[];
  }
): Promise<OAuthTokenResult> {
  const accessToken = `${OAUTH_ACCESS_TOKEN_PREFIX}${randomBytes(32).toString('base64url')}`;
  const refreshToken = `${OAUTH_REFRESH_TOKEN_PREFIX}${randomBytes(32).toString('base64url')}`;
  const permission = effectivePermission(input.permission, input.role);
  const scopes = scopesForGrant(input.role, permission, input.requestedScopes);
  await tx.mcpOAuthToken.create({
    data: {
      accessTokenHash: hashOAuthSecret(accessToken),
      refreshTokenHash: hashOAuthSecret(refreshToken),
      clientId: input.clientId,
      projectId: input.projectId,
      userId: input.userId,
      permission,
      resource: input.resource,
      scopes,
      accessExpiresAt: new Date(Date.now() + ACCESS_TOKEN_TTL_SECONDS * 1000),
      refreshExpiresAt: new Date(Date.now() + REFRESH_TOKEN_TTL_MS)
    }
  });
  return tokenResult(accessToken, refreshToken, scopes);
}

function tokenResult(accessToken: string, refreshToken: string, scopes: string[]): OAuthTokenResult {
  return {
    access_token: accessToken,
    token_type: 'Bearer',
    expires_in: ACCESS_TOKEN_TTL_SECONDS,
    refresh_token: refreshToken,
    scope: scopes.join(' ')
  };
}

export function hashOAuthSecret(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

function matchesPkce(verifier: string, challenge: string): boolean {
  const actual = createHash('sha256').update(verifier, 'ascii').digest('base64url');
  if (actual.length !== challenge.length) return false;
  return timingSafeEqual(Buffer.from(actual), Buffer.from(challenge));
}

function effectivePermission(permission: ProjectMcpApiKeyPermission, role: Role): ProjectMcpApiKeyPermission {
  return permission === 'READ_WRITE' && roleHas(role, 'project:write') ? 'READ_WRITE' : 'READ_ONLY';
}

function scopesForGrant(role: Role, permission: ProjectMcpApiKeyPermission, requested: string[]): string[] {
  const scopes = ['opentales:project:read'];
  if (permission === 'READ_WRITE' && roleHas(role, 'project:write') && requested.includes('opentales:project:write')) {
    scopes.push('opentales:project:write');
  }
  return scopes;
}

function parseScopes(value: unknown): string[] {
  const requested = typeof value === 'string' && value.trim()
    ? unique(value.trim().split(/\s+/))
    : [...MCP_OAUTH_SCOPES];
  if (requested.some((scope) => !(MCP_OAUTH_SCOPES as readonly string[]).includes(scope))) {
    throw new OAuthProtocolError('invalid_scope', 'One or more requested scopes are not supported');
  }
  if (!requested.includes('opentales:project:read')) requested.unshift('opentales:project:read');
  return requested;
}

function normalizeResource(value: string): string {
  let url: URL;
  try { url = new URL(value); } catch { throw new OAuthProtocolError('invalid_target', 'resource must be an absolute URL'); }
  url.hash = '';
  const normalized = url.toString().replace(/\/$/, '');
  if (normalized !== env.mcpPublicUrl.replace(/\/$/, '')) {
    throw new OAuthProtocolError('invalid_target', 'resource does not identify this MCP server');
  }
  return normalized;
}

function authorizationRedirect(redirectUri: string, values: { code?: string; error?: string; state?: string }): string {
  const url = new URL(redirectUri);
  if (values.code) url.searchParams.set('code', values.code);
  if (values.error) url.searchParams.set('error', values.error);
  if (values.state) url.searchParams.set('state', values.state);
  url.searchParams.set('iss', env.mcpOAuthIssuer);
  return url.toString();
}

function validateRedirectUri(value: string): string {
  let url: URL;
  try { url = new URL(value); } catch { throw new OAuthProtocolError('invalid_client_metadata', 'redirect_uri must be an absolute URL'); }
  const loopback = url.hostname === 'localhost' || url.hostname === '127.0.0.1' || url.hostname === '[::1]';
  if (url.hash || (url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback))) {
    throw new OAuthProtocolError('invalid_client_metadata', 'redirect_uri must use HTTPS or an HTTP loopback address');
  }
  return url.toString();
}

function optionalPublicUrl(value: unknown, label: string): string | null {
  if (value === undefined || value === null || value === '') return null;
  const raw = requiredString(value, label, 2_000);
  let url: URL;
  try { url = new URL(raw); } catch { throw new OAuthProtocolError('invalid_client_metadata', `${label} must be an absolute URL`); }
  if (url.protocol !== 'https:' || url.hash) throw new OAuthProtocolError('invalid_client_metadata', `${label} must use HTTPS without a fragment`);
  return url.toString();
}

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new OAuthProtocolError('invalid_request', 'Request body must be an object');
  }
  return value as Record<string, unknown>;
}

function stringArray(value: unknown, label: string, max: number): string[] {
  if (!Array.isArray(value) || value.length > max || value.some((item) => typeof item !== 'string')) {
    throw new OAuthProtocolError('invalid_client_metadata', `${label} must be an array of strings`);
  }
  return value as string[];
}

function optionalStringArray(value: unknown, fallback: string[]): string[] {
  if (value === undefined) return fallback;
  return stringArray(value, 'OAuth metadata field', 10);
}

function boundedString(value: unknown, label: string, max: number, fallback?: string): string {
  if ((value === undefined || value === null || value === '') && fallback !== undefined) return fallback;
  return requiredString(value, label, max);
}

function requiredString(value: unknown, label: string, max: number): string {
  if (typeof value !== 'string' || !value.trim()) throw new OAuthProtocolError('invalid_request', `${label} is required`);
  if (value.length > max) throw new OAuthProtocolError('invalid_request', `${label} is too long`);
  return value;
}

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value ? value : undefined;
}

function unique<T>(values: T[]): T[] {
  return [...new Set(values)];
}

export type OAuthErrorCode =
  | 'invalid_request'
  | 'invalid_client'
  | 'invalid_client_metadata'
  | 'invalid_grant'
  | 'unsupported_grant_type'
  | 'unsupported_response_type'
  | 'invalid_scope'
  | 'invalid_target';

export class OAuthProtocolError extends Error {
  constructor(
    public readonly code: OAuthErrorCode,
    public readonly description: string,
    public readonly status = 400
  ) {
    super(description);
    this.name = 'OAuthProtocolError';
  }
}
