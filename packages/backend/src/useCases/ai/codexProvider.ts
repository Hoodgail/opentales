import { randomUUID } from 'node:crypto';
import type { PrismaClient } from '@prisma/client';
import { HttpError } from '../../http/HttpError.js';
import { decryptSecret, encryptSecret } from '../../utils/secretBox.js';
import {
  CODEX_API_ENDPOINT,
  CODEX_CLIENT_ID,
  CODEX_DEVICE_VERIFICATION_URL,
  CODEX_ISSUER
} from './codexModels.js';

const REQUEST_TIMEOUT_MS = 15_000;
const REFRESH_EARLY_MS = 60_000;
const DEFAULT_DEVICE_AUTH_EXPIRES_SECONDS = 900;
const CODEX_USER_AGENT = 'codex_cli_rs/0.0.0 (OpenTales)';

export interface CodexCredentials {
  kind: 'codex-oauth';
  version: 1;
  access: string;
  refresh: string;
  expires: number;
  accountId?: string;
}

export interface CodexDeviceAuthorization {
  deviceAuthId: string;
  userCode: string;
  verificationUri: string;
  expiresIn: number;
  interval: number;
}

export type CodexDevicePollResult =
  | { status: 'pending'; interval?: number }
  | { status: 'authorized'; credentials: CodexCredentials }
  | { status: 'failed'; message: string };

interface TokenResponse {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  id_token?: string;
}

interface JwtClaims {
  chatgpt_account_id?: string;
  chatgpt_compute_residency?: string;
  organizations?: Array<{ id?: string }>;
  'https://api.openai.com/auth'?: {
    chatgpt_account_id?: string;
    chatgpt_compute_residency?: string;
  };
}

const refreshes = new Map<string, Promise<CodexCredentials>>();

export async function startCodexDeviceAuthorization(
  fetchFn: typeof fetch = fetch
): Promise<CodexDeviceAuthorization> {
  const response = await fetchCodexAuth(fetchFn, `${CODEX_ISSUER}/api/accounts/deviceauth/usercode`, {
    method: 'POST',
    headers: codexJsonHeaders(),
    body: JSON.stringify({ client_id: CODEX_CLIENT_ID }),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
  }, 'Codex authorization service is unavailable');
  if (!response.ok) {
    throw new HttpError(
      502,
      'Failed to start Codex authentication. Enable device code login in ChatGPT security settings and try again.'
    );
  }

  const data = await responseJson(response) as {
    device_auth_id?: string;
    user_code?: string;
    interval?: string | number;
    expires_in?: number;
  };
  if (!data.device_auth_id || !data.user_code) {
    throw new HttpError(502, 'Invalid Codex device authorization response');
  }

  return {
    deviceAuthId: data.device_auth_id,
    userCode: data.user_code,
    verificationUri: CODEX_DEVICE_VERIFICATION_URL,
    expiresIn: positiveInteger(data.expires_in, DEFAULT_DEVICE_AUTH_EXPIRES_SECONDS),
    interval: positiveInteger(data.interval, 5)
  };
}

export async function pollCodexDeviceAuthorization(
  deviceAuthId: string,
  userCode: string,
  fetchFn: typeof fetch = fetch,
  now: () => number = Date.now
): Promise<CodexDevicePollResult> {
  const response = await fetchCodexAuth(fetchFn, `${CODEX_ISSUER}/api/accounts/deviceauth/token`, {
    method: 'POST',
    headers: codexJsonHeaders(),
    body: JSON.stringify({ device_auth_id: deviceAuthId, user_code: userCode }),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
  }, 'Codex authorization service is unavailable');

  if (response.status === 403 || response.status === 404) {
    const pending = await optionalResponseJson(response);
    return { status: 'pending', interval: positiveInteger(recordValue(pending, 'interval'), 5) };
  }
  if (!response.ok) {
    return { status: 'failed', message: 'Codex authorization failed. Start a new connection and try again.' };
  }

  const authorization = await responseJson(response) as {
    authorization_code?: string;
    code_verifier?: string;
  };
  if (!authorization.authorization_code || !authorization.code_verifier) {
    return { status: 'failed', message: 'Codex returned an invalid authorization response.' };
  }

  const tokens = await exchangeCodexAuthorizationCode(
    authorization.authorization_code,
    authorization.code_verifier,
    fetchFn
  );
  return { status: 'authorized', credentials: credentialsFromTokens(tokens, undefined, now()) };
}

