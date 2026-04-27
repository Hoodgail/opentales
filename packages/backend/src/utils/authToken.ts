import jwt from 'jsonwebtoken';
import { env } from '../config/env.js';

export interface AuthTokenPayload {
  userId: string;
}

export function signAuthToken(payload: AuthTokenPayload): string {
  return jwt.sign(payload, env.jwtSecret, { expiresIn: '30d' });
}

export function verifyAuthToken(token: string): AuthTokenPayload {
  return jwt.verify(token, env.jwtSecret) as AuthTokenPayload;
}
