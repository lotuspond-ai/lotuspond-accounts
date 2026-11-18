// Accounts: sign-up, sign-in, email links, passwords, sessions and audit. Each account lives in its region's cell;
// the directory says which cell holds an email. Nothing here knows about HTTP or Hydra.
import { and, desc, eq, gt, isNull, ne } from 'drizzle-orm';
import type { Region } from './config.ts';
import type { Database, Db } from './db/client.ts';
import {
  accounts, auditEvents, credentials, emailTokens, hydraSessions, productSignIns, sessions, type AuditKind,
} from './db/cell-schema.ts';
import { claim, lookup, normaliseEmail, release } from './lib/directory.ts';
import { isCountryCode, regionFor } from './lib/countries.ts';
import { randomToken, sha256 } from './lib/crypto.ts';
import type { Keys } from './lib/keys.ts';
import { hashPassword, passwordProblem, verifyAgainstDummy, verifyPassword } from './auth/password.ts';

export type Account = typeof accounts.$inferSelect;
export type Product = 'health' | 'works';

/** The account terms a person agrees to at sign-up. Changing the terms changes this. */
export const TERMS_VERSION = '2026-11-17';

const MINUTE = 60_000;
export const TOKEN_LIFETIME = { verify: 24 * 60 * MINUTE, reset: 30 * MINUTE } as const;

export interface Cells {
  directory: Pick<Database, 'db'>;
  cells: Map<Region, Pick<Database, 'db'>>;
}

export interface SignUpInput {
  email: string;
  password: string;
  name: string;
  country: string;
  acceptTerms: boolean;
}

/** A problem a person can fix, keyed to the field it is about. */
export interface Problem { field: 'email' | 'password' | 'name' | 'country' | 'acceptTerms' | 'form'; message: string; code: string }

export const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export interface AuditContext { ipHash?: string; userAgent?: string }

export class AccountService {
  constructor(private readonly dbs: Cells, private readonly keys: Keys, private readonly openCountries: readonly string[]) {}

  private cell(region: Region): Db | null {
    return this.dbs.cells.get(region)?.db ?? null;
  }

  /* ---------- sign-up and sign-in ---------- */

  async signUp(input: SignUpInput, ctx: AuditContext): Promise<{ account: Account } | { problem: Problem }> {
    const email = normaliseEmail(input.email);
    const name = input.name.trim();
    const country = input.country.trim().toUpperCase();
    if (!EMAIL_PATTERN.test(email) || email.length > 254) return { problem: { field: 'email', code: 'invalid_email', message: 'Enter a valid email address.' } };
    const weak = passwordProblem(input.password);
    if (weak) return { problem: { field: 'password', code: 'weak_password', message: weak } };
    if (!name || name.length > 80) return { problem: { field: 'name', code: 'invalid_name', message: 'Enter your name, up to 80 characters.' } };
    if (!isCountryCode(country)) return { problem: { field: 'country', code: 'invalid_country', message: 'Choose the country you live in.' } };
    if (!this.openCountries.includes(country)) {
      return { problem: { field: 'country', code: 'country_unavailable', message: 'LotusPond accounts are open to people living in India first. They will open in more countries later.' } };
    }
    const region = regionFor(country);
    const db = this.cell(region);
    if (!db) return { problem: { field: 'country', code: 'region_not_served', message: 'LotusPond accounts are not open in your region yet.' } };
    if (!input.acceptTerms) return { problem: { field: 'acceptTerms', code: 'terms_required', message: 'Agree to the LotusPond account terms to continue.' } };

    const taken: Problem = { field: 'email', code: 'email_taken', message: 'An account with this email already exists. Sign in instead, or reset your password.' };
    const accountId = crypto.randomUUID();
    const secret = await hashPassword(input.password);
    if (!(await claim(this.dbs.directory.db, this.keys.directory, email, region, accountId))) return { problem: taken };
    let account: Account;
    try {
      account = await db.transaction(async tx => {
        const [a] = await tx.insert(accounts).values({ id: accountId, email, name, country, region, termsVersionAccepted: TERMS_VERSION }).returning();
        await tx.insert(credentials).values({ accountId, kind: 'password', secret });
        return a;
      });
    } catch (e) {
      await release(this.dbs.directory.db, accountId).catch(() => {});
      if (isUniqueViolation(e)) return { problem: taken };
      throw e;
    }
    // After the commit and outside the try: a failed audit write must not release the email of an account that exists.
    await this.audit(region, accountId, 'account_created', ctx);
    return { account };
  }

