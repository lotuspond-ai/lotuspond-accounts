// Random tokens, digests and keyed hashes. Every secret a browser or an email holds is stored only as its SHA-256.
import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

/** 256 random bits, URL-safe. */
export const randomToken = (): string => randomBytes(32).toString('base64url');

export const sha256 = (value: string): string => createHash('sha256').update(value).digest('hex');

export const hmac = (key: Buffer, value: string): string => createHmac('sha256', key).update(value).digest('base64url');

/** A key for one purpose, derived from a configured secret, so one secret never signs two kinds of thing. */
export const deriveKey = (secret: string, purpose: string): Buffer =>
  createHmac('sha256', secret).update(`lotuspond-accounts:${purpose}:v1`).digest();

export function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}
