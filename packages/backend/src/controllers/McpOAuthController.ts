import type { Request, Response } from 'express';
import type { AuthorizeMcpOAuthInput, McpOAuthAuthorizationRequest } from '@opentales/sdk';
import { env } from '../config/env.js';
import { prisma } from '../config/prisma.js';
import { HttpError } from '../http/HttpError.js';
import {
  MCP_OAUTH_SCOPES,
  McpOAuthUseCase,
  OAuthProtocolError
} from '../useCases/ai/McpOAuthUseCase.js';

export class McpOAuthController {
  private readonly useCase = new McpOAuthUseCase(prisma);

  protectedResourceMetadata = async (_req: Request, res: Response) => {
    res.setHeader('Cache-Control', 'public, max-age=300');
    res.json({
      resource: env.mcpPublicUrl,
      resource_name: 'OpenTales MCP',
      authorization_servers: [env.mcpOAuthIssuer],
      scopes_supported: MCP_OAUTH_SCOPES,
      bearer_methods_supported: ['header'],
      resource_documentation: `${env.mcpOAuthIssuer}/guide`
    });
  };

  authorizationServerMetadata = async (_req: Request, res: Response) => {
    res.setHeader('Cache-Control', 'public, max-age=300');
    res.json({
      issuer: env.mcpOAuthIssuer,
      authorization_endpoint: `${env.mcpOAuthIssuer}/authorize`,
      token_endpoint: `${env.mcpOAuthIssuer}/token`,
      registration_endpoint: `${env.mcpOAuthIssuer}/register`,
      revocation_endpoint: `${env.mcpOAuthIssuer}/revoke`,
      response_types_supported: ['code'],
      grant_types_supported: ['authorization_code', 'refresh_token'],
      token_endpoint_auth_methods_supported: ['none'],
      code_challenge_methods_supported: ['S256'],
      scopes_supported: MCP_OAUTH_SCOPES,
      client_id_metadata_document_supported: false
    });
  };

  register = async (req: Request, res: Response) => {
    try {
      res.status(201).json(await this.useCase.registerClient(req.body));
    } catch (error) {
      this.oauthError(res, error);
    }
  };

  token = async (req: Request, res: Response) => {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Pragma', 'no-cache');
    try {
      res.json(await this.useCase.exchangeToken(bodyRecord(req.body)));
    } catch (error) {
      this.oauthError(res, error);
    }
  };

  revoke = async (req: Request, res: Response) => {
    res.setHeader('Cache-Control', 'no-store');
    try {
      await this.useCase.revoke(bodyRecord(req.body));
      res.status(200).end();
    } catch (error) {
      this.oauthError(res, error);
    }
  };

  authorizationContext = async (req: Request, res: Response) => {
    try {
      res.json(await this.useCase.authorizationContext(this.userId(req), authorizationRequest(req.query)));
    } catch (error) {
      this.userFacingError(error);
    }
  };

  authorize = async (req: Request, res: Response) => {
    try {
      res.json(await this.useCase.authorize(this.userId(req), req.body as AuthorizeMcpOAuthInput));
    } catch (error) {
      this.userFacingError(error);
    }
  };

  private userId(req: Request): string {
    if (!req.user) throw new HttpError(401, 'Authentication required');
    return req.user.id;
  }

  private oauthError(res: Response, error: unknown): void {
    if (error instanceof OAuthProtocolError) {
      res.status(error.status).json({ error: error.code, error_description: error.description });
      return;
    }
    console.error('MCP OAuth endpoint failed', error);
    res.status(500).json({ error: 'server_error', error_description: 'The authorization server could not complete the request' });
  }

  private userFacingError(error: unknown): never {
    if (error instanceof OAuthProtocolError) {
      throw new HttpError(error.status, error.description, { code: error.code });
    }
    throw error;
  }
}

function authorizationRequest(query: Request['query']): McpOAuthAuthorizationRequest {
  return {
    responseType: queryString(query, 'response_type', 'responseType'),
    clientId: queryString(query, 'client_id', 'clientId'),
    redirectUri: queryString(query, 'redirect_uri', 'redirectUri'),
    codeChallenge: queryString(query, 'code_challenge', 'codeChallenge'),
    codeChallengeMethod: queryString(query, 'code_challenge_method', 'codeChallengeMethod'),
    state: optionalQueryString(query, 'state'),
    resource: optionalQueryString(query, 'resource'),
    scope: optionalQueryString(query, 'scope')
  };
}

function queryString(query: Request['query'], snake: string, camel: string): string {
  return optionalQueryString(query, snake, camel) ?? '';
}

function optionalQueryString(query: Request['query'], ...names: string[]): string | undefined {
  for (const name of names) {
    const value = query[name];
    if (typeof value === 'string') return value;
  }
  return undefined;
}

function bodyRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}