  /** The account for an email and password, or null. Takes the same time whether or not the email exists. */
  async authenticate(emailInput: string, password: string, ctx: AuditContext): Promise<Account | null> {
    const account = await this.findByEmail(emailInput);
    const hash = account ? await this.passwordHash(account) : null;
    const ok = hash ? await verifyPassword(hash, password) : await verifyAgainstDummy(password);
    if (!account) return null;
    if (!ok || account.status !== 'active') {
      await this.audit(account.region, account.id, 'sign_in_failed', ctx);
      return null;
    }
    await this.audit(account.region, account.id, 'sign_in', ctx);
    return account;
  }

  async findByEmail(emailInput: string): Promise<Account | null> {
    const email = normaliseEmail(emailInput);
    const entry = await lookup(this.dbs.directory.db, this.keys.directory, email);
    if (!entry) return null;
    const db = this.cell(entry.region);
    if (!db) return null;
    const [account] = await db.select().from(accounts).where(and(eq(accounts.id, entry.accountId), eq(accounts.email, email))).limit(1);
    return account ?? null;
  }

  async findById(id: string): Promise<Account | null> {
    if (!isUuid(id)) return null;
    const found = await Promise.all([...this.dbs.cells.values()].map(async ({ db }) =>
      (await db.select().from(accounts).where(eq(accounts.id, id)).limit(1))[0]));
    return found.find(Boolean) ?? null;
  }

  private async passwordHash(account: Account): Promise<string | null> {
    const db = this.cell(account.region)!;
    const [row] = await db.select({ secret: credentials.secret }).from(credentials)
      .where(and(eq(credentials.accountId, account.id), eq(credentials.kind, 'password'))).orderBy(desc(credentials.createdAt)).limit(1);
    return row?.secret ?? null;
  }

  /* ---------- email links ---------- */

  /** Make a single-use link token. Only its SHA-256 is stored; the raw token goes in the email. */
  async issueToken(account: Account, purpose: 'verify' | 'reset'): Promise<string> {
    const token = randomToken();
    // The region rides in the token, so the link finds its cell without a directory lookup.
    const raw = `${account.region}.${token}`;
    await this.cell(account.region)!.insert(emailTokens).values({
      idDigest: sha256(raw), accountId: account.id, purpose, expiresAt: new Date(Date.now() + TOKEN_LIFETIME[purpose]),
    });
    return raw;
  }

  /** True when a token exists, is unused and unexpired. Does not use it. */
  async tokenIsLive(raw: string, purpose: 'verify' | 'reset'): Promise<boolean> {
    const found = this.tokenCell(raw);
    if (!found) return false;
    const [row] = await found.db.select({ id: emailTokens.idDigest }).from(emailTokens).where(and(
      eq(emailTokens.idDigest, sha256(raw)), eq(emailTokens.purpose, purpose), isNull(emailTokens.usedAt), gt(emailTokens.expiresAt, new Date()),
    )).limit(1);
    return !!row;
  }

  /** Use a token: marks it used in one statement, so two requests cannot both use it. The account, or null. */
  private async useToken(raw: string, purpose: 'verify' | 'reset'): Promise<{ account: Account; db: Db } | null> {
    const found = this.tokenCell(raw);
    if (!found) return null;
    const [row] = await found.db.update(emailTokens).set({ usedAt: new Date() }).where(and(
      eq(emailTokens.idDigest, sha256(raw)), eq(emailTokens.purpose, purpose), isNull(emailTokens.usedAt), gt(emailTokens.expiresAt, new Date()),
    )).returning({ accountId: emailTokens.accountId });
    if (!row) return null;
    const [account] = await found.db.select().from(accounts).where(eq(accounts.id, row.accountId)).limit(1);
    return account && account.status === 'active' ? { account, db: found.db } : null;
  }

