// The directory: which cell holds the account for an email. It stores only an HMAC of the email, so no address is
// kept in plain text outside its own cell.
import { eq } from 'drizzle-orm';
import type { Region } from '../config.ts';
import type { Db } from '../db/client.ts';
import { directory } from '../db/directory-schema.ts';
import { hmac } from './crypto.ts';

export const normaliseEmail = (email: string): string => email.trim().toLowerCase();

export const emailHash = (key: Buffer, email: string): string => hmac(key, normaliseEmail(email));

export async function lookup(db: Db, key: Buffer, email: string): Promise<{ region: Region; accountId: string } | null> {
  const [row] = await db.select().from(directory).where(eq(directory.emailHash, emailHash(key, email))).limit(1);
  return row ? { region: row.region, accountId: row.accountId } : null;
}

/** Reserve an email for a new account. False when another account already holds it, in any cell. */
export async function claim(db: Db, key: Buffer, email: string, region: Region, accountId: string): Promise<boolean> {
  const rows = await db.insert(directory).values({ emailHash: emailHash(key, email), region, accountId })
    .onConflictDoNothing().returning({ accountId: directory.accountId });
  return rows.length === 1;
}

export async function release(db: Db, accountId: string): Promise<void> {
  await db.delete(directory).where(eq(directory.accountId, accountId));
}
