import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { afterEach, test } from 'node:test';
import { eq } from 'drizzle-orm';
import { accounts, auditEvents, productSignIns } from '../src/db/cell-schema.ts';
import { hashPassword } from '../src/auth/password.ts';
import { importAccounts } from '../src/import.ts';
import { loadConfig } from '../src/config.ts';
import { loadKeys } from '../src/lib/keys.ts';
import { buildReport, formatReport } from '../src/report.ts';
import { csrfOf } from './support/browser.ts';
import { harness } from './support/harness.ts';

type H = Awaited<ReturnType<typeof harness>>;
let h: H;
afterEach(async () => { await h?.close(); });

test('the report counts sign-ins, failures and imported accounts per day, and shows no email', async () => {
  const env = { ACCOUNTS_DIRECTORY_SECRET: 'd'.repeat(64), ACCOUNTS_COOKIE_SECRET: 'c'.repeat(64) };
  h = await harness(env);
  const keys = loadKeys(loadConfig({ DIRECTORY_DATABASE_URL: 'postgres://d:x@db:5432/a', CELL_IN_DATABASE_URL: 'postgres://c:x@db:5432/b', ...env }));
  const cell = h.dbs.cells.get('in')!.db;
  const hash = await hashPassword('old health password');
  const rows = [0, 1, 2].map(i => JSON.stringify({ health_user_id: randomUUID(), email: `imp${i}@example.com`, password_hash: hash, region: 'in', country: 'IN', created_at: '2026-06-01T00:00:00Z', accounts_subject: null }));
  const imported = await importAccounts({ directory: h.dbs.directory, cells: h.dbs.cells }, keys, rows);
  // One imported person confirms and signs in to Health; another only confirms.
  await cell.update(accounts).set({ emailVerifiedAt: new Date() }).where(eq(accounts.id, imported.answers[0].sub));
  await cell.update(accounts).set({ emailVerifiedAt: new Date() }).where(eq(accounts.id, imported.answers[1].sub));
  await cell.insert(productSignIns).values({ accountId: imported.answers[0].sub, product: 'health' });

  // Today: one sign-up, two failed sign-ins and one good one. Yesterday: one failure.
  const b = h.browser();
  const page = await (await b.get('/signup')).text();
  await b.post('/signup', { csrf: csrfOf(page), email: 'new@example.com', name: 'N', password: 'correct horse battery', country: 'IN', accept_terms: 'yes' });
  for (const password of ['wrong one here', 'wrong two here', 'correct horse battery']) {
    const login = h.browser();
    const form = await (await login.get('/login')).text();
    await login.post('/login', { csrf: csrfOf(form), email: 'new@example.com', password });
  }
  await cell.insert(auditEvents).values({ accountId: null, kind: 'sign_in_failed', createdAt: new Date(Date.now() - 86_400_000) });

  const report = await buildReport({ directory: h.dbs.directory, cells: h.dbs.cells }, 7);
  assert.equal(report.days.length, 7);
  const today = report.days.at(-1)!;
  const yesterday = report.days.at(-2)!;
  assert.deepEqual({ signIns: today.signIns, failed: today.failed, created: today.created }, { signIns: 1, failed: 2, created: 1 });
  assert.equal(yesterday.failed, 1);
  assert.deepEqual(report.imported, { total: 3, confirmed: 2, signedInToHealth: 1 });
  assert.equal(report.failureRate, 3 / 4);
  const text = formatReport(report);
  assert.match(text, /Failed sign-ins: 75\.0% of attempts\./);
  assert.match(text, /Imported from Health: 3; confirmed their email: 2; signed in to Health since: 1\./);
  assert.doesNotMatch(text, /@|[0-9a-f]{8}-[0-9a-f]{4}-/, 'no email and no account id');
});
