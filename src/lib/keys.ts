// The keys Accounts uses, derived from the two configured secrets. Development and tests without secrets get random
// ones for the life of the process; production refuses to start without them (config.ts).
import { randomBytes } from 'node:crypto';
import type { Config } from '../config.ts';
import { deriveKey } from './crypto.ts';

export interface Keys {
  /** HMAC key for the email directory. */
  directory: Buffer;
  /** Signs form tokens (CSRF). */
  forms: Buffer;
  /** Hashes client addresses in the audit log. */
  audit: Buffer;
}

export function loadKeys(config: Pick<Config, 'directorySecret' | 'cookieSecret'>): Keys {
  const directorySecret = config.directorySecret ?? randomBytes(32).toString('hex');
  const cookieSecret = config.cookieSecret ?? randomBytes(32).toString('hex');
  return {
    directory: deriveKey(directorySecret, 'directory'),
    forms: deriveKey(cookieSecret, 'forms'),
    audit: deriveKey(cookieSecret, 'audit'),
  };
}