export function serializeCodexCredentials(credentials: CodexCredentials): string {
  return JSON.stringify(credentials);
}

export function parseCodexCredentials(value: string): CodexCredentials {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new HttpError(400, 'Stored Codex credentials are invalid; reconnect Codex');
  }
  if (!isRecord(parsed)
    || parsed.kind !== 'codex-oauth'
    || parsed.version !== 1
    || typeof parsed.access !== 'string'
    || !parsed.access
    || typeof parsed.refresh !== 'string'
    || !parsed.refresh
    || typeof parsed.expires !== 'number'
    || !Number.isFinite(parsed.expires)) {
    throw new HttpError(400, 'Stored Codex credentials are invalid; reconnect Codex');
  }
  return {
    kind: 'codex-oauth',
    version: 1,
    access: parsed.access,
    refresh: parsed.refresh,
    expires: parsed.expires,
    ...(typeof parsed.accountId === 'string' && parsed.accountId ? { accountId: parsed.accountId } : {})
  };
}

export function encryptedCodexCredentials(credentials: CodexCredentials): string {
  return encryptSecret(serializeCodexCredentials(credentials));
}

export function extractAccountIdFromToken(token: string): string | undefined {
  const claims = parseJwtClaims(token);
  return claims?.chatgpt_account_id
    ?? claims?.['https://api.openai.com/auth']?.chatgpt_account_id
    ?? claims?.organizations?.[0]?.id;
}

export function extractResidency(token: string): string | undefined {
  const claims = parseJwtClaims(token);
  const residency = claims?.['https://api.openai.com/auth']?.chatgpt_compute_residency
    ?? claims?.chatgpt_compute_residency;
  return residency && residency !== 'no_constraint' ? residency : undefined;
}

export function createCodexFetch(
  prisma: PrismaClient,
  projectId: string,
  transportFetch: typeof fetch = fetch,
  now: () => number = Date.now
): typeof fetch {
  const sessionId = randomUUID();
  return async (input, init) => {
    const credentials = await resolveCodexCredentials(prisma, projectId, transportFetch, now);
    const headers = new Headers(input instanceof Request ? input.headers : undefined);
    new Headers(init?.headers).forEach((value, key) => headers.set(key, value));
    headers.delete('authorization');
    headers.delete('x-api-key');
    headers.set('Authorization', `Bearer ${credentials.access}`);
    headers.set('User-Agent', CODEX_USER_AGENT);
    headers.set('originator', 'opentales');
    if (!headers.has('session-id')) headers.set('session-id', sessionId);
    if (credentials.accountId) headers.set('ChatGPT-Account-Id', credentials.accountId);

    const originalUrl = input instanceof URL
      ? input
      : new URL(typeof input === 'string' ? input : input.url);
    const rewrite = originalUrl.pathname.includes('/v1/responses')
      || originalUrl.pathname.includes('/chat/completions')
      || originalUrl.pathname.endsWith('/responses');
    const url = rewrite ? new URL(CODEX_API_ENDPOINT) : originalUrl;
    if (rewrite) {
      headers.delete('content-length');
      const residency = extractResidency(credentials.access);
      if (residency) headers.set('x-openai-internal-codex-residency', residency);
    }

    return transportFetch(url, {
      ...init,
      headers,
      body: rewrite ? shapeCodexRequestBody(init?.body) : init?.body
    });
  };
}

export async function resolveCodexCredentials(
  prisma: PrismaClient,
  projectId: string,
  fetchFn: typeof fetch = fetch,
  now: () => number = Date.now
): Promise<CodexCredentials> {
  const settings = await prisma.projectAiSettings.findUnique({
    where: { projectId },
    select: { apiKey: true, providerKind: true }
  });
  if (settings?.providerKind !== 'CODEX' || !settings.apiKey) {
    throw new HttpError(400, 'Codex is not connected for this project');
  }

  const credentials = parseCodexCredentials(decryptSecret(settings.apiKey));
  if (credentials.access && credentials.expires > now() + REFRESH_EARLY_MS) return credentials;

  const existing = refreshes.get(projectId);
  if (existing) return existing;
  const refresh = refreshAndPersistCodexCredentials(
    prisma,
    projectId,
    settings.apiKey,
    credentials,
    fetchFn,
    now
  ).finally(() => refreshes.delete(projectId));
  refreshes.set(projectId, refresh);
  return refresh;
}

