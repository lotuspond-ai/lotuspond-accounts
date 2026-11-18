// Importing a product's existing accounts (build plan, "Moving existing Health accounts"). The input is Health's
// accounts:export file, one JSON object per line; the answer is one { health_user_id, sub } line per account, which
// Health's accounts:link reads. The Argon2id hash is kept as it is, so people keep their password. Imported accounts
// start with the email unconfirmed: the first sign-in asks the person to confirm it (decision 3). An email Accounts
// already holds is never joined here: Health joins it by verified email at the person's first sign-in.
import { and, eq } from 'drizzle-orm';
import type { Region } from './config.ts';
import type { Db } from './db/client.ts';
import { accounts, credentials, legacyLinks } from './db/cell-schema.ts';
import { claim, lookup, normaliseEmail, release } from './lib/directory.ts';
import { isCountryCode, regionFor } from './lib/countries.ts';
import { EMAIL_PATTERN, type Cells } from './accounts.ts';
import type { Keys } from './lib/keys.ts';

/** One line of Health's export (lotuspond-health server/src/auth/accounts-migration.ts, ExportedAccount). */
export interface ExportedAccount {
  health_user_id: string;
  email: string;
  password_hash: string | null;
  region: string;
  country: string | null;
  created_at: string;
  accounts_subject: string | null;
  /** Not in Health's export today; used when present. */
  display_name?: string;
}

export interface ImportReport {
  /** New accounts, with their answer lines. */
  created: number;
  /** Imported by an earlier run: answered again with the same subject. */
  alreadyImported: number;
  /** Already linked to an Accounts subject that exists here: answered with it. */
  alreadyLinked: number;
  /** Not imported, with the reason. No email address appears here. */
  skipped: { health_user_id: string | null; reason: string }[];
  answers: { health_user_id: string; sub: string }[];
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ARGON2 = /^\$argon2(id|i|d)\$v=\d+\$m=\d+,t=\d+,p=\d+\$[A-Za-z0-9+/]+\$[A-Za-z0-9+/]+$/;
const REGIONS: readonly Region[] = ['in', 'eu', 'us', 'global'];

export async function importAccounts(dbs: Cells, keys: Keys, lines: Iterable<string>): Promise<ImportReport> {
  const report: ImportReport = { created: 0, alreadyImported: 0, alreadyLinked: 0, skipped: [], answers: [] };
  const skip = (id: unknown, reason: string) => report.skipped.push({ health_user_id: typeof id === 'string' && UUID.test(id) ? id : null, reason });

  for (const raw of lines) {
    if (!raw.trim()) continue;
    let row: ExportedAccount;
    try {
      row = JSON.parse(raw) as ExportedAccount;
    } catch {
      skip(null, 'not JSON');
      continue;
    }
    const id = row?.health_user_id;
    if (typeof id !== 'string' || !UUID.test(id)) { skip(id, 'no valid health_user_id'); continue; }
    const email = typeof row.email === 'string' ? normaliseEmail(row.email) : '';
    if (!EMAIL_PATTERN.test(email) || email.length > 254) { skip(id, 'no valid email'); continue; }
    if (!(REGIONS as readonly string[]).includes(row.region)) { skip(id, 'unknown region'); continue; }
    const region = row.region as Region;
    const cell = dbs.cells.get(region)?.db;
    if (!cell) { skip(id, `region ${region} is not served here`); continue; }

    // Imported before: answer the same subject again.
    const [earlier] = await cell.select({ accountId: legacyLinks.accountId }).from(legacyLinks)
      .where(and(eq(legacyLinks.product, 'health'), eq(legacyLinks.productUserId, id))).limit(1);
    if (earlier) {
      report.alreadyImported++;
      report.answers.push({ health_user_id: id, sub: earlier.accountId });
      continue;
    }

    // Linked already, because the person signed in with Accounts before the import.
    if (row.accounts_subject) {
      const [linked] = UUID.test(row.accounts_subject)
        ? await cell.select({ id: accounts.id }).from(accounts).where(eq(accounts.id, row.accounts_subject)).limit(1)
        : [];
      if (linked) { report.alreadyLinked++; report.answers.push({ health_user_id: id, sub: linked.id }); }
      else skip(id, 'linked to a subject this server does not hold');
      continue;
    }

    if (!row.password_hash) { skip(id, 'no password and no Accounts subject'); continue; }
    if (!ARGON2.test(row.password_hash)) { skip(id, 'password hash is not Argon2'); continue; }

    const country = typeof row.country === 'string' && isCountryCode(row.country.toUpperCase()) ? row.country.toUpperCase() : region === 'in' ? 'IN' : null;
    if (!country) { skip(id, 'no country, and the region does not imply one'); continue; }
    if (regionFor(country) !== region) { skip(id, 'country and region disagree'); continue; }

    if (await lookup(dbs.directory.db, keys.directory, email)) { skip(id, 'an Accounts account already has this email; Health joins it by verified email'); continue; }

    const accountId = crypto.randomUUID();
    if (!(await claim(dbs.directory.db, keys.directory, email, region, accountId))) { skip(id, 'email taken while importing'); continue; }
    const name = (typeof row.display_name === 'string' && row.display_name.trim() ? row.display_name.trim() : email.split('@')[0]).slice(0, 80);
    const createdAt = Number.isNaN(Date.parse(row.created_at)) ? new Date() : new Date(row.created_at);
    try {
      await (cell as Db).transaction(async tx => {
        await tx.insert(accounts).values({ id: accountId, email, name, country, region, createdAt, updatedAt: new Date() });
        await tx.insert(credentials).values({ accountId, kind: 'password', secret: row.password_hash! });
        await tx.insert(legacyLinks).values({ accountId, product: 'health', productUserId: id });
      });
    } catch (e) {
      await release(dbs.directory.db, accountId).catch(() => {});
      throw e;
    }
    report.created++;
    report.answers.push({ health_user_id: id, sub: accountId });
  }
  return report;
}
