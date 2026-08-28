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

export const env: Env = {
  port,
  databaseUrl: requireEnv('DATABASE_URL'),
  jwtSecret: requireEnv('JWT_SECRET'),
  corsOrigin,
  assetsDir: path.resolve(process.env.ASSETS_DIR ?? './data/assets'),
  publicBaseUrl: (process.env.PUBLIC_BASE_URL ?? `http://localhost:${port}`).replace(/\/$/, ''),
  mcpAllowedOrigins: (process.env.MCP_ALLOWED_ORIGINS ?? [
    corsOrigin,
    'https://tale.yasui.io',
    'https://opentales.hoodgail.me'
  ].join(','))
    .split(',')
    .map((value) => value.trim().replace(/\/$/, ''))
    .filter(Boolean)
};
