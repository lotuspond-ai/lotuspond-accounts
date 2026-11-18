// The global directory database (ADR-0002, section 2). It holds no personal data: an HMAC of each email, keyed with
// ACCOUNTS_DIRECTORY_SECRET, mapped to the cell that holds the account, and which Hydra clients belong to which
// product. Generate migrations with `npm run db:generate`.
import { index, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import type { Region } from '../config.ts';

const createdAt = () => timestamp('created_at', { withTimezone: true }).notNull().defaultNow();

export const directory = pgTable('directory', {
  /** HMAC-SHA256 of the lower-cased, trimmed email, hex. Unique across every cell. */
  emailHash: text('email_hash').primaryKey(),
  region: text('region').$type<Region>().notNull(),
  accountId: uuid('account_id').notNull(),
  createdAt: createdAt(),
}, t => [index('directory_account_idx').on(t.accountId)]);

/** Which LotusPond product each OpenID Connect client (registered in Hydra) belongs to. */
export const productClients = pgTable('product_clients', {
  clientId: text('client_id').primaryKey(),
  product: text('product').$type<'health' | 'works'>().notNull(),
  createdAt: createdAt(),
});
