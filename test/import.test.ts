// Importing LotusPond Health's accounts:export file.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { afterEach, test } from 'node:test';
import { eq } from 'drizzle-orm';
import { accounts, credentials, legacyLinks } from '../src/db/cell-schema.ts';
import { directory } from '../src/db/directory-schema.ts';
import { hashPassword } from '../src/auth/password.ts';
import { importAccounts, type ExportedAccount } from '../src/import.ts';
import { loadConfig } from '../src/config.ts';
import { loadKeys } from '../src/lib/keys.ts';
import { csrfOf } from './support/browser.ts';
import { harness } from './support/harness.ts';

type H = Awaited<ReturnType<typeof harness>>;
let h: H;
afterEach(async () => { await h?.close(); });

const HEALTH_PASSWORD = 'an old health password';
let hash: string;
const line = async (over: Partial<ExportedAccount> = {}): Promise<ExportedAccount> => ({
  health_user_id: randomUUID(), email: `p-${randomUUID().slice(0, 8)}@example.com`,
  password_hash: hash ??= await hashPassword(HEALTH_PASSWORD), region: 'in', country: 'IN',
  created_at: '2026-06-01T10:00:00.000Z', accounts_subject: null, ...over,
});

/** The harness's keys are random per process, so the import must use the same ones: keys from one config. */
async function setup() {
  const env = { ACCOUNTS_DIRECTORY_SECRET: 'd'.repeat(64), ACCOUNTS_COOKIE_SECRET: 'c'.repeat(64) };
  h = await harness(env);
  const keys = loadKeys(loadConfig({ DIRECTORY_DATABASE_URL: 'postgres://d:x@db:5432/a', CELL_IN_DATABASE_URL: 'postgres://c:x@db:5432/b', ...env }));
  return { dbs: { directory: h.dbs.directory, cells: h.dbs.cells }, keys };
}

test('an import keeps the hash, starts unconfirmed, links the Health id, and answers its subject', async () => {
  const { dbs, keys } = await setup();
  const row = await line({ email: 'Asha@Example.com', created_at: '2026-01-02T03:04:05.000Z' });
  const report = await importAccounts(dbs, keys, [JSON.stringify(row)]);
  assert.equal(report.created, 1);
  const [{ health_user_id, sub }] = report.answers;
  assert.equal(health_user_id, row.health_user_id);
  const cell = h.dbs.cells.get('in')!.db;
  const [account] = await cell.select().from(accounts).where(eq(accounts.id, sub));
  assert.equal(account.email, 'asha@example.com');
  assert.equal(account.emailVerifiedAt, null, 'unconfirmed until the person confirms it');
  assert.equal(account.name, 'asha');
  assert.equal(account.createdAt.toISOString(), '2026-01-02T03:04:05.000Z');
  const [cred] = await cell.select().from(credentials).where(eq(credentials.accountId, sub));
  assert.equal(cred.secret, row.password_hash, 'the hash exactly as Health stored it');
  const [link] = await cell.select().from(legacyLinks).where(eq(legacyLinks.accountId, sub));
  assert.equal(link.productUserId, row.health_user_id);
  assert.equal((await h.dbs.directory.db.select().from(directory)).length, 1);
});

test('importing the same file twice changes nothing and answers the same subjects', async () => {
  const { dbs, keys } = await setup();
  const rows = [JSON.stringify(await line()), JSON.stringify(await line())];
  const first = await importAccounts(dbs, keys, rows);
  const second = await importAccounts(dbs, keys, rows);
  assert.equal(first.created, 2);
  assert.equal(second.created, 0);
  assert.equal(second.alreadyImported, 2);
  assert.deepEqual(second.answers, first.answers);
  assert.equal((await h.dbs.cells.get('in')!.db.select().from(accounts)).length, 2);
});

test('an email Accounts already has is skipped, not joined', async () => {
  const { dbs, keys } = await setup();
  const b = h.browser();
  const page = await (await b.get('/signup')).text();
  await b.post('/signup', { csrf: csrfOf(page), email: 'taken@example.com', name: 'T', password: 'correct horse battery', country: 'IN', accept_terms: 'yes' });
  const report = await importAccounts(dbs, keys, [JSON.stringify(await line({ email: 'taken@example.com' }))]);
  assert.equal(report.created, 0);
  assert.match(report.skipped[0].reason, /joins it by verified email/);
  assert.equal(report.answers.length, 0);
});

test('bad lines are skipped with a reason and never stop the import; no email appears in the report', async () => {
  const { dbs, keys } = await setup();
  const good = await line();
  const report = await importAccounts(dbs, keys, [
    'not json',
    JSON.stringify(await line({ health_user_id: 'nope' })),
    JSON.stringify(await line({ email: 'not-an-email' })),
    JSON.stringify(await line({ region: 'mars' })),
    JSON.stringify(await line({ region: 'eu', country: 'DE' })),
    JSON.stringify(await line({ password_hash: 'plaintext' })),
    JSON.stringify(await line({ password_hash: null })),
    JSON.stringify(await line({ country: 'DE' })),
    JSON.stringify(await line({ country: null, region: 'global' })),
    JSON.stringify(good),
    '',
  ]);
  assert.equal(report.created, 1);
  assert.equal(report.answers[0].health_user_id, good.health_user_id);
  assert.deepEqual(report.skipped.map(s => s.reason), [
    'not JSON', 'no valid health_user_id', 'no valid email', 'unknown region', 'region eu is not served here',
    'password hash is not Argon2', 'no password and no Accounts subject', 'country and region disagree',
    'region global is not served here',
  ]);
  assert.doesNotMatch(JSON.stringify(report.skipped), /@/);
});

test('an account linked before the import is answered with its existing subject, if this server holds it', async () => {
  const { dbs, keys } = await setup();
  const first = await importAccounts(dbs, keys, [JSON.stringify(await line())]);
  const sub = first.answers[0].sub;
  const linked = await line({ accounts_subject: sub, password_hash: null });
  const unknown = await line({ accounts_subject: randomUUID(), password_hash: null });
  const report = await importAccounts(dbs, keys, [JSON.stringify(linked), JSON.stringify(unknown)]);
  assert.equal(report.alreadyLinked, 1);
  assert.deepEqual(report.answers, [{ health_user_id: linked.health_user_id, sub }]);
  assert.match(report.skipped[0].reason, /does not hold/);
});

test('an imported person signs in with their Health password, and confirms their email before any product', async () => {
  const { dbs, keys } = await setup();
  const row = await line({ email: 'imported@example.com' });
  await importAccounts(dbs, keys, [JSON.stringify(row)]);
  const b = h.browser();
  const challenge = h.hydra.newLogin();
  const page = await (await b.get(`/login?login_challenge=${challenge}`)).text();
  const res = await b.post('/login', { csrf: csrfOf(page), login_challenge: challenge, email: 'imported@example.com', password: HEALTH_PASSWORD });
  assert.equal(res.status, 200);
  assert.match(await res.text(), /Confirm your email/);
  assert.equal(h.hydra.accepted.length, 0, 'no product gets the account before the email is confirmed');
  assert.ok(h.outbox.latest('imported@example.com'), 'a confirmation link was sent');
});
