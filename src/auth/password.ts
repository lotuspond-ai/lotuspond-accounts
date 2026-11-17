// Argon2id with LotusPond Health's parameters (OWASP: 19 MiB, 2 iterations), so Health's hashes import unchanged.
// verify() reads the parameters from the stored hash, so older or stronger hashes keep working.
import { hash, verify } from '@node-rs/argon2';

const OPTIONS = { memoryCost: 19456, timeCost: 2, parallelism: 1 } as const;
export const PASSWORD_MIN = 10;
export const PASSWORD_MAX = 256;

export const hashPassword = (password: string): Promise<string> => hash(password, OPTIONS);

export async function verifyPassword(stored: string, password: string): Promise<boolean> {
  try {
    return await verify(stored, password);
  } catch {
    return false;
  }
}

let dummy: Promise<string> | null = null;

/** Spend the same time as a real check when there is no account, so timing does not reveal which emails exist. */
export async function verifyAgainstDummy(password: string): Promise<false> {
  dummy ??= hashPassword('lotuspond-accounts-timing-equaliser');
  await verifyPassword(await dummy, password);
  return false;
}

/** The problem with a new password, or null. */
export function passwordProblem(password: string): string | null {
  if (password.length < PASSWORD_MIN) return `Use at least ${PASSWORD_MIN} characters.`;
  if (password.length > PASSWORD_MAX) return `Use at most ${PASSWORD_MAX} characters.`;
  return null;
}
