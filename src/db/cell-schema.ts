// One account cell (ADR-0002, section 2): the accounts, credentials and sign-in sessions of one region, and the audit
// of their sign-ins. Each region has its own database with this same schema. Generate migrations with
// `npm run db:generate`. Nothing here is a health record, a Works organisation or a product's own data.
import { index, jsonb, pgTable, primaryKey, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import type { Region } from '../config.ts';

const createdAt = () => timestamp('created_at', { withTimezone: true }).notNull().defaultNow();
const updatedAt = () => timestamp('updated_at', { withTimezone: true }).notNull().defaultNow();

export const accounts = pgTable('accounts', {
  /** The OpenID Connect `sub`: stable, and never reused. */
  id: uuid('id').primaryKey().defaultRandom(),
  /** Stored lower-cased and trimmed. */
  email: text('email').notNull(),
  emailVerifiedAt: timestamp('email_verified_at', { withTimezone: true }),
  name: text('name').notNull(),
  /** ISO 3166-1 alpha-2 country of residence. */
  country: text('country').notNull(),
  region: text('region').$type<Region>().notNull(),
  status: text('status').$type<'active' | 'disabled'>().notNull().default('active'),
  termsVersionAccepted: text('terms_version_accepted'),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, t => [uniqueIndex('accounts_email_key').on(t.email)]);

/**
 * Sign-in secrets. Step 1 has only `password` (an Argon2id hash). Passkeys and authenticator secrets are later
 * rows of their own kinds, so adding them needs no change to accounts.
 */
export const credentials = pgTable('credentials', {
  id: uuid('id').primaryKey().defaultRandom(),
  accountId: uuid('account_id').notNull().references(() => accounts.id, { onDelete: 'cascade' }),
  kind: text('kind').$type<'password'>().notNull(),
  secret: text('secret').notNull(),
  createdAt: createdAt(),
}, t => [index('credentials_account_idx').on(t.accountId)]);

/** Single-use email links, stored as SHA-256 of the token: verification (24 hours) and password reset (30 minutes). */
export const emailTokens = pgTable('email_tokens', {
  idDigest: text('id_digest').primaryKey(),
  accountId: uuid('account_id').notNull().references(() => accounts.id, { onDelete: 'cascade' }),
  purpose: text('purpose').$type<'verify' | 'reset'>().notNull(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  usedAt: timestamp('used_at', { withTimezone: true }),
  createdAt: createdAt(),
}, t => [index('email_tokens_account_idx').on(t.accountId)]);

/** The Accounts session behind the __Host-lp_account cookie, stored as SHA-256 of the cookie token. */
export const sessions = pgTable('sessions', {
  idDigest: text('id_digest').primaryKey(),
  accountId: uuid('account_id').notNull().references(() => accounts.id, { onDelete: 'cascade' }),
  createdAt: createdAt(),
  lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).notNull().defaultNow(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  userAgent: text('user_agent'),
}, t => [index('sessions_account_idx').on(t.accountId)]);

/** Products the person has signed in to: what "Connected products" shows, and what blocks deleting the account. */
export const productSignIns = pgTable('product_sign_ins', {
  accountId: uuid('account_id').notNull().references(() => accounts.id, { onDelete: 'cascade' }),
  product: text('product').$type<'health' | 'works'>().notNull(),
  firstAt: timestamp('first_at', { withTimezone: true }).notNull().defaultNow(),
  lastAt: timestamp('last_at', { withTimezone: true }).notNull().defaultNow(),
}, t => [primaryKey({ columns: [t.accountId, t.product] })]);

export type AuditKind =
  | 'account_created' | 'sign_in' | 'sign_in_failed' | 'sign_out' | 'email_verified'
  | 'password_reset' | 'password_changed' | 'account_disabled';

/**
 * Sign-in audit. account_id has no foreign key, so the trail outlives a deleted account for as long as the retention
 * rule keeps it. Email addresses are never written here in plain text.
 */
export const auditEvents = pgTable('audit_events', {
  id: uuid('id').primaryKey().defaultRandom(),
  accountId: uuid('account_id'),
  kind: text('kind').$type<AuditKind>().notNull(),
  /** Network and client facts: hashed IP, user agent. Never a password, token or email. */
  detail: jsonb('detail').$type<Record<string, string>>(),
  createdAt: createdAt(),
}, t => [index('audit_events_account_idx').on(t.accountId, t.createdAt)]);

/** Written by the import of a product's existing accounts; read once by that product to link its own rows. */
export const legacyLinks = pgTable('legacy_links', {
  accountId: uuid('account_id').notNull().references(() => accounts.id, { onDelete: 'cascade' }),
  product: text('product').$type<'health' | 'works'>().notNull(),
  productUserId: text('product_user_id').notNull(),
  importedAt: createdAt(),
}, t => [primaryKey({ columns: [t.accountId, t.product] }), uniqueIndex('legacy_links_product_user_key').on(t.product, t.productUserId)]);
