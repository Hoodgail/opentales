import 'dotenv/config';
import path from 'node:path';

export interface Env {
  port: number;
  databaseUrl: string;
  jwtSecret: string;
  corsOrigin: string;
  assetsDir: string;
  publicBaseUrl: string;
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

const port = Number(process.env.PORT ?? 4000);

export const env: Env = {
  port,
  databaseUrl: requireEnv('DATABASE_URL'),
  jwtSecret: requireEnv('JWT_SECRET'),
  corsOrigin: process.env.CORS_ORIGIN ?? 'http://localhost:5173',
  assetsDir: path.resolve(process.env.ASSETS_DIR ?? './data/assets'),
  publicBaseUrl: (process.env.PUBLIC_BASE_URL ?? `http://localhost:${port}`).replace(/\/$/, '')
};