  private tokenCell(raw: string): { db: Db } | null {
    const m = /^(in|eu|us|global)\.[\w-]{40,50}$/.exec(raw);
    const db = m ? this.cell(m[1] as Region) : null;
    return db ? { db } : null;
  }

  async verifyEmail(raw: string, ctx: AuditContext): Promise<Account | null> {
    const used = await this.useToken(raw, 'verify');
    if (!used) return null;
    if (used.account.emailVerifiedAt) return used.account;
    const [account] = await used.db.update(accounts).set({ emailVerifiedAt: new Date(), updatedAt: new Date() })
      .where(eq(accounts.id, used.account.id)).returning();
    await this.audit(account.region, account.id, 'email_verified', ctx);
    return account;
  }

  /**
   * Choose a new password with a reset link. Proves control of the mailbox, so it also verifies the email. Ends every
   * Accounts session and returns the Hydra sessions to revoke, so products sign the person out too.
   */
  async resetPassword(raw: string, password: string, ctx: AuditContext): Promise<{ account: Account; revoke: string[] } | { problem: Problem } | null> {
    const weak = passwordProblem(password);
    if (weak) return { problem: { field: 'password', code: 'weak_password', message: weak } };
    const used = await this.useToken(raw, 'reset');
    if (!used) return null;
    const { db } = used;
    const secret = await hashPassword(password);
    const now = new Date();
    const result = await db.transaction(async tx => {
      await tx.delete(credentials).where(and(eq(credentials.accountId, used.account.id), eq(credentials.kind, 'password')));
      await tx.insert(credentials).values({ accountId: used.account.id, kind: 'password', secret });
      // Every other reset link for this account stops working.
      await tx.update(emailTokens).set({ usedAt: now }).where(and(eq(emailTokens.accountId, used.account.id), eq(emailTokens.purpose, 'reset'), isNull(emailTokens.usedAt)));
      await tx.delete(sessions).where(eq(sessions.accountId, used.account.id));
      const sids = await tx.delete(hydraSessions).where(eq(hydraSessions.accountId, used.account.id)).returning({ sid: hydraSessions.sid });
      const [account] = await tx.update(accounts).set({ emailVerifiedAt: used.account.emailVerifiedAt ?? now, updatedAt: now })
        .where(eq(accounts.id, used.account.id)).returning();
      return { account, revoke: sids.map(s => s.sid) };
    });
    await this.audit(result.account.region, result.account.id, 'password_reset', ctx);
    return result;
  }

  /**
   * Change a password, knowing the current one. Ends the account's other Accounts sessions and returns the Hydra
   * sessions to revoke, keeping the one this browser uses.
   */
  async changePassword(account: Account, current: string, next: string, keep: { sessionDigest: string; sid?: string }, ctx: AuditContext):
    Promise<{ revoke: string[] } | { problem: Problem }> {
    const hash = await this.passwordHash(account);
    if (!hash || !(await verifyPassword(hash, current))) return { problem: { field: 'password', code: 'wrong_password', message: 'Your current password is not right.' } };
    const weak = passwordProblem(next);
    if (weak) return { problem: { field: 'password', code: 'weak_password', message: weak } };
    const db = this.cell(account.region)!;
    const secret = await hashPassword(next);
    const revoke = await db.transaction(async tx => {
      await tx.delete(credentials).where(and(eq(credentials.accountId, account.id), eq(credentials.kind, 'password')));
      await tx.insert(credentials).values({ accountId: account.id, kind: 'password', secret });
      await tx.delete(sessions).where(and(eq(sessions.accountId, account.id), ne(sessions.idDigest, keep.sessionDigest)));
      const others = keep.sid ? and(eq(hydraSessions.accountId, account.id), ne(hydraSessions.sid, keep.sid)) : eq(hydraSessions.accountId, account.id);
      const sids = await tx.delete(hydraSessions).where(others).returning({ sid: hydraSessions.sid });
      return sids.map(s => s.sid);
    });
    await this.audit(account.region, account.id, 'password_changed', ctx);
    return { revoke };
  }

