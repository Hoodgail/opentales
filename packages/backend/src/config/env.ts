import 'dotenv/config';
import path from 'node:path';

export interface Env {
  port: number;
  databaseUrl: string;
  jwtSecret: string;
  corsOrigin: string;
  assetsDir: string;
  publicBaseUrl: string;
  mcpAllowedOrigins: string[];
  mcpPublicUrl: string;
  mcpOAuthIssuer: string;
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

const port = Number(process.env.PORT ?? 4000);
const corsOrigin = process.env.CORS_ORIGIN ?? 'http://localhost:5173';
const mcpAllowedOrigins = (process.env.MCP_ALLOWED_ORIGINS ?? [
  corsOrigin,
  'https://tale.yasui.io',
  'https://opentales.hoodgail.me'
].join(','))
  .split(',')
  .map((value) => value.trim().replace(/\/$/, ''))
  .filter(Boolean);
const mcpPublicUrl = absoluteUrl(
  process.env.MCP_PUBLIC_URL ?? `${mcpAllowedOrigins[0] ?? corsOrigin}/mcp`,
  'MCP_PUBLIC_URL'
);
const mcpOAuthIssuer = absoluteUrl(
  process.env.MCP_OAUTH_ISSUER ?? new URL(mcpPublicUrl).origin,
  'MCP_OAUTH_ISSUER'
).replace(/\/$/, '');

export const env: Env = {
  port,
  databaseUrl: requireEnv('DATABASE_URL'),
  jwtSecret: requireEnv('JWT_SECRET'),
  corsOrigin,
  assetsDir: path.resolve(process.env.ASSETS_DIR ?? './data/assets'),
  publicBaseUrl: (process.env.PUBLIC_BASE_URL ?? `http://localhost:${port}`).replace(/\/$/, ''),
  mcpAllowedOrigins,
  mcpPublicUrl,
  mcpOAuthIssuer
};

function absoluteUrl(value: string, name: string): string {
  try {
    const url = new URL(value);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error('unsupported protocol');
    if (url.hash) throw new Error('fragments are not allowed');
    return url.toString().replace(/\/$/, '');
  } catch {
    throw new Error(`${name} must be an absolute HTTP(S) URL`);
  }
}
