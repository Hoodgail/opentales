import crypto from 'node:crypto';
import { env } from '../config/env.js';

const PREFIX = 'v1';

export function encryptSecret(value: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key(), iv);
  const encrypted = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [PREFIX, iv.toString('base64url'), tag.toString('base64url'), encrypted.toString('base64url')].join(':');
}

export function decryptSecret(value: string): string {
  const [prefix, iv, tag, encrypted] = value.split(':');
  if (prefix !== PREFIX || !iv || !tag || !encrypted) {
    return value;
  }
  const decipher = crypto.createDecipheriv(
    'aes-256-gcm',
    key(),
    Buffer.from(iv, 'base64url')
  );
  decipher.setAuthTag(Buffer.from(tag, 'base64url'));
  return Buffer.concat([
    decipher.update(Buffer.from(encrypted, 'base64url')),
    decipher.final()
  ]).toString('utf8');
}

function key(): Buffer {
  return crypto.createHash('sha256').update(env.jwtSecret).digest();
}