  async rename(account: Account, nameInput: string): Promise<Account | { problem: Problem }> {
    const name = nameInput.trim();
    if (!name || name.length > 80) return { problem: { field: 'name', code: 'invalid_name', message: 'Enter your name, up to 80 characters.' } };
    const [row] = await this.cell(account.region)!.update(accounts).set({ name, updatedAt: new Date() }).where(eq(accounts.id, account.id)).returning();
    return row;
  }

  /* ---------- sessions ---------- */

  /** Start an Accounts session. The raw token goes in the cookie; the database keeps its SHA-256. */
  async startSession(account: Account, ttlMs: number, userAgent: string | undefined): Promise<{ token: string; expiresAt: Date }> {
    const token = `${account.region}.${randomToken()}`;
    const expiresAt = new Date(Date.now() + ttlMs);
    await this.cell(account.region)!.insert(sessions).values({ idDigest: sha256(token), accountId: account.id, expiresAt, userAgent: userAgent?.slice(0, 300) ?? null });
    return { token, expiresAt };
  }

  async session(token: string | undefined): Promise<{ account: Account; digest: string } | null> {
    if (!token) return null;
    const found = this.tokenCell(token);
    if (!found) return null;
    const digest = sha256(token);
    const [row] = await found.db.select({ session: sessions, account: accounts }).from(sessions)
      .innerJoin(accounts, eq(accounts.id, sessions.accountId)).where(eq(sessions.idDigest, digest)).limit(1);
    if (!row || row.session.expiresAt <= new Date() || row.account.status !== 'active') return null;
    await found.db.update(sessions).set({ lastSeenAt: new Date() }).where(eq(sessions.idDigest, digest));
    return { account: row.account, digest };
  }

  async endSession(token: string | undefined): Promise<void> {
    const found = token ? this.tokenCell(token) : null;
    if (found && token) await found.db.delete(sessions).where(eq(sessions.idDigest, sha256(token)));
  }

  /** Remember a Hydra login session for this account, so it can be revoked later. */
  async rememberHydraSession(account: Account, sid: string | undefined): Promise<void> {
    if (!sid) return;
    await this.cell(account.region)!.insert(hydraSessions).values({ sid, accountId: account.id }).onConflictDoNothing();
  }

  async forgetHydraSession(account: Account, sid: string): Promise<void> {
    await this.cell(account.region)!.delete(hydraSessions).where(and(eq(hydraSessions.sid, sid), eq(hydraSessions.accountId, account.id)));
  }

  async recordProductSignIn(account: Account, product: Product): Promise<void> {
    await this.cell(account.region)!.insert(productSignIns).values({ accountId: account.id, product })
      .onConflictDoUpdate({ target: [productSignIns.accountId, productSignIns.product], set: { lastAt: new Date() } });
  }

  async connectedProducts(account: Account): Promise<{ product: Product; firstAt: Date; lastAt: Date }[]> {
    return this.cell(account.region)!.select({ product: productSignIns.product, firstAt: productSignIns.firstAt, lastAt: productSignIns.lastAt })
      .from(productSignIns).where(eq(productSignIns.accountId, account.id));
  }

  /* ---------- audit ---------- */

  async audit(region: Region, accountId: string | null, kind: AuditKind, ctx: AuditContext): Promise<void> {
    const detail: Record<string, string> = {};
    if (ctx.ipHash) detail.ip = ctx.ipHash;
    if (ctx.userAgent) detail.userAgent = ctx.userAgent.slice(0, 300);
    await this.cell(region)!.insert(auditEvents).values({ accountId, kind, detail });
  }
}

const isUuid = (s: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);

/** Drizzle wraps the driver's error; the Postgres code may be on it or on its cause. */
function isUniqueViolation(e: unknown): boolean {
  for (let x: unknown = e; x && typeof x === 'object'; x = (x as { cause?: unknown }).cause) {
    if ((x as { code?: string }).code === '23505') return true;
  }
  return false;
}