async function refreshAndPersistCodexCredentials(
  prisma: PrismaClient,
  projectId: string,
  encryptedCurrent: string,
  current: CodexCredentials,
  fetchFn: typeof fetch,
  now: () => number
): Promise<CodexCredentials> {
  const response = await fetchCodexAuth(fetchFn, `${CODEX_ISSUER}/oauth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: current.refresh,
      client_id: CODEX_CLIENT_ID
    }).toString(),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
  }, 'Codex token service is unavailable');
  if (!response.ok) throw new HttpError(401, 'Codex session expired; reconnect Codex');
  const refreshed = credentialsFromTokens(await responseJson(response) as TokenResponse, current, now());
  const saved = await prisma.projectAiSettings.updateMany({
    where: { projectId, providerKind: 'CODEX', apiKey: encryptedCurrent },
    data: { apiKey: encryptedCodexCredentials(refreshed) }
  });
  if (saved.count !== 1) throw new HttpError(409, 'Codex settings changed while refreshing; retry the request');
  return refreshed;
}

async function exchangeCodexAuthorizationCode(
  authorizationCode: string,
  codeVerifier: string,
  fetchFn: typeof fetch
): Promise<TokenResponse> {
  const response = await fetchCodexAuth(fetchFn, `${CODEX_ISSUER}/oauth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code: authorizationCode,
      redirect_uri: `${CODEX_ISSUER}/deviceauth/callback`,
      client_id: CODEX_CLIENT_ID,
      code_verifier: codeVerifier
    }).toString(),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
  }, 'Codex token service is unavailable');
  if (!response.ok) throw new HttpError(502, 'Failed to finish Codex authentication');
  return responseJson(response) as Promise<TokenResponse>;
}

function credentialsFromTokens(
  tokens: TokenResponse,
  current: CodexCredentials | undefined,
  now: number
): CodexCredentials {
  const access = tokens.access_token;
  const refresh = tokens.refresh_token ?? current?.refresh;
  if (!access || !refresh) throw new HttpError(502, 'Codex returned incomplete credentials');
  const accountId = extractAccountIdFromToken(tokens.id_token ?? '')
    ?? extractAccountIdFromToken(access)
    ?? current?.accountId;
  return {
    kind: 'codex-oauth',
    version: 1,
    access,
    refresh,
    expires: now + positiveInteger(tokens.expires_in, 3600) * 1000,
    ...(accountId ? { accountId } : {})
  };
}

function parseJwtClaims(token: string): JwtClaims | undefined {
  const payload = token.split('.')[1];
  if (!payload) return undefined;
  try {
    const parsed = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as unknown;
    return isRecord(parsed) ? parsed as JwtClaims : undefined;
  } catch {
    return undefined;
  }
}

function shapeCodexRequestBody(
  body: RequestInit['body']
): RequestInit['body'] {
  if (typeof body !== 'string') return body;
  try {
    const parsed = JSON.parse(body) as unknown;
    if (!isRecord(parsed)) return body;
    delete parsed.max_output_tokens;
    // The ChatGPT Codex subscription endpoint rejects the Responses API
    // default (`store: true`). Codex CLI-compatible clients must opt out of
    // response storage on every request, including tool-driven generations.
    parsed.store = false;
    return JSON.stringify(parsed);
  } catch {
    return body;
  }
}

function codexJsonHeaders(): RequestInit['headers'] {
  return {
    Accept: 'application/json',
    'Content-Type': 'application/json',
    'User-Agent': CODEX_USER_AGENT
  };
}

async function responseJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    throw new HttpError(502, 'Codex returned an invalid response');
  }
}

async function fetchCodexAuth(
  fetchFn: typeof fetch,
  input: Parameters<typeof fetch>[0],
  init: Parameters<typeof fetch>[1],
  failureMessage: string
): Promise<Response> {
  try {
    return await fetchFn(input, init);
  } catch (error) {
    if (error instanceof HttpError) throw error;
    throw new HttpError(502, failureMessage);
  }
}

async function optionalResponseJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return undefined;
  }
}

function recordValue(value: unknown, key: string): unknown {
  return isRecord(value) ? value[key] : undefined;
}

function positiveInteger(value: unknown, fallback: number): number {
  const parsed = typeof value === 'string' ? Number.parseInt(value, 10) : value;
  return typeof parsed === 'number' && Number.isFinite(parsed) && parsed > 0
    ? Math.trunc(parsed)
    : fallback;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

export function clearCodexRefreshesForTests(): void {
  refreshes.clear();
}
